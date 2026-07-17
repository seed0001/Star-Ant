import * as THREE from "three";

/**
 * In-app documentary player: episode menu, narrated audio (pre-rendered Edge TTS),
 * caption sync from word-boundary cues, and a cinematic camera that executes the
 * [SHOT: ...] cues embedded in each episode script.
 *
 * Data lives in /audio/documentary/ (see docs/documentary/README.md):
 *   manifest.json          — { episodes: [{id, number, title, season}] }
 *   eNN.script.json        — { title, segments: [{shot, text, wordStart, wordCount}] }
 *   eNN.cues.json          — [{text, offsetMs, durationMs}] per spoken word
 *   eNN.mp3                — narration audio
 */

const BASE = "/audio/documentary/";

/** Camera never goes below terrain + this. */
const GROUND_CLEARANCE = 0.12;

/** Subjects that read as "the sky" — camera looks up/out instead of at a point. */
const SKY_SUBJECTS = new Set([
  "sky",
  "sun",
  "moon",
  "stars",
  "rain",
  "snow",
  "lightning",
]);

/** Subjects whose shots are allowed underwater. */
const WET_SUBJECTS = new Set(["fish", "whale", "underwater", "water"]);

const UP_HINT_RE =
  /\b(rise|rises|rising|ascend(?:s|ing)?|ascent|climb(?:s|ing)?|lift(?:s|ing)?|up|upward|skyward)\b/;
const DOWN_HINT_RE =
  /\b(descend(?:s|ing)?|descent|plunge(?:s|ing)?|sink(?:s|ing)?|drop(?:s|ping)?|down|downward|dive(?:s|ing)?)\b/;

/**
 * Vertical direction a shot's notes ask for: +1 up, -1 down, 0 no preference.
 * When the notes mention both ("plunge ... then rise"), the first mention wins.
 * @param {{notes?: string} | null} shot
 */
function verticalHint(shot) {
  const notes = (shot?.notes ?? "").toLowerCase();
  const up = notes.search(UP_HINT_RE);
  const down = notes.search(DOWN_HINT_RE);
  if (up < 0 && down < 0) return 0;
  if (down < 0) return 1;
  if (up < 0) return -1;
  return up < down ? 1 : -1;
}

/**
 * Tokens the TTS actually speaks (word-boundary events map 1:1 to these).
 * @param {string} text
 */
function spokenTokens(text) {
  return text.split(/\s+/).filter((t) => /[A-Za-z0-9]/.test(t));
}

/**
 * @param {string} text
 * @returns {string[]} sentences (best-effort split)
 */
