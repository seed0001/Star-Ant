import * as THREE from "three";
import { splitCounts } from "./critters.js";
import { isTerrainDryAt } from "./terrain-paint.js";
import { normalizeFishDynamics } from "./fish-dynamics.js";
import { buildFishGeometry, proceduralFishSignature } from "./procedural-fish.js";
import { normalizeFishEcosystem } from "./fish-ecosystem.js";

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
const _QPR = new THREE.Quaternion();
const _STEER = new THREE.Vector3();

function angleWrap(d) {
  let x = d;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/**
 * @param {object} o
 * @param {string} terrainFingerprint
 */
export function fishSignature(o, terrainFingerprint) {
  const d = normalizeFishDynamics(o.fishDynamics);
  return JSON.stringify({
    fishCount: o.fishCount,
    fishPresets: o.fishPresets,
    fishSeed: o.fishSeed,
    fishGeom: proceduralFishSignature(d),
    terrain: terrainFingerprint,
  });
}

/**
 * Procedural lake fish — spawned only where terrain is underwater; swim in the water column.
 */
export class FishSwarm {
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
    /** @type {string} */
    this._geoSig = "";
    this._rebuildGen = 0;
    /**
     * @type {{
     *   mesh: THREE.InstancedMesh,
     *   phase: Float32Array,
     *   scale: Float32Array,
     *   px: Float32Array,
     *   py: Float32Array,
     *   pz: Float32Array,
     *   yaw: Float32Array,
     *   depthFrac: Float32Array,
     *   health: Float32Array,
     * }[]}
     */
    this._blocks = [];
    /** @type {import("./terrain-paint.js").TerrainHeightField | null} */
    this._terrain = null;
    /** @type {import("./fish-dynamics.js").FishDynamics} */
    this._dynamics = normalizeFishDynamics({});
    /** @type {{ living: number, total: number, meanHealth: number }} */
    this.lastEcosystemStats = { living: 0, total: 0, meanHealth: 0 };
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
    if (this._geo) {
      this._geo.dispose();
      this._geo = null;
      this._geoSig = "";
    }
    this._terrain = null;
  }

  /**
   * @param {import("./terrain-paint.js").TerrainHeightField | null} terrain
   * @param {() => { x: number, z: number, y: number } | null} rng
   */
  _sampleUnderwater(terrain, rng, spread, d) {
    if (!terrain) return null;
    for (let attempt = 0; attempt < 220; attempt++) {
      const x = (rng() * 2 - 1) * spread;
      const z = (rng() * 2 - 1) * spread;
      if (isTerrainDryAt(terrain, x, z)) continue;
      const g = terrain.getHeightBilinear(x, z);
      const w = terrain.getWaterSurfaceHeightBilinear(x, z);
      const column = w - g;
      if (column < 0.08) continue;
      const frac = rng() * (d.depthMaxFrac - d.depthMinFrac) + d.depthMinFrac;
      const y = g + column * frac;
      return { x, z, y, column, frac };
    }
    return null;
  }

  /**
   * @param {object} opts
   * @param {number} opts.total
   * @param {{ color: string, sharePercent: number }[]} opts.presets
   * @param {number} opts.seed
   * @param {import("./fish-dynamics.js").FishDynamics} [opts.dynamics]
   * @param {import("./terrain-paint.js").TerrainHeightField | null} [opts.terrain]
   * @returns {boolean}
   */
  rebuild(opts) {
    const token = ++this._rebuildGen;
    this.clear();
    this._terrain = opts.terrain ?? null;
    const d = normalizeFishDynamics(opts.dynamics);
    this._dynamics = d;

    const sig = proceduralFishSignature(d);
    const geo = buildFishGeometry(d);
    if (token !== this._rebuildGen) return false;
    this._geo = geo;
    this._geoSig = sig;

    const total = Math.max(0, Math.floor(opts.total));
    if (total < 1) return true;

    const presets =
      Array.isArray(opts.presets) && opts.presets.length > 0
        ? opts.presets
        : [{ color: "#4a8fbe", sharePercent: 100 }];
    const weights = presets.map((p) => finiteOr(p.sharePercent, 100));
    const counts = splitCounts(total, weights);

    const rng = mulberry32(opts.seed >>> 0);
    const spread = this.fieldSpread * 0.98;

    this.group = new THREE.Group();
    this.group.name = "Fish (lake)";

    const dummy = new THREE.Object3D();
    const tmpColor = new THREE.Color();

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: false,
      metalness: 0.06,
      roughness: 0.42,
      emissive: new THREE.Color(0x0a1020),
      emissiveIntensity: d.emissive,
    });

    for (let pi = 0; pi < presets.length; pi++) {
      const n = Math.max(0, counts[pi] ?? 0);
      if (n < 1) continue;

      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const phase = new Float32Array(n);
      const scale = new Float32Array(n);
      const px = new Float32Array(n);
      const py = new Float32Array(n);
      const pz = new Float32Array(n);
      const yaw = new Float32Array(n);
      const depthFrac = new Float32Array(n);
      const health = new Float32Array(n);
      health.fill(1);

      for (let i = 0; i < n; i++) {
        const sample = this._sampleUnderwater(this._terrain, rng, spread, d);
        phase[i] = rng() * Math.PI * 2;
        scale[i] = 0.85 + rng() * 0.45;
        yaw[i] = rng() * Math.PI * 2;
        if (!sample) {
          px[i] = (rng() * 2 - 1) * spread * 0.1;
          pz[i] = (rng() * 2 - 1) * spread * 0.1;
          py[i] = 0.5;
          depthFrac[i] = 0.5;
        } else {
          px[i] = sample.x;
          py[i] = sample.y;
          pz[i] = sample.z;
          depthFrac[i] = sample.frac;
        }

        dummy.position.set(px[i], py[i], pz[i]);
        _DIR.set(Math.sin(yaw[i]), 0, Math.cos(yaw[i])).normalize();
        _Q.setFromUnitVectors(_FWD, _DIR);
        dummy.quaternion.copy(_Q);
        dummy.scale.setScalar(scale[i]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        tmpColor.set(typeof presets[pi].color === "string" ? presets[pi].color : "#4a8fbe");
        mesh.setColorAt(i, tmpColor);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this._blocks.push({ mesh, phase, scale, px, py, pz, yaw, depthFrac, health });
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
   * @param {import("./fish-food.js").FishFoodField | null} food
   * @param {import("./fish-ecosystem.js").FishEcosystemSettings | unknown} ecosystemRaw
   * @param {{ depthMinFrac: number, depthMaxFrac: number }} depthRange
   * @param {import("./critters.js").LadybugSwarm | null} [ladybugs]
   * @param {import("./spiders.js").SpiderWebField | null} [spiders]
   */
  update(t, dt, windSpeed, windDirRad, food, ecosystemRaw, depthRange, ladybugs, spiders) {
    const eco = normalizeFishEcosystem(ecosystemRaw);
    const dtC = Math.min(Math.max(dt, 0), 0.08);
    const spread = this.fieldSpread * 0.98;
    const bound = spread * 0.99;
    const d = this._dynamics;
    const wx = Math.cos(windDirRad) * windSpeed * 0.08;
    const wz = Math.sin(windDirRad) * windSpeed * 0.08;
    const dummy = new THREE.Object3D();
    const eatR = eco.eatRadius;
    const huntRange = 38;
    let sumHealth = 0;
    let living = 0;
    const totalFish =
      this._blocks.reduce((acc, blk) => acc + blk.mesh.count, 0) || 1;
    const preySlot = Math.floor(t * 10) % 11;

    for (let b = 0; b < this._blocks.length; b++) {
      const blk = this._blocks[b];
      const { mesh, phase, scale, px, py, pz, yaw, depthFrac, health } = blk;
      const n = mesh.count;

      for (let i = 0; i < n; i++) {
        const ph = phase[i];
        let sc = scale[i];
        let h = health[i];

        if (h > 0.02) {
          h -= eco.hungerPerSec * dtC;
          if (food) {
            if (food.tryConsumePellet(px[i], py[i], pz[i], eatR)) {
              h = Math.min(1, h + eco.feedPellet);
            }
          }
          if (h > 0.02 && eco.preyLadybugs && ladybugs && (i + preySlot) % 9 === 0) {
            if (
              ladybugs.tryConsumeLadybugForFish(px[i], py[i], pz[i], eatR * 1.05, this._terrain)
            ) {
              h = Math.min(1, h + eco.feedLadybug);
            }
          }
          if (h > 0.02 && eco.preySpiderZones && spiders && (i + preySlot * 2) % 11 === 0) {
            if (spiders.tryFishBiteNearWeb(px[i], py[i], pz[i], eatR * 1.2, this._terrain)) {
              h = Math.min(1, h + eco.feedSpider);
            }
          }
        }

        health[i] = h;
        sumHealth += Math.max(0, h);
        if (h > 0.08) living += 1;

        const steer = food?.getSteerTowardNearest(px[i], py[i], pz[i], huntRange);
        const turn =
          d.yawWander *
          (0.55 * Math.sin(t * 0.52 + ph) +
            0.35 * Math.sin(t * 0.27 + ph * 1.9) +
            0.25 * Math.sin(t * d.swimFreq + ph * 2.7));
        let yawDelta = turn * dtC;
        if (steer && h > 0.08 && eco.huntSteer > 0.05) {
          const want = Math.atan2(steer.dx, steer.dz);
          yawDelta += angleWrap(want - yaw[i]) * eco.huntSteer * 0.11 * dtC;
        }
        yaw[i] += yawDelta;

        const pace =
          d.swimAmp *
          (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * d.swimFreq * 0.6 + ph * 2.1))) *
          (h > 0.08 ? 1 : 0.12);

        px[i] += Math.sin(yaw[i]) * pace * dtC + wx * dtC;
        pz[i] += Math.cos(yaw[i]) * pace * dtC + wz * dtC;

        if (px[i] > bound) {
          px[i] = bound;
          yaw[i] += Math.PI * 0.65;
        } else if (px[i] < -bound) {
          px[i] = -bound;
          yaw[i] += Math.PI * 0.65;
        }
        if (pz[i] > bound) {
          pz[i] = bound;
          yaw[i] += Math.PI * 0.65;
        } else if (pz[i] < -bound) {
          pz[i] = -bound;
          yaw[i] += Math.PI * 0.65;
        }

        const terrain = this._terrain;
        if (terrain) {
          if (isTerrainDryAt(terrain, px[i], pz[i])) {
            yaw[i] += (0.55 + 0.45 * Math.sin(t * 2.1 + ph * 3.4)) * Math.PI * 0.42;
          }
          const g = terrain.getHeightBilinear(px[i], pz[i]);
          const w = terrain.getWaterSurfaceHeightBilinear(px[i], pz[i]);
          const column = w - g;
          if (column > 0.1) {
            const baseY = g + column * depthFrac[i];
            const bob =
              Math.sin(t * d.swimFreq * 1.4 + ph * 1.7) * 0.04 * Math.min(column, 2.5) +
              Math.sin(t * 2.1 + ph) * 0.015;
            py[i] = baseY + bob;
            if (h <= 0.08) {
              py[i] = g + 0.04 + Math.sin(t * 0.9 + ph) * 0.02;
            }
          }
        }

        if (h <= 0.08) {
          sc = scale[i] * 0.15;
        } else {
          sc = scale[i];
        }

        const roll = Math.sin(t * d.swimFreq * 2 + ph * 3) * 0.12 * Math.min(1, h * 4);
        const pitch = Math.sin(t * d.swimFreq * 1.2 + ph * 3) * 0.07 * Math.min(1, h * 4);
        dummy.position.set(px[i], py[i], pz[i]);
        _DIR.set(Math.sin(yaw[i]), 0, Math.cos(yaw[i])).normalize();
        _Q.setFromUnitVectors(_FWD, _DIR);
        _QPR.setFromEuler(new THREE.Euler(pitch, 0, roll, "YXZ"));
        dummy.quaternion.copy(_Q).multiply(_QPR);
        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    this.lastEcosystemStats = {
      living,
      total: totalFish,
      meanHealth: sumHealth / totalFish,
    };
  }
}
