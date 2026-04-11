import { nearestFibonacciPetalCount, FLOWER_PETAL_WIDTH_PROFILE_LEN } from "./flowers.js";
import { TREE_FIELD_PRESET_NAMES } from "./trees.js";
import { normalizeButterflyDynamics, DEFAULT_BUTTERFLY_DYNAMICS } from "./butterfly-dynamics.js";
import { normalizeFishDynamics, DEFAULT_FISH_DYNAMICS } from "./fish-dynamics.js";
import { normalizeFishEcosystem, DEFAULT_FISH_ECOSYSTEM } from "./fish-ecosystem.js";
import { BOULDER_COUNT_MAX, ROCK_COUNT_MAX } from "./rocks.js";
import { BEE_HIVE_COUNT_MAX } from "./bee-hives.js";
import { TREE_WORLD_SCALE_MAX, TREE_WORLD_SCALE_MIN } from "./trees.js";
import {
  DEFAULT_WATER_SHADER,
  formatWaterShaderValueLabel,
  normalizeWaterShaderSettings,
  waterShaderRangeId,
  waterShaderValId,
} from "./water-shader-settings.js";
import { DEFAULT_SKY_TUNING, normalizeSkyTuning } from "./sky-settings.js";

/** Defaults aligned with ez-tree “Oak Medium”–style proportions (library units). */
const DEFAULT_TREE_SHAPE = {
  treeSpecies: "deciduous",
  treeTrunkRadius: 1.41,
  treeTrunkLength: 37.24,
  treeBranchLevels: 3,
  treeChildrenTrunk: 6,
  treeChildrenBranch: 4,
  treeChildrenSub: 3,
  treeCrownLengthMul: 1,
  treeLeafCount: 18,
  treeLeafSize: 2.5,
  treeLeafSizeVariance: 0.7,
  treeLeafBillboard: "double",
  treeBarkType: "oak",
  treeLeafType: "oak",
  treeBarkColor: "#fff9f1",
  treeLeafColor: "#5a8a50",
};

/**
 * @param {string} id
 * @param {number} fallback
 */
function readFloatInput(id, fallback) {
  const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
  const v = parseFloat(el?.value ?? String(fallback));
  return Number.isFinite(v) ? v : fallback;
}

function readWaterShaderFromDOM() {
  const d = DEFAULT_WATER_SHADER;
  const o = /** @type {Record<string, unknown>} */ ({});
  for (const key of Object.keys(d)) {
    const base = d[/** @type {keyof typeof d} */ (key)];
    if (typeof base === "number") {
      o[key] = readFloatInput(waterShaderRangeId(key), base);
    } else if (typeof base === "string" && key.startsWith("color")) {
      const el = /** @type {HTMLInputElement | null} */ (document.getElementById(waterShaderRangeId(key)));
      o[key] = el instanceof HTMLInputElement && el.type === "color" ? el.value : base;
    }
  }
  return normalizeWaterShaderSettings(o);
}

/**
 * @param {ReturnType<typeof normalizeWaterShaderSettings>} ws
 */
function applyWaterShaderToDOM(ws) {
  const setRange = (id, v) => {
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
    if (el) el.value = String(v);
  };
  const setVal = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  for (const key of Object.keys(DEFAULT_WATER_SHADER)) {
    const v = ws[/** @type {keyof typeof ws} */ (key)];
    if (typeof v === "number") {
      setRange(waterShaderRangeId(key), v);
      setVal(waterShaderValId(key), formatWaterShaderValueLabel(key, v));
    } else if (typeof v === "string" && key.startsWith("color")) {
      const el = /** @type {HTMLInputElement | null} */ (document.getElementById(waterShaderRangeId(key)));
      if (el instanceof HTMLInputElement) el.value = v;
    }
  }
}

/**
 * @param {string} id
 * @param {number} fallback
 */
function readIntInput(id, fallback) {
  const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
  const v = parseInt(el?.value ?? String(fallback), 10);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * @param {string} v
 * @param {string} field
 */
function finiteParse(v, field) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) {
    if (field === "width") return 0.08;
    if (field === "thickness") return 0.016;
    if (field === "height") return 1.2;
    if (field === "edge") return 0.3;
    if (field === "curveStrength") return 0.35;
    if (field === "cel") return 0;
    if (field === "curve") return 0;
    if (field === "share") return 100;
    if (field === "erosion") return 0.45;
    if (field === "streak") return 0.5;
    if (field === "bandV") return 2;
    if (field === "bandH") return 1;
  }
  return n;
}

/**
 * @param {HTMLElement} row
 * @param {string} field
 */
function updateBladeRowSpan(row, field) {
  const input = /** @type {HTMLInputElement | null} */ (row.querySelector(`input[data-field="${field}"]`));
  const span = row.querySelector(`[data-blade-val="${field}"]`);
  if (!input || !span) return;
  if (field === "width" || field === "thickness") {
    span.textContent = finiteParse(input.value, field).toFixed(3);
  } else if (field === "height") {
    span.textContent = finiteParse(input.value, field).toFixed(2);
  } else if (field === "edge" || field === "curveStrength" || field === "cel") {
    span.textContent = finiteParse(input.value, field).toFixed(2);
  } else if (field === "slices") {
    const n = parseInt(input.value, 10);
    span.textContent = String(Number.isFinite(n) ? Math.max(1, Math.min(16, n)) : 1);
  } else if (field === "share") {
    const n = Math.round(clampNum(finiteParse(input.value, "share"), 0, 100));
    span.textContent = String(n);
  } else if (field === "erosion" || field === "streak") {
    span.textContent = finiteParse(input.value, field).toFixed(2);
  } else if (field === "bandV" || field === "bandH") {
    const n = parseInt(input.value, 10);
    span.textContent = String(Number.isFinite(n) ? clampNum(n, 1, 8) : field === "bandV" ? 2 : 1);
  }
}

/**
 * @returns {Array<{ width: number, thickness: number, height: number, edgeNoise: number, color: string, slices: number, curveType: number, curveStrength: number, celShading: number, sharePercent: number }>}
 */
export function readBladePresetsFromDOM() {
  const rows = document.querySelectorAll("#blade-presets-list [data-blade-preset-row]");
  const presets = [];
  rows.forEach((row) => {
    const w = row.querySelector('[data-field="width"]');
    const t = row.querySelector('[data-field="thickness"]');
    const h = row.querySelector('[data-field="height"]');
    const e = row.querySelector('[data-field="edge"]');
    const sl = row.querySelector('[data-field="slices"]');
    const sh = row.querySelector('[data-field="share"]');
    const cv = row.querySelector('[data-field="curve"]');
    const cs = row.querySelector('[data-field="curveStrength"]');
    const cel = row.querySelector('[data-field="cel"]');
    const er = row.querySelector('[data-field="erosion"]');
    const str = row.querySelector('[data-field="streak"]');
    const c = row.querySelector('[data-field="color"]');
    const c2 = row.querySelector('[data-field="color2"]');
    const c3 = row.querySelector('[data-field="color3"]');
    const bv = row.querySelector('[data-field="bandV"]');
    const bh = row.querySelector('[data-field="bandH"]');
    const rawSlices = parseInt(/** @type {HTMLInputElement} */ (sl)?.value ?? "1", 10);
    const slices = Number.isFinite(rawSlices) ? Math.max(1, Math.min(16, rawSlices)) : 1;
    presets.push({
      width: finiteParse(/** @type {HTMLInputElement} */ (w)?.value ?? "0.08", "width"),
      thickness: finiteParse(/** @type {HTMLInputElement} */ (t)?.value ?? "0.016", "thickness"),
      height: finiteParse(/** @type {HTMLInputElement} */ (h)?.value ?? "1.2", "height"),
      edgeNoise: finiteParse(/** @type {HTMLInputElement} */ (e)?.value ?? "0.3", "edge"),
      slices,
      curveType: finiteParse(/** @type {HTMLSelectElement} */ (cv)?.value ?? "0", "curve"),
      curveStrength: finiteParse(/** @type {HTMLInputElement} */ (cs)?.value ?? "0.35", "curveStrength"),
      celShading: finiteParse(/** @type {HTMLInputElement} */ (cel)?.value ?? "0", "cel"),
      erosion: clampNum(finiteParse(/** @type {HTMLInputElement} */ (er)?.value ?? "0.45", "erosion"), 0, 1),
      streak: clampNum(finiteParse(/** @type {HTMLInputElement} */ (str)?.value ?? "0.5", "streak"), 0, 1),
      color: /** @type {HTMLInputElement} */ (c)?.value ?? "#3d8a42",
      color2: /** @type {HTMLInputElement} */ (c2)?.value ?? "#4a8f4a",
      color3: /** @type {HTMLInputElement} */ (c3)?.value ?? "#c8e8a8",
      colorBandV: clampNum(
        parseInt(/** @type {HTMLInputElement} */ (bv)?.value ?? "2", 10) || 2,
        1,
        8
      ),
      colorBandH: clampNum(
        parseInt(/** @type {HTMLInputElement} */ (bh)?.value ?? "1", 10) || 1,
        1,
        8
      ),
      sharePercent: clampNum(
        finiteParse(/** @type {HTMLInputElement} */ (sh)?.value ?? "100", "share"),
        0,
        100
      ),
    });
  });
  return presets;
}

/**
 * @param {HTMLElement} row
 * @param {string} field
 */
export function updateFlowerRowSpan(row, field) {
  const input = /** @type {HTMLInputElement | null} */ (row.querySelector(`input[data-field="${field}"]`));
  const span = row.querySelector(`[data-flower-val="${field}"]`);
  if (!input || !span) return;
  if (
    field === "petalLength" ||
    field === "stemWidth" ||
    field === "stemHeight" ||
    field === "centerDiscRadius"
  ) {
    span.textContent = parseFloat(input.value).toFixed(field === "stemWidth" ? 3 : 2);
  } else if (field === "centerDiscThickness") {
    span.textContent = parseFloat(input.value).toFixed(3);
  } else if (field === "clusterDensity" || field === "share") {
    span.textContent =
      field === "share"
        ? String(Math.round(clampNum(parseFloat(input.value) || 0, 0, 100)))
        : (parseFloat(input.value) || 0).toFixed(2);
  } else if (
    field === "petalGradientBlend" ||
    field === "petalEdgeNoise" ||
    field === "petalWarp" ||
    field === "petalRipple" ||
    field === "petalTipSharpness" ||
    field === "petalTipRoundness" ||
    field === "petalBloom" ||
    field === "centerDiscBulge" ||
    field === "pollenGrain"
  ) {
    span.textContent = (parseFloat(input.value) || 0).toFixed(2);
  } else if (field === "pollenRadius") {
    span.textContent = (parseFloat(input.value) || 0).toFixed(2);
  } else if (field === "pollenBrightness") {
    span.textContent = (parseFloat(input.value) || 0).toFixed(2);
  }
}

/**
 * Read one flower preset row (same shape as entries from {@link readFlowerPresetsFromDOM}).
 * @param {HTMLElement} row
 */
export function readFlowerPresetFromRow(row) {
  const sh = row.querySelector('[data-field="share"]');
  const pc = row.querySelector('[data-field="petalCount"]');
  const pl = row.querySelector('[data-field="petalLength"]');
  const sw = row.querySelector('[data-field="stemWidth"]');
  const shh = row.querySelector('[data-field="stemHeight"]');
  const cdr = row.querySelector('[data-field="centerDiscRadius"]');
  const cdt = row.querySelector('[data-field="centerDiscThickness"]');
  const cd = row.querySelector('[data-field="clusterDensity"]');
  const c = row.querySelector('[data-field="color"]');
  const c2 = row.querySelector('[data-field="color2"]');
  const c3 = row.querySelector('[data-field="color3"]');
  const c4 = row.querySelector('[data-field="color4"]');
  const c5 = row.querySelector('[data-field="color5"]');
  const cc = row.querySelector('[data-field="centerColor"]');
  const pol = row.querySelector('[data-field="pollenColor"]');
  const sc = row.querySelector('[data-field="stemColor"]');
  const pgb = row.querySelector('[data-field="petalGradientBlend"]');
  const pen = row.querySelector('[data-field="petalEdgeNoise"]');
  const pw = row.querySelector('[data-field="petalWarp"]');
  const prp = row.querySelector('[data-field="petalRipple"]');
  const prad = row.querySelector('[data-field="pollenRadius"]');
  const pgr = row.querySelector('[data-field="pollenGrain"]');
  const pbr = row.querySelector('[data-field="pollenBrightness"]');
  const rawPc = parseInt(/** @type {HTMLSelectElement} */ (pc)?.value ?? "8", 10);
  return {
    petalCount: nearestFibonacciPetalCount(Number.isFinite(rawPc) ? rawPc : 8),
    petalLength: parseFloat(/** @type {HTMLInputElement} */ (pl)?.value ?? "0.35") || 0.35,
    stemWidth: parseFloat(/** @type {HTMLInputElement} */ (sw)?.value ?? "0.022") || 0.022,
    stemHeight: parseFloat(/** @type {HTMLInputElement} */ (shh)?.value ?? "1.1") || 1.1,
    centerDiscRadius: clampNum(
      parseFloat(/** @type {HTMLInputElement} */ (cdr)?.value ?? "0.147") || 0.147,
      0.02,
      0.65
    ),
    centerDiscThickness: clampNum(
      parseFloat(/** @type {HTMLInputElement} */ (cdt)?.value ?? "0.012") || 0.012,
      0.001,
      0.12
    ),
    centerDiscBulge: clampNum(
      parseFloat(/** @type {HTMLInputElement} */ (row.querySelector('[data-field="centerDiscBulge"]'))?.value ?? "0.4") ||
        0.4,
      0,
      1
    ),
    clusterDensity: clampNum(parseFloat(/** @type {HTMLInputElement} */ (cd)?.value ?? "0.45") || 0.45, 0, 1),
    sharePercent: clampNum(parseFloat(/** @type {HTMLInputElement} */ (sh)?.value ?? "100") || 100, 0, 100),
    petalGradientBlend: clampNum(
      parseFloat(/** @type {HTMLInputElement} */ (pgb)?.value ?? "0.55") || 0.55,
      0,
      1
    ),
    petalEdgeNoise: clampNum(parseFloat(/** @type {HTMLInputElement} */ (pen)?.value ?? "0.35") || 0.35, 0, 1),
    petalWarp: clampNum(parseFloat(/** @type {HTMLInputElement} */ (pw)?.value ?? "0.28") || 0.28, 0, 1),
    petalRipple: clampNum(parseFloat(/** @type {HTMLInputElement} */ (prp)?.value ?? "0.22") || 0.22, 0, 1),
    petalTipSharpness: clampNum(
      parseFloat(
        /** @type {HTMLInputElement} */ (row.querySelector('[data-field="petalTipSharpness"]'))?.value ?? "0.25"
      ) || 0.25,
      0,
      1
    ),
    petalTipRoundness: clampNum(
      parseFloat(
        /** @type {HTMLInputElement} */ (row.querySelector('[data-field="petalTipRoundness"]'))?.value ?? "0.4"
      ) || 0.4,
      0,
      1
    ),
    petalBloom: clampNum(
      parseFloat(
        /** @type {HTMLInputElement} */ (row.querySelector('[data-field="petalBloom"]'))?.value ?? "0.55"
      ) || 0.55,
      0,
      1
    ),
    color: /** @type {HTMLInputElement} */ (c)?.value ?? "#f0e8ff",
    color2: /** @type {HTMLInputElement} */ (c2)?.value ?? "#e8a0d8",
    color3: /** @type {HTMLInputElement} */ (c3)?.value ?? "#ffe8f8",
    color4: /** @type {HTMLInputElement} */ (c4)?.value ?? "#f5c8e8",
    color5: /** @type {HTMLInputElement} */ (c5)?.value ?? "#ffffff",
    centerColor: /** @type {HTMLInputElement} */ (cc)?.value ?? "#4a3020",
    pollenColor: /** @type {HTMLInputElement} */ (pol)?.value ?? "#e8c830",
    pollenRadius: clampNum(parseFloat(/** @type {HTMLInputElement} */ (prad)?.value ?? "0.38") || 0.38, 0.05, 0.95),
    pollenGrain: clampNum(parseFloat(/** @type {HTMLInputElement} */ (pgr)?.value ?? "0.65") || 0.65, 0, 1),
    pollenBrightness: clampNum(parseFloat(/** @type {HTMLInputElement} */ (pbr)?.value ?? "1.05") || 1.05, 0.3, 2),
    stemColor: /** @type {HTMLInputElement} */ (sc)?.value ?? "#2d5a28",
    petalShapeCustom: (() => {
      const el = row.querySelector('[data-field="petalShapeCustom"]');
      if (el instanceof HTMLInputElement) return el.value === "true";
      return false;
    })(),
    petalShapes: (() => {
      const psj = row.querySelector('[data-field="petalShapesJson"]');
      if (!(psj instanceof HTMLInputElement) || !psj.value.trim()) return undefined;
      try {
        return JSON.parse(psj.value);
      } catch {
        return undefined;
      }
    })(),
  };
}

/**
 * @returns {Array<{ petalCount: number, petalLength: number, stemWidth: number, stemHeight: number, clusterDensity: number, sharePercent: number, color: string, color2: string, color3: string, centerColor: string, stemColor: string }>}
 */
