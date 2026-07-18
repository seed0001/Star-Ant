import * as THREE from "three";
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
export function fireflySignature(o) {
  return JSON.stringify({
    fireflyCount: o.fireflyCount,
    fireflyPresets: o.fireflyPresets,
    fireflySeed: o.fireflySeed,
  });
}

/**
 * @param {object} o
 */
export function antSignature(o) {
  return JSON.stringify({
    antCount: o.antCount,
    antPresets: o.antPresets,
    antSeed: o.antSeed,
    // Colony layout decides where each ant spawns, so a hill change has to
    // respawn the swarm — not just move the anchors.
    antHillCount: o.antHillCount,
    antHillSeed: o.antHillSeed,
    antWandererPercent: o.antWandererPercent,
  });
}

/** Shared canvas: simple side-view ant (head, thorax, abdomen, legs). */
function createAntSilhouetteTexture() {
  const w = 256;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context");
  ctx.clearRect(0, 0, w, h);
  const ink = "#0a0a0a";
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";

  // Head (front)
  ctx.beginPath();
  ctx.arc(36, 62, 15, 0, Math.PI * 2);
  ctx.fill();

  // Thorax
  ctx.beginPath();
  ctx.ellipse(92, 62, 24, 17, 0, 0, Math.PI * 2);
  ctx.fill();

  // Abdomen (rear)
  ctx.beginPath();
  ctx.ellipse(172, 62, 42, 24, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs (three pairs, schematic)
  const footY = 108;
  for (let k = 0; k < 3; k++) {
    const x = 72 + k * 18;
    ctx.beginPath();
    ctx.moveTo(x, 76);
    ctx.lineTo(x - 10, footY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, 76);
    ctx.lineTo(x + 10, footY);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Soft radial blob for additive glow sprite. */
function createGlowTexture() {
  const s = 64;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context");
  const g = ctx.createRadialGradient(s * 0.5, s * 0.5, 0, s * 0.5, s * 0.5, s * 0.5);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.35, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Billboard sprites: canvas ant silhouette + additive glow sprite offset along camera right.
 */
export class FireflySwarm {
  /**
   * @param {THREE.Scene} scene
   * @param {number} fieldSpread
   */
  constructor(scene, fieldSpread) {
    this.scene = scene;
    this.fieldSpread = fieldSpread;
    /** @type {THREE.Group | null} */
    this.group = null;
    this._rebuildGen = 0;
    /** @type {THREE.CanvasTexture | null} */
    this._antTex = null;
    /** @type {THREE.CanvasTexture | null} */
    this._glowTex = null;
    /**
     * @type {{
     *   root: THREE.Group,
     *   ant: THREE.Sprite,
     *   glow: THREE.Sprite,
     *   phase: number,
     *   baseX: number,
     *   baseZ: number,
     *   hoverAboveGround: number,
     *   scale: number,
     *   glowColor: THREE.Color,
     *   snaredWeb: number,
     * }[]}
     */
    this._items = [];
    /** @type {import("./terrain-paint.js").TerrainHeightField | null} */
    this._terrain = null;
  }

  clear() {
    if (this.group) {
      this.scene.remove(this.group);
      const mats = new Set();
      this._items.forEach(({ ant, glow }) => {
        mats.add(ant.material);
        mats.add(glow.material);
      });
      mats.forEach((m) => m.dispose());
      this._items = [];
      this._antTex?.dispose();
      this._glowTex?.dispose();
      this._antTex = null;
      this._glowTex = null;
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
    const total = Math.max(0, Math.floor(opts.total));
    if (total < 1) {
      if (token !== this._rebuildGen) return false;
      return true;
    }

    const presets =
      Array.isArray(opts.presets) && opts.presets.length > 0
        ? opts.presets
        : [{ color: "#b8ff66", sharePercent: 100 }];
    const weights = presets.map((p) => finiteOr(p.sharePercent, 100));
    const counts = splitCounts(total, weights);

    this._antTex = createAntSilhouetteTexture();
    this._glowTex = createGlowTexture();

    const rng = mulberry32(opts.seed >>> 0);
    const spread = this.fieldSpread * 0.92;

    this.group = new THREE.Group();
    this.group.name = "Fireflies";

    const antMatShared = new THREE.SpriteMaterial({
      map: this._antTex,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
    });

    for (let pi = 0; pi < presets.length; pi++) {
      const n = Math.max(0, counts[pi] ?? 0);
      if (n < 1) continue;

      const glowColor = new THREE.Color(
        typeof presets[pi].color === "string" ? presets[pi].color : "#b8ff66"
      );

      for (let i = 0; i < n; i++) {
        const root = new THREE.Group();
        const ant = new THREE.Sprite(antMatShared);
        const glowMat = new THREE.SpriteMaterial({
          map: this._glowTex,
          transparent: true,
          depthWrite: false,
          depthTest: true,
          fog: true,
          blending: THREE.AdditiveBlending,
          color: glowColor.clone(),
          opacity: 0,
        });
        const glow = new THREE.Sprite(glowMat);

        ant.center.set(0.5, 0.5);
        ant.scale.set(0.24, 0.12, 1);
        glow.center.set(0.5, 0.5);
        glow.scale.set(0.1, 0.1, 1);

        root.add(ant);
        root.add(glow);

        this.group.add(root);
        const land = sampleLandXZForSpawn(this._terrain, opts.dryLand, rng, spread);
        const bx = land.x;
        const bz = land.z;
        this._items.push({
          root,
          ant,
          glow,
          phase: rng() * Math.PI * 2,
          baseX: bx,
          baseZ: bz,
          hoverAboveGround: 0.42 + rng() * 1.85,
          scale: 0.88 + rng() * 0.22,
          glowColor,
          snaredWeb: -1,
        });
      }
    }

    this.scene.add(this.group);
    if (token !== this._rebuildGen) return false;
    return true;
  }

  /**
   * @param {number} t
   * @param {number} windSpeed
   * @param {number} windDirRad
   * @param {number} dayPhase 1 = day, 0 = night
   * @param {THREE.Camera} camera
   * @param {{ x: number, y: number, z: number, radius: number }[] | null | undefined} [spiderZones]
   */
  update(t, windSpeed, windDirRad, dayPhase, camera, spiderZones) {
    if (!this.group || this._items.length < 1) return;

    const wdx = Math.cos(windDirRad);
    const wdz = Math.sin(windDirRad);
    const w = windSpeed;
    const night2 = (1 - dayPhase) ** 2;

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const side = 0.13;

    for (let i = 0; i < this._items.length; i++) {
      const it = this._items[i];
      const ph = it.phase;

      if (it.snaredWeb >= 0) {
        const z = spiderZones?.[it.snaredWeb];
        if (!z) {
          it.snaredWeb = -1;
        } else {
          const wx = Math.sin(t * 13 + ph * 3) * 0.05;
          const wy = Math.sin(t * 10 + ph * 2) * 0.04;
          const wz = Math.cos(t * 11 + ph * 2.5) * 0.05;
          it.root.position.set(z.x + wx, z.y + wy, z.z + wz);
          it.root.scale.setScalar(it.scale);
          it.glow.position.copy(right).multiplyScalar(side);
          const flick = 0.72 + 0.28 * Math.sin(t * 3.1 + ph * 4.0);
          const pulse = (0.22 + 0.78 * Math.sin(t * 2.5 + ph * 2.7)) * flick;
          const glowAmt = night2 * (0.05 + 0.95 * pulse);
          const mat = /** @type {THREE.SpriteMaterial} */ (it.glow.material);
          mat.color.copy(it.glowColor);
          mat.opacity = glowAmt;
          continue;
        }
      }

      let px =
        it.baseX + Math.sin(t * 0.55 + ph) * 1.15 + wdx * w * 0.42;
      let pz =
        it.baseZ + Math.cos(t * 0.48 + ph * 1.3) * 1.15 + wdz * w * 0.42;
      const g =
        this._terrain?.getHeightBilinear(px, pz) ?? 0;
      let py =
        g +
        it.hoverAboveGround +
        Math.sin(t * 0.71 + ph * 0.9) * 0.38;

      if (it.snaredWeb < 0 && spiderZones && spiderZones.length > 0) {
        for (let zi = 0; zi < spiderZones.length; zi++) {
          const z = spiderZones[zi];
          const dx = px - z.x;
          const dy = py - z.y;
          const dz = pz - z.z;
          const r = z.radius;
          if (dx * dx + dy * dy + dz * dz < r * r) {
            it.snaredWeb = zi;
            break;
          }
        }
      }

      if (it.snaredWeb >= 0) {
        const z = spiderZones?.[it.snaredWeb];
        if (z) {
          const wx = Math.sin(t * 13 + ph * 3) * 0.05;
          const wy = Math.sin(t * 10 + ph * 2) * 0.04;
          const wz = Math.cos(t * 11 + ph * 2.5) * 0.05;
          px = z.x + wx;
          py = z.y + wy;
          pz = z.z + wz;
        } else {
          it.snaredWeb = -1;
        }
      }

      it.root.position.set(px, py, pz);
      it.root.scale.setScalar(it.scale);

      it.glow.position.copy(right).multiplyScalar(side);

      const flick = 0.72 + 0.28 * Math.sin(t * 3.1 + ph * 4.0);
      const pulse = (0.22 + 0.78 * Math.sin(t * 2.5 + ph * 2.7)) * flick;
      const glowAmt = night2 * (0.05 + 0.95 * pulse);
      const mat = /** @type {THREE.SpriteMaterial} */ (it.glow.material);
      mat.color.copy(it.glowColor);
      mat.opacity = glowAmt;
    }
  }
}

function createAntBodyGeometry() {
  const g = new THREE.BoxGeometry(0.048, 0.011, 0.026);
  g.translate(0, 0.0055, 0);
  return g;
}

/**
 * Tiny ground ants — wide distribution, simple wander (no trees).
 */
/** How far a colony ant strays from its hill while foraging normally. */
const ANT_FORAGE_RADIUS = 9;
/** Seconds a swarm runs once it starts. */
const ANT_SWARM_DURATION = 18;
/** Speed multiplier while swarming — the column has to read as urgent. */
const ANT_SWARM_SPEED_MUL = 2.6;
/** How far out from the hill the swarm column pushes. */
const ANT_SWARM_MARCH = 16;

/**
 * Stable pseudo-random in [0,1) from two integers. Used to pick a fresh
 * heading per (colony, swarm cycle) without storing any per-cycle state.
 * @param {number} a
 * @param {number} b
 */
function hash01(a, b) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^
    Math.imul((b | 0) + 0x165667b1, 0xc2b2ae35);
  h ^= h >>> 15;
  return ((h >>> 0) % 100003) / 100003;
}

export class AntSwarm {
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
     *   colony: Int16Array,
     * }[]}
     */
    this._blocks = [];
    /** @type {import("./terrain-paint.js").TerrainHeightField | null} */
    this._terrain = null;
    /** @type {{ x: number; y: number; z: number }[]} */
    this._hillPositions = [];
    /** Round-robin cursor so colony assignment stays even across preset blocks. */
    this._colonyCursor = 0;
    /** @type {boolean[]} per-colony swarm state, refreshed each update for the minimap. */
    this._swarmFlags = [];
  }

  /**
   * Which colonies are mid-swarm right now — drives the minimap markers.
   * @returns {boolean[]}
   */
  getSwarmFlags() {
    return this._swarmFlags;
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
    this._swarmFlags = [];
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
    this._hillPositions = Array.isArray(opts.hillPositions) ? opts.hillPositions : [];
    this._colonyCursor = 0;
    const wandererFrac = Math.min(
      1,
      Math.max(0, finiteOr(opts.wandererPercent, 15) / 100)
    );
    if (!this._geo) this._geo = createAntBodyGeometry();

    const total = Math.max(0, Math.floor(opts.total));
    if (total < 1) return true;

    const presets =
      Array.isArray(opts.presets) && opts.presets.length > 0
        ? opts.presets
        : [{ color: "#2a1e14", sharePercent: 100 }];
    const weights = presets.map((p) => finiteOr(p.sharePercent, 100));
    const counts = splitCounts(total, weights);

    const rng = mulberry32(opts.seed >>> 0);
    const spread = this.fieldSpread * 0.98;

    this.group = new THREE.Group();
    this.group.name = "Ants";

    const dummy = new THREE.Object3D();
    const tmpColor = new THREE.Color();

    for (let pi = 0; pi < presets.length; pi++) {
      const n = Math.max(0, counts[pi] ?? 0);
      if (n < 1) continue;

      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        metalness: 0.02,
        roughness: 0.92,
      });
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
      /** Index into hillPositions, or -1 for a free-roaming wanderer. */
      const colony = new Int16Array(n);

      const hills = this._hillPositions;
      for (let i = 0; i < n; i++) {
        phase[i] = rng() * Math.PI * 2;
        scale[i] = 0.75 + rng() * 0.55;

        // Round-robin so colonies get even numbers regardless of preset splits.
        const isWanderer = hills.length < 1 || rng() < wandererFrac;
        colony[i] = isWanderer ? -1 : (this._colonyCursor++ % hills.length);

        let x;
        let z;
        if (colony[i] >= 0) {
          // Spawn inside the home territory so colonies read as distinct
          // clusters from frame one, rather than converging over time.
          const hill = hills[colony[i]];
          const a = rng() * Math.PI * 2;
          const r = Math.sqrt(rng()) * ANT_FORAGE_RADIUS * 0.8;
          x = THREE.MathUtils.clamp(hill.x + Math.cos(a) * r, -spread, spread);
          z = THREE.MathUtils.clamp(hill.z + Math.sin(a) * r, -spread, spread);
        } else {
          const land = sampleLandXZForSpawn(this._terrain, opts.dryLand, rng, spread);
          x = land.x;
          z = land.z;
        }
        px[i] = x;
        pz[i] = z;
        const ry = rng() * Math.PI * 2;
        head[i] = ry;
        const groundY = this._terrain ? this._terrain.getHeightBilinear(x, z) : 0;
        dummy.position.set(
          x,
          groundY + 0.018 + rng() * 0.012,
          z
        );
        dummy.rotation.set(-Math.PI * 0.5 + (rng() - 0.5) * 0.08, ry, (rng() - 0.5) * 0.12);
        dummy.scale.setScalar(scale[i]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        tmpColor.set(typeof presets[pi].color === "string" ? presets[pi].color : "#2a1e14");
        mesh.setColorAt(i, tmpColor);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this._blocks.push({ mesh, phase, scale, px, pz, head, colony });
    }

    if (token !== this._rebuildGen) return false;
    this.scene.add(this.group);
    return true;
  }

  /**
   * @param {number} t
   * @param {number} dt
   * @param {object} [opts]
   * @param {{ x: number; y: number; z: number }[]} [opts.hillPositions] live hill positions (terrain sync)
   * @param {boolean} [opts.swarmEnabled]
   * @param {number} [opts.swarmIntervalSec] seconds between one colony's swarms
   */
  update(t, dt, opts = {}) {
    const dtC = Math.min(Math.max(dt, 0), 0.08);
    const spread = this.fieldSpread * 0.98;
    const bound = spread * 0.99;
    const dummy = new THREE.Object3D();

    const hills = opts.hillPositions ?? this._hillPositions ?? [];
    const swarmEnabled = opts.swarmEnabled !== false;
    // A colony can't swarm more often than a swarm lasts.
    const period = Math.max(
      ANT_SWARM_DURATION + 6,
      finiteOr(opts.swarmIntervalSec, 75)
    );

    // Resolve every colony's swarm state once per frame rather than per ant.
    // Deriving it from the clock keeps it stateless — no drift, and it stays
    // correct across pauses.
    const nHills = hills.length;
    const swarming = this._swarmFlags;
    swarming.length = nHills;
    /** @type {number[]} */
    const swarmTx = [];
    /** @type {number[]} */
    const swarmTz = [];
    for (let c = 0; c < nHills; c++) {
      // Stagger colonies across the period so they don't all march at once.
      const offset = nHills > 0 ? (period * c) / nHills : 0;
      const local = (((t + offset) % period) + period) % period;
      const isSwarming = swarmEnabled && local < ANT_SWARM_DURATION;
      swarming[c] = isSwarming;
      if (!isSwarming) {
        swarmTx.push(0);
        swarmTz.push(0);
        continue;
      }
      // Fresh heading each cycle, stable for the whole cycle.
      const cycle = Math.floor((t + offset) / period);
      const ang = hash01(c, cycle) * Math.PI * 2;
      const progress = local / ANT_SWARM_DURATION;
      // Column pushes out, holds, then the calm home-pull reels it back in.
      const reach = ANT_SWARM_MARCH * Math.min(1, progress * 1.7);
      swarmTx.push(hills[c].x + Math.cos(ang) * reach);
      swarmTz.push(hills[c].z + Math.sin(ang) * reach);
    }

    for (let b = 0; b < this._blocks.length; b++) {
      const { mesh, phase, scale, px, pz, head, colony } = this._blocks[b];
      const n = mesh.count;

      for (let i = 0; i < n; i++) {
        const ph = phase[i];
        const sc = scale[i];
        const turn =
          1.4 * Math.sin(t * 0.88 + ph) +
          0.62 * Math.sin(t * 0.31 + ph * 2.1) +
          0.4 * Math.sin(t * 1.05 + ph * 3.4);
        head[i] += turn * dtC;
        let pace =
          0.07 +
          0.09 * (0.5 + 0.5 * Math.sin(t * 0.52 + ph * 2.4)) +
          0.04 * Math.sin(t * 1.03 + ph);

        // Colony ants steer toward a goal: the swarm column while swarming,
        // otherwise home whenever they wander past their foraging radius.
        const c = colony ? colony[i] : -1;
        if (c >= 0 && c < nHills) {
          const hill = hills[c];
          let goalX = 0;
          let goalZ = 0;
          let weight = 0;
          if (swarming[c]) {
            goalX = swarmTx[c];
            goalZ = swarmTz[c];
            weight = 2.9;
            pace *= ANT_SWARM_SPEED_MUL;
          } else {
            const dx = px[i] - hill.x;
            const dz = pz[i] - hill.z;
            const d = Math.hypot(dx, dz);
            if (d > ANT_FORAGE_RADIUS) {
              goalX = hill.x;
              goalZ = hill.z;
              // Ramp in past the boundary so the territory edge stays soft.
              weight = Math.min(2.6, (d - ANT_FORAGE_RADIUS) * 0.32);
            }
          }
          if (weight > 0) {
            const want = Math.atan2(goalX - px[i], goalZ - pz[i]);
            // Shortest way round to the goal heading.
            let diff = want - head[i];
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            head[i] += diff * Math.min(1, weight * dtC);
          }
        }

        px[i] += Math.sin(head[i]) * pace * dtC;
        pz[i] += Math.cos(head[i]) * pace * dtC;

        if (px[i] > bound) {
          px[i] = bound;
          head[i] += Math.PI * 0.55 + 0.35 * Math.sin(t * 2.2 + ph);
        } else if (px[i] < -bound) {
          px[i] = -bound;
          head[i] += Math.PI * 0.55 + 0.35 * Math.sin(t * 2.2 + ph);
        }
        if (pz[i] > bound) {
          pz[i] = bound;
          head[i] += Math.PI * 0.55 + 0.35 * Math.cos(t * 2.1 + ph);
        } else if (pz[i] < -bound) {
          pz[i] = -bound;
          head[i] += Math.PI * 0.55 + 0.35 * Math.cos(t * 2.1 + ph);
        }

        if (this._terrain && !isTerrainDryAt(this._terrain, px[i], pz[i])) {
          head[i] += (0.55 + 0.45 * Math.sin(t * 2.4 + ph * 3.2)) * Math.PI * 0.38;
        }

        const bob = Math.sin(t * 18 + ph * 5) * 0.006;
        const sway = Math.sin(t * 12 + ph * 3) * 0.05;
        const gy = this._terrain
          ? this._terrain.getHeightBilinear(px[i], pz[i])
          : 0;
        dummy.position.set(px[i], gy + 0.016 + bob, pz[i]);
        dummy.rotation.set(
          -Math.PI * 0.5 + sway * 0.25,
          head[i],
          Math.sin(t * 20 + ph) * 0.04
        );
        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
