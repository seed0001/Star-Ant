# Night sky: stars and nebula (shader notes)

This document describes how the **night** portion of the sky is produced in code: **procedural stars** and **nebular / galactic haze**. It does **not** cover the separate constellation overlay (`ConstellationOverlay`), astrology UI, or day/sunset/cloud logic beyond what is needed to see how night color is composited.

**Source of truth:** `src/sky.js` (`SkyDome`), with tuning helpers in `src/sky-settings.js` and star-density mapping in `src/main.js` (`applyStarAmount`).

---

## Architecture

- The sky is a **large inverted sphere** (`THREE.BackSide`) centered on the camera each frame so the horizon stays at infinity.
- A **single fragment shader** computes, per pixel, a view direction `direction`, then builds a **night color** (nebula + stars + optional ground glow), a **day color** (gradient + sun + sunset), and mixes them with **`dayPhase`** (0 = night, 1 = day). Additional layers (clouds, storm tint) are alpha-blended on top of that mix.
- **Stars and nebula are not textures**; they are **purely procedural** in the fragment shader using **hash** and **3D/2D FBM** (fractal Brownian motion).

---

## View direction and a stable star field

The vertex shader passes a **world-space direction** from the camera through each vertex:

- `vDir = normalize(worldPosition - cameraPosition)` (see `src/sky.js`).

In the fragment shader, `direction = normalize(vDir)` is the **unit vector** for “this pixel looks at infinity in that direction.”

Before stars are evaluated, the direction is **rotated ~35° around Y** (fixed constants `cr` / `sr`). That breaks axis-aligned symmetry so the star grid does not line up awkwardly with world axes after scaling.

Stars use a **scaled, quantized** space:

1. Build `d` from the rotated direction.
2. Form `q = vec3(d.x * 719.3, d.y * 683.1, d.z * 701.7)` plus a small **sin/cos warp** so cells are not perfectly uniform cubes in world space.
3. `starCell = floor(q)` gives an integer **3D cell ID** per direction.
4. Each cell gets one **hash** value `starGrain = hash(starCell)` in \([0,1)\).

So each “cell” on the sky corresponds to a **direction bucket**; many buckets are empty or culled (see below).

---

## Stars: point-like brightness

Brightness is **not** “draw a sprite”; it is:

```text
stars = pow(starGrain, starExp) * starM
```

- **`starExp`** (shader: `uStarExponent * uStarExponentMul`): large exponent → only the **highest** random values survive → **many faint cells go to zero**, leaving sparse bright points.
- **`starM`** (`uStarMult * uStarMultMul`): overall scale of star brightness.

**Culling:** a second hash per cell is compared to `starCull` (clamped to `< 1`). If `hash(starCell + offset) < starCull`, that cell’s stars are forced to **0**. That thins the field without changing the exponent as aggressively.

**Twinkle:** `stars *= 0.9 + 0.1 * sin(time * 1.5 + starGrain * 20.0)` adds a **slow, per-cell phase** so surviving stars gently pulse.

**User “Star amount” slider** (`main.js` → `applyStarAmount`) lerps three uniforms:

| Star amount → | `uStarExponent` | `uStarMult` | `uStarCull` |
|----------------|-----------------|-------------|-------------|
| 0 (few stars)  | 1360            | 0.65        | 0.84        |
| 1 (many stars) | 1010            | 2.1         | 0.5         |

Higher exponent + higher cull at low star amount = **fewer, sharper points**; lower exponent + lower cull + higher mult = **denser, brighter field**.

Advanced settings (`sky-settings.js`) can further scale **`starExponentMul`**, **`starMultMul`**, **`starCullMul`** without changing the base slider curve.

---

## Nebula / “galaxy” haze

The nebula is **not** a separate mesh; it is **several FBM samples** in 3D, tinted and summed.

1. **Base coordinate:** `nebulaPos = direction * 3.0 + time * 0.005` — slow **drift** over time so the milky haze shifts slightly.
2. **Macro structure:** `n = fbm(nebulaPos)` — one **5-octave 3D FBM** (`noise` + `fbm` in `sky.js`) gives large-scale variation.
3. **Layers** (each multiplied by `uNebulaBlue` or `uNebulaPurple` from settings):

   - Deep blue: `vec3(0.02, 0.08, 0.32) * fbm(nebulaPos * 1.2 + offset) * uNebulaBlue`
   - Brighter blue: similar with a different scale/offset.
   - Purple / violet: `vec3(0.16, 0.04, 0.38)` and `vec3(0.1, 0.02, 0.22)` with higher-frequency FBM.

4. **Combine:** `finalNebula = (sum of terms) * n * 0.58` — the **global** `n` gates overall brightness; inner FBM terms add **color variation**.
5. **Extra low-frequency shimmer:** a small additive term uses `fbm(nebulaPos * 0.8 + vec3(time * 0.02))` mixed with `(uNebulaBlue + uNebulaPurple) * 0.5`.

So “galaxies” here means **soft, multi-scale colored noise** on the celestial sphere, **blue and purple** gains controlled by **Settings → Nebula blue / Nebula purple** (mapped to `uNebulaBlue` and `uNebulaPurple` in `main.js`).

---

## Assembling the night color

```text
nightColor = finalNebula + vec3(stars)
```

- **Stars** are added to **all channels equally** (`vec3(stars)`), so they read as **white** (modulated only by twinkle and density).

**Near-horizon night:** `nightColor += uNightGroundTint * uNightGroundStr * nearGround` with `nearGround` from `direction.y` (darker toward the ground direction). That avoids a hard black strip at the horizon at night.

---

## Mixing night with day (and why stars disappear in daylight)

The shader computes a full **dayColor** (zenith/horizon gradient, sun disk, anti-sun, sunset, dusk). Then:

```text
skyMix = mix(nightColor, dayColor, dayPhase)
skyMix *= mix(nightFade, dayHorizon, dayPhase)
```

- **`dayPhase`** (0…1) comes from the game’s day/night cycle.
- **`nightFade` / `dayHorizon`** (from `sky-settings.js`) reshape **horizon brightness** differently for night vs day so the transition reads natural.

At **`dayPhase = 1`**, the night **nebula + stars** are fully replaced by the day sky; stars are never drawn as a separate pass—they are simply **not visible** in the final mix.

---

## Clouds and storm (same shader, not nebula)

After `skyMix` is built, **clouds** are computed from **2D FBM** on a spherical panorama coordinate (`atan`/`asin` of `direction`), scrolled by wind uniforms. They are **composited on top** of the sky mix with alpha. This is **meteorological cloud**, not Milky Way structure; it can obscure stars when cover is high.

---

## Uniform summary (night-relevant)

| Uniform | Role |
|--------|------|
| `time` | Twinkle + slow nebula drift |
| `dayPhase` | Night vs day mix |
| `uStarExponent`, `uStarMult`, `uStarCull` | Star density / sharpness / culling |
| `uStarExponentMul`, `uStarMultMul`, `uStarCullMul` | Advanced tuning multipliers |
| `uNebulaBlue`, `uNebulaPurple` | Nebula color intensity |
| `uNightGroundTint`, `uNightGroundStr` | Horizon glow at night |
| `uNightFadeLow/High`, `uNightFadeYOffset`, `uDayHorizon*` | Horizon shaping in the mix |

---

## What this document intentionally omits

- **Constellation lines / labels / overlays** — implemented elsewhere (`src/constellation-overlay.js`), not part of the `SkyDome` star/nebula math above.
- **Sun path, sunset, clouds, lightning** — only mentioned where they affect visibility of the night layer.
