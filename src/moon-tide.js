/**
 * Moon-influenced tidal model for the excavated water table.
 * Semi-diurnal oscillation (two highs per lunar day) with a slower spring/neap envelope.
 */

export const MOON_TIDE_STORAGE_KEY = "world-maker-moon-tide";

/** @typedef {{ enabled: boolean, strengthM: number, semiDiurnalSec: number, lunarModulationSec: number }} MoonTideParams */

/** @type {MoonTideParams} */
export const DEFAULT_MOON_TIDE = {
  enabled: true,
  strengthM: 0.42,
  semiDiurnalSec: 90,
  lunarModulationSec: 800,
};

/** @type {MoonTideParams} */
let _live = { ...DEFAULT_MOON_TIDE };

/**
 * @returns {MoonTideParams}
 */
export function getMoonTideParams() {
  return _live;
}

/**
 * @param {unknown} raw
 * @returns {MoonTideParams}
 */
export function normalizeMoonTideParams(raw) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const d = DEFAULT_MOON_TIDE;
  const b = o.enabled === true || o.enabled === false ? o.enabled === true : d.enabled;
  const strengthM = clampNum(o.strengthM, 0, 2.5, d.strengthM);
  const semiDiurnalSec = clampNum(o.semiDiurnalSec, 20, 3600, d.semiDiurnalSec);
  const lunarModulationSec = clampNum(o.lunarModulationSec, 60, 7200, d.lunarModulationSec);
  return { enabled: b, strengthM, semiDiurnalSec, lunarModulationSec };
}

/**
 * @param {unknown} v
 * @param {number} lo
 * @param {number} hi
 * @param {number} fb
 */
function clampNum(v, lo, hi, fb) {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * @returns {MoonTideParams | null}
 */
export function loadMoonTideFromStorage() {
  try {
    const raw = localStorage.getItem(MOON_TIDE_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return normalizeMoonTideParams(o);
  } catch {
    return null;
  }
}

/**
 * @param {MoonTideParams} p
 */
export function saveMoonTideToStorage(p) {
  try {
    localStorage.setItem(MOON_TIDE_STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/**
 * @param {MoonTideParams} p
 */
export function setMoonTideParams(p) {
  _live = normalizeMoonTideParams(p);
}

/**
 * Read Simulation panel inputs into live params (e.g. after programmatic preset).
 */
export function syncMoonTideFromDom() {
  const en = document.getElementById("sim-moon-tide-enabled");
  const str = document.getElementById("sim-moon-tide-strength");
  const semi = document.getElementById("sim-moon-tide-semi");
  const lunar = document.getElementById("sim-moon-tide-lunar");
  _live = normalizeMoonTideParams({
    enabled: en instanceof HTMLInputElement ? en.checked : DEFAULT_MOON_TIDE.enabled,
    strengthM: str instanceof HTMLInputElement ? parseFloat(str.value) : DEFAULT_MOON_TIDE.strengthM,
    semiDiurnalSec: semi instanceof HTMLInputElement ? parseFloat(semi.value) : DEFAULT_MOON_TIDE.semiDiurnalSec,
    lunarModulationSec:
      lunar instanceof HTMLInputElement ? parseFloat(lunar.value) : DEFAULT_MOON_TIDE.lunarModulationSec,
  });
  saveMoonTideToStorage(_live);
}

/**
 * @param {number} elapsedSec
 * @param {MoonTideParams} [p]
 * @returns {{ offsetM: number, waveMul: number, phase01: number, envelope01: number, rising: boolean }}
 */
export function computeMoonTide(elapsedSec, p = _live) {
  if (!p.enabled) {
    return { offsetM: 0, waveMul: 1, phase01: 0.5, envelope01: 0.72, rising: true };
  }
  const T1 = Math.max(p.semiDiurnalSec, 1);
  const T2 = Math.max(p.lunarModulationSec, 1);
  const w1 = (2 * Math.PI) / T1;
  const w2 = (2 * Math.PI) / T2;
  const semi = Math.sin(elapsedSec * w1);
  /** Spring / neap: stronger when envelope peaks (simplified fortnightly beat). */
  const envelope = 0.72 + 0.28 * Math.sin(elapsedSec * w2);
  const offsetM = p.strengthM * semi * envelope;
  const waveMul = 1 + 0.14 * Math.max(0, semi) * (0.85 + 0.15 * envelope);
  const phase01 = semi * 0.5 + 0.5;
  const envelope01 = envelope;
  const rising = Math.cos(elapsedSec * w1) >= 0;
  return { offsetM, waveMul, phase01, envelope01, rising };
}

/**
 * @param {() => void} onChange
 */
export function initMoonTideControls({ onChange }) {
  const en = document.getElementById("sim-moon-tide-enabled");
  const str = document.getElementById("sim-moon-tide-strength");
  const semi = document.getElementById("sim-moon-tide-semi");
  const lunar = document.getElementById("sim-moon-tide-lunar");
  const vStr = document.getElementById("val-sim-moon-tide-strength");
  const vSemi = document.getElementById("val-sim-moon-tide-semi");
  const vLunar = document.getElementById("val-sim-moon-tide-lunar");

  const stored = loadMoonTideFromStorage();
  if (stored) {
    _live = stored;
  }

  function syncInputsFromLive() {
    if (en instanceof HTMLInputElement) en.checked = _live.enabled;
    if (str instanceof HTMLInputElement) str.value = String(_live.strengthM);
    if (semi instanceof HTMLInputElement) semi.value = String(_live.semiDiurnalSec);
    if (lunar instanceof HTMLInputElement) lunar.value = String(_live.lunarModulationSec);
    if (vStr) vStr.textContent = _live.strengthM.toFixed(2);
    if (vSemi) vSemi.textContent = String(Math.round(_live.semiDiurnalSec));
    if (vLunar) vLunar.textContent = String(Math.round(_live.lunarModulationSec));
  }

  function readFromDom() {
    _live = {
      enabled: en instanceof HTMLInputElement ? en.checked : DEFAULT_MOON_TIDE.enabled,
      strengthM: str instanceof HTMLInputElement ? parseFloat(str.value) : DEFAULT_MOON_TIDE.strengthM,
      semiDiurnalSec:
        semi instanceof HTMLInputElement ? parseFloat(semi.value) : DEFAULT_MOON_TIDE.semiDiurnalSec,
      lunarModulationSec:
        lunar instanceof HTMLInputElement ? parseFloat(lunar.value) : DEFAULT_MOON_TIDE.lunarModulationSec,
    };
    _live = normalizeMoonTideParams(_live);
    if (vStr && str instanceof HTMLInputElement) vStr.textContent = _live.strengthM.toFixed(2);
    if (vSemi && semi instanceof HTMLInputElement) vSemi.textContent = String(Math.round(_live.semiDiurnalSec));
    if (vLunar && lunar instanceof HTMLInputElement) vLunar.textContent = String(Math.round(_live.lunarModulationSec));
  }

  syncInputsFromLive();

  function commit() {
    readFromDom();
    saveMoonTideToStorage(_live);
    onChange();
  }

  en?.addEventListener("change", commit);
  str?.addEventListener("input", commit);
  semi?.addEventListener("input", commit);
  lunar?.addEventListener("input", commit);
}
