import * as THREE from "three";

/**
 * Procedural loop + THREE.PositionalAudio: dry equal-power pan + distance (no HRTF “room” tail).
 * Listener on camera; source position synced to the bee each frame.
 */
export class BeeBuzz {
  constructor() {
    /** @type {THREE.AudioListener | null} */
    this.listener = null;
    /** @type {THREE.PositionalAudio | null} */
    this.positional = null;
    /** @type {THREE.Object3D | null} */
    this._beeRoot = null;
    this._tmpWorld = new THREE.Vector3();
    /** @type {OscillatorNode[]} */
    this._oscs = [];
  }

  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Scene} scene
   * @param {THREE.Object3D} beeRoot
   */
  init(camera, scene, beeRoot) {
    if (this.listener) return;

    this._beeRoot = beeRoot;

    this.listener = new THREE.AudioListener();
    camera.add(this.listener);

    this.positional = new THREE.PositionalAudio(this.listener);
    /** HRTF colors the sound like space/room; equal-power is dry L/R + distance only. */
    this.positional.panner.panningModel = "equalpower";
    this.positional.setRefDistance(0.55);
    this.positional.setRolloffFactor(1.25);
    this.positional.setMaxDistance(140);
    this.positional.setDistanceModel("inverse");
    this.positional.setVolume(0);

    const ctx = this.listener.context;
    const merger = ctx.createGain();
    merger.gain.value = 0.044;

    /** Detuned saws — lower fundamentals = deeper buzz (still above sub “drone”). */
    const oscA = ctx.createOscillator();
    oscA.type = "sawtooth";
    oscA.frequency.value = 166;

    const oscB = ctx.createOscillator();
    oscB.type = "sawtooth";
    oscB.frequency.value = 173;

    oscA.connect(merger);
    oscB.connect(merger);

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 88;
    hp.Q.value = 0.65;
    merger.connect(hp);

    const peak = ctx.createBiquadFilter();
    peak.type = "peaking";
    peak.frequency.value = 198;
    peak.Q.value = 0.85;
    peak.gain.value = 3.5;
    hp.connect(peak);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1850;
    lp.Q.value = 0.72;
    peak.connect(lp);

    const bufLen = Math.floor(ctx.sampleRate * 0.25);
    const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) nd[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const nGain = ctx.createGain();
    nGain.gain.value = 0.011;
    const nBp = ctx.createBiquadFilter();
    nBp.type = "bandpass";
    nBp.frequency.value = 265;
    nBp.Q.value = 1.25;
    noise.connect(nGain);
    nGain.connect(nBp);
    nBp.connect(lp);

    this.positional.setNodeSource(lp);

    oscA.start();
    oscB.start();
    noise.start();

    this._oscs.push(oscA, oscB);

    scene.add(this.positional);
  }

  /** Browsers start AudioContext suspended until a user gesture. */
  async ensureContext() {
    const ctx = this.listener?.context;
    if (!ctx) return;
    if (ctx.state === "suspended") await ctx.resume();
  }

  /**
   * @param {object} o
   * @param {boolean} o.visible Bee rig visible (any bee mode).
   * @param {number} o.masterVolume 0–1
   * @param {boolean} o.muted
   */
  update(o) {
    if (!this.positional || !this._beeRoot) return;
    this._beeRoot.getWorldPosition(this._tmpWorld);
    this.positional.position.copy(this._tmpWorld);

    const v =
      o.visible && !o.muted
        ? THREE.MathUtils.clamp(o.masterVolume, 0, 1) * 0.3
        : 0;
    this.positional.setVolume(v);
  }
}
