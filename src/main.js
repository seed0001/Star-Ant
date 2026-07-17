import * as THREE from "three";
import { PMREMGenerator } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { SkyDome } from "./sky.js";
import { GroundPlane, GROUND_EXTENT } from "./ground.js";
import { ConstellationOverlay } from "./constellation-overlay.js";
import {
  applyEnvironmentSettingsToDOM,
  initSettingsPanel,
  loadEnvironmentSettingsAutosave,
  mergePlayableContentDefaultsForSpawn,
  saveEnvironmentSettingsAutosave,
  updateSkyTuningLabelSpans,
  normalizeEnvironmentSettings,
  normalizeBirdPresets,
  normalizeTreeShapeFields,
  parseEnvironmentJsonPayload,
  readSettingsFromDOM,
  serializeEnvironmentSettings,
  serializeInsectButterflySettings,
} from "./settings-panel.js";
import {
  ButterflySwarm,
  LadybugSwarm,
  butterflySignature,
  ladybugSignature,
  splitCounts,
} from "./critters.js";
import { BumblebeeSwarm, bumblebeeSignature } from "./bumblebee-swarm.js";
import { AntSwarm, FireflySwarm, antSignature, fireflySignature } from "./fireflies-ants.js";
import { WormSwarm, wormSignature } from "./worms.js";
import { FishSwarm, fishSignature } from "./fish-swarm.js";
import { BirdFlock, birdSignature } from "./bird-flock.js";
import { LakeWhale } from "./whale.js";
import { FishFoodField, fishFoodSignature } from "./fish-food.js";
import { normalizeFishEcosystem } from "./fish-ecosystem.js";
import { SpiderWebField, spiderSignature } from "./spiders.js";
import { BeeLocomotion, BumblebeePilot, FlyMode } from "./bumblebee.js";
import { BeeBuzz } from "./bee-buzz.js";
import { FlowerField, flowerSignature, setFlowerMaterialUniformsFromPreset } from "./flowers.js";
import { initFlowerEditor } from "./flower-editor.js";
import { TreeForest, treeForestSignature } from "./trees.js";
import { RockField, rockFieldSignature } from "./rocks.js";
import { BeeHiveField, beeHiveSignature } from "./bee-hives.js";
import { TreeChopSystem } from "./tree-chop.js";
import { RandomCreatureViewController } from "./random-creature-view.js";
import { DocumentaryController } from "./documentary.js";
import { initTabletControls } from "./tablet-controls.js";
import {
  TerrainHeightField,
  TERRAIN_WORLD_HALF_EXTENT,
  WATER_TABLE_DEPTH_M,
  getDryLandSpawnPoints,
  sampleLandXZForSpawn,
} from "./terrain-paint.js";
import {
  downloadTerrainJsonFile,
  tryImportTerrainFromJsonText,
  loadTerrainFromLocalStorageOrClearBroken,
  saveTerrainToLocalStorage,
  clearAllWorldBrowserStorage,
  applyWipeFromUrlIfRequested,
  getTerrainSnapshotForExport,
  WORLD_MODE_STORAGE_KEY,
  WORLD_CONTENT_SPAWNED_STORAGE_KEY,
} from "./terrain-persistence.js";
import { consumeBootstrapTerrain } from "./terrain-bootstrap.js";
import { DEFAULT_BUTTERFLY_DYNAMICS } from "./butterfly-dynamics.js";
import { ButterflyInsectPreview } from "./insect-preview.js";
import { PathAuthoringController } from "./path-authoring-controller.js";
import { WeatherEffects } from "./weather-effects.js";
import { SoldierPilot } from "./soldier-pilot.js";
import {
  DEFAULT_WATER_SHADER,
  formatWaterShaderValueLabel,
  normalizeWaterShaderSettings,
  waterShaderValId,
} from "./water-shader-settings.js";
import { initSimulationPanel } from "./simulation-panel.js";
import { computeMoonTide, getMoonTideParams } from "./moon-tide.js";
import { SnowAccumulationField } from "./snow-accumulation.js";

const NIGHT_FOG = new THREE.Color(0x252b26);
const DAY_FOG = new THREE.Color(0x7fbfff);

/** Latest normalized water shader (updated in {@link applySettings}). */
let latestWaterShader = normalizeWaterShaderSettings({});

let dayPhase = 1;
let targetDayPhase = 1;
let isDay = true;

function configureGroundTexture(tex, renderer) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(48, 48);
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
}

const canvas = document.querySelector("#c");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x252b26, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(DAY_FOG.clone(), 0.0005);
// Match fog so gaps / clear pixels never show a mismatched strip at the horizon.
scene.background = scene.fog.color.clone();
renderer.setClearColor(scene.background, 1);

const ambient = new THREE.AmbientLight(0xffffff, 0.8);
const sun = new THREE.DirectionalLight(0xfff5e6, 1.5);
sun.position.set(30, 50, 20);
const hemiFill = new THREE.HemisphereLight(0xb8d4ff, 0x4a3c2e, 0.42);
scene.add(ambient, sun, hemiFill);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  50000
);
camera.position.set(0, 5.5, 20);

function syncRendererToDisplaySize() {
  let w = window.innerWidth;
  let h = window.innerHeight;
  if (document.body.classList.contains("app-mode-tablet")) {
    const host = document.getElementById("game-root");
    if (host) {
      const r = host.getBoundingClientRect();
      const rw = Math.floor(r.width);
      const rh = Math.floor(r.height);
      if (rw >= 2 && rh >= 2) {
        w = rw;
        h = rh;
      }
    }
  }
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

syncRendererToDisplaySize();

/** In-scene path authoring (anchors + variable tube mesh). */
if (canvas instanceof HTMLCanvasElement) {
  new PathAuthoringController({ scene, camera, canvas });
}

/** @type {WeatherEffects | null} */
let weatherEffects = null;
weatherEffects = new WeatherEffects(scene);

const keys = new Set();
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const PI_2 = Math.PI / 2;
let pointerLocked = false;

/** Free-flight units/sec (WASD + vertical). Adjust with HUD slider or mouse wheel on canvas. */
const FLY_SPEED_MIN = 0.25;
const FLY_SPEED_MAX = 120;
let flySpeed = 18;
/** Slightly slower than free-fly — feels closer to insect scale. */
const beeDroneSpeed = 9;
const lookSensitivity = 0.0022;

/** @type {typeof FlyMode[keyof typeof FlyMode]} */
let flyMode = FlyMode.FREE;

/** For landing velocity; updated while bee drone is active. */
let prevBeeY = 0;
/** @type {string} */
let lastBeeHudLoco = "";

/** @type {BumblebeePilot | null} */
let beePilot = null;

/** @type {SoldierPilot | null} */
let soldierPilot = null;
/** Restored when leaving micro-world. */
let savedCameraNear = 0.1;
/** Micro-world camera: chase vs head-mounted (persisted in localStorage). */
let soldierThirdPerson = false;

const beeBuzz = new BeeBuzz();
/** Master audio from settings (0–1). */
let lastAudioVolume = 1;
let lastAudioMuted = false;

/** Third-person orbit around bee while autopilot runs (radians). */
let orbitPanAngle = 0;
/** Mouse orbit strafe offset (radians). */
let orbitYawOffset = 0;
const BEE_ORBIT_RADIUS_BASE = 1.15;
const BEE_ORBIT_HEIGHT_BASE = 0.45;
/** Radians per second — keep low so watch mode feels calm. */
const BEE_ORBIT_PAN_SPEED = 0.16;
/** Extra radius when the bee is high (wide establishing shots). */
const BEE_ORBIT_HEIGHT_SCALE = 0.42;

/**
 * @param {number} dt
 */
function updateBeeOrbitCamera(dt) {
  if (!beePilot) return;
  const center = beePilot.getWorldCenter();
  orbitPanAngle += dt * BEE_ORBIT_PAN_SPEED;
  const ang = orbitPanAngle + orbitYawOffset;
  const h = center.y;
  const highBonus = Math.max(0, h - 4.5) * BEE_ORBIT_HEIGHT_SCALE;
  const breathe = Math.sin(orbitPanAngle * 0.21);
  const vista = Math.sin(orbitPanAngle * 0.13);
  const radius = BEE_ORBIT_RADIUS_BASE + breathe * 4.8 + highBonus * 1.1 + vista * 2.2;
  const camY =
    h +
    BEE_ORBIT_HEIGHT_BASE +
    breathe * 1.2 +
    vista * 5.5 +
    highBonus * 0.95;
  camera.position.set(
    center.x + Math.cos(ang) * radius,
    camY,
    center.z + Math.sin(ang) * radius
  );
  camera.lookAt(center);
}

function toggleDayNight() {
  isDay = !isDay;
  targetDayPhase = isDay ? 1 : 0;
}

document.addEventListener("keydown", (e) => {
  if (
    e.code === "Escape" &&
    !e.repeat &&
    randomCreatureView.active &&
    document.activeElement?.tagName !== "INPUT" &&
    document.activeElement?.tagName !== "TEXTAREA" &&
    document.activeElement?.tagName !== "SELECT"
  ) {
    e.preventDefault();
    toggleRandomCreatureView();
    return;
  }
  if (e.code === "Digit1") {
    e.preventDefault();
    toggleDayNight();
    return;
  }
  if (
    e.code === "KeyT" &&
    !e.repeat &&
    flyMode === FlyMode.FREE &&
    document.activeElement?.tagName !== "INPUT" &&
    document.activeElement?.tagName !== "TEXTAREA" &&
    document.activeElement?.tagName !== "SELECT"
  ) {
    e.preventDefault();
    terrainPaint.active = false;
    if (treeChop) {
      treeChop.chopMode = !treeChop.chopMode;
      updateBeeHud();
    }
    return;
  }
  if (
    (e.ctrlKey || e.metaKey) &&
    e.code === "KeyZ" &&
    !e.shiftKey &&
    !e.repeat &&
    flyMode === FlyMode.FREE &&
    document.activeElement?.tagName !== "INPUT" &&
    document.activeElement?.tagName !== "TEXTAREA" &&
    document.activeElement?.tagName !== "SELECT"
  ) {
    e.preventDefault();
    performTerrainUndo();
    return;
  }
  if (
    e.code === "KeyE" &&
    !e.repeat &&
    flyMode === FlyMode.FREE &&
    document.activeElement?.tagName !== "INPUT" &&
    document.activeElement?.tagName !== "TEXTAREA" &&
    document.activeElement?.tagName !== "SELECT"
  ) {
    e.preventDefault();
    terrainPaint.active = !terrainPaint.active;
    if (terrainPaint.active && treeChop) {
      treeChop.chopMode = false;
    }
    if (!terrainPaint.active) {
      terrainPaint.dragging = false;
      finalizeTerrainPaintStroke();
    }
    updateBeeHud();
    return;
  }
  keys.add(e.code);
  if (e.code === "Space") e.preventDefault();
});
document.addEventListener("keyup", (e) => keys.delete(e.code));

canvas.addEventListener("click", () => {
  void beeBuzz.ensureContext();
  if (document.body.classList.contains("app-mode-tablet")) return;
  if (!pointerLocked && !randomCreatureView.active) canvas.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  pointerLocked = document.pointerLockElement === canvas;
});

document.addEventListener("mousemove", (e) => {
  if (!pointerLocked) return;
  if (randomCreatureView.active) return;
  // Terrain paint intentionally keeps look active while dragging so you can sweep the
  // center-screen brush across the ground smoothly (the brush follows where you look).
  if (treeChop?.dragging) return;
  if (flyMode === FlyMode.BEE_ORBIT && beePilot) {
    orbitYawOffset += e.movementX * 0.004;
    return;
  }
  if (flyMode === FlyMode.BEE_AUTO) return;
  euler.y -= e.movementX * lookSensitivity;
  euler.x -= e.movementY * lookSensitivity;
  if (
    flyMode === FlyMode.BEE_DRONE &&
    beePilot &&
    beePilot.locomotion !== BeeLocomotion.FLYING
  ) {
    euler.x = THREE.MathUtils.clamp(euler.x, -0.62, -0.06);
  } else {
    euler.x = Math.max(-PI_2 + 0.01, Math.min(PI_2 - 0.01, euler.x));
  }
});

function updateMovement(dt) {
  if (flyMode === FlyMode.SOLDIER) return;
  if (flyMode !== FlyMode.FREE) return;
  const forward = new THREE.Vector3(0, 0, -1).applyEuler(euler);
  const right = new THREE.Vector3(1, 0, 0).applyEuler(euler);
  const up = new THREE.Vector3(0, 1, 0);

  const v = new THREE.Vector3();
  if (keys.has("KeyW")) v.add(forward);
  if (keys.has("KeyS")) v.sub(forward);
  if (keys.has("KeyA")) v.sub(right);
  if (keys.has("KeyD")) v.add(right);
  if (keys.has("Space")) v.add(up);
  if (keys.has("ShiftLeft") || keys.has("ShiftRight")) v.sub(up);

  if (v.lengthSq() > 0) {
    v.normalize().multiplyScalar(flySpeed * dt);
    camera.position.add(v);
  }
  camera.quaternion.setFromEuler(euler);
}

function syncFlySpeedHud() {
  flySpeed = THREE.MathUtils.clamp(flySpeed, FLY_SPEED_MIN, FLY_SPEED_MAX);
  const slider = document.getElementById("hud-fly-speed");
  const valEl = document.getElementById("hud-fly-speed-val");
  if (slider instanceof HTMLInputElement) {
    slider.value = String(flySpeed);
  }
  if (valEl) {
    valEl.textContent =
      flySpeed < 1 ? flySpeed.toFixed(2) : flySpeed < 10 ? flySpeed.toFixed(1) : String(Math.round(flySpeed));
  }
}

/**
 * @param {number} next
 */
function setFlySpeed(next) {
  if (!Number.isFinite(next)) return;
  flySpeed = THREE.MathUtils.clamp(next, FLY_SPEED_MIN, FLY_SPEED_MAX);
  syncFlySpeedHud();
}

document.getElementById("hud-fly-speed")?.addEventListener("input", (e) => {
  const t = /** @type {HTMLInputElement} */ (e.target);
  const v = parseFloat(t.value);
  if (Number.isFinite(v)) setFlySpeed(v);
});

canvas.addEventListener(
  "wheel",
  (e) => {
    if (flyMode !== FlyMode.FREE || randomCreatureView.active) return;
    e.preventDefault();
    const up = e.deltaY < 0;
    const pow = e.shiftKey ? 1.15 : 1.06;
    setFlySpeed(flySpeed * (up ? pow : 1 / pow));
  },
  { passive: false }
);

syncFlySpeedHud();

window.addEventListener("resize", () => {
  syncRendererToDisplaySize();
});

if (document.body.classList.contains("app-mode-tablet")) {
  const gameRootEl = document.getElementById("game-root");
  if (gameRootEl) {
    const ro = new ResizeObserver(() => {
      syncRendererToDisplaySize();
    });
    ro.observe(gameRootEl);
    requestAnimationFrame(() => {
      syncRendererToDisplaySize();
      requestAnimationFrame(() => syncRendererToDisplaySize());
    });
  }
}

const clock = new THREE.Clock();

/** @type {SkyDome | null} */
let sky = null;
/** @type {ConstellationOverlay | null} */
let constellations = null;
/** @type {THREE.Group | null} */
let grassGroup = null;
/** @type {(THREE.ShaderMaterial | null)[]} */
let grassMatsByType = [];

/**
 * Half-extent of the grass/trees/flowers/critters field on X/Z (centered at origin).
 * Same as terrain/ground half-extent (±200 m, 400×400 m world) so spawn fills the map.
 */
const GRASS_FIELD_SPREAD = TERRAIN_WORLD_HALF_EXTENT;
const MAX_TOTAL_BLADES = 10_000_000;

/** Legacy tab-only flag — migrated to {@link WORLD_CONTENT_SPAWNED_STORAGE_KEY} on read. */
const WORLD_CONTENT_SPAWNED_SESSION_LEGACY_KEY = "gwWorldSpawned";

/**
 * Set once playable content defaults have been merged into the autosave (on "Spawn world",
 * or by the one-time boot heal for spawned worlds saved before per-key defaults existed).
 * While set, a count of 0 in the autosave is a deliberate choice and is never refilled.
 */
const SPAWN_DEFAULTS_MERGED_STORAGE_KEY = "gwSpawnDefaultsMergedV1";

/**
 * @returns {Record<string, unknown> | null}
 */
function loadWorldModeState() {
  try {
    const raw = localStorage.getItem(WORLD_MODE_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? /** @type {Record<string, unknown>} */ (o) : null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown>} partial
 */
function saveWorldModeState(partial) {
  const prev = loadWorldModeState() ?? {};
  const merged = { ...prev, ...partial };
  try {
    localStorage.setItem(WORLD_MODE_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    /* quota */
  }
  return merged;
}

/**
 * @param {HTMLCanvasElement | null} canvas
 * @param {number} spread half-extent of field
 * @param {number} px world X
 * @param {number} pz world Z
 * @param {number} yaw body yaw (radians)
 */
/** @type {HTMLCanvasElement | null} */
let worldMinimapCanvasEl = null;

function resizeWorldMinimapCanvas() {
  if (!worldMinimapCanvasEl) return;
  const r = worldMinimapCanvasEl.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return;
  const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
  const w = Math.floor(r.width * dpr);
  const h = Math.floor(r.height * dpr);
  if (worldMinimapCanvasEl.width !== w || worldMinimapCanvasEl.height !== h) {
    worldMinimapCanvasEl.width = w;
    worldMinimapCanvasEl.height = h;
  }
}

function drawWorldMinimap(canvas, spread, px, pz, yaw) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const pad = 10;
  ctx.fillStyle = "rgba(12, 32, 22, 0.95)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(140, 210, 150, 0.5)";
  ctx.lineWidth = 2;
  ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
  ctx.fillStyle = "rgba(40, 90, 55, 0.4)";
  ctx.fillRect(pad + 1, pad + 1, w - pad * 2 - 2, h - pad * 2 - 2);

  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const u = THREE.MathUtils.clamp(px / spread, -1, 1);
  const v = THREE.MathUtils.clamp(pz / spread, -1, 1);
  const cx = pad + (u * 0.5 + 0.5) * innerW;
  const cy = pad + (-v * 0.5 + 0.5) * innerH;

  ctx.fillStyle = "#e85533";
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fill();

  const dirLen = Math.min(innerW, innerH) * 0.14;
  ctx.strokeStyle = "rgba(255, 230, 160, 0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - Math.sin(yaw) * dirLen, cy - Math.cos(yaw) * dirLen);
  ctx.stroke();
}

/**
 * Gap between width-wise blade strips in UV space (multi-slice / fan blades).
 * Kept at 0 so strips meet edge-to-edge — non-zero values carve transparent slits that read as a grid.
 */
function sliceGapForCount() {
  return 0;
}

/** @type {string} */
let lastGrassSignature = "";
/** @type {string} */
let lastFlowerSignature = "";
/** @type {string} */
let lastTreeSignature = "";
let lastRockSignature = "";
let lastBeeHiveSignature = "";
/** @type {string} */
let lastButterflySig = "";
/** @type {string} */
let lastLadybugSig = "";
/** @type {string} */
let lastBumblebeeSig = "";
/** @type {string} */
let lastFireflySig = "";
/** @type {string} */
let lastAntSig = "";
/** @type {string} */
let lastWormSig = "";
/** @type {string} */
let lastBirdSig = "";
/** @type {string} */
let lastFishSig = "";
/** @type {string} */
let lastFishFoodSig = "";
/** @type {import("./fish-ecosystem.js").FishEcosystemSettings} */
let lastFishEcosystem = normalizeFishEcosystem({});
/** @type {{ depthMinFrac: number, depthMaxFrac: number }} */
let lastFishDepthRange = { depthMinFrac: 0.12, depthMaxFrac: 0.88 };
/** @type {string} */
let lastSpiderSig = "";

/** Wind snapshot for per-frame tree leaf shaders (same as weather sliders). */
let lastWindSpeed = 1;
let lastWindDirRad = 0;
let lastRainIntensity = 0;
let lastSnowIntensity = 0;
let lastLightningIntensity = 0;
/** @type {number} */
let lastCloudCover = 0.35;

/** Accumulated soil wetness 0–1 (builds while raining, decays when dry). */
let groundWetness = 0;
const _sunDirGround = new THREE.Vector3();

/** @type {import("./butterfly-dynamics.js").ButterflyDynamics} */
let lastButterflyDynamics = DEFAULT_BUTTERFLY_DYNAMICS;

/** First Critters butterfly preset tint — drives live insect preview mesh color. */
let lastButterflyPreviewTint = "#ffaa44";

/** `??` does not replace NaN; guard all parsed slider values. */
function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isButterflyInsectPreviewVisible() {
  const panel = document.getElementById("settings-panel");
  const tabPanel = document.getElementById("panel-insects");
  return (
    panel?.classList.contains("open") === true && tabPanel?.classList.contains("is-active") === true
  );
}

/**
 * Randomly assign each of `total` instances to one of `numTypes` blade presets (uniform).
 * @param {number} total
 * @param {number} numTypes
 * @returns {number[]}
 */
function randomDistributeCounts(total, numTypes) {
  const n = Math.max(0, Math.floor(finiteOr(total, 0)));
  const k = Math.max(0, Math.floor(numTypes));
  const counts = new Array(k).fill(0);
  if (k < 1 || n < 1) return counts;
  for (let i = 0; i < n; i++) {
    counts[Math.floor(Math.random() * k)]++;
  }
  return counts;
}

/**
 * Split `total` instances across types using non-negative weights (largest remainder method).
 * Weights are normalized; if all zero, falls back to uniform random.
 * @param {number} total
 * @param {number[]} weights
 * @returns {number[]}
 */
function weightedDistributeCounts(total, weights) {
  const n = Math.max(0, Math.floor(finiteOr(total, 0)));
  const k = weights.length;
  const counts = new Array(k).fill(0);
  if (k < 1 || n < 1) return counts;
  const w = weights.map((x) => Math.max(0, finiteOr(x, 0)));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    return randomDistributeCounts(n, k);
  }
  const raw = w.map((wi) => (n * wi) / sum);
  const floors = raw.map((x) => Math.floor(x));
  let remainder = n - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, f: x - Math.floor(x) }))
    .sort((a, b) => b.f - a.f);
  const out = [...floors];
  for (let r = 0; r < remainder; r++) {
    out[order[r].i]++;
  }
  return out;
}

