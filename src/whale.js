import * as THREE from "three";
import { isTerrainDryAt } from "./terrain-paint.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _FWD = new THREE.Vector3(1, 0, 0);
const _DIR = new THREE.Vector3();
const _Q = new THREE.Quaternion();
const _PITCH = new THREE.Quaternion();
const _ROLL = new THREE.Quaternion();
const _AXIS_X = new THREE.Vector3(1, 0, 0);
const _AXIS_Z = new THREE.Vector3(0, 0, 1);

/**
 * One large procedural whale for lake / ocean water — swims when terrain has exposed water
 * and the world has been spawned.
 */
export class LakeWhale {
  /**
   * @param {THREE.Scene} scene
   * @param {number} fieldSpread
   */
  constructor(scene, fieldSpread) {
    this.scene = scene;
    this.fieldSpread = fieldSpread;
    this.group = new THREE.Group();
    this.group.name = "Lake whale";
    this.group.visible = false;
    this.group.frustumCulled = false;

    /** @type {THREE.Group | null} */
    this._tailPeduncle = null;
    /** @type {THREE.Group | null} */
    this._fluke = null;

    this._buildMesh();

    this.scene.add(this.group);

    /** @type {import("./terrain-paint.js").TerrainHeightField | null} */
    this._terrain = null;
    this._placed = false;
    this._lastFp = "";

    this._x = 0;
    this._y = 0;
    this._z = 0;
    this._yaw = 0;
  }

