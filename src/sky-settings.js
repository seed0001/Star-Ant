/**
 * Fine-grained sky dome tuning (day gradient, sun disk, anti-sun, sunset, clouds, sun arc).
 * @module
 */

import * as THREE from "three";

/** @type {Record<string, unknown>} */
export const DEFAULT_SKY_TUNING = {
  // --- Sun arc (JS in SkyDome.update) ---
  sunAzimuthSpeed: 0.022,
  sunElevMin: -0.14,
  sunElevMax: 0.58,
  sunElevPiMul: 0.48,

  // --- Day gradient ---
  zenithColor: "#0a3870",
  horizonColor: "#9ec8f8",
  dayGradientLow: -0.05,
  dayGradientHigh: 0.72,

  // --- Anti-sun sector ---
  antiSunStart: 0.12,
  antiSunEnd: -0.78,
  antiSunHorizonY0: 0.1,
  antiSunHorizonY1: -0.28,
  oppCoolColor: "#1e293b",
  antiSunBlend: 0.62,
  antiSunWeight: 1,

  // --- Sun disk ---
  sunCorePow: 360,
  sunCoreStr: 1.38,
  sunGlowWidePow: 10,
  sunGlowWideStr: 0.42,
  sunGlowMidPow: 96,
  sunGlowMidStr: 0.26,
  sunDiskColor: "#fff8e0",

  // --- Sunset / dusk ---
  sunsetWarmStr: 1.4,
  sunsetWarmColor: "#ff6b1a",
  sunsetPinkStr: 0.55,
  sunsetPinkColor: "#ff8ca8",
  sunsetTowardPow: 2.5,
  sunsetMaskLow: 0.02,
  sunsetMaskMid: 0.28,
  sunsetMaskHigh: 0.42,
  sunsetMaskTop: 0.62,
  duskBlueStr: 0.55,
  duskBlueColor: "#405a9e",
  duskYMin: -0.2,
  duskYMax: 0.15,

  // --- Day/night horizon shaping ---
  nightFadeLow: -0.2,
  nightFadeHigh: 0.3,
  nightFadeYOffset: 0.1,
  dayHorizonLow: 0.82,
  dayHorizonHigh: 1,
  dayHorizonYMin: -0.18,
  dayHorizonYMax: 0.14,

  // --- Stars (multipliers on top of star-amount lerp) ---
  starExponentMul: 1,
  starMultMul: 1,
  starCullMul: 1,

  // --- Night ground glow ---
  nightGroundTint: "#0c0e12",
  nightGroundStr: 1,

  // --- Clouds ---
  cloudPanoH: 0.75,
  cloudPanoV: 1.1,
  cloudScale1: 2.4,
  cloudScale2: 5.1,
  cloudScale3: 11,
  cloudScroll1: 1,
  cloudScroll2: 1.65,
  cloudScroll3: -0.85,
  cloudSmoothMin: 0.38,
  cloudSmoothMax: 0.72,
  cloudNoiseW1: 0.55,
  cloudNoiseW2: 0.35,
  cloudNoiseW3: 0.15,
  cloudHorizonBandStart: 0.15,
  cloudHorizonBandEnd: 0.85,
  cloudHorizonBoost: 0.55,
  cloudCoverMul: 1,
  cloudStormCoverMul: 0.45,
  cloudAlphaBase: 0.55,
  cloudStormAlpha: 0.38,
  cloudElMin: -0.85,
  cloudElMax: 0.92,
  cloudDayMixMin: 0.2,
  cloudDayMixMax: 0.92,
  cloudLitColor: "#f5f8ff",
  cloudShadeBright: "#8c93a8",
  cloudShadeStorm: "#2e3038",
  cloudDiffuseBase: 0.35,
  cloudDiffuseSun: 0.65,
  cloudStormDiffuse: 0.85,
  stormScreenTint: 0.7,
};

/**
 * @param {unknown} raw
 */
