import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { sanitizeImportedModel, upgradeLegacyMaterials } from "./fbx-import-utils.js";

/** Walking rig with embedded skin + clip (Meshy). */
export const SOLDIER_WALK_FBX_URL =
  "/models/soldier/Meshy_AI_Frontline_Soldier_biped_Animation_Walking_withSkin.fbx";

/**
 * World height for the biped after normalization — one inch in meter-scale worlds (1 unit ≈ 1 m).
 * Grass blades (~1.2 units) read as towering over the figure.
 */
const TARGET_HEIGHT_INCH = 0.0254;

/** Comfortable walk speed in world units/s at this scale (still tiny steps vs the field). */
const WALK_SPEED = 1.05;
const SPRINT_MUL = 1.75;

/**
 * Meshy frontline soldier — first-person ground mode, ~1″ tall in scene units.
 */
export class SoldierPilot {
  /**
   * @param {THREE.Scene} scene
   * @param {number} fieldSpread half-extent of playable square (matches grass field).
   */
  constructor(scene, fieldSpread) {
    this.scene = scene;
    this.fieldSpread = fieldSpread;

    this.root = new THREE.Group();
    this.root.name = "SoldierPilot";
    this.root.visible = false;

    this.cameraMount = new THREE.Object3D();
    this.cameraMount.name = "SoldierCameraMount";
    this.root.add(this.cameraMount);

    /** @type {THREE.Object3D | null} */
    this.model = null;
    /** @type {THREE.AnimationMixer | null} */
    this.mixer = null;
    /** @type {THREE.AnimationAction | null} */
    this.walkAction = null;

    this.loaded = false;

    /** Eye offset in mount space (set after load). */
    this._eye = new THREE.Vector3(0, 0.018, 0.04);

    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._tpSmoothed = new THREE.Vector3();
    /** @type {boolean} */
    this._tpCamInited = false;

    this.scene.add(this.root);
  }

  /**
   * @returns {Promise<this>}
   */
  async load() {
    const loader = new FBXLoader();
    const fbx = await loader.loadAsync(SOLDIER_WALK_FBX_URL);
    sanitizeImportedModel(fbx);
    upgradeLegacyMaterials(fbx);
    this._normalizeModelSize(fbx, TARGET_HEIGHT_INCH);
    fbx.rotation.y = Math.PI;
    this.model = fbx;
    this.root.add(fbx);

    const box = new THREE.Box3().setFromObject(fbx);
    const eyeY = Math.max((box.max.y - box.min.y) * 0.88, TARGET_HEIGHT_INCH * 0.35);
    const fwd = Math.max((box.max.z - box.min.z) * 0.22, 0.008);
    this._eye.set(0, eyeY, fwd);
    this.cameraMount.position.copy(this._eye);

    this.mixer = new THREE.AnimationMixer(fbx);
    const clips = fbx.animations ?? [];
    let clip = clips.find((c) => /walk|run/i.test(c.name));
    if (!clip) clip = clips.find((c) => /idle/i.test(c.name));
    if (!clip && clips.length > 0) clip = clips[0];
    if (clip) {
      this.walkAction = this.mixer.clipAction(clip);
      this.walkAction.setLoop(THREE.LoopRepeat, Infinity);
      this.walkAction.clampWhenFinished = false;
    }

    this.loaded = true;
    return this;
  }

