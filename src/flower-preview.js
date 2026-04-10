import * as THREE from "three";
import {
  buildFlowerGeometry,
  createFlowerMaterial,
  effectivePetalShapesForGeometry,
  flowerPresetGeometryKey,
  resetFlowerPreviewInstance,
  setFlowerMaterialUniformsFromPreset,
} from "./flowers.js";

const _moonDir = new THREE.Vector3(0.48, 0.72, -0.38).normalize();

/**
 * Isolated 3D preview of one procedural flower (same geometry + shader as the field).
 * Drag on the canvas to orbit; wheel zooms.
 */
export class FlowerPreview {
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
    /** @type {THREE.InstancedMesh | null} */
    this.mesh = null;
    /** @type {string} */
    this._geoKey = "";
    this._ready = false;
    /** @type {Promise<void> | null} */
    this._loadPromise = null;

    this._orbitYaw = 0.92;
    this._orbitPitch = 0.38;
    this._orbitRadius = 3.1;
    this._target = new THREE.Vector3(0, 0.42, 0);
    this._drag = false;
    this._px = 0;
    this._py = 0;

    this._onPointerMove = (e) => this._handlePointerMove(e);
    this._onPointerUp = () => {
      this._drag = false;
    };
  }

  /**
   * @param {PointerEvent} e
   */
  _handlePointerMove(e) {
    if (!this._drag || !this.canvas) return;
    const dx = e.clientX - this._px;
    const dy = e.clientY - this._py;
    this._px = e.clientX;
    this._py = e.clientY;
    this._orbitYaw = (this._orbitYaw + dx * 0.006) % (Math.PI * 2);
    this._orbitPitch = THREE.MathUtils.clamp(this._orbitPitch + dy * 0.005, -0.12, 1.35);
  }

  async init() {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = (async () => {
      if (!this.canvas) return;

      const renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer = renderer;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a2320);
      scene.fog = new THREE.FogExp2(0x1a2320, 0.055);
      this.scene = scene;

      const cam = new THREE.PerspectiveCamera(42, 1, 0.06, 80);
      this.camera = cam;

      const hemi = new THREE.HemisphereLight(0xb8d4ff, 0x3d3428, 1.05);
      scene.add(hemi);
      const amb = new THREE.AmbientLight(0xffffff, 0.28);
      scene.add(amb);
      const dir = new THREE.DirectionalLight(0xfff4e8, 1.25);
      dir.position.set(0.8, 2.6, 1.2);
      scene.add(dir);
      const fill = new THREE.DirectionalLight(0xa8c8ff, 0.35);
      fill.position.set(-1.2, 1.2, -1.2);
      scene.add(fill);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(14, 14),
        new THREE.MeshStandardMaterial({ color: 0x1e2820, roughness: 0.92, metalness: 0.04 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.02;
      scene.add(ground);

      this.canvas.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        this._drag = true;
        this._px = e.clientX;
        this._py = e.clientY;
      });
      window.addEventListener("pointermove", this._onPointerMove);
      window.addEventListener("pointerup", this._onPointerUp);
      this.canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        const dir = Math.sign(e.deltaY) || 0;
        this._orbitRadius = THREE.MathUtils.clamp(this._orbitRadius * (1 + dir * 0.09), 1.2, 9.5);
      }, { passive: false });

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
   * @param {object} preset normalized flower preset
   * @param {{ speed: number, dirRad: number }} wind
   * @param {number} colorVariation
   */
  setPreset(preset, wind, colorVariation) {
    if (!this._ready || !this.scene) return;

    const key = flowerPresetGeometryKey(preset);
    if (!this.mesh) {
      const geo = buildFlowerGeometry({
        petalCount: preset.petalCount,
        petalLength: preset.petalLength,
        stemWidth: preset.stemWidth,
        stemHeight: preset.stemHeight,
        centerDiscRadius: preset.centerDiscRadius,
        centerDiscThickness: preset.centerDiscThickness,
        centerDiscBulge: preset.centerDiscBulge,
        petalTipSharpness: preset.petalTipSharpness,
        petalTipRoundness: preset.petalTipRoundness,
        petalBloom: preset.petalBloom,
        petalShapes: effectivePetalShapesForGeometry(preset),
      });
      const mat = createFlowerMaterial(false);
      setFlowerMaterialUniformsFromPreset(mat, preset, wind, colorVariation);
      const mesh = new THREE.InstancedMesh(geo, mat, 1);
      mesh.frustumCulled = false;
      resetFlowerPreviewInstance(mesh);
      this.scene.add(mesh);
      this.mesh = mesh;
      this._geoKey = key;
      return;
    }

    if (key !== this._geoKey) {
      this._geoKey = key;
      this.mesh.geometry.dispose();
      this.mesh.geometry = buildFlowerGeometry({
        petalCount: preset.petalCount,
        petalLength: preset.petalLength,
        stemWidth: preset.stemWidth,
        stemHeight: preset.stemHeight,
        centerDiscRadius: preset.centerDiscRadius,
        centerDiscThickness: preset.centerDiscThickness,
        centerDiscBulge: preset.centerDiscBulge,
        petalTipSharpness: preset.petalTipSharpness,
        petalTipRoundness: preset.petalTipRoundness,
        petalBloom: preset.petalBloom,
        petalShapes: effectivePetalShapesForGeometry(preset),
      });
      resetFlowerPreviewInstance(this.mesh);
    }

    const mat = this.mesh.material;
    if (mat instanceof THREE.ShaderMaterial) {
      setFlowerMaterialUniformsFromPreset(mat, preset, wind, colorVariation);
    }
  }

  /**
   * @param {number} t
   * @param {number} dayPhase
   * @param {object} preset normalized
   * @param {{ speed: number, dirRad: number }} wind
   * @param {number} colorVariation
   */
  setFrame(t, dayPhase, preset, wind, colorVariation) {
    if (!this._ready || !this.renderer || !this.scene || !this.camera) return;

    // Must run before checking mesh: first frame creates the InstancedMesh inside setPreset.
    this.setPreset(preset, wind, colorVariation);
    if (!this.mesh) return;

    const mat = this.mesh.material;
    if (mat instanceof THREE.ShaderMaterial && mat.uniforms) {
      if (mat.uniforms.uTime) mat.uniforms.uTime.value = t;
      if (mat.uniforms.dayPhase) mat.uniforms.dayPhase.value = dayPhase;
      if (mat.uniforms.moonDir) mat.uniforms.moonDir.value.copy(_moonDir);
    }

    const cp = Math.cos(this._orbitPitch);
    const sp = Math.sin(this._orbitPitch);
    const cy = Math.cos(this._orbitYaw);
    const sy = Math.sin(this._orbitYaw);
    this.camera.position.set(
      this._target.x + this._orbitRadius * cp * sy,
      this._target.y + this._orbitRadius * sp,
      this._target.z + this._orbitRadius * cp * cy
    );
    this.camera.lookAt(this._target);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerup", this._onPointerUp);
    if (this.mesh) {
      this.mesh.geometry?.dispose();
      this.mesh.material.dispose();
      this.scene?.remove(this.mesh);
      this.mesh = null;
    }
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this._ready = false;
    this._loadPromise = null;
    this._geoKey = "";
  }
}
