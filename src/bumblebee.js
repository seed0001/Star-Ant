import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { sanitizeImportedModel, upgradeLegacyMaterials } from "./fbx-import-utils.js";

/** Flying mesh (Meshy). */
export const BUMBLEBEE_FBX_URL =
  "/models/bumblebee/Meshy_AI_a_bumble_bee_with_det_0407204530_texture.fbx";

/** Walking / skinned animation (Meshy quadruped + walk clip). */
export const BUMBLEBEE_WALK_FBX_URL =
  "/models/bumblebee_walk/Meshy_AI_a_bumble_bee_with_det_quadruped_model_Animation_Walking_withSkin.fbx";

export const FlyMode = {
  FREE: "free",
  BEE_AUTO: "bee_auto",
  /** Same autopilot as BEE_AUTO, but camera orbits / pans around the bee (third-person). */
  BEE_ORBIT: "bee_orbit",
  BEE_DRONE: "bee_drone",
  /**
   * First-person on the ground as a ~1″-tall soldier; the field reads as a vast world.
   * Exit returns to free flight; position + free camera persist in localStorage.
   */
  SOLDIER: "soldier",
};

/** Bee body locomotion when in drone mode (flying vs walking surfaces). */
export const BeeLocomotion = {
  FLYING: "flying",
  WALK_GROUND: "walk_ground",
  WALK_FLOWER: "walk_flower",
  WALK_TREE: "walk_tree",
};

/** Visual scale targets (world units); tweak to match each other. */
const TARGET_FLY_SIZE = 0.2;
const TARGET_WALK_SIZE = 0.21;

const WALK_SPEED_GROUND = 1.85;
const WALK_SPEED_SURFACE = 1.45;
/** Drone walking on ground (YXZ pitch): lifts nose toward sky / top of frame, abdomen lower. */
const GROUND_WALK_BODY_PITCH = 0.52;
const FLOWER_WALK_RADIUS = 0.42;
const TREE_WALK_SLACK = 0.12;

/** Vertex shader for bee fuzz billboard planes. */
const BEE_FUZZ_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Animated UV warp + ring falloff — reads as heavy motion blur / out-of-focus fuzz. */
const BEE_FUZZ_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uWing;

