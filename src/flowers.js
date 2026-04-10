import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { WATER_TABLE_DEPTH_M, isTerrainDryAt, sampleLandXZForSpawn } from "./terrain-paint.js";

const _zeroTerrainTex = new THREE.DataTexture(
  new Float32Array([0]),
  1,
  1,
  THREE.RedFormat,
  THREE.FloatType
);
_zeroTerrainTex.needsUpdate = true;

/** Golden ratio φ */
export const PHI = (1 + Math.sqrt(5)) / 2;
/** Golden angle in radians: 360° / φ² ≈ 137.508° */
export const GOLDEN_ANGLE = (2 * Math.PI) / (PHI * PHI);

/** Lengthwise subdivisions for petal mesh (see buildPetalGeometry sy); width profile has sy+1 samples. */
export const FLOWER_PETAL_SY = 8;
/** Samples along petal length for mirror-draw width profile (must match FLOWER_PETAL_SY + 1). */
export const FLOWER_PETAL_WIDTH_PROFILE_LEN = FLOWER_PETAL_SY + 1;

/** Allowed Fibonacci petal counts */
export const FIBONACCI_PETAL_COUNTS = [3, 5, 8, 13, 21, 34];

const PART_STEM = 0;
const PART_PETAL = 1;
const PART_CENTER = 2;

/**
 * @param {number} n
 */
export function nearestFibonacciPetalCount(n) {
  let best = FIBONACCI_PETAL_COUNTS[0];
  let d = Math.abs(n - best);
  for (const f of FIBONACCI_PETAL_COUNTS) {
    const dd = Math.abs(n - f);
    if (dd < d) {
      d = dd;
      best = f;
    }
  }
  return best;
}

/**
 * @param {THREE.BufferGeometry} geo
 * @param {number} partType
 * @param {Float32Array} localH
 * @param {Float32Array} petalAngle
 */
function setCustomAttrs(geo, partType, localH, petalAngle) {
  const c = geo.attributes.position.count;
  geo.setAttribute("aPartType", new THREE.Float32BufferAttribute(new Float32Array(c).fill(partType), 1));
  geo.setAttribute("aLocalH", new THREE.Float32BufferAttribute(localH, 1));
  geo.setAttribute("aPetalAngle", new THREE.Float32BufferAttribute(petalAngle, 1));
}

/**
 * Stem: quad strip along +Y, tapers in X. Vertices 0..stemHeight.
 * @param {number} stemHeight
 * @param {number} stemWidth
 * @param {number} segsY
 */
function buildStemGeometry(stemHeight, stemWidth, segsY = 8) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const localH = new Float32Array((segsY + 1) * 2);
  const petalAngle = new Float32Array((segsY + 1) * 2);

  for (let j = 0; j <= segsY; j++) {
    const t = j / segsY;
    const y = t * stemHeight;
    const w = THREE.MathUtils.lerp(stemWidth, stemWidth * 0.42, t);
    const h = t;
    for (let s = 0; s < 2; s++) {
      const x = (s - 0.5) * w;
      positions.push(x, y, 0);
      normals.push(0, 0, 1);
      uvs.push(s, t);
      const idx = j * 2 + s;
      localH[idx] = h;
      petalAngle[idx] = 0;
    }
  }

  const indices = [];
  for (let j = 0; j < segsY; j++) {
    const a = j * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  setCustomAttrs(geo, PART_STEM, localH, petalAngle);
  return geo;
}

/**
 * One petal: subdivided surface in local space (curved, not a flat quad).
 * Base at origin, length along +Y, width along X. +Z is “out of” the petal before tilt.
 * - Lengthwise: sin curve + tip lift so the blade arcs instead of a rectangle.
 * - Crosswise: cup (edges fold) + slight width taper toward the tip.
 * Then: Rx(tilt), Ry(yaw), translate to stem top.
 * @param {number} petalLength
 * @param {number} petalWidth
 * @param {number} stemHeight
 * @param {number} yaw
 * @param {number} sx
 * @param {number} sy
 * @param {object} [opts]
 * @param {number} [opts.petalTipSharpness] 0 = blunt / rounded tip, 1 = sharp point
 * @param {number} [opts.petalTipRoundness] 0 = straight tip edge, 1 = domed / semicircular tip outline
 * @param {number} [opts.petalBloom] 0 = tight bud, 1 = wide open bloom (tilt + curl)
 * @param {number[] | null | undefined} [widthProfileMult] lengthwise width multipliers (sampled along v)
 */