export function readFlowerPresetsFromDOM() {
  const rows = document.querySelectorAll("#flower-presets-list [data-flower-preset-row]");
  const presets = [];
  rows.forEach((row) => {
    if (!(row instanceof HTMLElement)) return;
    presets.push(readFlowerPresetFromRow(row));
  });
  return presets;
}

/** @type {{ color: string, sharePercent: number }} */
const DEFAULT_CRITTER_PRESET = {
  color: "#ffffff",
  sharePercent: 100,
};

/**
 * @param {unknown} raw
 */
export function normalizeCritterPreset(raw) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  return {
    color: normalizeHexColor(/** @type {string} */ (o.color ?? DEFAULT_CRITTER_PRESET.color)),
    sharePercent: clampNum(
      finiteOr(/** @type {number} */ (o.sharePercent), DEFAULT_CRITTER_PRESET.sharePercent),
      0,
      100
    ),
  };
}

/**
 * Land vs water bird tint + field share (paired with the other habitat row).
 * @param {unknown} raw
 * @returns {{ color: string, sharePercent: number, habitat: 'land' | 'water' }}
 */
export function normalizeBirdPreset(raw) {
  const base = normalizeCritterPreset(raw);
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const h = o.habitat;
  const habitat = h === "water" ? "water" : "land";
  return { ...base, habitat };
}

/**
 * Always two rows: [land, water].
 * @param {unknown} raw
 * @returns {[ReturnType<typeof normalizeBirdPreset>, ReturnType<typeof normalizeBirdPreset>]}
 */
export function normalizeBirdPresets(raw) {
  const a = Array.isArray(raw) ? raw : [];
  const land = normalizeBirdPreset(a[0] ?? { habitat: "land", color: "#4a5568", sharePercent: 50 });
  const water = normalizeBirdPreset(a[1] ?? { habitat: "water", color: "#7a9abf", sharePercent: 50 });
  land.habitat = "land";
  water.habitat = "water";
  return [land, water];
}

/**
 * @param {HTMLElement} row
 * @param {string} field
 */
function updateCritterRowSpan(row, field) {
  const input = /** @type {HTMLInputElement | null} */ (row.querySelector(`input[data-field="${field}"]`));
  const span = row.querySelector(`[data-critter-val="${field}"]`);
  if (!input || !span) return;
  if (field === "share") {
    span.textContent = String(Math.round(clampNum(parseFloat(input.value) || 0, 0, 100)));
  }
}

/**
 * @returns {Array<{ color: string, sharePercent: number }>}
 */
export function readButterflyPresetsFromDOM() {
  const rows = document.querySelectorAll("#butterfly-presets-list [data-butterfly-preset-row]");
  const presets = [];
  rows.forEach((row) => {
    const sh = row.querySelector('[data-field="share"]');
    const c = row.querySelector('[data-field="color"]');
    presets.push({
      sharePercent: clampNum(parseFloat(/** @type {HTMLInputElement} */ (sh)?.value ?? "100") || 100, 0, 100),
      color: /** @type {HTMLInputElement} */ (c)?.value ?? "#ffaa44",
    });
  });
  return presets;
}

/**
 * @returns {Array<{ color: string, sharePercent: number }>}
 */
export function readLadybugPresetsFromDOM() {
  const rows = document.querySelectorAll("#ladybug-presets-list [data-ladybug-preset-row]");
  const presets = [];
  rows.forEach((row) => {
    const sh = row.querySelector('[data-field="share"]');
    const c = row.querySelector('[data-field="color"]');
    presets.push({
      sharePercent: clampNum(parseFloat(/** @type {HTMLInputElement} */ (sh)?.value ?? "100") || 100, 0, 100),
      color: /** @type {HTMLInputElement} */ (c)?.value ?? "#cc1122",
    });
  });
  return presets;
}

/**
 * @returns {Array<{ color: string, sharePercent: number }>}
 */
export function readBumblebeePresetsFromDOM() {
  const rows = document.querySelectorAll("#bumblebee-presets-list [data-bumblebee-preset-row]");
  const presets = [];
  rows.forEach((row) => {
    const sh = row.querySelector('[data-field="share"]');
    const c = row.querySelector('[data-field="color"]');
    presets.push({
      sharePercent: clampNum(parseFloat(/** @type {HTMLInputElement} */ (sh)?.value ?? "100") || 100, 0, 100),
      color: /** @type {HTMLInputElement} */ (c)?.value ?? "#e8c040",
    });
  });
  return presets;
}

/**
 * @returns {Array<{ color: string, sharePercent: number }>}
 */
export function readFireflyPresetsFromDOM() {
  const rows = document.querySelectorAll("#firefly-presets-list [data-firefly-preset-row]");
  const presets = [];
  rows.forEach((row) => {
    const sh = row.querySelector('[data-field="share"]');
    const c = row.querySelector('[data-field="color"]');
    presets.push({
      sharePercent: clampNum(parseFloat(/** @type {HTMLInputElement} */ (sh)?.value ?? "100") || 100, 0, 100),
      color: /** @type {HTMLInputElement} */ (c)?.value ?? "#b8ff66",
    });
  });
  return presets;
}

/**
 * @returns {Array<{ color: string, sharePercent: number }>}
 */
export function readAntPresetsFromDOM() {
  const rows = document.querySelectorAll("#ant-presets-list [data-ant-preset-row]");
  const presets = [];
  rows.forEach((row) => {
    const sh = row.querySelector('[data-field="share"]');
    const c = row.querySelector('[data-field="color"]');
    presets.push({
      sharePercent: clampNum(parseFloat(/** @type {HTMLInputElement} */ (sh)?.value ?? "100") || 100, 0, 100),
      color: /** @type {HTMLInputElement} */ (c)?.value ?? "#2a1e14",
    });
  });
  return presets;
}

/**
 * @returns {Array<{ color: string, sharePercent: number }>}
 */
export function readWormPresetsFromDOM() {
  const rows = document.querySelectorAll("#worm-presets-list [data-worm-preset-row]");
  const presets = [];
  rows.forEach((row) => {
    const sh = row.querySelector('[data-field="share"]');
    const c = row.querySelector('[data-field="color"]');
    presets.push({
      sharePercent: clampNum(parseFloat(/** @type {HTMLInputElement} */ (sh)?.value ?? "100") || 100, 0, 100),
      color: /** @type {HTMLInputElement} */ (c)?.value ?? "#8B6550",
    });
  });
  return presets;
}

/**
 * @returns {import("./butterfly-dynamics.js").ButterflyDynamics}
 */
export function readButterflyDynamicsFromDOM() {
  const d = DEFAULT_BUTTERFLY_DYNAMICS;
  return normalizeButterflyDynamics({
    heightMin: readFloatInput("set-bf-height-min", d.heightMin),
    heightMax: readFloatInput("set-bf-height-max", d.heightMax),
    fieldSpreadMul: readFloatInput("set-bf-field-spread-mul", d.fieldSpreadMul),
    scaleMin: readFloatInput("set-bf-scale-min", d.scaleMin),
    scaleRange: readFloatInput("set-bf-scale-range", d.scaleRange),
    wanderFreqX: readFloatInput("set-bf-wander-freq-x", d.wanderFreqX),
    wanderFreqZ: readFloatInput("set-bf-wander-freq-z", d.wanderFreqZ),
    wanderAmpX: readFloatInput("set-bf-wander-amp-x", d.wanderAmpX),
    wanderAmpZ: readFloatInput("set-bf-wander-amp-z", d.wanderAmpZ),
    bobFreq: readFloatInput("set-bf-bob-freq", d.bobFreq),
    bobAmp: readFloatInput("set-bf-bob-amp", d.bobAmp),
    flapFreq: readFloatInput("set-bf-flap-freq", d.flapFreq),
    flapRotAmp: readFloatInput("set-bf-flap-rot-amp", d.flapRotAmp),
    flapPitchMul: readFloatInput("set-bf-flap-pitch-mul", d.flapPitchMul),
    flapRollMul: readFloatInput("set-bf-flap-roll-mul", d.flapRollMul),
    yawSpin: readFloatInput("set-bf-yaw-spin", d.yawSpin),
    driftBase: readFloatInput("set-bf-drift-base", d.driftBase),
    driftWindMul: readFloatInput("set-bf-drift-wind-mul", d.driftWindMul),
    windPushScale: readFloatInput("set-bf-wind-push-scale", d.windPushScale),
    windResponse: readFloatInput("set-bf-wind-response", d.windResponse),
    bodyLengthMul: readFloatInput("set-bf-body-len-mul", d.bodyLengthMul),
    bodyWidthMul: readFloatInput("set-bf-body-width-mul", d.bodyWidthMul),
    bodyThicknessMul: readFloatInput("set-bf-body-thick-mul", d.bodyThicknessMul),
    shapeNoiseAmp: readFloatInput("set-bf-shape-noise-amp", d.shapeNoiseAmp),
    shapeNoiseFreq: readFloatInput("set-bf-shape-noise-f1", d.shapeNoiseFreq),
    shapeNoiseFreq2: readFloatInput("set-bf-shape-noise-f2", d.shapeNoiseFreq2),
    wingPairs: readIntInput("set-bf-wing-pairs", d.wingPairs),
    legCount: readIntInput("set-bf-leg-count", d.legCount),
    eyeOffsetX: readFloatInput("set-bf-eye-x", d.eyeOffsetX),
    eyeOffsetY: readFloatInput("set-bf-eye-y", d.eyeOffsetY),
    eyeOffsetZ: readFloatInput("set-bf-eye-z", d.eyeOffsetZ),
    eyeSize: readFloatInput("set-bf-eye-size", d.eyeSize),
    insectEmissive: readFloatInput("set-bf-insect-emissive", d.insectEmissive),
    wingStrokeFreq: readFloatInput("set-bf-wing-stroke-freq", d.wingStrokeFreq),
    wingStrokeAmp: readFloatInput("set-bf-wing-stroke-amp", d.wingStrokeAmp),
    legSwingFreq: readFloatInput("set-bf-leg-swing-freq", d.legSwingFreq),
    legSwingAmp: readFloatInput("set-bf-leg-swing-amp", d.legSwingAmp),
    pathBodyTilt: readFloatInput("set-bf-path-body-tilt", d.pathBodyTilt),
  });
}

/**
 * @returns {Array<{ color: string, sharePercent: number }>}
 */
/**
 * @returns {Array<{ color: string, sharePercent: number, habitat: 'land' | 'water' }>}
 */
export function readBirdPresetsFromDOM() {
  const rows = document.querySelectorAll("#bird-presets-list [data-bird-preset-row]");
  const presets = [];
  rows.forEach((row) => {
    if (!(row instanceof HTMLElement)) return;
    const sh = row.querySelector('[data-field="share"]');
    const c = row.querySelector('[data-field="color"]');
    const hab = row.getAttribute("data-habitat");
    presets.push({
      habitat: hab === "water" ? "water" : "land",
      sharePercent: clampNum(
        parseFloat(/** @type {HTMLInputElement} */ (sh)?.value ?? "50") || 50,
        0,
        100
      ),
      color: /** @type {HTMLInputElement} */ (c)?.value ?? "#4a5568",
    });
  });
  return normalizeBirdPresets(presets);
}

export function readFishPresetsFromDOM() {
  const rows = document.querySelectorAll("#fish-presets-list [data-fish-preset-row]");
  const presets = [];
  rows.forEach((row) => {
    const sh = row.querySelector('[data-field="share"]');
    const c = row.querySelector('[data-field="color"]');
    presets.push({
      sharePercent: clampNum(parseFloat(/** @type {HTMLInputElement} */ (sh)?.value ?? "100") || 100, 0, 100),
      color: /** @type {HTMLInputElement} */ (c)?.value ?? "#4a8fbe",
    });
  });
  return presets;
}

/**
 * @returns {import("./fish-dynamics.js").FishDynamics}
 */
/**
 * @returns {import("./fish-ecosystem.js").FishEcosystemSettings}
 */
export function readFishEcosystemFromDOM() {
  const d = DEFAULT_FISH_ECOSYSTEM;
  const get = (id) => /** @type {HTMLInputElement | null} */ (document.getElementById(id));
  return normalizeFishEcosystem({
    pelletCount: readIntInput("set-fish-eco-pellet-count", d.pelletCount),
    pelletSeed: readIntInput("set-fish-eco-pellet-seed", d.pelletSeed),
    pelletRegenPerSec: readFloatInput("set-fish-eco-regen", d.pelletRegenPerSec),
    hungerPerSec: readFloatInput("set-fish-eco-hunger", d.hungerPerSec),
    feedPellet: readFloatInput("set-fish-eco-feed-pellet", d.feedPellet),
    feedLadybug: readFloatInput("set-fish-eco-feed-ladybug", d.feedLadybug),
    feedSpider: readFloatInput("set-fish-eco-feed-spider", d.feedSpider),
    eatRadius: readFloatInput("set-fish-eco-eat-r", d.eatRadius),
    huntSteer: readFloatInput("set-fish-eco-hunt", d.huntSteer),
    pelletColor: get("set-fish-pellet-color")?.value ?? d.pelletColor,
    preyLadybugs:
      get("set-fish-eco-prey-ladybugs") instanceof HTMLInputElement
        ? /** @type {HTMLInputElement} */ (get("set-fish-eco-prey-ladybugs")).checked
        : true,
    preySpiderZones:
      get("set-fish-eco-prey-spider") instanceof HTMLInputElement
        ? /** @type {HTMLInputElement} */ (get("set-fish-eco-prey-spider")).checked
        : true,
  });
}

export function readFishDynamicsFromDOM() {
  const d = DEFAULT_FISH_DYNAMICS;
  return normalizeFishDynamics({
    bodyLengthMul: readFloatInput("set-fish-body-length-mul", d.bodyLengthMul),
    bodyDepthMul: readFloatInput("set-fish-body-depth-mul", d.bodyDepthMul),
    tailLengthMul: readFloatInput("set-fish-tail-length-mul", d.tailLengthMul),
    tailWidthMul: readFloatInput("set-fish-tail-width-mul", d.tailWidthMul),
    finScale: readFloatInput("set-fish-fin-scale", d.finScale),
    dorsalScale: readFloatInput("set-fish-dorsal-scale", d.dorsalScale),
    shapeNoiseAmp: readFloatInput("set-fish-shape-noise-amp", d.shapeNoiseAmp),
    shapeNoiseFreq: readFloatInput("set-fish-shape-noise-freq", d.shapeNoiseFreq),
    swimFreq: readFloatInput("set-fish-swim-freq", d.swimFreq),
    swimAmp: readFloatInput("set-fish-swim-amp", d.swimAmp),
    yawWander: readFloatInput("set-fish-yaw-wander", d.yawWander),
    depthMinFrac: readFloatInput("set-fish-depth-min", d.depthMinFrac),
    depthMaxFrac: readFloatInput("set-fish-depth-max", d.depthMaxFrac),
    emissive: readFloatInput("set-fish-emissive", d.emissive),
  });
}

/**
 * @param {string} skyKey camelCase key from {@link DEFAULT_SKY_TUNING}
 * @returns {string} e.g. sunAzimuthSpeed → set-sky-sun-azimuth-speed
 */
