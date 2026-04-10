import * as THREE from "three";
import { SimplexNoise } from "three/addons/math/SimplexNoise.js";
import { isTerrainDryAt, pickRandomDryXZ } from "./terrain-paint.js";

/**
 * @param {number} seed
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Smooth ~[-1, 1] FBM on the unit sphere (continuous → no “shattered” faces).
 * @param {SimplexNoise} noise
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
function fbmOnSphere(noise, x, y, z) {
  let v = 0;
  let a = 1;
  let f = 1;
  let w = 0;
  for (let o = 0; o < 4; o++) {
    v += a * noise.noise3d(x * f, y * f, z * f);
    w += a;
    a *= 0.52;
    f *= 2.08;
  }
  return w > 0 ? v / w : 0;
}

/**
 * Irregular rock mesh: subdivided icosphere + coherent radial displacement (FBM).
 * Higher `detail` = smoother silhouette; `displacement` scales bump strength.
 * @param {number} seed
 * @param {number} detail Icosahedron subdivision (2 = medium, 3 = smoother / heavier)
 * @param {number} displacement radial bump amount (typ. 0.08–0.16)
 */
function makeRockGeometry(seed, detail, displacement) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const next = mulberry32(seed);
  const noise = new SimplexNoise({ random: () => next() });
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;
    const n = fbmOnSphere(noise, nx, ny, nz);
    const r = 1 + displacement * n;
    pos.setXYZ(i, nx * r, ny * r, nz * r);
  }
  geo.computeVertexNormals();
  geo.normalizeNormals();
  return geo;
}

/**
 * @param {object} o
 */
export function rockFieldSignature(o) {
  return JSON.stringify({
    rc: Math.floor(finiteOr(o.rockCount, 0)),
    bc: Math.floor(finiteOr(o.boulderCount, 0)),
    rs: Math.floor(finiteOr(o.rockSeed, 28401)),
  });
}