export function normalizeSkyTuning(raw) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const d = DEFAULT_SKY_TUNING;
  const num = (k, lo, hi, fb) => {
    const v = o[k];
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) ? THREE.MathUtils.clamp(n, lo, hi) : /** @type {number} */ (fb);
  };
  const hex = (k, fb) => {
    const s = typeof o[k] === "string" ? o[k].trim() : fb;
    if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s;
    if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
      const a = s.slice(1).split("");
      return `#${a[0]}${a[0]}${a[1]}${a[1]}${a[2]}${a[2]}`;
    }
    return fb;
  };

  const out = {
    sunAzimuthSpeed: num("sunAzimuthSpeed", 0, 0.2, d.sunAzimuthSpeed),
    sunElevMin: num("sunElevMin", -0.5, 0.5, d.sunElevMin),
    sunElevMax: num("sunElevMax", -0.2, 0.95, d.sunElevMax),
    sunElevPiMul: num("sunElevPiMul", 0.1, 1.2, d.sunElevPiMul),

    zenithColor: hex("zenithColor", d.zenithColor),
    horizonColor: hex("horizonColor", d.horizonColor),
    dayGradientLow: num("dayGradientLow", -0.5, 0.4, d.dayGradientLow),
    dayGradientHigh: num("dayGradientHigh", 0.1, 1.2, d.dayGradientHigh),

    antiSunStart: num("antiSunStart", -1, 1, d.antiSunStart),
    antiSunEnd: num("antiSunEnd", -1, 1, d.antiSunEnd),
    antiSunHorizonY0: num("antiSunHorizonY0", -0.5, 0.5, d.antiSunHorizonY0),
    antiSunHorizonY1: num("antiSunHorizonY1", -0.6, 0.5, d.antiSunHorizonY1),
    oppCoolColor: hex("oppCoolColor", d.oppCoolColor),
    antiSunBlend: num("antiSunBlend", 0, 1, d.antiSunBlend),
    antiSunWeight: num("antiSunWeight", 0, 2, d.antiSunWeight),

    sunCorePow: num("sunCorePow", 40, 2000, d.sunCorePow),
    sunCoreStr: num("sunCoreStr", 0, 4, d.sunCoreStr),
    sunGlowWidePow: num("sunGlowWidePow", 2, 64, d.sunGlowWidePow),
    sunGlowWideStr: num("sunGlowWideStr", 0, 3, d.sunGlowWideStr),
    sunGlowMidPow: num("sunGlowMidPow", 8, 256, d.sunGlowMidPow),
    sunGlowMidStr: num("sunGlowMidStr", 0, 2, d.sunGlowMidStr),
    sunDiskColor: hex("sunDiskColor", d.sunDiskColor),

    sunsetWarmStr: num("sunsetWarmStr", 0, 4, d.sunsetWarmStr),
    sunsetWarmColor: hex("sunsetWarmColor", d.sunsetWarmColor),
    sunsetPinkStr: num("sunsetPinkStr", 0, 2, d.sunsetPinkStr),
    sunsetPinkColor: hex("sunsetPinkColor", d.sunsetPinkColor),
    sunsetTowardPow: num("sunsetTowardPow", 0.5, 8, d.sunsetTowardPow),
    sunsetMaskLow: num("sunsetMaskLow", 0, 0.5, d.sunsetMaskLow),
    sunsetMaskMid: num("sunsetMaskMid", 0, 0.5, d.sunsetMaskMid),
    sunsetMaskHigh: num("sunsetMaskHigh", 0.3, 0.8, d.sunsetMaskHigh),
    sunsetMaskTop: num("sunsetMaskTop", 0.5, 1, d.sunsetMaskTop),
    duskBlueStr: num("duskBlueStr", 0, 1.5, d.duskBlueStr),
    duskBlueColor: hex("duskBlueColor", d.duskBlueColor),
    duskYMin: num("duskYMin", -0.5, 0.2, d.duskYMin),
    duskYMax: num("duskYMax", 0, 0.5, d.duskYMax),

    nightFadeLow: num("nightFadeLow", -0.8, 0.2, d.nightFadeLow),
    nightFadeHigh: num("nightFadeHigh", 0, 0.8, d.nightFadeHigh),
    nightFadeYOffset: num("nightFadeYOffset", -0.2, 0.3, d.nightFadeYOffset),
    dayHorizonLow: num("dayHorizonLow", 0.3, 1.2, d.dayHorizonLow),
    dayHorizonHigh: num("dayHorizonHigh", 0.5, 1.5, d.dayHorizonHigh),
    dayHorizonYMin: num("dayHorizonYMin", -0.5, 0.1, d.dayHorizonYMin),
    dayHorizonYMax: num("dayHorizonYMax", 0, 0.4, d.dayHorizonYMax),

    starExponentMul: num("starExponentMul", 0.25, 4, d.starExponentMul),
    starMultMul: num("starMultMul", 0.25, 4, d.starMultMul),
    starCullMul: num("starCullMul", 0.5, 2, d.starCullMul),

    nightGroundTint: hex("nightGroundTint", d.nightGroundTint),
    nightGroundStr: num("nightGroundStr", 0, 3, d.nightGroundStr),

    cloudPanoH: num("cloudPanoH", 0.2, 2, d.cloudPanoH),
    cloudPanoV: num("cloudPanoV", 0.5, 2, d.cloudPanoV),
    cloudScale1: num("cloudScale1", 0.5, 8, d.cloudScale1),
    cloudScale2: num("cloudScale2", 1, 16, d.cloudScale2),
    cloudScale3: num("cloudScale3", 2, 24, d.cloudScale3),
    cloudScroll1: num("cloudScroll1", 0, 3, d.cloudScroll1),
    cloudScroll2: num("cloudScroll2", 0, 4, d.cloudScroll2),
    cloudScroll3: num("cloudScroll3", -2, 2, d.cloudScroll3),
    cloudSmoothMin: num("cloudSmoothMin", 0, 0.95, d.cloudSmoothMin),
    cloudSmoothMax: num("cloudSmoothMax", 0.05, 1, d.cloudSmoothMax),
    cloudNoiseW1: num("cloudNoiseW1", 0, 1, d.cloudNoiseW1),
    cloudNoiseW2: num("cloudNoiseW2", 0, 1, d.cloudNoiseW2),
    cloudNoiseW3: num("cloudNoiseW3", 0, 1, d.cloudNoiseW3),
    cloudHorizonBandStart: num("cloudHorizonBandStart", 0, 0.5, d.cloudHorizonBandStart),
    cloudHorizonBandEnd: num("cloudHorizonBandEnd", 0.5, 1, d.cloudHorizonBandEnd),
    cloudHorizonBoost: num("cloudHorizonBoost", 0, 2, d.cloudHorizonBoost),
    cloudCoverMul: num("cloudCoverMul", 0, 2, d.cloudCoverMul),
    cloudStormCoverMul: num("cloudStormCoverMul", 0, 2, d.cloudStormCoverMul),
    cloudAlphaBase: num("cloudAlphaBase", 0, 1.5, d.cloudAlphaBase),
    cloudStormAlpha: num("cloudStormAlpha", 0, 1, d.cloudStormAlpha),
    cloudElMin: num("cloudElMin", -1, 0, d.cloudElMin),
    cloudElMax: num("cloudElMax", 0, 1, d.cloudElMax),
    cloudDayMixMin: num("cloudDayMixMin", 0, 1, d.cloudDayMixMin),
    cloudDayMixMax: num("cloudDayMixMax", 0, 1, d.cloudDayMixMax),
    cloudLitColor: hex("cloudLitColor", d.cloudLitColor),
    cloudShadeBright: hex("cloudShadeBright", d.cloudShadeBright),
    cloudShadeStorm: hex("cloudShadeStorm", d.cloudShadeStorm),
    cloudDiffuseBase: num("cloudDiffuseBase", 0, 1, d.cloudDiffuseBase),
    cloudDiffuseSun: num("cloudDiffuseSun", 0, 1.5, d.cloudDiffuseSun),
    cloudStormDiffuse: num("cloudStormDiffuse", 0, 1, d.cloudStormDiffuse),
    stormScreenTint: num("stormScreenTint", 0, 1.5, d.stormScreenTint),
  };
  if (out.cloudSmoothMax <= out.cloudSmoothMin) {
    const x = out.cloudSmoothMin;
    out.cloudSmoothMin = out.cloudSmoothMax;
    out.cloudSmoothMax = x;
  }
  if (out.cloudHorizonBandEnd <= out.cloudHorizonBandStart) {
    const x = out.cloudHorizonBandStart;
    out.cloudHorizonBandStart = out.cloudHorizonBandEnd;
    out.cloudHorizonBandEnd = x;
  }
  if (out.dayGradientHigh <= out.dayGradientLow) {
    const x = out.dayGradientLow;
    out.dayGradientLow = out.dayGradientHigh;
    out.dayGradientHigh = x;
  }
  return out;
}