/**
 * @param {Array<{ width: number, thickness: number, height: number, edgeNoise: number, color: string }>} presets
 * @param {number} grassTotal
 * @param {number} cv
 */
function bladeSignature(presets, grassTotal, cv) {
  return (
    JSON.stringify(
      presets.map((p) => ({
        w: finiteOr(p.width, 0.08),
        t: finiteOr(p.thickness, 0.016),
        h: finiteOr(p.height, 1.2),
        e: finiteOr(p.edgeNoise, 0.35),
        col: typeof p.color === "string" ? p.color : "#3d6b38",
        slices: Math.max(1, Math.min(16, Math.floor(finiteOr(p.slices, 1)))),
        curve: Math.floor(finiteOr(p.curveType, 0)),
        curveStr: finiteOr(p.curveStrength, 0.35),
        cel: finiteOr(p.celShading, 0),
        er: finiteOr(p.erosion, 0.45),
        str: finiteOr(p.streak, 0.5),
        colorBandV: Math.max(1, Math.min(8, Math.floor(finiteOr(p.colorBandV, 2)))),
        colorBandH: Math.max(1, Math.min(8, Math.floor(finiteOr(p.colorBandH, 1)))),
        color2: typeof p.color2 === "string" ? p.color2 : "#4a8f4a",
        color3: typeof p.color3 === "string" ? p.color3 : "#c8e8a8",
        share: finiteOr(p.sharePercent, 100),
      }))
    ) +
    `|T${grassTotal}|V${cv.toFixed(4)}`
  );
}

function createGrassMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        dayPhase: { value: 1 },
        moonDir: {
          value: new THREE.Vector3(0.48, 0.72, -0.38).normalize(),
        },
        bladeHeight: { value: 1.35 },
        bladeThickness: { value: 0.016 },
        uSliceCount: { value: 1 },
        uCurveType: { value: 0 },
        uCurveStrength: { value: 0.35 },
        edgeNoise: { value: 0.35 },
        uCelShading: { value: 0 },
        windSpeed: { value: 1 },
        windDirAngle: { value: 0 },
        grassColorVariation: { value: 1 },
        bladeBaseColor: { value: new THREE.Color(0x3d8a42) },
        bladeColorB: { value: new THREE.Color(0x4a8f4a) },
        bladeColorC: { value: new THREE.Color(0xc8e8a8) },
        uBandV: { value: 2 },
        uBandH: { value: 1 },
        uSliceGap: { value: 0 },
        uErosion: { value: 0.45 },
        uStreak: { value: 0.5 },
        uTerrainHeightMap: { value: _zeroTerrainTex },
        uReferenceHeightMap: { value: _zeroTerrainTex },
        uWaterTableDepthM: { value: WATER_TABLE_DEPTH_M },
        uTerrainHalfExtent: { value: 200 },
        uTerrainSegments: { value: 256 },
        uSlopeMinNormalY: { value: 0.48 },
      },
    ]),
    vertexShader: `
    #include <common>
    #include <fog_pars_vertex>
    uniform float uTime;
    uniform float bladeHeight;
    uniform float bladeThickness;
    uniform float uSliceCount;
    uniform float uCurveType;
    uniform float uCurveStrength;
    uniform float edgeNoise;
    uniform float windSpeed;
    uniform float windDirAngle;
    uniform sampler2D uTerrainHeightMap;
    uniform sampler2D uReferenceHeightMap;
    uniform float uWaterTableDepthM;
    uniform float uTerrainHalfExtent;
    uniform float uTerrainSegments;
    uniform float uSlopeMinNormalY;
    varying vec2 vUv;
    varying vec3 vColor;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying float vTerrainOk;

    void main() {
      vUv = uv;
#ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
#else
      vColor = vec3(1.0);
#endif

      vec3 transformed = position;
      float h = clamp(transformed.y / bladeHeight, 0.0, 1.0);
      float pointy = pow(max(1.0 - h, 0.0), 0.58);
      transformed.x *= pointy;

      float sc = max(uSliceCount, 1.0);
      float ux = fract(uv.x * sc + 1e-5);
      transformed.z += (ux - 0.5) * 2.0 * bladeThickness * (0.35 + 0.65 * h);

      float si = floor(uv.x * sc + 1e-4);
      float sliceFan = sin((si + 0.5) / sc * 3.14159265);

      float cp = 0.0;
      if (uCurveType > 0.5) {
        if (uCurveType < 1.5) cp = pow(h, 1.65) * 0.85;
        else if (uCurveType < 2.5) cp = sin(h * 1.5707963);
        else if (uCurveType < 3.5) cp = 0.5 - 0.5 * cos(h * 3.14159265);
        else if (uCurveType < 4.5) cp = h * h * (3.0 - 2.0 * h);
        else cp = pow(h, 1.65) * 0.85;
      }
      transformed.z += cp * uCurveStrength * bladeHeight * 0.32 * (0.55 + 0.45 * sliceFan);

      vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      float t = uTime * windSpeed;

      float side = abs(ux - 0.5) * 2.0;
      float tipBias = smoothstep(0.22, 1.0, uv.y);
      float nEdge = sin(ux * 55.0 + uv.y * 72.0 + ip.x * 3.0 + ip.z * 2.7);
      float nEdgeZ = cos(uv.y * 88.0 + t * 1.15);
      float edgeW =
        edgeNoise * h * (0.22 + 0.78 * side) * (0.18 + 0.82 * tipBias);
      transformed.x += nEdge * 0.045 * edgeW;
      transformed.z += nEdgeZ * 0.026 * edgeW * max(side, 0.15);
      vec2 wxz = ip.xz;
      float c0 = cos(windDirAngle);
      float s0 = sin(windDirAngle);
      vec2 wxzR = vec2(wxz.x * c0 - wxz.y * s0, wxz.x * s0 + wxz.y * c0);

      float zoneA = sin(wxzR.x * 0.048 + t * 0.52) * cos(wxzR.y * 0.040 - t * 0.48);
      float zoneB = sin((wxzR.x + wxzR.y * 0.7) * 0.028 + t * 0.36);
      float gustStrength = clamp(zoneA * 0.52 + zoneB * 0.38 + 0.42, 0.0, 1.0);
      gustStrength = mix(0.06, 1.0, gustStrength * gustStrength);

      float ripple = 0.55 + 0.45 * sin(wxzR.x * 0.095 - t * 0.78) * cos(wxzR.y * 0.088 + t * 0.62);
      gustStrength *= mix(0.65, 1.0, ripple);

      float dir = wxzR.x * 0.022 - wxzR.y * 0.019 + t * 0.72;
      float c = cos(dir);
      float s = sin(dir);
      float w1 = sin(t * 2.2 + ip.x * 0.08 + ip.z * 0.06);
      float w2 = cos(t * 1.7 + ip.z * 0.09 - ip.x * 0.04);
      vec2 bend = vec2(w1 * 0.26 + w2 * 0.09, w2 * 0.20 + w1 * 0.07);
      bend = mat2(c, -s, s, c) * bend;

      float hh = h * h;
      transformed.x += bend.x * hh * gustStrength;
      transformed.z += bend.y * hh * gustStrength;
      transformed.y += sin(t * 3.0 + ip.x * 0.1 + zoneB) * 0.03 * h * gustStrength;

      vec4 worldPos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
      vec3 baseWorld = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vec2 tuv =
        vec2(baseWorld.x + uTerrainHalfExtent, -baseWorld.z + uTerrainHalfExtent) /
        (uTerrainHalfExtent * 2.0);
      float du = 1.0 / max(uTerrainSegments, 1.0);
      vec2 tuvC = clamp(tuv, vec2(du), vec2(1.0 - du));
      float h0 = texture2D(uTerrainHeightMap, tuvC).r;
      worldPos.y += h0;
      float cell = (uTerrainHalfExtent * 2.0) / max(uTerrainSegments, 1.0);
      float hL = texture2D(uTerrainHeightMap, tuvC + vec2(-du, 0.0)).r;
      float hR = texture2D(uTerrainHeightMap, tuvC + vec2(du, 0.0)).r;
      float hNz = texture2D(uTerrainHeightMap, tuvC + vec2(0.0, -du)).r;
      float hPz = texture2D(uTerrainHeightMap, tuvC + vec2(0.0, du)).r;
      float dhdx = (hR - hL) / (2.0 * cell);
      float dhdz = (hNz - hPz) / (2.0 * cell);
      vec3 nterrain = normalize(vec3(-dhdx, 1.0, -dhdz));
      vTerrainOk = step(uSlopeMinNormalY, nterrain.y);

      vWorldPos = worldPos.xyz;
      mat3 im = mat3(instanceMatrix);
      vWorldNormal = normalize(im * vec3(0.0, 0.0, 1.0));

      vec4 mvPosition = viewMatrix * worldPos;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `,
    fragmentShader: `
    #include <common>
    #include <fog_pars_fragment>
    uniform float dayPhase;
    uniform vec3 moonDir;
    uniform float grassColorVariation;
    uniform float edgeNoise;
    uniform float uCelShading;
    uniform vec3 bladeBaseColor;
    uniform vec3 bladeColorB;
    uniform vec3 bladeColorC;
    uniform float uBandV;
    uniform float uBandH;
    uniform float uSliceCount;
    uniform float uSliceGap;
    uniform float uErosion;
    uniform float uStreak;
    uniform sampler2D uTerrainHeightMap;
    uniform sampler2D uReferenceHeightMap;
    uniform float uWaterTableDepthM;
    uniform float uTerrainHalfExtent;
    uniform float uTerrainSegments;
    varying vec2 vUv;
    varying vec3 vColor;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying float vTerrainOk;

    float gHash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float gNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x),
        mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    float gFbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * gNoise(p);
        p *= 2.03;
        a *= 0.5;
      }
      return v;
    }

    vec3 knotAt(float ki, float seg, vec3 c0, vec3 c1, vec3 c2) {
      if (seg <= 1.0) {
        return c0;
      }
      float t = ki / max(seg - 1.0, 1.0);
      if (t < 0.0001) {
        return c0;
      }
      if (t > 0.999) {
        return c2;
      }
      if (t <= 0.5) {
        return mix(c0, c1, t * 2.0);
      }
      return mix(c1, c2, (t - 0.5) * 2.0);
    }

    vec3 smoothBandRamp(float ty, float segF, vec3 c0, vec3 c1, vec3 c2) {
      float seg = clamp(floor(segF + 0.5), 1.0, 8.0);
      if (seg <= 1.0) {
        return c0;
      }
      float u = clamp(ty, 0.0, 1.0) * (seg - 1.0);
      float fl = floor(u);
      float fr = fract(u);
      fr = smoothstep(0.0, 1.0, fr);
      float i0 = fl;
      float i1 = min(fl + 1.0, seg - 1.0);
      return mix(
        knotAt(i0, seg, c0, c1, c2),
        knotAt(i1, seg, c0, c1, c2),
        fr
      );
    }

    void main() {
      if (vTerrainOk < 0.5) {
        discard;
      }
      float hspan = uTerrainHalfExtent * 2.0;
      vec2 tuvW =
        vec2(vWorldPos.x + uTerrainHalfExtent, -vWorldPos.z + uTerrainHalfExtent) / hspan;
      float duw = 1.0 / max(uTerrainSegments, 1.0);
      vec2 tuvCw = clamp(tuvW, vec2(duw), vec2(1.0 - duw));
      float terrainBaseY = texture2D(uTerrainHeightMap, tuvCw).r;
      float refH = texture2D(uReferenceHeightMap, tuvCw).r;
      float waterSurfY = refH - uWaterTableDepthM;
      if (terrainBaseY < waterSurfY - 0.03) {
        discard;
      }
      float sc = max(uSliceCount, 1.0);
      float ux = fract(vUv.x * sc + 1e-5);
      if (sc > 1.0) {
        float u = clamp(vUv.x, 0.0, 1.0 - 1e-6) * sc;
        float k = floor(u);
        float f = fract(u);
        float gw = clamp(uSliceGap, 0.0, 0.2);
        if (gw > 0.001 && ((k > 0.0 && f < gw * 0.5) || (k < sc - 1.0 && f > 1.0 - gw * 0.5))) {
          discard;
        }
      }

      if (uErosion > 0.004) {
        vec2 wob = vWorldPos.xz * 0.068;
        float e1 = gFbm(vUv * vec2(15.0, 21.0) + wob);
        float e2 = gFbm(vUv * vec2(44.0, 58.0) + wob * 1.28 + vec2(13.0, 2.0));
        float rim = abs(ux - 0.5) * 2.0;
        float edgeW = pow(clamp(rim, 0.0, 1.0), 0.48);
        float tipOpen = smoothstep(0.12, 0.9, vUv.y);
        float holeAmt =
          uErosion * (0.06 + 0.4 * edgeW + 0.12 * (1.0 - tipOpen));
        if (e1 < holeAmt) {
          discard;
        }
        float speck = uErosion * (0.035 + 0.2 * edgeW);
        if (e2 < speck * (0.38 + 0.62 * e1)) {
          discard;
        }
      }

      vec3 c0 = bladeBaseColor;
      vec3 c1 = bladeColorB;
      vec3 c2 = bladeColorC;
      vec3 vTint = smoothBandRamp(vUv.y, uBandV, c0, c1, c2);
      vec3 hTint = smoothBandRamp(ux, uBandH, c0, c1, c2);
      vec3 tint = sqrt(max(vTint * hTint, vec3(0.0008)));
      vec3 vc = vColor * tint;
      vec3 col = vc;
      col = mix(col, col * vec3(1.08, 1.06, 1.02), smoothstep(0.88, 1.0, vUv.y) * 0.35);

      float bladeRim = abs(ux - 0.5) * 2.0;
      float tipN = smoothstep(0.28, 1.0, vUv.y);
      float fn = sin(ux * 76.0 + vUv.y * 98.0 + vWorldPos.x * 0.04) * 0.5 + 0.5;
      float edgeMix =
        edgeNoise * (0.2 + 0.8 * bladeRim) * (0.12 + 0.88 * tipN);
      col *= mix(vec3(1.0), vec3(0.94 + 0.08 * fn, 0.96 + 0.05 * fn, 0.9 + 0.06 * fn), edgeMix * 0.42);

      if (uStreak > 0.004) {
        float bandSoft = clamp((uBandV + uBandH - 2.0) / 8.0, 0.0, 1.0);
        float streakAmt = uStreak * mix(1.0, 0.42, bandSoft);
        float st1 = sin(vUv.y * 51.0 + ux * 12.0 + vWorldPos.x * 0.85);
        float st2 = sin(vUv.y * 28.0 - ux * 8.0 + vWorldPos.z * 0.78);
        float st3 = sin(vUv.y * 67.0 + vWorldPos.x * 0.31 + vWorldPos.z * 0.27);
        float st4 = gFbm(vec2(ux * 5.5, vUv.y * 38.0) + vWorldPos.xz * 0.042);
        float streakVar = 0.52 + 0.48 * st1 * st2 * 0.5 + 0.26 * st3 + 0.22 * st4;
        streakVar = clamp(streakVar, 0.18, 1.0);
        float darken = mix(1.0, streakVar, streakAmt);
        col *= darken;
      }

      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, grassColorVariation);

      float shade = mix(0.22, 1.0, dayPhase);
      vec3 moonTint = vec3(0.52, 0.58, 0.72);
      col *= shade * mix(moonTint, vec3(1.0), dayPhase);

      float nightAmt = 1.0 - dayPhase;
      vec3 md = normalize(moonDir);
      vec3 N = vWorldNormal;
      if (!gl_FrontFacing) N = -N;
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      float ndl = max(dot(N, md), 0.0);
      float spec = pow(ndl, 18.0);
      float viewRim = pow(clamp(1.0 - abs(dot(N, viewDir)), 0.0, 1.0), 2.4);
      float tipLift = smoothstep(0.22, 1.0, vUv.y);
      vec3 moonSheen = vec3(0.75, 0.82, 1.0);
      col += moonSheen * (spec * 0.62 + viewRim * 0.28 * ndl) * nightAmt * tipLift;

      vec3 colOut = col;
      if (uCelShading > 0.001) {
        float bands = mix(32.0, 4.0, uCelShading);
        colOut = floor(col * bands + 0.5) / bands;
      }

      gl_FragColor = vec4(colOut, 1.0);
      #include <fog_fragment>
    }
  `,
    fog: true,
    side: THREE.DoubleSide,
  });
}

/**
 * Per-instance color is a multiplier near white; blade type tint comes from `bladeBaseColor` uniform.
 * @param {THREE.InstancedMesh} mesh
 * @param {number} count
 * @param {number} spread
 * @param {number} colorVariation
 */
/**
 * @param {import("./terrain-paint.js").TerrainHeightField | null} [terrain]
 * @param {import("./terrain-paint.js").DryLandSpawnPoints | null} [dryLand]
 */
