import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { isTerrainDryAt, sampleLandXZForSpawn } from "./terrain-paint.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { normalizeButterflyDynamics } from "./butterfly-dynamics.js";
import { applyButterflyMotion } from "./butterfly-motion.js";
import {
  buildProceduralButterflyGeometry,
  patchMaterialForProceduralInsect,
  proceduralGeometrySignature,
  updateProceduralInsectUniforms,
} from "./procedural-insect.js";

export const BUTTERFLY_FBX_URL = "/models/butterfly.fbx";
export const LADYBUG_FBX_URL = "/models/ladybug.fbx";

/**
 * @param {THREE.Object3D} root
 * @returns {THREE.BufferGeometry | null}
 */
function mergeMeshesFromFbx(root) {
  /** @type {THREE.BufferGeometry[]} */
  const parts = [];
  root.updateWorldMatrix(true, false);
  root.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const g = child.geometry.clone();
      child.updateWorldMatrix(true, false);
      g.applyMatrix4(child.matrixWorld);
      parts.push(g);
    }
  });
  if (parts.length < 1) return null;
  if (parts.length === 1) return parts[0];
  return mergeGeometries(parts, true);
}

/**
 * @param {THREE.BufferGeometry} geo
 * @param {number} targetHeight
 */
function normalizeGeometry(geo, targetHeight) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return;
  const size = new THREE.Vector3();
  bb.getSize(size);
  const cx = (bb.min.x + bb.max.x) * 0.5;
  const cz = (bb.min.z + bb.max.z) * 0.5;
  const s = targetHeight / Math.max(size.y, 1e-4);
  geo.translate(-cx, -bb.min.y, -cz);
  geo.scale(s, s, s);
  geo.computeVertexNormals();
  // FBX often ships black/empty vertex colors; with material.vertexColors + instanced tints they zero out albedo.
  if (geo.attributes.color) geo.deleteAttribute("color");
}

/**
 * @param {string} url
 * @param {number} targetHeight
 * @returns {Promise<THREE.BufferGeometry | null>}
 */
export async function loadCritterGeometry(url, targetHeight) {
  const loader = new FBXLoader();
  let fbx;
  try {
    fbx = await loader.loadAsync(url);
  } catch (e) {
    console.warn(`[critters] Failed to load FBX: ${url}`, e);
    return null;
  }
  const geo = mergeMeshesFromFbx(fbx);
  if (!geo) {
    console.warn(`[critters] No meshes in FBX: ${url}`);
    return null;
  }
  normalizeGeometry(geo, targetHeight);
  return geo;
}

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
 * @param {object} o
 */
export function butterflySignature(o) {
  const d = normalizeButterflyDynamics(o.butterflyDynamics);
  return JSON.stringify({
    butterflyCount: o.butterflyCount,
    butterflyPresets: o.butterflyPresets,
    butterflySeed: o.butterflySeed,
    bfHeightMin: d.heightMin,
    bfHeightMax: d.heightMax,
    bfFieldSpreadMul: d.fieldSpreadMul,
    bfScaleMin: d.scaleMin,
    bfScaleRange: d.scaleRange,
    procGeo: proceduralGeometrySignature(d),
  });
}

/**
 * Ladybugs depend on tree layout — pass the same treeForestSignature string used for trees.
 * @param {object} o
 * @param {string} treeSigStr
 */
export function ladybugSignature(o, treeSigStr) {
  return JSON.stringify({
    ladybugCount: o.ladybugCount,
    ladybugPresets: o.ladybugPresets,
    ladybugTreeShare: o.ladybugTreeShare,
    ladybugSeed: o.ladybugSeed,
    treeSig: treeSigStr,
  });
}

/**
 * @typedef {{ color: string, sharePercent: number }} CritterPreset
 */

/**
 * @param {number} total
 * @param {number[]} weights
 * @returns {number[]}
 */
export function splitCounts(total, weights) {
  const k = weights.length;
  const counts = new Array(k).fill(0);
  if (total < 1 || k < 1) return counts;
  const w = weights.map((x) => Math.max(0, x));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    counts[0] = total;
    return counts;
  }
  let left = total;
  for (let i = 0; i < k; i++) {
    const c = Math.round((total * w[i]) / sum);
    counts[i] = c;
    left -= c;
  }
  if (left !== 0) counts[0] += left;
  return counts;
}