  /**
   * @param {THREE.Object3D} obj
   * @param {number} targetSize
   */
  _normalizeModelSize(obj, targetSize) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
    const s = targetSize / maxDim;
    obj.scale.setScalar(s);
    box.setFromObject(obj);
    const center = new THREE.Vector3();
    box.getCenter(center);
    obj.position.sub(center);
    box.setFromObject(obj);
    obj.position.y -= box.min.y;
  }

  /**
   * @param {THREE.PerspectiveCamera} cam
   */
  attachCamera(cam) {
    this.cameraMount.attach(cam);
    cam.position.set(0, 0, 0);
    cam.rotation.set(0, 0, 0);
  }

  /**
   * @param {THREE.PerspectiveCamera} cam
   * @param {THREE.Scene} scene
   */
  detachCamera(cam, scene) {
    scene.attach(cam);
  }

  /**
   * Third-person chase: camera lives on the scene (not the head mount).
   * @param {THREE.PerspectiveCamera} cam
   * @param {THREE.Scene} scene
   */
  prepareThirdPersonCamera(cam, scene) {
    scene.attach(cam);
    this._tpCamInited = false;
  }

  /**
   * Smooth chase behind the figure; mouse pitch biases look-at height.
   * @param {THREE.PerspectiveCamera} cam
   * @param {THREE.Scene} scene
   * @param {THREE.Euler} euler YXZ (yaw / pitch from mouse)
   * @param {number} dt
   */
  updateThirdPersonCamera(cam, scene, euler, dt) {
    if (cam.parent !== scene) {
      scene.attach(cam);
      this._tpCamInited = false;
    }

    const yaw = euler.y;
    const pitch = euler.x;
    const p = this.root.position;

    this._tmp.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const dist = 0.11;
    const lift = 0.038 + Math.sin(pitch) * 0.028;
    this._tmp2.set(p.x - this._tmp.x * dist, p.y + lift, p.z - this._tmp.z * dist);

    const k = 1 - Math.exp(-dt * 15);
    if (!this._tpCamInited) {
      this._tpSmoothed.copy(this._tmp2);
      this._tpCamInited = true;
    } else {
      this._tpSmoothed.lerp(this._tmp2, Math.min(1, k));
    }
    cam.position.copy(this._tpSmoothed);

    const aimY = p.y + 0.013 + Math.sin(pitch) * 0.022;
    cam.lookAt(p.x, aimY, p.z);
  }

  /**
   * @param {boolean} v
   */
  setVisible(v) {
    this.root.visible = v;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} yawRadians world Y rotation for the body (mouse look yaw)
   */
  placeOnGround(x, z, yawRadians) {
    const bound = this.fieldSpread * 0.98;
    this.root.position.x = THREE.MathUtils.clamp(x, -bound, bound);
    this.root.position.z = THREE.MathUtils.clamp(z, -bound, bound);
    this.root.position.y = 0;
    this.root.rotation.set(0, yawRadians, 0);
  }

  /**
   * @param {number} dt
   * @param {Set<string>} keys
   * @param {number} yaw world yaw (radians) — mouse horizontal look
   */
  updateWalking(dt, keys, yaw) {
    if (!this.model || !this.mixer) return;

    this.root.rotation.y = yaw;

    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const v = new THREE.Vector3();
    if (keys.has("KeyW")) v.add(forward);
    if (keys.has("KeyS")) v.sub(forward);
    if (keys.has("KeyA")) v.sub(right);
    if (keys.has("KeyD")) v.add(right);

    const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const moving = v.lengthSq() > 1e-6;
    if (moving) {
      v.normalize().multiplyScalar(WALK_SPEED * (sprint ? SPRINT_MUL : 1) * dt);
    }

    const p = this.root.position;
    p.add(v);
    const bound = this.fieldSpread * 0.98;
    p.x = THREE.MathUtils.clamp(p.x, -bound, bound);
    p.z = THREE.MathUtils.clamp(p.z, -bound, bound);
    p.y = 0;

    if (this.walkAction) {
      this.walkAction.setEffectiveTimeScale(moving ? (sprint ? 1.35 : 1) : 0);
      if (!this.walkAction.isRunning()) this.walkAction.play();
    }
    this.mixer.update(dt);
  }

  /**
   * @param {THREE.Vector3} [target]
   */
  getFootPosition(target = new THREE.Vector3()) {
    target.set(this.root.position.x, 0, this.root.position.z);
    return target;
  }
}
