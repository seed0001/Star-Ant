/**
 * Persist terrain heightmaps in localStorage (same browser / origin).
 * @module
 */

import * as THREE from "three";

/** @type {string} */
export const TERRAIN_STORAGE_KEY = "gwTerrainHeightmapV1";

/** Free camera / soldier / bee — same keys as main.js (single source of truth). */
export const WORLD_MODE_STORAGE_KEY = "grass-world-world-mode-v1";
export const WORLD_CONTENT_SPAWNED_STORAGE_KEY = "gwWorldContentSpawned";

/**
 * Nuclear reset for this origin: removes **every** key (no missed renames / legacy keys).
 * Dev URLs like `http://127.0.0.1:5173` and `http://localhost:5173` are separate storage — clear both if needed.
 */
export function clearAllWorldBrowserStorage() {
  try {
    localStorage.clear();
  } catch {
    /* quota / private mode */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
}

/**
 * If the URL contains `?wipe=1` or `?clearWorld=1`, clears all storage for this origin and reloads without the param.
 * Run **before** any code reads `hasTerrainSnapshotInLocalStorage()` so old heightmaps cannot load.
 * @returns {boolean} true when a navigation was triggered (caller should stop)
 */
export function applyWipeFromUrlIfRequested() {
  try {
    const sp = new URLSearchParams(location.search);
    if (sp.get("wipe") !== "1" && sp.get("clearWorld") !== "1") return false;
    localStorage.clear();
    sessionStorage.clear();
    sp.delete("wipe");
    sp.delete("clearWorld");
    const q = sp.toString();
    location.replace(`${location.pathname}${q ? `?${q}` : ""}${location.hash}`);
    return true;
  } catch {
    return false;
  }
}

/** World half-extent must match within this (meters) for import. */
const HALF_EXTENT_EPS = 0.02;

/**
 * @param {Float32Array} arr
 * @returns {string}
 */
export function float32ArrayToBase64(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * @param {string} b64
 * @param {number} floatCount
 * @returns {Float32Array}
 */
export function base64ToFloat32Array(b64, floatCount) {
  const binary = atob(b64);
  const out = new Float32Array(floatCount);
  const u8 = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  const n = Math.min(binary.length, u8.length);
  for (let i = 0; i < n; i++) {
    u8[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Bilinear sample from a flattened height grid (same layout as {@link TerrainHeightField}).
 * @param {Float32Array} buf
 * @param {number} segments
 * @param {number} halfExtent
 * @param {number} wx
 * @param {number} wz
 */
export function sampleGridHeight(buf, segments, halfExtent, wx, wz) {
  const h = halfExtent;
  const s = halfExtent * 2;
  const u = (wx + h) / s;
  const v = (-wz + h) / s;
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
  const fx = u * segments;
  const fy = v * segments;
  const x0 = Math.min(Math.floor(fx), segments - 1);
  const y0 = Math.min(Math.floor(fy), segments - 1);
  const x1 = Math.min(x0 + 1, segments);
  const y1 = Math.min(y0 + 1, segments);
  const tx = fx - x0;
  const ty = fy - y0;
  const row = segments + 1;
  const a = buf[x0 + y0 * row];
  const b = buf[x1 + y0 * row];
  const c = buf[x0 + y1 * row];
  const d = buf[x1 + y1 * row];
  const ab = THREE.MathUtils.lerp(a, b, tx);
  const cd = THREE.MathUtils.lerp(c, d, tx);
  return THREE.MathUtils.lerp(ab, cd, ty);
}

/**
 * Resample a height grid to a different segment count (same world extent).
 * @param {Float32Array} buf
 * @param {number} oldSeg
 * @param {number} newSeg
 * @param {number} halfExtent
 * @returns {Float32Array}
 */
export function resampleHeightGrid(buf, oldSeg, newSeg, halfExtent) {
  if (oldSeg === newSeg) return buf;
  const h = halfExtent;
  const out = new Float32Array((newSeg + 1) * (newSeg + 1));
  for (let j = 0; j <= newSeg; j++) {
    for (let i = 0; i <= newSeg; i++) {
      const u = i / newSeg;
      const v = j / newSeg;
      const wx = u * 2 * h - h;
      const wz = h - v * 2 * h;
      out[i + j * (newSeg + 1)] = sampleGridHeight(buf, oldSeg, halfExtent, wx, wz);
    }
  }
  return out;
}

/**
 * @param {import("./terrain-paint.js").TerrainHeightField} field
 * @returns {boolean}
 */
export function saveTerrainToLocalStorage(field) {
  try {
    const payload = getTerrainSnapshotForExport(field);
    if (!payload) return false;
    localStorage.setItem(TERRAIN_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch (e) {
    console.warn("[terrain] save failed", e);
    return false;
  }
}

/**
 * Same payload as terrain file / localStorage — embed in full environment export JSON.
 * @param {import("./terrain-paint.js").TerrainHeightField | null} field
 * @returns {{ v: number, segments: number, halfExtent: number, h: string, rh: string } | null}
 */
export function getTerrainSnapshotForExport(field) {
  if (!field) return null;
  try {
    return {
      v: 2,
      segments: field.segments,
      halfExtent: field.halfExtent,
      h: float32ArrayToBase64(field.heights),
      rh: float32ArrayToBase64(field.referenceHeights),
    };
  } catch (e) {
    console.warn("[terrain] snapshot failed", e);
    return null;
  }
}

/**
 * @param {import("./terrain-paint.js").TerrainHeightField} field
 * @returns {boolean}
 */
export function loadTerrainFromLocalStorage(field) {
  try {
    const raw = localStorage.getItem(TERRAIN_STORAGE_KEY);
    if (!raw) return false;
    const r = tryImportTerrainFromJsonText(field, raw);
    return r.ok;
  } catch (e) {
    console.warn("[terrain] load failed", e);
    return false;
  }
}

const SS_WORLD_SPAWN_LEGACY = "gwWorldSpawned";

/**
 * Like {@link loadTerrainFromLocalStorage}, but if the JSON exists and import fails (corrupt, truncated,
 * wrong version), removes the heightmap **and** spawn/camera keys so you never get “stuck” with a
 * broken camera and no terrain.
 * @param {import("./terrain-paint.js").TerrainHeightField} field
 * @returns {boolean}
 */
export function loadTerrainFromLocalStorageOrClearBroken(field) {
  try {
    const raw = localStorage.getItem(TERRAIN_STORAGE_KEY);
    if (!raw) return false;
    const r = tryImportTerrainFromJsonText(field, raw);
    if (r.ok) return true;
    localStorage.removeItem(TERRAIN_STORAGE_KEY);
    localStorage.removeItem(WORLD_CONTENT_SPAWNED_STORAGE_KEY);
    localStorage.removeItem(WORLD_MODE_STORAGE_KEY);
    try {
      sessionStorage.removeItem(SS_WORLD_SPAWN_LEGACY);
    } catch {
      /* ignore */
    }
    console.warn(
      "[terrain] Saved heightmap was invalid — removed.",
      !r.ok && "message" in r ? /** @type {{ message: string }} */ (r).message : ""
    );
    return false;
  } catch (e) {
    console.warn("[terrain] load failed — clearing saved heightmap", e);
    try {
      localStorage.removeItem(TERRAIN_STORAGE_KEY);
      localStorage.removeItem(WORLD_CONTENT_SPAWNED_STORAGE_KEY);
      localStorage.removeItem(WORLD_MODE_STORAGE_KEY);
      sessionStorage.removeItem(SS_WORLD_SPAWN_LEGACY);
    } catch {
      /* ignore */
    }
    return false;
  }
}

/**
 * True when localStorage has a terrain snapshot this build can load (used to skip login).
 * @returns {boolean}
 */
export function hasTerrainSnapshotInLocalStorage() {
  try {
    const raw = localStorage.getItem(TERRAIN_STORAGE_KEY);
    if (!raw) return false;
    const o = JSON.parse(raw);
    const v = Number(o.v);
    if (v !== 1 && v !== 2) return false;
    return typeof o.h === "string" && o.h.length > 0;
  } catch {
    return false;
  }
}

/**
 * Download terrain as JSON (backup / transfer). Same schema as localStorage.
 * @param {import("./terrain-paint.js").TerrainHeightField} field
 */
export function downloadTerrainJsonFile(field) {
  const payload = {
    v: 2,
    segments: field.segments,
    halfExtent: field.halfExtent,
    h: float32ArrayToBase64(field.heights),
    rh: float32ArrayToBase64(field.referenceHeights),
  };
  const json = JSON.stringify(payload);
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = `grass-world-terrain-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Import terrain JSON with flexible matching: numeric coercion, halfExtent tolerance,
 * and bilinear resampling when segment counts differ (same world size).
 * @param {import("./terrain-paint.js").TerrainHeightField} field
 * @param {string} jsonText
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function tryImportTerrainFromJsonText(field, jsonText) {
  let o;
  try {
    o = JSON.parse(jsonText.replace(/^\uFEFF/, ""));
  } catch (e) {
    return {
      ok: false,
      message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!o || typeof o !== "object") {
    return { ok: false, message: "Terrain JSON must be an object at the top level." };
  }

  /** @type {Record<string, unknown>} */
  let rec = /** @type {Record<string, unknown>} */ (o);

  // Full environment / insect exports — not heightmaps (users often pick the wrong file).
  const fmt = rec.format;
  if (fmt === "grass-world-environment" || fmt === "grass-world-insect-butterfly") {
    return {
      ok: false,
      message:
        'This file is a settings export (environment or insect), not a terrain heightmap. Use Terrain → Export file to make a backup, then Terrain → Import file here. To load sliders and weather, use Settings → Import environment.',
    };
  }
  if (rec.settings && typeof rec.settings === "object" && typeof rec.h !== "string") {
    return {
      ok: false,
      message:
        'This JSON looks like a full environment/settings document (it has "settings" but no terrain field "h"). Terrain import needs a file from Terrain → Export file (top-level v, segments, halfExtent, h, optional rh).',
    };
  }

  // Nested bundle: { terrain: { v, h, ... } }
  if (typeof rec.h !== "string" && rec.terrain && typeof rec.terrain === "object") {
    const inner = /** @type {Record<string, unknown>} */ (rec.terrain);
    if (typeof inner.h === "string") {
      rec = inner;
    }
  }
  // DevTools / backup: { "gwTerrainHeightmapV1": "{ \"v\": 2, ... }" }
  if (typeof rec.h !== "string" && typeof rec[TERRAIN_STORAGE_KEY] === "string") {
    try {
      const inner = JSON.parse(String(rec[TERRAIN_STORAGE_KEY]).replace(/^\uFEFF/, ""));
      if (inner && typeof inner === "object" && typeof /** @type {Record<string, unknown>} */ (inner).h === "string") {
        rec = /** @type {Record<string, unknown>} */ (inner);
      }
    } catch {
      /* fall through — may still fail v/h checks with a clear message */
    }
  }

  o = rec;

  const v = Number(o.v);
  if (v !== 1 && v !== 2) {
    return {
      ok: false,
      message: `Unsupported format (v=${String(o.v)}). This build expects terrain export v1 or v2.`,
    };
  }
  if (typeof o.h !== "string") {
    return { ok: false, message: "Missing height data field (h)." };
  }

  const segFile = Math.round(Number(o.segments));
  const halfFile = Number(o.halfExtent);
  if (!Number.isFinite(segFile) || segFile < 1) {
    return {
      ok: false,
      message: `Invalid segments in file (${String(o.segments)}). Expected a positive integer (e.g. 256).`,
    };
  }
  if (!Number.isFinite(halfFile)) {
    return {
      ok: false,
      message: `Invalid halfExtent in file (${String(o.halfExtent)}).`,
    };
  }
  if (Math.abs(halfFile - field.halfExtent) > HALF_EXTENT_EPS) {
    return {
      ok: false,
      message: `World size mismatch: file uses halfExtent=${halfFile} m, this map uses ${field.halfExtent} m. Use the same Grass World version or matching terrain extent.`,
    };
  }

  const nFile = segFile + 1;
  const expectedFloats = nFile * nFile;
  const needBytes = expectedFloats * 4;

  let binaryH;
  try {
    binaryH = atob(o.h);
  } catch {
    return { ok: false, message: "Height data (h) is not valid base64." };
  }
  if (binaryH.length < needBytes - 3) {
    return {
      ok: false,
      message: `Height data is too short (${binaryH.length} bytes; need about ${needBytes} for ${segFile} segments). File may be truncated or corrupted.`,
    };
  }

  let heights = base64ToFloat32Array(o.h, expectedFloats);
  let rh;
  if (v === 2 && typeof o.rh === "string") {
    let binaryRh;
    try {
      binaryRh = atob(o.rh);
    } catch {
      return { ok: false, message: "Reference height data (rh) is not valid base64." };
    }
    if (binaryRh.length < needBytes - 3) {
      return {
        ok: false,
        message: `Reference data (rh) is too short (${binaryRh.length} bytes).`,
      };
    }
    rh = base64ToFloat32Array(o.rh, expectedFloats);
  } else {
    rh = new Float32Array(heights);
  }

  const segField = field.segments;
  const half = field.halfExtent;

  if (segFile !== segField) {
    heights = resampleHeightGrid(heights, segFile, segField, half);
    rh = resampleHeightGrid(rh, segFile, segField, half);
  }

  const ok = field.restoreHeights(heights, rh);
  if (!ok) {
    return {
      ok: false,
      message: "Height arrays could not be applied (internal length mismatch).",
    };
  }
  return { ok: true };
}

/**
 * @param {import("./terrain-paint.js").TerrainHeightField} field
 * @param {string} jsonText
 * @returns {boolean}
 */
export function importTerrainFromJsonText(field, jsonText) {
  return tryImportTerrainFromJsonText(field, jsonText).ok;
}
