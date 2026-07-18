import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { isTerrainDryAt, sampleLandXZForSpawn } from "./terrain-paint.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { normalizeButterflyDynamics } from "./butterfly-dynamics.js";
import { applyButterflyMotion } from "./butterfly-motion.js";
import { updateProceduralInsectUniforms } from "./procedural-insect.js";

export const BUTTERFLY_FBX_URL = "/models/butterfly.fbx";

/**
 * Bake a flat vertex color onto a geometry, in linear space.
 *
 * These act as a mask rather than a final color: the instance color (the
 * user's preset) multiplies them, so 1.0 takes the preset hue at full strength
 * and near-0 stays dark whatever the preset is.
 *
 * @param {THREE.BufferGeometry} geo
 * @param {number} v linear grey level
 */
function paintGeometry(geo, v) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  arr.fill(v);
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Shell takes the preset color; everything else stays near-black. */
const LADYBUG_SHELL_TINT = 1;
const LADYBUG_DARK_TINT = 0.07;

// Scratch for trunk-crawl orientation — built per frame, never allocated.
const _lbUp = new THREE.Vector3();
const _lbFwd = new THREE.Vector3();
const _lbRight = new THREE.Vector3();
const _lbBasis = new THREE.Matrix4();
const _lbWobble = new THREE.Quaternion();
const _LB_AXIS_Z = new THREE.Vector3(0, 0, 1);

// Near-circular from above and tucked at the front: a ladybug is only a little
// longer than it is wide, unlike the ant's long body.
const SHELL_RX = 0.023;
const SHELL_RY = 0.0135;
const SHELL_RZ = 0.0205;
const SHELL_CY = 0.0145;
const SHELL_CZ = -0.003;

/**
 * Procedural ladybug: domed elytra with a seam and seven spots, black head and
 * pronotum, six legs and short antennae. Built +Z forward, +Y up, feet at y=0
 * so a plain yaw rotation aims it along its travel direction.
 */
