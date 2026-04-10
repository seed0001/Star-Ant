/**
 * Butterfly swarm motion + procedural mesh tuning. Wind speed / direction come from
 * Weather settings; these knobs scale how the swarm uses them plus local oscillation.
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
 *   heightMin: number,
 *   heightMax: number,
 *   fieldSpreadMul: number,
 *   scaleMin: number,
 *   scaleRange: number,
 *   wanderFreqX: number,
 *   wanderFreqZ: number,
 *   wanderAmpX: number,
 *   wanderAmpZ: number,
 *   bobFreq: number,
 *   bobAmp: number,
 *   flapFreq: number,
 *   flapRotAmp: number,
 *   flapPitchMul: number,
 *   flapRollMul: number,
 *   yawSpin: number,
 *   driftBase: number,
 *   driftWindMul: number,
 *   windPushScale: number,
 *   windResponse: number,
 *   bodyLengthMul: number,
 *   bodyWidthMul: number,
 *   bodyThicknessMul: number,
 *   shapeNoiseAmp: number,
 *   shapeNoiseFreq: number,
 *   shapeNoiseFreq2: number,
 *   wingPairs: number,
 *   legCount: number,
 *   eyeOffsetX: number,
 *   eyeOffsetY: number,
 *   eyeOffsetZ: number,
 *   eyeSize: number,
 *   insectEmissive: number,
 *   wingStrokeFreq: number,
 *   wingStrokeAmp: number,
 *   legSwingFreq: number,
 *   legSwingAmp: number,
 *   pathBodyTilt: number,
 * }} ButterflyDynamics
 */

/** @type {ButterflyDynamics} */
export const DEFAULT_BUTTERFLY_DYNAMICS = {
  heightMin: 1.2,
  heightMax: 7.5,
  fieldSpreadMul: 0.92,
  scaleMin: 0.85,
  scaleRange: 0.35,
  wanderFreqX: 0.35,
  wanderFreqZ: 0.31,
  wanderAmpX: 1.8,
  wanderAmpZ: 1.6,
  bobFreq: 1.7,
  bobAmp: 0.45,
  flapFreq: 12,
  flapRotAmp: 0.85,
  flapPitchMul: 0.5,
  flapRollMul: 0.25,
  yawSpin: 0.15,
  driftBase: 0.22,
  driftWindMul: 0.18,
  windPushScale: 0.08,
  windResponse: 1,
  bodyLengthMul: 1.2,
  bodyWidthMul: 1.0,
  bodyThicknessMul: 1.05,
  /** CPU surface noise on body (amplitude + two spatial frequencies) */
  shapeNoiseAmp: 0.028,
  shapeNoiseFreq: 9,
  shapeNoiseFreq2: 14,
  wingPairs: 2,
  legCount: 6,
  eyeOffsetX: 0.04,
  eyeOffsetY: 0.0,
  eyeOffsetZ: 0.055,
  eyeSize: 0.02,
  /** Base emissive so the mesh stays visible (lighting + thin wings) */
  insectEmissive: 0.38,
  /** Wing beat in vertex shader (rad/s style multiplier with sin) */
  wingStrokeFreq: 18,
  wingStrokeAmp: 0.55,
  legSwingFreq: 7,
  legSwingAmp: 0.4,
  /** 0 = level body (wings/legs do motion); 1 = full legacy whole-body pitch/roll */
  pathBodyTilt: 0.12,
};

/**
 * @param {unknown} raw
 * @returns {ButterflyDynamics}
 */