export function skyTuningKeyToDomId(skyKey) {
  return `set-sky-${skyKey.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
}

/**
 * @param {string} skyKey
 * @returns {string}
 */
export function skyTuningKeyToValId(skyKey) {
  return `val-sky-${skyKey.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
}

/**
 * Updates value spans next to sky advanced sliders (call after applySettings / import).
 * @param {unknown} skyDetail
 */
export function updateSkyTuningLabelSpans(skyDetail) {
  const n = normalizeSkyTuning(skyDetail);
  for (const k of Object.keys(DEFAULT_SKY_TUNING)) {
    const el = document.getElementById(skyTuningKeyToValId(k));
    if (!(el instanceof HTMLElement)) continue;
    const v = n[/** @type {keyof typeof n} */ (k)];
    if (typeof v === "string" && v.startsWith("#")) {
      el.textContent = v;
    } else if (typeof v === "number") {
      el.textContent = Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(2);
    }
  }
}

/**
 * Reads all advanced sky sliders / colors from the settings panel.
 * @returns {ReturnType<typeof normalizeSkyTuning>}
 */
export function readSkyTuningFromDOM() {
  const d = normalizeSkyTuning({});
  const raw = /** @type {Record<string, unknown>} */ ({});
  for (const k of Object.keys(DEFAULT_SKY_TUNING)) {
    const id = skyTuningKeyToDomId(k);
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
    if (el instanceof HTMLInputElement && el.type === "color") {
      raw[k] = el.value ?? d[/** @type {keyof typeof d} */ (k)];
    } else if (el instanceof HTMLInputElement) {
      const n = parseFloat(el.value);
      raw[k] = Number.isFinite(n) ? n : d[/** @type {keyof typeof d} */ (k)];
    } else {
      raw[k] = d[/** @type {keyof typeof d} */ (k)];
    }
  }
  return normalizeSkyTuning(raw);
}

/** @returns {Record<string, number | string | Array>} */
export function readSettingsFromDOM() {
  const get = (id) => /** @type {HTMLInputElement | null} */ (document.getElementById(id));
  return {
    grassCount: readIntInput("set-grass-count", 0),
    bladePresets: readBladePresetsFromDOM(),
    colorVariation: readFloatInput("set-color-variation", 1),
    flowerCount: readIntInput("set-flower-count", 0),
    flowerPresets: readFlowerPresetsFromDOM(),
    flowerColorVariation: readFloatInput("set-flower-color-variation", 1),
    groundColor: get("set-ground-color")?.value ?? "#5c4a3a",
    groundWarm: readFloatInput("set-ground-warm", 1),
    groundCool: readFloatInput("set-ground-cool", 1),
    groundMapMix: readFloatInput("set-ground-map-mix", 0.35),
    terrainAmplitude: readFloatInput("set-terrain-amplitude", 0),
    terrainFrequency: readFloatInput("set-terrain-frequency", 0.016),
    terrainOctaves: readIntInput("set-terrain-octaves", 5),
    terrainPersistence: readFloatInput("set-terrain-persistence", 0.52),
    terrainLacunarity: readFloatInput("set-terrain-lacunarity", 2.05),
    terrainRidge: readFloatInput("set-terrain-ridge", 0.35),
    terrainSeed: readIntInput("set-terrain-seed", 0),
    starAmount: readFloatInput("set-star-amount", 0),
    nebulaBlue: readFloatInput("set-nebula-blue", 1),
    nebulaPurple: readFloatInput("set-nebula-purple", 1),
    rainIntensity: readFloatInput("set-weather-rain", 0),
    snowIntensity: readFloatInput("set-weather-snow", 0),
    lightningIntensity: readFloatInput("set-weather-lightning", 0),
    cloudCover: readFloatInput("set-weather-clouds", 0),
    windSpeed: readFloatInput("set-wind-speed", 1),
    windDirection: readFloatInput("set-wind-direction", 0),
    audioVolume: readFloatInput("set-audio-volume", 1),
    audioMuted: !!(/** @type {HTMLInputElement | null} */ (document.getElementById("set-audio-muted")))
      ?.checked,
    treeCount: readIntInput("set-tree-count", 0),
    treePreset:
      /** @type {HTMLSelectElement | null} */ (document.getElementById("set-tree-preset"))?.value ??
      "Oak Medium",
    treeScale: readFloatInput("set-tree-scale", 0.1),
    treeFieldSeed: readIntInput("set-tree-field-seed", 42811),
    rockCount: readIntInput("set-rock-count", 0),
    boulderCount: readIntInput("set-boulder-count", 0),
    rockSeed: readIntInput("set-rock-seed", 28401),
    beeHiveCount: readIntInput("set-bee-hive-count", 0),
    beeHiveSeed: readIntInput("set-bee-hive-seed", 19283),
    treeSpecies:
      /** @type {HTMLSelectElement | null} */ (document.getElementById("set-tree-species"))?.value ??
      "deciduous",
    treeTrunkRadius: readFloatInput("set-tree-trunk-radius", DEFAULT_TREE_SHAPE.treeTrunkRadius),
    treeTrunkLength: readFloatInput("set-tree-trunk-length", DEFAULT_TREE_SHAPE.treeTrunkLength),
    treeBranchLevels: readIntInput("set-tree-branch-levels", DEFAULT_TREE_SHAPE.treeBranchLevels),
    treeChildrenTrunk: readIntInput("set-tree-children-trunk", DEFAULT_TREE_SHAPE.treeChildrenTrunk),
    treeChildrenBranch: readIntInput("set-tree-children-branch", DEFAULT_TREE_SHAPE.treeChildrenBranch),
    treeChildrenSub: readIntInput("set-tree-children-sub", DEFAULT_TREE_SHAPE.treeChildrenSub),
    treeCrownLengthMul: readFloatInput("set-tree-crown-mul", DEFAULT_TREE_SHAPE.treeCrownLengthMul),
    treeLeafCount: readIntInput("set-tree-leaf-count", DEFAULT_TREE_SHAPE.treeLeafCount),
    treeLeafSize: readFloatInput("set-tree-leaf-size", DEFAULT_TREE_SHAPE.treeLeafSize),
    treeLeafSizeVariance: readFloatInput(
      "set-tree-leaf-variance",
      DEFAULT_TREE_SHAPE.treeLeafSizeVariance
    ),
    treeLeafBillboard:
      /** @type {HTMLSelectElement | null} */ (document.getElementById("set-tree-leaf-billboard"))
        ?.value ?? "double",
    treeBarkType:
      /** @type {HTMLSelectElement | null} */ (document.getElementById("set-tree-bark-type"))?.value ??
      "oak",
    treeLeafType:
      /** @type {HTMLSelectElement | null} */ (document.getElementById("set-tree-leaf-type"))?.value ??
      "oak",
    treeBarkColor:
      /** @type {HTMLInputElement | null} */ (document.getElementById("set-tree-bark-color"))?.value ??
      DEFAULT_TREE_SHAPE.treeBarkColor,
    treeLeafColor:
      /** @type {HTMLInputElement | null} */ (document.getElementById("set-tree-leaf-color"))?.value ??
      DEFAULT_TREE_SHAPE.treeLeafColor,
    butterflyCount: readIntInput("set-butterfly-count", 0),
    butterflyPresets: readButterflyPresetsFromDOM(),
    butterflySeed: readIntInput("set-butterfly-seed", 7103),
    butterflyDynamics: readButterflyDynamicsFromDOM(),
    ladybugCount: readIntInput("set-ladybug-count", 0),
    ladybugPresets: readLadybugPresetsFromDOM(),
    ladybugTreeShare: readFloatInput("set-ladybug-tree-share", 0.45),
    ladybugSeed: readIntInput("set-ladybug-seed", 9023),
    bumblebeeCount: readIntInput("set-bumblebee-count", 0),
    bumblebeePresets: readBumblebeePresetsFromDOM(),
    bumblebeeSeed: readIntInput("set-bumblebee-seed", 7142),
    spiderWebCount: readIntInput("set-spider-web-count", 0),
    spiderSeed: readIntInput("set-spider-seed", 4411),
    fireflyCount: readIntInput("set-firefly-count", 0),
    fireflyPresets: readFireflyPresetsFromDOM(),
    fireflySeed: readIntInput("set-firefly-seed", 3341),
    antCount: readIntInput("set-ant-count", 0),
    antPresets: readAntPresetsFromDOM(),
    antSeed: readIntInput("set-ant-seed", 5581),
    wormCount: readIntInput("set-worm-count", 0),
    wormPresets: readWormPresetsFromDOM(),
    wormSeed: readIntInput("set-worm-seed", 7721),
    birdCount: readIntInput("set-bird-count", 80),
    birdPresets: readBirdPresetsFromDOM(),
    birdSeed: readIntInput("set-bird-seed", 8843),
    fishCount: readIntInput("set-fish-count", 0),
    fishPresets: readFishPresetsFromDOM(),
    fishSeed: readIntInput("set-fish-seed", 3311),
    fishDynamics: readFishDynamicsFromDOM(),
    fishEcosystem: readFishEcosystemFromDOM(),
    waterShader: readWaterShaderFromDOM(),
    skyDetail: readSkyTuningFromDOM(),
  };
}

/** Stable identifier for consumers (importers, tooling). */
export const ENVIRONMENT_FORMAT_ID = "grass-world-environment";

/** Bump when the `settings` object shape changes. */
export const ENVIRONMENT_SCHEMA_VERSION = 38;

/** Browser persistence for the last Scene settings (grass, trees, weather, etc.). */
export const ENVIRONMENT_AUTOSAVE_STORAGE_KEY = "gwEnvironmentSettingsV1";

const GRASS_COUNT_MIN = 0;
const GRASS_COUNT_MAX = 10_000_000;

const FLOWER_COUNT_MIN = 0;
const FLOWER_COUNT_MAX = 100000;

const TREE_COUNT_MIN = 0;
const TREE_COUNT_MAX = 48;

const ROCK_COUNT_MIN = 0;
const BOULDER_COUNT_MIN = 0;

const BUTTERFLY_COUNT_MIN = 0;
const BUTTERFLY_COUNT_MAX = 5000;
const LADYBUG_COUNT_MIN = 0;
const LADYBUG_COUNT_MAX = 5000;
const FIREFLY_COUNT_MIN = 0;
const FIREFLY_COUNT_MAX = 2000;
const SPIDER_WEB_COUNT_MIN = 0;
const SPIDER_WEB_COUNT_MAX = 48;
const ANT_COUNT_MIN = 0;
const ANT_COUNT_MAX = 8000;
const WORM_COUNT_MIN = 0;
const WORM_COUNT_MAX = 4000;
const FISH_COUNT_MIN = 0;
const FISH_COUNT_MAX = 3000;
const BIRD_COUNT_MIN = 0;
const BIRD_COUNT_MAX = 2000;
const BUMBLEBEE_COUNT_MIN = 0;
const BUMBLEBEE_COUNT_MAX = 5000;
const MAX_CRITTER_TYPES = 48;

const BARK_TYPES = ["birch", "oak", "pine", "willow"];
const LEAF_TYPES = ["ash", "aspen", "oak", "pine"];

/**
 * @param {unknown} raw
 */
function normalizeTreeBarkType(raw) {
  const s = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  return BARK_TYPES.includes(s) ? s : DEFAULT_TREE_SHAPE.treeBarkType;
}

/**
 * @param {unknown} raw
 */
function normalizeTreeLeafType(raw) {
  const s = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  return LEAF_TYPES.includes(s) ? s : DEFAULT_TREE_SHAPE.treeLeafType;
}

/**
 * @param {unknown} raw
 */
function normalizeTreeLeafBillboard(raw) {
  return raw === "single" ? "single" : "double";
}

/**
 * Normalized tree shape (trunk, branching, foliage, colors).
 * @typedef {{
 *   treeSpecies: 'deciduous' | 'evergreen',
 *   treeTrunkRadius: number,
 *   treeTrunkLength: number,
 *   treeBranchLevels: number,
 *   treeChildrenTrunk: number,
 *   treeChildrenBranch: number,
 *   treeChildrenSub: number,
 *   treeCrownLengthMul: number,
 *   treeLeafCount: number,
 *   treeLeafSize: number,
 *   treeLeafSizeVariance: number,
 *   treeLeafBillboard: 'single' | 'double',
 *   treeBarkType: string,
 *   treeLeafType: string,
 *   treeBarkColor: string,
 *   treeLeafColor: string,
 * }} NormalizedTreeShape
 */

/**
 * @param {unknown} raw
 * @returns {NormalizedTreeShape}
 */
export function normalizeTreeShapeFields(raw) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  return {
    treeSpecies: o.treeSpecies === "evergreen" ? "evergreen" : "deciduous",
    treeTrunkRadius: clampNum(
      finiteOr(/** @type {number} */ (o.treeTrunkRadius), DEFAULT_TREE_SHAPE.treeTrunkRadius),
      0.15,
      10
    ),
    treeTrunkLength: clampNum(
      finiteOr(/** @type {number} */ (o.treeTrunkLength), DEFAULT_TREE_SHAPE.treeTrunkLength),
      4,
      140
    ),
    treeBranchLevels: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.treeBranchLevels), DEFAULT_TREE_SHAPE.treeBranchLevels)),
      0,
      4
    ),
    treeChildrenTrunk: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.treeChildrenTrunk), DEFAULT_TREE_SHAPE.treeChildrenTrunk)),
      1,
      20
    ),
    treeChildrenBranch: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.treeChildrenBranch), DEFAULT_TREE_SHAPE.treeChildrenBranch)),
      1,
      20
    ),
    treeChildrenSub: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.treeChildrenSub), DEFAULT_TREE_SHAPE.treeChildrenSub)),
      1,
      20
    ),
    treeCrownLengthMul: clampNum(
      finiteOr(/** @type {number} */ (o.treeCrownLengthMul), DEFAULT_TREE_SHAPE.treeCrownLengthMul),
      0.2,
      3
    ),
    treeLeafCount: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.treeLeafCount), DEFAULT_TREE_SHAPE.treeLeafCount)),
      1,
      200
    ),
    treeLeafSize: clampNum(
      finiteOr(/** @type {number} */ (o.treeLeafSize), DEFAULT_TREE_SHAPE.treeLeafSize),
      0.35,
      14
    ),
    treeLeafSizeVariance: clampNum(
      finiteOr(/** @type {number} */ (o.treeLeafSizeVariance), DEFAULT_TREE_SHAPE.treeLeafSizeVariance),
      0,
      1
    ),
    treeLeafBillboard: normalizeTreeLeafBillboard(o.treeLeafBillboard),
    treeBarkType: normalizeTreeBarkType(o.treeBarkType),
    treeLeafType: normalizeTreeLeafType(o.treeLeafType),
    treeBarkColor: normalizeHexColor(/** @type {string} */ (o.treeBarkColor ?? DEFAULT_TREE_SHAPE.treeBarkColor)),
    treeLeafColor: normalizeHexColor(/** @type {string} */ (o.treeLeafColor ?? DEFAULT_TREE_SHAPE.treeLeafColor)),
  };
}

/** @type {{ width: number, thickness: number, height: number, edgeNoise: number, slices: number, curveType: number, curveStrength: number, celShading: number, color: string, color2: string, color3: string, colorBandV: number, colorBandH: number, sharePercent: number, erosion: number, streak: number }} */
const DEFAULT_BLADE_PRESET = {
  width: 0.08,
  thickness: 0.016,
  height: 1.2,
  edgeNoise: 0.3,
  slices: 1,
  curveType: 0,
  curveStrength: 0.35,
  celShading: 0,
  color: "#3d8a42",
  sharePercent: 100,
  erosion: 0.45,
  streak: 0.5,
  color2: "#4a8f4a",
  color3: "#c8e8a8",
  colorBandV: 2,
  colorBandH: 1,
};

/** @type {{ petalCount: number, petalLength: number, stemWidth: number, stemHeight: number, centerDiscRadius: number, centerDiscThickness: number, clusterDensity: number, sharePercent: number, petalGradientBlend: number, petalEdgeNoise: number, petalWarp: number, petalRipple: number, petalTipSharpness: number, petalTipRoundness: number, color: string, color2: string, color3: string, color4: string, color5: string, centerColor: string, pollenColor: string, pollenRadius: number, pollenGrain: number, pollenBrightness: number, stemColor: string }} */
const DEFAULT_FLOWER_PRESET = {
  petalCount: 8,
  petalLength: 0.35,
  stemWidth: 0.022,
  stemHeight: 1.1,
  centerDiscRadius: 0.147,
  centerDiscThickness: 0.012,
  /** 0 = flat receptacle, 1 = deep inverted dome (bowl / bulb). */
  centerDiscBulge: 0.4,
  clusterDensity: 0.45,
  sharePercent: 100,
  petalGradientBlend: 0.55,
  petalEdgeNoise: 0.35,
  petalWarp: 0.28,
  petalRipple: 0.22,
  petalTipSharpness: 0.25,
  petalTipRoundness: 0.4,
  /** 0 = tight bud, 1 = wide open bloom (geometry). */
  petalBloom: 0.55,
  color: "#f0e8ff",
  color2: "#e8a0d8",
  color3: "#ffe8f8",
  color4: "#f5c8e8",
  color5: "#ffffff",
  centerColor: "#4a3020",
  pollenColor: "#e8c830",
  pollenRadius: 0.38,
  pollenGrain: 0.65,
  pollenBrightness: 1.05,
  stemColor: "#2d5a28",
  /** When true, flower may spawn in submerged areas (e.g. emergent wetland species). */
  toleratesWater: false,
  /** Per-petal mirror-draw width profile; null = default procedural silhouette. */
  petalShapes: null,
  /** When true, {@link petalShapes} modulates mesh width; when false, use procedural (golden / φ) outline only. */
  petalShapeCustom: false,
};

/**
 * @param {number} n
 * @param {number} a
 * @param {number} b
 */
