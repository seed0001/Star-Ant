import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { isTerrainDryAt, pickRandomDryXZ } from "./terrain-paint.js";

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

/**
 * @param {object} o
 */
export function beeHiveSignature(o) {
  return JSON.stringify({
    hc: Math.floor(finiteOr(o.beeHiveCount, 0)),
    hs: Math.floor(finiteOr(o.beeHiveSeed, 19283)),
  });
}

/** Procedural stacked box + cone — one merged mesh per instance. */
function makeHiveGeometry() {
  const base = new THREE.BoxGeometry(0.55, 0.42, 0.55);
  base.translate(0, 0.21, 0);
  const mid = new THREE.BoxGeometry(0.62, 0.22, 0.62);
  mid.translate(0, 0.52, 0);
  const roof = new THREE.ConeGeometry(0.42, 0.38, 10);
  roof.translate(0, 0.88, 0);
  const g = mergeGeometries([base, mid, roof], false);
  g.computeVertexNormals();
  return g;
}

let _cachedHiveGeo = /** @type {THREE.BufferGeometry | null} */ (null);

function getHiveGeometry() {
  if (!_cachedHiveGeo) _cachedHiveGeo = makeHiveGeometry();
  return _cachedHiveGeo;
}

const PLACE_CELL = 2.1;
const BEE_HIVE_COUNT_MAX = 48;
const BEE_HIVE_MIN_SPACING = 6.5;

/**
 * Instanced beehive props on dry ground (colony anchor for bumblebee AI).
 */
export class BeeHiveField {
  /**
   * @param {THREE.Scene} scene
   * @param {number} fieldSpread
   */
  constructor(scene, fieldSpread) {
    this.scene = scene;
    this.fieldSpread = fieldSpread;
    /** @type {THREE.Group | null} */
    this.group = null;
    /** @type {THREE.InstancedMesh | null} */
    this.mesh = null;
    /** @type {{ x: number; y: number; z: number }[]} */
    this._positions = [];
  }

  /**
   * @returns {{ x: number; y: number; z: number }[]}
   */
  getHivePositions() {
    return this._positions;
  }

  /**
   * @param {object} opts
   * @param {number} opts.hiveCount
   * @param {number} opts.seed
   * @param {import("./terrain-paint.js").TerrainHeightField | null} [opts.terrain]
   * @param {import("./terrain-paint.js").DryLandSpawnPoints | null} [opts.dryLand]
   * @param {number} [opts.margin]
   */
  rebuild({ hiveCount, seed, terrain = null, dryLand = null, margin = 10 }) {
    this.clear();

    const n = Math.max(0, Math.min(BEE_HIVE_COUNT_MAX, Math.floor(hiveCount)));
    const sd = Math.floor(seed) >>> 0;
    if (n < 1) {
      this._positions = [];
      return;
    }

    const rng = mulberry32(sd);
    const spread = Math.max(1, this.fieldSpread - margin);
    const minSq = BEE_HIVE_MIN_SPACING * BEE_HIVE_MIN_SPACING;
    /** @type {Map<string, { x: number; z: number }[]>} */
    const grid = new Map();
    const cellKey = (ix, iz) => `${ix},${iz}`;
    const addToGrid = (x, z) => {
      const ix = Math.floor(x / PLACE_CELL);
      const iz = Math.floor(z / PLACE_CELL);
      const k = cellKey(ix, iz);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push({ x, z });
    };
    const cellRadius = Math.ceil(BEE_HIVE_MIN_SPACING / PLACE_CELL) + 1;
    const canPlace = (x, z) => {
      const ix0 = Math.floor(x / PLACE_CELL);
      const iz0 = Math.floor(z / PLACE_CELL);
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        for (let dz = -cellRadius; dz <= cellRadius; dz++) {
          const bucket = grid.get(cellKey(ix0 + dx, iz0 + dz));
          if (!bucket) continue;
          for (let bi = 0; bi < bucket.length; bi++) {
            const p = bucket[bi];
            const ddx = x - p.x;
            const ddz = z - p.z;
            if (ddx * ddx + ddz * ddz < minSq) return false;
          }
        }
      }
      return true;
    };

    this.group = new THREE.Group();
    this.group.name = "Bee hives";

    const geo = getHiveGeometry();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc9a050,
      roughness: 0.78,
      metalness: 0.06,
      envMapIntensity: 0.5,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = "BeeHives";

    const dummy = new THREE.Object3D();
    this._positions = [];

    for (let i = 0; i < n; i++) {
      let x = 0;
      let z = 0;
      let found = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        if (terrain && dryLand && dryLand.length > 0) {
          const p = pickRandomDryXZ(dryLand, terrain, rng);
          if (!p) continue;
          x = p.x;
          z = p.z;
        } else {
          x = (rng() * 2 - 1) * spread;
          z = (rng() * 2 - 1) * spread;
        }
        if (!canPlace(x, z)) continue;
        if (terrain && !isTerrainDryAt(terrain, x, z)) continue;
        found = true;
        break;
      }
      if (!found) {
        for (let attempt = 0; attempt < 100; attempt++) {
          x = (rng() * 2 - 1) * spread;
          z = (rng() * 2 - 1) * spread;
          if (canPlace(x, z)) {
            found = true;
            break;
          }
        }
      }
      if (!found) {
        x = (rng() * 2 - 1) * spread;
        z = (rng() * 2 - 1) * spread;
      }
      addToGrid(x, z);

      const yGround = terrain ? terrain.getHeightBilinear(x, z) : 0;
      const yaw = rng() * Math.PI * 2;
      const s = 0.95 + rng() * 0.18;
      dummy.position.set(x, yGround, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);

      this._positions.push({
        x,
        y: yGround + 0.05,
        z,
      });
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.mesh);
    this.scene.add(this.group);
  }

  /**
   * @param {import("./terrain-paint.js").TerrainHeightField | null} terrain
   */
  syncGroundHeight(terrain) {
    if (!terrain || !this.mesh || !this.group) return;
    const dummy = new THREE.Object3D();
    const n = this.mesh.count;
    for (let i = 0; i < n; i++) {
      this.mesh.getMatrixAt(i, dummy.matrix);
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
      const y = terrain.getHeightBilinear(dummy.position.x, dummy.position.z);
      dummy.position.y = y;
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      if (this._positions[i]) {
        this._positions[i].x = dummy.position.x;
        this._positions[i].y = y + 0.05;
        this._positions[i].z = dummy.position.z;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    if (this.group) {
      this.scene.remove(this.group);
      const m = this.mesh?.material;
      if (m) Array.isArray(m) ? m.forEach((x) => x.dispose()) : m.dispose();
      this.mesh = null;
      this.group = null;
    }
    this._positions = [];
  }
}

export { BEE_HIVE_COUNT_MAX };
