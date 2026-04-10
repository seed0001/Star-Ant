import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { normalizeButterflyDynamics } from "./butterfly-dynamics.js";

/**
 * Procedural insect: CPU body shape + noise; shader animates wings/legs with correct normals.
 * aKind: 0 body, 1 wing, 2 leg, 3 eye
 */

const KIND_BODY = 0;
const KIND_WING = 1;
const KIND_LEG = 2;
const KIND_EYE = 3;

/** Model space is authored in ~0.1-unit inches; scale up so field + preview match world meters. */
const INSECT_WORLD_SCALE = 10;

/**
 * @param {import("./butterfly-dynamics.js").ButterflyDynamics} dyn
 */
export function proceduralGeometrySignature(dyn) {
  const d = normalizeButterflyDynamics(dyn);
  return JSON.stringify({
    bl: d.bodyLengthMul,
    bw: d.bodyWidthMul,
    bt: d.bodyThicknessMul,
    sn: d.shapeNoiseAmp,
    sf: d.shapeNoiseFreq,
    sf2: d.shapeNoiseFreq2,
    wp: d.wingPairs,
    lc: d.legCount,
    ex: d.eyeOffsetX,
    ey: d.eyeOffsetY,
    ez: d.eyeOffsetZ,
    es: d.eyeSize,
  });
}

/**
 * @param {THREE.BufferGeometry} geo
 * @param {number} amp
 * @param {number} f1
 * @param {number} f2
 */
function applyBodyNoise(geo, amp, f1, f2) {
  if (amp < 1e-6) return;
  const pos = geo.attributes.position;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nAttr = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = nAttr.getX(i);
    const ny = nAttr.getY(i);
    const nz = nAttr.getZ(i);
    const w =
      Math.sin(x * f1 + y * f2 * 0.73 + z * f1 * 0.41) * 0.55 +
      Math.cos(y * f2 * 1.1 + z * f1 * 0.88) * 0.35 +
      Math.sin((x + z) * f2 * 0.62 + y * f1 * 0.3) * 0.25;
    const r = amp * w;
    pos.setX(i, x + nx * r);
    pos.setY(i, y + ny * r);
    pos.setZ(i, z + nz * r);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/**
 * @param {THREE.BufferGeometry} geo
 * @param {number} kind
 * @param {THREE.Vector3} hinge
 * @param {number} legPhase
 * @param {number} wingSide
 */
function tagKind(geo, kind, hinge, legPhase, wingSide) {
  const n = geo.attributes.position.count;
  const aKind = new Float32Array(n);
  const aHinge = new Float32Array(n * 3);
  const aLegPhase = new Float32Array(n);
  const aWingSide = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    aKind[i] = kind;
    aHinge[i * 3] = hinge.x;
    aHinge[i * 3 + 1] = hinge.y;
    aHinge[i * 3 + 2] = hinge.z;
    aLegPhase[i] = legPhase;
    aWingSide[i] = wingSide;
  }
  geo.setAttribute("aKind", new THREE.BufferAttribute(aKind, 1));
  geo.setAttribute("aHinge", new THREE.BufferAttribute(aHinge, 3));
  geo.setAttribute("aLegPhase", new THREE.BufferAttribute(aLegPhase, 1));
  geo.setAttribute("aWingSide", new THREE.BufferAttribute(aWingSide, 1));
}

/**
 * @param {import("./butterfly-dynamics.js").ButterflyDynamics} dyn
 * @returns {THREE.BufferGeometry}
 */
