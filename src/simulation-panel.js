/**
 * Simulation lab: outline ideas per built-in world system and link them into the scene
 * by writing the matching settings sliders (same sources as Critters / Weather / etc.).
 */

import { initMoonTideControls, syncMoonTideFromDom } from "./moon-tide.js";

const STORAGE_KEY = "world-maker-simulation-lab";
const STORAGE_VERSION = 1;

/**
 * @typedef {{
 *   v: number,
 *   outlines: Record<string, string>,
 *   linked: Record<string, boolean>,
 *   globalNotes: string,
 *   spatialMemory: { world: string, regions: string, local: string, ties: string },
 * }} SimulationLabState
 */

/**
 * @param {string} id
 * @param {number | string | boolean} value
 */
function setControlValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox") {
      el.checked = Boolean(value);
    } else {
      el.value = String(value);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

/**
 * @param {string} id
 * @returns {number}
 */
function readFloat(id, fallback = 0) {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) return fallback;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * @param {string} id
 * @returns {number}
 */
function readInt(id, fallback = 0) {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) return fallback;
  const v = parseInt(el.value, 10);
  return Number.isFinite(v) ? v : fallback;
}

/** @type {readonly { id: string, title: string, blurb: string, settingsTab: string }[]} */
export const SIMULATION_CATALOG = [
  {
    id: "moon-tide",
    title: "Moon & tides",
    blurb: "Semi-diurnal sea level + spring/neap envelope on the water table (Ground → Water). Fish follow mean sea level.",
    settingsTab: "ground",
  },
  {
    id: "weather",
    title: "Weather",
    blurb: "Rain, snow, lightning, clouds — sliders on the Weather tab.",
    settingsTab: "weather",
  },
  {
    id: "lake-fish",
    title: "Lake fish & food web",
    blurb: "Procedural fish, pellets, predation — counts and ecosystem on Critters.",
    settingsTab: "critters",
  },
  {
    id: "butterflies",
    title: "Butterflies",
    blurb: "Field swarm; counts on Critters, wing motion tuning on Insects.",
    settingsTab: "critters",
  },
  {
    id: "ladybugs",
    title: "Ladybugs",
    blurb: "Ground and canopy crawlers; tree share on Critters.",
    settingsTab: "critters",
  },
  {
    id: "bumblebees-hives",
    title: "Bumblebees & hives",
    blurb: "Bee counts on Critters; hive placements on Trees.",
    settingsTab: "critters",
  },
  {
    id: "fireflies",
    title: "Fireflies",
    blurb: "Night lights over terrain — Critters.",
    settingsTab: "critters",
  },
  {
    id: "ants",
    title: "Ants",
    blurb: "Colony trails on the ground — Critters.",
    settingsTab: "critters",
  },
  {
    id: "worms",
    title: "Soil worms",
    blurb: "Subsurface motion in soil patches — Critters.",
    settingsTab: "critters",
  },
  {
    id: "spider-webs",
    title: "Spider webs",
    blurb: "Orb webs between trees — Critters.",
    settingsTab: "critters",
  },
];

/**
 * @returns {SimulationLabState}
 */
function defaultSpatialMemory() {
  return { world: "", regions: "", local: "", ties: "" };
}

function defaultState() {
  return {
    v: STORAGE_VERSION,
    outlines: {},
    linked: {},
    globalNotes: "",
    spatialMemory: defaultSpatialMemory(),
  };
}

/**
 * @returns {SimulationLabState}
 */
export function loadSimulationLabState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return defaultState();
    const outlines =
      o.outlines && typeof o.outlines === "object"
        ? /** @type {Record<string, string>} */ (o.outlines)
        : {};
    const linked =
      o.linked && typeof o.linked === "object" ? /** @type {Record<string, boolean>} */ (o.linked) : {};
    const smRaw = o.spatialMemory && typeof o.spatialMemory === "object" ? o.spatialMemory : null;
    const spatialMemory = {
      world: typeof smRaw?.world === "string" ? smRaw.world : "",
      regions: typeof smRaw?.regions === "string" ? smRaw.regions : "",
      local: typeof smRaw?.local === "string" ? smRaw.local : "",
      ties: typeof smRaw?.ties === "string" ? smRaw.ties : "",
    };
    return {
      v: typeof o.v === "number" ? o.v : STORAGE_VERSION,
      outlines,
      linked,
      globalNotes: typeof o.globalNotes === "string" ? o.globalNotes : "",
      spatialMemory,
    };
  } catch {
    return defaultState();
  }
}