const _c = new THREE.Color();

/**
 * @param {THREE.ShaderMaterial} mat
 * @param {ReturnType<typeof normalizeSkyTuning>} t
 */
export function applySkyTuningToMaterial(mat) {
  if (!mat?.uniforms) return;
  const u = mat.uniforms;
  const setV3 = (name, hexStr) => {
    if (u[name]) _c.set(hexStr), u[name].value.set(_c.r, _c.g, _c.b);
  };
  const setF = (name, v) => {
    if (u[name]) u[name].value = v;
  };

  const t = arguments[1];
  if (!t) return;

  setV3("uZenithColor", t.zenithColor);
  setV3("uHorizonColor", t.horizonColor);
  setF("uDayGradientLow", t.dayGradientLow);
  setF("uDayGradientHigh", t.dayGradientHigh);

  setF("uAntiSunStart", t.antiSunStart);
  setF("uAntiSunEnd", t.antiSunEnd);
  setF("uAntiSunHorizonY0", t.antiSunHorizonY0);
  setF("uAntiSunHorizonY1", t.antiSunHorizonY1);
  setV3("uOppCoolColor", t.oppCoolColor);
  setF("uAntiSunBlend", t.antiSunBlend);
  setF("uAntiSunWeight", t.antiSunWeight);

  setF("uSunCorePow", t.sunCorePow);
  setF("uSunCoreStr", t.sunCoreStr);
  setF("uSunGlowWidePow", t.sunGlowWidePow);
  setF("uSunGlowWideStr", t.sunGlowWideStr);
  setF("uSunGlowMidPow", t.sunGlowMidPow);
  setF("uSunGlowMidStr", t.sunGlowMidStr);
  setV3("uSunDiskColor", t.sunDiskColor);

  setF("uSunsetWarmStr", t.sunsetWarmStr);
  setV3("uSunsetWarmColor", t.sunsetWarmColor);
  setF("uSunsetPinkStr", t.sunsetPinkStr);
  setV3("uSunsetPinkColor", t.sunsetPinkColor);
  setF("uSunsetTowardPow", t.sunsetTowardPow);
  setF("uSunsetMaskLow", t.sunsetMaskLow);
  setF("uSunsetMaskMid", t.sunsetMaskMid);
  setF("uSunsetMaskHigh", t.sunsetMaskHigh);
  setF("uSunsetMaskTop", t.sunsetMaskTop);
  setF("uDuskBlueStr", t.duskBlueStr);
  setV3("uDuskBlueColor", t.duskBlueColor);
  setF("uDuskYMin", t.duskYMin);
  setF("uDuskYMax", t.duskYMax);

  setF("uNightFadeLow", t.nightFadeLow);
  setF("uNightFadeHigh", t.nightFadeHigh);
  setF("uNightFadeYOffset", t.nightFadeYOffset);
  setF("uDayHorizonLow", t.dayHorizonLow);
  setF("uDayHorizonHigh", t.dayHorizonHigh);
  setF("uDayHorizonYMin", t.dayHorizonYMin);
  setF("uDayHorizonYMax", t.dayHorizonYMax);

  setF("uStarExponentMul", t.starExponentMul);
  setF("uStarMultMul", t.starMultMul);
  setF("uStarCullMul", t.starCullMul);

  setV3("uNightGroundTint", t.nightGroundTint);
  setF("uNightGroundStr", t.nightGroundStr);

  setF("uCloudPanoH", t.cloudPanoH);
  setF("uCloudPanoV", t.cloudPanoV);
  setF("uCloudScale1", t.cloudScale1);
  setF("uCloudScale2", t.cloudScale2);
  setF("uCloudScale3", t.cloudScale3);
  setF("uCloudScroll1", t.cloudScroll1);
  setF("uCloudScroll2", t.cloudScroll2);
  setF("uCloudScroll3", t.cloudScroll3);
  setF("uCloudSmoothMin", t.cloudSmoothMin);
  setF("uCloudSmoothMax", t.cloudSmoothMax);
  setF("uCloudNoiseW1", t.cloudNoiseW1);
  setF("uCloudNoiseW2", t.cloudNoiseW2);
  setF("uCloudNoiseW3", t.cloudNoiseW3);
  setF("uCloudHorizonBandStart", t.cloudHorizonBandStart);
  setF("uCloudHorizonBandEnd", t.cloudHorizonBandEnd);
  setF("uCloudHorizonBoost", t.cloudHorizonBoost);
  setF("uCloudCoverMul", t.cloudCoverMul);
  setF("uCloudStormCoverMul", t.cloudStormCoverMul);
  setF("uCloudAlphaBase", t.cloudAlphaBase);
  setF("uCloudStormAlpha", t.cloudStormAlpha);
  setF("uCloudElMin", t.cloudElMin);
  setF("uCloudElMax", t.cloudElMax);
  setF("uCloudDayMixMin", t.cloudDayMixMin);
  setF("uCloudDayMixMax", t.cloudDayMixMax);
  setV3("uCloudLitColor", t.cloudLitColor);
  setV3("uCloudShadeBright", t.cloudShadeBright);
  setV3("uCloudShadeStorm", t.cloudShadeStorm);
  setF("uCloudDiffuseBase", t.cloudDiffuseBase);
  setF("uCloudDiffuseSun", t.cloudDiffuseSun);
  setF("uCloudStormDiffuse", t.cloudStormDiffuse);
  setF("uStormScreenTint", t.stormScreenTint);
}