function buildPetalGeometry(
  petalLength,
  petalWidth,
  stemHeight,
  yaw,
  sx = 6,
  sy = FLOWER_PETAL_SY,
  opts = {},
  widthProfileMult = null
) {
  const positions = [];
  const normals = [];
  const uvs = [];
  /** 0 = closed bud, 1 = very open / flat — tilt uses a slight curve so mid-slider stays natural. */
  const bloom = THREE.MathUtils.clamp(finiteNum(opts.petalBloom, 0.55), 0, 1);
  const bloomCurve = Math.pow(bloom, 1.35);
  const tilt = THREE.MathUtils.lerp(0.2, 0.96, bloomCurve);
  const cT = Math.cos(tilt);
  const sT = Math.sin(tilt);
  const cY = Math.cos(yaw);
  const sY = Math.sin(yaw);

  /** Bowl along the midline (strongest ~mid–upper petal). */
  const CURL_ALONG = THREE.MathUtils.lerp(0.15, 0.018, bloom);
  /** Extra lift at the tip (natural curl forward). */
  const CURL_TIP = THREE.MathUtils.lerp(0.14, 0.008, bloom);
  /** Cross cup: lateral edges fold relative to center (higher near tip). */
  const CUP_EDGE = THREE.MathUtils.lerp(0.11, 0.0025, bloom);
  /** Width narrows toward tip — less taper when open so blades read flatter / wider. */
  const WIDTH_TAPER = THREE.MathUtils.lerp(0.14, 0.04, bloom);

  const tipSharpness = THREE.MathUtils.clamp(finiteNum(opts.petalTipSharpness, 0.25), 0, 1);
  const tipRoundness = THREE.MathUtils.clamp(finiteNum(opts.petalTipRoundness, 0.4), 0, 1);

  const count = (sx + 1) * (sy + 1);
  const localH = new Float32Array(count);
  const petalAngle = new Float32Array(count);

  let i = 0;
  for (let j = 0; j <= sy; j++) {
    const v = j / sy;
    const widthTaper = 1.0 - WIDTH_TAPER * v * v;
    const tipPinch = 1.0 - tipSharpness * Math.pow(v, 2.45);
    const silhouette = sampleWidthProfileAtRow(widthProfileMult, j, sy);
    const widthScale = widthTaper * tipPinch * silhouette;
    const roundBlend = tipRoundness * Math.pow(v, 1.75);
    for (let k = 0; k <= sx; k++) {
      const u = k / sx;
      const pxLinear = (u - 0.5) * petalWidth * widthScale;
      const halfW = petalWidth * widthScale * 0.5;
      const pxRounded = Math.sin(u * Math.PI) * halfW;
      const px = THREE.MathUtils.lerp(pxLinear, pxRounded, roundBlend);
      const py = v * petalLength;
      const edge = Math.abs(u - 0.5) * 2.0;
      let pz = 0;
      pz += Math.sin(v * Math.PI * 0.92) * petalLength * CURL_ALONG;
      pz += Math.pow(v, 2.15) * petalLength * CURL_TIP;
      pz -= edge * edge * petalLength * CUP_EDGE * Math.pow(v, 1.35);
      // Rx(tilt): y' = y*cT - z*sT, z' = y*sT + z*cT
      let x1 = px;
      let y1 = py * cT - pz * sT;
      let z1 = py * sT + pz * cT;
      // Ry(yaw)
      const x2 = x1 * cY + z1 * sY;
      const y2 = y1;
      const z2 = -x1 * sY + z1 * cY;
      positions.push(x2, y2 + stemHeight, z2);
      normals.push(0, 0, 1);
      uvs.push(u, v);
      localH[i] = v;
      petalAngle[i] = yaw;
      i++;
    }
  }

  const indices = [];
  for (let j = 0; j < sy; j++) {
    for (let k = 0; k < sx; k++) {
      const a = j * (sx + 1) + k;
      const b = a + 1;
      const c = a + (sx + 1);
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  setCustomAttrs(geo, PART_PETAL, localH, petalAngle);
  return geo;
}

/**
 * Receptacle: inverted shallow bowl (center dips) + flat underside + outer wall.
 * @param {number} stemHeight
 * @param {number} radius
 * @param {number} thickness vertical span (rim height above stem join)
 * @param {number} bulge01 0 = flat disc, 1 = deep bowl / bulb
 * @param {number} radialSegments
 * @param {number} ringCount rings from center to rim (excluding center point)
 */
function buildCenterDiscGeometry(
  stemHeight,
  radius,
  thickness,
  bulge01 = 0,
  radialSegments = 32,
  ringCount = 14
) {
  const r = Math.max(radius, 0.008);
  const h = Math.max(thickness, 0.0008);
  const gap = 0.002;
  const bulge = THREE.MathUtils.clamp(finiteNum(bulge01, 0.4), 0, 1);
  /** Max vertical dip of bowl center vs rim (inverted dome depth). */
  const maxDip = bulge * r * 0.78;

  const yBottom = stemHeight + gap;
  const yRimTop = yBottom + h;

  const positions = [];
  const uvs = [];
  const indices = [];

  /**
   * @returns {number} vertex index
   */
  function pushVertex(x, y, z, u, v) {
    positions.push(x, y, z);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  }

  /** y(r) = rim − dip × (1 − (r/R)²) — parabolic inverted dome */
  function yAtRadius(rr) {
    const t = rr / r;
    return yRimTop - maxDip * (1 - t * t);
  }

  const yCenter = yAtRadius(0);
  const centerTopIdx = pushVertex(0, yCenter, 0, 0.5, 0.5);

  /** @type {number[][]} ringVerts[j] for j=1..ringCount */
  const ringVerts = [];
  for (let j = 1; j <= ringCount; j++) {
    const rf = j / ringCount;
    const rr = rf * r;
    const y = yAtRadius(rr);
    const row = [];
    for (let i = 0; i < radialSegments; i++) {
      const theta = (i / radialSegments) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const x = rr * cosT;
      const z = rr * sinT;
      const u = 0.5 + 0.5 * (rr / r) * cosT;
      const uv = 0.5 + 0.5 * (rr / r) * sinT;
      row.push(pushVertex(x, y, z, u, uv));
    }
    ringVerts.push(row);
  }

  // Top bowl: fan from center to first ring, then quads between rings
  const ring1 = ringVerts[0];
  for (let i = 0; i < radialSegments; i++) {
    const i1 = (i + 1) % radialSegments;
    indices.push(centerTopIdx, ring1[i1], ring1[i]);
  }
  for (let j = 0; j < ringCount - 1; j++) {
    const inner = ringVerts[j];
    const outer = ringVerts[j + 1];
    for (let i = 0; i < radialSegments; i++) {
      const i1 = (i + 1) % radialSegments;
      const a = inner[i];
      const b = inner[i1];
      const c = outer[i1];
      const d = outer[i];
      indices.push(a, b, c, a, c, d);
    }
  }

  // Flat underside + outer wall
  const centerBotIdx = pushVertex(0, yBottom, 0, 0.5, 0.5);
  const bottomRing = [];
  for (let i = 0; i < radialSegments; i++) {
    const theta = (i / radialSegments) * Math.PI * 2;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const x = r * cosT;
    const z = r * sinT;
    const u = 0.5 + 0.5 * cosT;
    const uv = 0.5 + 0.5 * sinT;
    bottomRing.push(pushVertex(x, yBottom, z, u, uv));
  }

  for (let i = 0; i < radialSegments; i++) {
    const i1 = (i + 1) % radialSegments;
    indices.push(centerBotIdx, bottomRing[i], bottomRing[i1]);
  }

  const rimTop = ringVerts[ringCount - 1];
  for (let i = 0; i < radialSegments; i++) {
    const i1 = (i + 1) % radialSegments;
    indices.push(rimTop[i], rimTop[i1], bottomRing[i1], rimTop[i], bottomRing[i1], bottomRing[i]);
  }

  const c = positions.length / 3;
  const localH = new Float32Array(c);
  const petalAngle = new Float32Array(c);
  for (let vi = 0; vi < c; vi++) {
    const x = positions[vi * 3];
    const z = positions[vi * 3 + 2];
    const rad = Math.sqrt(x * x + z * z) / Math.max(r, 1e-6);
    localH[vi] = THREE.MathUtils.clamp(rad, 0, 1);
    petalAngle[vi] = Math.atan2(z, x);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.setAttribute("aPartType", new THREE.Float32BufferAttribute(new Float32Array(c).fill(PART_CENTER), 1));
  geo.setAttribute("aLocalH", new THREE.Float32BufferAttribute(localH, 1));
  geo.setAttribute("aPetalAngle", new THREE.Float32BufferAttribute(petalAngle, 1));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Merged flower geometry: stem + golden-angle petals + center disc (Fermat-style shading in fragment).
 * @param {object} opts
 * @param {number} opts.petalCount
 * @param {number} opts.petalLength
 * @param {number} opts.stemWidth
 * @param {number} opts.stemHeight
 * @param {number} [opts.centerDiscRadius] receptacle radius (falls back to petalLength × 0.42)
 * @param {number} [opts.centerDiscThickness] vertical thickness of the disc mesh
 * @param {number} [opts.centerDiscBulge] 0 = flat receptacle, 1 = deep inverted dome (bowl)
 * @param {number} [opts.petalBloom] 0 = tight bud, 1 = open bloom
 * @param {(null | { widthProfile?: number[] })[] | null | undefined} [opts.petalShapes] per-petal width profile multipliers
 */
export function buildFlowerGeometry(opts) {
  const petalCount = nearestFibonacciPetalCount(Math.round(finiteNum(opts.petalCount, 8)));
  const petalLength = THREE.MathUtils.clamp(finiteNum(opts.petalLength, 0.35), 0.08, 1.2);
  const stemWidth = THREE.MathUtils.clamp(finiteNum(opts.stemWidth, 0.022), 0.006, 0.12);
  const stemHeight = THREE.MathUtils.clamp(finiteNum(opts.stemHeight, 1.1), 0.35, 4);
  const petalWidth = petalLength / PHI;
  const defaultCenterR = petalLength * 0.42;
  const centerRadius = THREE.MathUtils.clamp(
    finiteNum(opts.centerDiscRadius, defaultCenterR),
    0.02,
    0.65
  );
  const centerThickness = THREE.MathUtils.clamp(
    finiteNum(opts.centerDiscThickness, 0.012),
    0.001,
    0.12
  );
  const centerBulge = THREE.MathUtils.clamp(finiteNum(opts.centerDiscBulge, 0.4), 0, 1);
  const tipOpts = {
    petalTipSharpness: THREE.MathUtils.clamp(finiteNum(opts.petalTipSharpness, 0.25), 0, 1),
    petalTipRoundness: THREE.MathUtils.clamp(finiteNum(opts.petalTipRoundness, 0.4), 0, 1),
    petalBloom: THREE.MathUtils.clamp(finiteNum(opts.petalBloom, 0.55), 0, 1),
  };

  const stem = buildStemGeometry(stemHeight, stemWidth);
  const petalShapes = opts.petalShapes;
  const petals = [];
  for (let i = 0; i < petalCount; i++) {
    const yaw = i * GOLDEN_ANGLE;
    const ps = petalShapes && petalShapes[i];
    let wProf = null;
    if (ps && Array.isArray(ps.widthProfile) && ps.widthProfile.length > 0) {
      wProf = ps.widthProfile;
    }
    petals.push(buildPetalGeometry(petalLength, petalWidth, stemHeight, yaw, 6, FLOWER_PETAL_SY, tipOpts, wProf));
  }
  const center = buildCenterDiscGeometry(stemHeight, centerRadius, centerThickness, centerBulge);

  const merged = mergeGeometries([stem, ...petals, center], true);
  merged.computeVertexNormals();
  return merged;
}

function finiteNum(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

/**
 * @param {number[] | null | undefined} profile
 * @param {number} j row 0..sy (base..tip)
 * @param {number} sy
 */
function sampleWidthProfileAtRow(profile, j, sy) {
  if (!profile || profile.length < 1) return 1;
  const n = profile.length;
  const t = j / sy;
  const f = t * (n - 1);
  const i0 = Math.floor(f);
  const ff = f - i0;
  const i1 = Math.min(i0 + 1, n - 1);
  const a = finiteNum(profile[i0], 1);
  const b = finiteNum(profile[i1], 1);
  const w = THREE.MathUtils.lerp(a, b, ff);
  return THREE.MathUtils.clamp(w, 0.15, 2.35);
}

/** Simple 2D value noise + FBM for field placement (CPU). */
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise2(x, y) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const f = x - i;
  const g = y - j;
  const u = f * f * (3 - 2 * f);
  const v = g * g * (3 - 2 * g);
  return (
    THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(hash2(i, j), hash2(i + 1, j), u),
      THREE.MathUtils.lerp(hash2(i, j + 1), hash2(i + 1, j + 1), u),
      v
    )
  );
}

function fbm2(x, y) {
  let amp = 0.5;
  let sum = 0;
  let xx = x;
  let yy = y;
  for (let o = 0; o < 5; o++) {
    sum += amp * noise2(xx, yy);
    xx *= 2.08;
    yy *= 2.08;
    amp *= 0.5;
  }
  return sum;
}

/**
 * @param {number} clusterDensity 0..1 — higher → more patchy meadows
 */
export function sampleFlowerXZ(spread, clusterDensity, rng) {
  const t = THREE.MathUtils.clamp(clusterDensity, 0, 1);
  const threshold = THREE.MathUtils.lerp(0.12, 0.52, t);
  const maxTry = 48;
  for (let k = 0; k < maxTry; k++) {
    const x = rng(-spread, spread);
    const z = rng(-spread, spread);
    const n = fbm2(x * 0.019 + 17.3, z * 0.019 + 9.1);
    if (n > threshold) return { x, z };
  }
  return { x: rng(-spread, spread), z: rng(-spread, spread) };
}

/**
 * Mirror-draw profiles apply only when {@link petalShapeCustom} is true.
 * @param {object} p flower preset (normalized or raw with same keys)
 * @returns {null | (null | { widthProfile?: number[] })[] | undefined}
 */
export function effectivePetalShapesForGeometry(p) {
  return p.petalShapeCustom === true ? (p.petalShapes ?? null) : null;
}

/**
 * Stable key for geometry-only changes (matches {@link flowerSignature} per-preset fields).
 * @param {object} p flower preset
 */
export function flowerPresetGeometryKey(p) {
  const petalL = THREE.MathUtils.clamp(finiteNum(p.petalLength, 0.35), 0.08, 1.2);
  const defaultCr = petalL * 0.42;
  const custom = p.petalShapeCustom === true;
  return JSON.stringify({
    pc: nearestFibonacciPetalCount(Math.floor(finiteNum(p.petalCount, 8))),
    pl: petalL,
    sw: finiteNum(p.stemWidth, 0.022),
    sh: finiteNum(p.stemHeight, 1.1),
    pts: THREE.MathUtils.clamp(finiteNum(p.petalTipSharpness, 0.25), 0, 1),
    ptr: THREE.MathUtils.clamp(finiteNum(p.petalTipRoundness, 0.4), 0, 1),
    pb: THREE.MathUtils.clamp(finiteNum(p.petalBloom, 0.55), 0, 1),
    cdr: THREE.MathUtils.clamp(finiteNum(p.centerDiscRadius, defaultCr), 0.02, 0.65),
    cdt: THREE.MathUtils.clamp(finiteNum(p.centerDiscThickness, 0.012), 0.001, 0.12),
    cdb: THREE.MathUtils.clamp(finiteNum(p.centerDiscBulge, 0.4), 0, 1),
    psc: custom,
    ps: custom ? (p.petalShapes ?? null) : null,
  });
}

/**
 * @param {THREE.ShaderMaterial} mat
 * @param {object} p flower preset (normalized or raw with same keys as {@link FlowerField})
 * @param {{ speed: number, dirRad: number }} wind
 * @param {number} colorVariation 0–1
 */
export function setFlowerMaterialUniformsFromPreset(mat, p, wind, colorVariation) {
  const petalL = THREE.MathUtils.clamp(finiteNum(p.petalLength, 0.35), 0.08, 1.2);
  const stemH = THREE.MathUtils.clamp(finiteNum(p.stemHeight, 1.1), 0.35, 4);
  const defaultCr = petalL * 0.42;
  const centerR = THREE.MathUtils.clamp(finiteNum(p.centerDiscRadius, defaultCr), 0.02, 0.65);
  mat.uniforms.uStemHeight.value = stemH;
  mat.uniforms.uCenterRadius.value = centerR;
  mat.uniforms.windSpeed.value = wind.speed;
  mat.uniforms.windDirAngle.value = wind.dirRad;
  mat.uniforms.flowerColorVariation.value = colorVariation;
  mat.uniforms.petalBaseColor.value.set(typeof p.color === "string" ? p.color : "#f0e8ff");
  mat.uniforms.petalColorB.value.set(typeof p.color2 === "string" ? p.color2 : "#e8a0d8");
  mat.uniforms.petalColorC.value.set(typeof p.color3 === "string" ? p.color3 : "#ffe8f8");
  mat.uniforms.petalColorD.value.set(typeof p.color4 === "string" ? p.color4 : "#f5c8e8");
  mat.uniforms.petalColorE.value.set(typeof p.color5 === "string" ? p.color5 : "#ffffff");
  mat.uniforms.uPetalGradientBlend.value = THREE.MathUtils.clamp(finiteNum(p.petalGradientBlend, 0.55), 0, 1);
  mat.uniforms.uPetalEdgeNoise.value = THREE.MathUtils.clamp(finiteNum(p.petalEdgeNoise, 0.35), 0, 1);
  mat.uniforms.uPetalWarp.value = THREE.MathUtils.clamp(finiteNum(p.petalWarp, 0.28), 0, 1);
  mat.uniforms.uPetalRipple.value = THREE.MathUtils.clamp(finiteNum(p.petalRipple, 0.22), 0, 1);
  mat.uniforms.centerColor.value.set(typeof p.centerColor === "string" ? p.centerColor : "#4a3020");
  mat.uniforms.pollenColor.value.set(typeof p.pollenColor === "string" ? p.pollenColor : "#e8c830");
  mat.uniforms.uPollenRadius.value = THREE.MathUtils.clamp(finiteNum(p.pollenRadius, 0.38), 0.05, 0.95);
  mat.uniforms.uPollenGrain.value = THREE.MathUtils.clamp(finiteNum(p.pollenGrain, 0.65), 0, 1);
  mat.uniforms.uPollenBrightness.value = THREE.MathUtils.clamp(finiteNum(p.pollenBrightness, 1.05), 0.3, 2);
  mat.uniforms.stemColor.value.set(typeof p.stemColor === "string" ? p.stemColor : "#2d5a28");
}

/**
 * Single-instance preview at origin, white instance color (petal shader tints apply).
 * @param {THREE.InstancedMesh} mesh
 */
export function resetFlowerPreviewInstance(mesh) {
  const dummy = new THREE.Object3D();
  dummy.position.set(0, 0, 0);
  dummy.rotation.set(0, 0, 0);
  dummy.scale.set(1, 1, 1);
  dummy.updateMatrix();
  mesh.setMatrixAt(0, dummy.matrix);
  const white = new THREE.Color(1, 1, 1);
  mesh.setColorAt(0, white);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/**
 * @param {boolean} [allowUnderwater] When true, wetland / emergent species — no underwater discard.
 */
export function createFlowerMaterial(allowUnderwater = false) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        dayPhase: { value: 1 },
        moonDir: { value: new THREE.Vector3(0.48, 0.72, -0.38).normalize() },
        windSpeed: { value: 1 },
        windDirAngle: { value: 0 },
        uStemHeight: { value: 1 },
        uCenterRadius: { value: 0.15 },
        flowerColorVariation: { value: 1 },
        petalBaseColor: { value: new THREE.Color(0xf0e8ff) },
        petalColorB: { value: new THREE.Color(0xe8a0d8) },
        petalColorC: { value: new THREE.Color(0xffe8f8) },
        centerColor: { value: new THREE.Color(0x4a3020) },
        stemColor: { value: new THREE.Color(0x2d5a28) },
        uCelShading: { value: 0 },
        uPetalEdgeNoise: { value: 0.35 },
        uPetalWarp: { value: 0.28 },
        uPetalRipple: { value: 0.22 },
        uPetalGradientBlend: { value: 0.55 },
        petalColorD: { value: new THREE.Color(0xf5c8e8) },
        petalColorE: { value: new THREE.Color(0xffffff) },
        pollenColor: { value: new THREE.Color(0xe8c830) },
        uPollenRadius: { value: 0.38 },
        uPollenGrain: { value: 0.65 },
        uPollenBrightness: { value: 1.05 },
        uTerrainHeightMap: { value: _zeroTerrainTex },
        uReferenceHeightMap: { value: _zeroTerrainTex },
        uWaterTableDepthM: { value: WATER_TABLE_DEPTH_M },
        uAllowUnderwater: { value: allowUnderwater ? 1 : 0 },
        uTerrainHalfExtent: { value: 200 },
        uTerrainSegments: { value: 256 },
        uSlopeMinNormalY: { value: 0.48 },
      },
    ]),
    vertexShader: `
    #include <common>
    #include <fog_pars_vertex>
    uniform float uTime;
    uniform float uStemHeight;
    uniform float windSpeed;
    uniform float windDirAngle;
    uniform float uPetalEdgeNoise;
    uniform float uPetalWarp;
    uniform float uPetalRipple;
    uniform sampler2D uTerrainHeightMap;
    uniform float uTerrainHalfExtent;
    uniform float uTerrainSegments;
    uniform float uSlopeMinNormalY;
    attribute float aPartType;
    attribute float aLocalH;
    attribute float aPetalAngle;
    varying float vPartType;
    varying float vLocalH;
    varying float vPetalAngle;
    varying vec2 vUv;
    varying vec3 vColor;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying float vTerrainOk;

    float vHash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float vNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(vHash(i), vHash(i + vec2(1.0, 0.0)), f.x),
        mix(vHash(i + vec2(0.0, 1.0)), vHash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }
    float vFbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 3; i++) {
        v += a * vNoise(p);
        p *= 2.08;
        a *= 0.5;
      }
      return v;
    }

    // Wind phases use polar coords in wind-aligned XZ so gusts stay isotropic (no world-axis "square" beats).
    vec2 windBendAt(vec2 wxz, float t, float gustStrength) {
      float c0 = cos(windDirAngle);
      float s0 = sin(windDirAngle);
      vec2 w = vec2(wxz.x * c0 - wxz.y * s0, wxz.x * s0 + wxz.y * c0);
      float rho = max(length(w), 1e-4);
      float th = atan(w.y, w.x);
      float g1 = sin(rho * 0.044 + t * 0.51) * 0.5 + 0.5;
      float g2 = sin(th * 2.0 + rho * 0.031 + t * 0.37) * 0.5 + 0.5;
      float g3 = sin(rho * 0.073 - t * 0.33 + th * 0.5) * 0.5 + 0.5;
      float gs = clamp(g1 * 0.42 + g2 * 0.35 + g3 * 0.28 + 0.15, 0.0, 1.0);
      gs = mix(0.06, 1.0, gs * gs);
      float ripple = 0.55 + 0.45 * sin(rho * 0.088 + t * 0.74) * sin(th * 1.3 + t * 0.61);
      gs *= mix(0.65, 1.0, ripple);
      gustStrength *= gs;
      float dir = th + rho * 0.018 + t * 0.72;
      float c = cos(dir);
      float s = sin(dir);
      float ph = th * 1.7 + rho * 0.052;
      float w1 = sin(t * 2.2 + ph);
      float w2 = cos(t * 1.7 + ph * 1.1 + 0.5);
      vec2 bend = vec2(w1 * 0.26 + w2 * 0.09, w2 * 0.20 + w1 * 0.07);
      bend = mat2(c, -s, s, c) * bend;
      return bend * gustStrength;
    }

    void main() {
      vUv = uv;
#ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
#else
      vColor = vec3(1.0);
#endif
      vPartType = aPartType;
      vLocalH = aLocalH;
      vPetalAngle = aPetalAngle;

      vec3 transformed = position;
      vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      float t = uTime * windSpeed;
      vec2 wxz = ip.xz;
      float cW = cos(windDirAngle);
      float sW = sin(windDirAngle);
      vec2 wAlign = vec2(wxz.x * cW - wxz.y * sW, wxz.x * sW + wxz.y * cW);
      float rhoW = length(wAlign);
      float thW = atan(wAlign.y, wAlign.x);
      float vertPhase = t * 3.0 + rhoW * 0.095 + thW * 0.65;
      float gustBase = 1.0;

      if (aPartType < 0.5) {
        float h = clamp(transformed.y / max(uStemHeight, 0.001), 0.0, 1.0);
        vec2 bend = windBendAt(wxz, t, gustBase);
        float hh = h * h;
        transformed.x += bend.x * hh;
        transformed.z += bend.y * hh;
        transformed.y += sin(vertPhase) * 0.035 * h;
      } else {
        vec2 bendTip = windBendAt(wxz, t, gustBase);
        vec3 tipOff = vec3(bendTip.x, sin(vertPhase) * 0.035, bendTip.y);
        transformed += tipOff;
        if (aPartType > 0.5 && aPartType < 1.5) {
          float fl = sin(t * 3.5 + aPetalAngle * 2.0) * 0.055 * aLocalH;
          transformed.x += fl * cos(aPetalAngle);
          transformed.z += fl * sin(aPetalAngle);
          vec2 puv = uv;
          float nn = vFbm(puv * vec2(9.0, 16.0) + wAlign * 0.14 + vec2(t * 0.15, 0.0));
          float edge = abs(puv.x - 0.5) * 2.0;
          float tip = puv.y;
          float edgeW = (0.18 + 0.82 * edge) * tip;
          float lateral = (nn - 0.5) * 2.0;
          transformed.x += lateral * uPetalEdgeNoise * 0.12 * edgeW;
          transformed.z += sin(puv.y * 28.0 + nn * 9.0 + rhoW * 3.2 + thW * 1.4) * uPetalRipple * 0.07 * tip;
          vec3 nrm = normalize(normal);
          transformed += nrm * (nn - 0.5) * uPetalWarp * 0.06 * tip * (0.4 + 0.6 * edge);
        }
      }

      vec4 worldPos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
      vec3 baseWorld = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vec2 tuv =
        vec2(baseWorld.x + uTerrainHalfExtent, -baseWorld.z + uTerrainHalfExtent) /
        (uTerrainHalfExtent * 2.0);
      float du = 1.0 / max(uTerrainSegments, 1.0);
      vec2 tuvC = clamp(tuv, vec2(du), vec2(1.0 - du));
      float h0 = texture2D(uTerrainHeightMap, tuvC).r;
      worldPos.y += h0;
      float cell = (uTerrainHalfExtent * 2.0) / max(uTerrainSegments, 1.0);
      float hL = texture2D(uTerrainHeightMap, tuvC + vec2(-du, 0.0)).r;
      float hR = texture2D(uTerrainHeightMap, tuvC + vec2(du, 0.0)).r;
      float hNz = texture2D(uTerrainHeightMap, tuvC + vec2(0.0, -du)).r;
      float hPz = texture2D(uTerrainHeightMap, tuvC + vec2(0.0, du)).r;
      float dhdx = (hR - hL) / (2.0 * cell);
      float dhdz = (hNz - hPz) / (2.0 * cell);
      vec3 nterrain = normalize(vec3(-dhdx, 1.0, -dhdz));
      vTerrainOk = step(uSlopeMinNormalY, nterrain.y);

      vWorldPos = worldPos.xyz;
      mat3 im = mat3(instanceMatrix);
      vWorldNormal = normalize(im * normal);
      vec4 mvPosition = viewMatrix * worldPos;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
    `,
    fragmentShader: `
    #include <common>
    #include <fog_pars_fragment>
    uniform float dayPhase;
    uniform vec3 moonDir;
    uniform float flowerColorVariation;
    uniform vec3 petalBaseColor;
    uniform vec3 petalColorB;
    uniform vec3 petalColorC;
    uniform vec3 petalColorD;
    uniform vec3 petalColorE;
    uniform float uPetalGradientBlend;
    uniform vec3 centerColor;
    uniform vec3 stemColor;
    uniform vec3 pollenColor;
    uniform float uPollenRadius;
    uniform float uPollenGrain;
    uniform float uPollenBrightness;
    uniform float uPetalEdgeNoise;
    uniform float uCelShading;
    uniform float uCenterRadius;
    uniform sampler2D uTerrainHeightMap;
    uniform sampler2D uReferenceHeightMap;
    uniform float uTerrainHalfExtent;
    uniform float uTerrainSegments;
    uniform float uWaterTableDepthM;
    uniform float uAllowUnderwater;
    varying float vPartType;
    varying float vLocalH;
    varying float vPetalAngle;
    varying vec2 vUv;
    varying vec3 vColor;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    varying float vTerrainOk;

    float fHash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float fNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(fHash(i), fHash(i + vec2(1.0, 0.0)), f.x),
        mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }
    float fFbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * fNoise(p);
        p *= 2.03;
        a *= 0.5;
      }
      return v;
    }

    vec3 petalFiveGradient(float ty, float blendAmt, vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4) {
      float t = clamp(ty, 0.0, 1.0);
      float p = t * 4.0;
      float seg = floor(p);
      float f = fract(p);
      float sm = mix(f, smoothstep(0.0, 1.0, f), blendAmt);
      sm = pow(sm, mix(1.0, 0.65, blendAmt));
      vec3 a = c0;
      vec3 b = c1;
      if (seg > 0.5) { a = c1; b = c2; }
      if (seg > 1.5) { a = c2; b = c3; }
      if (seg > 2.5) { a = c3; b = c4; }
      if (seg > 3.5) { return c4; }
      return mix(a, b, sm);
    }

    void main() {
      if (vTerrainOk < 0.5) {
        discard;
      }
      if (uAllowUnderwater < 0.5) {
        float hspan = uTerrainHalfExtent * 2.0;
        vec2 tuvW =
          vec2(vWorldPos.x + uTerrainHalfExtent, -vWorldPos.z + uTerrainHalfExtent) / hspan;
        float duw = 1.0 / max(uTerrainSegments, 1.0);
        vec2 tuvCw = clamp(tuvW, vec2(duw), vec2(1.0 - duw));
        float terrainBaseY = texture2D(uTerrainHeightMap, tuvCw).r;
        float refH = texture2D(uReferenceHeightMap, tuvCw).r;
        float waterSurfY = refH - uWaterTableDepthM;
        if (terrainBaseY < waterSurfY - 0.03) {
          discard;
        }
      }
      vec3 col = vec3(1.0);

      if (vPartType < 0.5) {
        float g = mix(0.55, 1.0, vUv.y);
        col = stemColor * g;
      } else if (vPartType < 1.5) {
        vec3 grad = petalFiveGradient(
          vUv.y,
          uPetalGradientBlend,
          petalBaseColor,
          petalColorB,
          petalColorC,
          petalColorD,
          petalColorE
        );
        float vein = sin(vUv.y * 38.0 + vUv.x * 14.0 + vPetalAngle * 3.0) * 0.5 + 0.5;
        float edge = abs(vUv.x - 0.5) * 2.0;
        grad *= mix(0.82, 1.08, vein * (0.35 + 0.65 * edge));
        float n = fFbm(vUv * vec2(8.0, 22.0) + vWorldPos.xz * 0.08);
        float n2 = fFbm(vUv * vec2(22.0, 44.0) + vWorldPos.xz * 0.15);
        grad *= mix(0.88, 1.1, n * 0.55);
        grad *= mix(0.94, 1.08, n2 * 0.35 * uPetalEdgeNoise);
        float speck = step(0.72, fNoise(vUv * vec2(90.0, 120.0) + vWorldPos.xz * 0.4)) * 0.08 * uPetalEdgeNoise;
        grad = mix(grad, grad * vec3(1.05, 1.02, 1.08), speck);
        col = grad * vColor;
      } else {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 0.995) discard;
        float pr = uPollenRadius;
        if (r < pr) {
          float pang = atan(p.y, p.x);
          float grain = fFbm(vec2(pang * 5.0, r * 40.0) * uPollenGrain + vWorldPos.xz * 0.5);
          float dots = fNoise(p * 120.0 + grain * 8.0);
          float clump = smoothstep(0.35, 0.85, grain) * uPollenBrightness;
          vec3 pollen = pollenColor * mix(0.62, 1.28, clump);
          pollen *= mix(0.9, 1.12, dots * 0.5 + 0.5);
          pollen += vec3(0.14, 0.11, 0.03) * step(0.86, fNoise(p * 200.0));
          float softEdge = smoothstep(pr - 0.02, pr - 0.12, r);
          pollen = mix(pollen * 1.08, pollen * 0.82, 1.0 - softEdge);
          col = pollen * vColor;
        } else {
          float ang = atan(p.y, p.x);
          float ga = 2.39996322972865332;
          float spiralIdx = ang / ga + r * 34.0;
          float arm = mod(floor(spiralIdx), 2.0);
          float seed = fract(sin(dot(p * 40.0, vec2(12.9898, 78.233))) * 43758.5453);
          float fibMix = mix(0.45, 0.92, arm);
          vec3 base = centerColor * mix(0.55, 1.0, r);
          base *= mix(0.75, 1.15, fibMix);
          base += vec3(0.06, 0.04, 0.02) * seed;
          float ring = sin(r * 80.0 - ang * 2.0) * 0.5 + 0.5;
          base *= mix(0.88, 1.1, ring * 0.25);
          float towardPollen = smoothstep(pr + 0.12, pr, r);
          base = mix(base, pollenColor * 0.35, towardPollen * 0.2);
          col = base * vColor;
        }
      }

      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, flowerColorVariation);

      float shade = mix(0.22, 1.0, dayPhase);
      vec3 moonTint = vec3(0.52, 0.58, 0.72);
      col *= shade * mix(moonTint, vec3(1.0), dayPhase);

      float nightAmt = 1.0 - dayPhase;
      vec3 md = normalize(moonDir);
      vec3 N = normalize(vWorldNormal);
      if (!gl_FrontFacing) N = -N;
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      float ndl = max(dot(N, md), 0.0);
      float spec = pow(ndl, 16.0);
      float viewRim = pow(clamp(1.0 - abs(dot(N, viewDir)), 0.0, 1.0), 2.2);
      vec3 moonSheen = vec3(0.75, 0.82, 1.0);
      col += moonSheen * (spec * 0.45 + viewRim * 0.22 * ndl) * nightAmt;

      vec3 colOut = col;
      if (uCelShading > 0.001) {
        float bands = mix(28.0, 5.0, uCelShading);
        colOut = floor(col * bands + 0.5) / bands;
      }
      gl_FragColor = vec4(colOut, 1.0);
      #include <fog_fragment>
    }
    `,
    fog: true,
    side: THREE.DoubleSide,
  });
}