function clampNum(n, a, b) {
  return Math.min(b, Math.max(a, n));
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeTreePresetName(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s && TREE_FIELD_PRESET_NAMES.includes(s)) return s;
  return "Oak Medium";
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function normalizeHexColor(v) {
  if (typeof v !== "string") return "#ffffff";
  const s = v.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return "#ffffff";
}

/**
 * @param {unknown} raw
 * @returns {object} normalized blade preset (includes color2, color3, colorBandV, colorBandH)
 */
export function normalizeBladePreset(raw) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const w = finiteOr(/** @type {number} */ (o.width), DEFAULT_BLADE_PRESET.width);
  const t = finiteOr(/** @type {number} */ (o.thickness), DEFAULT_BLADE_PRESET.thickness);
  const h = finiteOr(/** @type {number} */ (o.height), DEFAULT_BLADE_PRESET.height);
  const e = finiteOr(
    /** @type {number} */ (o.edgeNoise !== undefined ? o.edgeNoise : o.edge),
    DEFAULT_BLADE_PRESET.edgeNoise
  );
  const slicesRaw = parseInt(String(o.slices ?? DEFAULT_BLADE_PRESET.slices), 10);
  const slices = Number.isFinite(slicesRaw)
    ? clampNum(slicesRaw, 1, 16)
    : DEFAULT_BLADE_PRESET.slices;
  const ct = Math.floor(
    finiteOr(/** @type {number} */ (o.curveType), DEFAULT_BLADE_PRESET.curveType)
  );
  const curveType = clampNum(ct, 0, 4);
  const cs = finiteOr(
    /** @type {number} */ (o.curveStrength),
    DEFAULT_BLADE_PRESET.curveStrength
  );
  const cel = finiteOr(/** @type {number} */ (o.celShading), DEFAULT_BLADE_PRESET.celShading);
  const color = normalizeHexColor(/** @type {string} */ (o.color ?? DEFAULT_BLADE_PRESET.color));
  const shareRaw = o.sharePercent !== undefined ? o.sharePercent : o.share;
  const sharePercent = clampNum(
    finiteOr(/** @type {number} */ (shareRaw), DEFAULT_BLADE_PRESET.sharePercent),
    0,
    100
  );
  const erosion = clampNum(
    finiteOr(/** @type {number} */ (o.erosion), DEFAULT_BLADE_PRESET.erosion),
    0,
    1
  );
  const streak = clampNum(
    finiteOr(/** @type {number} */ (o.streak), DEFAULT_BLADE_PRESET.streak),
    0,
    1
  );
  const color2 = normalizeHexColor(/** @type {string} */ (o.color2 ?? DEFAULT_BLADE_PRESET.color2));
  const color3 = normalizeHexColor(/** @type {string} */ (o.color3 ?? DEFAULT_BLADE_PRESET.color3));
  const colorBandV = clampNum(
    Math.floor(finiteOr(/** @type {number} */ (o.colorBandV), DEFAULT_BLADE_PRESET.colorBandV)),
    1,
    8
  );
  const colorBandH = clampNum(
    Math.floor(finiteOr(/** @type {number} */ (o.colorBandH), DEFAULT_BLADE_PRESET.colorBandH)),
    1,
    8
  );
  return {
    width: clampNum(w, 0.02, 0.4),
    thickness: clampNum(t, 0.002, 0.08),
    height: clampNum(h, 0.35, 3),
    edgeNoise: clampNum(e, 0, 1),
    slices,
    curveType,
    curveStrength: clampNum(cs, 0, 1),
    celShading: clampNum(cel, 0, 1),
    color,
    color2,
    color3,
    colorBandV,
    colorBandH,
    sharePercent,
    erosion,
    streak,
  };
}

/**
 * @param {unknown} raw
 * @param {number} petalCount
 * @returns {null | Array<{ widthProfile: number[] } | null>}
 */
function normalizePetalShapes(raw, petalCount) {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const len = FLOWER_PETAL_WIDTH_PROFILE_LEN;
  const out = [];
  let any = false;
  for (let i = 0; i < petalCount; i++) {
    const entry = raw[i];
    if (entry && typeof entry === "object" && Array.isArray(entry.widthProfile)) {
      const wp = [];
      for (let k = 0; k < len; k++) {
        const v = finiteOr(Number(entry.widthProfile[k]), 1);
        wp.push(clampNum(v, 0.15, 2.35));
      }
      out.push({ widthProfile: wp });
      any = true;
    } else {
      out.push(null);
    }
  }
  return any ? out : null;
}

/**
 * @param {unknown} raw
 */
export function normalizeFlowerPreset(raw) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const pcRaw = Math.floor(finiteOr(/** @type {number} */ (o.petalCount), DEFAULT_FLOWER_PRESET.petalCount));
  const c3 = normalizeHexColor(/** @type {string} */ (o.color3 ?? DEFAULT_FLOWER_PRESET.color3));
  const pl = clampNum(finiteOr(/** @type {number} */ (o.petalLength), DEFAULT_FLOWER_PRESET.petalLength), 0.08, 1.2);
  const defaultCr = pl * 0.42;
  const pc = nearestFibonacciPetalCount(pcRaw);
  return {
    petalCount: pc,
    petalLength: pl,
    stemWidth: clampNum(finiteOr(/** @type {number} */ (o.stemWidth), DEFAULT_FLOWER_PRESET.stemWidth), 0.006, 0.12),
    stemHeight: clampNum(finiteOr(/** @type {number} */ (o.stemHeight), DEFAULT_FLOWER_PRESET.stemHeight), 0.35, 4),
    centerDiscRadius: clampNum(
      finiteOr(/** @type {number} */ (o.centerDiscRadius), defaultCr),
      0.02,
      0.65
    ),
    centerDiscThickness: clampNum(
      finiteOr(/** @type {number} */ (o.centerDiscThickness), DEFAULT_FLOWER_PRESET.centerDiscThickness),
      0.001,
      0.12
    ),
    centerDiscBulge: clampNum(
      finiteOr(/** @type {number} */ (o.centerDiscBulge), DEFAULT_FLOWER_PRESET.centerDiscBulge),
      0,
      1
    ),
    clusterDensity: clampNum(finiteOr(/** @type {number} */ (o.clusterDensity), DEFAULT_FLOWER_PRESET.clusterDensity), 0, 1),
    sharePercent: clampNum(finiteOr(/** @type {number} */ (o.sharePercent), DEFAULT_FLOWER_PRESET.sharePercent), 0, 100),
    petalGradientBlend: clampNum(
      finiteOr(/** @type {number} */ (o.petalGradientBlend), DEFAULT_FLOWER_PRESET.petalGradientBlend),
      0,
      1
    ),
    petalEdgeNoise: clampNum(finiteOr(/** @type {number} */ (o.petalEdgeNoise), DEFAULT_FLOWER_PRESET.petalEdgeNoise), 0, 1),
    petalWarp: clampNum(finiteOr(/** @type {number} */ (o.petalWarp), DEFAULT_FLOWER_PRESET.petalWarp), 0, 1),
    petalRipple: clampNum(finiteOr(/** @type {number} */ (o.petalRipple), DEFAULT_FLOWER_PRESET.petalRipple), 0, 1),
    petalTipSharpness: clampNum(
      finiteOr(/** @type {number} */ (o.petalTipSharpness), DEFAULT_FLOWER_PRESET.petalTipSharpness),
      0,
      1
    ),
    petalTipRoundness: clampNum(
      finiteOr(/** @type {number} */ (o.petalTipRoundness), DEFAULT_FLOWER_PRESET.petalTipRoundness),
      0,
      1
    ),
    petalBloom: clampNum(
      finiteOr(/** @type {number} */ (o.petalBloom), DEFAULT_FLOWER_PRESET.petalBloom),
      0,
      1
    ),
    color: normalizeHexColor(/** @type {string} */ (o.color ?? DEFAULT_FLOWER_PRESET.color)),
    color2: normalizeHexColor(/** @type {string} */ (o.color2 ?? DEFAULT_FLOWER_PRESET.color2)),
    color3: c3,
    color4: normalizeHexColor(/** @type {string} */ (o.color4 ?? c3)),
    color5: normalizeHexColor(/** @type {string} */ (o.color5 ?? c3)),
    centerColor: normalizeHexColor(/** @type {string} */ (o.centerColor ?? DEFAULT_FLOWER_PRESET.centerColor)),
    pollenColor: normalizeHexColor(/** @type {string} */ (o.pollenColor ?? DEFAULT_FLOWER_PRESET.pollenColor)),
    pollenRadius: clampNum(finiteOr(/** @type {number} */ (o.pollenRadius), DEFAULT_FLOWER_PRESET.pollenRadius), 0.05, 0.95),
    pollenGrain: clampNum(finiteOr(/** @type {number} */ (o.pollenGrain), DEFAULT_FLOWER_PRESET.pollenGrain), 0, 1),
    pollenBrightness: clampNum(
      finiteOr(/** @type {number} */ (o.pollenBrightness), DEFAULT_FLOWER_PRESET.pollenBrightness),
      0.3,
      2
    ),
    stemColor: normalizeHexColor(/** @type {string} */ (o.stemColor ?? DEFAULT_FLOWER_PRESET.stemColor)),
    toleratesWater: o.toleratesWater === true,
    petalShapeCustom: o.petalShapeCustom === true,
    petalShapes: normalizePetalShapes(o.petalShapes, pc),
  };
}

/**
 * @param {unknown} n
 * @param {number} fallback
 */
function finiteOr(n, fallback) {
  const v = typeof n === "number" ? n : parseFloat(String(n));
  return Number.isFinite(v) ? v : fallback;
}

/**
 * index.html defaults every population slider to 0. On "Spawn world", any count still at 0 gets
 * these values so the scene fills in. (We merge per key, not only when the sum of all counts is 0 —
 * otherwise raising birds alone left every insect at 0 and nothing spawned except birds.)
 */
const PLAYABLE_WORLD_CONTENT_DEFAULTS = {
  grassCount: 2_000_000,
  flowerCount: 12_000,
  treeCount: 18,
  rockCount: 280,
  boulderCount: 12,
  beeHiveCount: 4,
  butterflyCount: 220,
  ladybugCount: 120,
  bumblebeeCount: 28,
  fireflyCount: 80,
  antCount: 400,
  wormCount: 200,
  birdCount: 24,
  fishCount: 180,
  spiderWebCount: 12,
};

/**
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
export function mergePlayableContentDefaultsForSpawn(raw) {
  const o = raw && typeof raw === "object" ? { ...raw } : {};
  for (const k of Object.keys(PLAYABLE_WORLD_CONTENT_DEFAULTS)) {
    const key = /** @type {keyof typeof PLAYABLE_WORLD_CONTENT_DEFAULTS} */ (k);
    const v = Math.floor(finiteOr(/** @type {number} */ (o[k]), 0));
    if (v === 0) {
      o[k] = PLAYABLE_WORLD_CONTENT_DEFAULTS[key];
    }
  }
  return o;
}

/**
 * Normalizes the full settings snapshot (for export, import, or API handoff).
 * @param {unknown} raw
 */
export function normalizeEnvironmentSettings(raw) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  let presets = o.bladePresets;
  if (!Array.isArray(presets) || presets.length < 1) {
    presets = [{ ...DEFAULT_BLADE_PRESET }];
  }
  const bladePresets = presets
    .slice(0, 48)
    .map((p) => normalizeBladePreset(p));
  let flowerPresetsRaw = o.flowerPresets;
  if (!Array.isArray(flowerPresetsRaw) || flowerPresetsRaw.length < 1) {
    flowerPresetsRaw = [{ ...DEFAULT_FLOWER_PRESET }];
  }
  const flowerPresets = flowerPresetsRaw
    .slice(0, 48)
    .map((p) => normalizeFlowerPreset(p));
  let butterflyPresetsRaw = o.butterflyPresets;
  if (!Array.isArray(butterflyPresetsRaw) || butterflyPresetsRaw.length < 1) {
    butterflyPresetsRaw = [{ color: "#ffaa44", sharePercent: 100 }];
  }
  const butterflyPresets = butterflyPresetsRaw
    .slice(0, MAX_CRITTER_TYPES)
    .map((p) => normalizeCritterPreset(p));
  let ladybugPresetsRaw = o.ladybugPresets;
  if (!Array.isArray(ladybugPresetsRaw) || ladybugPresetsRaw.length < 1) {
    ladybugPresetsRaw = [{ color: "#cc1122", sharePercent: 100 }];
  }
  const ladybugPresets = ladybugPresetsRaw
    .slice(0, MAX_CRITTER_TYPES)
    .map((p) => normalizeCritterPreset(p));
  let fireflyPresetsRaw = o.fireflyPresets;
  if (!Array.isArray(fireflyPresetsRaw) || fireflyPresetsRaw.length < 1) {
    fireflyPresetsRaw = [{ color: "#b8ff66", sharePercent: 100 }];
  }
  const fireflyPresets = fireflyPresetsRaw
    .slice(0, MAX_CRITTER_TYPES)
    .map((p) => normalizeCritterPreset(p));
  let antPresetsRaw = o.antPresets;
  if (!Array.isArray(antPresetsRaw) || antPresetsRaw.length < 1) {
    antPresetsRaw = [{ color: "#2a1e14", sharePercent: 100 }];
  }
  const antPresets = antPresetsRaw.slice(0, MAX_CRITTER_TYPES).map((p) => normalizeCritterPreset(p));
  let wormPresetsRaw = o.wormPresets;
  if (!Array.isArray(wormPresetsRaw) || wormPresetsRaw.length < 1) {
    wormPresetsRaw = [{ color: "#8B6550", sharePercent: 100 }];
  }
  const wormPresets = wormPresetsRaw.slice(0, MAX_CRITTER_TYPES).map((p) => normalizeCritterPreset(p));
  const birdPresets = normalizeBirdPresets(o.birdPresets);
  let fishPresetsRaw = o.fishPresets;
  if (!Array.isArray(fishPresetsRaw) || fishPresetsRaw.length < 1) {
    fishPresetsRaw = [{ color: "#4a8fbe", sharePercent: 100 }];
  }
  const fishPresets = fishPresetsRaw.slice(0, MAX_CRITTER_TYPES).map((p) => normalizeCritterPreset(p));
  let bumblebeePresetsRaw = o.bumblebeePresets;
  if (!Array.isArray(bumblebeePresetsRaw) || bumblebeePresetsRaw.length < 1) {
    bumblebeePresetsRaw = [{ color: "#e8c040", sharePercent: 100 }];
  }
  const bumblebeePresets = bumblebeePresetsRaw
    .slice(0, MAX_CRITTER_TYPES)
    .map((p) => normalizeCritterPreset(p));
  const gc = Math.floor(finiteOr(/** @type {number} */ (o.grassCount), 0));
  const fc = Math.floor(finiteOr(/** @type {number} */ (o.flowerCount), 0));
  return {
    grassCount: clampNum(gc, GRASS_COUNT_MIN, GRASS_COUNT_MAX),
    bladePresets,
    colorVariation: clampNum(finiteOr(/** @type {number} */ (o.colorVariation), 1), 0, 1),
    flowerCount: clampNum(fc, FLOWER_COUNT_MIN, FLOWER_COUNT_MAX),
    flowerPresets,
    flowerColorVariation: clampNum(finiteOr(/** @type {number} */ (o.flowerColorVariation), 1), 0, 1),
    groundColor: normalizeHexColor(/** @type {string} */ (o.groundColor ?? "#5c4a3a")),
    groundWarm: clampNum(finiteOr(/** @type {number} */ (o.groundWarm), 1), 0, 2.5),
    groundCool: clampNum(finiteOr(/** @type {number} */ (o.groundCool), 1), 0, 2.5),
    groundMapMix: clampNum(finiteOr(/** @type {number} */ (o.groundMapMix), 0.35), 0, 1),
    terrainAmplitude: clampNum(finiteOr(/** @type {number} */ (o.terrainAmplitude), 0), 0, 60),
    terrainFrequency: clampNum(
      finiteOr(/** @type {number} */ (o.terrainFrequency), 0.016),
      0.0015,
      0.14
    ),
    terrainOctaves: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.terrainOctaves), 5)),
      1,
      8
    ),
    terrainPersistence: clampNum(
      finiteOr(/** @type {number} */ (o.terrainPersistence), 0.52),
      0.2,
      0.95
    ),
    terrainLacunarity: clampNum(
      finiteOr(/** @type {number} */ (o.terrainLacunarity), 2.05),
      1.5,
      3.0
    ),
    terrainRidge: clampNum(finiteOr(/** @type {number} */ (o.terrainRidge), 0.35), 0, 1),
    terrainSeed: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.terrainSeed), 0)),
      0,
      9999
    ),
    starAmount: clampNum(finiteOr(/** @type {number} */ (o.starAmount), 0), 0, 1),
    nebulaBlue: clampNum(finiteOr(/** @type {number} */ (o.nebulaBlue), 1), 0, 2.5),
    nebulaPurple: clampNum(finiteOr(/** @type {number} */ (o.nebulaPurple), 1), 0, 2.5),
    rainIntensity: clampNum(finiteOr(/** @type {number} */ (o.rainIntensity), 0), 0, 1),
    snowIntensity: clampNum(finiteOr(/** @type {number} */ (o.snowIntensity), 0), 0, 1),
    lightningIntensity: clampNum(
      finiteOr(/** @type {number} */ (o.lightningIntensity), 0),
      0,
      1
    ),
    cloudCover: clampNum(finiteOr(/** @type {number} */ (o.cloudCover), 0), 0, 1),
    windSpeed: clampNum(finiteOr(/** @type {number} */ (o.windSpeed), 1), 0, 4),
    windDirection: clampNum(finiteOr(/** @type {number} */ (o.windDirection), 0), 0, 360),
    audioVolume: clampNum(finiteOr(/** @type {number} */ (o.audioVolume), 1), 0, 1),
    audioMuted: o.audioMuted === true,
    treeCount: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.treeCount), 0)),
      TREE_COUNT_MIN,
      TREE_COUNT_MAX
    ),
    treePreset: normalizeTreePresetName(o.treePreset),
    treeScale: clampNum(
      finiteOr(/** @type {number} */ (o.treeScale), 0.1),
      TREE_WORLD_SCALE_MIN,
      TREE_WORLD_SCALE_MAX
    ),
    treeFieldSeed: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.treeFieldSeed), 42811)),
      0,
      99999
    ),
    rockCount: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.rockCount), 0)),
      ROCK_COUNT_MIN,
      ROCK_COUNT_MAX
    ),
    boulderCount: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.boulderCount), 0)),
      BOULDER_COUNT_MIN,
      BOULDER_COUNT_MAX
    ),
    rockSeed: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.rockSeed), 28401)),
      0,
      99999
    ),
    beeHiveCount: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.beeHiveCount), 0)),
      0,
      BEE_HIVE_COUNT_MAX
    ),
    beeHiveSeed: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.beeHiveSeed), 19283)),
      0,
      99999
    ),
    ...normalizeTreeShapeFields(o),
    butterflyCount: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.butterflyCount), 0)),
      BUTTERFLY_COUNT_MIN,
      BUTTERFLY_COUNT_MAX
    ),
    butterflyPresets,
    butterflySeed: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.butterflySeed), 7103)),
      0,
      99999
    ),
    butterflyDynamics: normalizeButterflyDynamics(o.butterflyDynamics),
    ladybugCount: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.ladybugCount), 0)),
      LADYBUG_COUNT_MIN,
      LADYBUG_COUNT_MAX
    ),
    ladybugPresets,
    ladybugTreeShare: clampNum(finiteOr(/** @type {number} */ (o.ladybugTreeShare), 0.45), 0, 1),
    ladybugSeed: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.ladybugSeed), 9023)),
      0,
      99999
    ),
    bumblebeeCount: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.bumblebeeCount), 0)),
      BUMBLEBEE_COUNT_MIN,
      BUMBLEBEE_COUNT_MAX
    ),
    bumblebeePresets,
    bumblebeeSeed: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.bumblebeeSeed), 7142)),
      0,
      99999
    ),
    spiderWebCount: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.spiderWebCount), 0)),
      SPIDER_WEB_COUNT_MIN,
      SPIDER_WEB_COUNT_MAX
    ),
    spiderSeed: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.spiderSeed), 4411)),
      0,
      99999
    ),
    fireflyCount: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.fireflyCount), 0)),
      FIREFLY_COUNT_MIN,
      FIREFLY_COUNT_MAX
    ),
    fireflyPresets,
    fireflySeed: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.fireflySeed), 3341)),
      0,
      99999
    ),
    antCount: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.antCount), 0)),
      ANT_COUNT_MIN,
      ANT_COUNT_MAX
    ),
    antPresets,
    antSeed: clampNum(Math.floor(finiteOr(/** @type {number} */ (o.antSeed), 5581)), 0, 99999),
    wormCount: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.wormCount), 0)),
      WORM_COUNT_MIN,
      WORM_COUNT_MAX
    ),
    wormPresets,
    wormSeed: clampNum(Math.floor(finiteOr(/** @type {number} */ (o.wormSeed), 7721)), 0, 99999),
    birdCount: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.birdCount), 0)),
      BIRD_COUNT_MIN,
      BIRD_COUNT_MAX
    ),
    birdPresets,
    birdSeed: clampNum(Math.floor(finiteOr(/** @type {number} */ (o.birdSeed), 8843)), 0, 99999),
    fishCount: clampNum(
      Math.floor(finiteOr(/** @type {number} */ (o.fishCount), 0)),
      FISH_COUNT_MIN,
      FISH_COUNT_MAX
    ),
    fishPresets,
    fishSeed: clampNum(Math.floor(finiteOr(/** @type {number} */ (o.fishSeed), 3311)), 0, 99999),
    fishDynamics: normalizeFishDynamics(o.fishDynamics),
    fishEcosystem: normalizeFishEcosystem(o.fishEcosystem),
    waterShader: normalizeWaterShaderSettings(o.waterShader),
    skyDetail: normalizeSkyTuning(o.skyDetail),
  };
}

