import * as THREE from "three";
import { splitCounts, loadCritterGeometry } from "./critters.js";
import { BUMBLEBEE_FBX_URL } from "./bumblebee.js";
import { sampleLandXZForSpawn } from "./terrain-paint.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finiteOr(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

/** @typedef {{ color: string, sharePercent: number }} CritterPreset */

/**
 * Rebuild when count / presets / seed / flower layout change.
 * @param {object} o
 * @param {string} flowerSigStr Same string as `flowerSignature(...)` for the current field.
 */
export function bumblebeeSignature(o, flowerSigStr) {
  return JSON.stringify({
    bumblebeeCount: o.bumblebeeCount,
    bumblebeePresets: o.bumblebeePresets,
    bumblebeeSeed: o.bumblebeeSeed,
    flowerSig: flowerSigStr,
    beeHiveCount: finiteOr(o.beeHiveCount, 0),
    beeHiveSeed: finiteOr(o.beeHiveSeed, 0),
  });
}

const S_FLY = 0;
const S_APPROACH = 1;
const S_PERCH = 2;
const S_TAKEOFF = 3;

/**
 * Instanced hero-bee FBX: wander over the field, land on flower heads, take off again.
 */
export class BumblebeeSwarm {
  /**
   * @param {THREE.Scene} scene
   * @param {number} fieldSpread
   */
  constructor(scene, fieldSpread) {
    this.scene = scene;
    this.fieldSpread = fieldSpread;
    /** @type {THREE.Group | null} */
    this.group = null;
    /** @type {THREE.BufferGeometry | null} */
    this._geo = null;
    /** @type {Promise<THREE.BufferGeometry | null> | null} */
    this._loadPromise = null;
    this._rebuildGen = 0;
    /**
     * @type {{
     *   mesh: THREE.InstancedMesh,
     *   phase: Float32Array,
     *   scale: Float32Array,
     *   state: Uint8Array,
     *   px: Float32Array,
     *   py: Float32Array,
     *   pz: Float32Array,
     *   tx: Float32Array,
     *   ty: Float32Array,
     *   tz: Float32Array,
     *   perchUntil: Float32Array,
     *   nextTryT: Float32Array,
     *   takeVy: Float32Array,
     *   yaw: Float32Array,
     * }[]}
     */
    this._blocks = [];
    /** @type {import("./terrain-paint.js").TerrainHeightField | null} */
    this._terrain = null;
    /** @type {{ x: number; y: number; z: number }[]} */
    this._hivePositions = [];
  }

  async ensureGeometry() {
    if (this._geo) return this._geo;
    if (!this._loadPromise) {
      this._loadPromise = loadCritterGeometry(BUMBLEBEE_FBX_URL, 0.052);
    }
    this._geo = await this._loadPromise;
    return this._geo;
  }

  clear() {
    if (this.group) {
      this.scene.remove(this.group);
      this._blocks.forEach(({ mesh }) => {
        mesh.material.dispose();
      });
      this._blocks = [];
      this.group = null;
    }
    this._terrain = null;
    this._hivePositions = [];
  }