function fillGrassInstances(mesh, count, spread, colorVariation, terrain = null, dryLand = null) {
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  const rng = (a, b) => a + Math.random() * (b - a);
  const rng01 = () => Math.random();
  const cv = THREE.MathUtils.clamp(colorVariation, 0, 1);

  for (let i = 0; i < count; i++) {
    const land = sampleLandXZForSpawn(terrain, dryLand, rng01, spread);
    const x = land.x;
    const z = land.z;
    const rot = Math.random() * Math.PI * 2;
    const s = rng(0.75, 1.35);
    // Y stays at 0 — the grass vertex shader lifts each blade to the live terrain
    // height (worldPos.y += h0). Baking land.groundY here too would double-count the
    // offset, burying blades under raised terrain / below the water surface.
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    if (cv < 0.02) {
      tmpColor.setRGB(1, 1, 1);
    } else {
      const amp = 0.14 * cv;
      tmpColor.setRGB(
        THREE.MathUtils.clamp(rng(1 - amp, 1 + amp), 0, 1),
        THREE.MathUtils.clamp(rng(1 - amp, 1 + amp), 0, 1),
        THREE.MathUtils.clamp(rng(1 - amp, 1 + amp), 0, 1)
      );
    }
    mesh.setColorAt(i, tmpColor);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/**
 * @param {Array<{ width: number, thickness: number, height: number, edgeNoise: number, color: string }>} presets
 * @param {number[]} counts
 * @param {number} colorVariation
 * @param {object} wind
 */
/**
 * @param {import("./terrain-paint.js").TerrainHeightField | null} [terrain]
 * @param {import("./terrain-paint.js").DryLandSpawnPoints | null} [dryLand]
 */
function rebuildAllGrass(presets, counts, colorVariation, wind, terrain = null, dryLand = null) {
  if (grassGroup) {
    scene.remove(grassGroup);
    grassGroup.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) {
        o.geometry.dispose();
      }
    });
    grassMatsByType.forEach((m) => m?.dispose());
    grassMatsByType = [];
    grassGroup = null;
  }

  grassGroup = new THREE.Group();
  grassGroup.name = "Grass";
  grassMatsByType = new Array(presets.length).fill(null);

  for (let i = 0; i < presets.length; i++) {
    const n = counts[i] ?? 0;
    if (n < 1) continue;

    const p = presets[i];
    const w = THREE.MathUtils.clamp(finiteOr(p.width, 0.08), 0.02, 0.4);
    const h = THREE.MathUtils.clamp(finiteOr(p.height, 1.2), 0.35, 3);
    const t = THREE.MathUtils.clamp(finiteOr(p.thickness, 0.016), 0.002, 0.08);
    const slices = Math.max(1, Math.min(16, Math.floor(finiteOr(p.slices, 1))));

    const geo = new THREE.PlaneGeometry(w, h, slices, 8);
    geo.translate(0, h / 2, 0);

    const mat = createGrassMaterial();
    mat.uniforms.bladeHeight.value = h;
    mat.uniforms.bladeThickness.value = t;
    mat.uniforms.uSliceCount.value = slices;
    mat.uniforms.uSliceGap.value = sliceGapForCount(slices);
    mat.uniforms.uCurveType.value = finiteOr(p.curveType, 0);
    mat.uniforms.uCurveStrength.value = THREE.MathUtils.clamp(
      finiteOr(p.curveStrength, 0.35),
      0,
      1
    );
    mat.uniforms.uCelShading.value = THREE.MathUtils.clamp(finiteOr(p.celShading, 0), 0, 1);
    mat.uniforms.uErosion.value = THREE.MathUtils.clamp(finiteOr(p.erosion, 0.45), 0, 1);
    mat.uniforms.uStreak.value = THREE.MathUtils.clamp(finiteOr(p.streak, 0.5), 0, 1);
    mat.uniforms.edgeNoise.value = THREE.MathUtils.clamp(finiteOr(p.edgeNoise, 0.35), 0, 1);
    mat.uniforms.windSpeed.value = wind.speed;
    mat.uniforms.windDirAngle.value = wind.dirRad;
    mat.uniforms.grassColorVariation.value = colorVariation;
    mat.uniforms.bladeBaseColor.value.set(
      typeof p.color === "string" ? p.color : "#3d6b38"
    );
    mat.uniforms.bladeColorB.value.set(
      typeof p.color2 === "string" ? p.color2 : "#4a8f4a"
    );
    mat.uniforms.bladeColorC.value.set(
      typeof p.color3 === "string" ? p.color3 : "#c8e8a8"
    );
    mat.uniforms.uBandV.value = Math.max(
      1,
      Math.min(8, Math.floor(finiteOr(p.colorBandV, 2)))
    );
    mat.uniforms.uBandH.value = Math.max(
      1,
      Math.min(8, Math.floor(finiteOr(p.colorBandH, 1)))
    );

    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false;
    fillGrassInstances(mesh, n, GRASS_FIELD_SPREAD, colorVariation, terrain, dryLand);
    grassGroup.add(mesh);
    grassMatsByType[i] = mat;
  }

  if (grassGroup.children.length > 0) {
    scene.add(grassGroup);
  } else {
    grassGroup = null;
  }
}

function applyStarAmount(a) {
  if (!sky) return;
  const u = sky.mesh.material.uniforms;
  u.uStarExponent.value = THREE.MathUtils.lerp(1360, 1010, a);
  u.uStarMult.value = THREE.MathUtils.lerp(0.65, 2.1, a);
  u.uStarCull.value = THREE.MathUtils.lerp(0.84, 0.5, a);
}

let _envAutosaveTimer = 0;
function scheduleEnvironmentAutosave() {
  if (_envAutosaveTimer) clearTimeout(_envAutosaveTimer);
  _envAutosaveTimer = window.setTimeout(() => {
    _envAutosaveTimer = 0;
    try {
      saveEnvironmentSettingsAutosave(readSettingsFromDOM());
    } catch (e) {
      console.warn("[settings] autosave failed", e);
    }
  }, 450);
}

