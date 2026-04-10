import * as THREE from "three";
import { CONSTELLATIONS } from "./constellation-data.js";

const R = 1985;

function vecKey(v) {
  return `${v[0].toFixed(5)},${v[1].toFixed(5)},${v[2].toFixed(5)}`;
}

/**
 * Glowing constellation lines + bright points at vertices. Group follows camera (infinite sky).
 */
export class ConstellationOverlay {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "ConstellationOverlay";
    this.scene.add(this.group);

    const linePositions = [];
    const seen = new Set();
    const pointList = [];

    for (const c of CONSTELLATIONS) {
      for (const seg of c.segments) {
        const a = seg[0];
        const b = seg[1];
        const ax = a[0] * R;
        const ay = a[1] * R;
        const az = a[2] * R;
        const bx = b[0] * R;
        const by = b[1] * R;
        const bz = b[2] * R;
        linePositions.push(ax, ay, az, bx, by, bz);

        for (const v of [a, b]) {
          const k = vecKey(v);
          if (!seen.has(k)) {
            seen.add(k);
            pointList.push(v[0] * R, v[1] * R, v[2] * R);
          }
        }
      }
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(linePositions, 3)
    );

    this.lineMaterial = new THREE.LineBasicMaterial({
      color: 0x7ae8ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    this.lines = new THREE.LineSegments(lineGeo, this.lineMaterial);
    this.group.add(this.lines);

    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(pointList, 3)
    );
    this.pointMaterial = new THREE.PointsMaterial({
      color: 0xe8fbff,
      size: 6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    this.points = new THREE.Points(pointGeo, this.pointMaterial);
    this.group.add(this.points);

    this.group.renderOrder = -900;

    /** @type {'hidden' | 'fadeIn' | 'visible' | 'fadeOut'} */
    this.mode = "hidden";
    this.fade = 0;
  }

  /**
   * @param {THREE.Camera} camera
   * @param {number} timeSeconds
   * @param {number} dt
   */
  update(camera, timeSeconds, dt) {
    this.group.position.copy(camera.position);

    const pulse = 0.72 + 0.28 * Math.sin(timeSeconds * 1.25);

    if (this.mode === "visible") {
      this.fade = 1;
    }

    if (this.mode === "fadeIn") {
      this.fade = Math.min(1, this.fade + dt * 1.8);
      if (this.fade >= 1) {
        this.mode = "visible";
        this.fade = 1;
      }
    } else if (this.mode === "fadeOut") {
      this.fade = Math.max(0, this.fade - dt * 2.2);
      if (this.fade <= 0) {
        this.mode = "hidden";
        this.fade = 0;
        this.group.visible = false;
      }
    }

    const base = this.fade * pulse;
    this.lineMaterial.opacity = 0.75 * base;
    this.pointMaterial.opacity = 0.92 * base;
    this.group.visible = this.fade > 0.001 || this.mode !== "hidden";
  }

  /** Show lines with fade-in + glow pulse while visible */
  show() {
    this.mode = "fadeIn";
    this.group.visible = true;
  }

  hide() {
    this.mode = "fadeOut";
  }

  toggle() {
    if (this.mode === "hidden" || this.mode === "fadeOut") {
      this.show();
    } else {
      this.hide();
    }
  }

  isShowing() {
    return this.mode === "visible" || this.mode === "fadeIn" || (this.mode === "fadeOut" && this.fade > 0);
  }

  dispose() {
    this.lines.geometry.dispose();
    this.lineMaterial.dispose();
    this.points.geometry.dispose();
    this.pointMaterial.dispose();
    this.scene.remove(this.group);
  }
}