/**
 * Persist full normalized settings to localStorage so the next session restores sliders + presets.
 * @param {ReturnType<typeof normalizeEnvironmentSettings>} settings
 */
export function saveEnvironmentSettingsAutosave(settings) {
  try {
    const normalized = normalizeEnvironmentSettings(settings);
    localStorage.setItem(ENVIRONMENT_AUTOSAVE_STORAGE_KEY, JSON.stringify(normalized));
  } catch (e) {
    console.warn("[settings] autosave failed", e);
  }
}

/**
 * @returns {ReturnType<typeof normalizeEnvironmentSettings> | null}
 */
export function loadEnvironmentSettingsAutosave() {
  try {
    const raw = localStorage.getItem(ENVIRONMENT_AUTOSAVE_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return normalizeEnvironmentSettings(o);
  } catch {
    return null;
  }
}

/**
 * @param {ReturnType<typeof readSettingsFromDOM>} settings
 * @param {{ v: number, segments: number, halfExtent: number, h: string, rh: string } | null | undefined} [terrainSnapshot] heightmap (same shape as terrain file); omitted if null
 */
export function serializeEnvironmentSettings(settings, terrainSnapshot = null) {
  const normalized = normalizeEnvironmentSettings(settings);
  const obj = {
    schemaVersion: ENVIRONMENT_SCHEMA_VERSION,
    format: ENVIRONMENT_FORMAT_ID,
    exportedAt: new Date().toISOString(),
    app: "Grass World",
    settings: normalized,
  };
  if (
    terrainSnapshot &&
    typeof terrainSnapshot === "object" &&
    typeof /** @type {{ h?: unknown }} */ (terrainSnapshot).h === "string"
  ) {
    /** @type {Record<string, unknown>} */ (obj).terrain = terrainSnapshot;
  }
  return JSON.stringify(obj, null, 2);
}

/** Stable id for insect-only exports (butterfly motion + wind snapshot). */
export const INSECT_BUTTERFLY_FORMAT_ID = "grass-world-insect-butterfly";

/** Bump when the insect butterfly JSON shape changes. */
export const INSECT_BUTTERFLY_SCHEMA_VERSION = 1;

/**
 * JSON file for saving butterfly dynamics plus Weather wind (so preview matches export).
 * @param {ReturnType<typeof readSettingsFromDOM>} settings
 */
export function serializeInsectButterflySettings(settings) {
  const s = normalizeEnvironmentSettings(settings);
  return JSON.stringify(
    {
      schemaVersion: INSECT_BUTTERFLY_SCHEMA_VERSION,
      format: INSECT_BUTTERFLY_FORMAT_ID,
      exportedAt: new Date().toISOString(),
      app: "Grass World",
      settings: {
        butterflyDynamics: s.butterflyDynamics,
        windSpeed: s.windSpeed,
        windDirection: s.windDirection,
      },
    },
    null,
    2
  );
}

/**
 * @param {string} text
 * @returns {{
 *   settings: ReturnType<typeof normalizeEnvironmentSettings>,
 *   terrain: Record<string, unknown> | null,
 * }}
 */
export function parseEnvironmentJsonPayload(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON.");
  }
  if (!data || typeof data !== "object") {
    throw new Error("Invalid payload.");
  }
  const rec = /** @type {Record<string, unknown>} */ (data);
  let inner = rec.settings;
  if (!inner || typeof inner !== "object") {
    if ("grassCount" in rec || "bladePresets" in rec || "flowerCount" in rec || "flowerPresets" in rec) {
      inner = rec;
    } else {
      throw new Error('Expected a "settings" object or a flat settings document.');
    }
  }
  const fmt = rec.format;
  if (fmt !== undefined && fmt !== ENVIRONMENT_FORMAT_ID) {
    console.warn(
      `Environment JSON format is "${fmt}" (expected "${ENVIRONMENT_FORMAT_ID}"). Importing anyway.`
    );
  }
  const ver = rec.schemaVersion;
  if (ver !== undefined && ver !== ENVIRONMENT_SCHEMA_VERSION) {
    console.warn(
      `Environment JSON schemaVersion is ${ver} (this build expects ${ENVIRONMENT_SCHEMA_VERSION}).`
    );
  }
  const settings = normalizeEnvironmentSettings(inner);
  /** @type {Record<string, unknown> | null} */
  let terrain = null;
  const tr = rec.terrain;
  if (tr && typeof tr === "object") {
    const o = /** @type {Record<string, unknown>} */ (tr);
    const v = Number(o.v);
    if ((v === 1 || v === 2) && typeof o.h === "string") {
      terrain = o;
    }
  }
  return { settings, terrain };
}

/**
 * @param {string} text
 * @returns {ReturnType<typeof normalizeEnvironmentSettings>}
 */
export function parseEnvironmentSettingsJson(text) {
  return parseEnvironmentJsonPayload(text).settings;
}

const MAX_BLADE_TYPES = 48;

/**
 * @param {HTMLElement} row
 * @param {ReturnType<typeof normalizeBladePreset>} p
 */
function applyBladePresetToRow(row, p) {
  const setInput = (field, value) => {
    const el = row.querySelector(`[data-field="${field}"]`);
    if (el instanceof HTMLInputElement) el.value = String(value);
  };
  setInput("width", p.width);
  setInput("thickness", p.thickness);
  setInput("height", p.height);
  setInput("edge", p.edgeNoise);
  setInput("slices", p.slices);
  const curve = row.querySelector('[data-field="curve"]');
  if (curve instanceof HTMLSelectElement) curve.value = String(p.curveType);
  setInput("curveStrength", p.curveStrength);
  setInput("cel", p.celShading);
  setInput("erosion", p.erosion);
  setInput("streak", p.streak);
  setInput("share", p.sharePercent);
  const col = row.querySelector('[data-field="color"]');
  if (col instanceof HTMLInputElement) col.value = p.color;
  const col2 = row.querySelector('[data-field="color2"]');
  if (col2 instanceof HTMLInputElement) col2.value = p.color2;
  const col3 = row.querySelector('[data-field="color3"]');
  if (col3 instanceof HTMLInputElement) col3.value = p.color3;
  setInput("bandV", p.colorBandV);
  setInput("bandH", p.colorBandH);

  const fields = [
    "width",
    "thickness",
    "height",
    "edge",
    "slices",
    "curveStrength",
    "cel",
    "erosion",
    "streak",
    "bandV",
    "bandH",
    "share",
  ];
  fields.forEach((f) => updateBladeRowSpan(row, f));
}

/**
 * Rebuilds blade type rows from data (used after import).
 * @param {ReturnType<typeof normalizeBladePreset>[]} presets
 */
export function applyBladePresetsToDOM(presets) {
  const list = document.getElementById("blade-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (
    document.getElementById("blade-preset-template")
  );
  if (!list || !template) return;

  const presetData = presets.length > 0 ? presets : [{ ...DEFAULT_BLADE_PRESET }];
  list.replaceChildren();
  for (let i = 0; i < presetData.length && i < MAX_BLADE_TYPES; i++) {
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement)) continue;
    applyBladePresetToRow(row, normalizeBladePreset(presetData[i]));
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateBladeRowSpan(row, f);
      });
    });
  }

  const allRows = list.querySelectorAll("[data-blade-preset-row]");
  allRows.forEach((row, i) => {
    const title = row.querySelector(".blade-preset-title");
    if (title) title.textContent = `Blade ${i + 1}`;
    const onlyOne = allRows.length <= 1;
    const btn = row.querySelector(".remove-blade-preset");
    if (btn instanceof HTMLButtonElement) {
      btn.disabled = onlyOne;
      btn.style.opacity = onlyOne ? "0.35" : "1";
    }
  });
}

const MAX_FLOWER_TYPES = 48;

/**
 * @param {HTMLElement} row
 * @param {ReturnType<typeof normalizeFlowerPreset>} p
 */
export function applyFlowerPresetToRow(row, p) {
  const setInput = (field, value) => {
    const el = row.querySelector(`[data-field="${field}"]`);
    if (el instanceof HTMLInputElement) el.value = String(value);
  };
  setInput("share", p.sharePercent);
  setInput("petalLength", p.petalLength);
  setInput("stemWidth", p.stemWidth);
  setInput("stemHeight", p.stemHeight);
  setInput("centerDiscRadius", p.centerDiscRadius);
  setInput("centerDiscThickness", p.centerDiscThickness);
  setInput("centerDiscBulge", p.centerDiscBulge);
  setInput("clusterDensity", p.clusterDensity);
  setInput("petalGradientBlend", p.petalGradientBlend);
  setInput("petalEdgeNoise", p.petalEdgeNoise);
  setInput("petalWarp", p.petalWarp);
  setInput("petalRipple", p.petalRipple);
  setInput("petalTipSharpness", p.petalTipSharpness);
  setInput("petalTipRoundness", p.petalTipRoundness);
  setInput("petalBloom", p.petalBloom);
  setInput("pollenRadius", p.pollenRadius);
  setInput("pollenGrain", p.pollenGrain);
  setInput("pollenBrightness", p.pollenBrightness);
  const pc = row.querySelector('[data-field="petalCount"]');
  if (pc instanceof HTMLSelectElement) pc.value = String(p.petalCount);
  const col = row.querySelector('[data-field="color"]');
  if (col instanceof HTMLInputElement) col.value = p.color;
  const col2 = row.querySelector('[data-field="color2"]');
  if (col2 instanceof HTMLInputElement) col2.value = p.color2;
  const col3 = row.querySelector('[data-field="color3"]');
  if (col3 instanceof HTMLInputElement) col3.value = p.color3;
  const col4 = row.querySelector('[data-field="color4"]');
  if (col4 instanceof HTMLInputElement) col4.value = p.color4;
  const col5 = row.querySelector('[data-field="color5"]');
  if (col5 instanceof HTMLInputElement) col5.value = p.color5;
  const cc = row.querySelector('[data-field="centerColor"]');
  if (cc instanceof HTMLInputElement) cc.value = p.centerColor;
  const pol = row.querySelector('[data-field="pollenColor"]');
  if (pol instanceof HTMLInputElement) pol.value = p.pollenColor;
  const sc = row.querySelector('[data-field="stemColor"]');
  if (sc instanceof HTMLInputElement) sc.value = p.stemColor;

  const psc = row.querySelector('[data-field="petalShapeCustom"]');
  if (psc instanceof HTMLInputElement) psc.value = p.petalShapeCustom ? "true" : "false";

  const psj = row.querySelector('[data-field="petalShapesJson"]');
  if (psj instanceof HTMLInputElement) {
    if (p.petalShapes && Array.isArray(p.petalShapes)) {
      const hasAny = p.petalShapes.some((x) => x && Array.isArray(x.widthProfile));
      psj.value = hasAny ? JSON.stringify(p.petalShapes) : "";
    } else {
      psj.value = "";
    }
  }

  [
    "petalLength",
    "stemWidth",
    "stemHeight",
    "centerDiscRadius",
    "centerDiscThickness",
    "centerDiscBulge",
    "clusterDensity",
    "share",
    "petalGradientBlend",
    "petalEdgeNoise",
    "petalWarp",
    "petalRipple",
    "petalTipSharpness",
    "petalTipRoundness",
    "petalBloom",
    "pollenRadius",
    "pollenGrain",
    "pollenBrightness",
  ].forEach((f) => updateFlowerRowSpan(row, f));
}

/**
 * @param {ReturnType<typeof normalizeFlowerPreset>[]} presets
 */
export function applyFlowerPresetsToDOM(presets) {
  const list = document.getElementById("flower-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (
    document.getElementById("flower-preset-template")
  );
  if (!list || !template) return;

  const presetData = presets.length > 0 ? presets : [{ ...DEFAULT_FLOWER_PRESET }];
  list.replaceChildren();
  for (let i = 0; i < presetData.length && i < MAX_FLOWER_TYPES; i++) {
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement)) continue;
    applyFlowerPresetToRow(row, normalizeFlowerPreset(presetData[i]));
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateFlowerRowSpan(row, f);
      });
    });
  }

  const allRows = list.querySelectorAll("[data-flower-preset-row]");
  allRows.forEach((row, i) => {
    const title = row.querySelector(".blade-preset-title");
    if (title) title.textContent = `Flower ${i + 1}`;
    const onlyOne = allRows.length <= 1;
    const btn = row.querySelector(".remove-flower-preset");
    if (btn instanceof HTMLButtonElement) {
      btn.disabled = onlyOne;
      btn.style.opacity = onlyOne ? "0.35" : "1";
    }
  });
}

/**
 * @param {HTMLElement} row
 * @param {ReturnType<typeof normalizeCritterPreset>} p
 */
function applyButterflyPresetToRow(row, p) {
  const np = normalizeCritterPreset(p);
  const sh = row.querySelector('[data-field="share"]');
  if (sh instanceof HTMLInputElement) sh.value = String(np.sharePercent);
  const col = row.querySelector('[data-field="color"]');
  if (col instanceof HTMLInputElement) col.value = np.color;
  updateCritterRowSpan(row, "share");
}

/**
 * @param {HTMLElement} row
 * @param {ReturnType<typeof normalizeCritterPreset>} p
 */
function applyLadybugPresetToRow(row, p) {
  const np = normalizeCritterPreset(p);
  const sh = row.querySelector('[data-field="share"]');
  if (sh instanceof HTMLInputElement) sh.value = String(np.sharePercent);
  const col = row.querySelector('[data-field="color"]');
  if (col instanceof HTMLInputElement) col.value = np.color;
  updateCritterRowSpan(row, "share");
}

