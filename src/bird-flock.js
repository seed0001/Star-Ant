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

const _FWD = new THREE.Vector3(1, 0, 0);
const _DIR = new THREE.Vector3();
const _Q = new THREE.Quaternion();

/**
 * Rebuild when count / presets / seed change. Terrain is intentionally omitted so painting
 * does not thrash GPU instance buffers every frame.
 * @param {object} o
 */
export function birdSignature(o) {
  return JSON.stringify({
    birdCount: finiteOr(o.birdCount, 0),
    birdPresets: o.birdPresets,
    birdSeed: finiteOr(o.birdSeed, 0),
  });
}

/** Bump when silhouette changes so hot reload picks up new merged mesh. */
const BIRD_GEO_REVISION = 2;
let _cachedBirdGeo = /** @type {THREE.BufferGeometry | null} */ (null);
let _cachedRevision = -1;

/**
 * Low-poly merged silhouette (body, head, beak, tail, wings) for instanced birds.
 * Faces +X (forward); flock code aligns +X with flight direction.
 */
export function buildBirdGeometry() {
  if (_cachedBirdGeo && _cachedRevision === BIRD_GEO_REVISION) return _cachedBirdGeo;

  // Fuselage: tapered body along +X
  const body = new THREE.ConeGeometry(0.12, 0.5, 6);
  body.rotateZ(-Math.PI / 2);
  body.translate(0.1, 0, 0);

  // Head
  const head = new THREE.SphereGeometry(0.075, 6, 5);
  head.translate(0.38, 0.025, 0);

  // Beak
  const beak = new THREE.ConeGeometry(0.03, 0.11, 5);
  beak.rotateZ(-Math.PI / 2);
  beak.translate(0.48, 0.02, 0);

  // Tail plane
  const tail = new THREE.BoxGeometry(0.1, 0.04, 0.2);
  tail.translate(-0.18, 0.05, 0);

  // Wings (slight dihedral read at distance)
  const wingL = new THREE.BoxGeometry(0.68, 0.038, 0.24);
  wingL.translate(0.06, 0.07, -0.3);
  const wingR = new THREE.BoxGeometry(0.68, 0.038, 0.24);
  wingR.translate(0.06, 0.07, 0.3);

  _cachedBirdGeo = mergeGeometries([body, head, beak, tail, wingL, wingR], true);
  _cachedRevision = BIRD_GEO_REVISION;
  return _cachedBirdGeo;
}

/**
 * GPU-instanced flock: land birds stay over dry ground; water birds skim above lakes.
 */
