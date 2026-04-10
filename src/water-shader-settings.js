/**
 * Defaults and normalization for the excavated water-table shader (matches original tuned look).
 * @module
 */

import * as THREE from "three";

/**
 * @param {string} key camelCase key from {@link DEFAULT_WATER_SHADER}
 * @returns {string} e.g. waveTimeScale → "wave-time-scale"
 */
export function waterShaderKeyToKebab(key) {
  return key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * @param {string} key
 * @returns {string} range input id
 */
export function waterShaderRangeId(key) {
  return `set-water-${waterShaderKeyToKebab(key)}`;
}

/**
 * @param {string} key
 * @returns {string} value label id
 */
export function waterShaderValId(key) {
  return `val-water-${waterShaderKeyToKebab(key)}`;
}

/**
 * @param {string} key
 * @param {number} v
 */
export function formatWaterShaderValueLabel(key, v) {
  if (key === "glintGrid" || key === "specPowMin" || key === "specPowMax") return String(Math.round(v));
  return Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(2);
}

/** @type {Record<string, number | string>} */
export const DEFAULT_WATER_SHADER = {
  waveTimeScale: 1,
  waveAmp: 1,
  freq1: 0.42,
  freq2: 0.36,
  speed1: 1.05,
  speed2: 0.88,
  ampPrimary: 0.055,
  chopX: 0.88,
  chopZ: 0.74,
  chopSpeed: 0.62,
  chopAmp: 0.032,
  ripX: 1.9,
  ripZ: 1.7,
  ripSpdA: 0.35,
  ripSpdB: 0.41,
  ripAmp: 0.015,
  detX: 3.1,
  detZ: 2.4,
  detSpd: 1.2,
  detAmp: 0.008,
  normalEps: 0.18,
  discardBias: 0.035,
  depthAbsorb: 0.85,
  depthShallowEdge: 0.35,
  depthMidK: 0.25,
  depthDeepK: 1.2,
  fresnelPow: 3.5,
  specPowMin: 48,
  specPowMax: 96,
  specStrength: 0.85,
  reflNight: 0.25,
  reflDay: 0.55,
  foamStr: 1,
  foamStart: 0.22,
  foamEnd: 0.02,
  foamFx: 2.1,
  foamFz: 1.8,
  foamSpd: 2,
  glintGrid: 28,
  glintPow: 12,
  glintStr: 0.35,
  alphaMin: 0.42,
  alphaMax: 0.72,
  alphaFoam: 0.88,
  alphaDepth: 0.08,
  alphaClampLo: 0.35,
  alphaClampHi: 0.92,
  colorShallow: "#1f8a8a",
  colorMid: "#0f4a5c",
  colorDeep: "#08182c",
  colorFoam: "#eaf4f8",
  colorSkyRefl: "#7399cc",
  colorGlint: "#c0e8ff",
  colorSunSpec: "#fff8eb",
};

/**
 * Range inputs in Scene settings (Water tab). Bounds match {@link normalizeWaterShaderSettings}.
 * @type {Record<string, { min: number, max: number, step: number }>}
 */
export const WATER_SHADER_SLIDER = {
  waveTimeScale: { min: 0.05, max: 4, step: 0.05 },
  waveAmp: { min: 0, max: 3, step: 0.025 },
  freq1: { min: 0.05, max: 2, step: 0.01 },
  freq2: { min: 0.05, max: 2, step: 0.01 },
  speed1: { min: 0.1, max: 4, step: 0.05 },
  speed2: { min: 0.1, max: 4, step: 0.05 },
  ampPrimary: { min: 0, max: 0.2, step: 0.002 },
  chopX: { min: 0.1, max: 4, step: 0.02 },
  chopZ: { min: 0.1, max: 4, step: 0.02 },
  chopSpeed: { min: 0.05, max: 3, step: 0.02 },
  chopAmp: { min: 0, max: 0.12, step: 0.002 },
  ripX: { min: 0.5, max: 6, step: 0.05 },
  ripZ: { min: 0.5, max: 6, step: 0.05 },
  ripSpdA: { min: 0.05, max: 2, step: 0.02 },
  ripSpdB: { min: 0.05, max: 2, step: 0.02 },
  ripAmp: { min: 0, max: 0.08, step: 0.001 },
  detX: { min: 0.5, max: 10, step: 0.05 },
  detZ: { min: 0.5, max: 10, step: 0.05 },
  detSpd: { min: 0.1, max: 4, step: 0.05 },
  detAmp: { min: 0, max: 0.05, step: 0.0005 },
  normalEps: { min: 0.04, max: 0.55, step: 0.01 },
  discardBias: { min: 0.008, max: 0.12, step: 0.001 },
  depthAbsorb: { min: 0.1, max: 3, step: 0.02 },
  depthShallowEdge: { min: 0.05, max: 1.2, step: 0.01 },
  depthMidK: { min: 0.05, max: 1.5, step: 0.01 },
  depthDeepK: { min: 0.2, max: 4, step: 0.02 },
  fresnelPow: { min: 1, max: 10, step: 0.1 },
  specPowMin: { min: 8, max: 128, step: 1 },
  specPowMax: { min: 16, max: 256, step: 1 },
  specStrength: { min: 0, max: 2.5, step: 0.02 },
  reflNight: { min: 0, max: 1.5, step: 0.02 },
  reflDay: { min: 0, max: 2, step: 0.02 },
  foamStr: { min: 0, max: 2.5, step: 0.02 },
  foamStart: { min: 0.02, max: 0.6, step: 0.005 },
  foamEnd: { min: 0, max: 0.15, step: 0.002 },
  foamFx: { min: 0.2, max: 8, step: 0.05 },
  foamFz: { min: 0.2, max: 8, step: 0.05 },
  foamSpd: { min: 0, max: 6, step: 0.05 },
  glintGrid: { min: 6, max: 80, step: 1 },
  glintPow: { min: 2, max: 32, step: 0.5 },
  glintStr: { min: 0, max: 1.5, step: 0.02 },
  alphaMin: { min: 0.1, max: 0.95, step: 0.01 },
  alphaMax: { min: 0.2, max: 1, step: 0.01 },
  alphaFoam: { min: 0.3, max: 1, step: 0.01 },
  alphaDepth: { min: 0, max: 0.35, step: 0.005 },
  alphaClampLo: { min: 0.1, max: 0.9, step: 0.01 },
  alphaClampHi: { min: 0.4, max: 1, step: 0.01 },
};

/**
 * Default ShaderMaterial uniforms for the water table (colors as Vector3, filled by {@link applyWaterShaderMaterialUniforms}).
 */
export function createWaterShaderUniforms() {
  const d = DEFAULT_WATER_SHADER;
  const v3 = () => new THREE.Vector3();
  return {
    uWaveTimeScale: { value: d.waveTimeScale },
    uWaveAmp: { value: d.waveAmp },
    uFreq1: { value: d.freq1 },
    uFreq2: { value: d.freq2 },
    uSpeed1: { value: d.speed1 },
    uSpeed2: { value: d.speed2 },
    uAmpPrimary: { value: d.ampPrimary },
    uChopX: { value: d.chopX },
    uChopZ: { value: d.chopZ },
    uChopSpeed: { value: d.chopSpeed },
    uChopAmp: { value: d.chopAmp },
    uRipX: { value: d.ripX },
    uRipZ: { value: d.ripZ },
    uRipSpdA: { value: d.ripSpdA },
    uRipSpdB: { value: d.ripSpdB },
    uRipAmp: { value: d.ripAmp },
    uDetX: { value: d.detX },
    uDetZ: { value: d.detZ },
    uDetSpd: { value: d.detSpd },
    uDetAmp: { value: d.detAmp },
    uNormalEps: { value: d.normalEps },
    uDiscardBias: { value: d.discardBias },
    uDepthAbsorb: { value: d.depthAbsorb },
    uDepthShallowEdge: { value: d.depthShallowEdge },
    uDepthMidK: { value: d.depthMidK },
    uDepthDeepK: { value: d.depthDeepK },
    uFresnelPow: { value: d.fresnelPow },
    uSpecPowMin: { value: d.specPowMin },
    uSpecPowMax: { value: d.specPowMax },
    uSpecStrength: { value: d.specStrength },
    uReflNight: { value: d.reflNight },
    uReflDay: { value: d.reflDay },
    uFoamStr: { value: d.foamStr },
    uFoamStart: { value: d.foamStart },
    uFoamEnd: { value: d.foamEnd },
    uFoamFx: { value: d.foamFx },
    uFoamFz: { value: d.foamFz },
    uFoamSpd: { value: d.foamSpd },
    uGlintGrid: { value: d.glintGrid },
    uGlintPow: { value: d.glintPow },
    uGlintStr: { value: d.glintStr },
    uAlphaMin: { value: d.alphaMin },
    uAlphaMax: { value: d.alphaMax },
    uAlphaFoam: { value: d.alphaFoam },
    uAlphaDepth: { value: d.alphaDepth },
    uAlphaClampLo: { value: d.alphaClampLo },
    uAlphaClampHi: { value: d.alphaClampHi },
    uColorShallow: { value: v3() },
    uColorMid: { value: v3() },
    uColorDeep: { value: v3() },
    uColorFoam: { value: v3() },
    uColorSkyRefl: { value: v3() },
    uColorGlint: { value: v3() },
    uColorSunSpec: { value: v3() },
  };
}

/**
 * @param {unknown} raw
 */
function num(raw, key, lo, hi, fb) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const v = finite(/** @type {number} */ (o[key]), fb);
  return Math.min(hi, Math.max(lo, v));
}