function applySettings(raw) {
  const s = normalizeEnvironmentSettings(raw);
  latestWaterShader = s.waterShader;
  let bladePresets = Array.isArray(s.bladePresets) ? s.bladePresets : [];
  if (bladePresets.length < 1) {
    bladePresets = [
      {
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
      },
    ];
  }

  let flowerPresets = Array.isArray(s.flowerPresets) ? s.flowerPresets : [];
  if (flowerPresets.length < 1) {
    flowerPresets = [
      {
        petalCount: 8,
        petalLength: 0.35,
        stemWidth: 0.022,
        stemHeight: 1.1,
        clusterDensity: 0.45,
        sharePercent: 100,
        petalGradientBlend: 0.55,
        petalEdgeNoise: 0.35,
        petalWarp: 0.28,
        petalRipple: 0.22,
        petalTipSharpness: 0.25,
        petalTipRoundness: 0.4,
        petalBloom: 0.55,
        centerDiscRadius: 0.147,
        centerDiscThickness: 0.012,
        centerDiscBulge: 0.4,
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
        toleratesWater: false,
        petalShapeCustom: false,
      },
    ];
  }

  const worldSpawned = worldContentSpawned === true;

  const dryLand =
    terrainHeightField && worldSpawned ? getDryLandSpawnPoints(terrainHeightField) : null;

  const rawTotal = Math.floor(finiteOr(s.grassCount, 0));
  const safeTotal = Number.isFinite(rawTotal)
    ? THREE.MathUtils.clamp(rawTotal, 0, MAX_TOTAL_BLADES)
    : 0;
  const effectiveGrassTotal = worldSpawned ? safeTotal : 0;
  const weights = bladePresets.map((p) => finiteOr(p.sharePercent, 100));
  const counts = weightedDistributeCounts(effectiveGrassTotal, weights);
  const cv = THREE.MathUtils.clamp(finiteOr(s.colorVariation, 1), 0, 1);

  const rawFlowerTotal = Math.floor(finiteOr(s.flowerCount, 0));
  const safeFlowerTotal = Number.isFinite(rawFlowerTotal)
    ? THREE.MathUtils.clamp(rawFlowerTotal, 0, 100000)
    : 0;
  const effectiveFlowerTotal = worldSpawned ? safeFlowerTotal : 0;
  const flowerWeights = flowerPresets.map((p) => finiteOr(p.sharePercent, 100));
  const flowerCounts = weightedDistributeCounts(effectiveFlowerTotal, flowerWeights);
  const fCv = THREE.MathUtils.clamp(finiteOr(s.flowerColorVariation, 1), 0, 1);
  const groundColor = typeof s.groundColor === "string" ? s.groundColor : "#5c4a3a";
  const groundWarm = THREE.MathUtils.clamp(finiteOr(s.groundWarm, 1), 0, 2.5);
  const groundCool = THREE.MathUtils.clamp(finiteOr(s.groundCool, 1), 0, 2.5);
  const groundMapMix = THREE.MathUtils.clamp(finiteOr(s.groundMapMix, 0.35), 0, 1);

  const windSpeed = THREE.MathUtils.clamp(finiteOr(s.windSpeed, 1), 0, 4);
  const windDirRad = THREE.MathUtils.degToRad(finiteOr(s.windDirection, 0));
  lastWindSpeed = windSpeed;
  lastWindDirRad = windDirRad;
  lastRainIntensity = THREE.MathUtils.clamp(finiteOr(s.rainIntensity, 0), 0, 1);
  lastSnowIntensity = THREE.MathUtils.clamp(finiteOr(s.snowIntensity, 0), 0, 1);
  lastLightningIntensity = THREE.MathUtils.clamp(finiteOr(s.lightningIntensity, 0), 0, 1);
  lastCloudCover = THREE.MathUtils.clamp(finiteOr(s.cloudCover, 0.35), 0, 1);
  lastButterflyDynamics = s.butterflyDynamics;
  const audioVolume = THREE.MathUtils.clamp(finiteOr(s.audioVolume, 1), 0, 1);
  lastAudioVolume = audioVolume;
  lastAudioMuted = s.audioMuted === true;

  const treeCount = s.treeCount;
  const effectiveTreeCount = worldSpawned ? treeCount : 0;
  const treePreset = s.treePreset;
  const treeScale = s.treeScale;
  const treeFieldSeed = s.treeFieldSeed;
  const treeShape = normalizeTreeShapeFields(s);
  const rockCount = Math.floor(finiteOr(s.rockCount, 280));
  const boulderCount = Math.floor(finiteOr(s.boulderCount, 12));
  const rockSeed = Math.floor(finiteOr(s.rockSeed, 28401));
  const effectiveRockCount = worldSpawned ? rockCount : 0;
  const effectiveBoulderCount = worldSpawned ? boulderCount : 0;

  const sig = bladeSignature(bladePresets, effectiveGrassTotal, cv);
  const needRebuild = !grassGroup || sig !== lastGrassSignature;

  if (needRebuild) {
    rebuildAllGrass(
      bladePresets,
      counts,
      cv,
      {
        speed: windSpeed,
        dirRad: windDirRad,
      },
      terrainHeightField,
      dryLand
    );
    lastGrassSignature = sig;
  }

  const fSig = flowerSignature(flowerPresets, effectiveFlowerTotal, fCv);
  const needFlowerRebuild = fSig !== lastFlowerSignature;
  if (needFlowerRebuild && flowerField) {
    flowerField.rebuild(
      flowerPresets,
      flowerCounts,
      fCv,
      {
        speed: windSpeed,
        dirRad: windDirRad,
      },
      terrainHeightField,
      dryLand
    );
    lastFlowerSignature = fSig;
  }

  const tSig = treeForestSignature({
    treeCount: effectiveTreeCount,
    treePreset,
    treeScale,
    treeFieldSeed,
    ...treeShape,
  });
  const needTreeRebuild = tSig !== lastTreeSignature;
  if (needTreeRebuild && treeForest) {
    treeForest.rebuild({
      count: effectiveTreeCount,
      presetName: treePreset,
      scale: treeScale,
      fieldSeed: treeFieldSeed,
      shape: treeShape,
      terrain: terrainHeightField,
      dryLand,
    });
    lastTreeSignature = tSig;
  }

  const rSig = rockFieldSignature({
    rockCount: effectiveRockCount,
    boulderCount: effectiveBoulderCount,
    rockSeed,
  });
  if (rSig !== lastRockSignature && rockField) {
    rockField.rebuild({
      rockCount: effectiveRockCount,
      boulderCount: effectiveBoulderCount,
      seed: rockSeed,
      terrain: terrainHeightField,
      dryLand,
    });
    lastRockSignature = rSig;
  }

  const effectiveHive = worldSpawned ? Math.floor(finiteOr(s.beeHiveCount, 0)) : 0;
  const hiveSeed = Math.floor(finiteOr(s.beeHiveSeed, 19283));
  const hiveSig = beeHiveSignature({ beeHiveCount: effectiveHive, beeHiveSeed: hiveSeed });
  if (hiveSig !== lastBeeHiveSignature && beeHiveField) {
    beeHiveField.rebuild({
      hiveCount: effectiveHive,
      seed: hiveSeed,
      terrain: terrainHeightField,
      dryLand,
    });
    lastBeeHiveSignature = hiveSig;
  }

  const spSig = spiderSignature(
    { ...s, spiderWebCount: worldSpawned ? s.spiderWebCount : 0 },
    tSig
  );
  if (spSig !== lastSpiderSig && spiderField) {
    const ok = spiderField.rebuild({
      count: worldSpawned ? s.spiderWebCount : 0,
      seed: s.spiderSeed,
      treePlacements: treeForest?.getTreePlacements() ?? [],
    });
    if (ok) lastSpiderSig = spSig;
  }

  const butterflyPresets = Array.isArray(s.butterflyPresets) ? s.butterflyPresets : [];
  {
    const bp0 = butterflyPresets[0];
    lastButterflyPreviewTint =
      typeof bp0?.color === "string" && bp0.color.length > 0 ? bp0.color : "#ffaa44";
  }
  const safeBf = Math.floor(finiteOr(s.butterflyCount, 0));
  const effectiveBf = worldSpawned ? safeBf : 0;
  const bfWeights = butterflyPresets.map((p) => finiteOr(p.sharePercent, 100));
  const bfCounts = splitCounts(effectiveBf, bfWeights);
  const bSig = butterflySignature({
    ...s,
    butterflyCount: effectiveBf,
  });
  if (bSig !== lastButterflySig && butterflySwarm) {
    void butterflySwarm
      .rebuild({
        total: effectiveBf,
        presets: butterflyPresets,
        seed: s.butterflySeed,
        dynamics: s.butterflyDynamics,
        terrain: terrainHeightField,
        dryLand,
      })
      .then((ok) => {
        if (ok) lastButterflySig = bSig;
      });
  }

  const ladybugPresets = Array.isArray(s.ladybugPresets) ? s.ladybugPresets : [];
  const safeLb = Math.floor(finiteOr(s.ladybugCount, 120));
  const effectiveLb = worldSpawned ? safeLb : 0;
  const lbWeights = ladybugPresets.map((p) => finiteOr(p.sharePercent, 100));
  const lbCounts = splitCounts(effectiveLb, lbWeights);
  const lSig = ladybugSignature(
    {
      ...s,
      ladybugCount: effectiveLb,
    },
    tSig
  );
  if (lSig !== lastLadybugSig && ladybugSwarm) {
    void ladybugSwarm
      .rebuild({
        total: effectiveLb,
        presets: ladybugPresets,
        seed: s.ladybugSeed,
        treeShare: finiteOr(s.ladybugTreeShare, 0.45),
        treePlacements: treeForest?.getTreePlacements() ?? [],
        terrain: terrainHeightField,
        dryLand,
      })
      .then((ok) => {
        if (ok) lastLadybugSig = lSig;
      });
  }

  const bumblebeePresets = Array.isArray(s.bumblebeePresets) ? s.bumblebeePresets : [];
  const safeBb = Math.floor(finiteOr(s.bumblebeeCount, 28));
  const effectiveBb = worldSpawned ? safeBb : 0;
  const bbWeights = bumblebeePresets.map((p) => finiteOr(p.sharePercent, 100));
  const bbCounts = splitCounts(effectiveBb, bbWeights);
  const bbSig = bumblebeeSignature(
    {
      ...s,
      bumblebeeCount: effectiveBb,
      beeHiveCount: effectiveHive,
      beeHiveSeed: hiveSeed,
    },
    fSig
  );
  if (bbSig !== lastBumblebeeSig && bumblebeeSwarm) {
    void bumblebeeSwarm
      .rebuild({
        total: effectiveBb,
        presets: bumblebeePresets,
        seed: s.bumblebeeSeed,
        terrain: terrainHeightField,
        hivePositions: beeHiveField?.getHivePositions() ?? [],
        dryLand,
      })
      .then((ok) => {
        if (ok) lastBumblebeeSig = bbSig;
      });
  }

  const fireflyPresets = Array.isArray(s.fireflyPresets) ? s.fireflyPresets : [];
  const safeFf = Math.floor(finiteOr(s.fireflyCount, 80));
  const effectiveFf = worldSpawned ? safeFf : 0;
  const ffWeights = fireflyPresets.map((p) => finiteOr(p.sharePercent, 100));
  const ffCounts = splitCounts(effectiveFf, ffWeights);
  const ffSig = fireflySignature({
    ...s,
    fireflyCount: effectiveFf,
  });
  if (ffSig !== lastFireflySig && fireflySwarm) {
    const ok = fireflySwarm.rebuild({
      total: effectiveFf,
      presets: fireflyPresets,
      seed: s.fireflySeed,
      terrain: terrainHeightField,
      dryLand,
    });
    if (ok) lastFireflySig = ffSig;
  }

  const antPresets = Array.isArray(s.antPresets) ? s.antPresets : [];
  const safeAnt = Math.floor(finiteOr(s.antCount, 400));
  const effectiveAnt = worldSpawned ? safeAnt : 0;
  const antWeights = antPresets.map((p) => finiteOr(p.sharePercent, 100));
  const antCounts = splitCounts(effectiveAnt, antWeights);
  const aSig = antSignature({
    ...s,
    antCount: effectiveAnt,
  });
  if (aSig !== lastAntSig && antSwarm) {
    const ok = antSwarm.rebuild({
      total: effectiveAnt,
      presets: antPresets,
      seed: s.antSeed,
      terrain: terrainHeightField,
      dryLand,
    });
    if (ok) lastAntSig = aSig;
  }

  const wormPresets = Array.isArray(s.wormPresets) ? s.wormPresets : [];
  const safeWorm = Math.floor(finiteOr(s.wormCount, 200));
  const effectiveWorm = worldSpawned ? safeWorm : 0;
  const wormWeights = wormPresets.map((p) => finiteOr(p.sharePercent, 100));
  const wormCounts = splitCounts(effectiveWorm, wormWeights);
  const wSig = wormSignature({
    ...s,
    wormCount: effectiveWorm,
  });
  if (wSig !== lastWormSig && wormSwarm) {
    const ok = wormSwarm.rebuild({
      total: effectiveWorm,
      presets: wormPresets,
      seed: s.wormSeed,
      terrain: terrainHeightField,
      dryLand,
    });
    if (ok) lastWormSig = wSig;
  }

  const birdPresets = normalizeBirdPresets(s.birdPresets);
  const safeBird = Math.floor(finiteOr(s.birdCount, 0));
  const effectiveBird = worldSpawned ? safeBird : 0;
  const birdWeights = birdPresets.map((p) => finiteOr(p.sharePercent, 100));
  const birdCounts = splitCounts(effectiveBird, birdWeights);
  const brSig = birdSignature({
    ...s,
    birdCount: effectiveBird,
    birdPresets,
  });
  if (brSig !== lastBirdSig && birdFlockLand && birdFlockWater) {
    const okL = birdFlockLand.rebuild({
      total: birdCounts[0] ?? 0,
      seed: (finiteOr(s.birdSeed, 8843) ^ 0x11111111) >>> 0,
      terrain: terrainHeightField,
      habitat: "land",
      color: birdPresets[0]?.color ?? "#4a5568",
      dryLand,
    });
    const okW = birdFlockWater.rebuild({
      total: birdCounts[1] ?? 0,
      seed: (finiteOr(s.birdSeed, 8843) ^ 0x22222222) >>> 0,
      terrain: terrainHeightField,
      habitat: "water",
      color: birdPresets[1]?.color ?? "#7a9abf",
    });
    if (okL && okW) lastBirdSig = brSig;
  }

  const fishPresets = Array.isArray(s.fishPresets) ? s.fishPresets : [];
  const safeFish = Math.floor(finiteOr(s.fishCount, 0));
  const effectiveFish = worldSpawned ? safeFish : 0;
  const fishWeights = fishPresets.map((p) => finiteOr(p.sharePercent, 100));
  const fishCounts = splitCounts(effectiveFish, fishWeights);
  const fishTerrainFp = terrainHeightField?.getQuickFingerprint() ?? "";
  const fishSig = fishSignature(
    {
      ...s,
      fishCount: effectiveFish,
    },
    fishTerrainFp
  );
  if (fishSig !== lastFishSig && fishSwarm) {
    const ok = fishSwarm.rebuild({
      total: effectiveFish,
      presets: fishPresets,
      seed: s.fishSeed,
      dynamics: s.fishDynamics,
      terrain: terrainHeightField,
    });
    if (ok) lastFishSig = fishSig;
  }

  const fishFoodSig = fishFoodSignature(s, fishTerrainFp);
  if (fishFoodSig !== lastFishFoodSig && fishFoodField) {
    const fe = s.fishEcosystem;
    const fd = s.fishDynamics;
    const ok = fishFoodField.rebuild({
      count: worldSpawned ? fe.pelletCount : 0,
      seed: fe.pelletSeed,
      terrain: terrainHeightField,
      ecosystem: fe,
      depthRange: { depthMinFrac: fd.depthMinFrac, depthMaxFrac: fd.depthMaxFrac },
    });
    if (ok) lastFishFoodSig = fishFoodSig;
  }

  for (let i = 0; i < bladePresets.length; i++) {
    const m = grassMatsByType[i];
    if (!m) continue;
    m.uniforms.windSpeed.value = windSpeed;
    m.uniforms.windDirAngle.value = windDirRad;
    m.uniforms.grassColorVariation.value = cv;
    m.uniforms.edgeNoise.value = THREE.MathUtils.clamp(
      finiteOr(bladePresets[i].edgeNoise, 0.35),
      0,
      1
    );
    m.uniforms.bladeHeight.value = THREE.MathUtils.clamp(
      finiteOr(bladePresets[i].height, 1.2),
      0.35,
      3
    );
    m.uniforms.bladeThickness.value = THREE.MathUtils.clamp(
      finiteOr(bladePresets[i].thickness, 0.016),
      0.002,
      0.08
    );
    const sl = Math.max(1, Math.min(16, Math.floor(finiteOr(bladePresets[i].slices, 1))));
    m.uniforms.uSliceCount.value = sl;
    m.uniforms.uSliceGap.value = sliceGapForCount(sl);
    m.uniforms.uCurveType.value = finiteOr(bladePresets[i].curveType, 0);
    m.uniforms.uCurveStrength.value = THREE.MathUtils.clamp(
      finiteOr(bladePresets[i].curveStrength, 0.35),
      0,
      1
    );
    m.uniforms.uCelShading.value = THREE.MathUtils.clamp(
      finiteOr(bladePresets[i].celShading, 0),
      0,
      1
    );
    m.uniforms.uErosion.value = THREE.MathUtils.clamp(
      finiteOr(bladePresets[i].erosion, 0.45),
      0,
      1
    );
    m.uniforms.uStreak.value = THREE.MathUtils.clamp(
      finiteOr(bladePresets[i].streak, 0.5),
      0,
      1
    );
    const col = bladePresets[i].color;
    m.uniforms.bladeBaseColor.value.set(
      typeof col === "string" ? col : "#3d6b38"
    );
    m.uniforms.bladeColorB.value.set(
      typeof bladePresets[i].color2 === "string"
        ? bladePresets[i].color2
        : "#4a8f4a"
    );
    m.uniforms.bladeColorC.value.set(
      typeof bladePresets[i].color3 === "string"
        ? bladePresets[i].color3
        : "#c8e8a8"
    );
    m.uniforms.uBandV.value = Math.max(
      1,
      Math.min(8, Math.floor(finiteOr(bladePresets[i].colorBandV, 2)))
    );
    m.uniforms.uBandH.value = Math.max(
      1,
      Math.min(8, Math.floor(finiteOr(bladePresets[i].colorBandH, 1)))
    );
  }

  for (let i = 0; i < flowerPresets.length; i++) {
    const m = flowerField?.matsByType[i];
    if (!m) continue;
    const fp = flowerPresets[i];
    setFlowerMaterialUniformsFromPreset(m, fp, { speed: windSpeed, dirRad: windDirRad }, fCv);
  }

  if (groundPlaneRef) {
    const u = groundPlaneRef.material.uniforms;
    u.uGroundBaseColor.value.set(groundColor);
    u.uOrganic.value = groundWarm;
    u.uMineral.value = groundCool;
    u.uMapMix.value = groundPlaneRef.hasMap ? groundMapMix : 0;
  }

  if (sky) {
    const u = sky.mesh.material.uniforms;
    u.uNebulaBlue.value = THREE.MathUtils.clamp(finiteOr(s.nebulaBlue, 1), 0, 2.5);
    u.uNebulaPurple.value = THREE.MathUtils.clamp(
      finiteOr(s.nebulaPurple, 1),
      0,
      2.5
    );
    applyStarAmount(THREE.MathUtils.clamp(finiteOr(s.starAmount, 0), 0, 1));
    sky.setSkyTuning(s.skyDetail);
    updateSkyTuningLabelSpans(s.skyDetail);
  }

  const setLabel = (id, text) => {
    const n = document.getElementById(id);
    if (n) n.textContent = text;
  };

  setLabel("val-grass-count", safeTotal.toLocaleString());
  setLabel("val-blade-types-count", String(bladePresets.length));

  const hintEl = document.getElementById("blade-distribution-hint");
  if (hintEl) {
    if (bladePresets.length <= 1) {
      hintEl.textContent = "All instances use your single blade definition.";
    } else {
      hintEl.textContent = `Total blades split by each type’s field share (weights ${weights.join(" · ")}).`;
    }
  }

  const totalInst = counts.reduce((a, b) => a + b, 0);
  const distStr = counts
    .map((c) => {
      const pct = totalInst > 0 ? (c / totalInst) * 100 : 0;
      const pStr = totalInst > 0 ? ` (${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%)` : "";
      return `${c.toLocaleString()}${pStr}`;
    })
    .join(" · ");
  setLabel("val-blade-distribution", distStr || "—");

  document.querySelectorAll("#blade-presets-list [data-blade-preset-row]").forEach((row, i) => {
    if (!(row instanceof HTMLElement)) return;
    const span = row.querySelector('[data-blade-val="count"]');
    if (span) span.textContent = (counts[i] ?? 0).toLocaleString();
  });

  setLabel("val-color-var", cv.toFixed(2));
  setLabel(
    "val-star",
    THREE.MathUtils.clamp(finiteOr(s.starAmount, 0.45), 0, 1).toFixed(2)
  );
  setLabel("val-ground-warm", groundWarm.toFixed(2));
  setLabel("val-ground-cool", groundCool.toFixed(2));
  setLabel("val-ground-map-mix", groundMapMix.toFixed(2));
  setLabel(
    "val-terrain-amp",
    THREE.MathUtils.clamp(finiteOr(s.terrainAmplitude, 0), 0, 60).toFixed(1)
  );
  setLabel(
    "val-terrain-freq",
    THREE.MathUtils.clamp(finiteOr(s.terrainFrequency, 0.016), 0.0015, 0.14).toFixed(4)
  );
  setLabel(
    "val-terrain-oct",
    String(
      Math.round(
        THREE.MathUtils.clamp(finiteOr(s.terrainOctaves, 5), 1, 8)
      )
    )
  );
  setLabel(
    "val-terrain-pers",
    THREE.MathUtils.clamp(finiteOr(s.terrainPersistence, 0.52), 0.2, 0.95).toFixed(2)
  );
  setLabel(
    "val-terrain-lac",
    THREE.MathUtils.clamp(finiteOr(s.terrainLacunarity, 2.05), 1.5, 3).toFixed(2)
  );
  setLabel(
    "val-terrain-ridge",
    THREE.MathUtils.clamp(finiteOr(s.terrainRidge, 0.35), 0, 1).toFixed(2)
  );
  setLabel("val-terrain-seed", String(Math.round(finiteOr(s.terrainSeed, 0))));
  const ws = s.waterShader;
  for (const key of Object.keys(DEFAULT_WATER_SHADER)) {
    const v = ws[/** @type {keyof typeof ws} */ (key)];
    if (typeof v === "number") {
      setLabel(waterShaderValId(key), formatWaterShaderValueLabel(key, v));
    }
  }
  setLabel("val-neb-b", finiteOr(s.nebulaBlue, 1).toFixed(2));
  setLabel("val-neb-p", finiteOr(s.nebulaPurple, 1).toFixed(2));
  {
    const rRain = THREE.MathUtils.clamp(finiteOr(s.rainIntensity, 0), 0, 1);
    let rainWord = "Clear";
    if (rRain > 0) {
      if (rRain <= 0.25) rainWord = "Drizzle";
      else if (rRain <= 0.5) rainWord = "Rain";
      else if (rRain <= 0.75) rainWord = "Heavy";
      else if (rRain <= 0.9) rainWord = "Downpour";
      else rainWord = "Deluge";
    }
    setLabel("val-weather-rain", `${rRain.toFixed(2)} — ${rainWord}`);
  }
  setLabel("val-weather-snow", THREE.MathUtils.clamp(finiteOr(s.snowIntensity, 0), 0, 1).toFixed(2));
  setLabel(
    "val-weather-lightning",
    THREE.MathUtils.clamp(finiteOr(s.lightningIntensity, 0), 0, 1).toFixed(2)
  );
  setLabel("val-weather-clouds", THREE.MathUtils.clamp(finiteOr(s.cloudCover, 0.35), 0, 1).toFixed(2));
  setLabel("val-wind-spd", windSpeed.toFixed(2));
  setLabel("val-wind-dir", String(Math.round(finiteOr(s.windDirection, 0))));
  setLabel("val-audio-volume", audioVolume.toFixed(2));

  const bd = s.butterflyDynamics;
  setLabel("val-bf-height-min", bd.heightMin.toFixed(2));
  setLabel("val-bf-height-max", bd.heightMax.toFixed(2));
  setLabel("val-bf-field-spread-mul", bd.fieldSpreadMul.toFixed(2));
  setLabel("val-bf-scale-min", bd.scaleMin.toFixed(2));
  setLabel("val-bf-scale-range", bd.scaleRange.toFixed(2));
  setLabel("val-bf-wander-freq-x", bd.wanderFreqX.toFixed(2));
  setLabel("val-bf-wander-freq-z", bd.wanderFreqZ.toFixed(2));
  setLabel("val-bf-wander-amp-x", bd.wanderAmpX.toFixed(2));
  setLabel("val-bf-wander-amp-z", bd.wanderAmpZ.toFixed(2));
  setLabel("val-bf-bob-freq", bd.bobFreq.toFixed(2));
  setLabel("val-bf-bob-amp", bd.bobAmp.toFixed(2));
  setLabel("val-bf-flap-freq", bd.flapFreq.toFixed(2));
  setLabel("val-bf-flap-rot-amp", bd.flapRotAmp.toFixed(2));
  setLabel("val-bf-flap-pitch-mul", bd.flapPitchMul.toFixed(2));
  setLabel("val-bf-flap-roll-mul", bd.flapRollMul.toFixed(2));
  setLabel("val-bf-yaw-spin", bd.yawSpin.toFixed(2));
  setLabel("val-bf-drift-base", bd.driftBase.toFixed(2));
  setLabel("val-bf-drift-wind-mul", bd.driftWindMul.toFixed(2));
  setLabel("val-bf-wind-response", bd.windResponse.toFixed(2));
  setLabel("val-bf-wind-push-scale", bd.windPushScale.toFixed(3));
  setLabel("val-bf-body-len-mul", bd.bodyLengthMul.toFixed(2));
  setLabel("val-bf-body-width-mul", bd.bodyWidthMul.toFixed(2));
  setLabel("val-bf-body-thick-mul", bd.bodyThicknessMul.toFixed(2));
  setLabel("val-bf-shape-noise-amp", bd.shapeNoiseAmp.toFixed(3));
  setLabel("val-bf-shape-noise-f1", bd.shapeNoiseFreq.toFixed(2));
  setLabel("val-bf-shape-noise-f2", bd.shapeNoiseFreq2.toFixed(2));
  setLabel("val-bf-wing-pairs", String(bd.wingPairs));
  setLabel("val-bf-leg-count", String(bd.legCount));
  setLabel("val-bf-eye-x", bd.eyeOffsetX.toFixed(3));
  setLabel("val-bf-eye-y", bd.eyeOffsetY.toFixed(3));
  setLabel("val-bf-eye-z", bd.eyeOffsetZ.toFixed(3));
  setLabel("val-bf-eye-size", bd.eyeSize.toFixed(3));
  setLabel("val-bf-insect-emissive", bd.insectEmissive.toFixed(2));
  setLabel("val-bf-wing-stroke-freq", bd.wingStrokeFreq.toFixed(2));
  setLabel("val-bf-wing-stroke-amp", bd.wingStrokeAmp.toFixed(2));
  setLabel("val-bf-leg-swing-freq", bd.legSwingFreq.toFixed(2));
  setLabel("val-bf-leg-swing-amp", bd.legSwingAmp.toFixed(2));
  setLabel("val-bf-path-body-tilt", bd.pathBodyTilt.toFixed(2));

  setLabel("val-flower-count", safeFlowerTotal.toLocaleString());
  setLabel("val-flower-types-count", String(flowerPresets.length));
  const flowerHint = document.getElementById("flower-distribution-hint");
  if (flowerHint) {
    if (flowerPresets.length <= 1) {
      flowerHint.textContent = "All flowers use your single type definition.";
    } else {
      flowerHint.textContent = `Total flowers split by each type’s field share (weights ${flowerWeights.join(" · ")}).`;
    }
  }
  const flowerDistStr = flowerCounts
    .map((c) => {
      const pct = safeFlowerTotal > 0 ? (c / safeFlowerTotal) * 100 : 0;
      const pStr = safeFlowerTotal > 0 ? ` (${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%)` : "";
      return `${c.toLocaleString()}${pStr}`;
    })
    .join(" · ");
  setLabel("val-flower-distribution", flowerDistStr || "—");
  document.querySelectorAll("#flower-presets-list [data-flower-preset-row]").forEach((row, i) => {
    if (!(row instanceof HTMLElement)) return;
    const span = row.querySelector('[data-flower-val="count"]');
    if (span) span.textContent = (flowerCounts[i] ?? 0).toLocaleString();
  });
  setLabel("val-flower-color-var", fCv.toFixed(2));

  setLabel("val-butterfly-count", safeBf.toLocaleString());
  setLabel("val-butterfly-seed", String(Math.round(finiteOr(s.butterflySeed, 7103))));
  setLabel("val-butterfly-types-count", String(butterflyPresets.length));
  const bfHint = document.getElementById("butterfly-distribution-hint");
  if (bfHint) {
    if (butterflyPresets.length <= 1) {
      bfHint.textContent = "All butterflies use your single type definition.";
    } else {
      bfHint.textContent = `Total split by each type’s field share (weights ${bfWeights.join(" · ")}).`;
    }
  }
  const bfDistStr = bfCounts
    .map((c) => {
      const pct = safeBf > 0 ? (c / safeBf) * 100 : 0;
      const pStr = safeBf > 0 ? ` (${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%)` : "";
      return `${c.toLocaleString()}${pStr}`;
    })
    .join(" · ");
  setLabel("val-butterfly-distribution", bfDistStr || "—");
  document.querySelectorAll("#butterfly-presets-list [data-butterfly-preset-row]").forEach((row, i) => {
    if (!(row instanceof HTMLElement)) return;
    const span = row.querySelector('[data-critter-val="count"]');
    if (span) span.textContent = (bfCounts[i] ?? 0).toLocaleString();
  });

  setLabel("val-ladybug-count", safeLb.toLocaleString());
  setLabel(
    "val-ladybug-tree-share",
    THREE.MathUtils.clamp(finiteOr(s.ladybugTreeShare, 0.45), 0, 1).toFixed(2)
  );
  setLabel("val-ladybug-seed", String(Math.round(finiteOr(s.ladybugSeed, 9023))));
  setLabel("val-ladybug-types-count", String(ladybugPresets.length));
  const lbHint = document.getElementById("ladybug-distribution-hint");
  if (lbHint) {
    if (ladybugPresets.length <= 1) {
      lbHint.textContent = "All ladybugs use your single type definition.";
    } else {
      lbHint.textContent = `Total split by each type’s field share (weights ${lbWeights.join(" · ")}).`;
    }
  }
  const lbDistStr = lbCounts
    .map((c) => {
      const pct = safeLb > 0 ? (c / safeLb) * 100 : 0;
      const pStr = safeLb > 0 ? ` (${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%)` : "";
      return `${c.toLocaleString()}${pStr}`;
    })
    .join(" · ");
  setLabel("val-ladybug-distribution", lbDistStr || "—");
  document.querySelectorAll("#ladybug-presets-list [data-ladybug-preset-row]").forEach((row, i) => {
    if (!(row instanceof HTMLElement)) return;
    const span = row.querySelector('[data-critter-val="count"]');
    if (span) span.textContent = (lbCounts[i] ?? 0).toLocaleString();
  });

  setLabel("val-bumblebee-count", safeBb.toLocaleString());
  setLabel("val-bumblebee-seed", String(Math.round(finiteOr(s.bumblebeeSeed, 7142))));
  setLabel("val-bumblebee-types-count", String(bumblebeePresets.length));
  const bbHint = document.getElementById("bumblebee-distribution-hint");
  if (bbHint) {
    if (bumblebeePresets.length <= 1) {
      bbHint.textContent = "All bumblebees use your single type definition.";
    } else {
      bbHint.textContent = `Total split by each type’s field share (weights ${bbWeights.join(" · ")}).`;
    }
  }
  const bbDistStr = bbCounts
    .map((c) => {
      const pct = safeBb > 0 ? (c / safeBb) * 100 : 0;
      const pStr = safeBb > 0 ? ` (${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%)` : "";
      return `${c.toLocaleString()}${pStr}`;
    })
    .join(" · ");
  setLabel("val-bumblebee-distribution", bbDistStr || "—");
  document.querySelectorAll("#bumblebee-presets-list [data-bumblebee-preset-row]").forEach((row, i) => {
    if (!(row instanceof HTMLElement)) return;
    const span = row.querySelector('[data-critter-val="count"]');
    if (span) span.textContent = (bbCounts[i] ?? 0).toLocaleString();
  });

  setLabel("val-bee-hive-count", String(Math.floor(finiteOr(s.beeHiveCount, 0))));
  setLabel("val-bee-hive-seed", String(Math.round(finiteOr(s.beeHiveSeed, 19283))));

  setLabel("val-spider-web-count", Math.floor(finiteOr(s.spiderWebCount, 12)).toLocaleString());
  setLabel("val-spider-seed", String(Math.round(finiteOr(s.spiderSeed, 4411))));

  setLabel("val-firefly-count", safeFf.toLocaleString());
  setLabel("val-firefly-seed", String(Math.round(finiteOr(s.fireflySeed, 3341))));
  setLabel("val-firefly-types-count", String(fireflyPresets.length));
  const ffHint = document.getElementById("firefly-distribution-hint");
  if (ffHint) {
    if (fireflyPresets.length <= 1) {
      ffHint.textContent = "All fireflies use your single type definition.";
    } else {
      ffHint.textContent = `Total split by each type’s field share (weights ${ffWeights.join(" · ")}).`;
    }
  }
  const ffDistStr = ffCounts
    .map((c) => {
      const pct = safeFf > 0 ? (c / safeFf) * 100 : 0;
      const pStr = safeFf > 0 ? ` (${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%)` : "";
      return `${c.toLocaleString()}${pStr}`;
    })
    .join(" · ");
  setLabel("val-firefly-distribution", ffDistStr || "—");
  document.querySelectorAll("#firefly-presets-list [data-firefly-preset-row]").forEach((row, i) => {
    if (!(row instanceof HTMLElement)) return;
    const span = row.querySelector('[data-critter-val="count"]');
    if (span) span.textContent = (ffCounts[i] ?? 0).toLocaleString();
  });

  setLabel("val-ant-count", safeAnt.toLocaleString());
  setLabel("val-ant-seed", String(Math.round(finiteOr(s.antSeed, 5581))));
  setLabel("val-ant-types-count", String(antPresets.length));
  const antHint = document.getElementById("ant-distribution-hint");
  if (antHint) {
    if (antPresets.length <= 1) {
      antHint.textContent = "All ants use your single type definition.";
    } else {
      antHint.textContent = `Total split by each type’s field share (weights ${antWeights.join(" · ")}).`;
    }
  }
  const antDistStr = antCounts
    .map((c) => {
      const pct = safeAnt > 0 ? (c / safeAnt) * 100 : 0;
      const pStr = safeAnt > 0 ? ` (${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%)` : "";
      return `${c.toLocaleString()}${pStr}`;
    })
    .join(" · ");
  setLabel("val-ant-distribution", antDistStr || "—");
  document.querySelectorAll("#ant-presets-list [data-ant-preset-row]").forEach((row, i) => {
    if (!(row instanceof HTMLElement)) return;
    const span = row.querySelector('[data-critter-val="count"]');
    if (span) span.textContent = (antCounts[i] ?? 0).toLocaleString();
  });

  setLabel("val-worm-count", safeWorm.toLocaleString());
  setLabel("val-worm-seed", String(Math.round(finiteOr(s.wormSeed, 7721))));
  setLabel("val-worm-types-count", String(wormPresets.length));
  const wormHint = document.getElementById("worm-distribution-hint");
  if (wormHint) {
    if (wormPresets.length <= 1) {
      wormHint.textContent = "All worms use your single type definition.";
    } else {
      wormHint.textContent = `Total split by each type's field share (weights ${wormWeights.join(" · ")}).`;
    }
  }
  const wormDistStr = wormCounts
    .map((c) => {
      const pct = safeWorm > 0 ? (c / safeWorm) * 100 : 0;
      const pStr = safeWorm > 0 ? ` (${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%)` : "";
      return `${c.toLocaleString()}${pStr}`;
    })
    .join(" · ");
  setLabel("val-worm-distribution", wormDistStr || "—");
  document.querySelectorAll("#worm-presets-list [data-worm-preset-row]").forEach((row, i) => {
    if (!(row instanceof HTMLElement)) return;
    const span = row.querySelector('[data-critter-val="count"]');
    if (span) span.textContent = (wormCounts[i] ?? 0).toLocaleString();
  });

  setLabel("val-bird-count", safeBird.toLocaleString());
  setLabel("val-bird-seed", String(Math.round(finiteOr(s.birdSeed, 8843))));
  setLabel("val-bird-types-count", "2");
  const birdHint = document.getElementById("bird-distribution-hint");
  if (birdHint) {
    birdHint.textContent = `Total split by each type’s field share (weights ${birdWeights.join(" · ")}).`;
  }
  const birdDistStr = birdCounts
    .map((c) => {
      const pct = safeBird > 0 ? (c / safeBird) * 100 : 0;
      const pStr = safeBird > 0 ? ` (${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%)` : "";
      return `${c.toLocaleString()}${pStr}`;
    })
    .join(" · ");
  setLabel("val-bird-distribution", birdDistStr || "—");
  document.querySelectorAll("#bird-presets-list [data-bird-preset-row]").forEach((row, i) => {
    if (!(row instanceof HTMLElement)) return;
    const span = row.querySelector('[data-critter-val="count"]');
    if (span) span.textContent = (birdCounts[i] ?? 0).toLocaleString();
  });

  setLabel("val-fish-count", safeFish.toLocaleString());
  setLabel("val-fish-seed", String(Math.round(finiteOr(s.fishSeed, 3311))));
  setLabel("val-fish-types-count", String(fishPresets.length));
  const fishHint = document.getElementById("fish-distribution-hint");
  if (fishHint) {
    if (fishPresets.length <= 1) {
      fishHint.textContent = "All fish use your single type definition (underwater only).";
    } else {
      fishHint.textContent = `Total split by each type’s field share (weights ${fishWeights.join(" · ")}).`;
    }
  }
  const fishDistStr = fishCounts
    .map((c) => {
      const pct = safeFish > 0 ? (c / safeFish) * 100 : 0;
      const pStr = safeFish > 0 ? ` (${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%)` : "";
      return `${c.toLocaleString()}${pStr}`;
    })
    .join(" · ");
  setLabel("val-fish-distribution", fishDistStr || "—");
  document.querySelectorAll("#fish-presets-list [data-fish-preset-row]").forEach((row, i) => {
    if (!(row instanceof HTMLElement)) return;
    const span = row.querySelector('[data-critter-val="count"]');
    if (span) span.textContent = (fishCounts[i] ?? 0).toLocaleString();
  });
  {
    const fd = s.fishDynamics;
    setLabel("val-fish-body-length-mul", fd.bodyLengthMul.toFixed(2));
    setLabel("val-fish-body-depth-mul", fd.bodyDepthMul.toFixed(2));
    setLabel("val-fish-tail-length-mul", fd.tailLengthMul.toFixed(2));
    setLabel("val-fish-tail-width-mul", fd.tailWidthMul.toFixed(2));
    setLabel("val-fish-fin-scale", fd.finScale.toFixed(2));
    setLabel("val-fish-dorsal-scale", fd.dorsalScale.toFixed(2));
    setLabel("val-fish-shape-noise-amp", fd.shapeNoiseAmp.toFixed(3));
    setLabel("val-fish-shape-noise-freq", fd.shapeNoiseFreq.toFixed(2));
    setLabel("val-fish-swim-freq", fd.swimFreq.toFixed(2));
    setLabel("val-fish-swim-amp", fd.swimAmp.toFixed(2));
    setLabel("val-fish-yaw-wander", fd.yawWander.toFixed(2));
    setLabel("val-fish-depth-min", fd.depthMinFrac.toFixed(2));
    setLabel("val-fish-depth-max", fd.depthMaxFrac.toFixed(2));
    setLabel("val-fish-emissive", fd.emissive.toFixed(2));
  }
  {
    const fe = s.fishEcosystem;
    setLabel("val-fish-eco-pellet-count", String(fe.pelletCount));
    setLabel("val-fish-eco-pellet-seed", String(fe.pelletSeed));
    setLabel("val-fish-eco-regen", fe.pelletRegenPerSec.toFixed(2));
    setLabel("val-fish-eco-hunger", fe.hungerPerSec.toFixed(3));
    setLabel("val-fish-eco-feed-pellet", fe.feedPellet.toFixed(2));
    setLabel("val-fish-eco-feed-ladybug", fe.feedLadybug.toFixed(2));
    setLabel("val-fish-eco-feed-spider", fe.feedSpider.toFixed(2));
    setLabel("val-fish-eco-eat-r", fe.eatRadius.toFixed(2));
    setLabel("val-fish-eco-hunt", fe.huntSteer.toFixed(2));
  }

  const fishHudEl = document.getElementById("hud-fish-eco");
  if (fishHudEl) {
    const fe = s.fishEcosystem;
    fishHudEl.hidden = !(worldSpawned && (safeFish > 0 || fe.pelletCount > 0));
  }

  setLabel("val-tree-count", String(treeCount));
  setLabel("val-tree-scale", treeScale.toFixed(3));
  setLabel("val-tree-field-seed", String(treeFieldSeed));
  setLabel("val-rock-count", String(rockCount));
  setLabel("val-boulder-count", String(boulderCount));
  setLabel("val-rock-seed", String(rockSeed));
  setLabel("val-tree-trunk-radius", treeShape.treeTrunkRadius.toFixed(2));
  setLabel("val-tree-trunk-length", treeShape.treeTrunkLength.toFixed(1));
  setLabel("val-tree-branch-levels", String(treeShape.treeBranchLevels));
  setLabel("val-tree-children-trunk", String(treeShape.treeChildrenTrunk));
  setLabel("val-tree-children-branch", String(treeShape.treeChildrenBranch));
  setLabel("val-tree-children-sub", String(treeShape.treeChildrenSub));
  setLabel("val-tree-crown-mul", treeShape.treeCrownLengthMul.toFixed(2));
  setLabel("val-tree-leaf-count", String(treeShape.treeLeafCount));
  setLabel("val-tree-leaf-size", treeShape.treeLeafSize.toFixed(2));
  setLabel("val-tree-leaf-variance", treeShape.treeLeafSizeVariance.toFixed(2));

  lastFishEcosystem = s.fishEcosystem;
  lastFishDepthRange = {
    depthMinFrac: s.fishDynamics.depthMinFrac,
    depthMaxFrac: s.fishDynamics.depthMaxFrac,
  };

  if (terrainHeightField) {
    terrainHeightField.bindGrassMaterials(grassMatsByType);
    if (flowerField?.matsByType?.length) {
      terrainHeightField.bindFlowerMaterials(flowerField.matsByType);
    }
  }

  scheduleEnvironmentAutosave();
}

