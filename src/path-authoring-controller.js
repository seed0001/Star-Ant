import * as THREE from "three";
import {
  anchorsToJSON,
  buildVariableTubeGeometry,
  anchorsFromJSON,
} from "./path-authoring.js";

/**
 * Scene + UI bridge for path authoring: anchors, tube mesh, helpers, Alt+click placement.
 */
export class PathAuthoringController {
  /**
   * @param {{
   *   scene: THREE.Scene,
   *   camera: THREE.PerspectiveCamera,
   *   canvas: HTMLCanvasElement,
   * }} opts
   */
  constructor(opts) {
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.canvas = opts.canvas;

    /** @type {{ position: THREE.Vector3, radius: number }[]} */
    this.anchors = [
      { position: new THREE.Vector3(0, 0.2, 0), radius: 0.06 },
      { position: new THREE.Vector3(0.8, 0.35, 0.2), radius: 0.04 },
      { position: new THREE.Vector3(1.6, 0.15, -0.1), radius: 0.07 },
    ];

    this.closed = false;
    this.tubularSegments = 48;
    this.radialSegments = 10;
    this.liveRebuild = true;

    this.group = new THREE.Group();
    this.group.name = "PathAuthoring";
    this.scene.add(this.group);

    /** @type {MutationObserver | null} */
    this._visibilityObserver = null;

    this.helpers = new THREE.Group();
    this.group.add(this.helpers);

    /** @type {THREE.Mesh | null} */
    this.mesh = null;
    /** @type {THREE.Line | null} */
    this.pathLine = null;

    this._raycaster = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._anchorMat = new THREE.MeshStandardMaterial({
      color: 0x66cc88,
      emissive: 0x224433,
      emissiveIntensity: 0.35,
      roughness: 0.45,
      metalness: 0.1,
    });
    this._lineMat = new THREE.LineBasicMaterial({
      color: 0x88ffaa,
      opacity: 0.9,
      transparent: true,
    });

    this._bindDom();
    this._rebuildHelpers();
    this.rebuildMesh();
  }