/**
 * @param {unknown} n
 * @param {number} fb
 */
function finite(n, fb) {
  const v = typeof n === "number" ? n : parseFloat(String(n));
  return Number.isFinite(v) ? v : fb;
}

/**
 * @param {unknown} raw
 * @param {string} key
 * @param {string} fb
 */
function hexCol(raw, key, fb) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const s = typeof o[key] === "string" ? o[key].trim() : fb;
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s;
  if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
    const a = s.slice(1).split("");
    return `#${a[0]}${a[0]}${a[1]}${a[1]}${a[2]}${a[2]}`;
  }
  return fb;
}

/**
 * @param {unknown} raw
 */
export function normalizeWaterShaderSettings(raw) {
  const d = DEFAULT_WATER_SHADER;
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const out = {
    waveTimeScale: num(o, "waveTimeScale", 0.05, 4, finite(/** @type {number} */ (o.waveTimeScale), d.waveTimeScale)),
    waveAmp: num(o, "waveAmp", 0, 3, finite(/** @type {number} */ (o.waveAmp), d.waveAmp)),
    freq1: num(o, "freq1", 0.05, 2, finite(/** @type {number} */ (o.freq1), d.freq1)),
    freq2: num(o, "freq2", 0.05, 2, finite(/** @type {number} */ (o.freq2), d.freq2)),
    speed1: num(o, "speed1", 0.1, 4, finite(/** @type {number} */ (o.speed1), d.speed1)),
    speed2: num(o, "speed2", 0.1, 4, finite(/** @type {number} */ (o.speed2), d.speed2)),
    ampPrimary: num(o, "ampPrimary", 0, 0.2, finite(/** @type {number} */ (o.ampPrimary), d.ampPrimary)),
    chopX: num(o, "chopX", 0.1, 4, finite(/** @type {number} */ (o.chopX), d.chopX)),
    chopZ: num(o, "chopZ", 0.1, 4, finite(/** @type {number} */ (o.chopZ), d.chopZ)),
    chopSpeed: num(o, "chopSpeed", 0.05, 3, finite(/** @type {number} */ (o.chopSpeed), d.chopSpeed)),
    chopAmp: num(o, "chopAmp", 0, 0.12, finite(/** @type {number} */ (o.chopAmp), d.chopAmp)),
    ripX: num(o, "ripX", 0.5, 6, finite(/** @type {number} */ (o.ripX), d.ripX)),
    ripZ: num(o, "ripZ", 0.5, 6, finite(/** @type {number} */ (o.ripZ), d.ripZ)),
    ripSpdA: num(o, "ripSpdA", 0.05, 2, finite(/** @type {number} */ (o.ripSpdA), d.ripSpdA)),
    ripSpdB: num(o, "ripSpdB", 0.05, 2, finite(/** @type {number} */ (o.ripSpdB), d.ripSpdB)),
    ripAmp: num(o, "ripAmp", 0, 0.08, finite(/** @type {number} */ (o.ripAmp), d.ripAmp)),
    detX: num(o, "detX", 0.5, 10, finite(/** @type {number} */ (o.detX), d.detX)),
    detZ: num(o, "detZ", 0.5, 10, finite(/** @type {number} */ (o.detZ), d.detZ)),
    detSpd: num(o, "detSpd", 0.1, 4, finite(/** @type {number} */ (o.detSpd), d.detSpd)),
    detAmp: num(o, "detAmp", 0, 0.05, finite(/** @type {number} */ (o.detAmp), d.detAmp)),
    normalEps: num(o, "normalEps", 0.04, 0.55, finite(/** @type {number} */ (o.normalEps), d.normalEps)),
    discardBias: num(o, "discardBias", 0.008, 0.12, finite(/** @type {number} */ (o.discardBias), d.discardBias)),
    depthAbsorb: num(o, "depthAbsorb", 0.1, 3, finite(/** @type {number} */ (o.depthAbsorb), d.depthAbsorb)),
    depthShallowEdge: num(o, "depthShallowEdge", 0.05, 1.2, finite(/** @type {number} */ (o.depthShallowEdge), d.depthShallowEdge)),
    depthMidK: num(o, "depthMidK", 0.05, 1.5, finite(/** @type {number} */ (o.depthMidK), d.depthMidK)),
    depthDeepK: num(o, "depthDeepK", 0.2, 4, finite(/** @type {number} */ (o.depthDeepK), d.depthDeepK)),
    fresnelPow: num(o, "fresnelPow", 1, 10, finite(/** @type {number} */ (o.fresnelPow), d.fresnelPow)),
    specPowMin: num(o, "specPowMin", 8, 128, finite(/** @type {number} */ (o.specPowMin), d.specPowMin)),
    specPowMax: num(o, "specPowMax", 16, 256, finite(/** @type {number} */ (o.specPowMax), d.specPowMax)),
    specStrength: num(o, "specStrength", 0, 2.5, finite(/** @type {number} */ (o.specStrength), d.specStrength)),
    reflNight: num(o, "reflNight", 0, 1.5, finite(/** @type {number} */ (o.reflNight), d.reflNight)),
    reflDay: num(o, "reflDay", 0, 2, finite(/** @type {number} */ (o.reflDay), d.reflDay)),
    foamStr: num(o, "foamStr", 0, 2.5, finite(/** @type {number} */ (o.foamStr), d.foamStr)),
    foamStart: num(o, "foamStart", 0.02, 0.6, finite(/** @type {number} */ (o.foamStart), d.foamStart)),
    foamEnd: num(o, "foamEnd", 0, 0.15, finite(/** @type {number} */ (o.foamEnd), d.foamEnd)),
    foamFx: num(o, "foamFx", 0.2, 8, finite(/** @type {number} */ (o.foamFx), d.foamFx)),
    foamFz: num(o, "foamFz", 0.2, 8, finite(/** @type {number} */ (o.foamFz), d.foamFz)),
    foamSpd: num(o, "foamSpd", 0, 6, finite(/** @type {number} */ (o.foamSpd), d.foamSpd)),
    glintGrid: num(o, "glintGrid", 6, 80, finite(/** @type {number} */ (o.glintGrid), d.glintGrid)),
    glintPow: num(o, "glintPow", 2, 32, finite(/** @type {number} */ (o.glintPow), d.glintPow)),
    glintStr: num(o, "glintStr", 0, 1.5, finite(/** @type {number} */ (o.glintStr), d.glintStr)),
    alphaMin: num(o, "alphaMin", 0.1, 0.95, finite(/** @type {number} */ (o.alphaMin), d.alphaMin)),
    alphaMax: num(o, "alphaMax", 0.2, 1, finite(/** @type {number} */ (o.alphaMax), d.alphaMax)),
    alphaFoam: num(o, "alphaFoam", 0.3, 1, finite(/** @type {number} */ (o.alphaFoam), d.alphaFoam)),
    alphaDepth: num(o, "alphaDepth", 0, 0.35, finite(/** @type {number} */ (o.alphaDepth), d.alphaDepth)),
    alphaClampLo: num(o, "alphaClampLo", 0.1, 0.9, finite(/** @type {number} */ (o.alphaClampLo), d.alphaClampLo)),
    alphaClampHi: num(o, "alphaClampHi", 0.4, 1, finite(/** @type {number} */ (o.alphaClampHi), d.alphaClampHi)),
    colorShallow: hexCol(o, "colorShallow", d.colorShallow),
    colorMid: hexCol(o, "colorMid", d.colorMid),
    colorDeep: hexCol(o, "colorDeep", d.colorDeep),
    colorFoam: hexCol(o, "colorFoam", d.colorFoam),
    colorSkyRefl: hexCol(o, "colorSkyRefl", d.colorSkyRefl),
    colorGlint: hexCol(o, "colorGlint", d.colorGlint),
    colorSunSpec: hexCol(o, "colorSunSpec", d.colorSunSpec),
  };
  if (out.specPowMax < out.specPowMin) {
    const x = out.specPowMin;
    out.specPowMin = out.specPowMax;
    out.specPowMax = x;
  }
  if (out.alphaMax < out.alphaMin) {
    const x = out.alphaMin;
    out.alphaMin = out.alphaMax;
    out.alphaMax = x;
  }
  if (out.alphaClampHi < out.alphaClampLo) {
    const x = out.alphaClampLo;
    out.alphaClampLo = out.alphaClampHi;
    out.alphaClampHi = x;
  }
  if (out.foamStart < out.foamEnd) {
    const x = out.foamStart;
    out.foamStart = out.foamEnd;
    out.foamEnd = x;
  }
  return out;
}

