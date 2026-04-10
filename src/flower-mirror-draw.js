/**
 * Classic mirror drawing: strokes on one side of a vertical axis are mirrored.
 * Raster silhouette → width multipliers along petal length (base bottom, tip top).
 */

/** Must match petal mesh lengthwise segments + 1 in {@link ./flowers.js} buildPetalGeometry sy=8. */
export const MIRROR_PROFILE_SAMPLES = 9;

export class FlowerMirrorDraw {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });
    /** @type {{ x: number, y: number } | null} */
    this._last = null;
    this._brush = 3.25;
    this._bound = false;
    /** @type {(e: PointerEvent) => void} */
    this._onDown = (e) => this._handleDown(e);
    /** @type {(e: PointerEvent) => void} */
    this._onMove = (e) => this._handleMove(e);
    /** @type {(e: PointerEvent) => void} */
    this._onUp = (e) => this._handleUp(e);
  }

  _cssToCanvas(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / Math.max(rect.width, 1e-6);
    const sy = this.canvas.height / Math.max(rect.height, 1e-6);
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
    };
  }

  _mirrorX(x) {
    return this.canvas.width - x;
  }

  _strokeSegment(x0, y0, x1, y1) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 205, 228, 0.94)";
    ctx.lineWidth = this._brush;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "source-over";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const mx0 = this._mirrorX(x0);
    const mx1 = this._mirrorX(x1);
    ctx.beginPath();
    ctx.moveTo(mx0, y0);
    ctx.lineTo(mx1, y1);
    ctx.stroke();
    ctx.restore();
  }

  _drawCenterLine() {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    ctx.restore();
  }

  clear() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._drawCenterLine();
    this._last = null;
  }

  /**
   * Visualize an existing width profile (multipliers, widest = 1).
   * @param {number[] | null | undefined} widthProfile
   */
  loadProfile(widthProfile) {
    this.clear();
    const ctx = this.ctx;
    if (!ctx || !widthProfile || widthProfile.length < 2) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const cx = W / 2;
    const n = widthProfile.length;
    const maxHalf = W * 0.42;
    ctx.fillStyle = "rgba(255, 190, 220, 0.88)";
    ctx.beginPath();
    const yAt = (b) => {
      const v = (b + 0.5) / n;
      return (1 - v) * (H - 1);
    };
    const hwAt = (b) =>
      Math.min(2.2, Math.max(0.08, widthProfile[b] ?? 1)) * maxHalf;
    ctx.moveTo(cx - hwAt(0), yAt(0));
    for (let b = 1; b < n; b++) {
      ctx.lineTo(cx - hwAt(b), yAt(b));
    }
    for (let b = n - 1; b >= 0; b--) {
      ctx.lineTo(cx + hwAt(b), yAt(b));
    }
    ctx.closePath();
    ctx.fill();
    this._drawCenterLine();
  }

  /**
   * @returns {number[] | null} length {@link MIRROR_PROFILE_SAMPLES} multipliers, or null if empty
   */
  extractWidthProfile() {
    const ctx = this.ctx;
    if (!ctx) return null;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const cx = W / 2;
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const alphaAt = (x, y) => {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      if (xi < 0 || xi >= W || yi < 0 || yi >= H) return 0;
      return d[(yi * W + xi) * 4 + 3] ?? 0;
    };

    const bins = MIRROR_PROFILE_SAMPLES;
    const raw = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      const v = (b + 0.5) / bins;
      const y = (1 - v) * (H - 1);
      const y0 = Math.max(0, Math.floor(y - 1));
      const y1 = Math.min(H - 1, Math.ceil(y + 1));
      let maxD = 0;
      for (let yi = y0; yi <= y1; yi++) {
        for (let x = 0; x < W; x++) {
          if (alphaAt(x, yi) > 42) {
            const dist = Math.abs(x - cx);
            if (dist > maxD) maxD = dist;
          }
        }
      }
      raw[b] = maxD;
    }

    let peak = 0;
    for (let b = 0; b < bins; b++) {
      if (raw[b] > peak) peak = raw[b];
    }
    if (peak < 2.5) return null;

    const out = [];
    for (let b = 0; b < bins; b++) {
      let m = raw[b] / peak;
      m = Math.max(0.22, Math.min(1.95, m));
      out.push(m);
    }
    for (let pass = 0; pass < 1; pass++) {
      const sm = [...out];
      for (let b = 1; b < bins - 1; b++) {
        sm[b] = (out[b - 1] + out[b] * 2 + out[b + 1]) * 0.25;
      }
      for (let b = 1; b < bins - 1; b++) out[b] = sm[b];
    }
    return out;
  }

  bind() {
    if (this._bound) return;
    this.canvas.addEventListener("pointerdown", this._onDown);
    this.canvas.addEventListener("pointermove", this._onMove);
    this.canvas.addEventListener("pointerup", this._onUp);
    this.canvas.addEventListener("pointerleave", this._onUp);
    this._bound = true;
    this.clear();
  }

  unbind() {
    if (!this._bound) return;
    this.canvas.removeEventListener("pointerdown", this._onDown);
    this.canvas.removeEventListener("pointermove", this._onMove);
    this.canvas.removeEventListener("pointerup", this._onUp);
    this.canvas.removeEventListener("pointerleave", this._onUp);
    this._bound = false;
  }

  /**
   * @param {PointerEvent} e
   */
  _handleDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this._cssToCanvas(e);
    this._last = p;
  }

  /**
   * @param {PointerEvent} e
   */
  _handleMove(e) {
    if (!this._last) return;
    e.preventDefault();
    const p = this._cssToCanvas(e);
    this._strokeSegment(this._last.x, this._last.y, p.x, p.y);
    this._last = p;
  }

  /**
   * @param {PointerEvent} e
   */
  _handleUp(e) {
    if (!this._last) return;
    this._last = null;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }
}
