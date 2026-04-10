import * as THREE from "three";
import { isTerrainDryAt } from "./terrain-paint.js";
import { fishEcosystemSignature, normalizeFishEcosystem } from "./fish-ecosystem.js";
import { normalizeFishDynamics } from "./fish-dynamics.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _CELL = 9;
const _dummy = new THREE.Object3D();

/**
 * @param {import("./terrain-paint.js").TerrainHeightField | null} terrain
 * @param {() => number} rng
 * @param {number} spread
 * @param {{ depthMinFrac: number, depthMaxFrac: number }} d
 */
function sampleUnderwater(terrain, rng, spread, d) {
  if (!terrain) return null;
  const minColumn = 0.06;
  for (let attempt = 0; attempt < 400; attempt++) {
    const x = (rng() * 2 - 1) * spread;
    const z = (rng() * 2 - 1) * spread;
    if (isTerrainDryAt(terrain, x, z)) continue;
    const g = terrain.getHeightBilinear(x, z);
    const w = terrain.getWaterSurfaceHeightBilinear(x, z);
    const column = w - g;
    if (column < minColumn) continue;
    const frac = rng() * (d.depthMaxFrac - d.depthMinFrac) + d.depthMinFrac;
    const y = g + column * frac;
    return { x, z, y, column, frac };
  }
  return null;
}

/**
 * @param {THREE.InstancedMesh} mesh
 * @param {number} i
 */
function hidePelletInstance(mesh, i) {
  _dummy.position.set(0, -9000, 0);
  _dummy.scale.setScalar(0);
  _dummy.updateMatrix();
  mesh.setMatrixAt(i, _dummy.matrix);
}

/**
 * @param {object} o
 * @param {string} terrainFingerprint
 */
export function fishFoodSignature(o, terrainFingerprint) {
  const e = normalizeFishEcosystem(o.fishEcosystem);
  const d = normalizeFishDynamics(o.fishDynamics);
  return JSON.stringify({
    eco: fishEcosystemSignature(e),
    depthMin: d.depthMinFrac,
    depthMax: d.depthMaxFrac,
    terrain: terrainFingerprint,
  });
}

/**
 * Orange (or custom) pellet specks; regenerates when eaten.
 */
export class FishFoodField {
  /**
   * @param {THREE.Scene} scene
   * @param {number} fieldSpread
   */
  constructor(scene, fieldSpread) {
    this.scene = scene;
    this.fieldSpread = fieldSpread;
    /** @type {THREE.InstancedMesh | null} */
    this.mesh = null;
    /** @type {THREE.Group | null} */
    this.group = null;
    /** @type {Float32Array | null} */
    this.px = null;
    /** @type {Float32Array | null} */
    this.py = null;
    /** @type {Float32Array | null} */
    this.pz = null;
    /** @type {Uint8Array | null} */
    this.active = null;
    /** @type {Float32Array | null} */
    this.phase = null;
    /** @type {number} */
    this._pendingRegen = 0;
    /** @type {number} */
    this._regenProgress = 0;
    /** @type {import("./terrain-paint.js").TerrainHeightField | null} */
    this._terrain = null;
    /** @type {import("./fish-ecosystem.js").FishEcosystemSettings} */
    this._eco = normalizeFishEcosystem({});
    /** @type {THREE.BufferGeometry | null} */
    this._geo = null;
    /** @type {number} */
    this._max = 0;
    /** @type {Map<string, number[]>} */
    this._buckets = new Map();
  }

  clear() {
    if (this.group) {
      this.scene.remove(this.group);
      this.mesh?.material.dispose();
      this.group = null;
      this.mesh = null;
    }
    this.px = null;
    this.py = null;
    this.pz = null;
    this.active = null;
    this.phase = null;
    this._pendingRegen = 0;
    this._regenProgress = 0;
    this._terrain = null;
    this._max = 0;
  }

