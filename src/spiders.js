import * as THREE from "three";

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
 * @param {string} treeSigStr
 */
export function spiderSignature(o, treeSigStr) {
  return JSON.stringify({
    spiderWebCount: o.spiderWebCount,
    spiderSeed: o.spiderSeed,
    treeSig: treeSigStr,
  });
}

function createWebSilkTexture() {
  const s = 256;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context");
  ctx.clearRect(0, 0, s, s);
  ctx.strokeStyle = "rgba(240,245,250,0.55)";
  ctx.lineWidth = 1.2;
  const cx = s * 0.5;
  const cy = s * 0.5;
  const rings = 10;
  for (let r = 1; r <= rings; r++) {
    const rad = (r / rings) * (s * 0.46);
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.stroke();
  }
  const spokes = 16;
  for (let i = 0; i < spokes; i++) {
    const ang = (i / spokes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * s * 0.46, cy + Math.sin(ang) * s * 0.46);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSpiderSilhouetteTexture() {
  const w = 96;
  const h = 96;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context");
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#151210";
  ctx.strokeStyle = "#151210";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.ellipse(48, 38, 14, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(48, 58, 10, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    const x = 30 + i * 12;
    ctx.beginPath();
    ctx.moveTo(x, 44);
    ctx.lineTo(x - 6, 72);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, 44);
    ctx.lineTo(x + 6, 72);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Radial webs + billboard spiders; exposes 3D catch zones for ladybugs / fireflies.
 */
export class SpiderWebField {
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
    this._webTex = null;
    /** @type {THREE.CanvasTexture | null} */
    this._spiderTex = null;
    /**
     * @type {{
     *   center: THREE.Vector3,
     *   radius: number,
     *   mesh: THREE.Mesh,
     *   spider: THREE.Sprite,
     * }[]}
     */
    this._webs = [];
    /** Shared material for all web meshes */
    /** @type {THREE.MeshBasicMaterial | null} */
    this._webMat = null;
    /** @type {THREE.SpriteMaterial | null} */
    this._spiderMatShared = null;
  }

  clear() {
    if (this.group) {
      this.scene.remove(this.group);
      this._webs.forEach(({ mesh }) => {
        mesh.geometry.dispose();
      });
      this._webMat?.dispose();
      this._spiderMatShared?.dispose();
      this._webs = [];
      this._webTex?.dispose();
      this._spiderTex?.dispose();
      this._webTex = null;
      this._spiderTex = null;
      this._webMat = null;
      this._spiderMatShared = null;
      this.group = null;
    }
  }

  /**
   * @param {object} opts
   * @param {number} opts.count
   * @param {number} opts.seed
   * @param {{ x: number, z: number, scale: number, trunkHeight: number }[]} opts.treePlacements
   * @returns {boolean}
   */
  rebuild(opts) {
    const token = ++this._rebuildGen;
    this.clear();
    const count = Math.max(0, Math.floor(opts.count));
    if (count < 1) {
      if (token !== this._rebuildGen) return false;
      return true;
    }

    const rng = mulberry32(opts.seed >>> 0);
    const spread = this.fieldSpread * 0.92;
    const trees = Array.isArray(opts.treePlacements) ? opts.treePlacements : [];

    this._webTex = createWebSilkTexture();
    this._spiderTex = createSpiderSilhouetteTexture();

    this._webMat = new THREE.MeshBasicMaterial({
      map: this._webTex,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      depthTest: true,
      fog: true,
      side: THREE.DoubleSide,
    });

    this._spiderMatShared = new THREE.SpriteMaterial({
      map: this._spiderTex,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
    });

    this.group = new THREE.Group();
    this.group.name = "SpiderWebs";

    for (let i = 0; i < count; i++) {
      let x;
      let z;
      let y;
      if (trees.length >= 2 && rng() < 0.55) {
        const a = trees[Math.floor(rng() * trees.length)];
        const b = trees[Math.floor(rng() * trees.length)];
        if (a !== b) {
          x = (a.x + b.x) * 0.5 + (rng() - 0.5) * 1.2;
          z = (a.z + b.z) * 0.5 + (rng() - 0.5) * 1.2;
          const midH = Math.min(a.trunkHeight, b.trunkHeight) * 0.45;
          y = 0.85 + rng() * Math.min(midH, 6) + rng() * 0.8;
        } else {
          x = (rng() * 2 - 1) * spread;
          z = (rng() * 2 - 1) * spread;
          y = 0.9 + rng() * 2.2;
        }
      } else if (trees.length >= 1 && rng() < 0.65) {
        const tr = trees[Math.floor(rng() * trees.length)];
        const ang = rng() * Math.PI * 2;
        const rad = tr.scale * (0.35 + rng() * 0.5);
        x = tr.x + Math.cos(ang) * rad;
        z = tr.z + Math.sin(ang) * rad;
        y = 1.1 + rng() * Math.min(tr.trunkHeight * 0.55, 7);
      } else {
        x = (rng() * 2 - 1) * spread;
        z = (rng() * 2 - 1) * spread;
        y = 0.75 + rng() * 2.4;
      }

      const center = new THREE.Vector3(x, y, z);
      const radius = 1.15 + rng() * 0.45;

      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._webMat);
      mesh.scale.set(radius * 2.2, radius * 2.2, 1);
      mesh.position.copy(center);
      mesh.rotation.x = -Math.PI * 0.5 + (rng() - 0.5) * 0.35;
      mesh.rotation.z = rng() * Math.PI * 2;
      mesh.renderOrder = 1;

      const spider = new THREE.Sprite(this._spiderMatShared);
      spider.center.set(0.5, 0.5);
      spider.scale.set(0.11, 0.11, 1);
      spider.position.copy(center).add(new THREE.Vector3(0.35 + rng() * 0.2, 0.12, 0.15));

      this.group.add(mesh);
      this.group.add(spider);
      this._webs.push({ center, radius, mesh, spider });
    }

    this.scene.add(this.group);
    if (token !== this._rebuildGen) return false;
    return true;
  }

  /**
   * Catch radius (world units) — slightly smaller than web visual.
   */
  getCatchRadius() {
    return 0.95;
  }

  /**
   * @returns {{ x: number, y: number, z: number, radius: number }[]}
   */
  getZones() {
    const r = this.getCatchRadius();
    return this._webs.map((w) => ({
      x: w.center.x,
      y: w.center.y,
      z: w.center.z,
      radius: r,
    }));
  }

  /**
   * Fish nip at webs that sit in or near the water column (spider stays; abstract “catch” snack).
   * @param {number} fx
   * @param {number} fy
   * @param {number} fz
   * @param {number} radius
   * @param {import("./terrain-paint.js").TerrainHeightField | null} terrain
   * @returns {boolean}
   */
  tryFishBiteNearWeb(fx, fy, fz, radius, terrain) {
    if (!terrain || this._webs.length < 1) return false;
    const r2 = radius * radius;
    for (let wi = 0; wi < this._webs.length; wi++) {
      const w = this._webs[wi];
      const cx = w.center.x;
      const cz = w.center.z;
      const g = terrain.getHeightBilinear(cx, cz);
      const ws = terrain.getWaterSurfaceHeightBilinear(cx, cz);
      if (ws - g < 0.14) continue;
      if (w.center.y > ws - 0.28) continue;
      const dx = fx - cx;
      const dy = fy - w.center.y;
      const dz = fz - cz;
      if (dx * dx + dy * dy + dz * dz < r2) return true;
    }
    return false;
  }

  /**
   * @param {number} t
   */
  update(t) {
    for (let i = 0; i < this._webs.length; i++) {
      const s = this._webs[i].spider;
      const bob = Math.sin(t * 2.4 + i * 1.7) * 0.02;
      s.position.y = this._webs[i].center.y + 0.12 + bob;
    }
  }
}