const _c = new THREE.Color();

/**
 * Push normalized water settings into a ShaderMaterial (all uniforms must exist on material).
 * @param {THREE.ShaderMaterial | null | undefined} mat
 * @param {ReturnType<typeof normalizeWaterShaderSettings>} ws
 */
export function applyWaterShaderMaterialUniforms(mat, ws) {
  if (!mat?.uniforms || !ws) return;
  const u = mat.uniforms;
  const set = (name, val) => {
    if (u[name]) u[name].value = val;
  };
  const setV3 = (name, hex) => {
    if (!u[name]) return;
    _c.set(hex);
    u[name].value.set(_c.r, _c.g, _c.b);
  };

  set("uWaveTimeScale", ws.waveTimeScale);
  set("uWaveAmp", ws.waveAmp);
  set("uFreq1", ws.freq1);
  set("uFreq2", ws.freq2);
  set("uSpeed1", ws.speed1);
  set("uSpeed2", ws.speed2);
  set("uAmpPrimary", ws.ampPrimary);
  set("uChopX", ws.chopX);
  set("uChopZ", ws.chopZ);
  set("uChopSpeed", ws.chopSpeed);
  set("uChopAmp", ws.chopAmp);
  set("uRipX", ws.ripX);
  set("uRipZ", ws.ripZ);
  set("uRipSpdA", ws.ripSpdA);
  set("uRipSpdB", ws.ripSpdB);
  set("uRipAmp", ws.ripAmp);
  set("uDetX", ws.detX);
  set("uDetZ", ws.detZ);
  set("uDetSpd", ws.detSpd);
  set("uDetAmp", ws.detAmp);
  set("uNormalEps", ws.normalEps);
  set("uDiscardBias", ws.discardBias);
  set("uDepthAbsorb", ws.depthAbsorb);
  set("uDepthShallowEdge", ws.depthShallowEdge);
  set("uDepthMidK", ws.depthMidK);
  set("uDepthDeepK", ws.depthDeepK);
  set("uFresnelPow", ws.fresnelPow);
  set("uSpecPowMin", ws.specPowMin);
  set("uSpecPowMax", ws.specPowMax);
  set("uSpecStrength", ws.specStrength);
  set("uReflNight", ws.reflNight);
  set("uReflDay", ws.reflDay);
  set("uFoamStr", ws.foamStr);
  set("uFoamStart", ws.foamStart);
  set("uFoamEnd", ws.foamEnd);
  set("uFoamFx", ws.foamFx);
  set("uFoamFz", ws.foamFz);
  set("uFoamSpd", ws.foamSpd);
  set("uGlintGrid", ws.glintGrid);
  set("uGlintPow", ws.glintPow);
  set("uGlintStr", ws.glintStr);
  set("uAlphaMin", ws.alphaMin);
  set("uAlphaMax", ws.alphaMax);
  set("uAlphaFoam", ws.alphaFoam);
  set("uAlphaDepth", ws.alphaDepth);
  set("uAlphaClampLo", ws.alphaClampLo);
  set("uAlphaClampHi", ws.alphaClampHi);
  setV3("uColorShallow", ws.colorShallow);
  setV3("uColorMid", ws.colorMid);
  setV3("uColorDeep", ws.colorDeep);
  setV3("uColorFoam", ws.colorFoam);
  setV3("uColorSkyRefl", ws.colorSkyRefl);
  setV3("uColorGlint", ws.colorGlint);
  setV3("uColorSunSpec", ws.colorSunSpec);
}