/**
 * @param {HTMLElement} row
 * @param {ReturnType<typeof normalizeCritterPreset>} p
 */
function applyBumblebeePresetToRow(row, p) {
  const np = normalizeCritterPreset(p);
  const sh = row.querySelector('[data-field="share"]');
  if (sh instanceof HTMLInputElement) sh.value = String(np.sharePercent);
  const col = row.querySelector('[data-field="color"]');
  if (col instanceof HTMLInputElement) col.value = np.color;
  updateCritterRowSpan(row, "share");
}

/**
 * @param {ReturnType<typeof normalizeCritterPreset>[]} presets
 */
export function applyButterflyPresetsToDOM(presets) {
  const list = document.getElementById("butterfly-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (
    document.getElementById("butterfly-preset-template")
  );
  if (!list || !template) return;

  const presetData = presets.length > 0 ? presets : [{ ...DEFAULT_CRITTER_PRESET, color: "#ffaa44" }];
  list.replaceChildren();
  for (let i = 0; i < presetData.length && i < MAX_CRITTER_TYPES; i++) {
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement)) continue;
    applyButterflyPresetToRow(row, presetData[i]);
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateCritterRowSpan(row, f);
      });
    });
  }

  const allRows = list.querySelectorAll("[data-butterfly-preset-row]");
  allRows.forEach((row, i) => {
    const title = row.querySelector(".blade-preset-title");
    if (title) title.textContent = `Butterfly ${i + 1}`;
    const onlyOne = allRows.length <= 1;
    const btn = row.querySelector(".remove-butterfly-preset");
    if (btn instanceof HTMLButtonElement) {
      btn.disabled = onlyOne;
      btn.style.opacity = onlyOne ? "0.35" : "1";
    }
  });
}

/**
 * @param {ReturnType<typeof normalizeCritterPreset>[]} presets
 */
export function applyLadybugPresetsToDOM(presets) {
  const list = document.getElementById("ladybug-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (
    document.getElementById("ladybug-preset-template")
  );
  if (!list || !template) return;

  const presetData = presets.length > 0 ? presets : [{ ...DEFAULT_CRITTER_PRESET, color: "#cc1122" }];
  list.replaceChildren();
  for (let i = 0; i < presetData.length && i < MAX_CRITTER_TYPES; i++) {
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement)) continue;
    applyLadybugPresetToRow(row, presetData[i]);
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateCritterRowSpan(row, f);
      });
    });
  }

  const allRows = list.querySelectorAll("[data-ladybug-preset-row]");
  allRows.forEach((row, i) => {
    const title = row.querySelector(".blade-preset-title");
    if (title) title.textContent = `Ladybug ${i + 1}`;
    const onlyOne = allRows.length <= 1;
    const btn = row.querySelector(".remove-ladybug-preset");
    if (btn instanceof HTMLButtonElement) {
      btn.disabled = onlyOne;
      btn.style.opacity = onlyOne ? "0.35" : "1";
    }
  });
}

/**
 * @param {ReturnType<typeof normalizeCritterPreset>[]} presets
 */
export function applyBumblebeePresetsToDOM(presets) {
  const list = document.getElementById("bumblebee-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (
    document.getElementById("bumblebee-preset-template")
  );
  if (!list || !template) return;

  const presetData = presets.length > 0 ? presets : [{ ...DEFAULT_CRITTER_PRESET, color: "#e8c040" }];
  list.replaceChildren();
  for (let i = 0; i < presetData.length && i < MAX_CRITTER_TYPES; i++) {
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement)) continue;
    applyBumblebeePresetToRow(row, presetData[i]);
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateCritterRowSpan(row, f);
      });
    });
  }

  const allRows = list.querySelectorAll("[data-bumblebee-preset-row]");
  allRows.forEach((row, i) => {
    const title = row.querySelector(".blade-preset-title");
    if (title) title.textContent = `Bumblebee ${i + 1}`;
    const onlyOne = allRows.length <= 1;
    const btn = row.querySelector(".remove-bumblebee-preset");
    if (btn instanceof HTMLButtonElement) {
      btn.disabled = onlyOne;
      btn.style.opacity = onlyOne ? "0.35" : "1";
    }
  });
}

/**
 * @param {object} opts
 * @param {() => void} opts.onChange
 */
export function initButterflyPresetsUI({ onChange }) {
  const list = document.getElementById("butterfly-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (
    document.getElementById("butterfly-preset-template")
  );
  const addBtn = document.getElementById("add-butterfly-preset");
  if (!list || !template || !addBtn) return;

  function renumberTitles() {
    const rows = list.querySelectorAll("[data-butterfly-preset-row]");
    rows.forEach((row, i) => {
      const title = row.querySelector(".blade-preset-title");
      if (title) title.textContent = `Butterfly ${i + 1}`;
    });
  }

  function syncRemoveButtons() {
    const rows = list.querySelectorAll("[data-butterfly-preset-row]");
    const onlyOne = rows.length <= 1;
    rows.forEach((row) => {
      const btn = row.querySelector(".remove-butterfly-preset");
      if (btn instanceof HTMLButtonElement) {
        btn.disabled = onlyOne;
        btn.style.opacity = onlyOne ? "0.35" : "1";
      }
    });
  }

  function bindRowInputs(row) {
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateCritterRowSpan(row, f);
      });
    });
  }

  function addRow(silent) {
    if (list.querySelectorAll("[data-butterfly-preset-row]").length >= MAX_CRITTER_TYPES) return;
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement) || !row.matches("[data-butterfly-preset-row]")) return;
    renumberTitles();
    syncRemoveButtons();
    bindRowInputs(row);
    applyButterflyPresetToRow(row, { ...DEFAULT_CRITTER_PRESET, color: "#ffaa44" });
    if (!silent) onChange();
  }

  list.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const rm = t.closest(".remove-butterfly-preset");
    if (!rm) return;
    const row = rm.closest("[data-butterfly-preset-row]");
    if (!(row instanceof HTMLElement)) return;
    if (list.querySelectorAll("[data-butterfly-preset-row]").length <= 1) return;
    row.remove();
    renumberTitles();
    syncRemoveButtons();
    onChange();
  });

  addBtn.addEventListener("click", () => addRow(false));

  if (list.querySelectorAll("[data-butterfly-preset-row]").length === 0) {
    addRow(true);
  } else {
    renumberTitles();
    syncRemoveButtons();
    list.querySelectorAll("[data-butterfly-preset-row]").forEach((row) => {
      if (row instanceof HTMLElement) bindRowInputs(row);
    });
  }
}

/**
 * @param {object} opts
 * @param {() => void} opts.onChange
 */
export function initLadybugPresetsUI({ onChange }) {
  const list = document.getElementById("ladybug-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (
    document.getElementById("ladybug-preset-template")
  );
  const addBtn = document.getElementById("add-ladybug-preset");
  if (!list || !template || !addBtn) return;

  function renumberTitles() {
    const rows = list.querySelectorAll("[data-ladybug-preset-row]");
    rows.forEach((row, i) => {
      const title = row.querySelector(".blade-preset-title");
      if (title) title.textContent = `Ladybug ${i + 1}`;
    });
  }

  function syncRemoveButtons() {
    const rows = list.querySelectorAll("[data-ladybug-preset-row]");
    const onlyOne = rows.length <= 1;
    rows.forEach((row) => {
      const btn = row.querySelector(".remove-ladybug-preset");
      if (btn instanceof HTMLButtonElement) {
        btn.disabled = onlyOne;
        btn.style.opacity = onlyOne ? "0.35" : "1";
      }
    });
  }

  function bindRowInputs(row) {
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateCritterRowSpan(row, f);
      });
    });
  }

  function addRow(silent) {
    if (list.querySelectorAll("[data-ladybug-preset-row]").length >= MAX_CRITTER_TYPES) return;
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement) || !row.matches("[data-ladybug-preset-row]")) return;
    renumberTitles();
    syncRemoveButtons();
    bindRowInputs(row);
    applyLadybugPresetToRow(row, { ...DEFAULT_CRITTER_PRESET, color: "#cc1122" });
    if (!silent) onChange();
  }

  list.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const rm = t.closest(".remove-ladybug-preset");
    if (!rm) return;
    const row = rm.closest("[data-ladybug-preset-row]");
    if (!(row instanceof HTMLElement)) return;
    if (list.querySelectorAll("[data-ladybug-preset-row]").length <= 1) return;
    row.remove();
    renumberTitles();
    syncRemoveButtons();
    onChange();
  });

  addBtn.addEventListener("click", () => addRow(false));

  if (list.querySelectorAll("[data-ladybug-preset-row]").length === 0) {
    addRow(true);
  } else {
    renumberTitles();
    syncRemoveButtons();
    list.querySelectorAll("[data-ladybug-preset-row]").forEach((row) => {
      if (row instanceof HTMLElement) bindRowInputs(row);
    });
  }
}

/**
 * @param {object} opts
 * @param {() => void} opts.onChange
 */
export function initBumblebeePresetsUI({ onChange }) {
  const list = document.getElementById("bumblebee-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (
    document.getElementById("bumblebee-preset-template")
  );
  const addBtn = document.getElementById("add-bumblebee-preset");
  if (!list || !template || !addBtn) return;

  function renumberTitles() {
    const rows = list.querySelectorAll("[data-bumblebee-preset-row]");
    rows.forEach((row, i) => {
      const title = row.querySelector(".blade-preset-title");
      if (title) title.textContent = `Bumblebee ${i + 1}`;
    });
  }

  function syncRemoveButtons() {
    const rows = list.querySelectorAll("[data-bumblebee-preset-row]");
    const onlyOne = rows.length <= 1;
    rows.forEach((row) => {
      const btn = row.querySelector(".remove-bumblebee-preset");
      if (btn instanceof HTMLButtonElement) {
        btn.disabled = onlyOne;
        btn.style.opacity = onlyOne ? "0.35" : "1";
      }
    });
  }

  function bindRowInputs(row) {
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateCritterRowSpan(row, f);
      });
    });
  }

  function addRow(silent) {
    if (list.querySelectorAll("[data-bumblebee-preset-row]").length >= MAX_CRITTER_TYPES) return;
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement) || !row.matches("[data-bumblebee-preset-row]")) return;
    renumberTitles();
    syncRemoveButtons();
    bindRowInputs(row);
    applyBumblebeePresetToRow(row, { ...DEFAULT_CRITTER_PRESET, color: "#e8c040" });
    if (!silent) onChange();
  }

  list.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const rm = t.closest(".remove-bumblebee-preset");
    if (!rm) return;
    const row = rm.closest("[data-bumblebee-preset-row]");
    if (!(row instanceof HTMLElement)) return;
    if (list.querySelectorAll("[data-bumblebee-preset-row]").length <= 1) return;
    row.remove();
    renumberTitles();
    syncRemoveButtons();
    onChange();
  });

  addBtn.addEventListener("click", () => addRow(false));

  if (list.querySelectorAll("[data-bumblebee-preset-row]").length === 0) {
    addRow(true);
  } else {
    renumberTitles();
    syncRemoveButtons();
    list.querySelectorAll("[data-bumblebee-preset-row]").forEach((row) => {
      if (row instanceof HTMLElement) bindRowInputs(row);
    });
  }
}

/**
 * @param {HTMLElement} row
 * @param {ReturnType<typeof normalizeCritterPreset>} p
 */
function applyFireflyPresetToRow(row, p) {
  const np = normalizeCritterPreset(p);
  const sh = row.querySelector('[data-field="share"]');
  if (sh instanceof HTMLInputElement) sh.value = String(np.sharePercent);
  const col = row.querySelector('[data-field="color"]');
  if (col instanceof HTMLInputElement) col.value = np.color;
  updateCritterRowSpan(row, "share");
}

/**
 * @param {ReturnType<typeof normalizeCritterPreset>[]} presets
 */
export function applyFireflyPresetsToDOM(presets) {
  const list = document.getElementById("firefly-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (
    document.getElementById("firefly-preset-template")
  );
  if (!list || !template) return;

  const presetData = presets.length > 0 ? presets : [{ ...DEFAULT_CRITTER_PRESET, color: "#b8ff66" }];
  list.replaceChildren();
  for (let i = 0; i < presetData.length && i < MAX_CRITTER_TYPES; i++) {
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement)) continue;
    applyFireflyPresetToRow(row, presetData[i]);
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateCritterRowSpan(row, f);
      });
    });
  }

  const allRows = list.querySelectorAll("[data-firefly-preset-row]");
  allRows.forEach((row, i) => {
    const title = row.querySelector(".blade-preset-title");
    if (title) title.textContent = `Firefly ${i + 1}`;
    const onlyOne = allRows.length <= 1;
    const btn = row.querySelector(".remove-firefly-preset");
    if (btn instanceof HTMLButtonElement) {
      btn.disabled = onlyOne;
      btn.style.opacity = onlyOne ? "0.35" : "1";
    }
  });
}

/**
 * @param {HTMLElement} row
 * @param {ReturnType<typeof normalizeCritterPreset>} p
 */
function applyAntPresetToRow(row, p) {
  const np = normalizeCritterPreset(p);
  const sh = row.querySelector('[data-field="share"]');
  if (sh instanceof HTMLInputElement) sh.value = String(np.sharePercent);
  const col = row.querySelector('[data-field="color"]');
  if (col instanceof HTMLInputElement) col.value = np.color;
  updateCritterRowSpan(row, "share");
}

/**
 * @param {ReturnType<typeof normalizeCritterPreset>[]} presets
 */
export function applyAntPresetsToDOM(presets) {
  const list = document.getElementById("ant-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (document.getElementById("ant-preset-template"));
  if (!list || !template) return;

  const presetData = presets.length > 0 ? presets : [{ ...DEFAULT_CRITTER_PRESET, color: "#2a1e14" }];
  list.replaceChildren();
  for (let i = 0; i < presetData.length && i < MAX_CRITTER_TYPES; i++) {
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement)) continue;
    applyAntPresetToRow(row, presetData[i]);
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateCritterRowSpan(row, f);
      });
    });
  }

  const allRows = list.querySelectorAll("[data-ant-preset-row]");
  allRows.forEach((row, i) => {
    const title = row.querySelector(".blade-preset-title");
    if (title) title.textContent = `Ant ${i + 1}`;
    const onlyOne = allRows.length <= 1;
    const btn = row.querySelector(".remove-ant-preset");
    if (btn instanceof HTMLButtonElement) {
      btn.disabled = onlyOne;
      btn.style.opacity = onlyOne ? "0.35" : "1";
    }
  });
}

/**
 * @param {object} opts
 * @param {() => void} opts.onChange
 */
export function initFireflyPresetsUI({ onChange }) {
  const list = document.getElementById("firefly-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (
    document.getElementById("firefly-preset-template")
  );
  const addBtn = document.getElementById("add-firefly-preset");
  if (!list || !template || !addBtn) return;

  function renumberTitles() {
    const rows = list.querySelectorAll("[data-firefly-preset-row]");
    rows.forEach((row, i) => {
      const title = row.querySelector(".blade-preset-title");
      if (title) title.textContent = `Firefly ${i + 1}`;
    });
  }

  function syncRemoveButtons() {
    const rows = list.querySelectorAll("[data-firefly-preset-row]");
    const onlyOne = rows.length <= 1;
    rows.forEach((row) => {
      const btn = row.querySelector(".remove-firefly-preset");
      if (btn instanceof HTMLButtonElement) {
        btn.disabled = onlyOne;
        btn.style.opacity = onlyOne ? "0.35" : "1";
      }
    });
  }

  function bindRowInputs(row) {
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateCritterRowSpan(row, f);
      });
    });
  }

  function addRow(silent) {
    if (list.querySelectorAll("[data-firefly-preset-row]").length >= MAX_CRITTER_TYPES) return;
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement) || !row.matches("[data-firefly-preset-row]")) return;
    renumberTitles();
    syncRemoveButtons();
    bindRowInputs(row);
    applyFireflyPresetToRow(row, { ...DEFAULT_CRITTER_PRESET, color: "#b8ff66" });
    if (!silent) onChange();
  }

  list.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const rm = t.closest(".remove-firefly-preset");
    if (!rm) return;
    const row = rm.closest("[data-firefly-preset-row]");
    if (!(row instanceof HTMLElement)) return;
    if (list.querySelectorAll("[data-firefly-preset-row]").length <= 1) return;
    row.remove();
    renumberTitles();
    syncRemoveButtons();
    onChange();
  });

  addBtn.addEventListener("click", () => addRow(false));

  if (list.querySelectorAll("[data-firefly-preset-row]").length === 0) {
    addRow(true);
  } else {
    renumberTitles();
    syncRemoveButtons();
    list.querySelectorAll("[data-firefly-preset-row]").forEach((row) => {
      if (row instanceof HTMLElement) bindRowInputs(row);
    });
  }
}

/**
 * @param {object} opts
 * @param {() => void} opts.onChange
 */