function finiteOr(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

/** @param {0|1} a @param {0|1} b */
function minDistSqBetweenKinds(a, b, minSqR, minSqB) {
  return a === 0 && b === 0 ? minSqR : minSqB;
}

const PLACE_CELL = 1.25;

/**
 * Scattered procedural rocks + boulders on the ground (instanced meshes).
 */
export class RockField {
  /**
   * @param {THREE.Scene} scene
   * @param {number} fieldSpread half-extent on X/Z
   */
  constructor(scene, fieldSpread) {
    this.scene = scene;
    this.fieldSpread = fieldSpread;
    /** @type {THREE.Group | null} */
    this.group = null;
    /** @type {THREE.InstancedMesh | null} */
    this.rocksMesh = null;
    /** @type {THREE.InstancedMesh | null} */
    this.bouldersMesh = null;
  }

  /**
   * @param {object} opts
   * @param {number} opts.rockCount
   * @param {number} opts.boulderCount
   * @param {number} opts.seed
   * @param {import("./terrain-paint.js").TerrainHeightField | null} [opts.terrain]
   * @param {import("./terrain-paint.js").DryLandSpawnPoints | null} [opts.dryLand]
   * @param {number} [opts.margin]
   * @param {number} [opts.minSpacingRock]
   * @param {number} [opts.minSpacingBoulder]
   */
  rebuild({
    rockCount,
    boulderCount,
    seed,
    terrain = null,
    dryLand = null,
    margin = 8,
    minSpacingRock = 1.15,
    minSpacingBoulder = 5.5,
  }) {
    this.clear();

    const nr = Math.max(0, Math.min(ROCK_COUNT_MAX, Math.floor(rockCount)));
    const nb = Math.max(0, Math.min(BOULDER_COUNT_MAX, Math.floor(boulderCount)));
    const sd = Math.floor(seed) >>> 0;

    if (nr < 1 && nb < 1) return;

    const minSqR = minSpacingRock * minSpacingRock;
    const minSqB = minSpacingBoulder * minSpacingBoulder;
    /** @type {Map<string, { x: number; z: number; kind: 0 | 1 }[]>} */
    const grid = new Map();
    const cellKey = (ix, iz) => `${ix},${iz}`;
    const addToGrid = (x, z, kind) => {
      const ix = Math.floor(x / PLACE_CELL);
      const iz = Math.floor(z / PLACE_CELL);
      const k = cellKey(ix, iz);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push({ x, z, kind });
    };
    const cellRadius = Math.ceil(minSpacingBoulder / PLACE_CELL) + 1;
    const canPlace = (x, z, kind) => {
      const ix0 = Math.floor(x / PLACE_CELL);
      const iz0 = Math.floor(z / PLACE_CELL);
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        for (let dz = -cellRadius; dz <= cellRadius; dz++) {
          const bucket = grid.get(cellKey(ix0 + dx, iz0 + dz));
          if (!bucket) continue;
          for (let bi = 0; bi < bucket.length; bi++) {
            const p = bucket[bi];
            const need = minDistSqBetweenKinds(kind, p.kind, minSqR, minSqB);
            const ddx = x - p.x;
            const ddz = z - p.z;
            if (ddx * ddx + ddz * ddz < need) return false;
          }
        }
      }
      return true;
    };

    this.group = new THREE.Group();
    this.group.name = "Rocks";

    const spread = Math.max(1, this.fieldSpread - margin);

    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x6a635c,
      roughness: 0.88,
      metalness: 0.06,
      envMapIntensity: 0.45,
    });
    const boulderMat = new THREE.MeshStandardMaterial({
      color: 0x5c554e,
      roughness: 0.9,
      metalness: 0.05,
      envMapIntensity: 0.4,
    });

    if (nr > 0) {
      const rockGeo = makeRockGeometry(sd ^ 0x9e3779b9, 2, 0.11);
      const rng = mulberry32(sd);
      this.rocksMesh = new THREE.InstancedMesh(rockGeo, rockMat, nr);
      this.rocksMesh.castShadow = true;
      this.rocksMesh.receiveShadow = true;
      this.rocksMesh.name = "Rocks";
      this._fillInstances(
        this.rocksMesh,
        nr,
        rng,
        spread,
        terrain,
        0,
        canPlace,
        addToGrid,
        {
          yScale: [0.22, 0.55],
          xzScale: [0.35, 0.85],
        },
        dryLand
      );
      this.group.add(this.rocksMesh);
    }

    if (nb > 0) {
      const boulderGeo = makeRockGeometry((sd * 1103515245 + 12345) >>> 0, 3, 0.14);
      const rng2 = mulberry32((sd + 90210) >>> 0);
      this.bouldersMesh = new THREE.InstancedMesh(boulderGeo, boulderMat, nb);
      this.bouldersMesh.castShadow = true;
      this.bouldersMesh.receiveShadow = true;
      this.bouldersMesh.name = "Boulders";
      this._fillInstances(
        this.bouldersMesh,
        nb,
        rng2,
        spread,
        terrain,
        1,
        canPlace,
        addToGrid,
        {
          yScale: [0.85, 1.65],
          xzScale: [1.1, 2.35],
        },
        dryLand
      );
      this.group.add(this.bouldersMesh);
    }

    this.scene.add(this.group);
  }

  /**
   * @param {THREE.InstancedMesh} mesh
   * @param {number} count
   * @param {() => number} rng
   * @param {number} spread
   * @param {import("./terrain-paint.js").TerrainHeightField | null} terrain
   * @param {0|1} kind
   * @param {(x: number, z: number, k: 0|1) => boolean} canPlace
   * @param {(x: number, z: number, k: 0|1) => void} addToGrid
   * @param {{ yScale: [number, number], xzScale: [number, number] }} scaleRanges
   * @param {import("./terrain-paint.js").DryLandSpawnPoints | null} [dryLand]
   */
  _fillInstances(mesh, count, rng, spread, terrain, kind, canPlace, addToGrid, scaleRanges, dryLand = null) {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      let x = 0;
      let z = 0;
      let found = false;
      for (let attempt = 0; attempt < 160; attempt++) {
        if (terrain && dryLand && dryLand.length > 0) {
          const p = pickRandomDryXZ(dryLand, terrain, rng);
          if (!p) continue;
          x = p.x;
          z = p.z;
        } else {
          x = (rng() * 2 - 1) * spread;
          z = (rng() * 2 - 1) * spread;
        }
        if (!canPlace(x, z, kind)) continue;
        if (terrain && !isTerrainDryAt(terrain, x, z)) continue;
        found = true;
        break;
      }
      if (!found) {
        for (let attempt = 0; attempt < 80; attempt++) {
          x = (rng() * 2 - 1) * spread;
          z = (rng() * 2 - 1) * spread;
          if (canPlace(x, z, kind)) {
            found = true;
            break;
          }
        }
      }
      if (!found) {
        x = (rng() * 2 - 1) * spread;
        z = (rng() * 2 - 1) * spread;
      }

      addToGrid(x, z, kind);

      const yGround = terrain ? terrain.getHeightBilinear(x, z) : 0;
      const sx = THREE.MathUtils.lerp(scaleRanges.xzScale[0], scaleRanges.xzScale[1], rng());
      const sz = THREE.MathUtils.lerp(scaleRanges.xzScale[0], scaleRanges.xzScale[1], rng());
      const sy = THREE.MathUtils.lerp(scaleRanges.yScale[0], scaleRanges.yScale[1], rng());

      dummy.position.set(x, yGround + sy * 0.42, z);
      dummy.rotation.set(
        (rng() - 0.5) * 0.35,
        rng() * Math.PI * 2,
        (rng() - 0.5) * 0.35
      );
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * @param {import("./terrain-paint.js").TerrainHeightField | null} terrain
   */
  syncGroundHeight(terrain) {
    if (!terrain || !this.group) return;
    const dummy = new THREE.Object3D();
    const applyMesh = (mesh) => {
      if (!mesh) return;
      const n = mesh.count;
      for (let i = 0; i < n; i++) {
        mesh.getMatrixAt(i, dummy.matrix);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
        const y = terrain.getHeightBilinear(dummy.position.x, dummy.position.z);
        dummy.position.y = y + dummy.scale.y * 0.42;
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    applyMesh(this.rocksMesh);
    applyMesh(this.bouldersMesh);
  }

  clear() {
    if (this.group) {
      this.scene.remove(this.group);
      this.rocksMesh?.geometry?.dispose();
      const rm = this.rocksMesh?.material;
      if (rm) Array.isArray(rm) ? rm.forEach((m) => m.dispose()) : rm.dispose();
      this.bouldersMesh?.geometry?.dispose();
      const bm = this.bouldersMesh?.material;
      if (bm) Array.isArray(bm) ? bm.forEach((m) => m.dispose()) : bm.dispose();
      this.rocksMesh = null;
      this.bouldersMesh = null;
      this.group = null;
    }
  }
}

const ROCK_COUNT_MAX = 5000;
const BOULDER_COUNT_MAX = 160;

export { ROCK_COUNT_MAX, BOULDER_COUNT_MAX };
