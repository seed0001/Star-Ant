import * as THREE from "three";
import { Tree, TreePreset } from "@dgreenheck/ez-tree";
import { isTerrainDryAt, pickRandomDryXZ } from "./terrain-paint.js";

/** Preset names suitable for open-field trees (no trellis / training structures). */
export const TREE_FIELD_PRESET_NAMES = Object.keys(TreePreset).filter((k) => k !== "Trellis");

/** Uniform scale applied to each ez-tree in world units (matches settings UI + JSON). */
export const TREE_WORLD_SCALE_MIN = 0.03;
export const TREE_WORLD_SCALE_MAX = 2;

/**
 * Stable signature for rebuild when tree-related settings change.
 * @param {Record<string, unknown>} o normalized tree settings (count, preset, scale, seed, shape)
 */
export function treeForestSignature(o) {
  return JSON.stringify({
    treeCount: o.treeCount,
    treePreset: o.treePreset,
    treeScale: o.treeScale,
    treeFieldSeed: o.treeFieldSeed,
    treeSpecies: o.treeSpecies,
    treeTrunkRadius: o.treeTrunkRadius,
    treeTrunkLength: o.treeTrunkLength,
    treeBranchLevels: o.treeBranchLevels,
    treeChildrenTrunk: o.treeChildrenTrunk,
    treeChildrenBranch: o.treeChildrenBranch,
    treeChildrenSub: o.treeChildrenSub,
    treeCrownLengthMul: o.treeCrownLengthMul,
    treeLeafCount: o.treeLeafCount,
    treeLeafSize: o.treeLeafSize,
    treeLeafSizeVariance: o.treeLeafSizeVariance,
    treeLeafBillboard: o.treeLeafBillboard,
    treeBarkType: o.treeBarkType,
    treeLeafType: o.treeLeafType,
    treeBarkColor: o.treeBarkColor,
    treeLeafColor: o.treeLeafColor,
  });
}

/**
 * @param {string} hex
 * @returns {number}
 */
function hexToTreeTint(hex) {
  const s = (hex || "").replace("#", "").trim();
  if (s.length === 6) return parseInt(s, 16);
  if (s.length === 3) {
    return parseInt(
      s
        .split("")
        .map((c) => c + c)
        .join(""),
      16
    );
  }
  return 0xffffff;
}

/**
 * Apply procedural tree shape after `loadPreset` (ez-tree units).
 * @param {Tree} tree
 * @param {object} shape normalized tree shape (species, trunk, children, leaves, colors)
 */
export function applyTreeShapeOverrides(tree, shape) {
  const opt = tree.options;
  opt.type = shape.treeSpecies === "evergreen" ? "evergreen" : "deciduous";

  opt.bark.type = shape.treeBarkType;
  opt.bark.tint = hexToTreeTint(shape.treeBarkColor);

  opt.leaves.type = shape.treeLeafType;
  opt.leaves.tint = hexToTreeTint(shape.treeLeafColor);
  opt.leaves.count = Math.round(
    THREE.MathUtils.clamp(shape.treeLeafCount, 1, 200)
  );
  opt.leaves.size = THREE.MathUtils.clamp(shape.treeLeafSize, 0.35, 14);
  opt.leaves.sizeVariance = THREE.MathUtils.clamp(shape.treeLeafSizeVariance, 0, 1);
  opt.leaves.billboard =
    shape.treeLeafBillboard === "single" ? "single" : "double";

  const L = Math.max(0, Math.min(4, Math.floor(shape.treeBranchLevels)));
  opt.branch.levels = L;

  opt.branch.radius[0] = THREE.MathUtils.clamp(shape.treeTrunkRadius, 0.15, 10);
  opt.branch.length[0] = THREE.MathUtils.clamp(shape.treeTrunkLength, 4, 140);

  const mul = THREE.MathUtils.clamp(shape.treeCrownLengthMul, 0.2, 3);
  for (const k of [1, 2, 3]) {
    if (opt.branch.length[k] != null) {
      opt.branch.length[k] *= mul;
    }
  }

  const c0 = Math.max(1, Math.min(20, Math.round(shape.treeChildrenTrunk)));
  const c1 = Math.max(1, Math.min(20, Math.round(shape.treeChildrenBranch)));
  const c2 = Math.max(1, Math.min(20, Math.round(shape.treeChildrenSub)));
  opt.branch.children[0] = c0;
  opt.branch.children[1] = c1;
  opt.branch.children[2] = c2;
  opt.branch.children[3] = c2;
}

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
 * @param {THREE.Object3D} tree
 */
