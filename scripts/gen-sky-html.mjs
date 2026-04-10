import { DEFAULT_SKY_TUNING } from "../src/sky-settings.js";

function kebab(k) {
  return k.replace(/([A-Z])/g, "-$1").toLowerCase();
}
function isColor(k, v) {
  return typeof v === "string" && v.startsWith("#");
}

/** @type {Record<string, { min: number, max: number, step: number }>} */
const BOUNDS = {
  sunAzimuthSpeed: { min: 0, max: 0.2, step: 0.001 },
  sunElevMin: { min: -0.5, max: 0.5, step: 0.005 },
  sunElevMax: { min: -0.2, max: 0.95, step: 0.005 },
  sunElevPiMul: { min: 0.1, max: 1.2, step: 0.005 },
  dayGradientLow: { min: -0.5, max: 0.4, step: 0.005 },
  dayGradientHigh: { min: 0.1, max: 1.2, step: 0.005 },
  antiSunStart: { min: -1, max: 1, step: 0.01 },
  antiSunEnd: { min: -1, max: 1, step: 0.01 },
  antiSunHorizonY0: { min: -0.5, max: 0.5, step: 0.01 },
  antiSunHorizonY1: { min: -0.6, max: 0.5, step: 0.01 },
  antiSunBlend: { min: 0, max: 1, step: 0.01 },
  antiSunWeight: { min: 0, max: 2, step: 0.01 },
  sunCorePow: { min: 40, max: 2000, step: 1 },
  sunCoreStr: { min: 0, max: 4, step: 0.01 },
  sunGlowWidePow: { min: 2, max: 64, step: 0.5 },
  sunGlowWideStr: { min: 0, max: 3, step: 0.01 },
  sunGlowMidPow: { min: 8, max: 256, step: 1 },
  sunGlowMidStr: { min: 0, max: 2, step: 0.01 },
  sunsetWarmStr: { min: 0, max: 4, step: 0.02 },
  sunsetPinkStr: { min: 0, max: 2, step: 0.02 },
  sunsetTowardPow: { min: 0.5, max: 8, step: 0.05 },
  sunsetMaskLow: { min: 0, max: 0.5, step: 0.01 },
  sunsetMaskMid: { min: 0, max: 0.5, step: 0.01 },
  sunsetMaskHigh: { min: 0.3, max: 0.8, step: 0.01 },
  sunsetMaskTop: { min: 0.5, max: 1, step: 0.01 },
  duskBlueStr: { min: 0, max: 1.5, step: 0.01 },
  duskYMin: { min: -0.5, max: 0.2, step: 0.01 },
  duskYMax: { min: 0, max: 0.5, step: 0.01 },
  nightFadeLow: { min: -0.8, max: 0.2, step: 0.01 },
  nightFadeHigh: { min: 0, max: 0.8, step: 0.01 },
  nightFadeYOffset: { min: -0.2, max: 0.3, step: 0.01 },
  dayHorizonLow: { min: 0.3, max: 1.2, step: 0.01 },
  dayHorizonHigh: { min: 0.5, max: 1.5, step: 0.01 },
  dayHorizonYMin: { min: -0.5, max: 0.1, step: 0.01 },
  dayHorizonYMax: { min: 0, max: 0.4, step: 0.01 },
  starExponentMul: { min: 0.25, max: 4, step: 0.05 },
  starMultMul: { min: 0.25, max: 4, step: 0.05 },
  starCullMul: { min: 0.5, max: 2, step: 0.01 },
  nightGroundStr: { min: 0, max: 3, step: 0.05 },
  cloudPanoH: { min: 0.2, max: 2, step: 0.01 },
  cloudPanoV: { min: 0.5, max: 2, step: 0.01 },
  cloudScale1: { min: 0.5, max: 8, step: 0.05 },
  cloudScale2: { min: 1, max: 16, step: 0.05 },
  cloudScale3: { min: 2, max: 24, step: 0.05 },
  cloudScroll1: { min: 0, max: 3, step: 0.05 },
  cloudScroll2: { min: 0, max: 4, step: 0.05 },
  cloudScroll3: { min: -2, max: 2, step: 0.05 },
  cloudSmoothMin: { min: 0, max: 0.95, step: 0.01 },
  cloudSmoothMax: { min: 0.05, max: 1, step: 0.01 },
  cloudNoiseW1: { min: 0, max: 1, step: 0.01 },
  cloudNoiseW2: { min: 0, max: 1, step: 0.01 },
  cloudNoiseW3: { min: 0, max: 1, step: 0.01 },
  cloudHorizonBandStart: { min: 0, max: 0.5, step: 0.01 },
  cloudHorizonBandEnd: { min: 0.5, max: 1, step: 0.01 },
  cloudHorizonBoost: { min: 0, max: 2, step: 0.01 },
  cloudCoverMul: { min: 0, max: 2, step: 0.01 },
  cloudStormCoverMul: { min: 0, max: 2, step: 0.01 },
  cloudAlphaBase: { min: 0, max: 1.5, step: 0.01 },
  cloudStormAlpha: { min: 0, max: 1, step: 0.01 },
  cloudElMin: { min: -1, max: 0, step: 0.01 },
  cloudElMax: { min: 0, max: 1, step: 0.01 },
  cloudDayMixMin: { min: 0, max: 1, step: 0.01 },
  cloudDayMixMax: { min: 0, max: 1, step: 0.01 },
  cloudDiffuseBase: { min: 0, max: 1, step: 0.01 },
  cloudDiffuseSun: { min: 0, max: 1.5, step: 0.01 },
  cloudStormDiffuse: { min: 0, max: 1, step: 0.01 },
  stormScreenTint: { min: 0, max: 1.5, step: 0.01 },
};

const parts = [];
for (const k of Object.keys(DEFAULT_SKY_TUNING)) {
  const v = DEFAULT_SKY_TUNING[k];
  const id = `set-sky-${kebab(k)}`;
  const vid = `val-sky-${kebab(k)}`;
  if (isColor(k, v)) {
    parts.push(
      `<label class="setting-row setting-row-tight"><span>${k}</span> <span id="${vid}">${v}</span><input type="color" id="${id}" value="${v}" /></label>`
    );
  } else {
    const b = BOUNDS[k] ?? { min: 0, max: 4, step: 0.01 };
    const vv = typeof v === "number" ? v : 0;
    const clamped = Math.min(b.max, Math.max(b.min, vv));
    parts.push(
      `<label class="setting-row setting-row-tight"><span>${k}</span> <span id="${vid}">${vv}</span><input type="range" id="${id}" min="${b.min}" max="${b.max}" step="${b.step}" value="${clamped}" /></label>`
    );
  }
}
console.log(parts.join("\n"));
