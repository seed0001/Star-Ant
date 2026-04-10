# Grass field and wind — implementation notes

This document describes how the procedural grass and wind work in this demo so you can reuse the same ideas in another Three.js app or translate them to another engine (WebGPU, Unity, Unreal, etc.). The original code lives in `src/main.js`.

---

## 1. High-level idea

- **One blade mesh** (a subdivided vertical plane) is drawn **many times** with **GPU instancing** (`InstancedMesh`), not thousands of separate meshes.
- **Shape** (needle / pointy blade) is done in the **vertex shader** by scaling horizontal width by height.
- **Wind** is **entirely procedural** in the vertex shader: no textures, no CPU animation. It uses:
  - elapsed time `uTime`
  - **world XZ** taken from each instance’s transform matrix (so nearby blades share similar wind)
- **Color variation** uses **per-instance colors** (`setColorAt`) passed into the shader.

Fog uses Three’s built-in shader chunks so blades fade in the distance.

---

## 2. Geometry (CPU)

| Property | Value | Why |
|----------|--------|-----|
| Base shape | `PlaneGeometry(bladeW, bladeH, 1, 6)` | Vertical plane in local space; **6 segments vertically** so vertices sample height `h` smoothly when the shader bends the blade. |
| Size | `bladeW ≈ 0.1`, `bladeH ≈ 1.35` | Tunable. |
| Pivot | `translate(0, bladeH / 2, 0)` | Moves the plane so **local Y runs from 0 (ground) to `bladeH` (tip)**. Shader uses `transformed.y / bladeH` as normalized height `h ∈ [0,1]`. |

Each instance gets a **random Y rotation**, **random scale**, and **random XZ position** over the field. That breaks up repetition.

---

## 3. Instancing (CPU)

- `InstancedMesh(geometry, material, GRASS_COUNT)` stores one matrix per blade.
- Loop: set `dummy.position`, `dummy.rotation.y`, `dummy.scale`, `dummy.updateMatrix()`, then `grass.setMatrixAt(i, dummy.matrix)`.
- **Per-blade tint:** `grass.setColorAt(i, color)` so the vertex shader can read `instanceColor` (when `USE_INSTANCING_COLOR` is active).
- After filling: `grass.instanceMatrix.needsUpdate = true` and, if used, `grass.instanceColor.needsUpdate = true`.
- `frustumCulled = false` avoids incorrect culling for large fields (optional; has a performance cost).

---

## 4. Vertex shader pipeline (conceptual order)

Work in **local blade space** first, then multiply by **`instanceMatrix`**, then **`modelViewMatrix`** and **`projectionMatrix`** (same pattern as Three’s `project_vertex` with instancing).

1. **`transformed = position`** (local vertex).
2. **`h = clamp(transformed.y / bladeH, 0, 1)`** — height along the blade; wind uses **`h²`** so the **base moves less than the tip** (rigid stem).
3. **Pointy profile:** `transformed.x *= pow(1.0 - h, 0.58)` — narrows the blade toward the tip (adjust exponent for sharper/softer needle).
4. **Wind** (see §5): add offsets to `transformed.x`, `transformed.z`, optionally small `transformed.y`.
5. **Clip space:**  
   `gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(transformed, 1.0)`  
   (Same as Three’s instanced path when you include fog as in this project.)

---

## 5. Wind math (GPU)

All of this uses **`t = uTime`** (seconds, accumulated each frame on the CPU).

### 5.1 World position for “areas”

Instancing gives each blade a full `instanceMatrix`. The **world origin of that blade** (good enough for field-scale wind) is:

```glsl
vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
vec2 wxz = ip.xz;
```

Wind patterns are **functions of `wxz` and `t`**, so **nearby blades** move similarly → believable gusts. This is **not** physically accurate fluid simulation; it **looks** like wind.

### 5.2 Large gust zones

Low-frequency sine products create **patches** that strengthen or weaken over time:

- `zoneA = sin(wxz.x * 0.048 + t * 0.52) * cos(wxz.y * 0.040 - t * 0.48)`
- `zoneB = sin((wxz.x + wxz.y * 0.7) * 0.028 + t * 0.36)`

Combine into **`gustStrength`**, clamp, square it, then **`mix(0.06, 1.0, …)`** so some regions are **almost calm** and others **strong**.