  /**
   * @param {object} opts
   * @param {number} opts.total
   * @param {CritterPreset[]} opts.presets
   * @param {number} opts.seed
   * @param {import("./terrain-paint.js").TerrainHeightField | null} [opts.terrain]
   * @param {import("./terrain-paint.js").DryLandSpawnPoints | null} [opts.dryLand]
   * @param {{ x: number; y: number; z: number }[]} [opts.hivePositions] — colony anchors (from BeeHiveField)
   * @returns {Promise<boolean>}
   */
  async rebuild(opts) {
    const token = ++this._rebuildGen;
    this.clear();
    this._terrain = opts.terrain ?? null;
    /** @type {{ x: number; y: number; z: number }[]} */
    this._hivePositions = Array.isArray(opts.hivePositions) ? opts.hivePositions : [];
    const geo = await this.ensureGeometry();
    if (token !== this._rebuildGen) return false;
    if (!geo) return false;

    const total = Math.max(0, Math.floor(opts.total));
    if (total < 1) return true;

    const presets =
      Array.isArray(opts.presets) && opts.presets.length > 0
        ? opts.presets
        : [{ color: "#e8c040", sharePercent: 100 }];
    const weights = presets.map((p) => finiteOr(p.sharePercent, 100));
    const counts = splitCounts(total, weights);

    const rng = mulberry32(opts.seed >>> 0);
    const spread = this.fieldSpread * 0.96;
    const bound = spread * 0.99;

    this.group = new THREE.Group();
    this.group.name = "Bumblebees (instanced)";

    const dummy = new THREE.Object3D();
    const tmpColor = new THREE.Color();

    for (let pi = 0; pi < presets.length; pi++) {
      const n = counts[pi] ?? 0;
      if (n < 1) continue;

      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: false,
        metalness: 0.08,
        roughness: 0.72,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const phase = new Float32Array(n);
      const scale = new Float32Array(n);
      const state = new Uint8Array(n);
      const px = new Float32Array(n);
      const py = new Float32Array(n);
      const pz = new Float32Array(n);
      const tx = new Float32Array(n);
      const ty = new Float32Array(n);
      const tz = new Float32Array(n);
      const perchUntil = new Float32Array(n);
      const nextTryT = new Float32Array(n);
      const takeVy = new Float32Array(n);
      const yaw = new Float32Array(n);

      for (let i = 0; i < n; i++) {
        const land = sampleLandXZForSpawn(this._terrain, opts.dryLand, rng, spread);
        const x = land.x;
        const z = land.z;
        const y = 2.2 + rng() * 9;
        phase[i] = rng() * Math.PI * 2;
        scale[i] = 0.82 + rng() * 0.38;
        state[i] = S_FLY;
        px[i] = x;
        py[i] = y;
        pz[i] = z;
        tx[i] = x;
        ty[i] = y;
        tz[i] = z;
        perchUntil[i] = 0;
        nextTryT[i] = rng() * 6 + 1.5;
        takeVy[i] = 0;
        yaw[i] = rng() * Math.PI * 2;

        dummy.position.set(x, y, z);
        dummy.rotation.set(0.08 + (rng() - 0.5) * 0.2, yaw[i], (rng() - 0.5) * 0.15);
        dummy.scale.setScalar(scale[i]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        tmpColor.set(typeof presets[pi].color === "string" ? presets[pi].color : "#e8c040");
        mesh.setColorAt(i, tmpColor);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this._blocks.push({
        mesh,
        phase,
        scale,
        state,
        px,
        py,
        pz,
        tx,
        ty,
        tz,
        perchUntil,
        nextTryT,
        takeVy,
        yaw,
      });
    }

    if (token !== this._rebuildGen) return false;
    this.scene.add(this.group);
    return true;
  }

  /**
   * @param {number} t
   * @param {number} dt
   * @param {number} windSpeed
   * @param {number} windDirRad
   * @param {import("./flowers.js").FlowerField | null | undefined} flowerField
   * @param {import("./bee-hives.js").BeeHiveField | null | undefined} beeHiveField — live hive positions (terrain sync)
   */
  update(t, dt, windSpeed, windDirRad, flowerField, beeHiveField) {
    const dtC = Math.min(Math.max(dt, 0), 0.08);
    const wdx = Math.cos(windDirRad);
    const wdz = Math.sin(windDirRad);
    const w = windSpeed;
    const dummy = new THREE.Object3D();
    const spread = this.fieldSpread * 0.96;
    const bound = spread * 0.99;
    const hives = beeHiveField?.getHivePositions?.() ?? this._hivePositions ?? [];

    for (let b = 0; b < this._blocks.length; b++) {
      const blk = this._blocks[b];
      const {
        mesh,
        phase,
        scale,
        state,
        px,
        py,
        pz,
        tx,
        ty,
        tz,
        perchUntil,
        nextTryT,
        takeVy,
        yaw,
      } = blk;
      const n = mesh.count;

      for (let i = 0; i < n; i++) {
        const ph = phase[i];
        const sc = scale[i];
        let x = px[i];
        let y = py[i];
        let z = pz[i];
        const st = state[i];

        if (st === S_FLY) {
          const hive =
            hives.length > 0 ? hives[i % hives.length] : null;
          let wanderX =
            Math.sin(t * 0.58 + ph) * 1.05 + Math.sin(t * 1.12 + ph * 2.3) * 0.35;
          let wanderZ =
            Math.cos(t * 0.51 + ph * 1.2) * 1.05 + Math.cos(t * 0.97 + ph * 1.8) * 0.35;

          if (hive) {
            const dhx = hive.x - x;
            const dhz = hive.z - z;
            const dh = Math.hypot(dhx, dhz);
            const pull = THREE.MathUtils.clamp(0.18 + dh / 55, 0.14, 0.95);
            const inv = 1 / Math.max(dh, 0.35);
            wanderX += dhx * inv * pull * 1.15;
            wanderZ += dhz * inv * pull * 1.15;
            if (dh < 11 && dh > 0.35) {
              wanderX += -dhz * 0.32;
              wanderZ += dhx * 0.32;
            }
            if (dh < 4.2) {
              wanderX *= 0.72;
              wanderZ *= 0.72;
            }
          }

          x += (wanderX + wdx * w * 0.55) * dtC * 2.8;
          z += (wanderZ + wdz * w * 0.55) * dtC * 2.8;

          const baseY =
            2.4 + Math.sin(t * 0.64 + ph * 0.95) * 2.8 + Math.sin(t * 1.9 + ph * 1.4) * 0.45;
          if (hive) {
            const dh = Math.hypot(hive.x - x, hive.z - z);
            const forageY =
              hive.y +
              2.05 +
              Math.sin(t * 0.62 + ph * 0.9) * 2.6 +
              Math.sin(t * 1.85 + ph * 1.3) * 0.42;
            const blend = THREE.MathUtils.clamp(0.38 + dh / 70, 0.28, 0.78);
            y = THREE.MathUtils.lerp(baseY, forageY, blend);
          } else {
            y = baseY;
          }

          if (x > bound) x = bound;
          else if (x < -bound) x = -bound;
          if (z > bound) z = bound;
          else if (z < -bound) z = -bound;

          const dx = Math.sin(t * 0.4 + ph * 1.7) * 0.5 + wanderX * 0.08;
          const dz = Math.cos(t * 0.38 + ph * 1.5) * 0.5 + wanderZ * 0.08;
          yaw[i] = Math.atan2(dx, dz);

          if (t >= nextTryT[i] && flowerField) {
            const land = flowerField.getNearestFlowerLanding(x, z, y, 42, 55);
            if (land) {
              state[i] = S_APPROACH;
              tx[i] = land.x;
              ty[i] = land.yTop + 0.04;
              tz[i] = land.z;
            }
            nextTryT[i] = t + 3 + ((ph * 7.3) % 1) * 11;
          }

          px[i] = x;
          py[i] = y;
          pz[i] = z;
        } else if (st === S_APPROACH) {
          const ax = tx[i];
          const ay = ty[i];
          const az = tz[i];
          const lerp = 1 - Math.exp(-dtC * 5.2);
          x = THREE.MathUtils.lerp(x, ax, lerp);
          y = THREE.MathUtils.lerp(y, ay, lerp);
          z = THREE.MathUtils.lerp(z, az, lerp);
          const ddx = ax - x;
          const ddz = az - z;
          yaw[i] = Math.atan2(ddx, ddz);
          px[i] = x;
          py[i] = y;
          pz[i] = z;
          if (ddx * ddx + (ay - y) * (ay - y) + ddz * ddz < 0.07 * 0.07) {
            state[i] = S_PERCH;
            perchUntil[i] = t + 1.8 + (ph % 1) * 3.5;
          }
        } else if (st === S_PERCH) {
          x = tx[i] + Math.sin(t * 14 + ph * 4) * 0.02;
          y = ty[i] + Math.sin(t * 11 + ph * 2.5) * 0.012;
          z = tz[i] + Math.cos(t * 12 + ph * 3) * 0.02;
          yaw[i] += dtC * (0.35 + 0.2 * Math.sin(t * 2 + ph));
          px[i] = x;
          py[i] = y;
          pz[i] = z;
          if (t >= perchUntil[i]) {
            state[i] = S_TAKEOFF;
            takeVy[i] = 1.1 + (ph % 1) * 0.6;
          }
        } else if (st === S_TAKEOFF) {
          y += takeVy[i] * dtC * 3.2;
          takeVy[i] -= dtC * 1.85;
          x += wdx * w * 0.08 * dtC;
          z += wdz * w * 0.08 * dtC;
          yaw[i] = Math.atan2(Math.sin(t * 3 + ph), Math.cos(t * 3 + ph));
          px[i] = x;
          py[i] = y;
          pz[i] = z;
          if (y > ty[i] + 2.2) {
            state[i] = S_FLY;
            nextTryT[i] = t + 4 + ((ph * 5.1) % 1) * 9;
          }
        }

        dummy.position.set(px[i], py[i], pz[i]);
        dummy.rotation.set(
          state[i] === S_PERCH ? -Math.PI * 0.45 : -0.12 + Math.sin(t * 22 + ph) * 0.08,
          yaw[i],
          Math.sin(t * 18 + ph * 2) * (state[i] === S_PERCH ? 0.04 : 0.12)
        );
        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