export function initAntPresetsUI({ onChange }) {
  const list = document.getElementById("ant-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (document.getElementById("ant-preset-template"));
  const addBtn = document.getElementById("add-ant-preset");
  if (!list || !template || !addBtn) return;

  function renumberTitles() {
    const rows = list.querySelectorAll("[data-ant-preset-row]");
    rows.forEach((row, i) => {
      const title = row.querySelector(".blade-preset-title");
      if (title) title.textContent = `Ant ${i + 1}`;
    });
  }

  function syncRemoveButtons() {
    const rows = list.querySelectorAll("[data-ant-preset-row]");
    const onlyOne = rows.length <= 1;
    rows.forEach((row) => {
      const btn = row.querySelector(".remove-ant-preset");
      if (btn instanceof HTMLButtonElement) {
        btn.disabled = onlyOne;
        btn.style.opacity = onlyOne ? "0.35" : "1";
      }
    });
  }

  function bindRowInputs(row) {
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateCritterRowSpan(row, f);
      });
    });
  }

  function addRow(silent) {
    if (list.querySelectorAll("[data-ant-preset-row]").length >= MAX_CRITTER_TYPES) return;
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement) || !row.matches("[data-ant-preset-row]")) return;
    renumberTitles();
    syncRemoveButtons();
    bindRowInputs(row);
    applyAntPresetToRow(row, { ...DEFAULT_CRITTER_PRESET, color: "#2a1e14" });
    if (!silent) onChange();
  }

  list.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const rm = t.closest(".remove-ant-preset");
    if (!rm) return;
    const row = rm.closest("[data-ant-preset-row]");
    if (!(row instanceof HTMLElement)) return;
    if (list.querySelectorAll("[data-ant-preset-row]").length <= 1) return;
    row.remove();
    renumberTitles();
    syncRemoveButtons();
    onChange();
  });

  addBtn.addEventListener("click", () => addRow(false));

  if (list.querySelectorAll("[data-ant-preset-row]").length === 0) {
    addRow(true);
  } else {
    renumberTitles();
    syncRemoveButtons();
    list.querySelectorAll("[data-ant-preset-row]").forEach((row) => {
      if (row instanceof HTMLElement) bindRowInputs(row);
    });
  }
}

/**
 * @param {HTMLElement} row
 * @param {ReturnType<typeof normalizeCritterPreset>} p
 */
function applyWormPresetToRow(row, p) {
  const np = normalizeCritterPreset(p);
  const sh = row.querySelector('[data-field="share"]');
  if (sh instanceof HTMLInputElement) sh.value = String(np.sharePercent);
  const col = row.querySelector('[data-field="color"]');
  if (col instanceof HTMLInputElement) col.value = np.color;
  updateCritterRowSpan(row, "share");
}

/**
 * @param {ReturnType<typeof normalizeCritterPreset>[]} presets
 */
export function applyWormPresetsToDOM(presets) {
  const list = document.getElementById("worm-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (document.getElementById("worm-preset-template"));
  if (!list || !template) return;

  const presetData = presets.length > 0 ? presets : [{ ...DEFAULT_CRITTER_PRESET, color: "#8B6550" }];
  list.replaceChildren();
  for (let i = 0; i < presetData.length && i < MAX_CRITTER_TYPES; i++) {
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement)) continue;
    applyWormPresetToRow(row, presetData[i]);
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateCritterRowSpan(row, f);
      });
    });
  }

  const allRows = list.querySelectorAll("[data-worm-preset-row]");
  allRows.forEach((row, i) => {
    const title = row.querySelector(".blade-preset-title");
    if (title) title.textContent = `Worm ${i + 1}`;
    const onlyOne = allRows.length <= 1;
    const btn = row.querySelector(".remove-worm-preset");
    if (btn instanceof HTMLButtonElement) {
      btn.disabled = onlyOne;
      btn.style.opacity = onlyOne ? "0.35" : "1";
    }
  });
}

/**
 * @param {object} opts
 * @param {() => void} opts.onChange
 */
export function initWormPresetsUI({ onChange }) {
  const list = document.getElementById("worm-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (document.getElementById("worm-preset-template"));
  const addBtn = document.getElementById("add-worm-preset");
  if (!list || !template || !addBtn) return;

  function renumberTitles() {
    const rows = list.querySelectorAll("[data-worm-preset-row]");
    rows.forEach((row, i) => {
      const title = row.querySelector(".blade-preset-title");
      if (title) title.textContent = `Worm ${i + 1}`;
    });
  }

  function syncRemoveButtons() {
    const rows = list.querySelectorAll("[data-worm-preset-row]");
    const onlyOne = rows.length <= 1;
    rows.forEach((row) => {
      const btn = row.querySelector(".remove-worm-preset");
      if (btn instanceof HTMLButtonElement) {
        btn.disabled = onlyOne;
        btn.style.opacity = onlyOne ? "0.35" : "1";
      }
    });
  }

  function bindRowInputs(row) {
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateCritterRowSpan(row, f);
      });
    });
  }

  function addRow(silent) {
    if (list.querySelectorAll("[data-worm-preset-row]").length >= MAX_CRITTER_TYPES) return;
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement) || !row.matches("[data-worm-preset-row]")) return;
    renumberTitles();
    syncRemoveButtons();
    bindRowInputs(row);
    applyWormPresetToRow(row, { ...DEFAULT_CRITTER_PRESET, color: "#8B6550" });
    if (!silent) onChange();
  }

  list.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const rm = t.closest(".remove-worm-preset");
    if (!rm) return;
    const row = rm.closest("[data-worm-preset-row]");
    if (!(row instanceof HTMLElement)) return;
    if (list.querySelectorAll("[data-worm-preset-row]").length <= 1) return;
    row.remove();
    renumberTitles();
    syncRemoveButtons();
    onChange();
  });

  addBtn.addEventListener("click", () => addRow(false));

  if (list.querySelectorAll("[data-worm-preset-row]").length === 0) {
    addRow(true);
  } else {
    renumberTitles();
    syncRemoveButtons();
    list.querySelectorAll("[data-worm-preset-row]").forEach((row) => {
      if (row instanceof HTMLElement) bindRowInputs(row);
    });
  }
}

/**
 * @param {HTMLElement} row
 * @param {ReturnType<typeof normalizeBirdPreset>} p
 */
function applyBirdPresetToRow(row, p) {
  const np = normalizeBirdPreset(p);
  const sh = row.querySelector('[data-field="share"]');
  if (sh instanceof HTMLInputElement) sh.value = String(np.sharePercent);
  const col = row.querySelector('[data-field="color"]');
  if (col instanceof HTMLInputElement) col.value = np.color;
  updateCritterRowSpan(row, "share");
}

/**
 * @param {unknown} presets
 */
export function applyBirdPresetsToDOM(presets) {
  const list = document.getElementById("bird-presets-list");
  if (!list) return;
  const norm = normalizeBirdPresets(presets);
  const rows = list.querySelectorAll("[data-bird-preset-row]");
  rows.forEach((row, i) => {
    if (row instanceof HTMLElement && i < 2) applyBirdPresetToRow(row, norm[i]);
  });
}

/**
 * @param {object} opts
 * @param {() => void} opts.onChange
 */
export function initBirdPresetsUI() {
  const list = document.getElementById("bird-presets-list");
  if (!list) return;
  list.querySelectorAll("[data-bird-preset-row]").forEach((row) => {
    if (!(row instanceof HTMLElement)) return;
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateCritterRowSpan(row, f);
      });
    });
  });
}

/**
 * @param {HTMLElement} row
 * @param {ReturnType<typeof normalizeCritterPreset>} p
 */
function applyFishPresetToRow(row, p) {
  const np = normalizeCritterPreset(p);
  const sh = row.querySelector('[data-field="share"]');
  if (sh instanceof HTMLInputElement) sh.value = String(np.sharePercent);
  const col = row.querySelector('[data-field="color"]');
  if (col instanceof HTMLInputElement) col.value = np.color;
  updateCritterRowSpan(row, "share");
}

/**
 * @param {ReturnType<typeof normalizeCritterPreset>[]} presets
 */
export function applyFishPresetsToDOM(presets) {
  const list = document.getElementById("fish-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (document.getElementById("fish-preset-template"));
  if (!list || !template) return;

  const presetData = presets.length > 0 ? presets : [{ ...DEFAULT_CRITTER_PRESET, color: "#4a8fbe" }];
  list.replaceChildren();
  for (let i = 0; i < presetData.length && i < MAX_CRITTER_TYPES; i++) {
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement)) continue;
    applyFishPresetToRow(row, presetData[i]);
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateCritterRowSpan(row, f);
      });
    });
  }

  const allRows = list.querySelectorAll("[data-fish-preset-row]");
  allRows.forEach((row, i) => {
    const title = row.querySelector(".blade-preset-title");
    if (title) title.textContent = `Fish ${i + 1}`;
    const onlyOne = allRows.length <= 1;
    const btn = row.querySelector(".remove-fish-preset");
    if (btn instanceof HTMLButtonElement) {
      btn.disabled = onlyOne;
      btn.style.opacity = onlyOne ? "0.35" : "1";
    }
  });
}

/**
 * @param {object} opts
 * @param {() => void} opts.onChange
 */
export function initFishPresetsUI({ onChange }) {
  const list = document.getElementById("fish-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (document.getElementById("fish-preset-template"));
  const addBtn = document.getElementById("add-fish-preset");
  if (!list || !template || !addBtn) return;

  function renumberTitles() {
    const rows = list.querySelectorAll("[data-fish-preset-row]");
    rows.forEach((row, i) => {
      const title = row.querySelector(".blade-preset-title");
      if (title) title.textContent = `Fish ${i + 1}`;
    });
  }

  function syncRemoveButtons() {
    const rows = list.querySelectorAll("[data-fish-preset-row]");
    const onlyOne = rows.length <= 1;
    rows.forEach((row) => {
      const btn = row.querySelector(".remove-fish-preset");
      if (btn instanceof HTMLButtonElement) {
        btn.disabled = onlyOne;
        btn.style.opacity = onlyOne ? "0.35" : "1";
      }
    });
  }

  function bindRowInputs(row) {
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateCritterRowSpan(row, f);
      });
    });
  }

  function addRow(silent) {
    if (list.querySelectorAll("[data-fish-preset-row]").length >= MAX_CRITTER_TYPES) return;
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement) || !row.matches("[data-fish-preset-row]")) return;
    renumberTitles();
    syncRemoveButtons();
    bindRowInputs(row);
    applyFishPresetToRow(row, { ...DEFAULT_CRITTER_PRESET, color: "#4a8fbe" });
    if (!silent) onChange();
  }

  list.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const rm = t.closest(".remove-fish-preset");
    if (!rm) return;
    const row = rm.closest("[data-fish-preset-row]");
    if (!(row instanceof HTMLElement)) return;
    if (list.querySelectorAll("[data-fish-preset-row]").length <= 1) return;
    row.remove();
    renumberTitles();
    syncRemoveButtons();
    onChange();
  });

  addBtn.addEventListener("click", () => addRow(false));

  if (list.querySelectorAll("[data-fish-preset-row]").length === 0) {
    addRow(true);
  } else {
    renumberTitles();
    syncRemoveButtons();
    list.querySelectorAll("[data-fish-preset-row]").forEach((row) => {
      if (row instanceof HTMLElement) bindRowInputs(row);
    });
  }
}

/**
 * Writes a normalized settings object into all panel controls, then calls `onApplied`.
 * @param {ReturnType<typeof normalizeEnvironmentSettings>} s
 * @param {() => void} [onApplied]
 */
export function applyEnvironmentSettingsToDOM(s, onApplied) {
  const setRange = (id, v) => {
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
    if (el) el.value = String(v);
  };

  setRange("set-grass-count", s.grassCount);
  setRange("set-color-variation", s.colorVariation);
  setRange("set-flower-count", s.flowerCount);
  setRange("set-flower-color-variation", s.flowerColorVariation);
  const g = /** @type {HTMLInputElement | null} */ (document.getElementById("set-ground-color"));
  if (g) g.value = s.groundColor;
  setRange("set-ground-warm", s.groundWarm);
  setRange("set-ground-cool", s.groundCool);
  setRange("set-ground-map-mix", s.groundMapMix);
  setRange("set-terrain-amplitude", s.terrainAmplitude);
  setRange("set-terrain-frequency", s.terrainFrequency);
  setRange("set-terrain-octaves", s.terrainOctaves);
  setRange("set-terrain-persistence", s.terrainPersistence);
  setRange("set-terrain-lacunarity", s.terrainLacunarity);
  setRange("set-terrain-ridge", s.terrainRidge);
  setRange("set-terrain-seed", s.terrainSeed);
  setRange("set-star-amount", s.starAmount);
  setRange("set-nebula-blue", s.nebulaBlue);
  setRange("set-nebula-purple", s.nebulaPurple);
  for (const k of Object.keys(DEFAULT_SKY_TUNING)) {
    const id = skyTuningKeyToDomId(k);
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
    const v = s.skyDetail[/** @type {keyof typeof s.skyDetail} */ (k)];
    if (el && v !== undefined) el.value = String(v);
  }
  setRange("set-weather-rain", s.rainIntensity);
  setRange("set-weather-snow", s.snowIntensity);
  setRange("set-weather-lightning", s.lightningIntensity);
  setRange("set-weather-clouds", s.cloudCover);
  setRange("set-wind-speed", s.windSpeed);
  setRange("set-wind-direction", s.windDirection);
  setRange("set-audio-volume", s.audioVolume);
  const muteEl = document.getElementById("set-audio-muted");
  if (muteEl instanceof HTMLInputElement) muteEl.checked = s.audioMuted;

  setRange("set-tree-count", s.treeCount);
  const treePresetEl = document.getElementById("set-tree-preset");
  if (treePresetEl instanceof HTMLSelectElement) treePresetEl.value = s.treePreset;
  setRange("set-tree-scale", s.treeScale);
  setRange("set-tree-field-seed", s.treeFieldSeed);
  setRange("set-rock-count", s.rockCount);
  setRange("set-boulder-count", s.boulderCount);
  setRange("set-rock-seed", s.rockSeed);
  setRange("set-bee-hive-count", s.beeHiveCount);
  setRange("set-bee-hive-seed", s.beeHiveSeed);

  const treeSpeciesEl = document.getElementById("set-tree-species");
  if (treeSpeciesEl instanceof HTMLSelectElement) treeSpeciesEl.value = s.treeSpecies;
  setRange("set-tree-trunk-radius", s.treeTrunkRadius);
  setRange("set-tree-trunk-length", s.treeTrunkLength);
  setRange("set-tree-branch-levels", s.treeBranchLevels);
  setRange("set-tree-children-trunk", s.treeChildrenTrunk);
  setRange("set-tree-children-branch", s.treeChildrenBranch);
  setRange("set-tree-children-sub", s.treeChildrenSub);
  setRange("set-tree-crown-mul", s.treeCrownLengthMul);
  setRange("set-tree-leaf-count", s.treeLeafCount);
  setRange("set-tree-leaf-size", s.treeLeafSize);
  setRange("set-tree-leaf-variance", s.treeLeafSizeVariance);
  const treeLeafBillboardEl = document.getElementById("set-tree-leaf-billboard");
  if (treeLeafBillboardEl instanceof HTMLSelectElement) {
    treeLeafBillboardEl.value = s.treeLeafBillboard;
  }
  const treeBarkTypeEl = document.getElementById("set-tree-bark-type");
  if (treeBarkTypeEl instanceof HTMLSelectElement) treeBarkTypeEl.value = s.treeBarkType;
  const treeLeafTypeEl = document.getElementById("set-tree-leaf-type");
  if (treeLeafTypeEl instanceof HTMLSelectElement) treeLeafTypeEl.value = s.treeLeafType;
  const treeBarkColorEl = document.getElementById("set-tree-bark-color");
  if (treeBarkColorEl instanceof HTMLInputElement) treeBarkColorEl.value = s.treeBarkColor;
  const treeLeafColorEl = document.getElementById("set-tree-leaf-color");
  if (treeLeafColorEl instanceof HTMLInputElement) treeLeafColorEl.value = s.treeLeafColor;

  setRange("set-butterfly-count", s.butterflyCount);
  setRange("set-butterfly-seed", s.butterflySeed);
  const bfd = s.butterflyDynamics;
  setRange("set-bf-height-min", bfd.heightMin);
  setRange("set-bf-height-max", bfd.heightMax);
  setRange("set-bf-field-spread-mul", bfd.fieldSpreadMul);
  setRange("set-bf-scale-min", bfd.scaleMin);
  setRange("set-bf-scale-range", bfd.scaleRange);
  setRange("set-bf-wander-freq-x", bfd.wanderFreqX);
  setRange("set-bf-wander-freq-z", bfd.wanderFreqZ);
  setRange("set-bf-wander-amp-x", bfd.wanderAmpX);
  setRange("set-bf-wander-amp-z", bfd.wanderAmpZ);
  setRange("set-bf-bob-freq", bfd.bobFreq);
  setRange("set-bf-bob-amp", bfd.bobAmp);
  setRange("set-bf-flap-freq", bfd.flapFreq);
  setRange("set-bf-flap-rot-amp", bfd.flapRotAmp);
  setRange("set-bf-flap-pitch-mul", bfd.flapPitchMul);
  setRange("set-bf-flap-roll-mul", bfd.flapRollMul);
  setRange("set-bf-yaw-spin", bfd.yawSpin);
  setRange("set-bf-drift-base", bfd.driftBase);
  setRange("set-bf-drift-wind-mul", bfd.driftWindMul);
  setRange("set-bf-wind-push-scale", bfd.windPushScale);
  setRange("set-bf-wind-response", bfd.windResponse);
  setRange("set-bf-body-len-mul", bfd.bodyLengthMul);
  setRange("set-bf-body-width-mul", bfd.bodyWidthMul);
  setRange("set-bf-body-thick-mul", bfd.bodyThicknessMul);
  setRange("set-bf-shape-noise-amp", bfd.shapeNoiseAmp);
  setRange("set-bf-shape-noise-f1", bfd.shapeNoiseFreq);
  setRange("set-bf-shape-noise-f2", bfd.shapeNoiseFreq2);
  setRange("set-bf-wing-pairs", bfd.wingPairs);
  setRange("set-bf-leg-count", bfd.legCount);
  setRange("set-bf-eye-x", bfd.eyeOffsetX);
  setRange("set-bf-eye-y", bfd.eyeOffsetY);
  setRange("set-bf-eye-z", bfd.eyeOffsetZ);
  setRange("set-bf-eye-size", bfd.eyeSize);
  setRange("set-bf-insect-emissive", bfd.insectEmissive);
  setRange("set-bf-wing-stroke-freq", bfd.wingStrokeFreq);
  setRange("set-bf-wing-stroke-amp", bfd.wingStrokeAmp);
  setRange("set-bf-leg-swing-freq", bfd.legSwingFreq);
  setRange("set-bf-leg-swing-amp", bfd.legSwingAmp);
  setRange("set-bf-path-body-tilt", bfd.pathBodyTilt);
  setRange("set-ladybug-count", s.ladybugCount);
  setRange("set-ladybug-tree-share", s.ladybugTreeShare);
  setRange("set-ladybug-seed", s.ladybugSeed);
  setRange("set-bumblebee-count", s.bumblebeeCount);
  setRange("set-bumblebee-seed", s.bumblebeeSeed);
  setRange("set-spider-web-count", s.spiderWebCount);
  setRange("set-spider-seed", s.spiderSeed);
  setRange("set-firefly-count", s.fireflyCount);
  setRange("set-firefly-seed", s.fireflySeed);
  setRange("set-ant-count", s.antCount);
  setRange("set-ant-seed", s.antSeed);
  setRange("set-worm-count", s.wormCount);
  setRange("set-worm-seed", s.wormSeed);
  setRange("set-bird-count", s.birdCount);
  setRange("set-bird-seed", s.birdSeed);
  setRange("set-fish-count", s.fishCount);
  setRange("set-fish-seed", s.fishSeed);
  const fd = s.fishDynamics;
  setRange("set-fish-body-length-mul", fd.bodyLengthMul);
  setRange("set-fish-body-depth-mul", fd.bodyDepthMul);
  setRange("set-fish-tail-length-mul", fd.tailLengthMul);
  setRange("set-fish-tail-width-mul", fd.tailWidthMul);
  setRange("set-fish-fin-scale", fd.finScale);
  setRange("set-fish-dorsal-scale", fd.dorsalScale);
  setRange("set-fish-shape-noise-amp", fd.shapeNoiseAmp);
  setRange("set-fish-shape-noise-freq", fd.shapeNoiseFreq);
  setRange("set-fish-swim-freq", fd.swimFreq);
  setRange("set-fish-swim-amp", fd.swimAmp);
  setRange("set-fish-yaw-wander", fd.yawWander);
  setRange("set-fish-depth-min", fd.depthMinFrac);
  setRange("set-fish-depth-max", fd.depthMaxFrac);
  setRange("set-fish-emissive", fd.emissive);
  const fe = s.fishEcosystem;
  setRange("set-fish-eco-pellet-count", fe.pelletCount);
  setRange("set-fish-eco-pellet-seed", fe.pelletSeed);
  setRange("set-fish-eco-regen", fe.pelletRegenPerSec);
  setRange("set-fish-eco-hunger", fe.hungerPerSec);
  setRange("set-fish-eco-feed-pellet", fe.feedPellet);
  setRange("set-fish-eco-feed-ladybug", fe.feedLadybug);
  setRange("set-fish-eco-feed-spider", fe.feedSpider);
  setRange("set-fish-eco-eat-r", fe.eatRadius);
  setRange("set-fish-eco-hunt", fe.huntSteer);
  const pc = document.getElementById("set-fish-pellet-color");
  if (pc instanceof HTMLInputElement) pc.value = fe.pelletColor;
  const pl = document.getElementById("set-fish-eco-prey-ladybugs");
  if (pl instanceof HTMLInputElement) pl.checked = fe.preyLadybugs;
  const ps = document.getElementById("set-fish-eco-prey-spider");
  if (ps instanceof HTMLInputElement) ps.checked = fe.preySpiderZones;

  applyBladePresetsToDOM(s.bladePresets);
  applyFlowerPresetsToDOM(s.flowerPresets);
  applyButterflyPresetsToDOM(s.butterflyPresets);
  applyLadybugPresetsToDOM(s.ladybugPresets);
  applyBumblebeePresetsToDOM(s.bumblebeePresets);
  applyFireflyPresetsToDOM(s.fireflyPresets);
  applyAntPresetsToDOM(s.antPresets);
  applyWormPresetsToDOM(s.wormPresets);
  applyBirdPresetsToDOM(s.birdPresets);
  applyFishPresetsToDOM(s.fishPresets);
  applyWaterShaderToDOM(s.waterShader);
  updateSkyTuningLabelSpans(s.skyDetail);
  onApplied?.();
}

