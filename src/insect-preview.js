import * as THREE from "three";
import { applyButterflyMotion } from "./butterfly-motion.js";
import {
  buildProceduralButterflyGeometry,
  patchMaterialForProceduralInsect,
  proceduralGeometrySignature,
  updateProceduralInsectUniforms,
} from "./procedural-insect.js";
import { DEFAULT_BUTTERFLY_DYNAMICS, normalizeButterflyDynamics } from "./butterfly-dynamics.js";

/**
 * Isolated WebGL view of one procedural butterfly (same mesh + motion as the field).
 */
export class ButterflyInsectPreview {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    /** @type {THREE.WebGLRenderer | null} */
    this.renderer = null;
    /** @type {THREE.Scene | null} */
    this.scene = null;
    /** @type {THREE.PerspectiveCamera | null} */
    this.camera = null;
    /** @type {THREE.Mesh | null} */
    this.mesh = null;
    /** @type {THREE.Object3D} */
    this._dummy = new THREE.Object3D();
    this._ready = false;
    this._loadPromise = null;
    /** @type {string} */
    this._geoSig = "";
    this._bx = 0;
    this._by = 2.1;
    this._bz = 0;
    this._phase = 0.7;
    this._scale = 1.05;
  }

  async init() {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = (async () => {
      const geo = buildProceduralButterflyGeometry(DEFAULT_BUTTERFLY_DYNAMICS);
      this._geoSig = proceduralGeometrySignature(DEFAULT_BUTTERFLY_DYNAMICS);
      if (!geo || !this.canvas) return;

      const renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer = renderer;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x12161c);
      this.scene = scene;

      const cam = new THREE.PerspectiveCamera(42, 1, 0.08, 80);
      this.camera = cam;

      const hemi = new THREE.HemisphereLight(0x9ec8ff, 0x2a3028, 1.12);
      scene.add(hemi);
      const amb = new THREE.AmbientLight(0xffffff, 0.22);
      scene.add(amb);
      const dir = new THREE.DirectionalLight(0xfff4e8, 1.35);
      dir.position.set(4, 10, 5);
      dir.castShadow = true;
      dir.shadow.mapSize.setScalar(1024);
      dir.shadow.camera.near = 0.5;
      dir.shadow.camera.far = 40;
      dir.shadow.camera.left = -8;
      dir.shadow.camera.right = 8;
      dir.shadow.camera.top = 8;
      dir.shadow.camera.bottom = -8;
      scene.add(dir);
      const fill = new THREE.DirectionalLight(0xaabbff, 0.45);
      fill.position.set(-4, 6, -6);
      scene.add(fill);

      const mat = new THREE.MeshStandardMaterial({
        color: 0xffaa44,
        vertexColors: false,
        metalness: 0.12,
        roughness: 0.62,
      });
      patchMaterialForProceduralInsect(mat);
      // Single mesh (not InstancedMesh): avoids instance-color + custom shader edge cases; tint on mat.color.
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      this.mesh = mesh;

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 40),
        new THREE.MeshStandardMaterial({ color: 0x1e2520, roughness: 0.95, metalness: 0.05 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.02;
      ground.receiveShadow = true;
      scene.add(ground);

      this._ready = true;
      this.resize();
    })();
    return this._loadPromise;
  }

  resize() {
    if (!this.renderer || !this.camera || !this.canvas) return;
    const w = Math.max(1, this.canvas.clientWidth || 1);
    const h = Math.max(1, this.canvas.clientHeight || 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  /**
   * @param {number} t
   * @param {number} windSpeed
   * @param {number} windDirRad
   * @param {import("./butterfly-dynamics.js").ButterflyDynamics} dynamics
   * @param {string} [tintHex] Critters butterfly tint (#rrggbb), first preset
   */
  update(t, windSpeed, windDirRad, dynamics, tintHex) {
    if (!this._ready || !this.renderer || !this.scene || !this.camera || !this.mesh) return;

    const dyn = normalizeButterflyDynamics(dynamics);
    const sig = proceduralGeometrySignature(dyn);
    if (sig !== this._geoSig) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = buildProceduralButterflyGeometry(dyn);
      this._geoSig = sig;
    }

    const mat = this.mesh.material;
    if (mat instanceof THREE.MeshStandardMaterial && mat.userData.proceduralInsect) {
      updateProceduralInsectUniforms(mat, t, windSpeed, dyn);
      if (typeof tintHex === "string" && tintHex.length >= 4) {
        try {
          mat.color.set(tintHex);
        } catch {
          /* ignore invalid hex */
        }
      }
    }

    applyButterflyMotion(
      this._dummy,
      t,
      windSpeed,
      windDirRad,
      dynamics,
      this._bx,
      this._by,
      this._bz,
      this._phase,
      this._scale
    );
    this._dummy.updateMatrix();
    this.mesh.matrix.copy(this._dummy.matrix);
    this.mesh.matrixWorldNeedsUpdate = true;

    const p = this._dummy.position;
    // Close framing: geometry is scaled to world units; a long offset made the mesh sub-pixel.
    this.camera.position.set(p.x + 1.05, p.y + 0.42, p.z + 1.15);
    this.camera.lookAt(p.x, p.y + 0.08, p.z);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.mesh) {
      this.mesh.geometry?.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this._ready = false;
    this._loadPromise = null;
  }
}