export function normalizeButterflyDynamics(raw) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const d = DEFAULT_BUTTERFLY_DYNAMICS;
  let heightMin = clampNum(finiteOr(/** @type {number} */ (o.heightMin), d.heightMin), 0.1, 24);
  let heightMax = clampNum(finiteOr(/** @type {number} */ (o.heightMax), d.heightMax), 0.2, 30);
  if (heightMax < heightMin + 0.05) heightMax = heightMin + 0.05;
  return {
    heightMin,
    heightMax,
    fieldSpreadMul: clampNum(finiteOr(/** @type {number} */ (o.fieldSpreadMul), d.fieldSpreadMul), 0.2, 1.5),
    scaleMin: clampNum(finiteOr(/** @type {number} */ (o.scaleMin), d.scaleMin), 0.2, 2),
    scaleRange: clampNum(finiteOr(/** @type {number} */ (o.scaleRange), d.scaleRange), 0, 2),
    wanderFreqX: clampNum(finiteOr(/** @type {number} */ (o.wanderFreqX), d.wanderFreqX), 0.02, 6),
    wanderFreqZ: clampNum(finiteOr(/** @type {number} */ (o.wanderFreqZ), d.wanderFreqZ), 0.02, 6),
    wanderAmpX: clampNum(finiteOr(/** @type {number} */ (o.wanderAmpX), d.wanderAmpX), 0, 12),
    wanderAmpZ: clampNum(finiteOr(/** @type {number} */ (o.wanderAmpZ), d.wanderAmpZ), 0, 12),
    bobFreq: clampNum(finiteOr(/** @type {number} */ (o.bobFreq), d.bobFreq), 0, 10),
    bobAmp: clampNum(finiteOr(/** @type {number} */ (o.bobAmp), d.bobAmp), 0, 4),
    flapFreq: clampNum(finiteOr(/** @type {number} */ (o.flapFreq), d.flapFreq), 0, 48),
    flapRotAmp: clampNum(finiteOr(/** @type {number} */ (o.flapRotAmp), d.flapRotAmp), 0, 3),
    flapPitchMul: clampNum(finiteOr(/** @type {number} */ (o.flapPitchMul), d.flapPitchMul), 0, 2),
    flapRollMul: clampNum(finiteOr(/** @type {number} */ (o.flapRollMul), d.flapRollMul), 0, 2),
    yawSpin: clampNum(finiteOr(/** @type {number} */ (o.yawSpin), d.yawSpin), 0, 2),
    driftBase: clampNum(finiteOr(/** @type {number} */ (o.driftBase), d.driftBase), 0, 3),
    driftWindMul: clampNum(finiteOr(/** @type {number} */ (o.driftWindMul), d.driftWindMul), 0, 3),
    windPushScale: clampNum(finiteOr(/** @type {number} */ (o.windPushScale), d.windPushScale), 0, 0.5),
    windResponse: clampNum(finiteOr(/** @type {number} */ (o.windResponse), d.windResponse), 0, 3),
    bodyLengthMul: clampNum(finiteOr(/** @type {number} */ (o.bodyLengthMul), d.bodyLengthMul), 0.4, 2.5),
    bodyWidthMul: clampNum(finiteOr(/** @type {number} */ (o.bodyWidthMul), d.bodyWidthMul), 0.4, 2.5),
    bodyThicknessMul: clampNum(finiteOr(/** @type {number} */ (o.bodyThicknessMul), d.bodyThicknessMul), 0.4, 2.5),
    shapeNoiseAmp: clampNum(
      finiteOr(/** @type {number} */ (o.shapeNoiseAmp ?? o.bodyMassAmp), d.shapeNoiseAmp),
      0,
      0.15
    ),
    shapeNoiseFreq: clampNum(
      finiteOr(/** @type {number} */ (o.shapeNoiseFreq ?? o.bodyMassFreq1), d.shapeNoiseFreq),
      1,
      48
    ),
    shapeNoiseFreq2: clampNum(
      finiteOr(/** @type {number} */ (o.shapeNoiseFreq2 ?? o.bodyMassFreq2), d.shapeNoiseFreq2),
      1,
      48
    ),
    wingPairs: Math.round(
      clampNum(finiteOr(/** @type {number} */ (o.wingPairs), d.wingPairs), 1, 4)
    ),
    legCount: Math.round(clampNum(finiteOr(/** @type {number} */ (o.legCount), d.legCount), 0, 12)),
    eyeOffsetX: clampNum(finiteOr(/** @type {number} */ (o.eyeOffsetX), d.eyeOffsetX), 0, 0.12),
    eyeOffsetY: clampNum(finiteOr(/** @type {number} */ (o.eyeOffsetY), d.eyeOffsetY), -0.08, 0.12),
    eyeOffsetZ: clampNum(finiteOr(/** @type {number} */ (o.eyeOffsetZ), d.eyeOffsetZ), -0.02, 0.14),
    eyeSize: clampNum(finiteOr(/** @type {number} */ (o.eyeSize), d.eyeSize), 0.004, 0.06),
    insectEmissive: clampNum(finiteOr(/** @type {number} */ (o.insectEmissive), d.insectEmissive), 0, 1.2),
    wingStrokeFreq: clampNum(finiteOr(/** @type {number} */ (o.wingStrokeFreq), d.wingStrokeFreq), 0, 80),
    wingStrokeAmp: clampNum(finiteOr(/** @type {number} */ (o.wingStrokeAmp), d.wingStrokeAmp), 0, 1.2),
    legSwingFreq: clampNum(finiteOr(/** @type {number} */ (o.legSwingFreq), d.legSwingFreq), 0, 40),
    legSwingAmp: clampNum(finiteOr(/** @type {number} */ (o.legSwingAmp), d.legSwingAmp), 0, 1.2),
    pathBodyTilt: clampNum(finiteOr(/** @type {number} */ (o.pathBodyTilt), d.pathBodyTilt), 0, 1),
  };
}