export function buildProceduralButterflyGeometry(dyn) {
  const d = normalizeButterflyDynamics(dyn);
  const bl = d.bodyLengthMul;
  const bw = d.bodyWidthMul;
  const bt = d.bodyThicknessMul;

  /** @type {THREE.BufferGeometry[]} */
  const parts = [];

  const ab = new THREE.SphereGeometry(0.065 * bw, 16, 12);
  ab.scale(1.15 * bl, 1.35 * bl, 1.05 * bt);
  ab.translate(0, 0.045, 0);
  ab.computeVertexNormals();
  applyBodyNoise(ab, d.shapeNoiseAmp, d.shapeNoiseFreq, d.shapeNoiseFreq2);
  tagKind(ab, KIND_BODY, new THREE.Vector3(0, 0, 0), 0, 0);
  parts.push(ab);

  const thorax = new THREE.SphereGeometry(0.048 * bw, 12, 10);
  thorax.translate(0, 0.11 * bl, 0.022);
  thorax.computeVertexNormals();
  applyBodyNoise(thorax, d.shapeNoiseAmp * 0.85, d.shapeNoiseFreq * 1.05, d.shapeNoiseFreq2 * 1.02);
  tagKind(thorax, KIND_BODY, new THREE.Vector3(0, 0, 0), 0, 0);
  parts.push(thorax);

  const wingPairs = Math.max(1, Math.min(4, Math.round(d.wingPairs)));
  for (let p = 0; p < wingPairs; p++) {
    const scaleW = 0.32 - p * 0.065;
    const scaleH = 0.15 - p * 0.028;
    const zBase = 0.06 + p * 0.028;
    const yBase = 0.075 - p * 0.012;
    const rot = 0.42 - p * 0.08;

    const mkHalf = (side) => {
      const w = new THREE.PlaneGeometry(scaleW, scaleH, 6, 4);
      w.rotateX(-Math.PI / 2);
      w.rotateY(side * rot);
      const hx = -0.02;
      const hy = yBase;
      const hz = side * zBase;
      w.translate(hx, hy, hz);
      w.computeVertexNormals();
      const hinge = new THREE.Vector3(hx, hy, hz);
      tagKind(w, KIND_WING, hinge, 0, side > 0 ? 1 : -1);
      parts.push(w);
    };
    mkHalf(1);
    mkHalf(-1);
  }

  const legCount = Math.max(0, Math.min(12, Math.round(d.legCount)));
  for (let k = 0; k < legCount; k++) {
    const ang = (k / Math.max(legCount, 1)) * Math.PI * 2 + 0.35;
    const cyl = new THREE.CylinderGeometry(0.007, 0.005, 0.12, 6, 2);
    cyl.translate(0, -0.06, 0);
    const r = 0.048;
    const hx = Math.cos(ang) * r + 0.015;
    const hz = Math.sin(ang) * r;
    const hy = 0.025;
    cyl.translate(hx, hy, hz);
    cyl.computeVertexNormals();
    const hinge = new THREE.Vector3(hx * 0.92, hy + 0.028, hz * 0.92);
    tagKind(cyl, KIND_LEG, hinge, k * 1.047, 0);
    parts.push(cyl);
  }

  const es = Math.max(0.004, d.eyeSize);
  const ex = d.eyeOffsetX;
  const ey = d.eyeOffsetY;
  const ez = d.eyeOffsetZ;
  const eyeY = 0.11 * bl + ey;
  const eyeZ = 0.025 + ez;

  const eyeL = new THREE.SphereGeometry(es, 10, 8);
  eyeL.translate(-ex, eyeY, eyeZ);
  eyeL.computeVertexNormals();
  tagKind(eyeL, KIND_EYE, new THREE.Vector3(0, 0, 0), 0, 0);
  parts.push(eyeL);

  const eyeR = new THREE.SphereGeometry(es, 10, 8);
  eyeR.translate(ex, eyeY, eyeZ);
  eyeR.computeVertexNormals();
  tagKind(eyeR, KIND_EYE, new THREE.Vector3(0, 0, 0), 0, 0);
  parts.push(eyeR);

  const merged = mergeGeometries(parts, true);
  merged.scale(INSECT_WORLD_SCALE, INSECT_WORLD_SCALE, INSECT_WORLD_SCALE);
  merged.computeBoundingSphere();
  return merged;
}

/**
 * @deprecated Use buildProceduralButterflyGeometry with dynamics
 */
export function createProceduralButterflyGeometry() {
  return buildProceduralButterflyGeometry(normalizeButterflyDynamics({}));
}