/** @type {GroundPlane | null} */
let groundPlaneRef = null;
/** @type {import("./snow-accumulation.js").SnowAccumulationField | null} */
let snowAccumField = null;

/** @type {FlowerField | null} */
let flowerField = null;

/** @type {TreeForest | null} */
let treeForest = null;

/** @type {RockField | null} */
let rockField = null;

/** @type {TreeChopSystem | null} */
let treeChop = null;

/** @type {TerrainHeightField | null} */
let terrainHeightField = null;

const _zeroTerrainTex = new THREE.DataTexture(
  new Float32Array([0]),
  1,
  1,
  THREE.RedFormat,
  THREE.FloatType
);
_zeroTerrainTex.needsUpdate = true;

/**
 * Terrain paintbrush (free flight): soft / sharp raise-lower, level to surroundings.
 * @type {{
 *   active: boolean;
 *   tool: "soft" | "sharp" | "level";
 *   raise: boolean;
 *   brushRadius: number;
 *   strength: number;
 *   dragging: boolean;
 * }}
 */
const terrainPaint = {
  active: false,
  tool: "soft",
  raise: true,
  brushRadius: 22,
  strength: 1.25,
  dragging: false,
};

/** Snapshots before each paint stroke (for undo). */
const terrainUndoStack = [];
const MAX_TERRAIN_UNDO = 64;

function pushTerrainUndoSnapshot() {
  if (!terrainHeightField) return;
  terrainUndoStack.push(terrainHeightField.snapshotTerrainState());
  while (terrainUndoStack.length > MAX_TERRAIN_UNDO) terrainUndoStack.shift();
}

function performTerrainUndo() {
  if (!terrainHeightField || terrainPaint.dragging) return;
  if (terrainUndoStack.length < 1) return;
  const prev = terrainUndoStack.pop();
  if (!prev) return;
  if (prev instanceof Float32Array) {
    terrainHeightField.restoreHeights(prev);
  } else {
    terrainHeightField.restoreTerrainState(prev);
  }
  treeForest?.syncTreeGroundHeight(terrainHeightField);
  rockField?.syncGroundHeight(terrainHeightField);
  beeHiveField?.syncGroundHeight(terrainHeightField);
  saveTerrainToLocalStorage(terrainHeightField);
  updateWorldSpawnCopy();
  updateBeeHud();
}

function updateTerrainPersistenceUi() {
  const undoBtn = document.getElementById("terrain-undo-btn");
  if (undoBtn) {
    undoBtn.disabled = terrainUndoStack.length < 1 || !terrainHeightField;
  }
}

const groundRaycaster = new THREE.Raycaster();
groundRaycaster.far = 80000;

/** @type {ButterflySwarm | null} */
let butterflySwarm = null;
/** @type {LadybugSwarm | null} */
let ladybugSwarm = null;
/** @type {BumblebeeSwarm | null} */
let bumblebeeSwarm = null;
/** @type {import("./fireflies-ants.js").FireflySwarm | null} */
let fireflySwarm = null;
/** @type {import("./fireflies-ants.js").AntSwarm | null} */
let antSwarm = null;
/** @type {import("./worms.js").WormSwarm | null} */
let wormSwarm = null;
/** @type {FishSwarm | null} */
let fishSwarm = null;
/** @type {BirdFlock | null} */
let birdFlockLand = null;
/** @type {BirdFlock | null} */
let birdFlockWater = null;
/** @type {import("./whale.js").LakeWhale | null} */
let lakeWhale = null;

const _RANDOM_LF_Z = new THREE.Vector3(0, 0, 1);
const _RANDOM_LF_X = new THREE.Vector3(1, 0, 0);
const randomCreatureView = new RandomCreatureViewController();

/**
 * @returns {object[]}
 */
function buildRandomCreatureDescriptors() {
  /** @type {object[]} */
  const out = [];
  /**
   * @param {THREE.Group | null | undefined} group
   * @param {string} label
   * @param {THREE.Vector3} localForward
   */
  const addInst = (group, label, localForward) => {
    if (!group) return;
    group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh && o.count > 0) {
        out.push({
          kind: "inst",
          mesh: o,
          count: o.count,
          label,
          localForward: localForward.clone(),
        });
      }
    });
  };
  addInst(butterflySwarm?.group, "butterfly", _RANDOM_LF_Z);
  addInst(ladybugSwarm?.group, "ladybug", _RANDOM_LF_Z);
  addInst(bumblebeeSwarm?.group, "bumblebee", _RANDOM_LF_Z);
  addInst(fireflySwarm?.group, "firefly", _RANDOM_LF_Z);
  addInst(antSwarm?.group, "ant", _RANDOM_LF_Z);
  addInst(wormSwarm?.group, "worm", _RANDOM_LF_Z);
  addInst(birdFlockLand?.group, "bird land", _RANDOM_LF_Z);
  addInst(birdFlockWater?.group, "bird water", _RANDOM_LF_Z);
  addInst(fishSwarm?.group, "fish", _RANDOM_LF_X);
  if (lakeWhale?.group) {
    out.push({
      kind: "whale",
      group: lakeWhale.group,
      label: "whale",
      localForward: _RANDOM_LF_X.clone(),
    });
  }
  return out;
}

randomCreatureView.setDescriptorProvider(buildRandomCreatureDescriptors);

const _DOC_TMP = new THREE.Vector3();

/**
 * First populated InstancedMesh under a group, as a documentary subject.
 * @param {THREE.Group | null | undefined} group
 * @param {number} radius minimum subject radius (world units)
 */
function docInstSubject(group, radius) {
  if (!group) return null;
  /** @type {THREE.InstancedMesh | null} */
  let found = null;
  group.traverse((o) => {
    if (!found && o instanceof THREE.InstancedMesh && o.count > 0) found = o;
  });
  return found ? { kind: "inst", mesh: found, count: found.count, radius } : null;
}

/**
 * Random terrain point subject. wantWater → point on the water surface;
 * shore → dry point with exposed water nearby.
 * @param {number} radius
 * @param {boolean} [wantWater]
 * @param {boolean} [shore]
 */
function docTerrainPoint(radius, wantWater = false, shore = false) {
  const f = terrainHeightField;
  if (!f) return { kind: "point", x: 0, y: 0.5, z: 0, radius };
  const wetAt = (x, z) =>
    f.getWaterSurfaceHeightBilinear(x, z) > f.getHeightBilinear(x, z) + 0.01;
  for (let i = 0; i < 200; i++) {
    const x = (Math.random() * 2 - 1) * GRASS_FIELD_SPREAD * 0.8;
    const z = (Math.random() * 2 - 1) * GRASS_FIELD_SPREAD * 0.8;
    const wet = wetAt(x, z);
    if (shore) {
      if (wet) continue;
      if (wetAt(x + 3, z) || wetAt(x - 3, z) || wetAt(x, z + 3) || wetAt(x, z - 3)) {
        return { kind: "point", x, y: f.getHeightBilinear(x, z) + 0.05, z, radius };
      }
      continue;
    }
    if (wantWater !== wet) continue;
    const y = wantWater
      ? f.getWaterSurfaceHeightBilinear(x, z)
      : f.getHeightBilinear(x, z) + 0.05;
    return { kind: "point", x, y, z, radius };
  }
  return { kind: "point", x: 0, y: f.getHeightBilinear(0, 0) + 0.5, z: 0, radius };
}

/**
 * Random direct child of a group (tree, hive) as a point subject.
 * @param {THREE.Group | null | undefined} group
 * @param {number} radius
 */
function docGroupChildSubject(group, radius) {
  if (!group || group.children.length < 1) return null;
  const c = group.children[Math.floor(Math.random() * group.children.length)];
  c.updateMatrixWorld(true);
  _DOC_TMP.setFromMatrixPosition(c.matrixWorld);
  return {
    kind: "point",
    x: _DOC_TMP.x,
    y: _DOC_TMP.y + radius * 0.5,
    z: _DOC_TMP.z,
    radius,
  };
}

/**
 * Resolve a documentary shot subject name to a live camera target.
 * Sky-type subjects return null — the controller frames those itself.
 * @param {string} name
 */
function documentarySubject(name) {
  switch (name) {
    case "ant":
      return docInstSubject(antSwarm?.group, 0.05) ?? docTerrainPoint(0.1);
    case "firefly":
      return docInstSubject(fireflySwarm?.group, 0.06) ?? docTerrainPoint(0.1);
    case "butterfly":
      return docInstSubject(butterflySwarm?.group, 0.1) ?? docTerrainPoint(0.1);
    case "ladybug":
      return docInstSubject(ladybugSwarm?.group, 0.05) ?? docTerrainPoint(0.1);
    case "bee":
      return docInstSubject(bumblebeeSwarm?.group, 0.09) ?? docTerrainPoint(0.1);
    case "worm":
      return docInstSubject(wormSwarm?.group, 0.06) ?? docTerrainPoint(0.1);
    case "birds":
      return (
        docInstSubject(birdFlockLand?.group, 0.3) ??
        docInstSubject(birdFlockWater?.group, 0.3) ??
        docTerrainPoint(0.3)
      );
    case "fish":
      return docInstSubject(fishSwarm?.group, 0.15) ?? docTerrainPoint(0.5, true);
    case "whale":
      return lakeWhale?.group?.visible
        ? { kind: "group", group: lakeWhale.group, radius: 2.2 }
        : docTerrainPoint(1, terrainHeightField?.hasExposedWater() === true);
    case "soldier":
      return soldierPilot?.root?.visible
        ? { kind: "group", group: soldierPilot.root, radius: 0.03 }
        : docTerrainPoint(0.05);
    case "spider":
    case "web": {
      const zones = spiderField?.getZones() ?? [];
      if (zones.length > 0) {
        const z = zones[Math.floor(Math.random() * zones.length)];
        return { kind: "point", x: z.x, y: z.y, z: z.z, radius: Math.max(0.25, z.radius) };
      }
      return docGroupChildSubject(treeForest?.group, 1.2) ?? docTerrainPoint(0.4);
    }
    case "hive":
      return docGroupChildSubject(beeHiveField?.group, 0.35) ?? docTerrainPoint(0.3);
    case "tree":
    case "stump":
      return docGroupChildSubject(treeForest?.group, 1.4) ?? docTerrainPoint(1);
    case "flower":
      return docInstSubject(flowerField?.group, 0.25) ?? docTerrainPoint(0.25);
    case "rock":
      return docInstSubject(rockField?.group, 0.5) ?? docTerrainPoint(0.4);
    case "grass":
      return docTerrainPoint(0.6);
    case "water":
      return docTerrainPoint(1.2, terrainHeightField?.hasExposedWater() === true);
    case "underwater":
      return docTerrainPoint(0.8, terrainHeightField?.hasExposedWater() === true);
    case "shore":
      return docTerrainPoint(0.8, false, true);
    case "sky":
    case "sun":
    case "moon":
    case "stars":
    case "rain":
    case "snow":
    case "lightning":
      return null;
    default:
      return docTerrainPoint(GRASS_FIELD_SPREAD * 0.12);
  }
}

const documentary = new DocumentaryController({
  camera,
  getSubject: documentarySubject,
  getTerrain: () => terrainHeightField,
  getSpread: () => GRASS_FIELD_SPREAD,
  canControl: () => flyMode === FlyMode.FREE,
  onStart: () => {
    if (randomCreatureView.active) randomCreatureView.end();
    document.exitPointerLock?.();
    terrainPaint.active = false;
    terrainPaint.dragging = false;
    if (treeChop) treeChop.chopMode = false;
    updateBeeHud();
  },
  onStop: () => {
    euler.setFromQuaternion(camera.quaternion, euler.order);
    updateBeeHud();
  },
});

function toggleRandomCreatureView() {
  if (flyMode !== FlyMode.FREE || !worldContentSpawned) return;
  if (randomCreatureView.active) {
    randomCreatureView.end();
    updateBeeHud();
    return;
  }
  if (buildRandomCreatureDescriptors().length < 1) return;
  documentary.stop();
  document.exitPointerLock?.();
  terrainPaint.active = false;
  terrainPaint.dragging = false;
  if (treeChop) treeChop.chopMode = false;
  randomCreatureView.begin(clock.getElapsedTime());
  updateBeeHud();
}

