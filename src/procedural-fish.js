import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { normalizeFishDynamics } from "./fish-dynamics.js";

/**
 * @param {import("./fish-dynamics.js").FishDynamics} dyn
 */
export function proceduralFishSignature(dyn) {
  const d = normalizeFishDynamics(dyn);
  return JSON.stringify({
    bl: d.bodyLengthMul,
    bd: d.bodyDepthMul,
    tl: d.tailLengthMul,
    tw: d.tailWidthMul,
    fs: d.finScale,
    ds: d.dorsalScale,
    sn: d.shapeNoiseAmp,
    sf: d.shapeNoiseFreq,
  });
}

/**
 * @param {THREE.BufferGeometry} geo
 * @param {number} amp
 * @param {number} freq
 */
function applyBodyNoise(geo, amp, freq) {
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
      Math.sin(x * freq + y * freq * 0.71 + z * freq * 0.43) * 0.55 +
      Math.cos(y * freq * 1.1 + z * freq * 0.88) * 0.35;
    const r = amp * w;
    pos.setX(i, x + nx * r);
    pos.setY(i, y + ny * r);
    pos.setZ(i, z + nz * r);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/**
 * @param {import("./fish-dynamics.js").FishDynamics} dynamics
 * @returns {THREE.BufferGeometry}
 */
export function buildFishGeometry(dynamics) {
  const d = normalizeFishDynamics(dynamics);
  const bl = d.bodyLengthMul;
  const bd = d.bodyDepthMul;
  const parts = [];

  const body = new THREE.SphereGeometry(0.1, 18, 14);
  const sb = new THREE.Matrix4().makeScale(bl * 1.75, bd * 0.62, bd * 0.58);
  body.applyMatrix4(sb);
  applyBodyNoise(body, d.shapeNoiseAmp, d.shapeNoiseFreq);
  parts.push(body);

  const tail = new THREE.ConeGeometry(0.055 * d.tailWidthMul, 0.24 * d.tailLengthMul, 12, 1);
  tail.rotateZ(-Math.PI / 2);
  tail.translate(-(bl * 0.16 + 0.12 * d.tailLengthMul), 0, 0);
  parts.push(tail);

  const finL = new THREE.BoxGeometry(0.12 * d.finScale, 0.018, 0.1 * d.finScale);
  finL.rotateZ(0.35);
  finL.translate(0.02, -0.04 * bd, 0.09 * bd);
  parts.push(finL);

  const finR = new THREE.BoxGeometry(0.12 * d.finScale, 0.018, 0.1 * d.finScale);
  finR.rotateZ(-0.35);
  finR.translate(0.02, -0.04 * bd, -0.09 * bd);
  parts.push(finR);

  const dorsal = new THREE.BoxGeometry(0.05 * d.dorsalScale, 0.09 * d.dorsalScale, 0.02);
  dorsal.translate(0.02, 0.07 * bd, 0);
  parts.push(dorsal);

  const eyeL = new THREE.SphereGeometry(0.018, 8, 8);
  eyeL.translate(bl * 0.08, 0.02 * bd, 0.05 * bd);
  parts.push(eyeL);

  const eyeR = new THREE.SphereGeometry(0.018, 8, 8);
  eyeR.translate(bl * 0.08, 0.02 * bd, -0.05 * bd);
  parts.push(eyeR);

  const merged = mergeGeometries(parts, true);
  merged.computeBoundingSphere();
  return merged;
}