  _bindDom() {
    const placeCb = (e) => this._onCanvasClick(e);
    this.canvas.addEventListener("click", placeCb);
    /** @type {(() => void) | null} */
    this._disposeCanvas = () => this.canvas.removeEventListener("click", placeCb);

    document.getElementById("author-place-mode")?.addEventListener("change", (e) => {
      const on = /** @type {HTMLInputElement} */ (e.target).checked;
      const hint = document.getElementById("author-place-hint");
      if (hint) hint.style.opacity = on ? "1" : "0.45";
    });

    document.getElementById("author-closed")?.addEventListener("change", (e) => {
      this.closed = /** @type {HTMLInputElement} */ (e.target).checked;
      if (this.liveRebuild) this.rebuildMesh();
    });

    document.getElementById("author-live-rebuild")?.addEventListener("change", (e) => {
      this.liveRebuild = /** @type {HTMLInputElement} */ (e.target).checked;
    });

    document.getElementById("author-tubular")?.addEventListener("input", (e) => {
      this.tubularSegments = Math.max(
        8,
        Math.min(256, parseInt(/** @type {HTMLInputElement} */ (e.target).value, 10) || 48)
      );
      this._setLabel("val-author-tubular", String(this.tubularSegments));
      if (this.liveRebuild) this.rebuildMesh();
    });

    document.getElementById("author-radial")?.addEventListener("input", (e) => {
      this.radialSegments = Math.max(
        3,
        Math.min(48, parseInt(/** @type {HTMLInputElement} */ (e.target).value, 10) || 10)
      );
      this._setLabel("val-author-radial", String(this.radialSegments));
      if (this.liveRebuild) this.rebuildMesh();
    });

    document.getElementById("author-add-anchor")?.addEventListener("click", () => {
      const last = this.anchors[this.anchors.length - 1];
      const base = last ? last.position.clone() : new THREE.Vector3();
      base.x += 0.35;
      base.y = Math.max(0.05, base.y);
      this.anchors.push({ position: base, radius: 0.05 });
      this._syncDomList();
      this._rebuildHelpers();
      if (this.liveRebuild) this.rebuildMesh();
    });

    document.getElementById("author-build")?.addEventListener("click", () => {
      this.rebuildMesh();
    });

    document.getElementById("author-clear")?.addEventListener("click", () => {
      this.anchors = [];
      this._syncDomList();
      this._rebuildHelpers();
      this._disposeMesh();
    });

    document.getElementById("author-import-btn")?.addEventListener("click", () => {
      document.getElementById("author-import-json")?.click();
    });

    document.getElementById("author-default-radius")?.addEventListener("input", (e) => {
      const v = parseFloat(/** @type {HTMLInputElement} */ (e.target).value);
      if (Number.isFinite(v)) this._setLabel("val-author-def-r", v.toFixed(3));
    });

    document.getElementById("author-export-json")?.addEventListener("click", () => {
      const payload = {
        format: "grass-world-path-authoring",
        version: 1,
        closed: this.closed,
        tubularSegments: this.tubularSegments,
        radialSegments: this.radialSegments,
        anchors: anchorsToJSON(this.anchors),
      };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `path-authoring-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById("author-import-json")?.addEventListener("change", (e) => {
      const input = /** @type {HTMLInputElement} */ (e.target);
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const o = JSON.parse(String(reader.result));
          const inner = o.anchors ? o : o.settings;
          if (!inner || !Array.isArray(inner.anchors)) return;
          this.anchors = anchorsFromJSON(inner.anchors);
          if (typeof inner.closed === "boolean") {
            this.closed = inner.closed;
            const el = /** @type {HTMLInputElement | null} */ (document.getElementById("author-closed"));
            if (el) el.checked = this.closed;
          }
          if (Number.isFinite(inner.tubularSegments)) {
            this.tubularSegments = THREE.MathUtils.clamp(Math.floor(inner.tubularSegments), 8, 256);
            const ts = /** @type {HTMLInputElement | null} */ (document.getElementById("author-tubular"));
            if (ts) ts.value = String(this.tubularSegments);
            this._setLabel("val-author-tubular", String(this.tubularSegments));
          }
          if (Number.isFinite(inner.radialSegments)) {
            this.radialSegments = THREE.MathUtils.clamp(Math.floor(inner.radialSegments), 3, 48);
            const rs = /** @type {HTMLInputElement | null} */ (document.getElementById("author-radial"));
            if (rs) rs.value = String(this.radialSegments);
            this._setLabel("val-author-radial", String(this.radialSegments));
          }
          this._syncDomList();
          this._rebuildHelpers();
          this.rebuildMesh();
        } catch {
          /* ignore */
        }
        input.value = "";
      };
      reader.readAsText(file);
    });

    this._syncDomList();
    this._setLabel("val-author-tubular", String(this.tubularSegments));
    this._setLabel("val-author-radial", String(this.radialSegments));

    this._attachVisibilitySync();
    this._syncPathAuthoringVisibility();
  }

  _syncPathAuthoringVisibility() {
    const panel = document.getElementById("settings-panel");
    const authorPanel = document.getElementById("panel-author");
    const open = panel?.classList.contains("open") === true;
    const authorTab = authorPanel?.classList.contains("is-active") === true;
    this.group.visible = open && authorTab;
  }

  _attachVisibilitySync() {
    const panel = document.getElementById("settings-panel");
    const authorPanel = document.getElementById("panel-author");
    if (!panel || !authorPanel) return;
    const mo = new MutationObserver(() => this._syncPathAuthoringVisibility());
    mo.observe(panel, { attributes: true, attributeFilter: ["class"] });
    mo.observe(authorPanel, { attributes: true, attributeFilter: ["class"] });
    this._visibilityObserver = mo;
  }

  /**
   * @param {MouseEvent} e
   */
  _onCanvasClick(e) {
    const place = /** @type {HTMLInputElement | null} */ (document.getElementById("author-place-mode"));
    if (!place?.checked || !e.altKey) return;

    const panel = document.getElementById("settings-panel");
    const authorPanel = document.getElementById("panel-author");
    if (!panel?.classList.contains("open") || !authorPanel?.classList.contains("is-active")) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const hit = new THREE.Vector3();
    if (!this._raycaster.ray.intersectPlane(this._plane, hit)) return;

    const rIn = /** @type {HTMLInputElement | null} */ (document.getElementById("author-default-radius"));
    const r = THREE.MathUtils.clamp(parseFloat(rIn?.value ?? "0.05") || 0.05, 0.005, 2);

    this.anchors.push({ position: hit, radius: r });
    this._syncDomList();
    this._rebuildHelpers();
    if (this.liveRebuild) this.rebuildMesh();
  }

  _setLabel(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  _syncDomList() {
    const list = document.getElementById("author-anchors-list");
    if (!list) return;
    list.replaceChildren();
    this.anchors.forEach((a, i) => {
      const row = document.createElement("div");
      row.className = "author-anchor-row";
      row.innerHTML = `
        <span class="author-anchor-label">#${i + 1}</span>
        <label class="author-num">X <input type="number" data-idx="${i}" data-comp="x" step="0.05" value="${a.position.x.toFixed(3)}" /></label>
        <label class="author-num">Y <input type="number" data-idx="${i}" data-comp="y" step="0.05" value="${a.position.y.toFixed(3)}" /></label>
        <label class="author-num">Z <input type="number" data-idx="${i}" data-comp="z" step="0.05" value="${a.position.z.toFixed(3)}" /></label>
        <label class="author-num">R <input type="number" data-idx="${i}" data-comp="r" step="0.005" min="0.005" value="${a.radius.toFixed(4)}" /></label>
        <button type="button" class="author-remove" data-idx="${i}" aria-label="Remove anchor">×</button>
      `;
      list.appendChild(row);
    });

    list.querySelectorAll('input[data-comp]').forEach((inp) => {
      inp.addEventListener("change", () => {
        const el = /** @type {HTMLInputElement} */ (inp);
        const idx = parseInt(el.getAttribute("data-idx") ?? "-1", 10);
        const comp = el.getAttribute("data-comp");
        const anchor = this.anchors[idx];
        if (!anchor || !comp) return;
        const v = parseFloat(el.value);
        if (!Number.isFinite(v)) return;
        if (comp === "x") anchor.position.x = v;
        else if (comp === "y") anchor.position.y = v;
        else if (comp === "z") anchor.position.z = v;
        else if (comp === "r") anchor.radius = Math.max(0.001, v);
        this._rebuildHelpers();
        if (this.liveRebuild) this.rebuildMesh();
      });
    });

    list.querySelectorAll(".author-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(/** @type {HTMLElement} */ (btn).getAttribute("data-idx") ?? "-1", 10);
        if (idx < 0 || idx >= this.anchors.length) return;
        this.anchors.splice(idx, 1);
        this._syncDomList();
        this._rebuildHelpers();
        if (this.liveRebuild) this.rebuildMesh();
      });
    });
  }

  _rebuildHelpers() {
    this.helpers.clear();
    if (this.pathLine) {
      this.pathLine.geometry.dispose();
      this.pathLine = null;
    }

    for (const a of this.anchors) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(a.radius * 0.85, 0.04), 12, 10),
        this._anchorMat
      );
      s.position.copy(a.position);
      s.castShadow = true;
      this.helpers.add(s);
    }

    if (this.anchors.length > 1) {
      const pts = this.anchors.map((a) => a.position.clone());
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      this.pathLine = new THREE.Line(g, this._lineMat);
      this.helpers.add(this.pathLine);
    }
  }

  _disposeMesh() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      if (this.mesh.material instanceof THREE.Material) this.mesh.material.dispose();
      this.group.remove(this.mesh);
      this.mesh = null;
    }
  }

  rebuildMesh() {
    this._disposeMesh();
    if (this.anchors.length < 2) return;

    const pts = this.anchors.map((a) => a.position);
    const radii = this.anchors.map((a) => a.radius);
    const geo = buildVariableTubeGeometry(pts, radii, {
      closed: this.closed,
      tubularSegments: this.tubularSegments,
      radialSegments: this.radialSegments,
    });
    if (!geo) return;

    const mat = new THREE.MeshStandardMaterial({
      color: 0x7ab89a,
      roughness: 0.42,
      metalness: 0.12,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = "PathTube";
    this.group.add(this.mesh);
  }

  dispose() {
    this._disposeMesh();
    this.helpers.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    if (this.pathLine?.geometry) this.pathLine.geometry.dispose();
    this._anchorMat.dispose();
    this._lineMat.dispose();
    this._visibilityObserver?.disconnect();
    this._visibilityObserver = null;
    this.scene.remove(this.group);
    this._disposeCanvas?.();
  }
}
