/**
 * Standalone river lab: separate page, separate WebGL context — not the Grass World map.
 * Water surface + drift particles approximate a directional current with swirl.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const RIVER_WIDTH = 22;
const RIVER_LENGTH = 110;
const WATER_Y = 0;
const BANK_H = 1.8;
const BANK_THICK = 2.2;
/** Max allocated drift points; active count is controlled by the “Water pixels” slider. */
const MAX_PARTICLES = 20000;
const RIVER_HALF_W = RIVER_WIDTH * 0.45;
const RIVER_HALF_L = RIVER_LENGTH * 0.45;

const canvas = document.querySelector("#river-canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("#river-canvas missing");
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6a8a9e);
scene.fog = new THREE.FogExp2(0x8a9cae, 0.012);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(-32, 18, 42);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.49;
controls.target.set(0, 0, 5);

const hemi = new THREE.HemisphereLight(0xc8e0ff, 0x3a4a38, 0.85);
const sun = new THREE.DirectionalLight(0xfff5e0, 1.35);
sun.position.set(-40, 55, 20);
scene.add(hemi, sun);

/** Flow is primarily +Z (downstream along the river). */
const flowDir = new THREE.Vector2(0, 1);

let flowSpeed = 1.2;
let chop = 0.55;
let swirl = 0.35;

// —— River banks (simple boxes) ——
const bankMat = new THREE.MeshStandardMaterial({
  color: 0x4a3d32,
  roughness: 0.92,
  metalness: 0,
});

const bankGeoL = new THREE.BoxGeometry(BANK_THICK, BANK_H, RIVER_LENGTH + 4);
const bankL = new THREE.Mesh(bankGeoL, bankMat);
bankL.position.set(-RIVER_WIDTH / 2 - BANK_THICK / 2, WATER_Y + BANK_H / 2 - 0.4, 0);
scene.add(bankL);

const bankR = new THREE.Mesh(bankGeoL.clone(), bankMat);
bankR.position.set(RIVER_WIDTH / 2 + BANK_THICK / 2, WATER_Y + BANK_H / 2 - 0.4, 0);
scene.add(bankR);

// Pebbly strip under water (riverbed)
const bed = new THREE.Mesh(
  new THREE.PlaneGeometry(RIVER_WIDTH * 0.92, RIVER_LENGTH * 0.98, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x3a3530, roughness: 1, metalness: 0 })
);
bed.rotation.x = -Math.PI / 2;
bed.position.set(0, WATER_Y - 0.85, 0);
scene.add(bed);

// —— Rocks & boulders (in-channel; used for drift deflection) ——
const obstacles = [];
const rockGroup = new THREE.Group();
const rockMat = new THREE.MeshStandardMaterial({
  color: 0x5c5650,
  roughness: 0.92,
  metalness: 0.05,
  flatShading: true,
});

const ROCK_TARGET = 12;
const rockRadiusMin = 0.85;
const rockRadiusMax = 3.1;
for (let attempt = 0; attempt < 80 && obstacles.length < ROCK_TARGET; attempt++) {
  const r = rockRadiusMin + Math.random() * (rockRadiusMax - rockRadiusMin);
  const x = (Math.random() - 0.5) * 2 * (RIVER_HALF_W - r - 0.55);
  const z = (Math.random() - 0.5) * 2 * (RIVER_HALF_L - r - 5);
  if (obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.radius + r + 1.15)) continue;

  obstacles.push({
    x,
    z,
    radius: r * 0.92,
    influence: r * 3.6,
  });

  const geo = new THREE.DodecahedronGeometry(r * 0.52, 0);
  const mesh = new THREE.Mesh(geo, rockMat);
  const lift = r * 0.78;
  mesh.position.set(x, WATER_Y + lift * 0.42 - r * 0.12, z);
  mesh.rotation.set(
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2
  );
  mesh.scale.setScalar(0.9 + Math.random() * 0.22);
  rockGroup.add(mesh);
}
scene.add(rockGroup);

// —— Water ——
const segW = 48;
const segL = 96;
const waterGeo = new THREE.PlaneGeometry(RIVER_WIDTH, RIVER_LENGTH, segW, segL);
waterGeo.rotateX(-Math.PI / 2);

const waterMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    uTime: { value: 0 },
    uFlowDir: { value: flowDir.clone() },
    uFlowSpeed: { value: flowSpeed },
    uChop: { value: chop },
    uCameraPosition: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(-0.4, 0.75, 0.35).normalize() },
    uRiverHalfWidth: { value: RIVER_WIDTH * 0.5 },
  },
  vertexShader: `
    uniform float uTime;
    uniform vec2 uFlowDir;
    uniform float uFlowSpeed;
    uniform float uChop;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vXZ;

    void main() {
      vec3 pos = position;
      vec2 xz = pos.xz;
      vXZ = xz;
      vec2 fdir = normalize(uFlowDir + 1e-5);
      float along = dot(xz, fdir);
      float across = dot(xz, vec2(-fdir.y, fdir.x));

      float t = uTime * uFlowSpeed;
      float w =
        sin(along * 0.55 + t * 2.2) * cos(across * 0.35) * 0.11
        + sin(along * 1.1 + across * 0.9 + t * 3.0) * 0.06
        + sin(across * 2.4 + t * 1.6) * 0.045;
      w *= uChop;
      pos.y += w;

      vec4 mw = modelMatrix * vec4(pos, 1.0);
      vWorldPos = mw.xyz;
      vNormal = normalize(mat3(modelMatrix) * vec3(-0.02 * w, 1.0, -0.015 * w));
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  fragmentShader: `
    #include <common>
    uniform float uTime;
    uniform vec2 uFlowDir;
    uniform float uFlowSpeed;
    uniform float uChop;
    uniform vec3 uCameraPosition;
    uniform vec3 uSunDir;
    uniform float uRiverHalfWidth;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vXZ;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    void main() {
      vec2 fdir = normalize(uFlowDir + 1e-5);
      vec2 perp = vec2(-fdir.y, fdir.x);
      float along = dot(vXZ, fdir);
      float across = dot(vXZ, perp);

      float t = uTime * uFlowSpeed;
      vec2 scrollA = vec2(along, across) * 0.14 + fdir * t * 0.85;
      vec2 scrollB = vec2(along * 1.7, across * 1.2) - perp * t * 0.35;
      float n1 = noise(scrollA);
      float n2 = noise(scrollB + 3.1);
      float ripple = n1 * 0.5 + n2 * 0.5;

      vec3 N = normalize(vNormal + vec3(perp.x, 0.0, perp.y) * ripple * 0.12 * uChop);
      vec3 V = normalize(uCameraPosition - vWorldPos);
      vec3 L = normalize(uSunDir);
      float NdotV = max(dot(N, V), 0.001);
      float fresnel = pow(1.0 - NdotV, 3.2);

      vec3 shallow = vec3(0.12, 0.38, 0.42);
      vec3 deep = vec3(0.04, 0.12, 0.22);
      float distFromBank = (uRiverHalfWidth - abs(across)) / (uRiverHalfWidth * 2.0);
      float foam = smoothstep(0.08, 0.22, 1.0 - distFromBank) * (0.35 + ripple * 0.4);

      vec3 base = mix(deep, shallow, 0.35 + ripple * 0.4);
      base = mix(base, vec3(0.92, 0.95, 0.98), foam * 0.55);

      vec3 sky = vec3(0.55, 0.7, 0.9);
      vec3 col = mix(base, sky, fresnel * 0.55);

      float spec = pow(max(dot(reflect(-L, N), V), 0.0), 64.0);
      col += vec3(1.0) * spec * 0.35;

      float alpha = mix(0.78, 0.92, fresnel);
      gl_FragColor = vec4(col, alpha);
    }
  `,
});

const water = new THREE.Mesh(waterGeo, waterMat);
water.position.y = WATER_Y;
scene.add(water);

function makeSquarePixelTexture() {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 8;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 8, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const pixelTex = makeSquarePixelTexture();

// —— Drift “pixels” (CPU advection: flow + swirl + bend around rocks) ——
const particlePositions = new Float32Array(MAX_PARTICLES * 3);
let driftCount = 4000;

function randomParticleXZ(i3) {
  particlePositions[i3] = (Math.random() - 0.5) * 2 * RIVER_HALF_W;
  particlePositions[i3 + 1] = 0.1 + Math.random() * 0.5;
  particlePositions[i3 + 2] = (Math.random() - 0.5) * 2 * RIVER_HALF_L;
}

for (let i = 0; i < MAX_PARTICLES; i++) {
  randomParticleXZ(i * 3);
}

const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
particleGeo.setDrawRange(0, driftCount);

const particleMat = new THREE.PointsMaterial({
  color: 0xb8e0d8,
  map: pixelTex ?? undefined,
  alphaTest: pixelTex ? 0.01 : 0,
  size: 0.12,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.78,
  depthWrite: false,
});

const driftParticles = new THREE.Points(particleGeo, particleMat);
scene.add(driftParticles);

function flowVelocityAt(x, z, timeMs) {
  const fx = flowDir.x;
  const fz = flowDir.y;
  const len = Math.hypot(fx, fz) || 1;
  const nx = fx / len;
  const nz = fz / len;
  const px = -nz;
  const pz = nx;
  const across = x * px + z * pz;
  const s = swirl * 0.22;
  const wobble = Math.sin(across * 0.07 + timeMs * 0.0003);
  let vx = nx * flowSpeed + px * wobble * s;
  let vz = nz * flowSpeed + pz * wobble * s;

  const perpX = -nz;
  const perpZ = nx;

  for (const o of obstacles) {
    const dx = x - o.x;
    const dz = z - o.z;
    const distSq = dx * dx + dz * dz;
    const R = o.influence;
    if (distSq > R * R || distSq < 1e-10) continue;
    const dist = Math.sqrt(distSq);
    const rdx = dx / dist;
    const rdz = dz / dist;
    const t = 1 - dist / R;
    const turn = t * t;
    const side = Math.sign(dx * perpX + dz * perpZ) || 1;
    vx += side * perpX * turn * flowSpeed * 0.72;
    vz += side * perpZ * turn * flowSpeed * 0.72;
    const push = turn * 0.88;
    vx += rdx * push;
    vz += rdz * push;
  }
  return { vx, vz };
}

function clampParticleOutsideRocks(x, z) {
  let x2 = x;
  let z2 = z;
  for (const o of obstacles) {
    const dx = x2 - o.x;
    const dz = z2 - o.z;
    const dist = Math.hypot(dx, dz);
    const safe = o.radius + 0.16;
    if (dist < safe && dist > 1e-6) {
      const f = safe / dist;
      x2 = o.x + dx * f;
      z2 = o.z + dz * f;
    }
  }
  return { x: x2, z: z2 };
}

function updateParticles(dt, timeMs) {
  const pos = particleGeo.attributes.position.array;
  const n = driftCount;
  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    let x = pos[i3];
    let z = pos[i3 + 2];
    const { vx, vz } = flowVelocityAt(x, z, timeMs);
    x += vx * dt * 3.2;
    z += vz * dt * 3.2;
    if (x < -RIVER_HALF_W) x += RIVER_HALF_W * 2;
    if (x > RIVER_HALF_W) x -= RIVER_HALF_W * 2;
    if (z < -RIVER_HALF_L) z += RIVER_HALF_L * 2;
    if (z > RIVER_HALF_L) z -= RIVER_HALF_L * 2;
    const c = clampParticleOutsideRocks(x, z);
    pos[i3] = c.x;
    pos[i3 + 2] = c.z;
  }
  particleGeo.attributes.position.needsUpdate = true;
}

function setDriftCount(next) {
  const prev = driftCount;
  driftCount = Math.max(0, Math.min(MAX_PARTICLES, Math.floor(next)));
  for (let i = prev; i < driftCount; i++) {
    randomParticleXZ(i * 3);
  }
  particleGeo.setDrawRange(0, driftCount);
}

function bindSliders() {
  const pixelsEl = document.querySelector("#river-pixels");
  const pixelsVal = document.querySelector("#river-pixels-val");
  const flowEl = document.querySelector("#river-flow-speed");
  const flowVal = document.querySelector("#river-flow-speed-val");
  const chopEl = document.querySelector("#river-chop");
  const chopVal = document.querySelector("#river-chop-val");
  const swirlEl = document.querySelector("#river-swirl");
  const swirlVal = document.querySelector("#river-swirl-val");

  const fmt = (n) => Number(n).toFixed(2);
  const fmtInt = (n) => String(Math.round(n));

  if (pixelsEl instanceof HTMLInputElement) {
    pixelsEl.addEventListener("input", () => {
      const v = parseInt(pixelsEl.value, 10);
      setDriftCount(Number.isFinite(v) ? v : 0);
      if (pixelsVal) pixelsVal.textContent = fmtInt(driftCount);
    });
  }

  if (flowEl instanceof HTMLInputElement) {
    flowEl.addEventListener("input", () => {
      flowSpeed = parseFloat(flowEl.value) || 1.2;
      waterMat.uniforms.uFlowSpeed.value = flowSpeed;
      if (flowVal) flowVal.textContent = fmt(flowSpeed);
    });
  }
  if (chopEl instanceof HTMLInputElement) {
    chopEl.addEventListener("input", () => {
      chop = parseFloat(chopEl.value) || 0.55;
      waterMat.uniforms.uChop.value = chop;
      if (chopVal) chopVal.textContent = fmt(chop);
    });
  }
  if (swirlEl instanceof HTMLInputElement) {
    swirlEl.addEventListener("input", () => {
      swirl = parseFloat(swirlEl.value) || 0.35;
      if (swirlVal) swirlVal.textContent = fmt(swirl);
    });
  }
}

bindSliders();
if (pixelsVal instanceof HTMLElement) {
  pixelsVal.textContent = String(driftCount);
}

let lastTime = performance.now();

function animate(time) {
  requestAnimationFrame(animate);
  const dt = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;

  waterMat.uniforms.uTime.value = time * 0.001;
  waterMat.uniforms.uCameraPosition.value.copy(camera.position);
  waterMat.uniforms.uSunDir.value.copy(sun.position).normalize();

  updateParticles(dt, time);
  controls.update();
  renderer.render(scene, camera);
}

requestAnimationFrame(animate);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
