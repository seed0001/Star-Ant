import * as THREE from "three";
import { TERRAIN_WORLD_HALF_EXTENT } from "./terrain-paint.js";

const RAIN_CAP = 32000;
const SNOW_CAP = 5000;

/** Sky / point-light flash duration (seconds) — matched in {@link getLightningFlash}. */
const LIGHTNING_FLASH_S = 0.11;

/** Rain color at low intensity (blue-tinted). */
const RAIN_COLOR_LO = new THREE.Color(0x7aa8d8);
/** Rain color at high intensity (washed-out gray-blue). */
const RAIN_COLOR_HI = new THREE.Color(0xb0c4d8);

const _tmpRainColor = new THREE.Color();

/**
 * @param {THREE.Vector3} a
 * @param {THREE.Vector3} b
 * @param {number} segments
 * @param {number} jitter
 */
function buildJaggedBolt(a, b, segments, jitter) {
  const pts = [a.clone()];
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  dir.normalize();
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const p = a.clone().lerp(b, t);
    const falloff = 1.0 - t * 0.45;
    p.x += (Math.random() - 0.5) * jitter * falloff;
    p.y += (Math.random() - 0.5) * jitter * 0.25 * falloff;
    p.z += (Math.random() - 0.5) * jitter * falloff;
    pts.push(p);
  }
  pts.push(b.clone());
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return geo;
}

/**
 * @param {THREE.Vector3} mid
 * @param {THREE.Vector3} dirHint
 * @param {number} len
 * @param {number} jitter
 */
function buildFork(mid, dirHint, len, jitter) {
  const end = mid.clone().addScaledVector(dirHint, len);
  end.x += (Math.random() - 0.5) * jitter;
  end.y += (Math.random() - 0.5) * jitter * 0.5;
  end.z += (Math.random() - 0.5) * jitter;
  return buildJaggedBolt(mid, end, 5, jitter * 0.6);
}

/**
 * Custom rain streak shader for THREE.Points (additive, screen-space size + vertical streak in gl_PointCoord).
 */
function createRainShaderMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRainSize: { value: 3.0 },
      uStreakRatio: { value: 2.0 },
      uOpacity: { value: 0.5 },
      uColor: { value: new THREE.Vector3(0.478, 0.659, 0.847) },
    },
    vertexShader: `
      #include <common>
      uniform float uRainSize;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float dist = max(-mvPosition.z, 6.0);
        float px = uRainSize * (480.0 / dist);
        // Floor so mid/far field still reads as continuous rain, not sparse dots
        gl_PointSize = clamp(max(px, uRainSize * 0.28), 1.0, 256.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uStreakRatio;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        p.y *= uStreakRatio;
        p.x *= 1.18;
        float d = length(p);
        float mask = 1.0 - smoothstep(0.38, 1.0, d);
        float a = mask * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * Rain, snow (GPU points), lightning flashes + jagged bolt lines.
 */
export class WeatherEffects {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = "WeatherEffects";
    this.scene.add(this.root);

    this._rainPos = new Float32Array(RAIN_CAP * 3);
    this._snowPos = new Float32Array(SNOW_CAP * 3);
    this._snowPhase = new Float32Array(SNOW_CAP);
    for (let i = 0; i < RAIN_CAP; i++) {
      this._rainPos[i * 3] = (Math.random() - 0.5) * 200;
      this._rainPos[i * 3 + 1] = Math.random() * 80 + 20;
      this._rainPos[i * 3 + 2] = (Math.random() - 0.5) * 200;
    }
    for (let i = 0; i < SNOW_CAP; i++) {
      this._snowPos[i * 3] = (Math.random() - 0.5) * 200;
      this._snowPos[i * 3 + 1] = Math.random() * 80 + 20;
      this._snowPos[i * 3 + 2] = (Math.random() - 0.5) * 200;
      this._snowPhase[i] = Math.random() * Math.PI * 2;
    }

    this.rainGeo = new THREE.BufferGeometry();
    this.rainGeo.setAttribute("position", new THREE.BufferAttribute(this._rainPos, 3));
    this.rainMat = createRainShaderMaterial();
    this.rainPoints = new THREE.Points(this.rainGeo, this.rainMat);
    this.rainPoints.frustumCulled = false;
    this.rainPoints.visible = false;
    this.root.add(this.rainPoints);

    this.snowGeo = new THREE.BufferGeometry();
    this.snowGeo.setAttribute("position", new THREE.BufferAttribute(this._snowPos, 3));
    this.snowMat = new THREE.PointsMaterial({
      color: 0xf0f8ff,
      size: 0.11,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.snowPoints = new THREE.Points(this.snowGeo, this.snowMat);
    this.snowPoints.frustumCulled = false;
    this.snowPoints.visible = false;
    this.root.add(this.snowPoints);

    this.strikeMat = new THREE.LineBasicMaterial({
      color: 0xd0e8ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.strikeForkMat = this.strikeMat.clone();

    const empty = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.01, 0),
    ]);
    this.strikeMain = new THREE.Line(empty, this.strikeMat);
    this.strikeFork = new THREE.Line(empty.clone(), this.strikeForkMat);
    this.strikeMain.visible = false;
    this.strikeFork.visible = false;
    this.strikeMain.frustumCulled = false;
    this.strikeFork.frustumCulled = false;
    this.root.add(this.strikeMain, this.strikeFork);

    this.flashLight = new THREE.PointLight(0xc8e0ff, 0, 420, 1.8);
    this.flashLight.position.set(0, 90, 0);
    this.root.add(this.flashLight);

    /** @type {number} */
    this._nextStrikeTime = 0;
    /** @type {number} */
    this._strikeHideAt = -1;
    /** @type {THREE.BufferGeometry | null} */
    this._strikeGeomMain = null;
    /** @type {THREE.BufferGeometry | null} */
    this._strikeGeomFork = null;
    /** @type {number} */
    this._flashUntil = 0;
  }

  /**
   * Normalized lightning flash for sky / environment (0..1). Call after {@link update}.
   * @param {number} elapsed
   */
  getLightningFlash(elapsed) {
    const flashT = this._flashUntil - elapsed;
    if (flashT <= 0) return 0;
    return Math.sin((flashT / LIGHTNING_FLASH_S) * Math.PI);
  }

  /**
   * @param {number} dt
   * @param {number} elapsed
   * @param {{
   *   rainIntensity: number,
   *   snowIntensity: number,
   *   lightningIntensity: number,
   *   windSpeed: number,
   *   windDirRad: number,
   *   dayPhase: number,
   * }} w
   * @param {THREE.PerspectiveCamera} camera
   * @param {null | {
   *   terrain: import("./terrain-paint.js").TerrainHeightField,
   *   snowAccum: import("./snow-accumulation.js").SnowAccumulationField,
   * }} [link] When set, snowflakes collide with terrain and stamp snow cover cells.
   */
  update(dt, elapsed, w, camera, link = null) {
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const ri = THREE.MathUtils.clamp(w.rainIntensity, 0, 1);
    /** Spawn half-extent: tightens toward camera at high intensity (deluge feels denser). */
    const rainSpread = THREE.MathUtils.lerp(TERRAIN_WORLD_HALF_EXTENT, 130, ri);
    const topY = cy + 55;
    const floorY = cy - 35;

    const wx = Math.cos(w.windDirRad) * w.windSpeed * 0.35;
    const wz = Math.sin(w.windDirRad) * w.windSpeed * 0.35;
    const day = THREE.MathUtils.clamp(w.dayPhase, 0, 1);
    const vis = 0.28 + day * 0.72;

    const rainOn = w.rainIntensity > 0.02;
    const snowOn = w.snowIntensity > 0.02;
    this.rainPoints.visible = rainOn;
    this.snowPoints.visible = snowOn;

    this.snowMat.opacity = 0.25 + w.snowIntensity * 0.5 * vis;

    const rainCount = Math.max(0, Math.floor(RAIN_CAP * ri));
    const snowCount = Math.max(0, Math.floor(SNOW_CAP * w.snowIntensity));

    const rainMat = this.rainMat;
    if (rainMat instanceof THREE.ShaderMaterial && rainMat.uniforms) {
      const u = rainMat.uniforms;
      const rainSize = 1.8 + ri * 4.2;
      const streakRatio = 1.2 + ri * 3.8;
      const opacity = 0.15 + ri * 0.72 * vis;
      if (u.uRainSize) u.uRainSize.value = rainSize;
      if (u.uStreakRatio) u.uStreakRatio.value = streakRatio;
      if (u.uOpacity) u.uOpacity.value = opacity;
      if (u.uColor) {
        _tmpRainColor.copy(RAIN_COLOR_LO).lerp(RAIN_COLOR_HI, ri);
        u.uColor.value.set(_tmpRainColor.r, _tmpRainColor.g, _tmpRainColor.b);
      }
    }

    if (rainOn && rainCount > 0) {
      const pos = this._rainPos;
      const spd = 35 + ri * 85 + w.windSpeed * 14;
      for (let i = 0; i < rainCount; i++) {
        const ix = i * 3;
        pos[ix + 1] -= spd * dt;
        pos[ix] += wx * dt * 1.1;
        pos[ix + 2] += wz * dt * 1.1;
        if (pos[ix + 1] < floorY) {
          pos[ix] = cx + (Math.random() - 0.5) * rainSpread * 2;
          pos[ix + 1] = topY + Math.random() * 25;
          pos[ix + 2] = cz + (Math.random() - 0.5) * rainSpread * 2;
        }
      }
      this.rainGeo.setDrawRange(0, rainCount);
      this.rainGeo.attributes.position.needsUpdate = true;
    }

    if (snowOn && snowCount > 0) {
      const pos = this._snowPos;
      const ph = this._snowPhase;
      const spread = TERRAIN_WORLD_HALF_EXTENT;
      const fall = 4.5 + w.windSpeed * 1.2;
      const terrain = link?.terrain;
      const snowAccum = link?.snowAccum;
      const si = THREE.MathUtils.clamp(w.snowIntensity, 0, 1);
      for (let i = 0; i < snowCount; i++) {
        const ix = i * 3;
        pos[ix + 1] -= fall * dt;
        ph[i] += dt * (0.8 + (i % 7) * 0.05);
        pos[ix] += wx * dt * 0.35 + Math.sin(ph[i]) * 0.35 * dt;
        pos[ix + 2] += wz * dt * 0.35 + Math.cos(ph[i] * 0.9) * 0.28 * dt;

        let collideY = floorY;
        let land = false;
        if (terrain) {
          const th = terrain.getHeightBilinear(pos[ix], pos[ix + 2]);
          const wh = terrain.getWaterSurfaceHeightBilinear(pos[ix], pos[ix + 2]);
          land = th >= wh + 0.05;
          if (land) {
            collideY = th + 0.11;
          }
        }

        if (pos[ix + 1] < collideY) {
          if (terrain && snowAccum && land) {
            snowAccum.stampWorld(pos[ix], pos[ix + 2], si * 0.045);
          }
          pos[ix] = cx + (Math.random() - 0.5) * spread * 2;
          pos[ix + 1] = topY + Math.random() * 25;
          pos[ix + 2] = cz + (Math.random() - 0.5) * spread * 2;
        }
      }
      this.snowGeo.setDrawRange(0, snowCount);
      this.snowGeo.attributes.position.needsUpdate = true;
    }

    const li = THREE.MathUtils.clamp(w.lightningIntensity, 0, 1);
    if (li < 0.02) {
      this.flashLight.intensity = 0;
      this.strikeMain.visible = false;
      this.strikeFork.visible = false;
      this._nextStrikeTime = elapsed + 1;
    } else {
      if (this._nextStrikeTime <= 0) this._nextStrikeTime = elapsed + 0.12 + Math.random() * 0.85;

      const spreadStrike = TERRAIN_WORLD_HALF_EXTENT;
      if (elapsed >= this._nextStrikeTime) {
        this._scheduleStrike(elapsed, cx, cz, spreadStrike, li);
        /** Shorter gaps → more strikes at the same slider (was ~5.5s→0.55s; now ~3.0s→0.18s). */
        const gap = THREE.MathUtils.lerp(3.0, 0.18, li) * (0.22 + Math.random() * 0.58);
        this._nextStrikeTime = elapsed + gap;
      }

      if (elapsed >= this._strikeHideAt) {
        this.strikeMain.visible = false;
        this.strikeFork.visible = false;
      } else {
        const fade = THREE.MathUtils.clamp((this._strikeHideAt - elapsed) / 0.14, 0, 1);
        this.strikeMat.opacity = 0.95 * fade;
        this.strikeForkMat.opacity = 0.75 * fade;
      }

      const flashT = this._flashUntil - elapsed;
      if (flashT > 0) {
        const pulse = Math.sin((flashT / LIGHTNING_FLASH_S) * Math.PI);
        this.flashLight.intensity = (52 + li * 118) * pulse * vis;
      } else {
        this.flashLight.intensity = 0;
      }
    }
  }

  /**
   * @param {number} elapsed
   * @param {number} cx
   * @param {number} cz
   * @param {number} spread
   * @param {number} li
   */
  _scheduleStrike(elapsed, cx, cz, spread, li) {
    const sx = cx + (Math.random() - 0.5) * spread * 2.2;
    const sz = cz + (Math.random() - 0.5) * spread * 2.2;
    const top = new THREE.Vector3(sx, 92 + Math.random() * 35, sz);
    const ground = new THREE.Vector3(
      sx + (Math.random() - 0.5) * 18,
      0.05,
      sz + (Math.random() - 0.5) * 18
    );
    const jitter = 4 + li * 8;

    if (this._strikeGeomMain) this._strikeGeomMain.dispose();
    if (this._strikeGeomFork) this._strikeGeomFork.dispose();

    this._strikeGeomMain = buildJaggedBolt(top, ground, 16 + Math.floor(li * 10), jitter);
    this.strikeMain.geometry.dispose();
    this.strikeMain.geometry = this._strikeGeomMain;

    const mid = top.clone().lerp(ground, 0.38 + Math.random() * 0.2);
    const forkDir = new THREE.Vector3(
      (Math.random() - 0.5) * 0.7,
      -0.35,
      (Math.random() - 0.5) * 0.7
    ).normalize();
    this._strikeGeomFork = buildFork(mid, forkDir, 12 + Math.random() * 10, jitter * 0.55);
    this.strikeFork.geometry.dispose();
    this.strikeFork.geometry = this._strikeGeomFork;

    this.strikeMain.visible = true;
    this.strikeFork.visible = true;
    this.strikeMat.opacity = 0.95;
    this.strikeForkMat.opacity = 0.75;

    this._strikeHideAt = elapsed + 0.2;
    this._flashUntil = elapsed + LIGHTNING_FLASH_S;

    const flashPos = top.clone().lerp(ground, 0.35);
    this.flashLight.position.copy(flashPos);
  }
}