/** @type {FishFoodField | null} */
let fishFoodField = null;
/** @type {import("./spiders.js").SpiderWebField | null} */
let spiderField = null;
/** @type {import("./bee-hives.js").BeeHiveField | null} */
let beeHiveField = null;

/** @type {THREE.GridHelper | null} */
let terrainPaintGrid = null;

/** Brush footprint ring drawn on the ground at the aim point while terrain painting. */
/** @type {THREE.Mesh | null} */
let terrainBrushRing = null;

/**
 * Until true, grass/trees/flowers/critters are not spawned — sculpt terrain first, then Spawn world.
 * Persisted in localStorage (same tab/session as terrain); legacy sessionStorage key is migrated on load.
 */
let worldContentSpawned = false;

/**
 * Show the "Choose your world" modal and resolve with the picked starting terrain.
 * Resolves "beach" if the modal markup is missing so boot never stalls.
 * @returns {Promise<"beach" | "land" | "water">}
 */
function pickStartingTerrainViaModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById("terrain-choice-modal");
    const beachBtn = document.getElementById("terrain-pick-beach");
    const landBtn = document.getElementById("terrain-pick-land");
    const waterBtn = document.getElementById("terrain-pick-water");
    if (!modal || !beachBtn || !landBtn || !waterBtn) {
      resolve("beach");
      return;
    }
    /** @param {"beach" | "land" | "water"} choice */
    const done = (choice) => {
      modal.hidden = true;
      beachBtn.removeEventListener("click", onBeach);
      landBtn.removeEventListener("click", onLand);
      waterBtn.removeEventListener("click", onWater);
      resolve(choice);
    };
    const onBeach = () => done("beach");
    const onLand = () => done("land");
    const onWater = () => done("water");
    beachBtn.addEventListener("click", onBeach);
    landBtn.addEventListener("click", onLand);
    waterBtn.addEventListener("click", onWater);
    modal.hidden = false;
  });
}

/**
 * Match the pre-spawn overlay card copy to the current terrain: open water, a coastline,
 * or all dry land. Keeps the intro accurate whether the world started as beach / land /
 * water, was restored from a save, or has since been sculpted.
 */
function updateWorldSpawnCopy() {
  const titleEl = document.querySelector(".world-spawn-title");
  const textEl = document.querySelector(".world-spawn-text");
  if (!titleEl && !textEl) return;
  const hasDry = terrainHeightField ? terrainHeightField.hasDryLand() : true;
  const hasWater = terrainHeightField ? terrainHeightField.hasExposedWater() : false;
  let title;
  let text;
  if (!hasDry) {
    title = "Raise land from the sea";
    text =
      "You start in open water. Use terrain paint to build islands or coast, then spawn grass, trees, flowers, and critters on dry ground (counts stay at zero until you turn them up and spawn).";
  } else if (hasWater) {
    title = "Your coastline is ready";
    text =
      "Dry land meets the sea. Tune your grass, tree, flower, and critter counts, then Spawn world to populate the land — or keep sculpting the coast first (counts stay at zero until you turn them up).";
  } else {
    title = "Your land is ready";
    text =
      "You start on open dry ground. Tune your grass, tree, flower, and critter counts, then Spawn world — or sculpt hills and dig water first (counts stay at zero until you turn them up).";
  }
  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = text;
}

function finalizeTerrainPaintStroke() {
  terrainHeightField?.finalizeStroke();
  treeForest?.syncTreeGroundHeight(terrainHeightField);
  rockField?.syncGroundHeight(terrainHeightField);
  beeHiveField?.syncGroundHeight(terrainHeightField);
  if (terrainHeightField) {
    saveTerrainToLocalStorage(terrainHeightField);
  }
  updateWorldSpawnCopy();
}