/**
 * @param {THREE.InstancedMesh} mesh
 * @param {number} count
 * @param {number} spread
 * @param {number} colorVariation
 * @param {number} clusterDensity
 * @param {import("./terrain-paint.js").TerrainHeightField | null} [terrain]
 * @param {boolean} [allowUnderwater] preset tolerates water — skip dry-land check
 * @param {import("./terrain-paint.js").DryLandSpawnPoints | null} [dryLand]
 */
export function fillFlowerInstances(
  mesh,
  count,
  spread,
  colorVariation,
  clusterDensity,
  terrain = null,
  allowUnderwater = false,
  dryLand = null
) {
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  const rng = (a, b) => a + Math.random() * (b - a);
  const cv = THREE.MathUtils.clamp(colorVariation, 0, 1);
  const cd = THREE.MathUtils.clamp(clusterDensity, 0, 1);

  for (let i = 0; i < count; i++) {
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 160; attempt++) {
      const p = sampleFlowerXZ(spread, cd, rng);
      if (!allowUnderwater && terrain && dryLand && dryLand.length > 0) {
        const base = sampleLandXZForSpawn(terrain, dryLand, Math.random, spread);
        x = base.x + p.x * 0.07;
        z = base.z + p.z * 0.07;
        if (!isTerrainDryAt(terrain, x, z)) {
          x = base.x;
          z = base.z;
        }
      } else {
        x = p.x;
        z = p.z;
      }
      if (!terrain || allowUnderwater || isTerrainDryAt(terrain, x, z)) break;
    }
    const rot = Math.random() * Math.PI * 2;
    const s = rng(0.78, 1.22);
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    if (cv < 0.02) {
      tmpColor.setRGB(1, 1, 1);
    } else {
      const amp = 0.12 * cv;
      tmpColor.setRGB(
        THREE.MathUtils.clamp(rng(1 - amp, 1 + amp), 0, 1),
        THREE.MathUtils.clamp(rng(1 - amp, 1 + amp), 0, 1),
        THREE.MathUtils.clamp(rng(1 - amp, 1 + amp), 0, 1)
      );
    }
    mesh.setColorAt(i, tmpColor);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/**
 * @typedef {object} FlowerPreset
 * @property {number} petalCount
 * @property {number} petalLength
 * @property {number} stemWidth
 * @property {number} stemHeight
 * @property {number} clusterDensity
 * @property {number} sharePercent
 * @property {boolean} [toleratesWater] when true, species may grow in water (lily-type); default false
 * @property {string} color
 * @property {string} color2
 * @property {string} color3
 * @property {string} centerColor
 * @property {number} [centerDiscRadius]
 * @property {number} [centerDiscThickness]
 */

export class FlowerField {
  /**
   * @param {THREE.Scene} scene
   * @param {number} spread half-extent on XZ
   */
  constructor(scene, spread) {
    this.scene = scene;
    this.spread = spread;
    /** @type {THREE.Group | null} */
    this.group = null;
    /** @type {(THREE.ShaderMaterial | null)[]} */
    this.matsByType = [];
  }

  /**
   * @param {FlowerPreset[]} presets
   * @param {number[]} counts
   * @param {number} colorVariation
   * @param {{ speed: number, dirRad: number }} wind
   * @param {import("./terrain-paint.js").TerrainHeightField | null} [terrain]
   * @param {import("./terrain-paint.js").DryLandSpawnPoints | null} [dryLand]
   */
  rebuild(presets, counts, colorVariation, wind, terrain = null, dryLand = null) {
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) {
          o.geometry.dispose();
        }
      });
      this.matsByType.forEach((m) => m?.dispose());
      this.matsByType = [];
      this.group = null;
    }

    this.group = new THREE.Group();
    this.group.name = "Flowers";
    this.matsByType = new Array(presets.length).fill(null);

    for (let i = 0; i < presets.length; i++) {
      const n = counts[i] ?? 0;
      if (n < 1) continue;

      const p = presets[i];
      const petalL = THREE.MathUtils.clamp(finiteNum(p.petalLength, 0.35), 0.08, 1.2);
      const defaultCr = petalL * 0.42;
      const centerR = THREE.MathUtils.clamp(
        finiteNum(p.centerDiscRadius, defaultCr),
        0.02,
        0.65
      );
      const geo = buildFlowerGeometry({
        petalCount: p.petalCount,
        petalLength: p.petalLength,
        stemWidth: p.stemWidth,
        stemHeight: p.stemHeight,
        centerDiscRadius: centerR,
        centerDiscThickness: finiteNum(p.centerDiscThickness, 0.012),
        centerDiscBulge: finiteNum(p.centerDiscBulge, 0.4),
        petalTipSharpness: finiteNum(p.petalTipSharpness, 0.25),
        petalTipRoundness: finiteNum(p.petalTipRoundness, 0.4),
        petalBloom: finiteNum(p.petalBloom, 0.55),
        petalShapes: effectivePetalShapesForGeometry(p),
      });

      const toleratesWater = p.toleratesWater === true;
      const mat = createFlowerMaterial(toleratesWater);
      setFlowerMaterialUniformsFromPreset(mat, p, wind, colorVariation);
      const stemH = THREE.MathUtils.clamp(finiteNum(p.stemHeight, 1.1), 0.35, 4);

      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.frustumCulled = false;
      mesh.userData.stemHeight = stemH;
      fillFlowerInstances(
        mesh,
        n,
        this.spread,
        colorVariation,
        finiteNum(p.clusterDensity, 0.45),
        terrain,
        toleratesWater,
        toleratesWater ? null : dryLand
      );
      this.group.add(mesh);
      this.matsByType[i] = mat;
    }

    if (this.group.children.length > 0) {
      this.scene.add(this.group);
    } else {
      this.group = null;
    }
  }

  /**
   * Best flower landing target near a world position (stem top height).
   * @param {number} px
   * @param {number} pz
   * @param {number} py
   * @param {number} maxH max horizontal distance to stem base
   * @param {number} maxV max |py − stemTop| for a match
   * @returns {{ x: number, z: number, yTop: number, stemH: number } | null}
   */
  getNearestFlowerLanding(px, pz, py, maxH, maxV) {
    if (!this.group) return null;
    const dummy = new THREE.Object3D();
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const ch of this.group.children) {
      if (!(ch instanceof THREE.InstancedMesh)) continue;
      const stemH = typeof ch.userData.stemHeight === "number" ? ch.userData.stemHeight : 1.1;
      for (let i = 0; i < ch.count; i++) {
        ch.getMatrixAt(i, dummy.matrix);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
        const bx = dummy.position.x;
        const bz = dummy.position.z;
        const dx = px - bx;
        const dz = pz - bz;
        const distH = Math.sqrt(dx * dx + dz * dz);
        if (distH > maxH) continue;
        const yTop = dummy.position.y + stemH * dummy.scale.y;
        const dv = Math.abs(py - yTop);
        if (dv > maxV) continue;
        const score = distH * 1.1 + dv * 1.8;
        if (score < bestScore) {
          bestScore = score;
          best = { x: bx, z: bz, yTop, stemH };
        }
      }
    }
    return best;
  }
}