  _buildMesh() {
    const skin = new THREE.MeshStandardMaterial({
      color: 0x3d5a78,
      roughness: 0.48,
      metalness: 0.07,
      emissive: new THREE.Color(0x081018),
      emissiveIntensity: 0.06,
    });

    const body = new THREE.Mesh(new THREE.SphereGeometry(1.35, 28, 20), skin);
    body.scale.set(2.35, 1.02, 1.05);
    body.position.set(0.1, 0, 0);
    this.group.add(body);

    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.55, 14, 1), skin);
    snout.rotation.z = -Math.PI / 2;
    snout.position.set(3.15, 0, 0);
    this.group.add(snout);

    const tailPed = new THREE.Group();
    tailPed.position.set(-2.35, 0, 0);
    this.group.add(tailPed);
    this._tailPeduncle = tailPed;

    const taper = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.65, 12, 1), skin);
    taper.rotation.z = Math.PI / 2;
    taper.position.set(-0.75, 0, 0);
    tailPed.add(taper);

    const fluke = new THREE.Group();
    fluke.position.set(-1.55, 0, 0);
    tailPed.add(fluke);
    this._fluke = fluke;

    const flMat = skin;
    const flukeL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 1.95), flMat);
    flukeL.position.set(-0.35, 0, 1.05);
    flukeL.rotation.set(0, 0.42, 0.08);
    const flukeR = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 1.95), flMat);
    flukeR.position.set(-0.35, 0, -1.05);
    flukeR.rotation.set(0, -0.42, -0.08);
    fluke.add(flukeL, flukeR);

    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.05, 8, 1), skin);
    dorsal.position.set(0.15, 1.05, 0);
    dorsal.rotation.x = Math.PI * 0.1;
    this.group.add(dorsal);

    const pecL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 1.35), skin);
    pecL.position.set(0.35, -0.38, 0.88);
    pecL.rotation.set(0.25, 0, 0.38);
    const pecR = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 1.35), skin);
    pecR.position.set(0.35, -0.38, -0.88);
    pecR.rotation.set(0.25, 0, -0.38);
    this.group.add(pecL, pecR);

    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.35, metalness: 0.2 })
    );
    eye.position.set(2.55, 0.35, 0.42);
    const eye2 = eye.clone();
    eye2.position.z = -0.42;
    this.group.add(eye, eye2);

    this.group.scale.setScalar(1.35);
  }

  /**
   * @param {import("./terrain-paint.js").TerrainHeightField | null} terrain
   */
  _tryPlace(terrain) {
    if (!terrain) {
      this._placed = false;
      return;
    }
    const spread = this.fieldSpread * 0.96;
    const rng = mulberry32(42881);
    for (let attempt = 0; attempt < 160; attempt++) {
      const x = (rng() * 2 - 1) * spread;
      const z = (rng() * 2 - 1) * spread;
      if (isTerrainDryAt(terrain, x, z)) continue;
      const g = terrain.getHeightBilinear(x, z);
      const w = terrain.getWaterSurfaceHeightBilinear(x, z);
      const column = w - g;
      if (column < 2.2) continue;
      this._x = x;
      this._z = z;
      this._y = g + column * 0.42;
      this._yaw = rng() * Math.PI * 2;
      this._placed = true;
      return;
    }
    this._placed = false;
  }

  /**
   * @param {number} t
   * @param {number} dt
   * @param {import("./terrain-paint.js").TerrainHeightField | null} terrain
   * @param {boolean} worldSpawned
   */
  update(t, dt, terrain, worldSpawned) {
    this._terrain = terrain;
    if (!terrain || !worldSpawned || !terrain.hasExposedWater()) {
      this.group.visible = false;
      if (!worldSpawned) {
        this._placed = false;
        this._lastFp = "";
      }
      return;
    }

    const fp = terrain.getQuickFingerprint();
    if (fp !== this._lastFp) {
      this._lastFp = fp;
      this._placed = false;
    }

    if (!this._placed) {
      this._tryPlace(terrain);
    }
    if (!this._placed) {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;

    const dtC = Math.min(Math.max(dt, 0), 0.08);
    const spread = this.fieldSpread * 0.98;
    const bound = spread * 0.99;
    const speed = 2.15;

    const fx = Math.sin(this._yaw);
    const fz = Math.cos(this._yaw);
    const look = 6.5;
    const ax = this._x + fx * look;
    const az = this._z + fz * look;
    if (isTerrainDryAt(terrain, ax, az)) {
      this._yaw += dtC * 1.1;
    } else {
      this._yaw += Math.sin(t * 0.28 + 1.7) * 0.045 * dtC;
    }

    this._x += Math.sin(this._yaw) * speed * dtC;
    this._z += Math.cos(this._yaw) * speed * dtC;

    if (this._x > bound) {
      this._x = bound;
      this._yaw += Math.PI * 0.55;
    } else if (this._x < -bound) {
      this._x = -bound;
      this._yaw += Math.PI * 0.55;
    }
    if (this._z > bound) {
      this._z = bound;
      this._yaw += Math.PI * 0.55;
    } else if (this._z < -bound) {
      this._z = -bound;
      this._yaw += Math.PI * 0.55;
    }

    if (isTerrainDryAt(terrain, this._x, this._z)) {
      this._yaw += (0.6 + 0.4 * Math.sin(t * 2.2)) * dtC * 2.2;
    }

    const g = terrain.getHeightBilinear(this._x, this._z);
    const w = terrain.getWaterSurfaceHeightBilinear(this._x, this._z);
    const column = Math.max(0.15, w - g);
    const depthFrac = 0.38;
    const bob =
      Math.sin(t * 1.15) * 0.12 * Math.min(column, 3) +
      Math.sin(t * 2.4 + this._x * 0.02) * 0.06;
    this._y = g + column * depthFrac + bob;

    this.group.position.set(this._x, this._y, this._z);
    _DIR.set(fx, 0, fz).normalize();
    _Q.setFromUnitVectors(_FWD, _DIR);
    const pitch = Math.sin(t * 1.8) * 0.06;
    const roll = Math.sin(t * 3.1) * 0.04;
    _PITCH.setFromAxisAngle(_AXIS_X, pitch);
    _ROLL.setFromAxisAngle(_AXIS_Z, roll);
    this.group.quaternion.copy(_Q).multiply(_PITCH).multiply(_ROLL);

    if (this._tailPeduncle) {
      this._tailPeduncle.rotation.y = Math.sin(t * 2.35) * 0.38;
    }
    if (this._fluke) {
      this._fluke.rotation.z = Math.sin(t * 3.8) * 0.32;
    }
  }
}