/**
 * @param {THREE.MeshStandardMaterial} mat
 */
export function patchMaterialForProceduralInsect(mat) {
  mat.userData.proceduralInsect = true;
  mat.side = THREE.DoubleSide;
  // Normals are updated inside #include <begin_vertex>, which runs AFTER <normal_vertex> in
  // meshphysical.vert, so per-vertex vNormal would be wrong for wings/legs. Flat shading
  // derives face normals from transformed positions in the fragment path so lighting works.
  mat.flatShading = true;
  mat.emissive = new THREE.Color(0x4a6058);
  mat.emissiveIntensity = 0.42;
  mat.roughness = 0.55;
  mat.metalness = 0.08;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWingBeatFreq = { value: 18 };
    shader.uniforms.uWingStrokeAmp = { value: 0.55 };
    shader.uniforms.uLegSwingFreq = { value: 7 };
    shader.uniforms.uLegSwingAmp = { value: 0.4 };
    shader.uniforms.uWindFlutter = { value: 0 };

    shader.vertexShader =
      `
      attribute float aKind;
      attribute vec3 aHinge;
      attribute float aLegPhase;
      attribute float aWingSide;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
      vec3 transformed = vec3( position );
      float kind = aKind;
      vec3 h = aHinge;
      float t = uTime;

      if (kind > 0.5 && kind < 1.5) {
        float beat = sin(t * uWingBeatFreq);
        if (abs(aWingSide) > 0.01) beat *= -aWingSide;
        float ang = beat * uWingStrokeAmp;
        ang += uWindFlutter * sin(t * 22.0 + transformed.x * 35.0) * 0.07;
        vec3 p = transformed - h;
        float c = cos(ang);
        float s = sin(ang);
        vec3 p2 = vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
        mat3 R = mat3(
          1.0, 0.0, 0.0,
          0.0, c, -s,
          0.0, s, c
        );
        vec3 n2 = R * objectNormal;
        transformed = p2 + h;
        objectNormal = normalize(n2);
      } else if (kind > 1.5 && kind < 2.5) {
        float ang = sin(t * uLegSwingFreq + aLegPhase * 2.1) * uLegSwingAmp;
        vec3 p = transformed - h;
        float c = cos(ang);
        float s = sin(ang);
        vec3 p2 = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
        mat3 R = mat3(
          c, -s, 0.0,
          s, c, 0.0,
          0.0, 0.0, 1.0
        );
        vec3 n2 = R * objectNormal;
        transformed = p2 + h;
        objectNormal = normalize(n2);
      }
      `
    );

    mat.userData.shader = shader;
  };

  mat.customProgramCacheKey = () => "procedural_insect_v6_flat";
}

/**
 * @param {THREE.MeshStandardMaterial} mat
 * @param {number} t
 * @param {number} windSpeed
 * @param {import("./butterfly-dynamics.js").ButterflyDynamics} dyn
 */
export function updateProceduralInsectUniforms(mat, t, windSpeed, dyn) {
  if (!mat.userData.proceduralInsect) return;
  const d = normalizeButterflyDynamics(dyn);
  mat.emissiveIntensity = THREE.MathUtils.clamp(d.insectEmissive, 0, 1.2);
  const shader = mat.userData.shader;
  if (!shader?.uniforms) return;
  const u = shader.uniforms;
  if (u.uTime) u.uTime.value = t;
  if (u.uWingBeatFreq) u.uWingBeatFreq.value = d.wingStrokeFreq;
  if (u.uWingStrokeAmp) u.uWingStrokeAmp.value = d.wingStrokeAmp;
  if (u.uLegSwingFreq) u.uLegSwingFreq.value = d.legSwingFreq;
  if (u.uLegSwingAmp) u.uLegSwingAmp.value = d.legSwingAmp;
  if (u.uWindFlutter) u.uWindFlutter.value = THREE.MathUtils.clamp(windSpeed * 0.35, 0, 1.2);
}
