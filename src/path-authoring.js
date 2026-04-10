import * as THREE from "three";

/**
 * In-engine path authoring: anchors (pivots) + radii → smooth curve + variable-thickness tube mesh.
 * No DCC required — data is plain JSON you can version and reload.
 */

/**
 * @typedef {{ position: THREE.Vector3, radius: number }} PathAnchor
 */

/**
 * Linear interpolate radii along anchor indices for parameter u ∈ [0,1].
 * @param {number[]} radii
 * @param {number} u
 * @param {number} numPoints
 */
export function radiusAtU(radii, u, numPoints) {
  const n = numPoints;
  if (n < 1) return 0.05;
  if (n === 1) return Math.max(0.001, radii[0]);
  const uu = THREE.MathUtils.clamp(u, 0, 1) * (n - 1);
  const i0 = Math.floor(uu);
  const i1 = Math.min(i0 + 1, n - 1);
  const t = uu - i0;
  const r0 = Math.max(0.001, radii[i0] ?? 0.05);
  const r1 = Math.max(0.001, radii[i1] ?? 0.05);
  return THREE.MathUtils.lerp(r0, r1, t);
}

/**
 * @param {THREE.Vector3[]} controlPoints
 * @param {boolean} closed
 * @returns {THREE.Curve3}
 */
function makePathCurve(controlPoints, closed) {
  const pts = controlPoints.map((p) => p.clone());
  if (pts.length < 2) {
    return new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(0, 0.1, 0));
  }
  if (pts.length === 2) {
    return new THREE.LineCurve3(pts[0], pts[1]);
  }
  return new THREE.CatmullRomCurve3(pts, closed);
}

/**
 * Tube along curve with radius varying per cross-section (interpolated from anchor radii).
 * Uses the same ring layout as {@link THREE.TubeGeometry}, with per-ring radius.
 *
 * @param {THREE.Vector3[]} controlPoints
 * @param {number[]} radii one radius per anchor (same length as controlPoints)
 * @param {{ closed?: boolean, tubularSegments?: number, radialSegments?: number }} [options]
 * @returns {THREE.BufferGeometry | null}
 */
export function buildVariableTubeGeometry(controlPoints, radii, options = {}) {
  const closed = options.closed ?? false;
  const tubularSegments = Math.max(4, Math.floor(options.tubularSegments ?? 48));
  const radialSegments = Math.max(3, Math.floor(options.radialSegments ?? 10));

  const c = controlPoints.length;
  if (c < 2) return null;
  const rad = radii.slice();
  while (rad.length < c) rad.push(rad[rad.length - 1] ?? 0.05);

  const curve = makePathCurve(controlPoints, closed);
  const frames = curve.computeFrenetFrames(tubularSegments, closed);

  const radiusPerRing = [];
  for (let i = 0; i <= tubularSegments; i++) {
    const u = i / tubularSegments;
    radiusPerRing.push(radiusAtU(rad, u, c));
  }

  const vertices = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const vertex = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const uv = new THREE.Vector2();
  let P = new THREE.Vector3();

  function generateSegment(i) {
    P = curve.getPointAt(i / tubularSegments, P);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const R = radiusPerRing[i];
    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);
      normal.x = cos * N.x + sin * B.x;
      normal.y = cos * N.y + sin * B.y;
      normal.z = cos * N.z + sin * B.z;
      normal.normalize();
      vertices.push(
        P.x + R * normal.x,
        P.y + R * normal.y,
        P.z + R * normal.z
      );
      normals.push(normal.x, normal.y, normal.z);
    }
  }

  for (let j = 0; j < tubularSegments; j++) {
    generateSegment(j);
  }
  generateSegment(closed === false ? tubularSegments : 0);

  for (let i = 0; i <= tubularSegments; i++) {
    for (let j = 0; j <= radialSegments; j++) {
      uv.x = i / tubularSegments;
      uv.y = j / radialSegments;
      uvs.push(uv.x, uv.y);
    }
  }

  for (let j = 1; j <= tubularSegments; j++) {
    for (let i = 1; i <= radialSegments; i++) {
      const a = (radialSegments + 1) * (j - 1) + (i - 1);
      const b = (radialSegments + 1) * j + (i - 1);
      const cIdx = (radialSegments + 1) * j + i;
      const d = (radialSegments + 1) * (j - 1) + i;
      indices.push(a, b, d);
      indices.push(b, cIdx, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * @param {PathAnchor[]} anchors
 */
export function anchorsToJSON(anchors) {
  return anchors.map((a) => ({
    x: a.position.x,
    y: a.position.y,
    z: a.position.z,
    radius: a.radius,
  }));
}

/**
 * @param {unknown} raw
 * @returns {PathAnchor[]}
 */
export function anchorsFromJSON(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const r = /** @type {Record<string, unknown>} */ (o);
    const x = Number(r.x);
    const y = Number(r.y);
    const z = Number(r.z);
    const rad = Number(r.radius);
    if (![x, y, z, rad].every((n) => Number.isFinite(n))) continue;
    out.push({
      position: new THREE.Vector3(x, y, z),
      radius: Math.max(0.001, rad),
    });
  }
  return out;
}