/**
 * Builds initial `ShaderMaterial` uniforms object (merged with time/dayPhase/sky-specific).
 */
export function createSkyTuningUniforms() {
  const t = normalizeSkyTuning({});
  const v3 = () => new THREE.Vector3();
  const u = {
    uZenithColor: { value: v3() },
    uHorizonColor: { value: v3() },
    uDayGradientLow: { value: t.dayGradientLow },
    uDayGradientHigh: { value: t.dayGradientHigh },
    uAntiSunStart: { value: t.antiSunStart },
    uAntiSunEnd: { value: t.antiSunEnd },
    uAntiSunHorizonY0: { value: t.antiSunHorizonY0 },
    uAntiSunHorizonY1: { value: t.antiSunHorizonY1 },
    uOppCoolColor: { value: v3() },
    uAntiSunBlend: { value: t.antiSunBlend },
    uAntiSunWeight: { value: t.antiSunWeight },
    uSunCorePow: { value: t.sunCorePow },
    uSunCoreStr: { value: t.sunCoreStr },
    uSunGlowWidePow: { value: t.sunGlowWidePow },
    uSunGlowWideStr: { value: t.sunGlowWideStr },
    uSunGlowMidPow: { value: t.sunGlowMidPow },
    uSunGlowMidStr: { value: t.sunGlowMidStr },
    uSunDiskColor: { value: v3() },
    uSunsetWarmStr: { value: t.sunsetWarmStr },
    uSunsetWarmColor: { value: v3() },
    uSunsetPinkStr: { value: t.sunsetPinkStr },
    uSunsetPinkColor: { value: v3() },
    uSunsetTowardPow: { value: t.sunsetTowardPow },
    uSunsetMaskLow: { value: t.sunsetMaskLow },
    uSunsetMaskMid: { value: t.sunsetMaskMid },
    uSunsetMaskHigh: { value: t.sunsetMaskHigh },
    uSunsetMaskTop: { value: t.sunsetMaskTop },
    uDuskBlueStr: { value: t.duskBlueStr },
    uDuskBlueColor: { value: v3() },
    uDuskYMin: { value: t.duskYMin },
    uDuskYMax: { value: t.duskYMax },
    uNightFadeLow: { value: t.nightFadeLow },
    uNightFadeHigh: { value: t.nightFadeHigh },
    uNightFadeYOffset: { value: t.nightFadeYOffset },
    uDayHorizonLow: { value: t.dayHorizonLow },
    uDayHorizonHigh: { value: t.dayHorizonHigh },
    uDayHorizonYMin: { value: t.dayHorizonYMin },
    uDayHorizonYMax: { value: t.dayHorizonYMax },
    uStarExponentMul: { value: t.starExponentMul },
    uStarMultMul: { value: t.starMultMul },
    uStarCullMul: { value: t.starCullMul },
    uNightGroundTint: { value: v3() },
    uNightGroundStr: { value: t.nightGroundStr },
    uCloudPanoH: { value: t.cloudPanoH },
    uCloudPanoV: { value: t.cloudPanoV },
    uCloudScale1: { value: t.cloudScale1 },
    uCloudScale2: { value: t.cloudScale2 },
    uCloudScale3: { value: t.cloudScale3 },
    uCloudScroll1: { value: t.cloudScroll1 },
    uCloudScroll2: { value: t.cloudScroll2 },
    uCloudScroll3: { value: t.cloudScroll3 },
    uCloudSmoothMin: { value: t.cloudSmoothMin },
    uCloudSmoothMax: { value: t.cloudSmoothMax },
    uCloudNoiseW1: { value: t.cloudNoiseW1 },
    uCloudNoiseW2: { value: t.cloudNoiseW2 },
    uCloudNoiseW3: { value: t.cloudNoiseW3 },
    uCloudHorizonBandStart: { value: t.cloudHorizonBandStart },
    uCloudHorizonBandEnd: { value: t.cloudHorizonBandEnd },
    uCloudHorizonBoost: { value: t.cloudHorizonBoost },
    uCloudCoverMul: { value: t.cloudCoverMul },
    uCloudStormCoverMul: { value: t.cloudStormCoverMul },
    uCloudAlphaBase: { value: t.cloudAlphaBase },
    uCloudStormAlpha: { value: t.cloudStormAlpha },
    uCloudElMin: { value: t.cloudElMin },
    uCloudElMax: { value: t.cloudElMax },
    uCloudDayMixMin: { value: t.cloudDayMixMin },
    uCloudDayMixMax: { value: t.cloudDayMixMax },
    uCloudLitColor: { value: v3() },
    uCloudShadeBright: { value: v3() },
    uCloudShadeStorm: { value: v3() },
    uCloudDiffuseBase: { value: t.cloudDiffuseBase },
    uCloudDiffuseSun: { value: t.cloudDiffuseSun },
    uCloudStormDiffuse: { value: t.cloudStormDiffuse },
    uStormScreenTint: { value: t.stormScreenTint },
  };
  applySkyTuningToMaterial({ uniforms: u }, t);
  return u;
}