/**
 * Flying insects — procedural frequency-generated mesh + instanced per color preset.
 */
export class ButterflySwarm {
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
    /** @type {string | null} */
    this._geoSig = null;
    /** Cancels stale async rebuilds when settings change faster than geometry finishes. */
    this._rebuildGen = 0;
    /** @type {{ mesh: THREE.InstancedMesh, phase: Float32Array, baseX: Float32Array, baseY: Float32Array, baseZ: Float32Array, scale: Float32Array }[]} */
    this._blocks = [];
    /** @type {import("./terrain-paint.js").TerrainHeightField | null} */
    this._terrain = null;
  }

  /**
   * @param {import("./butterfly-dynamics.js").ButterflyDynamics} dynamics
   */
  ensureGeometry(dynamics) {
    const dyn = normalizeButterflyDynamics(dynamics);
    const sig = proceduralGeometrySignature(dyn);
    if (this._geo && this._geoSig === sig) return this._geo;
    if (this._geo) {
      this._geo.dispose();
      this._geo = null;
    }
    this._geo = buildProceduralButterflyGeometry(dyn);
    this._geoSig = sig;
    return this._geo;
  }

  clear() {
    if (this.group) {
      this.scene.remove(this.group);
      // All InstancedMeshes share this._geo — never dispose that BufferGeometry per mesh (double-free corrupts it).
      this._blocks.forEach(({ mesh }) => {
        mesh.material.dispose();
      });
      this._blocks = [];
      this.group = null;
    }
    this._terrain = null;
  }

  /**
   * @param {object} opts
   * @param {number} opts.total
   * @param {CritterPreset[]} opts.presets
   * @param {number} opts.seed
   * @param {import("./butterfly-dynamics.js").ButterflyDynamics} [opts.dynamics]
   * @param {import("./terrain-paint.js").TerrainHeightField | null} [opts.terrain]
   * @param {import("./terrain-paint.js").DryLandSpawnPoints | null} [opts.dryLand]
   * @returns {Promise<boolean>} true if this invocation finished as the latest rebuild (caller may update last-signature)
   */
  async rebuild(opts) {
    const token = ++this._rebuildGen;
    this.clear();
    this._terrain = opts.terrain ?? null;
    const total = Math.max(0, Math.floor(opts.total));
    if (total < 1) {
      if (this._geo) {
        this._geo.dispose();
        this._geo = null;
        this._geoSig = null;
      }
      if (token !== this._rebuildGen) return false;
      return true;
    }

    const geo = this.ensureGeometry(opts.dynamics);
    if (token !== this._rebuildGen) return false;
    if (!geo) return false;

    const dyn = normalizeButterflyDynamics(opts.dynamics);

    const presets = Array.isArray(opts.presets) && opts.presets.length > 0 ? opts.presets : [{ color: "#ffaa44", sharePercent: 100 }];
    const weights = presets.map((p) => finiteOr(p.sharePercent, 100));
    const counts = splitCounts(total, weights);

    const rng = mulberry32(opts.seed >>> 0);
    const spread = this.fieldSpread * dyn.fieldSpreadMul;
    const yMin = dyn.heightMin;
    const yMax = dyn.heightMax;

    this.group = new THREE.Group();
    this.group.name = "Butterflies";

    const dummy = new THREE.Object3D();
    const tmpColor = new THREE.Color();

    for (let pi = 0; pi < presets.length; pi++) {
      const n = counts[pi] ?? 0;
      if (n < 1) continue;

      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: false,
        metalness: 0.12,
        roughness: 0.62,
      });
      patchMaterialForProceduralInsect(mat);
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const phase = new Float32Array(n);
      const baseX = new Float32Array(n);
      const baseY = new Float32Array(n);
      const baseZ = new Float32Array(n);
      const baseS = new Float32Array(n);

      for (let i = 0; i < n; i++) {
        const land = sampleLandXZForSpawn(this._terrain, opts.dryLand, rng, spread);
        const x = land.x;
        const z = land.z;
        const y = land.groundY + yMin + rng() * (yMax - yMin);
        baseX[i] = x;
        baseY[i] = y;
        baseZ[i] = z;
        phase[i] = rng() * Math.PI * 2;
        baseS[i] = dyn.scaleMin + rng() * dyn.scaleRange;
        dummy.position.set(x, y, z);
        dummy.rotation.set((rng() - 0.5) * 0.35, rng() * Math.PI * 2, (rng() - 0.5) * 0.35);
        dummy.scale.setScalar(baseS[i]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        tmpColor.set(typeof presets[pi].color === "string" ? presets[pi].color : "#ffaa44");
        mesh.setColorAt(i, tmpColor);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this._blocks.push({ mesh, phase, baseX, baseY, baseZ, scale: baseS });
    }

    if (token !== this._rebuildGen) return false;
    this.scene.add(this.group);
    return true;
  }

  /**
   * @param {number} t
   * @param {number} windSpeed
   * @param {number} windDirRad
   * @param {import("./butterfly-dynamics.js").ButterflyDynamics} [dynamics]
   */
  update(t, windSpeed, windDirRad, dynamics) {
    const dyn = normalizeButterflyDynamics(dynamics);
    const dummy = new THREE.Object3D();
    for (let b = 0; b < this._blocks.length; b++) {
      const { mesh, phase, baseX, baseY, baseZ, scale } = this._blocks[b];
      const mat = mesh.material;
      if (mat instanceof THREE.MeshStandardMaterial && mat.userData.proceduralInsect) {
        updateProceduralInsectUniforms(mat, t, windSpeed, dyn);
      }
      const n = mesh.count;
      for (let i = 0; i < n; i++) {
        const ph = phase[i];
        applyButterflyMotion(
          dummy,
          t,
          windSpeed,
          windDirRad,
          dynamics,
          baseX[i],
          baseY[i],
          baseZ[i],
          ph,
          scale[i]
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

function finiteOr(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

/**
 * Ladybugs on ground and on tree trunks.
 */
export class LadybugSwarm {
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
     *   mode: Uint8Array,
     *   phase: Float32Array,
     *   scale: Float32Array,
     *   px: Float32Array,
     *   pz: Float32Array,
     *   head: Float32Array,
     *   tcx: Float32Array,
     *   tcz: Float32Array,
     *   theta: Float32Array,
     *   h: Float32Array,
     *   trR: Float32Array,
     *   trH: Float32Array,
     *   snaredWeb: Int16Array,
     * }[]}
     */
    this._blocks = [];
    /** @type {import("./terrain-paint.js").TerrainHeightField | null} */
    this._terrain = null;
  }

  async ensureGeometry() {
    if (this._geo) return this._geo;
    if (!this._loadPromise) {
      this._loadPromise = loadCritterGeometry(LADYBUG_FBX_URL, 0.06);
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
  }

  /**
   * @param {object} opts
   * @param {number} opts.total
   * @param {CritterPreset[]} opts.presets
   * @param {number} opts.seed
   * @param {number} opts.treeShare
   * @param {{ x: number, z: number, baseY?: number, scale: number, trunkHeight: number }[]} opts.treePlacements
   * @param {import("./terrain-paint.js").TerrainHeightField | null} [opts.terrain]
   * @param {import("./terrain-paint.js").DryLandSpawnPoints | null} [opts.dryLand]
   * @returns {Promise<boolean>}
   */
  async rebuild(opts) {
    const token = ++this._rebuildGen;
    this.clear();
    this._terrain = opts.terrain ?? null;
    const geo = await this.ensureGeometry();
    if (token !== this._rebuildGen) return false;
    if (!geo) return false;

    const total = Math.max(0, Math.floor(opts.total));
    if (total < 1) return true;

    const presets = Array.isArray(opts.presets) && opts.presets.length > 0 ? opts.presets : [{ color: "#cc1122", sharePercent: 100 }];
    const weights = presets.map((p) => finiteOr(p.sharePercent, 100));
    const counts = splitCounts(total, weights);

    const treeShare = THREE.MathUtils.clamp(Number(opts.treeShare) || 0, 0, 1);
    const trees = Array.isArray(opts.treePlacements) ? opts.treePlacements : [];
    const rng = mulberry32(opts.seed >>> 0);
    const spread = this.fieldSpread * 0.95;

    this.group = new THREE.Group();
    this.group.name = "Ladybugs";

    const dummy = new THREE.Object3D();
    const tmpColor = new THREE.Color();

    for (let pi = 0; pi < presets.length; pi++) {
      const n = counts[pi] ?? 0;
      if (n < 1) continue;

      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: false,
        metalness: 0.05,
        roughness: 0.8,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const mode = new Uint8Array(n);
      const phase = new Float32Array(n);
      const scale = new Float32Array(n);
      const px = new Float32Array(n);
      const pz = new Float32Array(n);
      const head = new Float32Array(n);
      const tcx = new Float32Array(n);
      const tcz = new Float32Array(n);
      const theta = new Float32Array(n);
      const h = new Float32Array(n);
      const trR = new Float32Array(n);
      const trH = new Float32Array(n);
      const tBaseY = new Float32Array(n);
      const snaredWeb = new Int16Array(n);
      snaredWeb.fill(-1);

      for (let i = 0; i < n; i++) {
        const onTree = trees.length > 0 && rng() < treeShare;
        phase[i] = rng() * Math.PI * 2;
        scale[i] = 0.85 + rng() * 0.35;
        let x;
        let z;
        let y;
        let rx;
        let ry;
        let rz;
        if (onTree) {
          mode[i] = 1;
          const tr = trees[Math.floor(rng() * trees.length)];
          const th = tr.trunkHeight;
          const rootY = typeof tr.baseY === "number" ? tr.baseY : 0;
          tBaseY[i] = rootY;
          const ang = rng() * Math.PI * 2;
          const rad = tr.scale * (0.32 + rng() * 0.42);
          x = tr.x + Math.cos(ang) * rad;
          z = tr.z + Math.sin(ang) * rad;
          y = rootY + 0.05 + rng() * Math.min(th * 0.88, 14);
          tcx[i] = tr.x;
          tcz[i] = tr.z;
          theta[i] = ang;
          h[i] = y;
          trR[i] = rad;
          trH[i] = th;
          const dx = x - tr.x;
          const dz = z - tr.z;
          ry = Math.atan2(dx, dz) + Math.PI * 0.5;
          rx = -0.85 + (rng() - 0.5) * 0.25;
          rz = (rng() - 0.5) * 0.35;
        } else {
          mode[i] = 0;
          const land = sampleLandXZForSpawn(this._terrain, opts.dryLand, rng, spread);
          x = land.x;
          z = land.z;
          y = land.groundY + 0.02 + rng() * 0.025;
          px[i] = x;
          pz[i] = z;
          ry = rng() * Math.PI * 2;
          head[i] = ry;
          rx = -Math.PI * 0.5 + (rng() - 0.5) * 0.12;
          rz = (rng() - 0.5) * 0.25;
        }
        dummy.position.set(x, y, z);
        dummy.rotation.set(rx, ry, rz);
        dummy.scale.setScalar(scale[i]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        tmpColor.set(typeof presets[pi].color === "string" ? presets[pi].color : "#cc1122");
        mesh.setColorAt(i, tmpColor);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this._blocks.push({
        mesh,
        mode,
        phase,
        scale,
        px,
        pz,
        head,
        tcx,
        tcz,
        theta,
        h,
        trR,
        trH,
        tBaseY,
        snaredWeb,
      });
    }

    if (token !== this._rebuildGen) return false;
    this.scene.add(this.group);
    return true;
  }

  /**
   * Ground wander + trunk crawl (updated every frame).
   * @param {number} t Elapsed time (s).
   * @param {number} dt Frame delta (s).
   * @param {{ x: number, y: number, z: number, radius: number }[] | null | undefined} spiderZones
   */
  update(t, dt, spiderZones) {
    const dtC = Math.min(Math.max(dt, 0), 0.08);
    const spread = this.fieldSpread * 0.95;
    const bound = spread * 0.98;
    const dummy = new THREE.Object3D();

    for (let b = 0; b < this._blocks.length; b++) {
      const blk = this._blocks[b];
      const {
        mesh,
        mode,
        phase,
        scale,
        px,
        pz,
        head,
        tcx,
        tcz,
        theta,
        h,
        trR,
        trH,
        tBaseY,
        snaredWeb,
      } = blk;
      const n = mesh.count;

      for (let i = 0; i < n; i++) {
        const ph = phase[i];
        const sc = scale[i];

        if (snaredWeb[i] >= 0) {
          const z = spiderZones?.[snaredWeb[i]];
          if (!z) {
            snaredWeb[i] = -1;
          } else {
            const wx = Math.sin(t * 14 + ph * 4) * 0.04;
            const wy = Math.sin(t * 11 + ph * 2.7) * 0.03;
            const wz = Math.cos(t * 12 + ph * 3) * 0.04;
            dummy.position.set(z.x + wx, z.y + wy, z.z + wz);
            dummy.rotation.set(
              -Math.PI * 0.5 + Math.sin(t * 8 + ph) * 0.15,
              Math.atan2(wx, wz + 1e-5) + t * 0.15 + ph,
              Math.sin(t * 16 + ph) * 0.12
            );
            dummy.scale.setScalar(sc);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            continue;
          }
        }

        if (mode[i] === 0) {
          const turn =
            1.15 * Math.sin(t * 0.62 + ph) +
            0.55 * Math.sin(t * 0.27 + ph * 1.9) +
            0.35 * Math.sin(t * 1.1 + ph * 3.2);
          head[i] += turn * dtC;
          const pace =
            0.11 +
            0.14 * (0.5 + 0.5 * Math.sin(t * 0.38 + ph * 2.1)) +
            0.06 * Math.sin(t * 0.91 + ph);
          px[i] += Math.sin(head[i]) * pace * dtC;
          pz[i] += Math.cos(head[i]) * pace * dtC;

          if (px[i] > bound) {
            px[i] = bound;
            head[i] += Math.PI * 0.65 + 0.4 * Math.sin(t * 2 + ph);
          } else if (px[i] < -bound) {
            px[i] = -bound;
            head[i] += Math.PI * 0.65 + 0.4 * Math.sin(t * 2 + ph);
          }
          if (pz[i] > bound) {
            pz[i] = bound;
            head[i] += Math.PI * 0.65 + 0.4 * Math.cos(t * 2.1 + ph);
          } else if (pz[i] < -bound) {
            pz[i] = -bound;
            head[i] += Math.PI * 0.65 + 0.4 * Math.cos(t * 2.1 + ph);
          }

          if (this._terrain && !isTerrainDryAt(this._terrain, px[i], pz[i])) {
            head[i] += (0.55 + 0.45 * Math.sin(t * 2.1 + ph * 3.7)) * Math.PI * 0.42;
          }

          const bob = Math.sin(t * 14 + ph * 4) * 0.018;
          const sway = Math.sin(t * 11 + ph * 2.7) * 0.04;
          const gy = this._terrain
            ? this._terrain.getHeightBilinear(px[i], pz[i])
            : 0;
          const yy = gy + 0.02 + bob;
          dummy.position.set(px[i], yy, pz[i]);
          dummy.rotation.set(
            -Math.PI * 0.5 + sway * 0.35,
            head[i],
            Math.sin(t * 16 + ph) * 0.07
          );
        } else {
          const tCx = tcx[i];
          const tCz = tcz[i];
          const rad = trR[i];
          const tH = trH[i];
          const rootY = tBaseY[i];
          const maxY = rootY + Math.min(tH * 0.9, 14);

          theta[i] += dtC * (0.22 + 0.12 * Math.sin(t * 0.48 + ph) + 0.08 * Math.sin(t * 0.17 + ph * 2));
          h[i] += dtC * (0.42 * Math.sin(t * 0.41 + ph * 1.6) + 0.28 * Math.sin(t * 0.19 + ph * 0.7));
          h[i] = THREE.MathUtils.clamp(h[i], rootY + 0.05, maxY);

          const x = tCx + Math.cos(theta[i]) * rad;
          const z = tCz + Math.sin(theta[i]) * rad;
          const dx = x - tCx;
          const dz = z - tCz;
          const ry = Math.atan2(dx, dz) + Math.PI * 0.5;
          const wiggle = Math.sin(t * 10 + ph * 2) * 0.07;
          const rx = -0.85 + wiggle;
          const rz = Math.sin(t * 13 + ph * 1.3) * 0.08;

          dummy.position.set(x, h[i], z);
          dummy.rotation.set(rx, ry, rz);
        }

        if (snaredWeb[i] < 0 && spiderZones && spiderZones.length > 0) {
          const wx = dummy.position.x;
          const wy = dummy.position.y;
          const wz = dummy.position.z;
          for (let zi = 0; zi < spiderZones.length; zi++) {
            const z = spiderZones[zi];
            const dx = wx - z.x;
            const dy = wy - z.y;
            const dz = wz - z.z;
            const r = z.radius;
            if (dx * dx + dy * dy + dz * dz < r * r) {
              snaredWeb[i] = zi;
              break;
            }
          }
        }

        if (snaredWeb[i] >= 0) {
          const z = spiderZones?.[snaredWeb[i]];
          if (z) {
            const wx = Math.sin(t * 14 + ph * 4) * 0.04;
            const wy = Math.sin(t * 11 + ph * 2.7) * 0.03;
            const wz = Math.cos(t * 12 + ph * 3) * 0.04;
            dummy.position.set(z.x + wx, z.y + wy, z.z + wz);
            dummy.rotation.set(
              -Math.PI * 0.5 + Math.sin(t * 8 + ph) * 0.15,
              Math.atan2(wx, wz + 1e-5) + t * 0.15 + ph,
              Math.sin(t * 16 + ph) * 0.12
            );
          } else {
            snaredWeb[i] = -1;
          }
        }

        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Ground ladybugs in flooded areas: fish can eat one near (fx,fy,fz); bug respawns on dry land.
   * @param {number} fx
   * @param {number} fy
   * @param {number} fz
   * @param {number} radius
   * @param {import("./terrain-paint.js").TerrainHeightField | null} terrain
   * @returns {boolean}
   */
  tryConsumeLadybugForFish(fx, fy, fz, radius, terrain) {
    if (!terrain) return false;
    const r2 = radius * radius;
    const rng = mulberry32((fx * 73856093 + fz * 19349663 + fy * 83492791) >>> 0);
    const spread = this.fieldSpread * 0.95;
    const dummy = new THREE.Object3D();

    for (let b = 0; b < this._blocks.length; b++) {
      const blk = this._blocks[b];
      const { mesh, mode, px, pz, head, scale, phase } = blk;
      const n = mesh.count;
      for (let i = 0; i < n; i++) {
        if (mode[i] !== 0) continue;
        if (isTerrainDryAt(terrain, px[i], pz[i])) continue;
        const g = terrain.getHeightBilinear(px[i], pz[i]);
        const w = terrain.getWaterSurfaceHeightBilinear(px[i], pz[i]);
        if (w - g < 0.1) continue;
        const gy = terrain.getHeightBilinear(px[i], pz[i]);
        const yy = gy + 0.02 + Math.sin(phase[i] * 4) * 0.018;
        if (Math.abs(px[i] - fx) + Math.abs(pz[i] - fz) > 28) continue;
        const dx = fx - px[i];
        const dy = fy - yy;
        const dz = fz - pz[i];
        if (dx * dx + dy * dy + dz * dz >= r2) continue;

        for (let attempt = 0; attempt < 140; attempt++) {
          const nx = (rng() * 2 - 1) * spread;
          const nz = (rng() * 2 - 1) * spread;
          if (!isTerrainDryAt(terrain, nx, nz)) continue;
          px[i] = nx;
          pz[i] = nz;
          head[i] = rng() * Math.PI * 2;
          const gy2 = terrain.getHeightBilinear(px[i], pz[i]);
          dummy.position.set(px[i], gy2 + 0.02 + Math.sin(phase[i] * 4) * 0.018, pz[i]);
          dummy.rotation.set(
            -Math.PI * 0.5 + (rng() - 0.5) * 0.12,
            head[i],
            (rng() - 0.5) * 0.25
          );
          dummy.scale.setScalar(scale[i]);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          mesh.instanceMatrix.needsUpdate = true;
          return true;
        }
        return false;
      }
    }
    return false;
  }
}