  /**
   * @param {object} opts
   * @param {number} opts.count
   * @param {number} opts.seed
   * @param {import("./terrain-paint.js").TerrainHeightField | null} [opts.terrain]
   * @param {import("./fish-ecosystem.js").FishEcosystemSettings} [opts.ecosystem]
   * @param {{ depthMinFrac: number, depthMaxFrac: number }} [opts.depthRange]
   */
  rebuild(opts) {
    this.clear();
    this._terrain = opts.terrain ?? null;
    this._eco = normalizeFishEcosystem(opts.ecosystem);
    const total = Math.max(0, Math.floor(opts.count));
    if (total < 1) return true;

    const d = opts.depthRange ?? { depthMinFrac: 0.08, depthMaxFrac: 0.92 };
    const rng = mulberry32(opts.seed >>> 0);
    const spread = this.fieldSpread * 0.98;

    if (!this._geo) {
      this._geo = new THREE.IcosahedronGeometry(0.045, 0);
    }

    const col = new THREE.Color(
      typeof this._eco.pelletColor === "string" ? this._eco.pelletColor : "#ff8800"
    );
    const mat = new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: 0.35,
      metalness: 0.02,
      roughness: 0.55,
    });

    this.mesh = new THREE.InstancedMesh(this._geo, mat, total);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;

    this.px = new Float32Array(total);
    this.py = new Float32Array(total);
    this.pz = new Float32Array(total);
    this.active = new Uint8Array(total);
    this.phase = new Float32Array(total);
    this._max = total;
    this.active.fill(0);

    for (let i = 0; i < total; i++) {
      this.phase[i] = rng() * Math.PI * 2;
      const s = sampleUnderwater(this._terrain, rng, spread, d);
      if (!s) {
        hidePelletInstance(this.mesh, i);
        continue;
      }
      this.active[i] = 1;
      this.px[i] = s.x;
      this.py[i] = s.y;
      this.pz[i] = s.z;
      _dummy.position.set(this.px[i], this.py[i], this.pz[i]);
      _dummy.scale.setScalar(0.75 + rng() * 0.55);
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    this.group = new THREE.Group();
    this.group.name = "Fish food (pellets)";
    this.group.add(this.mesh);
    this.scene.add(this.group);
    this._rebuildBuckets();
    return true;
  }

  _cellKey(ix, iz) {
    return `${ix},${iz}`;
  }

  _rebuildBuckets() {
    this._buckets.clear();
    if (!this.px || !this.pz || !this.active) return;
    const n = this._max;
    for (let i = 0; i < n; i++) {
      if (!this.active[i]) continue;
      const ix = Math.floor(this.px[i] / _CELL);
      const iz = Math.floor(this.pz[i] / _CELL);
      const k = this._cellKey(ix, iz);
      let arr = this._buckets.get(k);
      if (!arr) {
        arr = [];
        this._buckets.set(k, arr);
      }
      arr.push(i);
    }
  }

  /**
   * @param {number} fx
   * @param {number} fz
   * @param {number} maxRange
   * @returns {{ dx: number, dy: number, dz: number, dist: number } | null}
   */
  getSteerTowardNearest(fx, fy, fz, maxRange) {
    if (!this.px || !this.py || !this.pz || !this.active) return null;
    const maxR2 = maxRange * maxRange;
    const ix = Math.floor(fx / _CELL);
    const iz = Math.floor(fz / _CELL);
    let best = -1;
    let bestD2 = maxR2;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const arr = this._buckets.get(this._cellKey(ix + ox, iz + oz));
        if (!arr) continue;
        for (let j = 0; j < arr.length; j++) {
          const i = arr[j];
          if (!this.active[i]) continue;
          const dx = this.px[i] - fx;
          const dy = this.py[i] - fy;
          const dz = this.pz[i] - fz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = i;
          }
        }
      }
    }
    if (best < 0) return null;
    const dx = this.px[best] - fx;
    const dy = this.py[best] - fy;
    const dz = this.pz[best] - fz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
    return { dx: dx / dist, dy: dy / dist, dz: dz / dist, dist };
  }

  /**
   * @param {number} fx
   * @param {number} fy
   * @param {number} fz
   * @param {number} radius
   * @returns {boolean}
   */
  tryConsumePellet(fx, fy, fz, radius) {
    if (!this.px || !this.py || !this.pz || !this.active || !this.mesh) return false;
    const r2 = radius * radius;
    const ix = Math.floor(fx / _CELL);
    const iz = Math.floor(fz / _CELL);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const arr = this._buckets.get(this._cellKey(ix + ox, iz + oz));
        if (!arr) continue;
        for (let j = 0; j < arr.length; j++) {
          const i = arr[j];
          const dx = fx - this.px[i];
          const dy = fy - this.py[i];
          const dz = fz - this.pz[i];
          if (dx * dx + dy * dy + dz * dz < r2) {
            this.active[i] = 0;
            this._pendingRegen += 1;
            _dummy.position.set(this.px[i], this.py[i], this.pz[i]);
            _dummy.scale.setScalar(0);
            _dummy.updateMatrix();
            this.mesh.setMatrixAt(i, _dummy.matrix);
            this.mesh.instanceMatrix.needsUpdate = true;
            return true;
          }
        }
      }
    }
    return false;
  }

  getActivePelletCount() {
    if (!this.active) return 0;
    let c = 0;
    for (let i = 0; i < this._max; i++) if (this.active[i]) c++;
    return c;
  }

  /**
   * @param {number} t
   * @param {number} dt
   * @param {number} windSpeed
   * @param {number} windDirRad
   * @param {{ depthMinFrac: number, depthMaxFrac: number }} depthRange
   */
  update(t, dt, windSpeed, windDirRad, depthRange) {
    if (!this.mesh || !this.px || !this.py || !this.pz || !this.active || !this.phase) return;
    const dtC = Math.min(Math.max(dt, 0), 0.08);
    const eco = this._eco;
    const wx = Math.cos(windDirRad) * windSpeed * 0.04;
    const wz = Math.sin(windDirRad) * windSpeed * 0.04;
    const spread = this.fieldSpread * 0.98;
    const rng = mulberry32((eco.pelletSeed ^ Math.floor(t * 3)) >>> 0);

    this._regenProgress += eco.pelletRegenPerSec * dtC;
    this._regenProgress = Math.min(this._regenProgress, 6);

    while (this._pendingRegen > 0 && this._regenProgress >= 1) {
      let idx = -1;
      for (let i = 0; i < this._max; i++) {
        if (!this.active[i]) {
          idx = i;
          break;
        }
      }
      if (idx < 0) break;
      const s = sampleUnderwater(this._terrain, rng, spread, depthRange);
      if (!s) {
        // No underwater spot (e.g. map has no excavated water) — try again later, do not place on land
        break;
      }
      this._regenProgress -= 1;
      this._pendingRegen -= 1;
      this.px[idx] = s.x;
      this.py[idx] = s.y;
      this.pz[idx] = s.z;
      this.active[idx] = 1;
    }

    const d = depthRange;
    for (let i = 0; i < this._max; i++) {
      if (!this.active[i]) continue;
      const ph = this.phase[i];
      this.px[i] += (wx + Math.sin(t * 0.4 + ph) * 0.012) * dtC;
      this.pz[i] += (wz + Math.cos(t * 0.37 + ph * 1.2) * 0.012) * dtC;
      const bob = Math.sin(t * 2.2 + ph * 3) * 0.018;
      const terrain = this._terrain;
      if (terrain) {
        const g = terrain.getHeightBilinear(this.px[i], this.pz[i]);
        const w = terrain.getWaterSurfaceHeightBilinear(this.px[i], this.pz[i]);
        const column = w - g;
        if (isTerrainDryAt(terrain, this.px[i], this.pz[i]) || column < 0.05) {
          const s = sampleUnderwater(terrain, rng, spread, d);
          if (s) {
            this.px[i] = s.x;
            this.py[i] = s.y + bob;
            this.pz[i] = s.z;
          } else {
            this.active[i] = 0;
            this._pendingRegen += 1;
            hidePelletInstance(this.mesh, i);
            continue;
          }
        } else {
          if (column > 0.08) {
            const frac = 0.35 + 0.3 * Math.sin(ph * 2 + t * 0.15);
            this.py[i] = g + column * THREE.MathUtils.clamp(frac, d.depthMinFrac, d.depthMaxFrac) + bob;
          } else {
            this.py[i] = g + column * 0.5 + bob;
          }
        }
      } else {
        this.py[i] += bob * dtC * 8;
      }
      const sc = 0.72 + 0.28 * Math.sin(ph * 1.7);
      _dummy.position.set(this.px[i], this.py[i], this.pz[i]);
      _dummy.scale.setScalar(sc);
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this._rebuildBuckets();
  }
}