function createLadybugBodyGeometry() {
  /** @type {THREE.BufferGeometry[]} */
  const parts = [];

  const shell = new THREE.SphereGeometry(1, 12, 8);
  shell.scale(SHELL_RX, SHELL_RY, SHELL_RZ);
  shell.translate(0, SHELL_CY, SHELL_CZ);
  parts.push(paintGeometry(shell, LADYBUG_SHELL_TINT));

  // Wafer-thin ellipsoid sharing the shell's curvature, so the seam tracks the
  // dome instead of poking through it at the ends like a straight bar would.
  const seam = new THREE.SphereGeometry(1, 4, 10);
  seam.scale(0.0016, SHELL_RY * 1.005, SHELL_RZ * 1.005);
  seam.translate(0, SHELL_CY, SHELL_CZ);
  parts.push(paintGeometry(seam, LADYBUG_DARK_TINT));

  const pronotum = new THREE.SphereGeometry(1, 8, 5);
  pronotum.scale(0.0165, 0.0085, 0.0075);
  pronotum.translate(0, 0.0125, 0.0155);
  parts.push(paintGeometry(pronotum, LADYBUG_DARK_TINT));

  const head = new THREE.SphereGeometry(1, 7, 5);
  head.scale(0.0095, 0.0065, 0.0058);
  head.translate(0, 0.0108, 0.0225);
  parts.push(paintGeometry(head, LADYBUG_DARK_TINT));

  // Classic seven-spot layout: one across the seam up front, three per elytron.
  // Positions are sampled on the shell ellipsoid, pulled slightly inward so the
  // spot spheres sit proud of the surface rather than floating.
  const spots = [
    { u: 0, v: 0.85 },
    { u: 0.9, v: 0.45 },
    { u: -0.9, v: 0.45 },
    { u: 1.45, v: 0.66 },
    { u: -1.45, v: 0.66 },
    { u: 2.5, v: 0.44 },
    { u: -2.5, v: 0.44 },
  ];
  for (const { u, v } of spots) {
    const k = 0.94;
    const cv = Math.cos(v);
    const spot = new THREE.SphereGeometry(0.0045, 5, 4);
    spot.scale(1, 0.6, 1);
    spot.translate(
      SHELL_RX * k * cv * Math.sin(u),
      SHELL_CY + SHELL_RY * k * Math.sin(v),
      SHELL_CZ + SHELL_RZ * k * cv * Math.cos(u)
    );
    parts.push(paintGeometry(spot, LADYBUG_DARK_TINT));
  }

  // Six short legs, splayed front / out / back, reaching down to y=0.
  const LEG_LEN = 0.0125;
  const legs = [
    { z: 0.010, spread: 0.95, sweep: -0.6 },
    { z: 0.002, spread: 1.05, sweep: 0.0 },
    { z: -0.006, spread: 0.98, sweep: 0.62 },
  ];
  for (const cfg of legs) {
    for (const side of [1, -1]) {
      const leg = new THREE.CylinderGeometry(0.001, 0.0006, LEG_LEN, 3);
      leg.translate(0, -LEG_LEN * 0.5, 0);
      leg.rotateZ(side * cfg.spread);
      leg.rotateX(cfg.sweep);
      leg.translate(side * 0.0068, 0.0078, cfg.z);
      parts.push(paintGeometry(leg, LADYBUG_DARK_TINT));
    }
  }

  const FEELER_LEN = 0.0075;
  for (const side of [1, -1]) {
    const feeler = new THREE.CylinderGeometry(0.0007, 0.0004, FEELER_LEN, 3);
    feeler.translate(0, FEELER_LEN * 0.5, 0);
    feeler.rotateZ(-side * 0.42);
    feeler.rotateX(1.0);
    feeler.translate(side * 0.003, 0.0125, 0.0262);
    parts.push(paintGeometry(feeler, LADYBUG_DARK_TINT));
  }

  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

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
function normalizeGeometry(geo, targetHeight, fitMaxDimension = false) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return;
  const size = new THREE.Vector3();
  bb.getSize(size);
  const cx = (bb.min.x + bb.max.x) * 0.5;
  const cz = (bb.min.z + bb.max.z) * 0.5;
  // Flat models (e.g. wings-spread butterfly) have tiny Y — fit their largest axis instead.
  const denom = fitMaxDimension
    ? Math.max(size.x, size.y, size.z, 1e-4)
    : Math.max(size.y, 1e-4);
  const s = targetHeight / denom;
  geo.translate(-cx, -bb.min.y, -cz);
  geo.scale(s, s, s);
  geo.computeVertexNormals();
  // FBX often ships black/empty vertex colors; with material.vertexColors + instanced tints they zero out albedo.
  if (geo.attributes.color) geo.deleteAttribute("color");
}

/**
 * @param {string} url
 * @param {number} targetHeight
 * @param {boolean} [fitMaxDimension] fit the largest axis to targetHeight instead of Y
 * @returns {Promise<THREE.BufferGeometry | null>}
 */