/**
 * @param {FlowerPreset[]} presets
 * @param {number} flowerTotal
 * @param {number} cv
 */
/** Geometry / placement only — colors & noise update via uniforms without rebuild. */
export function flowerSignature(presets, flowerTotal, cv) {
  return (
    JSON.stringify(
      presets.map((p) => ({
        pc: nearestFibonacciPetalCount(Math.floor(finiteNum(p.petalCount, 8))),
        pl: finiteNum(p.petalLength, 0.35),
        sw: finiteNum(p.stemWidth, 0.022),
        sh: finiteNum(p.stemHeight, 1.1),
        cd: finiteNum(p.clusterDensity, 0.45),
        share: finiteNum(p.sharePercent, 100),
        pts: THREE.MathUtils.clamp(finiteNum(p.petalTipSharpness, 0.25), 0, 1),
        ptr: THREE.MathUtils.clamp(finiteNum(p.petalTipRoundness, 0.4), 0, 1),
        pb: THREE.MathUtils.clamp(finiteNum(p.petalBloom, 0.55), 0, 1),
        cdr: THREE.MathUtils.clamp(finiteNum(p.centerDiscRadius, 0.147), 0.02, 0.65),
        cdt: THREE.MathUtils.clamp(finiteNum(p.centerDiscThickness, 0.012), 0.001, 0.12),
        cdb: THREE.MathUtils.clamp(finiteNum(p.centerDiscBulge, 0.4), 0, 1),
        psc: p.petalShapeCustom === true,
        ps: p.petalShapeCustom === true ? (p.petalShapes ?? null) : null,
        petalMesh: 3,
        tw: p.toleratesWater === true,
      }))
    ) +
    `|T${flowerTotal}|V${cv.toFixed(4)}`
  );
}