function splitSentences(text) {
  const out = text.match(/[^.!?]+[.!?]+(?:["'”])?\s*/g);
  return out && out.length > 0 ? out.map((s) => s.trim()) : [text];
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class DocumentaryController {
  /**
   * @param {object} opts
   * @param {THREE.PerspectiveCamera} opts.camera
   * @param {(name: string) => object | null} opts.getSubject subject descriptor provider
   * @param {() => object | null} opts.getTerrain terrain height field (may be null)
   * @param {() => number} opts.getSpread field half-extent
   * @param {() => boolean} opts.canControl false → controller auto-stops (mode changed)
   * @param {() => void} [opts.onStart]
   * @param {() => void} [opts.onStop]
   */
  constructor(opts) {
    this.camera = opts.camera;
    this.getSubject = opts.getSubject;
    this.getTerrain = opts.getTerrain;
    this.getSpread = opts.getSpread;
    this.canControl = opts.canControl;
    this.onStart = opts.onStart ?? (() => {});
    this.onStop = opts.onStop ?? (() => {});

    this.active = false;

    /** @type {{episodes: {id: string, number: number, title: string, season: string}[]} | null} */
    this._manifest = null;
    /** @type {Map<string, object>} */
    this._episodeCache = new Map();

    this._episodeIndex = -1;
    /** @type {object | null} */
    this._episode = null; // { script, cues, segStartsMs, segments }
    /** @type {HTMLAudioElement | null} */
    this._audio = null;

    this._segIndex = -1;
    this._sentenceIndex = -1;

    // Active-shot state
    this._shot = null;
    this._shotStartS = 0;
    this._shotEndS = 0;
    this._anchor = new THREE.Vector3();
    this._anchorVel = new THREE.Vector3();
    this._lastAnchor = new THREE.Vector3();
    this._hasLastAnchor = false;
    this._anchorRadius = 0.3;
    this._desc = null;
    this._descIndex = 0;
    this._angle0 = 0;
    this._dir = new THREE.Vector3(1, 0, 0);
    this._rng = mulberry32(1);

    this._camPos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._scratchDir = new THREE.Vector3();
    this._mat = new THREE.Matrix4();
    this._worldMat = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._scaleV = new THREE.Vector3();

    this._buildUi();
  }

  /* ------------------------------ data loading ------------------------------ */

  async _loadManifest() {
    if (this._manifest) return this._manifest;
    const res = await fetch(`${BASE}manifest.json`);
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    this._manifest = await res.json();
    return this._manifest;
  }

  /**
   * @param {string} id e.g. "e01"
   */
  async _loadEpisode(id) {
    const cached = this._episodeCache.get(id);
    if (cached) return cached;
    const [scriptRes, cuesRes] = await Promise.all([
      fetch(`${BASE}${id}.script.json`),
      fetch(`${BASE}${id}.cues.json`),
    ]);
    if (!scriptRes.ok || !cuesRes.ok) {
      throw new Error(`episode ${id}: script ${scriptRes.status} cues ${cuesRes.status}`);
    }
    const script = await scriptRes.json();
    const cues = await cuesRes.json();

    // Map each segment (and each sentence) to a start time by walking the word
    // cues with the same tokenization the TTS used.
    let ptr = 0;
    const segments = [];
    for (const seg of script.segments) {
      const tokens = spokenTokens(seg.text);
      const startMs = cues[Math.min(ptr, cues.length - 1)]?.offsetMs ?? 0;
      const sentences = [];
      let sptr = ptr;
      for (const sen of splitSentences(seg.text)) {
        const n = spokenTokens(sen).length;
        sentences.push({
          text: sen,
          startMs: cues[Math.min(sptr, cues.length - 1)]?.offsetMs ?? 0,
        });
        sptr += n;
      }
      ptr += tokens.length;
      segments.push({ shot: seg.shot, text: seg.text, startMs, sentences });
    }
    const last = cues[cues.length - 1];
    const ep = {
      script,
      cues,
      segments,
      endMs: last ? last.offsetMs + last.durationMs + 1500 : 0,
    };
    this._episodeCache.set(id, ep);
    return ep;
  }

  /* --------------------------------- UI ------------------------------------ */

  _buildUi() {
    const css = `
    .doc-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center;
      justify-content: center; background: rgba(8, 12, 9, 0.72); backdrop-filter: blur(4px); }
    .doc-overlay[hidden] { display: none; }
    .doc-menu { max-height: 82vh; overflow-y: auto; width: min(560px, 92vw); background: #121a14;
      border: 1px solid #2c3b2f; border-radius: 12px; padding: 18px 22px; color: #dfe8dd;
      font: 14px/1.45 system-ui, sans-serif; }
    .doc-menu h2 { margin: 0 0 2px; font-size: 20px; color: #f0f5ea; }
    .doc-menu .doc-sub { margin: 0 0 14px; color: #93a892; font-size: 12.5px; }
    .doc-menu h3 { margin: 14px 0 6px; font-size: 12px; letter-spacing: 0.08em;
      text-transform: uppercase; color: #7fae7a; }
    .doc-ep-btn { display: block; width: 100%; text-align: left; margin: 3px 0; padding: 7px 10px;
      background: #1a251c; color: #dfe8dd; border: 1px solid #2c3b2f; border-radius: 8px;
      cursor: pointer; font: 13.5px system-ui, sans-serif; }
    .doc-ep-btn:hover { background: #24342a; border-color: #4a6b4a; }
    .doc-ep-btn .doc-ep-num { color: #7fae7a; margin-right: 8px; font-variant-numeric: tabular-nums; }
    .doc-menu-actions { display: flex; gap: 8px; margin-top: 14px; }
    .doc-menu-actions button { flex: 1; padding: 9px 0; border-radius: 8px; cursor: pointer;
      border: 1px solid #2c3b2f; font: 600 13.5px system-ui, sans-serif; }
    .doc-play-all { background: #2f5233; color: #eaf5e6; }
    .doc-play-all:hover { background: #3a6640; }
    .doc-menu-close { background: #1a251c; color: #c9d6c6; }
    .doc-menu-close:hover { background: #24342a; }
    .doc-player { position: fixed; left: 0; right: 0; bottom: 0; z-index: 55; pointer-events: none;
      display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 0 16px 18px; }
    .doc-player[hidden] { display: none; }
    .doc-caption { max-width: min(880px, 92vw); text-align: center; color: #f4f7ef;
      font: 500 clamp(15px, 2.1vw, 21px)/1.45 Georgia, 'Times New Roman', serif;
      text-shadow: 0 1px 3px rgba(0,0,0,0.9), 0 0 18px rgba(0,0,0,0.55);
      background: rgba(10, 14, 10, 0.42); border-radius: 10px; padding: 8px 16px; }
    .doc-caption:empty { display: none; }
    .doc-controls { pointer-events: auto; display: flex; align-items: center; gap: 8px;
      background: rgba(14, 20, 15, 0.82); border: 1px solid #2c3b2f; border-radius: 999px;
      padding: 6px 12px; }
    .doc-controls button { background: none; border: none; color: #dfe8dd; cursor: pointer;
      font: 15px system-ui, sans-serif; padding: 4px 8px; border-radius: 6px; }
    .doc-controls button:hover { background: #24342a; }
    .doc-progress { width: 180px; height: 4px; background: #24342a; border-radius: 2px;
      overflow: hidden; }
    .doc-progress > div { height: 100%; width: 0%; background: #7fae7a; }
    .doc-title-card { position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
      z-index: 55; pointer-events: none; text-align: center; color: #f0f5ea;
      font: 600 13px/1.4 system-ui, sans-serif; background: rgba(14, 20, 15, 0.78);
      border: 1px solid #2c3b2f; border-radius: 10px; padding: 6px 16px;
      text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
    .doc-title-card[hidden] { display: none; }
    .doc-title-card .doc-title-season { display: block; font-weight: 400; font-size: 11px;
      color: #93a892; }
    `;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    this._menuEl = document.createElement("div");
    this._menuEl.className = "doc-overlay";
    this._menuEl.hidden = true;
    document.body.appendChild(this._menuEl);
    this._menuEl.addEventListener("click", (e) => {
      if (e.target === this._menuEl) this.closeMenu();
    });

    this._playerEl = document.createElement("div");
    this._playerEl.className = "doc-player";
    this._playerEl.hidden = true;
    this._playerEl.innerHTML = `
      <div class="doc-caption"></div>
      <div class="doc-controls">
        <button type="button" data-doc="prev" title="Previous episode">⏮</button>
        <button type="button" data-doc="pause" title="Pause / resume">⏸</button>
        <button type="button" data-doc="next" title="Next episode">⏭</button>
        <div class="doc-progress"><div></div></div>
        <button type="button" data-doc="menu" title="Episodes">☰</button>
        <button type="button" data-doc="exit" title="Exit documentary">✕</button>
      </div>`;
    document.body.appendChild(this._playerEl);
    this._captionEl = this._playerEl.querySelector(".doc-caption");
    this._progressEl = this._playerEl.querySelector(".doc-progress > div");
    this._pauseBtn = this._playerEl.querySelector('[data-doc="pause"]');
    this._playerEl.addEventListener("click", (e) => {
      const btn = e.target instanceof Element ? e.target.closest("[data-doc]") : null;
      if (!btn) return;
      const act = btn.getAttribute("data-doc");
      if (act === "exit") this.stop();
      else if (act === "pause") this.togglePause();
      else if (act === "next") this.nextEpisode();
      else if (act === "prev") this.prevEpisode();
      else if (act === "menu") this.openMenu();
    });

    this._titleEl = document.createElement("div");
    this._titleEl.className = "doc-title-card";
    this._titleEl.hidden = true;
    document.body.appendChild(this._titleEl);

    document.addEventListener("keydown", (e) => {
      if (!this.active && this._menuEl.hidden) return;
      if (e.code === "Escape") {
        e.preventDefault();
        if (!this._menuEl.hidden) this.closeMenu();
        else this.stop();
      } else if (e.code === "Space" && this.active) {
        const tag = document.activeElement?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && tag !== "BUTTON") {
          e.preventDefault();
          this.togglePause();
        }
      }
    });
  }

  async openMenu() {
    let manifest;
    try {
      manifest = await this._loadManifest();
    } catch (e) {
      console.warn("[documentary] manifest unavailable", e);
      this._menuEl.innerHTML = `<div class="doc-menu"><h2>Documentary</h2>
        <p class="doc-sub">Narration files are missing. Run
        <code>python docs/documentary/generate-audio.py</code> and reload.</p>
        <div class="doc-menu-actions"><button type="button" class="doc-menu-close">Close</button></div></div>`;
      this._menuEl.hidden = false;
      this._menuEl.querySelector(".doc-menu-close")?.addEventListener("click", () => this.closeMenu());
      return;
    }
    const bySeason = new Map();
    for (const ep of manifest.episodes) {
      if (!bySeason.has(ep.season)) bySeason.set(ep.season, []);
      bySeason.get(ep.season).push(ep);
    }
    const menu = document.createElement("div");
    menu.className = "doc-menu";
    let html = `<h2>A World in the Grass</h2>
      <p class="doc-sub">A ${manifest.episodes.length}-part documentary · narrated</p>`;
    for (const [season, eps] of bySeason) {
      html += `<h3>${season}</h3>`;
      for (const ep of eps) {
        html += `<button type="button" class="doc-ep-btn" data-ep="${ep.number - 1}">
          <span class="doc-ep-num">${String(ep.number).padStart(2, "0")}</span>${ep.title}</button>`;
      }
    }
    html += `<div class="doc-menu-actions">
      <button type="button" class="doc-play-all">▶ Play all</button>
      <button type="button" class="doc-menu-close">Close</button></div>`;
    menu.innerHTML = html;
    this._menuEl.replaceChildren(menu);
    this._menuEl.hidden = false;
    menu.querySelectorAll(".doc-ep-btn").forEach((b) =>
      b.addEventListener("click", () => {
        this.closeMenu();
        void this.startEpisode(Number(b.getAttribute("data-ep")));
      })
    );
    menu.querySelector(".doc-play-all")?.addEventListener("click", () => {
      this.closeMenu();
      void this.startEpisode(0);
    });
    menu.querySelector(".doc-menu-close")?.addEventListener("click", () => this.closeMenu());
  }

  closeMenu() {
    this._menuEl.hidden = true;
  }

  /* ------------------------------- playback -------------------------------- */

  /**
   * @param {number} index 0-based episode index
   */
  async startEpisode(index) {
    const manifest = await this._loadManifest().catch(() => null);
    if (!manifest) return;
    if (index < 0 || index >= manifest.episodes.length) {
      this.stop();
      return;
    }
    const meta = manifest.episodes[index];
    let ep;
    try {
      ep = await this._loadEpisode(meta.id);
    } catch (e) {
      console.warn("[documentary] failed to load", meta.id, e);
      return;
    }

    this._teardownAudio();
    this._episodeIndex = index;
    this._episode = ep;
    this._segIndex = -1;
    this._sentenceIndex = -1;
    this._rng = mulberry32(0x5eed + index * 977);

    if (!this.active) {
      this.active = true;
      this.onStart();
    }

    this._titleEl.innerHTML = `${meta.title}
      <span class="doc-title-season">${meta.season} · Episode ${meta.number} of ${manifest.episodes.length}</span>`;
    this._titleEl.hidden = false;
    this._playerEl.hidden = false;
    if (this._captionEl) this._captionEl.textContent = "";
    if (this._pauseBtn) this._pauseBtn.textContent = "⏸";

    const audio = new Audio(`${BASE}${meta.id}.mp3`);
    audio.preload = "auto";
    this._audio = audio;
    audio.addEventListener("ended", () => {
      if (this._audio === audio) void this.startEpisode(this._episodeIndex + 1);
    });
    audio.addEventListener("error", () => {
      if (this._audio === audio) {
        console.warn("[documentary] audio failed for", meta.id);
        this.stop();
      }
    });
    void audio.play().catch((e) => console.warn("[documentary] audio play blocked", e));
  }

  _teardownAudio() {
    if (this._audio) {
      this._audio.pause();
      this._audio.src = "";
      this._audio = null;
    }
  }

  togglePause() {
    if (!this._audio) return;
    if (this._audio.paused) {
      void this._audio.play().catch(() => {});
      if (this._pauseBtn) this._pauseBtn.textContent = "⏸";
    } else {
      this._audio.pause();
      if (this._pauseBtn) this._pauseBtn.textContent = "▶";
    }
  }

  nextEpisode() {
    void this.startEpisode(this._episodeIndex + 1);
  }

  prevEpisode() {
    void this.startEpisode(Math.max(0, this._episodeIndex - 1));
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this._teardownAudio();
    this._episode = null;
    this._shot = null;
    this._desc = null;
    this._playerEl.hidden = true;
    this._titleEl.hidden = true;
    this.closeMenu();
    this.onStop();
  }

  /* ----------------------------- camera engine ------------------------------ */

  /**
   * Drive camera + captions. Call once per frame from the animate loop.
   * @param {number} dt seconds
   */
  updateCamera(dt) {
    if (!this.active) return;
    if (!this.canControl()) {
      this.stop();
      return;
    }
    const ep = this._episode;
    const audio = this._audio;
    if (!ep || !audio) return;

    const nowMs = audio.currentTime * 1000;

    // Progress bar
    if (this._progressEl && ep.endMs > 0) {
      this._progressEl.style.width = `${Math.min(100, (nowMs / ep.endMs) * 100)}%`;
    }

    // Segment lookup
    const segs = ep.segments;
    let si = this._segIndex;
    while (si + 1 < segs.length && segs[si + 1].startMs <= nowMs) si++;
    if (si < 0) si = 0;
    if (si !== this._segIndex) {
      this._segIndex = si;
      this._sentenceIndex = -1;
      this._beginShot(segs[si], si + 1 < segs.length ? segs[si + 1].startMs : ep.endMs);
    }

    // Caption: current sentence of current segment
    const seg = segs[si];
    if (seg && this._captionEl) {
      let ci = 0;
      for (let i = 0; i < seg.sentences.length; i++) {
        if (seg.sentences[i].startMs <= nowMs) ci = i;
      }
      if (ci !== this._sentenceIndex) {
        this._sentenceIndex = ci;
        this._captionEl.textContent = seg.sentences[ci]?.text ?? "";
      }
    }

    // Hide the title card after the cold open settles
    if (!this._titleEl.hidden && nowMs > 8000) this._titleEl.hidden = true;

    this._applyShot(nowMs, dt);
  }

  /**
   * @param {object} seg
   * @param {number} endMs
   */
  _beginShot(seg, endMs) {
    this._shot = seg.shot ?? { type: "wide", subject: "field", notes: "" };
    this._shotStartS = seg.startMs / 1000;
    this._shotEndS = Math.max(this._shotStartS + 2, endMs / 1000);
    this._angle0 = this._rng() * Math.PI * 2;
    this._hasLastAnchor = false;
    // Honor the script's direction ("plunge down…", "rise through…"); only
    // pick randomly when the notes don't say.
    this._vDir = verticalHint(this._shot);
    this._craneUp = this._vDir !== 0 ? this._vDir > 0 : this._rng() < 0.6;

    this._desc = this.getSubject(this._shot.subject) ?? null;
    if (this._desc?.kind === "inst") {
      this._descIndex = Math.floor(this._rng() * Math.max(1, this._desc.count));
    }
    this._sampleAnchor(0);
    // Fixed direction for this shot (dolly axes, closeup approach, etc.)
    const a = this._rng() * Math.PI * 2;
    this._dir.set(Math.cos(a), 0, Math.sin(a));
  }

  /**
   * Refresh this._anchor / this._anchorRadius from the live descriptor.
   * @param {number} dt
   */
  _sampleAnchor(dt) {
    const d = this._desc;
    const spread = this.getSpread();
    if (!d || d.kind === "sky") {
      // Sky shots anchor on the field center at canopy height.
      this._anchor.set(0, 4, 0);
      this._anchorRadius = spread * 0.5;
      return;
    }
    if (d.kind === "point") {
      this._anchor.set(d.x, d.y, d.z);
      this._anchorRadius = d.radius;
      return;
    }
    if (d.kind === "group") {
      d.group.updateMatrixWorld(true);
      const p = new THREE.Vector3().setFromMatrixPosition(d.group.matrixWorld);
      this._updateAnchorMotion(p, dt);
      this._anchorRadius = d.radius;
      return;
    }
    if (d.kind === "inst") {
      const mesh = d.mesh;
      if (this._descIndex >= mesh.count) this._descIndex = 0;
      mesh.updateMatrixWorld(true);
      mesh.getMatrixAt(this._descIndex, this._mat);
      this._worldMat.multiplyMatrices(mesh.matrixWorld, this._mat);
      this._worldMat.decompose(this._camPos, this._quat, this._scaleV);
      this._updateAnchorMotion(this._camPos, dt);
      this._anchorRadius = Math.max(
        d.radius ?? 0,
        this._scaleV.x,
        this._scaleV.y,
        this._scaleV.z,
        0.03
      );
    }
  }

  /**
   * @param {THREE.Vector3} p
   * @param {number} dt
   */
  _updateAnchorMotion(p, dt) {
    if (this._hasLastAnchor && dt > 0) {
      this._anchorVel.subVectors(p, this._lastAnchor).divideScalar(dt);
      // Ignore teleports (respawns) — keep previous velocity.
      if (this._anchorVel.lengthSq() > 400) this._anchorVel.set(0, 0, 0);
    }
    this._lastAnchor.copy(this._anchor);
    this._anchor.copy(p);
    this._hasLastAnchor = true;
  }

  /**
   * @param {number} nowMs
   * @param {number} dt
   */
  _applyShot(nowMs, dt) {
    const shot = this._shot;
    if (!shot) return;
    this._sampleAnchor(dt);

    const nowS = nowMs / 1000;
    const t = Math.max(0, nowS - this._shotStartS);
    const dur = Math.max(2, this._shotEndS - this._shotStartS);
    const t01 = Math.min(1, t / dur);

    const A = this._anchor;
    const r = this._anchorRadius;
    const cam = this._camPos;
    const look = this._look;
    const spread = this.getSpread();
    const isSky = this._desc?.kind === "sky" || SKY_SUBJECTS.has(shot.subject);

    switch (isSky ? "sky" : shot.type) {
      case "sky": {
        // Elevated vantage, slow yaw, pitched toward the sky.
        const R = Math.max(6, spread * 0.12);
        const a = this._angle0 + t * 0.04;
        cam.set(Math.cos(a) * R * 0.3, R * 0.55, Math.sin(a) * R * 0.3);
        look.set(
          cam.x + Math.cos(a) * 30,
          cam.y + 18 + Math.sin(t * 0.1) * 6,
          cam.z + Math.sin(a) * 30
        );
        break;
      }
      case "wide": {
        const R = Math.min(spread * 0.9, Math.max(6, r * 14 + 4));
        const a = this._angle0 + t * 0.05;
        cam.set(A.x + Math.cos(a) * R, A.y + R * 0.55, A.z + Math.sin(a) * R);
        look.copy(A);
        break;
      }
      case "orbit": {
        const R = r * 3.2 + 0.35;
        const a = this._angle0 + t * 0.4;
        cam.set(A.x + Math.cos(a) * R, A.y + r * 1.1 + 0.12, A.z + Math.sin(a) * R);
        look.copy(A);
        break;
      }
      case "track": {
        const back = this._anchorVel.lengthSq() > 1e-6
          ? this._scratchDir.copy(this._anchorVel).setY(0).normalize()
          : this._dir;
        const R = r * 4 + 0.3;
        cam.set(
          A.x - back.x * R + this._dir.z * R * 0.4,
          A.y + r * 1.6 + 0.12,
          A.z - back.z * R - this._dir.x * R * 0.4
        );
        look.set(A.x + back.x * r * 2, A.y + r * 0.4, A.z + back.z * r * 2);
        break;
      }
      case "closeup": {
        const R = (r * 4 + 0.4) * (1 - t01 * 0.72);
        cam.set(
          A.x + this._dir.x * R,
          A.y + r * 0.7 + R * 0.22,
          A.z + this._dir.z * R
        );
        look.copy(A);
        break;
      }
      case "low": {
        const R = r * 3 + 0.3;
        const terrain = this.getTerrain();
        const gy = terrain ? terrain.getHeightBilinear(A.x + this._dir.x * R, A.z + this._dir.z * R) : 0;
        cam.set(A.x + this._dir.x * R, gy + 0.06 + r * 0.2, A.z + this._dir.z * R);
        // "tilts up/down" in the notes becomes a slow tilt across the shot.
        const tilt = this._vDir === 0 ? 0.8 : 0.15 + 1.3 * (this._vDir > 0 ? t01 : 1 - t01);
        look.set(A.x, A.y + r * tilt, A.z);
        break;
      }
      case "topdown": {
        const h0 = r * 7 + 1.2;
        const h1 = r * 3 + 0.5;
        const k = this._vDir > 0 ? 1 - t01 : t01; // default: settle downward
        cam.set(A.x + 0.001, A.y + h0 + (h1 - h0) * k, A.z);
        look.copy(A);
        break;
      }
      case "dolly": {
        const L = r * 10 + 3;
        const s = (t01 - 0.5) * L;
        const R = r * 3 + 0.6;
        const vOff = this._vDir * (t01 - 0.5) * Math.min(4, r * 3 + 1.5);
        cam.set(
          A.x + this._dir.z * R + this._dir.x * s,
          A.y + r * 1.2 + 0.2 + vOff,
          A.z - this._dir.x * R + this._dir.z * s
        );
        look.copy(A);
        break;
      }
      case "flythrough": {
        const L = Math.min(spread, r * 26 + 10);
        const s = (t01 - 0.5) * L;
        const vOff = this._vDir * (t01 - 0.5) * Math.min(4, r * 2 + 1);
        cam.set(
          A.x + this._dir.x * s,
          A.y + r * 0.9 + 0.25 + vOff,
          A.z + this._dir.z * s
        );
        look.set(
          A.x + this._dir.x * (s + L * 0.25),
          A.y + r * 0.6,
          A.z + this._dir.z * (s + L * 0.25)
        );
        break;
      }
      case "pan": {
        const R = r * 4 + 0.8;
        cam.set(A.x + this._dir.x * R, A.y + r * 1.3 + 0.3, A.z + this._dir.z * R);
        const sweep = (t01 - 0.5) * 1.2;
        const c = Math.cos(sweep);
        const s = Math.sin(sweep);
        look.set(
          A.x + (-this._dir.x * c - -this._dir.z * s) * R,
          A.y + r * 0.4,
          A.z + (-this._dir.z * c + -this._dir.x * s) * R
        );
        break;
      }
      case "crane": {
        const hLow = r * 0.8 + 0.15;
        const hHigh = Math.min(spread * 0.5, r * 9 + 5);
        const k = this._craneUp ? t01 : 1 - t01;
        const R = r * 2.5 + 0.5 + k * 2.5;
        cam.set(
          A.x + this._dir.x * R,
          A.y + hLow + (hHigh - hLow) * k,
          A.z + this._dir.z * R
        );
        look.copy(A);
        break;
      }
      case "cutaway":
      default: {
        const R = r * 2.6 + 0.4;
        const a = this._angle0 + t * 0.3;
        cam.set(A.x + Math.cos(a) * R, A.y + r * 0.9 + 0.15, A.z + Math.sin(a) * R);
        look.copy(A);
        break;
      }
    }

    // Keep inside the world and above the ground (and above water for dry subjects).
    const lim = spread * 1.05;
    cam.x = THREE.MathUtils.clamp(cam.x, -lim, lim);
    cam.z = THREE.MathUtils.clamp(cam.z, -lim, lim);
    const terrain = this.getTerrain();
    if (terrain) {
      const gy = terrain.getHeightBilinear(cam.x, cam.z) + GROUND_CLEARANCE;
      if (cam.y < gy) cam.y = gy;
      if (!WET_SUBJECTS.has(this._shot.subject)) {
        const wy = terrain.getWaterSurfaceHeightBilinear?.(cam.x, cam.z);
        if (typeof wy === "number" && cam.y < wy + 0.05 && gy < wy) {
          cam.y = wy + 0.05;
        }
      }
    }

    this.camera.position.copy(cam);
    this.camera.lookAt(look);
  }
}
