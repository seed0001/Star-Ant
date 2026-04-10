import * as THREE from "three";
import { TERRAIN_WORLD_HALF_EXTENT } from "./terrain-paint.js";

/**
 * Grid resolution: each cell is one sharp "pixel" on the ground texture (nearest filtering).
 * 256² — flakes stamp individual cells; melt pass still runs each frame.
 */
const RES = 256;

/**
 * Snow depth on dry ground (0–1 per cell). Stamped where GPU snowflakes hit terrain;
 * melts over time, faster in daylight.
 */
export class SnowAccumulationField {
  /**
   * @param {import("./terrain-paint.js").TerrainHeightField} terrainHeightField
   */
  constructor(terrainHeightField) {
    this.terrain = terrainHeightField;
    this.halfExtent = terrainHeightField?.halfExtent ?? TERRAIN_WORLD_HALF_EXTENT;
    this.depth = new Float32Array(RES * RES);
    const n = RES * RES * 4;
    this._pixels = new Uint8Array(n);
    this.texture = new THREE.DataTexture(this._pixels, RES, RES, THREE.RGBAFormat, THREE.UnsignedByteType);
    /** Crisp blocky piles — each texel is a flat white tile until depth blends in shader. */
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this._idleAcc = 0;
  }

  /**
   * One snowflake landed at world XZ — brighten that grid cell (dry land only).
   * @param {number} wx
   * @param {number} wz
   * @param {number} amount 0–1 scale per hit
   */
  stampWorld(wx, wz, amount) {
    if (!this.terrain) return;
    const h = this.halfExtent;
    const ux = (wx + h) / (2 * h);
    const uy = (-wz + h) / (2 * h);
    if (ux <= 0 || ux >= 1 || uy <= 0 || uy >= 1) return;

    const th = this.terrain.getHeightBilinear(wx, wz);
    const wh = this.terrain.getWaterSurfaceHeightBilinear(wx, wz);
    if (th < wh + 0.05) return;

    const ix = Math.min(RES - 1, Math.max(0, Math.floor(ux * RES)));
    const iz = Math.min(RES - 1, Math.max(0, Math.floor(uy * RES)));
    const idx = ix + iz * RES;
    const add = THREE.MathUtils.clamp(amount * 0.85, 0, 0.22);
    this.depth[idx] = Math.min(1, this.depth[idx] + add);
  }

  /**
   * @param {number} dt
   * @param {number} snowIntensity 0–1 (unused for deposit — flakes stamp; used for idle skip)
   * @param {number} dayPhase 0 night — 1 day
   */
  update(dt, snowIntensity, dayPhase) {
    if (!this.terrain) return;
    const si = THREE.MathUtils.clamp(snowIntensity, 0, 1);
    const day = THREE.MathUtils.clamp(dayPhase, 0, 1);
    const snowing = si > 0.02;

    let maxD = 0;
    for (let k = 0; k < this.depth.length; k++) {
      maxD = Math.max(maxD, this.depth[k]);
    }

    if (!snowing && maxD < 0.002) {
      this._idleAcc += dt;
      if (this._idleAcc < 0.3) return;
    }
    this._idleAcc = 0;

    const meltBase = (0.012 + day * 0.042) * dt;

    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const idx = i + j * RES;
        const u = (i + 0.5) / RES;
        const v = (j + 0.5) / RES;
        const wx = u * 2 * this.halfExtent - this.halfExtent;
        const wz = this.halfExtent - v * 2 * this.halfExtent;

        const terrainY = this.terrain.getHeightBilinear(wx, wz);
        const waterY = this.terrain.getWaterSurfaceHeightBilinear(wx, wz);
        let d = this.depth[idx];

        if (terrainY < waterY + 0.06) {
          d *= THREE.MathUtils.clamp(1 - dt * 0.9, 0, 1);
          this.depth[idx] = d;
          continue;
        }

        d -= meltBase * d + meltBase * 0.01 * day;
        d = THREE.MathUtils.clamp(d, 0, 1);
        this.depth[idx] = d;
      }
    }

    const px = this._pixels;
    for (let i = 0; i < RES * RES; i++) {
      const b = Math.min(255, Math.floor(this.depth[i] * 255));
      const o = i * 4;
      px[o] = b;
      px[o + 1] = b;
      px[o + 2] = b;
      px[o + 3] = 255;
    }
    this.texture.needsUpdate = true;
  }
}