export async function loadCritterGeometry(url, targetHeight, fitMaxDimension = false) {
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
  normalizeGeometry(geo, targetHeight, fitMaxDimension);
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
    /** @type {Promise<THREE.BufferGeometry | null> | null} */
    this._loadPromise = null;
    /** Cancels stale async rebuilds when settings change faster than geometry finishes. */
    this._rebuildGen = 0;
    /** @type {{ mesh: THREE.InstancedMesh, phase: Float32Array, baseX: Float32Array, baseY: Float32Array, baseZ: Float32Array, scale: Float32Array }[]} */
    this._blocks = [];
    /** @type {import("./terrain-paint.js").TerrainHeightField | null} */
    this._terrain = null;
  }

  async ensureGeometry() {
    if (this._geo) return this._geo;
    if (!this._loadPromise) {
      this._loadPromise = loadCritterGeometry(BUTTERFLY_FBX_URL, 0.15, true);
    }
    this._geo = await this._loadPromise;
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
      if (token !== this._rebuildGen) return false;
      return true;
    }

    const geo = await this.ensureGeometry();
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
        metalness: 0.05,
        roughness: 0.7,
        side: THREE.DoubleSide,
      });
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
    if (!this._geo) this._geo = createLadybugBodyGeometry();
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

      // vertexColors must be on for the baked shell/dark mask to reach the
      // fragment shader — with it off, three ignores instance colors too, which
      // is why every ladybug used to render plain white.
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        metalness: 0.05,
        roughness: 0.62,
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
          // Legs are modelled down to y=0, so it only needs a hair of clearance.
          y = land.groundY + 0.0003;
          px[i] = x;
          pz[i] = z;
          ry = rng() * Math.PI * 2;
          head[i] = ry;
          rx = (rng() - 0.5) * 0.05;
          rz = (rng() - 0.5) * 0.05;
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
            // Struggling in the silk — a wider tumble than walking, but still
            // clear of the Euler singularity at ±PI/2.
            dummy.rotation.set(
              Math.sin(t * 8 + ph) * 0.5,
              Math.atan2(wx, wz + 1e-5) + t * 0.15 + ph,
              Math.sin(t * 16 + ph) * 0.45
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

          // Walking, not hopping: the old 0.018 bob was most of the body's
          // height, so they visibly bounced along the ground.
          const bob = Math.sin(t * 14 + ph * 4) * 0.0009;
          const sway = Math.sin(t * 11 + ph * 2.7) * 0.04;
          const gy = this._terrain
            ? this._terrain.getHeightBilinear(px[i], pz[i])
            : 0;
          const yy = gy + 0.0003 + bob;
          dummy.position.set(px[i], yy, pz[i]);
          dummy.rotation.set(
            sway * 0.35,
            head[i],
            Math.sin(t * 16 + ph) * 0.05
          );
        } else {
          const tCx = tcx[i];
          const tCz = tcz[i];
          const rad = trR[i];
          const tH = trH[i];
          const rootY = tBaseY[i];
          const maxY = rootY + Math.min(tH * 0.9, 14);

          const dTheta =
            0.22 + 0.12 * Math.sin(t * 0.48 + ph) + 0.08 * Math.sin(t * 0.17 + ph * 2);
          const dH =
            0.42 * Math.sin(t * 0.41 + ph * 1.6) + 0.28 * Math.sin(t * 0.19 + ph * 0.7);
          theta[i] += dtC * dTheta;
          h[i] += dtC * dH;
          h[i] = THREE.MathUtils.clamp(h[i], rootY + 0.05, maxY);

          const x = tCx + Math.cos(theta[i]) * rad;
          const z = tCz + Math.sin(theta[i]) * rad;

          // Clinging to a vertical trunk: the shell faces away from the bark and
          // the body points along the way it's actually crawling. Euler angles
          // can't express that without hitting gimbal lock, so build the basis.
          _lbUp.set(x - tCx, 0, z - tCz);
          if (_lbUp.lengthSq() < 1e-8) _lbUp.set(1, 0, 0);
          _lbUp.normalize();
          _lbFwd.set(
            -Math.sin(theta[i]) * dTheta * rad,
            dH,
            Math.cos(theta[i]) * dTheta * rad
          );
          if (_lbFwd.lengthSq() < 1e-8) _lbFwd.set(0, 1, 0);
          // Project the heading onto the bark plane so it stays flush.
          _lbFwd.addScaledVector(_lbUp, -_lbFwd.dot(_lbUp)).normalize();
          _lbRight.crossVectors(_lbUp, _lbFwd).normalize();
          _lbBasis.makeBasis(_lbRight, _lbUp, _lbFwd);

          dummy.position.set(x, h[i], z);
          dummy.quaternion.setFromRotationMatrix(_lbBasis);
          // Crawl wobble, applied about the body's own axis rather than by
          // poking rotation.z (which would round-trip through Euler angles).
          _lbWobble.setFromAxisAngle(_LB_AXIS_Z, Math.sin(t * 13 + ph * 1.3) * 0.05);
          dummy.quaternion.multiply(_lbWobble);
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
            // Struggling in the silk — a wider tumble than walking, but still
            // clear of the Euler singularity at ±PI/2.
            dummy.rotation.set(
              Math.sin(t * 8 + ph) * 0.5,
              Math.atan2(wx, wz + 1e-5) + t * 0.15 + ph,
              Math.sin(t * 16 + ph) * 0.45
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
          dummy.position.set(px[i], gy2 + 0.0003, pz[i]);
          dummy.rotation.set((rng() - 0.5) * 0.05, head[i], (rng() - 0.5) * 0.05);
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