/**
 * @param {SimulationLabState} state
 */
export function saveSimulationLabState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, v: STORAGE_VERSION }));
  } catch {
    /* ignore quota */
  }
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isSimulationActiveInDom(id) {
  switch (id) {
    case "moon-tide": {
      const el = document.getElementById("sim-moon-tide-enabled");
      return el instanceof HTMLInputElement && el.checked;
    }
    case "weather":
      return readFloat("set-weather-rain", 0) > 0.04 || readFloat("set-weather-snow", 0) > 0.04;
    case "lake-fish":
      return readInt("set-fish-count", 0) > 0;
    case "butterflies":
      return readInt("set-butterfly-count", 0) > 0;
    case "ladybugs":
      return readInt("set-ladybug-count", 0) > 0;
    case "bumblebees-hives":
      return readInt("set-bumblebee-count", 0) > 0 || readInt("set-bee-hive-count", 0) > 0;
    case "fireflies":
      return readInt("set-firefly-count", 0) > 0;
    case "ants":
      return readInt("set-ant-count", 0) > 0;
    case "worms":
      return readInt("set-worm-count", 0) > 0;
    case "spider-webs":
      return readInt("set-spider-web-count", 0) > 0;
    default:
      return false;
  }
}

/**
 * @param {string} id
 * @param {boolean} linked
 */
function applyLinkPreset(id, linked) {
  switch (id) {
    case "moon-tide":
      if (linked) {
        setControlValue("sim-moon-tide-enabled", true);
        setControlValue("sim-moon-tide-strength", 0.42);
        setControlValue("sim-moon-tide-semi", 90);
        setControlValue("sim-moon-tide-lunar", 800);
      } else {
        setControlValue("sim-moon-tide-enabled", false);
      }
      syncMoonTideFromDom();
      break;
    case "weather":
      if (linked) {
        setControlValue("set-weather-rain", 0.38);
        setControlValue("set-weather-snow", 0);
        setControlValue("set-weather-lightning", 0.12);
        setControlValue("set-weather-clouds", 0.58);
      } else {
        setControlValue("set-weather-rain", 0);
        setControlValue("set-weather-snow", 0);
        setControlValue("set-weather-lightning", 0);
        setControlValue("set-weather-clouds", 0.35);
      }
      break;
    case "lake-fish":
      if (linked) {
        setControlValue("set-fish-count", 64);
        setControlValue("set-fish-eco-pellet-count", 2000);
        setControlValue("set-fish-eco-regen", 10);
      } else {
        setControlValue("set-fish-count", 0);
        setControlValue("set-fish-eco-pellet-count", 0);
        setControlValue("set-fish-eco-regen", 0);
      }
      break;
    case "butterflies":
      setControlValue("set-butterfly-count", linked ? 48 : 0);
      break;
    case "ladybugs":
      setControlValue("set-ladybug-count", linked ? 120 : 0);
      break;
    case "bumblebees-hives":
      if (linked) {
        setControlValue("set-bee-hive-count", 3);
        setControlValue("set-bumblebee-count", 32);
      } else {
        setControlValue("set-bumblebee-count", 0);
        setControlValue("set-bee-hive-count", 0);
      }
      break;
    case "fireflies":
      setControlValue("set-firefly-count", linked ? 96 : 0);
      break;
    case "ants":
      setControlValue("set-ant-count", linked ? 480 : 0);
      break;
    case "worms":
      setControlValue("set-worm-count", linked ? 220 : 0);
      break;
    case "spider-webs":
      setControlValue("set-spider-web-count", linked ? 8 : 0);
      break;
    default:
      break;
  }
}

/**
 * Sync checkbox state from current scene settings (when opening the tab).
 * @param {Record<string, HTMLInputElement>} linkInputs
 */
export function syncSimulationLinkedFromDom(linkInputs) {
  for (const sim of SIMULATION_CATALOG) {
    const box = linkInputs[sim.id];
    if (!box) continue;
    box.checked = isSimulationActiveInDom(sim.id);
  }
}

/**
 * @param {SimulationLabState} state
 */
