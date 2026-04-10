import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { splitCounts } from "./critters.js";
import { isTerrainDryAt, sampleLandXZForSpawn } from "./terrain-paint.js";

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
export function wormSignature(o) {
  return JSON.stringify({
    wormCount: o.wormCount,
    wormPresets: o.wormPresets,
    wormSeed: o.wormSeed,
  });
}

const WORM_SEGMENTS = 10;
const WORM_LENGTH = 0.14;
const WORM_MAX_RADIUS = 0.009;

/**
 * Procedural worm body: chain of tapered spheres along the local +X axis.
 * Each vertex carries `aSegmentT` (0 = tail, 1 = head) for the undulation shader.
 */
function createWormGeometry() {
  /** @type {THREE.BufferGeometry[]} */
  const parts = [];

  for (let s = 0; s < WORM_SEGMENTS; s++) {
    const t = s / (WORM_SEGMENTS - 1);
    const x = (t - 0.5) * WORM_LENGTH;

    // Smooth taper: thickest around 40-60% of body, thin at both tips
    const coreTaper = Math.sin(t * Math.PI);
    const headPinch = t > 0.85 ? 1.0 - ((t - 0.85) / 0.15) * 0.45 : 1.0;
    const tailPinch = t < 0.12 ? 0.55 + (t / 0.12) * 0.45 : 1.0;
    const radius = WORM_MAX_RADIUS * (coreTaper * 0.82 + 0.18) * headPinch * tailPinch;

    const seg = new THREE.SphereGeometry(radius, 8, 6);
    // Slightly squashed vertically so the worm is flatter against the ground
    seg.scale(1.0, 0.72, 1.0);
    seg.translate(x, WORM_MAX_RADIUS * 0.52, 0);

    const count = seg.attributes.position.count;
    const aSegT = new Float32Array(count);
    for (let i = 0; i < count; i++) aSegT[i] = t;
    seg.setAttribute("aSegmentT", new THREE.BufferAttribute(aSegT, 1));

    parts.push(seg);
  }

  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Patches a MeshStandardMaterial with the worm undulation vertex shader.
 * Traveling sine wave bends the body laterally and adds peristaltic compression.
 * @param {THREE.MeshStandardMaterial} mat
 */
function patchWormMaterial(mat) {
  mat.userData.wormUndulate = true;
  mat.flatShading = false;
  mat.roughness = 0.58;
  mat.metalness = 0.06;
  mat.emissive = new THREE.Color(0x3a2e28);
  mat.emissiveIntensity = 0.18;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uSlitherFreq = { value: 4.8 };
    shader.uniforms.uSlitherAmp = { value: 0.012 };
    shader.uniforms.uPeriFreq = { value: 6.2 };
    shader.uniforms.uPeriAmp = { value: 0.006 };

    shader.vertexShader =
      `attribute float aSegmentT;\n` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
      vec3 transformed = vec3(position);
      float segT = aSegmentT;
      float wTime = uTime;

      // Lateral slither: sine wave traveling head-to-tail
      float slither = sin(wTime * uSlitherFreq + segT * 9.4248) * uSlitherAmp;
      // Stronger at mid-body, weaker at endpoints (anchored head/tail)
      float envelope = sin(segT * 3.14159);
      transformed.z += slither * envelope;

      // Peristaltic compression: segments bunch and spread along body axis
      float peri = sin(wTime * uPeriFreq + segT * 12.5664) * uPeriAmp;
      transformed.x += peri * (segT - 0.5);

      // Subtle vertical hump during contraction peaks
      float hump = sin(wTime * uPeriFreq + segT * 12.5664 + 1.5708) * uPeriAmp * 0.35;
      transformed.y += max(0.0, hump);
      `
    );

    mat.userData.shader = shader;
  };

  mat.customProgramCacheKey = () => "worm_undulate_v1";
}

/**
 * @param {THREE.MeshStandardMaterial} mat
 * @param {number} t
 */
function updateWormUniforms(mat, t) {
  const shader = mat.userData.shader;
  if (!shader?.uniforms) return;
  const u = shader.uniforms;
  if (u.uTime) u.uTime.value = t;
}

/**
 * Ground-crawling worms — procedural segmented mesh, instanced per color preset.
 * Undulation is GPU-driven via a custom vertex shader; crawl paths are CPU-driven per instance.
 */
export class WormSwarm {
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
    /**
     * @type {{
     *   mesh: THREE.InstancedMesh,
     *   phase: Float32Array,
     *   scale: Float32Array,
     *   px: Float32Array,
     *   pz: Float32Array,
     *   head: Float32Array,
     * }[]}
     */
    this._blocks = [];
    /** @type {import("./terrain-paint.js").TerrainHeightField | null} */
    this._terrain = null;
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
   * @param {{ color: string, sharePercent: number }[]} opts.presets
   * @param {number} opts.seed
   * @param {import("./terrain-paint.js").TerrainHeightField | null} [opts.terrain]
   * @param {import("./terrain-paint.js").DryLandSpawnPoints | null} [opts.dryLand]
   * @returns {boolean}
   */
  rebuild(opts) {
    const token = ++this._rebuildGen;
    this.clear();
    this._terrain = opts.terrain ?? null;
    if (!this._geo) this._geo = createWormGeometry();

    const total = Math.max(0, Math.floor(opts.total));
    if (total < 1) return true;

    const presets =
      Array.isArray(opts.presets) && opts.presets.length > 0
        ? opts.presets
        : [{ color: "#8B6550", sharePercent: 100 }];
    const weights = presets.map((p) => finiteOr(p.sharePercent, 100));
    const counts = splitCounts(total, weights);

    const rng = mulberry32(opts.seed >>> 0);
    const spread = this.fieldSpread * 0.96;

    this.group = new THREE.Group();
    this.group.name = "Worms";

    const dummy = new THREE.Object3D();
    const tmpColor = new THREE.Color();

    for (let pi = 0; pi < presets.length; pi++) {
      const n = Math.max(0, counts[pi] ?? 0);
      if (n < 1) continue;

      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: false,
        metalness: 0.06,
        roughness: 0.58,
      });
      patchWormMaterial(mat);
      const mesh = new THREE.InstancedMesh(this._geo, mat, n);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const phase = new Float32Array(n);
      const scale = new Float32Array(n);
      const px = new Float32Array(n);
      const pz = new Float32Array(n);
      const head = new Float32Array(n);

      for (let i = 0; i < n; i++) {
        phase[i] = rng() * Math.PI * 2;
        scale[i] = 0.7 + rng() * 0.65;
        const land = sampleLandXZForSpawn(this._terrain, opts.dryLand, rng, spread);
        const x = land.x;
        const z = land.z;
        px[i] = x;
        pz[i] = z;
        const ry = rng() * Math.PI * 2;
        head[i] = ry;
        dummy.position.set(x, 0.004 + rng() * 0.006, z);
        dummy.rotation.set(0, ry, 0);
        dummy.scale.setScalar(scale[i]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        tmpColor.set(
          typeof presets[pi].color === "string" ? presets[pi].color : "#8B6550"
        );
        mesh.setColorAt(i, tmpColor);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this._blocks.push({ mesh, phase, scale, px, pz, head });
    }

    if (token !== this._rebuildGen) return false;
    this.scene.add(this.group);
    return true;
  }

  /**
   * Slow, sinuous ground crawl — updated every frame.
   * @param {number} t Elapsed time (s).
   * @param {number} dt Frame delta (s).
   */
  update(t, dt) {
    const dtC = Math.min(Math.max(dt, 0), 0.08);
    const spread = this.fieldSpread * 0.96;
    const bound = spread * 0.99;
    const dummy = new THREE.Object3D();

    for (let b = 0; b < this._blocks.length; b++) {
      const { mesh, phase, scale, px, pz, head } = this._blocks[b];

      // Drive the undulation shader
      const mat = mesh.material;
      if (
        mat instanceof THREE.MeshStandardMaterial &&
        mat.userData.wormUndulate
      ) {
        updateWormUniforms(mat, t);
      }

      const n = mesh.count;

      for (let i = 0; i < n; i++) {
        const ph = phase[i];
        const sc = scale[i];

        // Worms turn very slowly — long, lazy arcs
        const turn =
          0.65 * Math.sin(t * 0.34 + ph) +
          0.35 * Math.sin(t * 0.15 + ph * 1.7) +
          0.18 * Math.sin(t * 0.72 + ph * 2.9);
        head[i] += turn * dtC;

        // Slow forward pace with periodic pauses (worms stop and start)
        const pauseGate =
          0.5 + 0.5 * Math.sin(t * 0.28 + ph * 1.4);
        const pace =
          (0.035 +
            0.045 * (0.5 + 0.5 * Math.sin(t * 0.22 + ph * 2.3)) +
            0.02 * Math.sin(t * 0.58 + ph)) *
          pauseGate;

        px[i] += Math.sin(head[i]) * pace * dtC;
        pz[i] += Math.cos(head[i]) * pace * dtC;

        // Boundary wrapping
        if (px[i] > bound) {
          px[i] = bound;
          head[i] += Math.PI * 0.6 + 0.3 * Math.sin(t * 1.8 + ph);
        } else if (px[i] < -bound) {
          px[i] = -bound;
          head[i] += Math.PI * 0.6 + 0.3 * Math.sin(t * 1.8 + ph);
        }
        if (pz[i] > bound) {
          pz[i] = bound;
          head[i] += Math.PI * 0.6 + 0.3 * Math.cos(t * 1.9 + ph);
        } else if (pz[i] < -bound) {
          pz[i] = -bound;
          head[i] += Math.PI * 0.6 + 0.3 * Math.cos(t * 1.9 + ph);
        }

        // Avoid water
        if (this._terrain && !isTerrainDryAt(this._terrain, px[i], pz[i])) {
          head[i] +=
            (0.5 + 0.5 * Math.sin(t * 1.6 + ph * 3.1)) * Math.PI * 0.45;
        }

        // Very slight vertical bob — worms hug the ground
        const bob = Math.sin(t * 6 + ph * 3) * 0.003;
        const yy = 0.004 + bob;

        // Gentle body sway (roll)
        const roll = Math.sin(t * 3.5 + ph * 2.2) * 0.06;

        dummy.position.set(px[i], yy, pz[i]);
        dummy.rotation.set(0, head[i], roll);
        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