export class BirdFlock {
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
    this._rebuildGen = 0;
    /** @type {"land" | "water"} */
    this._habitat = "land";
    /**
     * @type {{
     *   mesh: THREE.InstancedMesh,
     *   phase: Float32Array,
     *   scale: Float32Array,
     *   px: Float32Array,
     *   py: Float32Array,
     *   pz: Float32Array,
     *   yaw: Float32Array,
     * } | null}
     */
    this._block = null;
    /** @type {import("./terrain-paint.js").TerrainHeightField | null} */
    this._terrain = null;
  }

  clear() {
    if (this.group) {
      this.scene.remove(this.group);
      const b = this._block;
      if (b) {
        b.mesh.material.dispose();
      }
      this._block = null;
      this.group = null;
    }
    this._terrain = null;
  }

  /**
   * @param {object} opts
   * @param {number} opts.total
   * @param {number} opts.seed
   * @param {string} opts.color
   * @param {"land" | "water"} opts.habitat
   * @param {import("./terrain-paint.js").TerrainHeightField | null} [opts.terrain]
   * @param {import("./terrain-paint.js").DryLandSpawnPoints | null} [opts.dryLand] land habitat only
   * @returns {boolean}
   */
  rebuild(opts) {
    const token = ++this._rebuildGen;
    this.clear();
    this._terrain = opts.terrain ?? null;
    this._habitat = opts.habitat === "water" ? "water" : "land";

    const geo = buildBirdGeometry();
    if (token !== this._rebuildGen) return false;
    this._geo = geo;

    const total = Math.max(0, Math.floor(opts.total));
    if (total < 1) return true;

    const rng = mulberry32(opts.seed >>> 0);
    const spread = this.fieldSpread * 0.96;
    const bound = spread * 0.99;
    const colStr = typeof opts.color === "string" ? opts.color : "#6a7a8a";

    this.group = new THREE.Group();
    this.group.name = this._habitat === "water" ? "Birds (water)" : "Birds (land)";

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.04,
      roughness: 0.78,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, total);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const phase = new Float32Array(total);
    const scale = new Float32Array(total);
    const px = new Float32Array(total);
    const py = new Float32Array(total);
    const pz = new Float32Array(total);
    const yaw = new Float32Array(total);

    const dummy = new THREE.Object3D();
    const tmpColor = new THREE.Color();

    const terrain = this._terrain;
    const wantDry = this._habitat === "land";

    for (let i = 0; i < total; i++) {
      let x = 0;
      let z = 0;
      let placed = false;
      for (let attempt = 0; attempt < 260; attempt++) {
        if (!terrain) {
          x = (rng() * 2 - 1) * spread;
          z = (rng() * 2 - 1) * spread;
          placed = true;
          break;
        }
        if (wantDry && opts.dryLand && opts.dryLand.length > 0) {
          const p = pickRandomDryXZ(opts.dryLand, terrain, rng);
          if (!p) continue;
          x = p.x;
          z = p.z;
        } else {
          x = (rng() * 2 - 1) * spread;
          z = (rng() * 2 - 1) * spread;
        }
        const dry = isTerrainDryAt(terrain, x, z);
        if (wantDry ? dry : !dry) {
          placed = true;
          break;
        }
      }
      if (!placed && terrain) {
        x = (rng() * 2 - 1) * spread * 0.2;
        z = (rng() * 2 - 1) * spread * 0.2;
      }

      const g = terrain ? terrain.getHeightBilinear(x, z) : 0;
      const w = terrain ? terrain.getWaterSurfaceHeightBilinear(x, z) : -999;
      let y;
      if (wantDry) {
        y = g + 4.2 + rng() * 7.5;
      } else {
        y = w + 1.1 + rng() * 3.8;
      }

      phase[i] = rng() * Math.PI * 2;
      scale[i] = 0.78 + rng() * 0.55;
      yaw[i] = rng() * Math.PI * 2;
      px[i] = x;
      py[i] = y;
      pz[i] = z;

      dummy.position.set(x, y, z);
      _DIR.set(Math.sin(yaw[i]), 0, Math.cos(yaw[i])).normalize();
      _Q.setFromUnitVectors(_FWD, _DIR);
      dummy.quaternion.copy(_Q);
      dummy.scale.setScalar(scale[i]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      tmpColor.set(colStr);
      mesh.setColorAt(i, tmpColor);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    this._block = { mesh, phase, scale, px, py, pz, yaw };

    if (token !== this._rebuildGen) return false;
    this.scene.add(this.group);
    return true;
  }

  /**
   * @param {number} t
   * @param {number} dt
   * @param {number} windSpeed
   * @param {number} windDirRad
   * @param {import("./terrain-paint.js").TerrainHeightField | null} terrain
   */
  update(t, dt, windSpeed, windDirRad, terrain) {
    const blk = this._block;
    if (!blk || !this.group) return;
    const dtC = Math.min(Math.max(dt, 0), 0.08);
    const wdx = Math.cos(windDirRad);
    const wdz = Math.sin(windDirRad);
    const w = windSpeed;
    const { mesh, phase, scale, px, py, pz, yaw } = blk;
    const n = mesh.count;
    const wantDry = this._habitat === "land";
    const dummy = new THREE.Object3D();
    const spread = this.fieldSpread * 0.96;
    const bound = spread * 0.99;

    for (let i = 0; i < n; i++) {
      const ph = phase[i];
      const sc = scale[i];
      let x = px[i];
      let z = pz[i];

      const wanderX =
        Math.sin(t * 0.52 + ph) * 1.15 + Math.sin(t * 1.05 + ph * 2.1) * 0.42 + wdx * w * 0.48;
      const wanderZ =
        Math.cos(t * 0.48 + ph * 1.15) * 1.12 + Math.cos(t * 0.98 + ph * 1.9) * 0.4 + wdz * w * 0.48;

      x += wanderX * dtC * 10;
      z += wanderZ * dtC * 10;

      if (x > bound) x = bound;
      else if (x < -bound) x = -bound;
      if (z > bound) z = bound;
      else if (z < -bound) z = -bound;

      if (terrain) {
        const dry = isTerrainDryAt(terrain, x, z);
        if (wantDry && !dry) {
          x += (-wdz * 28 + Math.sin(ph * 11.7) * 8) * dtC;
          z += (wdx * 28 + Math.cos(ph * 10.2) * 8) * dtC;
        } else if (!wantDry && dry) {
          x += (wdz * 26 + Math.sin(ph * 9.1) * 7) * dtC;
          z += (-wdx * 26 + Math.cos(ph * 8.4) * 7) * dtC;
        }
      }

      const g = terrain ? terrain.getHeightBilinear(x, z) : 0;
      const ws = terrain ? terrain.getWaterSurfaceHeightBilinear(x, z) : -999;
      let y;
      if (wantDry) {
        y =
          g +
          5.2 +
          Math.sin(t * 0.61 + ph * 0.92) * 2.4 +
          Math.sin(t * 1.85 + ph * 1.35) * 0.55;
        if (terrain && g < ws - 0.04) {
          y = ws + 5.2 + Math.sin(t * 0.61 + ph) * 1.2;
        }
      } else {
        y =
          ws +
          1.35 +
          Math.sin(t * 0.58 + ph * 1.05) * 0.95 +
          Math.sin(t * 1.72 + ph * 1.2) * 0.35;
      }

      const dx = wanderX * 0.14 + Math.sin(t * 0.38 + ph * 1.6) * 0.4;
      const dz = wanderZ * 0.14 + Math.cos(t * 0.36 + ph * 1.45) * 0.4;
      yaw[i] = Math.atan2(dx, dz);

      px[i] = x;
      py[i] = y;
      pz[i] = z;

      dummy.position.set(x, y, z);
      dummy.rotation.order = "YXZ";
      dummy.rotation.set(
        -0.12 + Math.sin(t * 22 + ph) * 0.2,
        yaw[i],
        Math.sin(t * 19 + ph * 2) * 0.14
      );
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
}
