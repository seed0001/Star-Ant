import { FlowerPreview } from "./flower-preview.js";
import { nearestFibonacciPetalCount } from "./flowers.js";
import { FlowerMirrorDraw } from "./flower-mirror-draw.js";
import {
  applyFlowerPresetToRow,
  normalizeFlowerPreset,
  readFlowerPresetFromRow,
  updateFlowerRowSpan,
} from "./settings-panel.js";

/**
 * @param {object} opts
 * @param {() => void} opts.onApplySettings Called after Save (applies to world / field).
 * @param {() => number} opts.getDayPhase
 * @param {() => number} opts.getWindSpeed
 * @param {() => number} opts.getWindDirRad
 * @param {() => number} opts.getFlowerColorVariation from main settings slider
 * @param {() => number} opts.getElapsedTime world clock seconds
 */
export function initFlowerEditor({
  onApplySettings,
  getDayPhase,
  getWindSpeed,
  getWindDirRad,
  getFlowerColorVariation,
  getElapsedTime,
}) {
  const overlay = document.getElementById("flower-editor-overlay");
  const fieldsRoot = document.getElementById("flower-editor-fields");
  const template = document.getElementById("flower-preset-template");
  const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById("flower-preview-canvas"));
  const openBtn = document.getElementById("flower-editor-open-btn");
  const saveBtn = document.getElementById("flower-editor-save-btn");
  const cancelBtn = document.getElementById("flower-editor-cancel-btn");
  const closeBtn = document.getElementById("flower-editor-close-btn");
  const indexSelect = document.getElementById("flower-editor-index");
  const wrap = document.querySelector(".flower-editor-canvas-wrap");
  const mirrorCanvas = /** @type {HTMLCanvasElement | null} */ (
    document.getElementById("flower-mirror-canvas")
  );
  const mirrorPetalSelect = document.getElementById("flower-mirror-petal-index");
  const mirrorClearBtn = document.getElementById("flower-mirror-clear");
  const mirrorApplyBtn = document.getElementById("flower-mirror-apply");
  const mirrorResetBtn = document.getElementById("flower-mirror-reset-petal");
  const petalShapeModeSelect = document.getElementById("flower-petal-shape-mode");
  const mirrorPanel = document.getElementById("flower-mirror-panel");

  /** @type {FlowerMirrorDraw | null} */
  let mirrorDraw = null;
  let mirrorPetalIndex = 0;

  /** @type {FlowerPreview | null} */
  let preview = null;
  /** @type {HTMLElement | null} */
  let editorRow = null;
  let currentIndex = 0;
  let open = false;
  /** @type {ResizeObserver | null} */
  let resizeObserver = null;

  function getRows() {
    return document.querySelectorAll("#flower-presets-list [data-flower-preset-row]");
  }

  function syncIndexSelect() {
    if (!indexSelect) return;
    const rows = getRows();
    const n = rows.length;
    indexSelect.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `Flower ${i + 1}`;
      indexSelect.appendChild(opt);
    }
    if (n > 0) {
      indexSelect.value = String(Math.min(currentIndex, n - 1));
    }
  }

  function bindEditorInputs(row) {
    row.querySelectorAll("input[data-field]").forEach((el) => {
      el.addEventListener("input", () => {
        const f = /** @type {HTMLInputElement} */ (el).getAttribute("data-field");
        if (f) updateFlowerRowSpan(row, f);
        syncPreview();
      });
    });
    row.querySelectorAll("select[data-field]").forEach((el) => {
      el.addEventListener("change", () => {
        syncMirrorPetalDropdown();
        loadMirrorCanvasForCurrentPetal();
        syncPreview();
      });
    });
  }

  function syncMirrorPetalDropdown() {
    if (!mirrorPetalSelect || !editorRow) return;
    const raw = readFlowerPresetFromRow(editorRow);
    const n = nearestFibonacciPetalCount(raw.petalCount);
    mirrorPetalSelect.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `Petal ${i + 1}`;
      mirrorPetalSelect.appendChild(opt);
    }
    mirrorPetalIndex = Math.min(mirrorPetalIndex, n - 1);
    mirrorPetalSelect.value = String(Math.max(0, mirrorPetalIndex));
  }

  function loadMirrorCanvasForCurrentPetal() {
    if (!mirrorDraw || !mirrorPetalSelect) return;
    const p = getNormalizedEditorPreset();
    if (!p) return;
    const idx = parseInt(mirrorPetalSelect.value, 10);
    mirrorPetalIndex = Number.isFinite(idx) ? idx : 0;
    const entry = p.petalShapes?.[mirrorPetalIndex];
    if (entry?.widthProfile?.length) {
      mirrorDraw.loadProfile(entry.widthProfile);
    } else {
      mirrorDraw.clear();
    }
  }

  /**
   * @param {Array<{ widthProfile: number[] } | null> | null | undefined} shapes
   */
  function writePetalShapesToRow(shapes) {
    if (!editorRow) return;
    const psj = editorRow.querySelector('[data-field="petalShapesJson"]');
    if (!(psj instanceof HTMLInputElement)) return;
    const hasAny =
      shapes &&
      shapes.some((x) => x && Array.isArray(x.widthProfile) && x.widthProfile.length > 0);
    psj.value = hasAny ? JSON.stringify(shapes) : "";
  }

  function getNormalizedEditorPreset() {
    if (!editorRow) return null;
    return normalizeFlowerPreset(readFlowerPresetFromRow(editorRow));
  }

  function setPetalShapeCustomToRow(custom) {
    if (!editorRow) return;
    const h = editorRow.querySelector('[data-field="petalShapeCustom"]');
    if (h instanceof HTMLInputElement) h.value = custom ? "true" : "false";
    if (petalShapeModeSelect instanceof HTMLSelectElement) {
      petalShapeModeSelect.value = custom ? "custom" : "procedural";
    }
    updateMirrorModeUi();
  }

  function syncPetalShapeModeFromRow() {
    if (!editorRow || !(petalShapeModeSelect instanceof HTMLSelectElement)) return;
    const p = getNormalizedEditorPreset();
    petalShapeModeSelect.value = p?.petalShapeCustom ? "custom" : "procedural";
    updateMirrorModeUi();
  }

  function updateMirrorModeUi() {
    const p = getNormalizedEditorPreset();
    const custom = p?.petalShapeCustom === true;
    if (mirrorPanel) {
      mirrorPanel.classList.toggle("flower-mirror-procedural", !custom);
    }
    const hint = document.getElementById("flower-mirror-mode-hint");
    if (hint) {
      hint.textContent = custom
        ? "Custom: the mirror canvas below shapes the petal width along its length (per petal index)."
        : "Procedural: built-in golden-angle / φ width curve. Switch to Custom to mirror-paint a silhouette.";
    }
    const dis = !custom;
    if (mirrorCanvas) mirrorCanvas.style.pointerEvents = dis ? "none" : "auto";
    for (const btn of [mirrorClearBtn, mirrorApplyBtn, mirrorResetBtn]) {
      if (btn instanceof HTMLButtonElement) {
        btn.disabled = dis;
        btn.style.opacity = dis ? "0.45" : "1";
      }
    }
    if (mirrorPetalSelect instanceof HTMLSelectElement) {
      mirrorPetalSelect.disabled = dis;
      mirrorPetalSelect.style.opacity = dis ? "0.45" : "1";
    }
  }

  function syncPreview() {
    if (!preview || !open) return;
    const p = getNormalizedEditorPreset();
    if (!p) return;
    const wind = { speed: getWindSpeed(), dirRad: getWindDirRad() };
    preview.setFrame(getElapsedTime(), getDayPhase(), p, wind, getFlowerColorVariation());
  }

  function populateEditor(index) {
    if (!fieldsRoot || !template) return;
    const rows = getRows();
    if (rows.length < 1) return;
    currentIndex = Math.max(0, Math.min(index, rows.length - 1));
    const sourceRow = rows[currentIndex];
    if (!(sourceRow instanceof HTMLElement)) return;

    fieldsRoot.replaceChildren();
    const frag = template.content.cloneNode(true);
    const row = frag.firstElementChild;
    if (!(row instanceof HTMLElement)) return;
    fieldsRoot.appendChild(row);
    editorRow = row;

    const raw = readFlowerPresetFromRow(sourceRow);
    applyFlowerPresetToRow(row, normalizeFlowerPreset(raw));

    const rm = row.querySelector(".remove-flower-preset");
    if (rm instanceof HTMLElement) rm.style.display = "none";
    const countLabel = row.querySelector('[data-flower-val="count"]')?.closest(".setting-row");
    if (countLabel instanceof HTMLElement) countLabel.style.display = "none";

    bindEditorInputs(row);
    syncPetalShapeModeFromRow();
    syncMirrorPetalDropdown();
    loadMirrorCanvasForCurrentPetal();
  }

  function openEditor(startIndex = 0) {
    const rows = getRows();
    if (rows.length < 1) return;
    if (!canvas || !overlay) return;

    syncIndexSelect();
    populateEditor(startIndex);
    overlay.classList.add("is-visible");
    overlay.setAttribute("aria-hidden", "false");
    open = true;

    if (!preview) preview = new FlowerPreview(canvas);
    if (mirrorCanvas && !mirrorDraw) {
      mirrorDraw = new FlowerMirrorDraw(mirrorCanvas);
      mirrorDraw.bind();
    }
    void preview.init().then(() => {
      preview?.resize();
      syncPreview();
      // Overlay was display:none; layout may report 0×0 until after paint.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          preview?.resize();
          syncPreview();
        });
      });
    });

    if (wrap && typeof ResizeObserver !== "undefined") {
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(() => preview?.resize());
      resizeObserver.observe(wrap);
    }
  }

  function closeEditor() {
    if (!overlay) return;
    overlay.classList.remove("is-visible");
    overlay.setAttribute("aria-hidden", "true");
    open = false;
    editorRow = null;
    if (fieldsRoot) fieldsRoot.replaceChildren();
    resizeObserver?.disconnect();
    resizeObserver = null;
  }

  function saveEditor() {
    if (!editorRow) return;
    const rows = getRows();
    const target = rows[currentIndex];
    if (!(target instanceof HTMLElement)) return;
    const raw = readFlowerPresetFromRow(editorRow);
    applyFlowerPresetToRow(target, normalizeFlowerPreset(raw));
    onApplySettings();
    closeEditor();
  }

  openBtn?.addEventListener("click", () => {
    if (getRows().length < 1) {
      window.alert("Add at least one flower type first (or use the default row), then open the designer.");
      return;
    }
    openEditor(0);
  });

  indexSelect?.addEventListener("change", () => {
    const v = parseInt(/** @type {HTMLSelectElement} */ (indexSelect).value, 10);
    if (Number.isFinite(v)) populateEditor(v);
    syncPreview();
  });

  saveBtn?.addEventListener("click", () => saveEditor());
  cancelBtn?.addEventListener("click", () => closeEditor());
  closeBtn?.addEventListener("click", () => closeEditor());

  petalShapeModeSelect?.addEventListener("change", () => {
    if (!(petalShapeModeSelect instanceof HTMLSelectElement) || !editorRow) return;
    const custom = petalShapeModeSelect.value === "custom";
    setPetalShapeCustomToRow(custom);
    syncPreview();
  });

  mirrorPetalSelect?.addEventListener("change", () => {
    const v = parseInt(/** @type {HTMLSelectElement} */ (mirrorPetalSelect).value, 10);
    mirrorPetalIndex = Number.isFinite(v) ? v : 0;
    loadMirrorCanvasForCurrentPetal();
  });

  mirrorClearBtn?.addEventListener("click", () => {
    mirrorDraw?.clear();
  });

  mirrorApplyBtn?.addEventListener("click", () => {
    if (!editorRow || !mirrorDraw || !mirrorPetalSelect) return;
    if (!(petalShapeModeSelect instanceof HTMLSelectElement)) return;
    const prof = mirrorDraw.extractWidthProfile();
    if (!prof) {
      window.alert("Draw a silhouette first (stroke wide enough to sample).");
      return;
    }
    if (petalShapeModeSelect.value !== "custom") {
      setPetalShapeCustomToRow(true);
    }
    const raw = readFlowerPresetFromRow(editorRow);
    const pc = nearestFibonacciPetalCount(raw.petalCount);
    const idx = parseInt(mirrorPetalSelect.value, 10);
    const i = Number.isFinite(idx) ? idx : 0;
    const prev = Array.isArray(raw.petalShapes) ? [...raw.petalShapes] : [];
    while (prev.length < pc) prev.push(null);
    prev[i] = { widthProfile: prof };
    writePetalShapesToRow(prev);
    syncPreview();
  });

  mirrorResetBtn?.addEventListener("click", () => {
    if (!editorRow || !mirrorPetalSelect) return;
    const raw = readFlowerPresetFromRow(editorRow);
    const pc = nearestFibonacciPetalCount(raw.petalCount);
    const idx = parseInt(mirrorPetalSelect.value, 10);
    const i = Number.isFinite(idx) ? idx : 0;
    const prev = Array.isArray(raw.petalShapes) ? [...raw.petalShapes] : [];
    while (prev.length < pc) prev.push(null);
    prev[i] = null;
    const hasAny = prev.some((x) => x && x.widthProfile);
    writePetalShapesToRow(hasAny ? prev : null);
    mirrorDraw?.clear();
    syncPreview();
  });

  document.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && open) {
      e.preventDefault();
      closeEditor();
    }
  });

  return {
    /**
     * @param {number} t elapsed seconds (animation clock)
     */
    tick(t) {
      if (!open || !preview) return;
      const p = getNormalizedEditorPreset();
      if (!p) return;
      const wind = { speed: getWindSpeed(), dirRad: getWindDirRad() };
      preview.setFrame(t, getDayPhase(), p, wind, getFlowerColorVariation());
    },
    isOpen() {
      return open;
    },
    dispose() {
      mirrorDraw?.unbind();
      mirrorDraw = null;
      preview?.dispose();
      preview = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
    },
  };
}