function spawnWorldContent() {
  worldContentSpawned = true;
  try {
    localStorage.setItem(WORLD_CONTENT_SPAWNED_STORAGE_KEY, "1");
    sessionStorage.setItem(WORLD_CONTENT_SPAWNED_SESSION_LEGACY_KEY, "1");
    localStorage.setItem(SPAWN_DEFAULTS_MERGED_STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
  const domRaw = readSettingsFromDOM();
  const merged = mergePlayableContentDefaultsForSpawn(
    /** @type {Record<string, unknown>} */ (domRaw)
  );
  applyEnvironmentSettingsToDOM(normalizeEnvironmentSettings(merged), () => {});
  applySettings(readSettingsFromDOM());
  try {
    saveEnvironmentSettingsAutosave(readSettingsFromDOM());
  } catch {
    /* ignore */
  }
  updateBeeHud();
}

function resetTerrainWorkshop() {
  worldContentSpawned = false;
  try {
    localStorage.removeItem(WORLD_CONTENT_SPAWNED_STORAGE_KEY);
    sessionStorage.removeItem(WORLD_CONTENT_SPAWNED_SESSION_LEGACY_KEY);
  } catch {
    /* ignore */
  }
  applySettings(readSettingsFromDOM());
  updateWorldSpawnCopy();
  updateBeeHud();
}

function toggleSoldierThirdPerson() {
  if (flyMode !== FlyMode.SOLDIER || !soldierPilot) return;
  soldierThirdPerson = !soldierThirdPerson;
  saveWorldModeState({ soldierThirdPerson });
  if (soldierThirdPerson) {
    soldierPilot.prepareThirdPersonCamera(camera, scene);
  } else {
    soldierPilot.attachCamera(camera);
  }
  updateBeeHud();
}

function enterSoldierMode() {
  if (!soldierPilot?.loaded || flyMode !== FlyMode.FREE) return;

  const st = loadWorldModeState() ?? {};
  soldierThirdPerson = st.soldierThirdPerson === true;
  saveWorldModeState({
    freeCam: {
      px: camera.position.x,
      py: camera.position.y,
      pz: camera.position.z,
      rx: euler.x,
      ry: euler.y,
      rz: euler.z,
    },
  });

  let sx = camera.position.x;
  let sz = camera.position.z;
  let syaw = euler.y;
  const sp = st.soldier;
  if (
    sp &&
    typeof sp === "object" &&
    typeof /** @type {{ x?: unknown }} */ (sp).x === "number" &&
    typeof /** @type {{ z?: unknown }} */ (sp).z === "number"
  ) {
    sx = /** @type {number} */ (/** @type {{ x: number }} */ (sp).x);
    sz = /** @type {number} */ (/** @type {{ z: number }} */ (sp).z);
    if (typeof /** @type {{ yaw?: unknown }} */ (sp).yaw === "number") {
      syaw = /** @type {number} */ (/** @type {{ yaw: number }} */ (sp).yaw);
    }
  }

  soldierPilot.placeOnGround(sx, sz, syaw);
  euler.y = syaw;
  savedCameraNear = camera.near;
  camera.near = 0.0015;
  if (soldierThirdPerson) {
    soldierPilot.prepareThirdPersonCamera(camera, scene);
  } else {
    soldierPilot.attachCamera(camera);
  }
  soldierPilot.setVisible(true);
  flyMode = FlyMode.SOLDIER;
  document.getElementById("world-minimap")?.classList.add("is-active", "is-expanded");
  resizeWorldMinimapCanvas();
  lastBeeHudLoco = "";
  updateBeeHud();
}

function exitSoldierMode() {
  if (!soldierPilot?.loaded || flyMode !== FlyMode.SOLDIER) return;

  const st = loadWorldModeState() ?? {};
  saveWorldModeState({
    soldier: {
      x: soldierPilot.root.position.x,
      z: soldierPilot.root.position.z,
      yaw: euler.y,
    },
    soldierThirdPerson,
  });

  soldierPilot.detachCamera(camera, scene);
  const fc = st.freeCam;
  if (
    fc &&
    typeof fc === "object" &&
    typeof /** @type {{ px?: unknown }} */ (fc).px === "number" &&
    typeof /** @type {{ py?: unknown }} */ (fc).py === "number" &&
    typeof /** @type {{ pz?: unknown }} */ (fc).pz === "number"
  ) {
    camera.position.set(
      /** @type {number} */ (/** @type {{ px: number }} */ (fc).px),
      /** @type {number} */ (/** @type {{ py: number }} */ (fc).py),
      /** @type {number} */ (/** @type {{ pz: number }} */ (fc).pz)
    );
    const rx = typeof /** @type {{ rx?: unknown }} */ (fc).rx === "number" ? /** @type {{ rx: number }} */ (fc).rx : euler.x;
    const ry = typeof /** @type {{ ry?: unknown }} */ (fc).ry === "number" ? /** @type {{ ry: number }} */ (fc).ry : euler.y;
    const rz = typeof /** @type {{ rz?: unknown }} */ (fc).rz === "number" ? /** @type {{ rz: number }} */ (fc).rz : euler.z;
    euler.set(rx, ry, rz);
  } else {
    const sx = soldierPilot.root.position.x;
    const sz = soldierPilot.root.position.z;
    camera.position.set(sx, 4.2, sz + 14);
    camera.lookAt(sx, 0.6, sz);
    euler.setFromQuaternion(camera.quaternion, euler.order);
  }
  camera.near = savedCameraNear;
  camera.quaternion.setFromEuler(euler);
  soldierPilot.setVisible(false);
  flyMode = FlyMode.FREE;
  document.getElementById("world-minimap")?.classList.remove("is-active", "is-expanded");
  lastBeeHudLoco = "";
  updateBeeHud();
}

/**
 * @param {typeof FlyMode[keyof typeof FlyMode]} next
 */
function setFlyMode(next) {
  if (next === flyMode) return;

  if (next !== FlyMode.FREE && treeChop?.chopMode) {
    treeChop.chopMode = false;
  }
  if (next !== FlyMode.FREE) {
    terrainPaint.active = false;
    terrainPaint.dragging = false;
    randomCreatureView.end();
  }

  if (next === FlyMode.SOLDIER) {
    enterSoldierMode();
    return;
  }

  if (next === FlyMode.FREE) {
    if (flyMode === FlyMode.SOLDIER) {
      exitSoldierMode();
      return;
    }
    if (!beePilot?.loaded) return;
    beePilot.detachCamera(camera, scene);
    beePilot.setVisible(false);
    flyMode = FlyMode.FREE;
    lastBeeHudLoco = "";
    updateBeeHud();
    return;
  }

  if (flyMode === FlyMode.SOLDIER) return;
  if (!beePilot?.loaded) return;

  if (next === FlyMode.BEE_AUTO && flyMode === FlyMode.BEE_DRONE && beePilot.locomotion !== BeeLocomotion.FLYING) {
    beePilot.takeoff();
  }

  const prev = flyMode;

  if (prev === FlyMode.FREE) {
    beePilot.snapToCameraView(camera);
    beePilot.setVisible(true);
    if (next === FlyMode.BEE_DRONE) {
      beePilot.attachCamera(camera);
      prevBeeY = beePilot.root.position.y;
    } else if (next === FlyMode.BEE_AUTO) {
      beePilot.attachCamera(camera);
    } else if (next === FlyMode.BEE_ORBIT) {
      orbitPanAngle = 0;
      orbitYawOffset = 0;
    }
  } else {
    if (next === FlyMode.BEE_ORBIT) {
      if (prev === FlyMode.BEE_AUTO || prev === FlyMode.BEE_DRONE) {
        beePilot.detachCamera(camera, scene);
        orbitPanAngle = 0;
        orbitYawOffset = 0;
      }
    } else if (next === FlyMode.BEE_AUTO) {
      if (prev === FlyMode.BEE_ORBIT || prev === FlyMode.BEE_DRONE) {
        beePilot.attachCamera(camera);
      }
    } else if (next === FlyMode.BEE_DRONE) {
      beePilot.attachCamera(camera);
      euler.setFromQuaternion(beePilot.root.quaternion, euler.order);
      beePilot.resetMouseYawForBank();
      prevBeeY = beePilot.root.position.y;
    }
  }

  flyMode = next;
  lastBeeHudLoco = "";
  updateBeeHud();
}

function updateBeeHud() {
  const ready = !!beePilot?.loaded;
  const soldierReady = !!soldierPilot?.loaded;
  const ride = document.getElementById("bee-ride-btn");
  const watch = document.getElementById("bee-watch-btn");
  const drone = document.getElementById("bee-drone-btn");
  const exit = document.getElementById("bee-exit-btn");
  const micro = document.getElementById("micro-world-btn");
  const microExit = document.getElementById("micro-world-exit-btn");
  const hint = document.getElementById("hud-fly-hint");
  const beeBlocked = flyMode === FlyMode.SOLDIER;
  if (ride) {
    ride.disabled = !ready || beeBlocked;
    ride.classList.toggle("is-active", ready && flyMode === FlyMode.BEE_AUTO);
    ride.setAttribute("aria-pressed", flyMode === FlyMode.BEE_AUTO ? "true" : "false");
  }
  if (watch) {
    watch.disabled = !ready || beeBlocked;
    watch.classList.toggle("is-active", ready && flyMode === FlyMode.BEE_ORBIT);
    watch.setAttribute("aria-pressed", flyMode === FlyMode.BEE_ORBIT ? "true" : "false");
  }
  if (drone) {
    drone.disabled = !ready || beeBlocked;
    drone.classList.toggle("is-active", ready && flyMode === FlyMode.BEE_DRONE);
    drone.setAttribute("aria-pressed", flyMode === FlyMode.BEE_DRONE ? "true" : "false");
  }
  if (exit) {
    exit.disabled = !ready || flyMode === FlyMode.FREE || beeBlocked;
  }
  if (micro) {
    micro.disabled = !soldierReady || flyMode !== FlyMode.FREE;
    micro.classList.toggle("is-active", flyMode === FlyMode.SOLDIER);
    micro.setAttribute("aria-pressed", flyMode === FlyMode.SOLDIER ? "true" : "false");
  }
  if (microExit) {
    microExit.disabled = flyMode !== FlyMode.SOLDIER;
  }
  const soldierCam = document.getElementById("soldier-cam-toggle");
  if (soldierCam) {
    soldierCam.disabled = flyMode !== FlyMode.SOLDIER;
    soldierCam.classList.toggle("is-active", flyMode === FlyMode.SOLDIER && soldierThirdPerson);
    soldierCam.setAttribute(
      "aria-pressed",
      flyMode === FlyMode.SOLDIER && soldierThirdPerson ? "true" : "false"
    );
    soldierCam.textContent = soldierThirdPerson ? "1st person view" : "3rd person view";
  }
  const treeChopBtn = document.getElementById("tree-chop-btn");
  if (treeChopBtn) {
    const free = flyMode === FlyMode.FREE;
    const terrainOn = free && terrainPaint.active === true;
    treeChopBtn.disabled = !free || terrainOn || !worldContentSpawned;
    treeChopBtn.classList.toggle(
      "is-active",
      free && treeChop?.chopMode === true && !terrainOn && worldContentSpawned
    );
    treeChopBtn.setAttribute(
      "aria-pressed",
      free && treeChop?.chopMode && !terrainOn && worldContentSpawned ? "true" : "false"
    );
  }
  const terrainPaintBtn = document.getElementById("terrain-paint-btn");
  if (terrainPaintBtn) {
    const free = flyMode === FlyMode.FREE;
    const chopOn = free && treeChop?.chopMode === true;
    terrainPaintBtn.disabled = !free || chopOn;
    terrainPaintBtn.classList.toggle("is-active", free && terrainPaint.active === true && !chopOn);
    terrainPaintBtn.setAttribute(
      "aria-pressed",
      free && terrainPaint.active && !chopOn ? "true" : "false"
    );
  }
  const treeChopOverlay = document.getElementById("tree-chop-overlay");
  if (treeChopOverlay) {
    const show =
      flyMode === FlyMode.FREE &&
      treeChop?.chopMode === true &&
      !terrainPaint.active &&
      worldContentSpawned;
    treeChopOverlay.classList.toggle("is-visible", show);
    treeChopOverlay.setAttribute("aria-hidden", show ? "false" : "true");
  }
  const terrainPaintOverlay = document.getElementById("terrain-paint-overlay");
  const terrainPaintReticle = document.getElementById("terrain-paint-reticle");
  {
    const show = flyMode === FlyMode.FREE && terrainPaint.active === true && !treeChop?.chopMode;
    if (terrainPaintOverlay) {
      terrainPaintOverlay.classList.toggle("is-visible", show);
      terrainPaintOverlay.setAttribute("aria-hidden", show ? "false" : "true");
    }
    if (terrainPaintReticle) {
      terrainPaintReticle.classList.toggle("is-visible", show);
      terrainPaintReticle.setAttribute("aria-hidden", show ? "false" : "true");
    }
  }
  const worldSpawnOverlay = document.getElementById("world-spawn-overlay");
  if (worldSpawnOverlay) {
    const showBanner = flyMode === FlyMode.FREE && !worldContentSpawned;
    worldSpawnOverlay.classList.toggle("is-visible", showBanner);
    worldSpawnOverlay.setAttribute("aria-hidden", showBanner ? "false" : "true");
  }
  const terrainResetWorkshopBtn = document.getElementById("terrain-reset-workshop-btn");
  if (terrainResetWorkshopBtn) {
    terrainResetWorkshopBtn.style.display = worldContentSpawned ? "block" : "none";
  }
  updateTerrainPersistenceUi();
  const terrainModeRow = document.querySelector(".terrain-paint-modes");
  if (terrainModeRow) {
    terrainModeRow.classList.toggle("is-disabled", terrainPaint.tool === "level");
  }
  if (terrainPaintGrid) {
    terrainPaintGrid.visible =
      flyMode === FlyMode.FREE && terrainPaint.active === true && !treeChop?.chopMode;
  }
  const canvasEl = document.getElementById("c");
  if (canvasEl) {
    canvasEl.classList.toggle(
      "tree-chop-cursor",
      flyMode === FlyMode.FREE && treeChop?.chopMode === true && !terrainPaint.active
    );
    canvasEl.classList.toggle(
      "terrain-paint-cursor",
      flyMode === FlyMode.FREE && terrainPaint.active === true && !treeChop?.chopMode
    );
  }
  const randomCreatureBtn = document.getElementById("random-creature-view-btn");
  if (randomCreatureBtn) {
    const can = worldContentSpawned && flyMode === FlyMode.FREE;
    randomCreatureBtn.disabled = !can;
    randomCreatureBtn.classList.toggle("is-active", can && randomCreatureView.active);
    randomCreatureBtn.setAttribute(
      "aria-pressed",
      can && randomCreatureView.active ? "true" : "false"
    );
  }
  const documentaryBtn = document.getElementById("documentary-btn");
  if (documentaryBtn) {
    const can = worldContentSpawned && flyMode === FlyMode.FREE;
    documentaryBtn.disabled = !can && !documentary.active;
    documentaryBtn.classList.toggle("is-active", documentary.active);
    documentaryBtn.setAttribute("aria-pressed", documentary.active ? "true" : "false");
  }
  if (hint) {
    if (flyMode === FlyMode.FREE) {
      if (randomCreatureView.active) {
        hint.textContent =
          "Random creature view: ~1 min per subject (butterflies, fish, whale, …). Esc or button to exit.";
      } else if (!worldContentSpawned) {
        hint.textContent =
          terrainHeightField && !terrainHeightField.hasDryLand()
            ? "Open ocean: raise land with terrain paint to form islands, then Spawn world to place grass, trees, and life on dry ground."
            : "Dry land is ready — Spawn world to place grass, trees, and life, or use Terrain paint to reshape the coast first.";
      } else if (terrainPaint.active && !treeChop?.chopMode) {
        hint.textContent =
          "Terrain paint: aim the crosshair at the ground (brush ring shows size). Soft / Sharp raise or lower (dig up to 6 ft), Level flattens — water shows at 3 ft below the local surface when you dig deep enough. Hold left mouse and move the mouse to sweep the brush. Ctrl+Z undo · terrain auto-saves. E or Terrain paint to exit.";
      } else if (treeChop?.chopMode) {
        hint.textContent =
          "Tree chop: click canvas once to capture mouse (look), then hold and swipe to cut — works at long range. — T or Chop to exit.";
      } else {
        hint.textContent =
          "Click to fly — WASD · Space up · Shift down · Mouse look · Bee ride / drone below.";
      }
    } else if (flyMode === FlyMode.SOLDIER) {
      hint.textContent =
        "Micro world: ~1″ tall — WASD · Shift sprint · Mouse look · V or view button switches 1st/3rd person · Exit restores your saved overhead camera.";
    } else if (flyMode === FlyMode.BEE_AUTO) {
      hint.textContent =
        "Bee ride (FPV): autopilot. Bee watch: orbit camera. Drone to pilot yourself. Exit — free flight.";
    } else if (flyMode === FlyMode.BEE_ORBIT) {
      hint.textContent =
        "Bee watch: camera pans around the bee on autopilot — mouse moves the orbit. Exit bee — free flight.";
    } else if (
      beePilot?.locomotion &&
      beePilot.locomotion !== BeeLocomotion.FLYING
    ) {
      hint.textContent =
        "Walking on ground, flower, or bark — WASD to move. Space — take off. Exit bee — free flight.";
    } else {
      hint.textContent =
        "Bumblebee drone: fly near ground or flowers to land; WASD, Space up, Shift down, mouse. Exit — free flight.";
    }
  }
}

export async function main() {
  if (applyWipeFromUrlIfRequested()) return;

  const loader = new THREE.TextureLoader();
  let groundMap = null;
  try {
    groundMap = await loader.loadAsync("/textures/ground.png");
    configureGroundTexture(groundMap, renderer);
  } catch (err) {
    console.error(
      "Ground texture missing. Place your image at public/textures/ground.png",
      err
    );
  }

  if (groundMap) {
    configureGroundTexture(groundMap, renderer);
  }
  terrainHeightField = new TerrainHeightField(256);
  groundPlaneRef = new GroundPlane(scene, groundMap, terrainHeightField);
  snowAccumField = new SnowAccumulationField(terrainHeightField);
  const gSnowU = groundPlaneRef.material.uniforms;
  if (gSnowU.uSnowCover) gSnowU.uSnowCover.value = snowAccumField.texture;
  if (gSnowU.uSnowHalfExtent) gSnowU.uSnowHalfExtent.value = terrainHeightField.halfExtent;
  terrainHeightField.ensureWaterMesh(scene);

  terrainPaintGrid = new THREE.GridHelper(GROUND_EXTENT, 80, 0xffffff, 0xffffff);
  terrainPaintGrid.name = "TerrainPaintGrid";
  terrainPaintGrid.position.y = 0.06;
  terrainPaintGrid.visible = false;
  terrainPaintGrid.material.transparent = true;
  terrainPaintGrid.material.opacity = 0.44;
  terrainPaintGrid.material.depthWrite = false;
  terrainPaintGrid.renderOrder = 2;
  scene.add(terrainPaintGrid);

  // Brush footprint ring — a flat annulus of radius 1 (scaled to brushRadius each frame)
  // that sits on the ground at the aim point so you can see exactly where and how big the
  // brush is. depthTest off so it stays visible over hills.
  const brushRingGeo = new THREE.RingGeometry(0.92, 1.0, 72);
  brushRingGeo.rotateX(-Math.PI / 2);
  terrainBrushRing = new THREE.Mesh(
    brushRingGeo,
    new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  terrainBrushRing.name = "TerrainBrushRing";
  terrainBrushRing.renderOrder = 5;
  terrainBrushRing.frustumCulled = false;
  terrainBrushRing.visible = false;
  scene.add(terrainBrushRing);

  sky = new SkyDome(scene);
  constellations = new ConstellationOverlay(scene);
  flowerField = new FlowerField(scene, GRASS_FIELD_SPREAD);
  treeForest = new TreeForest(scene, GRASS_FIELD_SPREAD);
  rockField = new RockField(scene, GRASS_FIELD_SPREAD);
  beeHiveField = new BeeHiveField(scene, GRASS_FIELD_SPREAD);
  if (loadTerrainFromLocalStorageOrClearBroken(terrainHeightField)) {
    treeForest.syncTreeGroundHeight(terrainHeightField);
    rockField.syncGroundHeight(terrainHeightField);
    beeHiveField.syncGroundHeight(terrainHeightField);
  } else {
    let bootstrap = consumeBootstrapTerrain();
    if (bootstrap !== "land" && bootstrap !== "water") {
      bootstrap = await pickStartingTerrainViaModal();
    }
    if (bootstrap === "land") {
      terrainHeightField.fillDefaultFlatLand();
    } else if (bootstrap === "water") {
      terrainHeightField.fillDefaultOceanFloor();
    } else {
      terrainHeightField.fillDefaultHalfBeach();
    }
    saveTerrainToLocalStorage(terrainHeightField);
  }
  updateWorldSpawnCopy();

  try {
    const fromLocal = localStorage.getItem(WORLD_CONTENT_SPAWNED_STORAGE_KEY) === "1";
    const fromSession = sessionStorage.getItem(WORLD_CONTENT_SPAWNED_SESSION_LEGACY_KEY) === "1";
    worldContentSpawned = fromLocal || fromSession;
    if (fromSession && !fromLocal) {
      localStorage.setItem(WORLD_CONTENT_SPAWNED_STORAGE_KEY, "1");
    }
  } catch {
    worldContentSpawned = false;
  }

  treeChop = new TreeChopSystem(scene, treeForest);
  butterflySwarm = new ButterflySwarm(scene, GRASS_FIELD_SPREAD);
  ladybugSwarm = new LadybugSwarm(scene, GRASS_FIELD_SPREAD);
  bumblebeeSwarm = new BumblebeeSwarm(scene, GRASS_FIELD_SPREAD);
  fireflySwarm = new FireflySwarm(scene, GRASS_FIELD_SPREAD);
  antSwarm = new AntSwarm(scene, GRASS_FIELD_SPREAD);
  wormSwarm = new WormSwarm(scene, GRASS_FIELD_SPREAD);
  birdFlockLand = new BirdFlock(scene, GRASS_FIELD_SPREAD);
  birdFlockWater = new BirdFlock(scene, GRASS_FIELD_SPREAD);
  fishSwarm = new FishSwarm(scene, GRASS_FIELD_SPREAD);
  lakeWhale = new LakeWhale(scene, GRASS_FIELD_SPREAD);
  fishFoodField = new FishFoodField(scene, GRASS_FIELD_SPREAD);
  spiderField = new SpiderWebField(scene, GRASS_FIELD_SPREAD);
  beePilot = new BumblebeePilot(scene, GRASS_FIELD_SPREAD);
  try {
    await beePilot.load();
  } catch (e) {
    console.error("[bumblebee] Failed to load FBX", e);
  }
  soldierPilot = new SoldierPilot(scene, GRASS_FIELD_SPREAD);
  try {
    await soldierPilot.load();
  } catch (e) {
    console.error("[soldier] Failed to load micro-world FBX", e);
  }
  try {
    if (beePilot) beeBuzz.init(camera, scene, beePilot.root);
  } catch (e) {
    console.warn("[bee-buzz] Audio init failed — bee visuals unaffected.", e);
  }


  const pmrem = new PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  const envRT = pmrem.fromScene(envScene, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.52;

  updateBeeHud();

  /** @type {{ x: number, y: number }} */
  let knifeNdcStart = { x: 0, y: 0 };
  let knifeStartClientX = 0;
  let knifeStartClientY = 0;
  const slashLine = /** @type {SVGLineElement | null} */ (document.getElementById("tree-chop-slash-line"));

  /**
   * @param {number} cx
   * @param {number} cy
   */
  const clientToNdc = (cx, cy) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((cx - rect.left) / rect.width) * 2 - 1,
      y: -((cy - rect.top) / rect.height) * 2 + 1,
    };
  };

  const hideKnifeSlash = () => {
    if (slashLine) {
      slashLine.classList.remove("is-visible");
    }
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (
      terrainPaint.active &&
      e.button === 0 &&
      flyMode === FlyMode.FREE &&
      document.pointerLockElement === canvas
    ) {
      pushTerrainUndoSnapshot();
      updateTerrainPersistenceUi();
      terrainPaint.dragging = true;
      e.preventDefault();
      return;
    }
    if (!treeChop?.chopMode || e.button !== 0) return;
    if (flyMode !== FlyMode.FREE) return;
    // Knife drag only after pointer lock — otherwise the first click can acquire lock for mouse-look.
    if (document.pointerLockElement !== canvas) return;
    treeChop.dragging = true;
    knifeNdcStart = clientToNdc(e.clientX, e.clientY);
    knifeStartClientX = e.clientX;
    knifeStartClientY = e.clientY;
    if (slashLine) {
      slashLine.setAttribute("x1", String(e.clientX));
      slashLine.setAttribute("y1", String(e.clientY));
      slashLine.setAttribute("x2", String(e.clientX));
      slashLine.setAttribute("y2", String(e.clientY));
      slashLine.classList.add("is-visible");
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* already captured */
    }
    e.preventDefault();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!treeChop?.dragging || !slashLine) return;
    slashLine.setAttribute("x1", String(knifeStartClientX));
    slashLine.setAttribute("y1", String(knifeStartClientY));
    slashLine.setAttribute("x2", String(e.clientX));
    slashLine.setAttribute("y2", String(e.clientY));
  });

  const endKnifeDrag = (e) => {
    if (!treeChop?.dragging) return;
    if (e.type === "pointerup" && e.pointerType === "mouse" && e.button !== 0) return;
    treeChop.dragging = false;
    hideKnifeSlash();
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    if (e.type === "pointercancel") return;
    const ndcEnd = clientToNdc(e.clientX, e.clientY);
    treeChop.tryCutFromSwipe(camera, knifeNdcStart, ndcEnd);
  };

  const endTerrainDrag = (e) => {
    if (!terrainPaint.dragging) return;
    if (e.type === "pointerup" && e.pointerType === "mouse" && e.button !== 0) return;
    terrainPaint.dragging = false;
    finalizeTerrainPaintStroke();
  };

  const endKnifeDragWindow = (e) => {
    endTerrainDrag(e);
    endKnifeDrag(e);
  };
  window.addEventListener("pointerup", endKnifeDragWindow);
  window.addEventListener("pointercancel", endKnifeDragWindow);
  window.addEventListener("blur", () => {
    if (terrainPaint.dragging) {
      terrainPaint.dragging = false;
      finalizeTerrainPaintStroke();
    }
    if (!treeChop?.dragging) return;
    treeChop.dragging = false;
    hideKnifeSlash();
  });
  canvas.addEventListener("lostpointercapture", () => {
    if (terrainPaint.dragging) {
      terrainPaint.dragging = false;
      finalizeTerrainPaintStroke();
    }
    if (treeChop?.dragging) {
      treeChop.dragging = false;
      hideKnifeSlash();
    }
  });

  document.getElementById("tree-chop-btn")?.addEventListener("click", () => {
    if (!treeChop) return;
    terrainPaint.active = false;
    terrainPaint.dragging = false;
    treeChop.chopMode = !treeChop.chopMode;
    updateBeeHud();
  });

  document.getElementById("terrain-paint-btn")?.addEventListener("click", () => {
    terrainPaint.active = !terrainPaint.active;
    if (terrainPaint.active && treeChop) {
      treeChop.chopMode = false;
    }
    if (!terrainPaint.active) {
      terrainPaint.dragging = false;
      finalizeTerrainPaintStroke();
    }
    updateBeeHud();
  });

  document.querySelectorAll("[data-terrain-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-terrain-tool");
      if (t !== "soft" && t !== "sharp" && t !== "level") return;
      terrainPaint.tool = t;
      document.querySelectorAll("[data-terrain-tool]").forEach((b) => {
        b.classList.toggle("is-active", b === btn);
      });
      updateBeeHud();
    });
  });

  document.querySelectorAll("[data-terrain-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = btn.getAttribute("data-terrain-mode");
      terrainPaint.raise = m === "raise";
      document.querySelectorAll("[data-terrain-mode]").forEach((b) => {
        b.classList.toggle("is-active", b === btn);
      });
    });
  });

  const terrainRadiusEl = document.getElementById("terrain-brush-radius");
  const terrainRadiusVal = document.getElementById("terrain-brush-radius-val");
  terrainRadiusEl?.addEventListener("input", () => {
    const v = parseFloat(/** @type {HTMLInputElement} */ (terrainRadiusEl).value);
    if (Number.isFinite(v)) {
      terrainPaint.brushRadius = v;
      if (terrainRadiusVal) terrainRadiusVal.textContent = String(v);
    }
  });
  const terrainStrEl = document.getElementById("terrain-brush-strength");
  const terrainStrVal = document.getElementById("terrain-brush-strength-val");
  terrainStrEl?.addEventListener("input", () => {
    const v = parseFloat(/** @type {HTMLInputElement} */ (terrainStrEl).value);
    if (Number.isFinite(v)) {
      terrainPaint.strength = v;
      if (terrainStrVal) {
        terrainStrVal.textContent = v < 10 ? v.toFixed(2) : String(v);
      }
    }
  });

  document.getElementById("world-spawn-btn")?.addEventListener("click", () => {
    spawnWorldContent();
  });

  document.getElementById("terrain-reset-heightmap-btn")?.addEventListener("click", () => {
    if (
      !confirm(
        "Replace the entire heightmap with a fresh default ocean (flat seafloor, raise land with terrain paint). Saves immediately to this browser. Also moves the free camera to the start position and clears the saved flight camera. This does not remove grass/trees — use “Clear world” below for that."
      )
    ) {
      return;
    }
    if (!terrainHeightField) return;
    terrainHeightField.fillDefaultOceanFloor();
    treeForest?.syncTreeGroundHeight(terrainHeightField);
    rockField?.syncGroundHeight(terrainHeightField);
    beeHiveField?.syncGroundHeight(terrainHeightField);
    saveTerrainToLocalStorage(terrainHeightField);
    updateWorldSpawnCopy();
    terrainUndoStack.length = 0;
    updateTerrainPersistenceUi();
    try {
      const raw = localStorage.getItem(WORLD_MODE_STORAGE_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        if (o && typeof o === "object") {
          delete o.freeCam;
          localStorage.setItem(WORLD_MODE_STORAGE_KEY, JSON.stringify(o));
        }
      }
    } catch {
      /* ignore */
    }
    if (flyMode === FlyMode.FREE) {
      camera.position.set(0, 5.5, 20);
      euler.set(0, 0, 0);
      camera.quaternion.setFromEuler(euler);
    }
    updateBeeHud();
  });

  document.getElementById("terrain-reset-workshop-btn")?.addEventListener("click", () => {
    if (
      !confirm(
        "Remove all grass, trees, flowers, and critters and return to terrain-only editing? Your heightmap stays."
      )
    ) {
      return;
    }
    resetTerrainWorkshop();
  });

  document.getElementById("terrain-nuke-all-storage-btn")?.addEventListener("click", () => {
    if (
      !confirm(
        "Erase ALL site data for this exact address (everything in local + session storage), then reload. Same as ?wipe=1. If an old map still appears, you may be opening localhost vs 127.0.0.1 — those are separate; wipe both or always use one URL."
      )
    ) {
      return;
    }
    clearAllWorldBrowserStorage();
    location.reload();
  });

  document.getElementById("terrain-undo-btn")?.addEventListener("click", performTerrainUndo);

  document.getElementById("terrain-save-btn")?.addEventListener("click", () => {
    if (!terrainHeightField) return;
    const ok = saveTerrainToLocalStorage(terrainHeightField);
    const btn = document.getElementById("terrain-save-btn");
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = ok ? "Saved" : "Save failed";
      setTimeout(() => {
        btn.textContent = prev;
      }, 1600);
    }
  });

  document.getElementById("terrain-download-btn")?.addEventListener("click", () => {
    if (!terrainHeightField) return;
    downloadTerrainJsonFile(terrainHeightField);
  });

  const terrainImportFile = /** @type {HTMLInputElement | null} */ (
    document.getElementById("terrain-import-file")
  );
  document.getElementById("terrain-import-btn")?.addEventListener("click", () => {
    terrainImportFile?.click();
  });
  terrainImportFile?.addEventListener("change", async (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    const file = t.files?.[0];
    if (!file || !terrainHeightField) {
      t.value = "";
      return;
    }
    try {
      const text = await file.text();
      pushTerrainUndoSnapshot();
      const imp = tryImportTerrainFromJsonText(terrainHeightField, text);
      if (!imp.ok) {
        terrainUndoStack.pop();
        alert(imp.message ?? "Terrain import failed.");
        t.value = "";
        return;
      }
      treeForest?.syncTreeGroundHeight(terrainHeightField);
      rockField?.syncGroundHeight(terrainHeightField);
      beeHiveField?.syncGroundHeight(terrainHeightField);
      saveTerrainToLocalStorage(terrainHeightField);
      updateWorldSpawnCopy();
      updateBeeHud();
      const impBtn = document.getElementById("terrain-import-btn");
      if (impBtn) {
        const prev = impBtn.textContent;
        impBtn.textContent = "Imported";
        setTimeout(() => {
          impBtn.textContent = prev;
        }, 1600);
      }
    } catch (err) {
      console.error(err);
      if (terrainUndoStack.length > 0) terrainUndoStack.pop();
      alert(err instanceof Error ? err.message : "Import failed.");
    }
    t.value = "";
  });

  worldMinimapCanvasEl = /** @type {HTMLCanvasElement | null} */ (
    document.getElementById("world-minimap-canvas")
  );
  window.addEventListener("resize", resizeWorldMinimapCanvas);
  resizeWorldMinimapCanvas();

  document.getElementById("micro-world-btn")?.addEventListener("click", () => {
    setFlyMode(FlyMode.SOLDIER);
  });
  document.getElementById("micro-world-exit-btn")?.addEventListener("click", () => {
    setFlyMode(FlyMode.FREE);
  });
  document.getElementById("soldier-cam-toggle")?.addEventListener("click", () => {
    toggleSoldierThirdPerson();
  });

  document.addEventListener("keydown", (e) => {
    if (
      e.code === "KeyV" &&
      !e.repeat &&
      flyMode === FlyMode.SOLDIER &&
      document.activeElement?.tagName !== "INPUT" &&
      document.activeElement?.tagName !== "TEXTAREA"
    ) {
      e.preventDefault();
      toggleSoldierThirdPerson();
      return;
    }
    if (e.repeat) return;
    if (
      e.code === "Space" &&
      flyMode === FlyMode.BEE_DRONE &&
      beePilot &&
      beePilot.locomotion !== BeeLocomotion.FLYING
    ) {
      e.preventDefault();
      beePilot.takeoff();
      beePilot.attachCamera(camera);
    }
  });

  initSettingsPanel({
    onChange: () => applySettings(readSettingsFromDOM()),
  });
  initSimulationPanel({
    onApplySettings: () => applySettings(readSettingsFromDOM()),
  });
  const autosavedSettings = loadEnvironmentSettingsAutosave();
  if (autosavedSettings) {
    applyEnvironmentSettingsToDOM(autosavedSettings, () => {});
  }
  // One-time heal: worlds spawned before per-key playable defaults kept 0-counts forever
  // (restore never re-runs the spawn merge), so critters like ants/worms/ladybugs never
  // appeared. Merge defaults into any still-zero count once, then mark so deliberate
  // zeros set afterwards stay respected.
  try {
    if (
      worldContentSpawned &&
      localStorage.getItem(SPAWN_DEFAULTS_MERGED_STORAGE_KEY) !== "1"
    ) {
      const merged = mergePlayableContentDefaultsForSpawn(
        /** @type {Record<string, unknown>} */ (readSettingsFromDOM())
      );
      applyEnvironmentSettingsToDOM(normalizeEnvironmentSettings(merged), () => {});
      saveEnvironmentSettingsAutosave(readSettingsFromDOM());
      localStorage.setItem(SPAWN_DEFAULTS_MERGED_STORAGE_KEY, "1");
    }
  } catch {
    /* ignore */
  }
  applySettings(readSettingsFromDOM());
  requestAnimationFrame(() => applySettings(readSettingsFromDOM()));

  const runApplyFromDom = () => applySettings(readSettingsFromDOM());

  document.getElementById("env-export-btn")?.addEventListener("click", () => {
    const snap = terrainHeightField ? getTerrainSnapshotForExport(terrainHeightField) : null;
    const json = serializeEnvironmentSettings(readSettingsFromDOM(), snap);
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `grass-world-environment-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const importFile = /** @type {HTMLInputElement | null} */ (
    document.getElementById("env-import-file")
  );
  document.getElementById("env-import-btn")?.addEventListener("click", () => {
    importFile?.click();
  });
  importFile?.addEventListener("change", async (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    const file = t.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      worldContentSpawned = true;
      try {
        localStorage.setItem(WORLD_CONTENT_SPAWNED_STORAGE_KEY, "1");
        sessionStorage.setItem(WORLD_CONTENT_SPAWNED_SESSION_LEGACY_KEY, "1");
      } catch {
        /* ignore */
      }
      const { settings, terrain } = parseEnvironmentJsonPayload(text);
      applyEnvironmentSettingsToDOM(settings, runApplyFromDom);
      if (terrain && terrainHeightField) {
        const imp = tryImportTerrainFromJsonText(terrainHeightField, JSON.stringify(terrain));
        if (imp.ok) {
          treeForest?.syncTreeGroundHeight(terrainHeightField);
          rockField?.syncGroundHeight(terrainHeightField);
          beeHiveField?.syncGroundHeight(terrainHeightField);
          saveTerrainToLocalStorage(terrainHeightField);
        } else {
          console.warn("[env import] terrain block skipped:", imp.message);
        }
      }
      try {
        saveEnvironmentSettingsAutosave(readSettingsFromDOM());
      } catch {
        /* ignore */
      }
      updateBeeHud();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Import failed.";
      alert(msg);
    }
    t.value = "";
  });

  /** @type {import("./insect-preview.js").ButterflyInsectPreview | null} */
  let insectPreview = null;
  const insectPreviewCanvas = document.getElementById("insect-preview-canvas");
  if (insectPreviewCanvas) {
    insectPreview = new ButterflyInsectPreview(insectPreviewCanvas);
    void insectPreview.init();
    const wrap = document.querySelector(".insect-preview-canvas-wrap");
    if (wrap) {
      const ro = new ResizeObserver(() => insectPreview?.resize());
      ro.observe(wrap);
    }
  }

  const insectOverlay = document.getElementById("insect-preview-overlay");
  document.getElementById("insect-butterfly-save")?.addEventListener("click", () => {
    const json = serializeInsectButterflySettings(readSettingsFromDOM());
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `grass-world-insect-butterfly-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const flowerEditor = initFlowerEditor({
    onApplySettings: runApplyFromDom,
    getDayPhase: () => dayPhase,
    getWindSpeed: () => lastWindSpeed,
    getWindDirRad: () => lastWindDirRad,
    getFlowerColorVariation: () => {
      const el = document.getElementById("set-flower-color-variation");
      const v = parseFloat(/** @type {HTMLInputElement} */ (el)?.value ?? "1");
      return Number.isFinite(v) ? THREE.MathUtils.clamp(v, 0, 1) : 1;
    },
    getElapsedTime: () => clock.getElapsedTime(),
  });

  const splashImg = document.querySelector(".app-splash-img");
  if (splashImg instanceof HTMLImageElement) {
    splashImg.addEventListener("error", () => {
      splashImg.style.display = "none";
    });
  }

  function applyTouchLookDelta(movementX, movementY) {
    if (randomCreatureView.active) return;
    if (terrainPaint.dragging) return;
    if (treeChop?.dragging) return;
    if (flyMode === FlyMode.BEE_ORBIT && beePilot) {
      orbitYawOffset += movementX * 0.004;
      return;
    }
    if (flyMode === FlyMode.BEE_AUTO) return;
    euler.y -= movementX * lookSensitivity;
    euler.x -= movementY * lookSensitivity;
    if (
      flyMode === FlyMode.BEE_DRONE &&
      beePilot &&
      beePilot.locomotion !== BeeLocomotion.FLYING
    ) {
      euler.x = THREE.MathUtils.clamp(euler.x, -0.62, -0.06);
    } else {
      euler.x = Math.max(-PI_2 + 0.01, Math.min(PI_2 - 0.01, euler.x));
    }
  }

  if (document.body.classList.contains("app-mode-tablet")) {
    initTabletControls({
      keys,
      applyLookDelta: applyTouchLookDelta,
      shouldBlockLook: () =>
        randomCreatureView.active ||
        !!terrainPaint.dragging ||
        !!(treeChop && treeChop.dragging),
      shouldSyncMoveStick: () =>
        !randomCreatureView.active &&
        (flyMode === FlyMode.FREE ||
          flyMode === FlyMode.BEE_DRONE ||
          flyMode === FlyMode.SOLDIER),
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    try {
    const dt = Math.min(clock.getDelta(), 0.1);

    /** 0–1: camera in water column (below surface, above lake bed) — softer fog + brighter ground. */
    let underwaterFactor = 0;
    if (terrainHeightField) {
      const wx = camera.position.x;
      const wz = camera.position.z;
      const wy = terrainHeightField.getWaterSurfaceHeightBilinear(wx, wz);
      const gy = terrainHeightField.getHeightBilinear(wx, wz);
      const column = wy - gy;
      if (column > 0.06 && camera.position.y < wy - 0.04 && camera.position.y > gy - 0.06) {
        underwaterFactor = THREE.MathUtils.clamp((wy - camera.position.y - 0.04) / 2.2, 0, 1);
      }
    }

    treeChop?.update(dt);
    const pauseWorld = treeChop?.isCinematicActive() === true;

    if (terrainBrushRing) terrainBrushRing.visible = false;
    if (
      !pauseWorld &&
      terrainPaint.active &&
      flyMode === FlyMode.FREE &&
      groundPlaneRef &&
      terrainHeightField &&
      pointerLocked
    ) {
      groundRaycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const gh = groundRaycaster.intersectObject(groundPlaneRef.mesh, false);
      if (gh.length > 0) {
        const p = gh[0].point;
        // Show the brush footprint at the aim point (green raise / red lower / cyan level).
        if (terrainBrushRing) {
          const ringColor =
            terrainPaint.tool === "level"
              ? 0x8ad8ff
              : terrainPaint.raise
                ? 0x9cffa6
                : 0xff9c8a;
          terrainBrushRing.material.color.setHex(ringColor);
          terrainBrushRing.position.set(p.x, p.y + 0.12, p.z);
          terrainBrushRing.scale.set(
            terrainPaint.brushRadius,
            1,
            terrainPaint.brushRadius
          );
          terrainBrushRing.visible = true;
        }
        if (terrainPaint.dragging) {
          const sign = terrainPaint.tool === "level" ? 1 : terrainPaint.raise ? 1 : -1;
          terrainHeightField.paint(
            p.x,
            p.z,
            terrainPaint.brushRadius,
            terrainPaint.tool,
            terrainPaint.strength,
            dt,
            sign
          );
        }
      }
    }

    if (!pauseWorld) {
      if (Math.abs(dayPhase - targetDayPhase) > 0.01) {
        dayPhase += (targetDayPhase - dayPhase) * Math.min(1, dt * 0.5);
      } else {
        dayPhase = targetDayPhase;
      }
    }

    // Always sync fog, scene background, and clear color — even during tree-chop cinematics. Skipping
    // this while pauseWorld was true left frames clearing to black / wrong buffer state.
    ambient.intensity = 0.1 + dayPhase * 0.7;
    sun.intensity = dayPhase * 1.5;
    hemiFill.intensity = 0.18 + dayPhase * 0.38;
    scene.fog.color.lerpColors(NIGHT_FOG, DAY_FOG, dayPhase);
    const baseFogDensity = THREE.MathUtils.lerp(0.00175, 0.0005, dayPhase);
    scene.fog.density = THREE.MathUtils.lerp(baseFogDensity, baseFogDensity * 0.12, underwaterFactor);
    scene.background.copy(scene.fog.color);
    renderer.setClearColor(scene.fog.color, 1);

    if (!pauseWorld) {
      const elapsed = clock.getElapsedTime();
      weatherEffects?.update(
        dt,
        elapsed,
        {
          rainIntensity: lastRainIntensity,
          snowIntensity: lastSnowIntensity,
          lightningIntensity: lastLightningIntensity,
          windSpeed: lastWindSpeed,
          windDirRad: lastWindDirRad,
          dayPhase,
        },
        camera,
        terrainHeightField && snowAccumField
          ? { terrain: terrainHeightField, snowAccum: snowAccumField }
          : null
      );
      const storm = THREE.MathUtils.clamp(
        lastRainIntensity * 0.92 + lastLightningIntensity * 0.48,
        0,
        1
      );
      sky?.update(elapsed, camera.position, dayPhase, {
        windSpeed: lastWindSpeed,
        windDirRad: lastWindDirRad,
        cloudCover: lastCloudCover,
        storm,
        lightningFlash: weatherEffects?.getLightningFlash(elapsed) ?? 0,
      });
      if (sky) {
        sky.getSunDirection(_sunDirGround);
        sun.position.copy(_sunDirGround).multiplyScalar(280);
      } else {
        _sunDirGround.copy(sun.position).normalize();
      }

      const tide = computeMoonTide(elapsed);
      terrainHeightField?.setTideOffsetM(tide.offsetM);
      terrainHeightField?.updateWaterShaderUniforms({
        time: elapsed,
        dayPhase,
        camera,
        sunDirection: sun.position,
        water: latestWaterShader,
        tide: { offsetM: tide.offsetM, waveMul: tide.waveMul },
      });

      const hudTide = document.getElementById("hud-moon-tide");
      const hudTideState = document.getElementById("hud-moon-tide-state");
      const hudTideOff = document.getElementById("hud-moon-tide-offset");
      const mtp = getMoonTideParams();
      if (hudTide && hudTideState && hudTideOff) {
        if (mtp.enabled) {
          hudTide.hidden = false;
          hudTideState.textContent = tide.rising ? "rising" : "falling";
          hudTideOff.textContent = `${tide.offsetM >= 0 ? "+" : ""}${tide.offsetM.toFixed(2)} m MSL`;
        } else {
          hudTide.hidden = true;
        }
      }
    }

    if (
      !pauseWorld &&
      !randomCreatureView.active &&
      (flyMode === FlyMode.BEE_AUTO || flyMode === FlyMode.BEE_ORBIT) &&
      beePilot
    ) {
      const t = clock.getElapsedTime();
      if (flyMode === FlyMode.BEE_ORBIT) {
        beePilot.updateAutopilot(dt, t, lastWindSpeed, lastWindDirRad, {
          pace: 0.36,
          minHeight: 2.15,
          watchHighView: true,
          smoothingMul: 0.58,
        });
        updateBeeOrbitCamera(dt);
      } else {
        beePilot.updateAutopilot(dt, t, lastWindSpeed, lastWindDirRad, {
          pace: 1,
          minHeight: 1.35,
          watchHighView: false,
          smoothingMul: 1,
        });
        beePilot.updateRideCamera(camera, t, dt);
      }
    } else if (!pauseWorld && !randomCreatureView.active && flyMode === FlyMode.SOLDIER && soldierPilot) {
      soldierPilot.updateWalking(dt, keys, euler.y);
      if (soldierThirdPerson) {
        soldierPilot.updateThirdPersonCamera(camera, scene, euler, dt);
      } else {
        if (camera.parent !== soldierPilot.cameraMount) {
          soldierPilot.attachCamera(camera);
        }
        camera.rotation.set(euler.x, 0, 0);
      }
      drawWorldMinimap(
        worldMinimapCanvasEl,
        GRASS_FIELD_SPREAD,
        soldierPilot.root.position.x,
        soldierPilot.root.position.z,
        euler.y
      );
    } else if (!pauseWorld && !randomCreatureView.active && flyMode === FlyMode.BEE_DRONE && beePilot) {
      beePilot.tryLanding(dt, flowerField, treeForest, prevBeeY);
      if (beePilot.locomotion === BeeLocomotion.FLYING) {
        beePilot.updateDrone(dt, keys, euler, beeDroneSpeed);
        beePilot.updateDroneFlightCamera(camera);
      } else {
        beePilot.updateWalking(dt, keys, euler);
        if (beePilot.locomotion === BeeLocomotion.WALK_GROUND) {
          beePilot.updateDroneGroundCamera(camera, scene, euler, dt);
        }
      }
      prevBeeY = beePilot.root.position.y;
      if (beePilot.locomotion !== lastBeeHudLoco) {
        lastBeeHudLoco = beePilot.locomotion;
        updateBeeHud();
      }
    }

    const tBuzz = clock.getElapsedTime();
    if (!pauseWorld && beePilot?.flyingModel?.visible) {
      beePilot.updateFlyingBuzzVisuals(tBuzz, dt, camera);
    }
    canvas.style.filter = "";

    if (!pauseWorld) {
      groundPlaneRef?.setDayPhase(dayPhase);
      const rainNow = lastRainIntensity;
      const soak = rainNow * rainNow * 0.5 + rainNow * 0.08;
      groundWetness += dt * soak * 0.95;
      groundWetness -= dt * (0.055 + rainNow * 0.02) * (1.0 - rainNow * 0.35);
      groundWetness = THREE.MathUtils.clamp(groundWetness, 0, 1);
      snowAccumField?.update(dt, lastSnowIntensity, dayPhase);
      groundPlaneRef?.updateGroundWeather({
        wetness: groundWetness,
        time: clock.getElapsedTime(),
        camera,
        rainIntensity: rainNow,
        windDirRad: lastWindDirRad,
        sunDirection: _sunDirGround,
        underwater: underwaterFactor,
      });
      constellations?.update(camera, clock.getElapsedTime(), dt);

      for (let i = 0; i < grassMatsByType.length; i++) {
        const m = grassMatsByType[i];
        if (!m) continue;
        m.uniforms.uTime.value += dt;
        m.uniforms.dayPhase.value = dayPhase;
      }

      if (flowerField) {
        for (let i = 0; i < flowerField.matsByType.length; i++) {
          const m = flowerField.matsByType[i];
          if (!m) continue;
          m.uniforms.uTime.value += dt;
          m.uniforms.dayPhase.value = dayPhase;
        }
      }

      treeForest?.update(clock.getElapsedTime(), lastWindSpeed, lastWindDirRad);
      butterflySwarm?.update(
        clock.getElapsedTime(),
        lastWindSpeed,
        lastWindDirRad,
        lastButterflyDynamics
      );
      const spiderZones = spiderField?.getZones() ?? null;
      spiderField?.update(clock.getElapsedTime());
      ladybugSwarm?.update(clock.getElapsedTime(), dt, spiderZones);
      bumblebeeSwarm?.update(
        clock.getElapsedTime(),
        dt,
        lastWindSpeed,
        lastWindDirRad,
        flowerField,
        beeHiveField
      );
      fireflySwarm?.update(
        clock.getElapsedTime(),
        lastWindSpeed,
        lastWindDirRad,
        dayPhase,
        camera,
        spiderZones
      );
      antSwarm?.update(clock.getElapsedTime(), dt);
      wormSwarm?.update(clock.getElapsedTime(), dt);
      birdFlockLand?.update(clock.getElapsedTime(), dt, lastWindSpeed, lastWindDirRad, terrainHeightField);
      birdFlockWater?.update(clock.getElapsedTime(), dt, lastWindSpeed, lastWindDirRad, terrainHeightField);
      fishFoodField?.update(
        clock.getElapsedTime(),
        dt,
        lastWindSpeed,
        lastWindDirRad,
        lastFishDepthRange
      );
      fishSwarm?.update(
        clock.getElapsedTime(),
        dt,
        lastWindSpeed,
        lastWindDirRad,
        fishFoodField,
        lastFishEcosystem,
        lastFishDepthRange,
        ladybugSwarm,
        spiderField
      );
      lakeWhale?.update(clock.getElapsedTime(), dt, terrainHeightField, worldContentSpawned);
      const fishHud = document.getElementById("hud-fish-eco");
      if (fishHud && !fishHud.hidden && fishSwarm && fishFoodField) {
        const st = fishSwarm.lastEcosystemStats;
        const popEl = document.getElementById("hud-fish-eco-pop");
        const hm = /** @type {HTMLMeterElement | null} */ (document.getElementById("hud-fish-eco-health-meter"));
        const hv = document.getElementById("hud-fish-eco-health-val");
        const pl = document.getElementById("hud-fish-eco-pellets");
        if (popEl) {
          popEl.textContent = `${st.living.toLocaleString()} / ${st.total.toLocaleString()} alive`;
        }
        if (hm) hm.value = THREE.MathUtils.clamp(st.meanHealth, 0, 1);
        if (hv) hv.textContent = `${Math.round(THREE.MathUtils.clamp(st.meanHealth, 0, 1) * 100)}%`;
        if (pl) {
          pl.textContent = `${fishFoodField.getActivePelletCount().toLocaleString()} active`;
        }
      }

      beeBuzz.update({
        visible: !!(beePilot?.root.visible) && flyMode !== FlyMode.SOLDIER,
        masterVolume: lastAudioVolume,
        muted: lastAudioMuted,
      });
    }

    if (documentary.active && flyMode === FlyMode.FREE) {
      documentary.updateCamera(dt);
      euler.setFromQuaternion(camera.quaternion, euler.order);
    } else if (randomCreatureView.active && flyMode === FlyMode.FREE) {
      const rvBefore = randomCreatureView.active;
      randomCreatureView.update(camera, euler, clock.getElapsedTime());
      if (rvBefore && !randomCreatureView.active) updateBeeHud();
    } else if (flyMode === FlyMode.FREE && treeChop?.updateCinematicCamera(camera, dt)) {
      /* Panoramic orbit around falling tree; skip free-flight movement. */
    } else {
      updateMovement(dt);
    }

    if (treeChop?.needsEulerSync) {
      treeChop.needsEulerSync = false;
      euler.setFromQuaternion(camera.quaternion, euler.order);
    }

    const showInsectPreview = isButterflyInsectPreviewVisible();
    if (insectOverlay) {
      insectOverlay.classList.toggle("is-visible", showInsectPreview);
      insectOverlay.setAttribute("aria-hidden", showInsectPreview ? "false" : "true");
    }
    if (!pauseWorld && showInsectPreview && insectPreview) {
      insectPreview.update(
        clock.getElapsedTime(),
        lastWindSpeed,
        lastWindDirRad,
        lastButterflyDynamics,
        lastButterflyPreviewTint
      );
    }

    if (!pauseWorld) {
      flowerEditor.tick(clock.getElapsedTime());
    }

    } catch (e) {
      console.error("[main] animate frame error", e);
    } finally {
      renderer.setRenderTarget(null);
      try {
        renderer.render(scene, camera);
      } catch (e2) {
        console.error("[main] render failed", e2);
      }
    }
  }
  animate();

  document.getElementById("transition-btn")?.addEventListener("click", toggleDayNight);

  document.getElementById("constellation-btn")?.addEventListener("click", () => {
    constellations?.toggle();
  });

  document.addEventListener("keydown", (e) => {
    if (e.code === "KeyC" && document.activeElement?.tagName !== "INPUT") {
      e.preventDefault();
      constellations?.toggle();
    }
  });

  document.getElementById("bee-ride-btn")?.addEventListener("click", () => {
    setFlyMode(FlyMode.BEE_AUTO);
  });
  document.getElementById("bee-watch-btn")?.addEventListener("click", () => {
    setFlyMode(FlyMode.BEE_ORBIT);
  });
  document.getElementById("bee-drone-btn")?.addEventListener("click", () => {
    setFlyMode(FlyMode.BEE_DRONE);
  });
  document.getElementById("bee-exit-btn")?.addEventListener("click", () => {
    setFlyMode(FlyMode.FREE);
  });
  document.getElementById("random-creature-view-btn")?.addEventListener("click", () => {
    toggleRandomCreatureView();
  });
  document.getElementById("documentary-btn")?.addEventListener("click", () => {
    if (documentary.active) {
      documentary.stop();
      return;
    }
    if (flyMode !== FlyMode.FREE || !worldContentSpawned) return;
    void documentary.openMenu();
  });
}