function initSpatialMemoryEditors(state) {
  if (!state.spatialMemory) state.spatialMemory = defaultSpatialMemory();
  const sm = state.spatialMemory;
  const fields = /** @type {const} */ ([
    ["spatial-memory-world", "world"],
    ["spatial-memory-regions", "regions"],
    ["spatial-memory-local", "local"],
    ["spatial-memory-ties", "ties"],
  ]);
  for (const [id, key] of fields) {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLTextAreaElement)) continue;
    el.value = sm[key] ?? "";
    let persistTimer = 0;
    el.addEventListener("input", () => {
      sm[key] = el.value;
      state.spatialMemory = sm;
      window.clearTimeout(persistTimer);
      persistTimer = window.setTimeout(() => saveSimulationLabState(state), 400);
    });
  }
}

/**
 * @param {object} opts
 * @param {() => void} opts.onApplySettings
 */
export function initSimulationPanel({ onApplySettings }) {
  initMoonTideControls({ onChange: onApplySettings });

  const state = loadSimulationLabState();
  initSpatialMemoryEditors(state);

  const globalTaEarly = document.getElementById("simulation-global-notes");
  if (globalTaEarly instanceof HTMLTextAreaElement) {
    globalTaEarly.value = state.globalNotes;
    let gTimer = 0;
    globalTaEarly.addEventListener("input", () => {
      state.globalNotes = globalTaEarly.value;
      window.clearTimeout(gTimer);
      gTimer = window.setTimeout(() => saveSimulationLabState(state), 400);
    });
  }

  const root = document.getElementById("simulation-catalog");
  if (!root) return;

  /** @type {Record<string, HTMLInputElement>} */
  const linkInputs = {};
  /** @type {Record<string, HTMLTextAreaElement>} */
  const outlineEls = {};

  for (const sim of SIMULATION_CATALOG) {
    const card = document.createElement("article");
    card.className = "simulation-card";
    card.setAttribute("data-simulation-id", sim.id);

    const head = document.createElement("div");
    head.className = "simulation-card-head";

    const titles = document.createElement("div");
    const h = document.createElement("h4");
    h.className = "simulation-card-title";
    h.textContent = sim.title;
    const sub = document.createElement("p");
    sub.className = "simulation-card-blurb";
    sub.textContent = sim.blurb;
    titles.append(h, sub);

    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "simulation-jump-btn";
    jump.textContent = "Open tab";
    jump.setAttribute("aria-label", `Open ${sim.settingsTab} settings`);
    jump.addEventListener("click", () => {
      const tab = document.querySelector(`.settings-tab[data-tab="${sim.settingsTab}"]`);
      if (tab instanceof HTMLElement) tab.click();
    });

    head.append(titles, jump);

    const ta = document.createElement("textarea");
    ta.className = "simulation-outline";
    ta.rows = 3;
    ta.setAttribute("aria-label", `Outline for ${sim.title}`);
    ta.placeholder = "Outline behaviors, constraints, or story beats…";
    ta.value = state.outlines[sim.id] ?? "";
    outlineEls[sim.id] = ta;

    const row = document.createElement("label");
    row.className = "simulation-link-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "simulation-linked";
    cb.checked = state.linked[sim.id] === true;
    linkInputs[sim.id] = cb;
    const span = document.createElement("span");
    span.textContent = "Linked to world (applies defaults below)";
    row.append(cb, span);

    const hint = document.createElement("p");
    hint.className = "simulation-link-hint";
    hint.textContent =
      "When checked, scene counts and weather sliders update to turn this system on; uncheck to clear counts for this slice.";

    card.append(head, ta, row, hint);
    root.appendChild(card);

    let persistTimer = 0;
    ta.addEventListener("input", () => {
      state.outlines[sim.id] = ta.value;
      window.clearTimeout(persistTimer);
      persistTimer = window.setTimeout(() => saveSimulationLabState(state), 400);
    });

    cb.addEventListener("change", () => {
      state.linked[sim.id] = cb.checked;
      applyLinkPreset(sim.id, cb.checked);
      saveSimulationLabState(state);
      onApplySettings();
    });
  }

  const tabBtn = document.querySelector('.settings-tab[data-tab="simulation"]');
  if (tabBtn) {
    tabBtn.addEventListener("click", () => {
      syncSimulationLinkedFromDom(linkInputs);
    });
  }

  syncSimulationLinkedFromDom(linkInputs);
}