function disposeEzTreeResources(tree) {
  if (!(tree instanceof Tree)) return;
  tree.branchesMesh?.geometry?.dispose();
  const bMat = tree.branchesMesh?.material;
  if (Array.isArray(bMat)) bMat.forEach((m) => m.dispose());
  else bMat?.dispose();
  tree.leavesMesh?.geometry?.dispose();
  const lMat = tree.leavesMesh?.material;
  if (Array.isArray(lMat)) lMat.forEach((m) => m.dispose());
  else lMat?.dispose();
  if (tree.trellisMesh) {
    tree.remove(tree.trellisMesh);
    tree.trellisMesh.dispose?.();
    tree.trellisMesh = null;
  }
}

/**
 * Procedural trees (ez-tree) scattered on the ground plane.
 */
export class TreeForest {
  /**
   * @param {THREE.Scene} scene
   * @param {number} fieldSpread half-extent on X/Z (matches grass field)
   */
  constructor(scene, fieldSpread) {
    this.scene = scene;
    this.fieldSpread = fieldSpread;
    /** @type {THREE.Group | null} */
    this.group = null;
    /** @type {Tree[]} */
    this.trees = [];
    this._windDir = new THREE.Vector3(1, 0, 0);
  }

  /**
   * @param {object} opts
   * @param {number} opts.count
   * @param {string} opts.presetName key in {@link TreePreset}
   * @param {number} opts.scale uniform scale (ez-tree presets are large world units)
   * @param {number} opts.fieldSeed placement + per-tree seed derivation
   * @param {object} opts.shape normalized trunk / branch / leaf fields
   * @param {number} [opts.margin] inset from field edge
   * @param {number} [opts.minSpacing] minimum distance between trunk bases
   * @param {import("./terrain-paint.js").TerrainHeightField | null} [opts.terrain] ground heightmap for trunk base Y
   * @param {import("./terrain-paint.js").DryLandSpawnPoints | null} [opts.dryLand] precomputed dry cells (islands)
   */
  rebuild({ count, presetName, scale, fieldSeed, shape, margin = 10, minSpacing = 6, terrain = null, dryLand = null }) {
    this.clear();

    const safePreset =
      typeof presetName === "string" && TreePreset[presetName] !== undefined
        ? presetName
        : "Oak Medium";
    const n = Math.max(0, Math.min(48, Math.floor(count)));
    const s = THREE.MathUtils.clamp(scale, TREE_WORLD_SCALE_MIN, TREE_WORLD_SCALE_MAX);
    const seed = Math.floor(fieldSeed) >>> 0;

    if (n < 1) return;

    this.group = new THREE.Group();
    this.group.name = "TreeForest";

    const rng = mulberry32(seed);
    const spread = Math.max(1, this.fieldSpread - margin);
    /** @type {THREE.Vector2[]} */
    const placed = [];
    const minSq = minSpacing * minSpacing;

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
        let ok = true;
        for (let j = 0; j < placed.length; j++) {
          const dx = x - placed[j].x;
          const dz = z - placed[j].y;
          if (dx * dx + dz * dz < minSq) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        if (terrain && !isTerrainDryAt(terrain, x, z)) continue;
        found = true;
        break;
      }
      if (!found) continue;

      placed.push(new THREE.Vector2(x, z));

      const tree = new Tree();
      tree.loadPreset(safePreset);
      applyTreeShapeOverrides(tree, shape);
      tree.options.seed = (seed + i * 7919 + (i * i) % 9973) >>> 0;
      tree.generate();
      tree.scale.setScalar(s);
      const groundY = terrain ? terrain.getHeightBilinear(x, z) : 0;
      tree.position.set(x, groundY, z);
      tree.rotation.y = rng() * Math.PI * 2;
      tree.userData.trunkHeightApprox = shape.treeTrunkLength * s;

      this.group.add(tree);
      this.trees.push(tree);
    }