/**
 * @param {object} opts
 * @param {() => void} opts.onChange
 */
export function initBladePresetsUI({ onChange }) {
  const list = document.getElementById("blade-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (document.getElementById("blade-preset-template"));
  const addBtn = document.getElementById("add-blade-preset");
  if (!list || !template || !addBtn) return;

  function renumberTitles() {
    const rows = list.querySelectorAll("[data-blade-preset-row]");
    rows.forEach((row, i) => {
      const title = row.querySelector(".blade-preset-title");
      if (title) title.textContent = `Blade ${i + 1}`;
    });
  }

  function syncRemoveButtons() {
    const rows = list.querySelectorAll("[data-blade-preset-row]");
    const onlyOne = rows.length <= 1;
    rows.forEach((row) => {
      const btn = row.querySelector(".remove-blade-preset");
      if (btn instanceof HTMLButtonElement) {
        btn.disabled = onlyOne;
        btn.style.opacity = onlyOne ? "0.35" : "1";
      }
    });
  }

  function bindRowInputs(row) {
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateBladeRowSpan(row, f);
      });
    });
  }

  function addRow(silent) {
    if (list.querySelectorAll("[data-blade-preset-row]").length >= MAX_BLADE_TYPES) return;
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement) || !row.matches("[data-blade-preset-row]")) return;
    renumberTitles();
    syncRemoveButtons();
    bindRowInputs(row);
    if (!silent) onChange();
  }

  list.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const rm = t.closest(".remove-blade-preset");
    if (!rm) return;
    const row = rm.closest("[data-blade-preset-row]");
    if (!(row instanceof HTMLElement)) return;
    if (list.querySelectorAll("[data-blade-preset-row]").length <= 1) return;
    row.remove();
    renumberTitles();
    syncRemoveButtons();
    onChange();
  });

  addBtn.addEventListener("click", () => addRow(false));

  if (list.querySelectorAll("[data-blade-preset-row]").length === 0) {
    addRow(true);
  } else {
    renumberTitles();
    syncRemoveButtons();
    list.querySelectorAll("[data-blade-preset-row]").forEach((row) => {
      if (row instanceof HTMLElement) bindRowInputs(row);
    });
  }
}

/**
 * @param {object} opts
 * @param {() => void} opts.onChange
 */
export function initFlowerPresetsUI({ onChange }) {
  const list = document.getElementById("flower-presets-list");
  const template = /** @type {HTMLTemplateElement | null} */ (
    document.getElementById("flower-preset-template")
  );
  const addBtn = document.getElementById("add-flower-preset");
  if (!list || !template || !addBtn) return;

  function renumberTitles() {
    const rows = list.querySelectorAll("[data-flower-preset-row]");
    rows.forEach((row, i) => {
      const title = row.querySelector(".blade-preset-title");
      if (title) title.textContent = `Flower ${i + 1}`;
    });
  }

  function syncRemoveButtons() {
    const rows = list.querySelectorAll("[data-flower-preset-row]");
    const onlyOne = rows.length <= 1;
    rows.forEach((row) => {
      const btn = row.querySelector(".remove-flower-preset");
      if (btn instanceof HTMLButtonElement) {
        btn.disabled = onlyOne;
        btn.style.opacity = onlyOne ? "0.35" : "1";
      }
    });
  }

  function bindRowInputs(row) {
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateFlowerRowSpan(row, f);
      });
    });
    const sel = row.querySelector('[data-field="petalCount"]');
    if (sel instanceof HTMLSelectElement) {
      sel.addEventListener("change", () => onChange());
    }
  }

  function addRow(silent) {
    if (list.querySelectorAll("[data-flower-preset-row]").length >= MAX_FLOWER_TYPES) return;
    list.appendChild(template.content.cloneNode(true));
    const row = list.lastElementChild;
    if (!(row instanceof HTMLElement) || !row.matches("[data-flower-preset-row]")) return;
    renumberTitles();
    syncRemoveButtons();
    bindRowInputs(row);
    if (!silent) onChange();
  }

  list.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const rm = t.closest(".remove-flower-preset");
    if (!rm) return;
    const row = rm.closest("[data-flower-preset-row]");
    if (!(row instanceof HTMLElement)) return;
    if (list.querySelectorAll("[data-flower-preset-row]").length <= 1) return;
    row.remove();
    renumberTitles();
    syncRemoveButtons();
    onChange();
  });

  addBtn.addEventListener("click", () => addRow(false));

  if (list.querySelectorAll("[data-flower-preset-row]").length === 0) {
    addRow(true);
  } else {
    renumberTitles();
    syncRemoveButtons();
    list.querySelectorAll("[data-flower-preset-row]").forEach((row) => {
      if (row instanceof HTMLElement) bindRowInputs(row);
    });
  }
}

/**
 * @param {HTMLElement} panel
 */
function initSettingsTabs(panel) {
  const tablist = panel.querySelector(".settings-tabs");
  if (!tablist) return;
  const tabs = tablist.querySelectorAll(".settings-tab");
  const panels = panel.querySelectorAll(".settings-tab-panel");
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-tab");
      if (!id) return;
      tabs.forEach((b) => {
        const active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-selected", active ? "true" : "false");
      });
      panels.forEach((p) => {
        p.classList.toggle("is-active", p.id === `panel-${id}`);
      });
    });
  });
}

/**
 * @param {object} opts
 * @param {() => void} opts.onChange
 */
export function initSettingsPanel({ onChange }) {
  const panel = document.getElementById("settings-panel");
  const toggleBtn = document.getElementById("settings-toggle");
  const closeBtn = document.getElementById("settings-close");
  if (!panel || !toggleBtn) return;

  initSettingsTabs(panel);

  function debounce(fn, ms) {
    let t;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  const debounced = debounce(onChange, 320);

  panel.addEventListener("input", (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.id.startsWith("set-sky-")) {
      const sp = document.getElementById(t.id.replace(/^set-sky-/, "val-sky-"));
      if (sp) {
        if (t.type === "color") sp.textContent = t.value;
        else {
          const v = parseFloat(t.value);
          sp.textContent = Number.isFinite(v)
            ? Math.abs(v) < 10
              ? v.toFixed(3)
              : v.toFixed(2)
            : "";
        }
      }
    }
    if (!(t instanceof HTMLInputElement)) return;
    if (
      t.id === "set-grass-count" ||
      t.id === "set-flower-count" ||
      t.id === "set-tree-count" ||
      t.id === "set-tree-scale" ||
      t.id === "set-tree-field-seed" ||
      t.id === "set-tree-trunk-radius" ||
      t.id === "set-tree-trunk-length" ||
      t.id === "set-tree-branch-levels" ||
      t.id === "set-tree-children-trunk" ||
      t.id === "set-tree-children-branch" ||
      t.id === "set-tree-children-sub" ||
      t.id === "set-tree-crown-mul" ||
      t.id === "set-tree-leaf-count" ||
      t.id === "set-tree-leaf-size" ||
      t.id === "set-tree-leaf-variance" ||
      t.id === "set-butterfly-count" ||
      t.id === "set-butterfly-seed" ||
      t.id === "set-bf-height-min" ||
      t.id === "set-bf-height-max" ||
      t.id === "set-bf-field-spread-mul" ||
      t.id === "set-bf-scale-min" ||
      t.id === "set-bf-scale-range" ||
      t.id === "set-bf-body-len-mul" ||
      t.id === "set-bf-body-width-mul" ||
      t.id === "set-bf-body-thick-mul" ||
      t.id === "set-bf-shape-noise-amp" ||
      t.id === "set-bf-shape-noise-f1" ||
      t.id === "set-bf-shape-noise-f2" ||
      t.id === "set-bf-wing-pairs" ||
      t.id === "set-bf-leg-count" ||
      t.id === "set-bf-eye-x" ||
      t.id === "set-bf-eye-y" ||
      t.id === "set-bf-eye-z" ||
      t.id === "set-bf-eye-size" ||
      t.id === "set-ladybug-count" ||
      t.id === "set-ladybug-seed" ||
      t.id === "set-bumblebee-count" ||
      t.id === "set-bumblebee-seed" ||
      t.id === "set-spider-web-count" ||
      t.id === "set-spider-seed" ||
      t.id === "set-firefly-count" ||
      t.id === "set-firefly-seed" ||
      t.id === "set-ant-count" ||
      t.id === "set-ant-seed" ||
      t.id === "set-worm-count" ||
      t.id === "set-worm-seed" ||
      t.id === "set-bird-count" ||
      t.id === "set-bird-seed" ||
      t.id === "set-fish-count" ||
      t.id === "set-fish-seed" ||
      t.id === "set-fish-body-length-mul" ||
      t.id === "set-fish-body-depth-mul" ||
      t.id === "set-fish-tail-length-mul" ||
      t.id === "set-fish-tail-width-mul" ||
      t.id === "set-fish-fin-scale" ||
      t.id === "set-fish-dorsal-scale" ||
      t.id === "set-fish-shape-noise-amp" ||
      t.id === "set-fish-shape-noise-freq" ||
      t.id === "set-fish-swim-freq" ||
      t.id === "set-fish-swim-amp" ||
      t.id === "set-fish-yaw-wander" ||
      t.id === "set-fish-depth-min" ||
      t.id === "set-fish-depth-max" ||
      t.id === "set-fish-emissive" ||
      t.id === "set-fish-eco-pellet-count" ||
      t.id === "set-fish-eco-pellet-seed" ||
      t.id === "set-fish-eco-regen" ||
      t.id === "set-fish-eco-hunger" ||
      t.id === "set-fish-eco-feed-pellet" ||
      t.id === "set-fish-eco-feed-ladybug" ||
      t.id === "set-fish-eco-feed-spider" ||
      t.id === "set-fish-eco-eat-r" ||
      t.id === "set-fish-eco-hunt"
    ) {
      debounced();
    } else {
      onChange();
    }
  });

  panel.addEventListener("change", (e) => {
    const t = e.target;
    if (t instanceof HTMLSelectElement && t.closest("#blade-presets-list")) onChange();
    if (t instanceof HTMLSelectElement && t.closest("#flower-presets-list")) onChange();
    if (
      t instanceof HTMLSelectElement &&
      (t.id === "set-tree-preset" ||
        t.id === "set-tree-species" ||
        t.id === "set-tree-leaf-billboard" ||
        t.id === "set-tree-bark-type" ||
        t.id === "set-tree-leaf-type")
    ) {
      onChange();
    }
    if (t instanceof HTMLInputElement && t.type === "checkbox" && t.id === "set-audio-muted") {
      onChange();
    }
    if (
      t instanceof HTMLInputElement &&
      t.type === "checkbox" &&
      (t.id === "set-fish-eco-prey-ladybugs" || t.id === "set-fish-eco-prey-spider")
    ) {
      onChange();
    }
  });

  initBladePresetsUI({ onChange });
  initFlowerPresetsUI({ onChange });
  initButterflyPresetsUI({ onChange });
  initLadybugPresetsUI({ onChange });
  initBumblebeePresetsUI({ onChange });
  initFireflyPresetsUI({ onChange });
  initAntPresetsUI({ onChange });
  initWormPresetsUI({ onChange });
  initBirdPresetsUI();
  initFishPresetsUI({ onChange });

  toggleBtn.addEventListener("click", () => panel.classList.toggle("open"));
  closeBtn?.addEventListener("click", () => panel.classList.remove("open"));

  document.addEventListener("keydown", (e) => {
    if (e.code === "Escape") panel.classList.remove("open");
    if (
      e.code === "KeyP" &&
      !e.ctrlKey &&
      !e.metaKey &&
      document.activeElement?.tagName !== "INPUT"
    ) {
      e.preventDefault();
      panel.classList.toggle("open");
    }
  });
}
