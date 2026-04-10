import * as THREE from "three";

/** Time to stay on one creature before picking another (seconds). */
export const RANDOM_CREATURE_DWELL_SEC = 60;

/**
 * @typedef {{
 *   kind: "inst";
 *   mesh: THREE.InstancedMesh;
 *   count: number;
 *   label: string;
 *   localForward: THREE.Vector3;
 * }} InstDescriptor
 */

/**
 * @typedef {{
 *   kind: "whale";
 *   group: THREE.Group;
 *   label: string;
 *   localForward: THREE.Vector3;
 * }} WhaleDescriptor
 */

/**
 * @typedef {InstDescriptor | WhaleDescriptor} CreatureDescriptor
 */

/**
 * Spectator camera: first-person-ish on random moving instanced creatures (and whale).
 * Call `update` after swarm simulations have written instance matrices for the frame.
 */
export class RandomCreatureViewController {
  constructor() {
    this.active = false;

    /** @type {number} */
    this._until = 0;

    /** @type {CreatureDescriptor | null} */
    this._desc = null;

    /** @type {number} */
    this._index = 0;

    /** @type {string} */
    this.currentLabel = "";

    /** @type {() => CreatureDescriptor[]} */
    this._getDescriptors = () => [];

    this._mat = new THREE.Matrix4();
    this._worldMat = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._lastPos = new THREE.Vector3();
    this._hasLast = false;
    this._up = new THREE.Vector3(0, 1, 0);
    this._lookScratch = new THREE.Vector3();
  }

  /**
   * @param {() => CreatureDescriptor[]} getDescriptors
   */
  setDescriptorProvider(getDescriptors) {
    this._getDescriptors = getDescriptors;
  }

  end() {
    this.active = false;
    this._desc = null;
    this._hasLast = false;
    this.currentLabel = "";
  }

  /**
   * @param {number} elapsed
   */
  begin(elapsed) {
    this.active = true;
    this._hasLast = false;
    this.pickNext(elapsed);
  }

  /**
   * @param {number} elapsed
   */
  pickNext(elapsed) {
    const list = this._getDescriptors().filter((d) => {
      if (d.kind === "whale") return d.group.visible === true;
      return d.count > 0;
    });
    if (list.length < 1) {
      this.active = false;
      this._desc = null;
      this.currentLabel = "";
      return;
    }
    const d = list[Math.floor(Math.random() * list.length)];
    this._desc = d;
    if (d.kind === "whale") {
      this._index = 0;
      this.currentLabel = d.label;
    } else {
      this._index = Math.floor(Math.random() * d.count);
      this.currentLabel = d.label;
    }
    this._until = elapsed + RANDOM_CREATURE_DWELL_SEC;
    this._hasLast = false;
  }

  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Euler} euler
   * @param {number} elapsed
   */
  update(camera, euler, elapsed) {
    if (!this.active) return;

    if (this._until <= elapsed || !this._desc) {
      this.pickNext(elapsed);
    }

    const d = this._desc;
    if (!d) return;

    let ok = false;
    if (d.kind === "whale") {
      ok = this._applyWhale(camera, euler, d);
    } else {
      if (this._index >= d.mesh.count) {
        this.pickNext(elapsed);
        return;
      }
      ok = this._applyInstanced(camera, euler, d);
    }

    if (!ok) {
      this.pickNext(elapsed);
    }
  }

  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Euler} euler
   * @param {WhaleDescriptor} d
   */
  _applyWhale(camera, euler, d) {
    d.group.updateMatrixWorld(true);
    this._pos.setFromMatrixPosition(d.group.matrixWorld);
    this._fwd.copy(d.localForward).applyQuaternion(d.group.quaternion);
    if (this._fwd.lengthSq() < 1e-12) return false;
    this._fwd.normalize();
    this._blendForwardFromMotion(this._pos);
    const eyeFwd = 1.1;
    const eyeUp = 0.42;
    camera.position.copy(this._pos).addScaledVector(this._fwd, eyeFwd).addScaledVector(this._up, eyeUp);
    this._lookScratch.copy(this._pos).add(this._fwd);
    camera.lookAt(this._lookScratch);
    euler.setFromQuaternion(camera.quaternion, euler.order);
    return true;
  }

  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Euler} euler
   * @param {InstDescriptor} d
   */
  _applyInstanced(camera, euler, d) {
    const mesh = d.mesh;
    mesh.updateMatrixWorld(true);
    mesh.getMatrixAt(this._index, this._mat);
    this._worldMat.multiplyMatrices(mesh.matrixWorld, this._mat);
    this._worldMat.decompose(this._pos, this._quat, this._scale);
    this._fwd.copy(d.localForward).applyQuaternion(this._quat);
    if (this._fwd.lengthSq() < 1e-12) return false;
    this._fwd.normalize();
    this._blendForwardFromMotion(this._pos);
    const r = Math.max(this._scale.x, this._scale.y, this._scale.z, 0.02);
    const eyeFwd = r * 0.42;
    const eyeUp = r * 0.14;
    camera.position.copy(this._pos).addScaledVector(this._fwd, eyeFwd).addScaledVector(this._up, eyeUp);
    this._lookScratch.copy(this._pos).add(this._fwd);
    camera.lookAt(this._lookScratch);
    euler.setFromQuaternion(camera.quaternion, euler.order);
    return true;
  }

  /**
   * Prefer motion direction when the instance actually moves (stable FP heading).
   * @param {THREE.Vector3} worldPos
   */
  _blendForwardFromMotion(worldPos) {
    if (this._hasLast) {
      this._lookScratch.subVectors(worldPos, this._lastPos);
      if (this._lookScratch.lengthSq() > 1e-10) {
        this._lookScratch.normalize();
        if (this._lookScratch.dot(this._fwd) < -0.85) {
          this._lookScratch.multiplyScalar(-1);
        }
        this._fwd.lerp(this._lookScratch, 0.55).normalize();
      }
    }
    this._lastPos.copy(worldPos);
    this._hasLast = true;
  }
}