    this.scene.add(this.group);
  }

  /**
   * After terrain edits, move existing trunk bases to the new surface height (XZ unchanged).
   * @param {import("./terrain-paint.js").TerrainHeightField | null} terrain
   */
  syncTreeGroundHeight(terrain) {
    if (!terrain || this.trees.length < 1) return;
    for (const t of this.trees) {
      const y = terrain.getHeightBilinear(t.position.x, t.position.z);
      t.position.y = y;
    }
  }

  /**
   * Remove one procedural tree (e.g. after chopping) and dispose GPU resources.
   * @param {import("@dgreenheck/ez-tree").Tree} tree
   * @returns {boolean}
   */
  removeTree(tree) {
    const i = this.trees.indexOf(tree);
    if (i < 0 || !this.group) return false;
    this.group.remove(tree);
    disposeEzTreeResources(tree);
    this.trees.splice(i, 1);
    return true;
  }

  /**
   * World-space tree bases for placing critters (e.g. ladybugs on bark).
   * @returns {{ x: number, z: number, scale: number, trunkHeight: number }[]}
   */
  getTreePlacements() {
    return this.trees.map((t) => ({
      x: t.position.x,
      z: t.position.z,
      scale: t.scale.x,
      trunkHeight: typeof t.userData.trunkHeightApprox === "number" ? t.userData.trunkHeightApprox : t.scale.x * 8,
    }));
  }

  /**
   * Bark surface point for landing / walking (approximate cylinder).
   * @param {number} px
   * @param {number} pz
   * @param {number} py
   * @param {number} [maxGap] max horizontal gap outside trunk radius
   * @returns {{ treeX: number, treeZ: number, trunkR: number, surfaceX: number, surfaceZ: number, surfaceY: number } | null}
   */
  getNearestTrunkLanding(px, pz, py, maxGap = 0.55) {
    if (this.trees.length < 1) return null;
    const placements = this.getTreePlacements();
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const t of placements) {
      const dx = px - t.x;
      const dz = pz - t.z;
      const distH = Math.sqrt(dx * dx + dz * dz);
      const trunkR = Math.max(0.32, t.scale * 1.35);
      const outer = trunkR + maxGap;
      if (distH < trunkR - 0.04 || distH > outer) continue;
      if (py < 0.28 || py > t.trunkHeight * 0.9) continue;
      const score = Math.abs(distH - (trunkR + 0.06)) + Math.abs(py - t.trunkHeight * 0.45) * 0.02;
      if (score < bestScore) {
        bestScore = score;
        const ang = Math.atan2(dx, dz);
        const surfaceR = trunkR + 0.055;
        best = {
          treeX: t.x,
          treeZ: t.z,
          trunkR,
          trunkHeight: t.trunkHeight,
          surfaceX: t.x + Math.sin(ang) * surfaceR,
          surfaceZ: t.z + Math.cos(ang) * surfaceR,
          surfaceY: THREE.MathUtils.clamp(py, 0.35, t.trunkHeight * 0.88),
        };
      }
    }
    return best;
  }

  clear() {
    if (this.group) {
      this.scene.remove(this.group);
      for (const t of this.trees) {
        disposeEzTreeResources(t);
      }
      this.trees = [];
      this.group = null;
    }
  }

  /**
   * Leaf wind in ez-tree uses shader uniforms; scene wind feeds into uWindStrength / frequency.
   * @param {number} elapsedTime seconds
   * @param {number} windSpeed 0–4 (settings)
   * @param {number} windDirRad radians, same convention as grass
   */
  update(elapsedTime, windSpeed, windDirRad) {
    this._windDir.set(Math.cos(windDirRad), 0, Math.sin(windDirRad));
    const spd = THREE.MathUtils.clamp(windSpeed, 0, 4);
    const baseStr = 0.28 + spd * 0.55;
    const freq = 0.28 + spd * 0.55;

    for (let i = 0; i < this.trees.length; i++) {
      const tree = this.trees[i];
      tree.update(elapsedTime);
      const shader = tree.leavesMesh?.material?.userData?.shader;
      if (shader?.uniforms?.uWindStrength) {
        shader.uniforms.uWindStrength.value.set(
          this._windDir.x * baseStr,
          this._windDir.y * baseStr,
          this._windDir.z * baseStr
        );
      }
      if (shader?.uniforms?.uWindFrequency) {
        shader.uniforms.uWindFrequency.value = freq;
      }
    }
  }
}
