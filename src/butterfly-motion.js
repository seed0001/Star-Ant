import * as THREE from "three";
import { normalizeButterflyDynamics } from "./butterfly-dynamics.js";
/**
 * Same motion as {@link ButterflySwarm.update} for one instance.
 * @param {THREE.Object3D} dummy
 * @param {number} t
 * @param {number} windSpeed
 * @param {number} windDirRad
 * @param {import("./butterfly-dynamics.js").ButterflyDynamics | undefined} dynamics
 * @param {number} bx
 * @param {number} by
 * @param {number} bz
 * @param {number} phase
 * @param {number} scale
 */
export function applyButterflyMotion(
  dummy,
  t,
  windSpeed,
  windDirRad,
  dynamics,
  bx,
  by,
  bz,
  phase,
  scale
) {
  const dyn = normalizeButterflyDynamics(dynamics);
  const wx = Math.cos(windDirRad);
  const wz = Math.sin(windDirRad);
  const drift = dyn.driftBase + windSpeed * dyn.driftWindMul * dyn.windResponse;
  const x =
    bx +
    Math.sin(t * dyn.wanderFreqX + phase) * dyn.wanderAmpX +
    wx * t * drift * dyn.windPushScale;
  const z =
    bz +
    Math.cos(t * dyn.wanderFreqZ + phase * 1.1) * dyn.wanderAmpZ +
    wz * t * drift * dyn.windPushScale;
  const y = by + Math.sin(t * dyn.bobFreq + phase) * dyn.bobAmp;
  const flap = Math.sin(t * dyn.flapFreq + phase * 3) * dyn.flapRotAmp;
  const tilt = THREE.MathUtils.clamp(dyn.pathBodyTilt, 0, 1);
  dummy.position.set(x, y, z);
  dummy.rotation.set(
    flap * dyn.flapPitchMul * tilt,
    phase + t * dyn.yawSpin,
    flap * dyn.flapRollMul * tilt
  );
  dummy.scale.setScalar(scale);
}