void main() {
  vec2 uv = vUv - 0.5;
  float wing = step(0.5, uWing);
  float warpAmt = mix(0.2, 0.32, wing);
  vec2 w = uv * mix(1.0, 1.55, wing);
  w += warpAmt * vec2(
    sin(w.y * 36.0 + uTime * 32.0),
    cos(w.x * 34.0 + uTime * 29.0)
  );
  w += 0.11 * vec2(
    sin(w.x * 72.0 + uTime * 41.0) * cos(w.y * 68.0 + uTime * 35.0),
    cos(w.y * 70.0 + uTime * 38.0) * sin(w.x * 66.0 + uTime * 33.0)
  );
  w += 0.06 * vec2(
    sin(w.x * 130.0 + uTime * 55.0),
    sin(w.y * 125.0 + uTime * 52.0)
  );
  float r = length(w);
  float inner = mix(0.1, 0.04, wing);
  float outer = mix(0.5, 0.42, wing);
  float a = smoothstep(0.52, 0.0, r) * smoothstep(inner, outer, r);
  float fuzz =
    sin(w.x * 110.0 + uTime * 48.0) *
    sin(w.y * 105.0 + uTime * 44.0) *
    sin((w.x + w.y) * 55.0 + uTime * 36.0);
  fuzz = 0.55 + 0.45 * (0.5 + 0.5 * fuzz);
  a *= fuzz * mix(0.95, 1.18, wing);
  float rgb = 0.02 * sin(w.x * 180.0 + uTime * 60.0);
  vec3 col = vec3(1.0 + rgb, 0.96, 0.9) * (0.72 + 0.28 * fuzz);
  float outA = a * mix(0.95, 1.12, wing);
  gl_FragColor = vec4(col, clamp(outA, 0.0, 1.0));
}
`;

/**
 * Heuristic: FBX bone names that are likely bee legs (Meshy / Mixamo-ish).
 * @param {string} name
 * @returns {boolean}
 */
function isLikelyLegBoneName(name) {
  const n = name.toLowerCase();
  if (
    /wing|eye|antenna|mandible|proboscis|stinger|ik|pole|target|helper|endpoint|camera|root|spine|neck|head|abdomen|thorax|pelvis|chest|body|defmesh|geo|mesh/i.test(
      n
    )
  ) {
    return false;
  }
  return /leg|thigh|calf|femur|tibia|shin|ankle|foot|feet|digit|toe|meta|knee|patella|canon|_l_|_r_|\.l\.|\.r\.| left| right|l_|r_/i.test(
    n
  );
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function isLikelyLegMeshName(name) {
  const n = name.toLowerCase();
  if (/wing|eye|antenna|fuzz|bee/i.test(n)) return false;
  return /leg|thigh|calf|feet|foot|shin|tibia|femur|digit|toe/i.test(n);
}

/**
 * -1 = left, +1 = right, 0 = unknown (symmetric sway).
 * @param {string} name
 * @returns {-1 | 0 | 1}
 */
function inferLegSide(name) {
  const n = name.toLowerCase();
  const left =
    /(^|[_\s.\-])(l|left)([_\s.\-]|$)/i.test(n) ||
    /^l[_\s\-]/i.test(n) ||
    /\.l(\.|_)/i.test(n) ||
    /_l$/i.test(n);
  const right =
    /(^|[_\s.\-])(r|right)([_\s.\-]|$)/i.test(n) ||
    /^r[_\s\-]/i.test(n) ||
    /\.r(\.|_)/i.test(n) ||
    /_r$/i.test(n);
  if (left && !right) return -1;
  if (right && !left) return 1;
  return 0;
}

/**
 * Single hero bumblebee: camera rides on a mount for first-person flight.
 * Walking rig + AnimationMixer when landed on ground, flowers, or tree bark.
 */
export class BumblebeePilot {
  /**
   * @param {THREE.Scene} scene
   * @param {number} fieldSpread half-extent of playable square (matches grass field).
   */
  constructor(scene, fieldSpread) {
    this.scene = scene;
    this.fieldSpread = fieldSpread;
    this.root = new THREE.Group();
    this.root.name = "BumblebeePilot";
    this.root.visible = false;

    this.cameraMount = new THREE.Object3D();
    this.cameraMount.name = "BeeCameraMount";
    this.root.add(this.cameraMount);

    /** @type {THREE.Object3D | null} */
    this.flyingModel = null;
    /** @type {THREE.Object3D | null} */
    this.walkingModel = null;
    /** @type {THREE.AnimationMixer | null} */
    this.mixer = null;
    /** @type {THREE.AnimationAction | null} */
    this.walkAction = null;

    this.loaded = false;
    /** @type {typeof BeeLocomotion[keyof typeof BeeLocomotion]} */
    this.locomotion = BeeLocomotion.FLYING;

    /** Eye offset for flying mesh (local). */
    this._eyeFly = new THREE.Vector3(0, 0.09, 0.08);
    /** Eye offset for walking mesh (local), set after load. */
    this._eyeWalk = new THREE.Vector3(0, 0.1, 0.06);

    /** @type {{ kind: string, x?: number, z?: number, y?: number, r?: number, treeX?: number, treeZ?: number, trunkR?: number } | null} */
    this._anchor = null;

    this.autopilotPhase = Math.random() * Math.PI * 2;

    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._targetPos = new THREE.Vector3();
    this._targetQuat = new THREE.Quaternion();
    this._mtx = new THREE.Matrix4();
    this._worldBox = new THREE.Box3();
    this._worldCenter = new THREE.Vector3();

    /** YXZ euler scratch — roll (z) overridden for turn banking. */
    this._eulerBank = new THREE.Euler(0, 0, 0, "YXZ");
    /** Horizontal flight direction (XZ) for autopilot turn-rate / bank. */
    this._prevForwardXZ = new THREE.Vector3(0, 0, -1);
    /** Previous yaw for mouse-look yaw rate (drone + walking). */
    this._prevMouseYaw = 0;
    this._mouseYawInited = false;
    /** Smoothed roll from yaw rate (rad). */
    this._bankSmoothed = 0;

    /** Smoothed world position for drone ground third-person camera. */
    this._groundCamSmoothed = new THREE.Vector3();
    this._droneGroundCamInited = false;

    /** Flying mesh materials for buzz roughness modulation (refs only). */
    this._flyBuzzMats = [];
    /** Smoothed local offset for flying buzz (tighter than raw multi-sine). */
    this._flyBuzzPosSm = new THREE.Vector3();
    this._flyBuzzRotSm = new THREE.Vector3();

    /** Camera-facing fuzz planes (body + wings), ShaderMaterial. */
    this._fuzzMeshes = [];
    /** Shared `uTime` for all fuzz shader materials. */
    this._fuzzUniformTime = { value: 0 };

    /** Flying FBX leg bones (pendulum sway vs bank). */
    this._legBones = [];
    /** @type {THREE.Quaternion[]} */
    this._legBoneRest = [];
    /** @type {(-1 | 0 | 1)[]} */
    this._legBoneSide = [];
    /** Static leg meshes if no rig bones matched. */
    this._legMeshes = [];
    /** @type {THREE.Euler[]} */
    this._legMeshRestRot = [];
    this._legSwingQuat = new THREE.Quaternion();
    this._legEuler = new THREE.Euler(0, 0, 0, "XYZ");

    /** Smoothed Bee ride camera (local to mount). */
    this._rideCamPx = 0;
    this._rideCamPy = 0;
    this._rideCamPz = 0;
    this._rideCamRx = 0;
    this._rideCamRy = 0;
    this._rideCamRz = 0;

    this.scene.add(this.root);
  }

  /**
   * Shortest signed yaw delta in [-π, π].
   * @param {number} prev
   * @param {number} curr
   */
  _wrapYawDelta(prev, curr) {
    let d = curr - prev;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /**
   * Exponential smoothing toward a target bank angle.
   * @param {number} targetRad
   * @param {number} dt
   * @param {number} [lambda] Higher = snappier.
   */
  _smoothBank(targetRad, dt, lambda = 7.5) {
    const k = 1 - Math.exp(-dt * lambda);
    this._bankSmoothed += (targetRad - this._bankSmoothed) * Math.min(1, k);
  }

  /**
   * Call when switching to drone mode after syncing euler from the bee quaternion
   * so the first frame does not infer a huge yaw rate.
   */
  resetMouseYawForBank() {
    this._mouseYawInited = false;
  }

  /**
   * World-space center of the bee rig (for orbit / chase cameras).
   * @param {THREE.Vector3} [target]
   */
  getWorldCenter(target = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    this._worldBox.setFromObject(this.root);
    this._worldBox.getCenter(target);
    return target;
  }

  /**
   * @returns {Promise<this>}
   */
  async load() {
    const loader = new FBXLoader();

    const fbx = await loader.loadAsync(BUMBLEBEE_FBX_URL);
    sanitizeImportedModel(fbx);
    upgradeLegacyMaterials(fbx);
    this._normalizeModelSize(fbx, TARGET_FLY_SIZE);
    // Typical Meshy/FBX orientation: model faces +Z; Three.js forward is −Z (camera, lookAt, WASD).
    fbx.rotation.y = Math.PI;
    this.flyingModel = fbx;
    this.root.add(fbx);
    this._collectFlyBuzzMaterials(fbx);
    this._createBeeFuzzSprites(fbx);
    this._discoverLegBones(fbx);

    let box = new THREE.Box3().setFromObject(fbx);
    const eyeY = box.max.y * 0.92;
    const fwd = Math.max((box.max.z - box.min.z) * 0.35, 0.02);
    this._eyeFly.set(0, eyeY, fwd);

    try {
      const wfbx = await loader.loadAsync(BUMBLEBEE_WALK_FBX_URL);
      sanitizeImportedModel(wfbx);
      upgradeLegacyMaterials(wfbx);
      this._normalizeModelSize(wfbx, TARGET_WALK_SIZE);
      wfbx.rotation.y = Math.PI;
      this.walkingModel = wfbx;
      this.walkingModel.visible = false;
      this.root.add(wfbx);

      box = new THREE.Box3().setFromObject(wfbx);
      const wy = box.max.y * 0.88;
      const wz = Math.max((box.max.z - box.min.z) * 0.32, 0.02);
      this._eyeWalk.set(0, wy, wz);

      this.mixer = new THREE.AnimationMixer(wfbx);
      const clips = wfbx.animations ?? [];
      let clip = clips.find((c) => /walk/i.test(c.name));
      if (!clip && clips.length > 0) clip = clips[0];
      if (clip) {
        this.walkAction = this.mixer.clipAction(clip);
        this.walkAction.setLoop(THREE.LoopRepeat, Infinity);
        this.walkAction.clampWhenFinished = false;
      }
    } catch (e) {
      console.warn("[bumblebee] Walking rig failed to load — fly-only.", e);
    }

    this._applyCameraMountOffset();
    this._applyModelVisibility();

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

  _applyCameraMountOffset() {
    const useWalk = this.locomotion !== BeeLocomotion.FLYING && this.walkingModel;
    const e = useWalk ? this._eyeWalk : this._eyeFly;
    this.cameraMount.position.copy(e);
  }

  _applyModelVisibility() {
    const walk = this.locomotion !== BeeLocomotion.FLYING && this.walkingModel;
    if (this.flyingModel) this.flyingModel.visible = !walk;
    if (this.walkingModel) this.walkingModel.visible = !!walk;
    if (walk && this.flyingModel) {
      this._resetFlyingBuzzPose();
      this._resetLegBonesToRest();
    }
    this._applyCameraMountOffset();
  }

  /**
   * Full-screen–aligned quads (billboard each frame) with animated distortion.
   * depthTest off so halos are not z-occluded by the bee mesh.
   * @param {THREE.Object3D} fbx
   */
  _createBeeFuzzSprites(fbx) {
    this._fuzzMeshes.length = 0;
    fbx.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(fbx);
    const size = new THREE.Vector3();
    box.getSize(size);
    const sy = Math.max(size.y, 1e-4);
    const sx = Math.max(size.x, 1e-4);
    const sz = Math.max(size.z, 1e-4);

    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);

    const makeMat = (wing) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this._fuzzUniformTime,
          uWing: { value: wing ? 1 : 0 },
        },
        vertexShader: BEE_FUZZ_VERTEX,
        fragmentShader: BEE_FUZZ_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
        fog: false,
      });

    const bodyR = Math.max(sx, sz) * 1.05;
    const bodyMesh = new THREE.Mesh(geo, makeMat(false));
    bodyMesh.name = "BeeFuzzBody";
    bodyMesh.renderOrder = 50;
    bodyMesh.frustumCulled = false;
    bodyMesh.position.set(0, sy * 0.48, 0);
    bodyMesh.scale.set(bodyR, bodyR, 1);
    bodyMesh.userData.isWingFuzz = false;
    bodyMesh.userData.baseScale = bodyMesh.scale.clone();
    fbx.add(bodyMesh);
    this._fuzzMeshes.push(bodyMesh);

    const wingX = sx * 0.44;
    const wingY = sy * 0.56;
    const wingZ = sz * 0.08;
    const wx = sx * 0.52;
    const wy = sy * 0.42;
    for (let w = 0; w < 2; w++) {
      const sign = w === 0 ? -1 : 1;
      const wm = new THREE.Mesh(geo, makeMat(true));
      wm.name = `BeeFuzzWing${w}`;
      wm.renderOrder = 51;
      wm.frustumCulled = false;
      wm.position.set(sign * wingX, wingY, wingZ);
      wm.scale.set(wx, wy, 1);
      wm.userData.isWingFuzz = true;
      wm.userData.baseScale = wm.scale.clone();
      fbx.add(wm);
      this._fuzzMeshes.push(wm);
    }
  }

  /**
   * Find leg bones (skinned rig) or separate leg meshes by FBX node name.
   * @param {THREE.Object3D} fbx
   */
  _discoverLegBones(fbx) {
    this._legBones.length = 0;
    this._legBoneRest.length = 0;
    this._legBoneSide.length = 0;
    this._legMeshes.length = 0;
    this._legMeshRestRot.length = 0;

    const seen = new Set();

    const tryAddBone = (o) => {
      const isBone = o instanceof THREE.Bone || o.type === "Bone";
      if (!isBone || seen.has(o.uuid)) return;
      if (!isLikelyLegBoneName(o.name)) return;
      seen.add(o.uuid);
      this._legBones.push(o);
      this._legBoneRest.push(o.quaternion.clone());
      this._legBoneSide.push(inferLegSide(o.name));
    };

    fbx.updateMatrixWorld(true);
    fbx.traverse((o) => {
      tryAddBone(o);
      if (o instanceof THREE.SkinnedMesh && o.skeleton?.bones) {
        for (let b = 0; b < o.skeleton.bones.length; b++) {
          tryAddBone(o.skeleton.bones[b]);
        }
      }
    });

    if (this._legBones.length === 0) {
      fbx.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o instanceof THREE.SkinnedMesh) return;
        if (!isLikelyLegMeshName(o.name)) return;
        if (seen.has(o.uuid)) return;
        seen.add(o.uuid);
        this._legMeshes.push(o);
        this._legMeshRestRot.push(o.rotation.clone());
      });
    }

    if (this._legBones.length === 0 && this._legMeshes.length === 0) {
      console.warn(
        "[bumblebee] No leg bones/meshes matched. Open the flying FBX in Blender, note leg object/bone names, and extend isLikelyLegBoneName / isLikelyLegMeshName in bumblebee.js."
      );
    } else {
      console.debug(
        `[bumblebee] Leg bank sway: ${this._legBones.length} bones, ${this._legMeshes.length} static meshes.`
      );
    }
  }

  _resetLegBonesToRest() {
    for (let i = 0; i < this._legBones.length; i++) {
      this._legBones[i].quaternion.copy(this._legBoneRest[i]);
    }
    for (let i = 0; i < this._legMeshes.length; i++) {
      this._legMeshes[i].rotation.copy(this._legMeshRestRot[i]);
    }
  }

  /**
   * Pendulum-style leg motion from smoothed roll (`_bankSmoothed`) + idle sway.
   * @param {number} t
   */
  _applyLegBankSway(t) {
    if (!this.flyingModel?.visible) return;
    const bank = this._bankSmoothed;
    const idle = 0.062 * Math.sin(t * 5.8);
    const idle2 = 0.045 * Math.sin(t * 7.4 + 1.3);
    const wobble = 0.028 * Math.sin(t * 10.2);

    for (let i = 0; i < this._legBones.length; i++) {
      const bone = this._legBones[i];
      const rest = this._legBoneRest[i];
      const side = this._legBoneSide[i];
      const ph = i * 0.37;

      const pendX = -bank * 0.92 + idle + wobble * Math.sin(ph);
      const pendY = side * bank * 0.22 + idle2 * 0.55;
      const pendZ =
        side * bank * 0.18 + idle * 0.35 + 0.03 * Math.sin(t * 8 + ph);

      this._legEuler.set(pendX, pendY, pendZ);
      this._legSwingQuat.setFromEuler(this._legEuler);
      bone.quaternion.copy(rest).multiply(this._legSwingQuat);
    }

    for (let i = 0; i < this._legMeshes.length; i++) {
      const mesh = this._legMeshes[i];
      const rr = this._legMeshRestRot[i];
      const side = inferLegSide(mesh.name);
      const pendX = -bank * 0.55 + idle;
      const pendZ = side * bank * 0.4;
      mesh.rotation.x = rr.x + pendX;
      mesh.rotation.y = rr.y + side * bank * 0.12 + idle2 * 0.3;
      mesh.rotation.z = rr.z + pendZ + wobble;
    }
  }

  _collectFlyBuzzMaterials(root) {
    this._flyBuzzMats.length = 0;
    const seen = new Set();
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.SkinnedMesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || (!m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial)) continue;
        if (seen.has(m)) continue;
        seen.add(m);
        if (m.userData.roughnessBuzzBase === undefined) {
          m.userData.roughnessBuzzBase = m.roughness;
        }
        this._flyBuzzMats.push(m);
      }
    });
  }

  _resetFlyingBuzzPose() {
    if (!this.flyingModel) return;
    this.flyingModel.position.set(0, 0, 0);
    this.flyingModel.rotation.set(0, Math.PI, 0);
    for (let i = 0; i < this._flyBuzzMats.length; i++) {
      const m = this._flyBuzzMats[i];
      const b = m.userData.roughnessBuzzBase;
      if (b !== undefined) m.roughness = b;
    }
    this._flyBuzzPosSm.set(0, 0, 0);
    this._flyBuzzRotSm.set(0, 0, 0);
  }

  /**
   * Coherent micro-motion + soft roughness swell while the flying mesh is visible (wing blur / fuzzy read).
   * @param {number} t Elapsed time (s).
   * @param {number} dt Frame delta (s).
   * @param {THREE.Camera} camera Used to billboard fuzz layers toward the eye.
   */
  updateFlyingBuzzVisuals(t, dt, camera) {
    if (!this.flyingModel?.visible) return;
    const d = Math.max(dt, 1e-4);
    const k = 1 - Math.exp(-d * 32);

    // Single dominant buzz band + one subtle harmonic (less erratic than multi-frequency stacks).
    const w = 41.2;
    const w2 = w * 1.618;
    const ap = 0.00105;
    const tx =
      ap *
      (Math.sin(t * w) + 0.12 * Math.sin(t * w2 + 1.1));
    const ty =
      ap *
      (Math.sin(t * w + 1.7) + 0.1 * Math.sin(t * w2 + 2.4));
    const tz =
      ap *
      (Math.sin(t * w + 3.0) + 0.11 * Math.sin(t * w2 + 0.6));

    this._flyBuzzPosSm.x += (tx - this._flyBuzzPosSm.x) * Math.min(1, k);
    this._flyBuzzPosSm.y += (ty - this._flyBuzzPosSm.y) * Math.min(1, k);
    this._flyBuzzPosSm.z += (tz - this._flyBuzzPosSm.z) * Math.min(1, k);
    this.flyingModel.position.copy(this._flyBuzzPosSm);

    const rAmp = 0.00075;
    const trx = rAmp * Math.sin(t * w * 0.92 + 0.4);
    const tryD = rAmp * Math.sin(t * w * 0.88 + 2.1);
    const trz = rAmp * Math.cos(t * w * 0.95 + 1.2);
    this._flyBuzzRotSm.x += (trx - this._flyBuzzRotSm.x) * Math.min(1, k);
    this._flyBuzzRotSm.y += (tryD - this._flyBuzzRotSm.y) * Math.min(1, k);
    this._flyBuzzRotSm.z += (trz - this._flyBuzzRotSm.z) * Math.min(1, k);
    this.flyingModel.rotation.set(
      this._flyBuzzRotSm.x,
      Math.PI + this._flyBuzzRotSm.y,
      this._flyBuzzRotSm.z
    );

    // Slower roughness swell = softer, fuzzier highlights (not fast strobing).
    for (let i = 0; i < this._flyBuzzMats.length; i++) {
      const m = this._flyBuzzMats[i];
      const b = m.userData.roughnessBuzzBase ?? 0.58;
      const fuzzLift = 0.045;
      m.roughness = THREE.MathUtils.clamp(
        b + fuzzLift + 0.072 * Math.sin(t * 19.5 + i * 0.31),
        0.34,
        0.98
      );
    }

    this._fuzzUniformTime.value = t;
    if (camera) {
      camera.getWorldPosition(this._tmp);
      for (let i = 0; i < this._fuzzMeshes.length; i++) {
        this._fuzzMeshes[i].lookAt(this._tmp);
      }
    }
    for (let i = 0; i < this._fuzzMeshes.length; i++) {
      const s = this._fuzzMeshes[i];
      const base = s.userData.baseScale;
      if (!base) continue;
      const wing = !!s.userData.isWingFuzz;
      const pulse = 1 + (wing ? 0.11 : 0.065) * Math.sin(t * 35.5 + i * 1.85);
      s.scale.set(base.x * pulse, base.y * pulse, 1);
    }

    this._applyLegBankSway(t);
  }

  /**
   * @param {THREE.PerspectiveCamera} cam
   */
  snapToCameraView(cam) {
    const off = this.cameraMount.position.clone();
    off.applyQuaternion(cam.quaternion);
    this.root.position.copy(cam.position).sub(off);
    this.root.quaternion.copy(cam.quaternion);
  }

  /**
   * @param {THREE.PerspectiveCamera} cam
   */
  attachCamera(cam) {
    this.cameraMount.attach(cam);
    cam.position.set(0, 0, 0);
    cam.rotation.set(0, 0, 0);
    this._droneGroundCamInited = false;
    this._rideCamPx = 0;
    this._rideCamPy = 0;
    this._rideCamPz = 0;
    this._rideCamRx = 0;
    this._rideCamRy = 0;
    this._rideCamRz = 0;
  }

  /**
   * Bee drone while flying: pull the camera back on the mount so the bee reads in frame (not eye-in-mesh).
   * @param {THREE.PerspectiveCamera} cam
   */
  updateDroneFlightCamera(cam) {
    if (cam.parent !== this.cameraMount) return;
    cam.position.set(0, 0.2, 0.82);
    cam.rotation.set(0, 0, 0);
  }

  /**
   * Bee drone while walking on the ground: third-person chase; camera is parented to the scene.
   * @param {THREE.PerspectiveCamera} cam
   * @param {THREE.Scene} scene
   * @param {THREE.Euler} euler
   * @param {number} dt
   */
  updateDroneGroundCamera(cam, scene, euler, dt) {
    if (cam.parent !== scene) {
      scene.attach(cam);
      this._groundCamSmoothed.copy(cam.position);
      this._droneGroundCamInited = false;
    }
    const p = this.root.position;
    const fwd = this._tmp;
    fwd.set(-Math.sin(euler.y), 0, -Math.cos(euler.y));
    const dist = 2.2;
    const lift = 0.52;
    this._tmp2.set(
      p.x - fwd.x * dist,
      p.y + lift,
      p.z - fwd.z * dist
    );
    const k = 1 - Math.exp(-dt * 14);
    if (!this._droneGroundCamInited) {
      this._groundCamSmoothed.copy(this._tmp2);
      this._droneGroundCamInited = true;
    } else {
      this._groundCamSmoothed.lerp(this._tmp2, Math.min(1, k));
    }
    cam.position.copy(this._groundCamSmoothed);
    cam.lookAt(p.x, p.y + 0.09, p.z);
  }

  /**
   * Bee ride (autopilot): vary local camera on the mount — chase vs on-body FPV, pan, tilt to sky,
   * and off-center framing (bee not locked to screen middle).
   * Call each frame while the camera is parented to {@link BumblebeePilot#cameraMount}.
   * @param {THREE.PerspectiveCamera} cam
   * @param {number} t Elapsed time (s).
   * @param {number} dt Frame delta (s).
   */
  updateRideCamera(cam, t, dt) {
    if (cam.parent !== this.cameraMount) return;

    const a = t * 0.1;
    const b = t * 0.064;

    // Slow envelopes 0…1 — when high, camera sits farther back / looser; when low, still outside the mesh.
    const chase = 0.5 + 0.5 * Math.sin(a * 0.55);
    const panEnv = 0.5 + 0.5 * Math.sin(b * 0.31 + 1.7);
    // Occasional strong “look at the sky” beats — bee can leave the frame below.
    const sky = Math.pow(Math.max(0, Math.sin(a * 0.14 + 0.2)), 1.85);

    // Baseline zoom-out (mount local): eye sits inside the model; +Z = back, +Y = a bit above eye.
    const baseZ = 0.26;
    const baseY = 0.06;

    // Local position (mount space): +Z nudges behind the head for third-person; X/Y shift = off-center.
    const px =
      0.12 * chase * Math.sin(b * 0.77) +
      0.065 * Math.sin(t * 0.29) +
      0.045 * Math.sin(t * 0.13);
    const py =
      baseY +
      -0.025 * chase +
      0.045 * Math.sin(t * 0.21) +
      0.035 * panEnv * Math.sin(t * 0.37);
    const pz =
      baseZ +
      0.14 * chase * (0.5 + 0.5 * Math.sin(b * 0.44)) +
      0.03 * Math.sin(t * 0.19);

    // YXZ: pitch x (neg = look up), yaw y (pan), roll z.
    const pitchBase = 0.025 * Math.sin(t * 0.51);
    const pitchSky = -sky * 0.82 * (0.32 + 0.58 * chase);
    const pitch = pitchBase + pitchSky;

    const yaw =
      0.52 * panEnv * Math.sin(t * 0.33) +
      0.24 * Math.sin(t * 0.11) +
      0.11 * Math.sin(t * 0.067);
    const roll = 0.055 * Math.sin(t * 0.89) + 0.035 * panEnv * Math.sin(t * 0.53);

    cam.rotation.order = "YXZ";

    const k = 1 - Math.exp(-dt * 5.2);
    this._rideCamPx += (px - this._rideCamPx) * Math.min(1, k);
    this._rideCamPy += (py - this._rideCamPy) * Math.min(1, k);
    this._rideCamPz += (pz - this._rideCamPz) * Math.min(1, k);
    this._rideCamRx += (pitch - this._rideCamRx) * Math.min(1, k);
    this._rideCamRy += (yaw - this._rideCamRy) * Math.min(1, k);
    this._rideCamRz += (roll - this._rideCamRz) * Math.min(1, k);

    cam.position.set(this._rideCamPx, this._rideCamPy, this._rideCamPz);
    cam.rotation.set(this._rideCamRx, this._rideCamRy, this._rideCamRz);
  }

  /**
   * @param {THREE.PerspectiveCamera} cam
   * @param {THREE.Scene} scene
   */
  detachCamera(cam, scene) {
    scene.attach(cam);
  }

  /**
   * @param {boolean} v
   */
  setVisible(v) {
    this.root.visible = v;
  }

  takeoff() {
    if (this.locomotion === BeeLocomotion.FLYING) return;
    this.locomotion = BeeLocomotion.FLYING;
    this._anchor = null;
    this._droneGroundCamInited = false;
    if (this.walkAction) {
      this.walkAction.stop();
    }
    this._applyModelVisibility();
    this.root.position.y += 0.55;
  }

  /**
   * @param {number} dt
   * @param {number} t
   * @param {number} windSpeed
   * @param {number} windDirRad
   * @param {object} [opts]
   * @param {number} [opts.pace] Scale time (lower = slower path). Default 1.
   * @param {number} [opts.minHeight] World Y floor so the bee never dips under terrain. Default 1.35.
   * @param {boolean} [opts.watchHighView] Extra slow high-altitude arcs (Bee watch / orbit).
   * @param {number} [opts.smoothingMul] Multiplier on follow smoothing (lower = gentler). Default 1.
   */
  updateAutopilot(dt, t, windSpeed, windDirRad, opts = {}) {
    const pace = typeof opts.pace === "number" ? opts.pace : 1;
    const minHeight = typeof opts.minHeight === "number" ? opts.minHeight : 1.35;
    const watchHighView = !!opts.watchHighView;
    const smoothingMul = typeof opts.smoothingMul === "number" ? opts.smoothingMul : 1;

    const ta = t * pace;
    const spread = this.fieldSpread * 0.92;
    const p = this.autopilotPhase;
    const wx = windSpeed * 0.22;
    const wdx = Math.cos(windDirRad) * wx * Math.sin(ta * 0.47);
    const wdz = Math.sin(windDirRad) * wx * Math.sin(ta * 0.47);

    const x =
      Math.sin(ta * 0.38 + p) * spread * 0.55 +
      Math.cos(ta * 0.17 + p * 1.3) * spread * 0.22 +
      wdx;
    const z =
      Math.cos(ta * 0.33 + p * 0.7) * spread * 0.52 +
      Math.sin(ta * 0.21 + p) * spread * 0.2 +
      wdz;
    let y =
      2.1 + Math.sin(ta * 0.71 + p) * 2.35 + Math.sin(ta * 0.44 + p * 0.5) * 0.55;

    if (watchHighView) {
      y += Math.sin(ta * 0.048) * 6.2 + Math.sin(ta * 0.017) * 2.8;
    }
    y = Math.max(minHeight, y);

    this._targetPos.set(x, y, z);

    const eps = 0.05;
    const x2 =
      Math.sin((ta + eps) * 0.38 + p) * spread * 0.55 +
      Math.cos((ta + eps) * 0.17 + p * 1.3) * spread * 0.22 +
      wdx;
    const z2 =
      Math.cos((ta + eps) * 0.33 + p * 0.7) * spread * 0.52 +
      Math.sin((ta + eps) * 0.21 + p) * spread * 0.2 +
      wdz;
    let y2 =
      2.1 +
      Math.sin((ta + eps) * 0.71 + p) * 2.35 +
      Math.sin((ta + eps) * 0.44 + p * 0.5) * 0.55;

    if (watchHighView) {
      y2 +=
        Math.sin((ta + eps) * 0.048) * 6.2 + Math.sin((ta + eps) * 0.017) * 2.8;
    }
    y2 = Math.max(minHeight, y2);

    this._tmp2.set(x2, y2, z2).sub(this._targetPos);
    if (this._tmp2.lengthSq() < 1e-8) {
      this._tmp2.set(0, 0, 1);
    } else {
      this._tmp2.normalize();
    }

    this._mtx.lookAt(this._targetPos, this._targetPos.clone().add(this._tmp2), this._tmp.set(0, 1, 0));
    this._targetQuat.setFromRotationMatrix(this._mtx);

    // Bank into the turn: roll from horizontal yaw rate of the flight path.
    const fwdH = this._tmp;
    fwdH.copy(this._tmp2);
    fwdH.y = 0;
    if (fwdH.lengthSq() < 1e-8) {
      fwdH.set(0, 0, -1);
    } else {
      fwdH.normalize();
    }
    const crossY =
      this._prevForwardXZ.x * fwdH.z - this._prevForwardXZ.z * fwdH.x;
    const dot = this._prevForwardXZ.x * fwdH.x + this._prevForwardXZ.z * fwdH.z;
    const turnSigned = Math.atan2(crossY, dot);
    const yawRate = turnSigned / Math.max(dt, 1e-4);
    // Negative roll for positive yaw rate (left/CCW turn from above): banks into the turn in YXZ.
    const bankTarget = THREE.MathUtils.clamp(-yawRate * 0.38, -0.62, 0.62);
    this._smoothBank(bankTarget, dt, 6.8);
    this._prevForwardXZ.copy(fwdH);

    this._eulerBank.setFromQuaternion(this._targetQuat, "YXZ");
    this._eulerBank.z = this._bankSmoothed;
    this._targetQuat.setFromEuler(this._eulerBank);

    const posT = 1 - Math.exp(-dt * 2.8 * smoothingMul);
    this.root.position.lerp(this._targetPos, Math.min(1, posT));
    const rotT = 1 - Math.exp(-dt * 5.5 * smoothingMul);
    this.root.quaternion.slerp(this._targetQuat, Math.min(1, rotT));
  }

  /**
   * @param {number} dt
   * @param {Set<string>} keys
   * @param {THREE.Euler} euler
   * @param {number} moveSpeed
   */
  updateDrone(dt, keys, euler, moveSpeed) {
    if (this.locomotion !== BeeLocomotion.FLYING) return;
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
      v.normalize().multiplyScalar(moveSpeed * dt);
      this.root.position.add(v);
    }

    if (!this._mouseYawInited) {
      this._prevMouseYaw = euler.y;
      this._mouseYawInited = true;
    }
    const dy = this._wrapYawDelta(this._prevMouseYaw, euler.y);
    this._prevMouseYaw = euler.y;
    const yawRate = dy / Math.max(dt, 1e-4);
    const bankTarget = THREE.MathUtils.clamp(yawRate * 0.2, -0.6, 0.6);
    this._smoothBank(bankTarget, dt, 8);
    this._eulerBank.copy(euler);
    this._eulerBank.z = this._bankSmoothed;
    this.root.quaternion.setFromEuler(this._eulerBank);
  }

  /**
   * @param {number} dt
   * @param {Set<string>} keys
   * @param {THREE.Euler} euler
   */
  updateWalking(dt, keys, euler) {
    if (this.locomotion === BeeLocomotion.FLYING) return;
    if (!this.walkingModel || !this.mixer) return;

    const yaw = euler.y;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const v = new THREE.Vector3();
    if (keys.has("KeyW")) v.add(forward);
    if (keys.has("KeyS")) v.sub(forward);
    if (keys.has("KeyA")) v.sub(right);
    if (keys.has("KeyD")) v.add(right);

    const moving = v.lengthSq() > 1e-6;
    if (moving) {
      v.normalize().multiplyScalar(
        this.locomotion === BeeLocomotion.WALK_GROUND ? WALK_SPEED_GROUND : WALK_SPEED_SURFACE
      );
      v.multiplyScalar(dt);
    }

    const p = this.root.position;
    p.add(v);

    if (this.locomotion === BeeLocomotion.WALK_GROUND) {
      p.y = 0.02;
    } else if (this.locomotion === BeeLocomotion.WALK_FLOWER && this._anchor) {
      const ax = /** @type {number} */ (this._anchor.x);
      const az = /** @type {number} */ (this._anchor.z);
      const ay = /** @type {number} */ (this._anchor.y);
      const r = /** @type {number} */ (this._anchor.r);
      let lx = p.x - ax;
      let lz = p.z - az;
      const d = Math.sqrt(lx * lx + lz * lz);
      if (d > r && d > 1e-5) {
        lx = (lx / d) * r;
        lz = (lz / d) * r;
        p.x = ax + lx;
        p.z = az + lz;
      }
      p.y = ay + 0.02;
    } else if (this.locomotion === BeeLocomotion.WALK_TREE && this._anchor) {
      const tx = /** @type {number} */ (this._anchor.treeX);
      const tz = /** @type {number} */ (this._anchor.treeZ);
      const tr = /** @type {number} */ (this._anchor.trunkR);
      const targetR = tr + 0.06;
      let dx = p.x - tx;
      let dz = p.z - tz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 1e-5) {
        dx = (dx / d) * targetR;
        dz = (dz / d) * targetR;
        p.x = tx + dx;
        p.z = tz + dz;
      } else {
        p.x = tx + targetR;
        p.z = tz;
      }
      p.y = THREE.MathUtils.clamp(
        p.y,
        /** @type {number} */ (this._anchor.y0),
        /** @type {number} */ (this._anchor.y1)
      );
    }

    if (!this._mouseYawInited) {
      this._prevMouseYaw = euler.y;
      this._mouseYawInited = true;
    }
    const dy = this._wrapYawDelta(this._prevMouseYaw, euler.y);
    this._prevMouseYaw = euler.y;
    const yawRate = dy / Math.max(dt, 1e-4);
    const bankTarget = THREE.MathUtils.clamp(yawRate * 0.12, -0.28, 0.28);
    this._smoothBank(bankTarget, dt, 6);
    this._eulerBank.copy(euler);
    this._eulerBank.z = this._bankSmoothed;
    if (this.locomotion === BeeLocomotion.WALK_GROUND) {
      this._eulerBank.x += GROUND_WALK_BODY_PITCH;
    }
    this.root.quaternion.setFromEuler(this._eulerBank);

    if (this.walkAction) {
      this.walkAction.setEffectiveTimeScale(moving ? 1 : 0);
      if (!this.walkAction.isRunning()) this.walkAction.play();
    }
    this.mixer.update(dt);
  }

  /**
   * @param {number} dt
   * @param {{ getNearestFlowerLanding?: (px: number, pz: number, py: number, maxH: number, maxV: number) => unknown } | null} flowerField
   * @param {{ getNearestTrunkLanding?: (px: number, pz: number, py: number, gap?: number) => unknown } | null} treeForest
   * @param {number} prevY
   */
  tryLanding(dt, flowerField, treeForest, prevY) {
    if (this.locomotion !== BeeLocomotion.FLYING || !this.walkingModel) return;
    const p = this.root.position;
    const vy = (p.y - prevY) / Math.max(dt, 1e-4);

    const f = flowerField?.getNearestFlowerLanding?.(p.x, p.z, p.y, 0.62, 0.52);
    if (f && Math.abs(p.y - f.yTop) < 0.52 && vy < 1.1) {
      this._landFlower(f);
      return;
    }

    const tr = treeForest?.getNearestTrunkLanding?.(p.x, p.z, p.y, 0.55);
    if (tr && vy < 1.2) {
      this._landTree(tr);
      return;
    }

    if (p.y < 0.46 && vy < 0.95) {
      this._landGround();
    }
  }

  /**
   * @param {{ x: number, z: number, yTop: number, stemH: number }} f
   */
  _landFlower(f) {
    this.locomotion = BeeLocomotion.WALK_FLOWER;
    this._anchor = { kind: "flower", x: f.x, z: f.z, y: f.yTop, r: FLOWER_WALK_RADIUS };
    this.root.position.set(f.x, f.yTop + 0.02, f.z);
    if (this.walkAction) this.walkAction.reset().play();
    this._applyModelVisibility();
  }

  _landGround() {
    this.locomotion = BeeLocomotion.WALK_GROUND;
    this._anchor = { kind: "ground" };
    this.root.position.y = 0.02;
    if (this.walkAction) this.walkAction.reset().play();
    this._applyModelVisibility();
  }

  /**
   * @param {{ treeX: number, treeZ: number, trunkR: number, trunkHeight: number, surfaceX: number, surfaceZ: number, surfaceY: number }} t
   */
  _landTree(t) {
    this.locomotion = BeeLocomotion.WALK_TREE;
    const yLo = 0.32;
    const yHi = t.trunkHeight * 0.9;
    this._anchor = {
      kind: "tree",
      treeX: t.treeX,
      treeZ: t.treeZ,
      trunkR: t.trunkR,
      y0: yLo,
      y1: yHi,
    };
    this.root.position.set(t.surfaceX, t.surfaceY + 0.02, t.surfaceZ);
    const dx = this.root.position.x - t.treeX;
    const dz = this.root.position.z - t.treeZ;
    this.root.rotation.y = Math.atan2(dx, dz);
    if (this.walkAction) this.walkAction.reset().play();
    this._applyModelVisibility();
  }
}
