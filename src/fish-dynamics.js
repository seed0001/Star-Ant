/**
 * Procedural lake fish: body/tail/fin proportions, surface noise, swim motion.
 */

function finiteOr(n, fallback) {
  const v = typeof n === "number" ? n : parseFloat(String(n));
  return Number.isFinite(v) ? v : fallback;
}

function clampNum(n, a, b) {
  return Math.min(b, Math.max(a, n));
}

/**
 * @typedef {{
 *   bodyLengthMul: number,
 *   bodyDepthMul: number,
 *   tailLengthMul: number,
 *   tailWidthMul: number,
 *   finScale: number,
 *   dorsalScale: number,
 *   shapeNoiseAmp: number,
 *   shapeNoiseFreq: number,
 *   swimFreq: number,
 *   swimAmp: number,
 *   yawWander: number,
 *   depthMinFrac: number,
 *   depthMaxFrac: number,
 *   emissive: number,
 * }} FishDynamics
 */

/** @type {FishDynamics} */
export const DEFAULT_FISH_DYNAMICS = {
  bodyLengthMul: 1.15,
  bodyDepthMul: 1.0,
  tailLengthMul: 1.0,
  tailWidthMul: 1.0,
  finScale: 1.0,
  dorsalScale: 1.0,
  shapeNoiseAmp: 0.022,
  shapeNoiseFreq: 11,
  swimFreq: 1.35,
  swimAmp: 0.42,
  yawWander: 0.95,
  depthMinFrac: 0.12,
  depthMaxFrac: 0.88,
  emissive: 0.08,
};

/**
 * @param {unknown} raw
 * @returns {FishDynamics}
 */
export function normalizeFishDynamics(raw) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const d = DEFAULT_FISH_DYNAMICS;
  let depthMinFrac = clampNum(finiteOr(/** @type {number} */ (o.depthMinFrac), d.depthMinFrac), 0.02, 0.95);
  let depthMaxFrac = clampNum(finiteOr(/** @type {number} */ (o.depthMaxFrac), d.depthMaxFrac), 0.05, 0.98);
  if (depthMaxFrac < depthMinFrac + 0.03) depthMaxFrac = depthMinFrac + 0.03;
  return {
    bodyLengthMul: clampNum(finiteOr(/** @type {number} */ (o.bodyLengthMul), d.bodyLengthMul), 0.35, 2.2),
    bodyDepthMul: clampNum(finiteOr(/** @type {number} */ (o.bodyDepthMul), d.bodyDepthMul), 0.35, 2.2),
    tailLengthMul: clampNum(finiteOr(/** @type {number} */ (o.tailLengthMul), d.tailLengthMul), 0.3, 2.5),
    tailWidthMul: clampNum(finiteOr(/** @type {number} */ (o.tailWidthMul), d.tailWidthMul), 0.3, 2.2),
    finScale: clampNum(finiteOr(/** @type {number} */ (o.finScale), d.finScale), 0.2, 2.2),
    dorsalScale: clampNum(finiteOr(/** @type {number} */ (o.dorsalScale), d.dorsalScale), 0.2, 2.2),
    shapeNoiseAmp: clampNum(finiteOr(/** @type {number} */ (o.shapeNoiseAmp), d.shapeNoiseAmp), 0, 0.12),
    shapeNoiseFreq: clampNum(finiteOr(/** @type {number} */ (o.shapeNoiseFreq), d.shapeNoiseFreq), 2, 40),
    swimFreq: clampNum(finiteOr(/** @type {number} */ (o.swimFreq), d.swimFreq), 0.2, 4),
    swimAmp: clampNum(finiteOr(/** @type {number} */ (o.swimAmp), d.swimAmp), 0.05, 1.2),
    yawWander: clampNum(finiteOr(/** @type {number} */ (o.yawWander), d.yawWander), 0.2, 3),
    depthMinFrac,
    depthMaxFrac,
    emissive: clampNum(finiteOr(/** @type {number} */ (o.emissive), d.emissive), 0, 0.45),
  };
}
