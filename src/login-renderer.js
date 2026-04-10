import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const LOGIN_OCEAN_STORAGE_KEY = "gwLoginOcean";

/** @type {Record<string, number>} */
const LOGIN_OCEAN_DEFAULTS = {
  "login-wave-height": 1,
  "login-wave-freq": 1,
  "login-wave-speed": 1,
  "login-wave-chop": 1,
  "login-water-warmth": 0.35,
  "login-water-sat": 1,
  "login-water-contrast": 1,
  "login-foam": 1,
  "login-spec": 1,
  "login-sky-warmth": 0.2,
  "login-sky-sat": 1,
  "login-bloom": 0.48,
};

/**
 * Dedicated WebGL scene for the login screen — not the game renderer.
 * Cinematic ocean: multi-octave waves, foam, sun specular, sky + sun disc.
 * OrbitControls: look around and zoom in place (no flying).
 * Live sliders for wave shape and color dynamics.
 */
export class LoginRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ centerTextureUrl?: string }} [opts]
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this._opts = opts;
    this._raf = 0;
    this._boundResize = () => this._resize();
    /** @type {AbortController | null} */
    this._oceanUiAbort = null;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    const fogCol = new THREE.Color(0x070d14);
    this.scene.fog = new THREE.FogExp2(fogCol, 0.012);
    this.scene.background = fogCol.clone();
    this._fogColorBase = fogCol.clone();

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    this._orbitTarget = new THREE.Vector3(0, 0.75, 0);
    this.camera.position.set(0, 2.35, 10.5);
    this.camera.lookAt(this._orbitTarget);

    this._sunDir = new THREE.Vector3(-0.72, 0.28, -0.58).normalize();

    const sun = new THREE.DirectionalLight(0xffc9a0, 2.4);
    sun.position.copy(this._sunDir.clone().multiplyScalar(80));
    const rim = new THREE.DirectionalLight(0x4a8cff, 0.28);
    rim.position.set(8, 4, 14);
    const amb = new THREE.AmbientLight(0x1a2840, 0.38);
    this.scene.add(sun, rim, amb);

    this._buildSkyDome();
    this._buildWater();
    this._centerGroup = new THREE.Group();
    this.scene.add(this._centerGroup);
    this._buildCenterPiece(opts.centerTextureUrl ?? "/login-art.png");

    const bloomRes = new THREE.Vector2(window.innerWidth, window.innerHeight);
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloomPass = new UnrealBloomPass(bloomRes, 0.48, 0.38, 0.85);
    this.bloomPass.threshold = 0.2;
    this.composer.addPass(this.bloomPass);

    this._controls = new OrbitControls(this.camera, this.canvas);
    this._controls.target.copy(this._orbitTarget);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.06;
    this._controls.enablePan = false;
    this._controls.minDistance = 2.8;
    this._controls.maxDistance = 26;
    this._controls.minPolarAngle = 0.06;
    this._controls.maxPolarAngle = Math.PI * 0.48;
    this._controls.rotateSpeed = 0.65;
    this._controls.zoomSpeed = 0.85;
    this._controls.update();

    this._clock = new THREE.Clock();
    this._resize();
    window.addEventListener("resize", this._boundResize);

    this._loadOceanUiFromStorage();
    this._bindOceanUi();
    this._applyOceanFromControls();
  }

  _buildSkyDome() {
    const geo = new THREE.SphereGeometry(120, 48, 32);
    const uSunDir = { value: this._sunDir.clone() };
    const uTime = { value: 0 };
    const uSkyWarmth = { value: 0.2 };
    const uSkySat = { value: 1 };
    this._skyUniforms = { uSunDir, uTime, uSkyWarmth, uSkySat };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x0e1828) },
        horizonColor: { value: new THREE.Color(0xff5a28) },
        midColor: { value: new THREE.Color(0x1a3050) },
        bottomColor: { value: new THREE.Color(0x030508) },
        uSunDir,
        uTime,
        uSkyWarmth,
        uSkySat,
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 midColor;
        uniform vec3 bottomColor;
        uniform vec3 uSunDir;
        uniform float uTime;
        uniform float uSkyWarmth;
        uniform float uSkySat;
        varying vec3 vWorldPos;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          vec2 shift = vec2(100.0);
          for (int i = 0; i < 4; i++) {
            v += a * noise(p);
            p = p * 2.02 + shift;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 n = normalize(vWorldPos);
          float h = n.y * 0.5 + 0.5;
          vec3 horizon = mix(horizonColor, vec3(1.0, 0.42, 0.16), uSkyWarmth);
          vec3 c = mix(bottomColor, horizon, smoothstep(0.0, 0.38, h));
          c = mix(c, midColor, smoothstep(0.22, 0.55, h));
          c = mix(c, topColor, smoothstep(0.35, 1.0, h));

          vec2 uv = vec2(atan(n.z, n.x) * 0.12, n.y) + uTime * 0.008;
          float clouds = fbm(uv * 6.0) * 0.22;
          clouds += fbm(uv * 12.0 + 3.0) * 0.1;
          clouds *= smoothstep(0.05, 0.55, h);
          c += vec3(0.85, 0.88, 0.95) * clouds;

          vec3 sunDir = normalize(uSunDir);
          float sunDot = max(dot(n, sunDir), 0.0);
          float disc = pow(sunDot, 420.0);
          float glow = pow(sunDot, 28.0) * 0.55;
          glow += pow(sunDot, 8.0) * 0.08;
          vec3 sunCol = vec3(1.0, 0.88, 0.65);
          c += sunCol * (disc * 2.2 + glow);
          c += vec3(0.95, 0.45, 0.2) * pow(max(dot(n, sunDir), 0.0), 3.0) * 0.12 * smoothstep(0.0, 0.45, h);

          float lu = dot(c, vec3(0.299, 0.587, 0.114));
          c = mix(vec3(lu), c, uSkySat);

          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    this._skyMat = mat;
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  _buildWater() {
    const extent = 420;
    const segs = 160;
    const waterGeo = new THREE.PlaneGeometry(extent, extent, segs, segs);
    waterGeo.rotateX(-Math.PI / 2);

    const uHorizonColor = new THREE.Color(0x0a1018);
    this._waterMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: this._sunDir.clone() },
        uColorDeep: { value: new THREE.Color(0x010408) },
        uColorLit: { value: new THREE.Color(0x0c2240) },
        uHorizonColor: { value: uHorizonColor },
        uCameraPosition: { value: this.camera.position.clone() },
        uWaveAmp: { value: 1 },
        uWaveFreq: { value: 1 },
        uTimeScale: { value: 1 },
        uChop: { value: 1 },
        uFoam: { value: 1 },
        uSpecStrength: { value: 1 },
        uColorSat: { value: 1 },
        uColorContrast: { value: 1 },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uWaveAmp;
        uniform float uWaveFreq;
        uniform float uTimeScale;
        uniform float uChop;

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying float vSteep;

        float waveHeight(vec2 xz) {
          float t = uTime * uTimeScale;
          vec2 p = xz * uWaveFreq;
          float x = p.x, z = p.y;
          float ch = uChop;
          float h = 0.0;
          h += sin(dot(p, vec2(0.07, 0.032)) + t * 0.72) * 0.52;
          h += sin(dot(p, vec2(-0.042, 0.065)) + t * 0.58) * 0.44;
          h += sin(dot(p, vec2(0.092, -0.038)) + t * 0.98) * 0.19;
          h += sin(dot(p, vec2(0.025, 0.018)) + t * 0.42) * 0.26;
          h += sin(x * 0.19 + z * 0.15 + t * 2.15) * 0.09 * ch;
          h += sin(x * 0.38 + t * 3.5) * sin(z * 0.33 + t * 2.8) * 0.046 * ch;
          h += sin(x * 0.65 + z * 0.5 + t * 4.2) * 0.024 * ch;
          h += sin(dot(p, vec2(0.11, 0.09)) + t * 1.35) * 0.08 * ch;
          return h * uWaveAmp;
        }

        void main() {
          float x = position.x;
          float z = position.z;
          float e = 0.55 / max(uWaveFreq, 0.2);
          float h0 = waveHeight(vec2(x, z));
          float dhx = (waveHeight(vec2(x + e, z)) - waveHeight(vec2(x - e, z))) / (2.0 * e);
          float dhz = (waveHeight(vec2(x, z + e)) - waveHeight(vec2(x, z - e))) / (2.0 * e);
          vec3 n = normalize(vec3(-dhx, 1.0, -dhz));
          vec3 transformed = vec3(x, h0, z);
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          vWorldPos = wp.xyz;
          vNormal = normalize(mat3(modelMatrix) * n);
          vViewDir = cameraPosition - wp.xyz;
          vSteep = abs(dhx) + abs(dhz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        uniform vec3 uColorDeep;
        uniform vec3 uColorLit;
        uniform vec3 uHorizonColor;
        uniform vec3 uCameraPosition;
        uniform float uFoam;
        uniform float uSpecStrength;
        uniform float uColorSat;
        uniform float uColorContrast;

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying float vSteep;

        void main() {
          vec3 n = normalize(vNormal);
          vec3 v = normalize(vViewDir);
          vec3 L = normalize(uSunDir);
          float NdotV = max(dot(n, v), 0.001);
          float fres = pow(1.0 - NdotV, 4.0);
          float spec = pow(max(dot(reflect(-L, n), v), 0.0), 72.0);
          float specB = pow(max(dot(reflect(-L, n), v), 0.0), 14.0) * 0.4;
          vec3 base = mix(uColorDeep, uColorLit, fres * 0.78 + 0.1);
          float foamAmt = uFoam;
          float foam = smoothstep(0.14, 0.38, vSteep) * 0.55 * foamAmt;
          foam += smoothstep(0.28, 0.55, vSteep) * 0.25 * foamAmt;
          vec3 sunCol = vec3(1.0, 0.76, 0.48);
          float specMul = uSpecStrength;
          base += sunCol * spec * 1.75 * specMul;
          base += sunCol * specB * specMul;
          base = mix(base, vec3(0.92, 0.95, 0.98), clamp(foam, 0.0, 1.0));
          float dist = length(uCameraPosition - vWorldPos);
          float fog = 1.0 - exp(-dist * 0.006);
          vec3 fc = mix(base, uHorizonColor, fog * 0.42);
          float lum = dot(fc, vec3(0.299, 0.587, 0.114));
          fc = mix(vec3(lum), fc, uColorSat);
          fc = (fc - 0.5) * uColorContrast + 0.5;
          gl_FragColor = vec4(fc, 0.98);
        }
      `,
    });
    const water = new THREE.Mesh(waterGeo, this._waterMat);
    water.position.y = -0.42;
    water.renderOrder = -1;
    this.scene.add(water);
  }

  /**
   * @param {string} textureUrl
   */
  _buildCenterPiece(textureUrl) {
    const frame = new THREE.Group();

    const back = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 3.2, 0.12),
      new THREE.MeshStandardMaterial({
        color: 0x0a0c10,
        metalness: 0.2,
        roughness: 0.85,
        emissive: 0x050608,
        emissiveIntensity: 0.4,
      })
    );
    back.position.z = -0.06;
    frame.add(back);

    const loader = new THREE.TextureLoader();
    const applyTex = (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      const aspect = tex.image.width / Math.max(1, tex.image.height);
      const h = 2.45;
      const w = h * aspect;
      const quad = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({
          map: tex,
          metalness: 0.05,
          roughness: 0.35,
          emissive: 0xffffff,
          emissiveMap: tex,
          emissiveIntensity: 0.15,
        })
      );
      quad.position.z = 0.07;
      frame.add(quad);
    };

    loader.load(
      textureUrl,
      (tex) => applyTex(tex),
      undefined,
      () => {
        const c = document.createElement("canvas");
        c.width = 512;
        c.height = 640;
        const ctx = c.getContext("2d");
        if (ctx) {
          const g = ctx.createLinearGradient(0, 0, 512, 640);
          g.addColorStop(0, "#1a2a40");
          g.addColorStop(0.5, "#ff5a2c");
          g.addColorStop(1, "#050810");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 512, 640);
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          for (let i = 0; i < 40; i++) {
            ctx.fillRect(Math.random() * 512, Math.random() * 640, 2, 80 + Math.random() * 120);
          }
        }
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        applyTex(tex);
      }
    );

    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 4.2),
      new THREE.MeshBasicMaterial({
        color: 0xff6b3a,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    glow.position.z = -0.14;
    frame.add(glow);

    this._centerGroup.add(frame);
    this._centerFrame = frame;
  }

  _loadOceanUiFromStorage() {
    try {
      const raw = sessionStorage.getItem(LOGIN_OCEAN_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return;
      for (const id of Object.keys(LOGIN_OCEAN_DEFAULTS)) {
        const v = data[id];
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        const el = document.getElementById(id);
        if (el instanceof HTMLInputElement) {
          el.value = String(v);
        }
      }
    } catch {
      /* ignore */
    }
  }

  _saveOceanUiToStorage() {
    try {
      /** @type {Record<string, number>} */
      const out = {};
      for (const id of Object.keys(LOGIN_OCEAN_DEFAULTS)) {
        const el = document.getElementById(id);
        if (el instanceof HTMLInputElement) {
          const n = parseFloat(el.value);
          if (Number.isFinite(n)) out[id] = n;
        }
      }
      sessionStorage.setItem(LOGIN_OCEAN_STORAGE_KEY, JSON.stringify(out));
    } catch {
      /* ignore */
    }
  }

  _updateOceanValueLabels() {
    for (const span of document.querySelectorAll(".login-ocean-val[data-for]")) {
      const id = span.getAttribute("data-for");
      if (!id) continue;
      const el = document.getElementById(id);
      if (el instanceof HTMLInputElement) {
        span.textContent = el.value;
      }
    }
  }

  _applyWaterWarmth(warmth) {
    const water = this._waterMat;
    if (!water) return;
    const w = THREE.MathUtils.clamp(warmth, 0, 1);
    const coolDeep = new THREE.Color(0x010408);
    const warmDeep = new THREE.Color(0x0a1822);
    const coolLit = new THREE.Color(0x0c2240);
    const warmLit = new THREE.Color(0x2a5070);
    water.uniforms.uColorDeep.value.lerpColors(coolDeep, warmDeep, w);
    water.uniforms.uColorLit.value.lerpColors(coolLit, warmLit, w);
    const coolFog = new THREE.Color(0x0a1018);
    const warmFog = new THREE.Color(0x140c0a);
    water.uniforms.uHorizonColor.value.lerpColors(coolFog, warmFog, w * 0.5);
    this.scene.fog = new THREE.FogExp2(
      this._fogColorBase.clone().lerp(new THREE.Color(0x100a08), w * 0.35),
      0.012
    );
    this.scene.background.copy(this.scene.fog.color);
  }

  _applyOceanFromControls() {
    const w = this._waterMat;
    const sky = this._skyUniforms;
    if (!w) return;

    const g = (id) => {
      const el = document.getElementById(id);
      if (el instanceof HTMLInputElement) {
        const n = parseFloat(el.value);
        return Number.isFinite(n) ? n : LOGIN_OCEAN_DEFAULTS[id];
      }
      return LOGIN_OCEAN_DEFAULTS[id];
    };

    w.uniforms.uWaveAmp.value = g("login-wave-height");
    w.uniforms.uWaveFreq.value = g("login-wave-freq");
    w.uniforms.uTimeScale.value = g("login-wave-speed");
    w.uniforms.uChop.value = g("login-wave-chop");
    w.uniforms.uFoam.value = g("login-foam");
    w.uniforms.uSpecStrength.value = g("login-spec");
    w.uniforms.uColorSat.value = g("login-water-sat");
    w.uniforms.uColorContrast.value = g("login-water-contrast");
    this._applyWaterWarmth(g("login-water-warmth"));

    if (sky) {
      sky.uSkyWarmth.value = g("login-sky-warmth");
      sky.uSkySat.value = g("login-sky-sat");
    }

    if (this.bloomPass) {
      this.bloomPass.strength = g("login-bloom");
    }

    this._updateOceanValueLabels();
  }

  _bindOceanUi() {
    this._oceanUiAbort?.abort();
    const ac = new AbortController();
    this._oceanUiAbort = ac;
    const { signal } = ac;

    const onChange = () => {
      this._applyOceanFromControls();
      this._saveOceanUiToStorage();
    };

    for (const id of Object.keys(LOGIN_OCEAN_DEFAULTS)) {
      const el = document.getElementById(id);
      if (el instanceof HTMLInputElement) {
        el.addEventListener("input", onChange, { signal });
        el.addEventListener("change", onChange, { signal });
      }
    }

    const reset = document.getElementById("login-ocean-reset");
    reset?.addEventListener(
      "click",
      () => {
        for (const id of Object.keys(LOGIN_OCEAN_DEFAULTS)) {
          const el = document.getElementById(id);
          const def = LOGIN_OCEAN_DEFAULTS[id];
          if (el instanceof HTMLInputElement) {
            el.value = String(def);
          }
        }
        onChange();
      },
      { signal }
    );

    onChange();
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this._controls?.update();
  }

  start() {
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      const t = this._clock.getElapsedTime();

      if (this._waterMat?.uniforms?.uTime) {
        this._waterMat.uniforms.uTime.value = t;
      }
      if (this._waterMat?.uniforms?.uCameraPosition) {
        this._waterMat.uniforms.uCameraPosition.value.copy(this.camera.position);
      }
      if (this._skyUniforms?.uTime) {
        this._skyUniforms.uTime.value = t;
      }

      if (this._centerFrame) {
        this._centerFrame.rotation.y = t * 0.08;
        this._centerFrame.position.y = 0.85 + Math.sin(t * 0.7) * 0.03;
      }

      this._controls?.update();
      this.composer.render();
    };
    this._raf = requestAnimationFrame(loop);
  }

  dispose() {
    this._oceanUiAbort?.abort();
    this._oceanUiAbort = null;
    cancelAnimationFrame(this._raf);
    window.removeEventListener("resize", this._boundResize);
    this._controls?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry?.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
        else m?.dispose?.();
      }
    });
  }
}