### 5.3 Medium ripples

A second, slightly faster pattern **`ripple`** multiplies `gustStrength` so **narrower bands** drift across the field.

### 5.4 Direction that varies in space

Two oscillators give a **bend vector** in local XZ:

- `w1 = sin(t * 2.2 + ip.x * … + ip.z * …)`
- `w2 = cos(t * 1.7 + …)`

Build `bend = vec2(…)`, then **rotate** it by an angle **`dir`** that depends on `wxz` and `t`:

```glsl
float dir = wxz.x * 0.022 - wxz.y * 0.019 + t * 0.72;
bend = mat2(cos(dir), -sin(dir), sin(dir), cos(dir)) * bend;
```

So wind **direction isn’t globally uniform**.

### 5.5 Apply to vertices

- **`hh = h * h`**
- `transformed.x += bend.x * hh * gustStrength`
- `transformed.z += bend.y * hh * gustStrength`
- Small vertical wobble on `transformed.y` scaled by `gustStrength` (optional).

**Tuning:** Frequencies (`0.048`, `0.095`, …), time multipliers (`0.52`, `0.78`), and amplitudes (`0.26`, `0.20`) control how large, fast, and strong gusts feel.

---

## 6. Fragment shader (color)

- `vUv` drives vertical gradient: darker **base**, lighter **tip**.
- `vColor` mixes in **per-instance** tint from `instanceColor`.
- A **bright band** near `vUv.y > 0.88` sells a sharp tip.

---

## 7. Time uniform — critical Three.js detail

`THREE.UniformsUtils.merge([…])` **clones** uniform objects. If you create `{ uTime: myUniform }` and then only update **`myUniform.value`**, the **`ShaderMaterial`** may still hold a **different** `uTime` object whose **value never changes** (symptom: grass frozen).

**Safe pattern:** each frame update the uniform on the **material** you render:

```js
grassMat.uniforms.uTime.value += deltaTime;
```

Do **not** rely on a separate merged reference unless you explicitly assign the same object after merge.

---

## 8. Fog + instancing

- Material: `fog: true`, and merge `THREE.UniformsLib.fog` into `uniforms`.
- Scene: set `scene.fog` (here `FogExp2`).
- Vertex shader: `#include <fog_pars_vertex>` and `#include <fog_vertex>`; fragment: `#include <fog_pars_fragment>` and `#include <fog_fragment>`.

Three injects `USE_INSTANCING` / `USE_INSTANCING_COLOR` and attributes when you use `InstancedMesh` + `setColorAt`; custom shader must not duplicate broken `#include` names that don’t exist in your Three version—rely on the **automatic** instancing attributes (`instanceMatrix`, `instanceColor`) as in this project.

---

## 9. Porting to another stack

| Concept | Three.js here | Elsewhere |
|--------|-----------------|-----------|
| Many copies | `InstancedMesh` | Instanced draw, `drawIndexed` with instance buffer |
| Per-instance transform | `instanceMatrix` | `mat4` per instance in a vertex attribute or buffer |
| Per-instance color | `instanceColor` | `vec3` or `vec4` per instance |
| Wind | Vertex shader | Same math in GLSL / WGSL / HLSL |
| Time | `uniform float uTime` | Same; update once per frame |

**Same math** works in any API: **height `h`**, **taper on X**, **bend × `h²`**, **spatial variation from world XZ** + **time**.

---

## 10. Performance notes

- **90k** instances is heavy on low-end GPUs; reduce `GRASS_COUNT` or draw distance if needed.
- Vertical subdivisions (`1, 6`) cost a little more vertices but make bending smoother.
- Optional: LOD (fewer instances far away), or replace with a mesh + texture impostors for distant hills.

---

## 11. Quick parameter reference

| Knob | Location | Effect |
|------|-----------|--------|
| `bladeW`, `bladeH` | JS | Blade size |
| Taper exponent `0.58` | Vertex shader | Sharper/softer point |
| `GRASS_COUNT`, `spread` | JS | Density and field size |
| `gustStrength` mix `0.06` … `1` | Vertex shader | Calm vs windy contrast |
| `uTime` coefficients | Vertex shader | Gust speed and drift |
| Bend amplitudes | Vertex shader | How far tips move |

---

This should be enough to recreate the effect or hand off to another engine’s shader author without copying the whole app verbatim.
