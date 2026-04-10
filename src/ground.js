import * as THREE from "three";

const GROUND_EXTENT = 400;

function makeWhitePlaceholderTexture() {
  const data = new Uint8Array([255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 1, 1);
  t.needsUpdate = true;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeSnowCoverPlaceholderTexture() {
  const data = new Uint8Array([0, 0, 0, 255]);
  const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.needsUpdate = true;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * Horizontal ground plane with smooth layered “cloudy” soil (warm + mineral).
 * Same pattern as {@link SkyDome}: ShaderMaterial + fog + toneMapped off.
 *
 * When `terrainHeightField` is provided, uses its subdivided geometry (paintable heightmap).
 */
export class GroundPlane {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Texture | null} map
   * @param {import("./terrain-paint.js").TerrainHeightField | null} [terrainHeightField]
   */
  constructor(scene, map, terrainHeightField = null) {
    const geo =
      terrainHeightField?.geometry ??
      (() => {
        const g = new THREE.PlaneGeometry(GROUND_EXTENT, GROUND_EXTENT, 1, 1);
        g.rotateX(-Math.PI / 2);
        return g;
      })();

    const mat = new THREE.ShaderMaterial({
      fog: true,
      toneMapped: false,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          dayPhase: { value: 1 },
          uGroundBaseColor: { value: new THREE.Color(0x5c4a3a) },
          uOrganic: { value: 1 },
          uMineral: { value: 1 },
          uMapMix: { value: map ? 0.35 : 0 },
          map: { value: map ?? makeWhitePlaceholderTexture() },
          /** 0–1: soil saturation; builds while raining, decays when dry. */
          uWetness: { value: 0 },
          uTime: { value: 0 },
          uCameraPosition: { value: new THREE.Vector3() },
          /** Normalized, direction toward the sun (matches scene sun). */
          uSunDirection: { value: new THREE.Vector3(0.486, 0.811, 0.324) },
          /** Wind direction on XZ (world), normalized. */
          uFlowDir: { value: new THREE.Vector2(1, 0) },
          /** Current rain slider 0–1; boosts shimmer / flow when heavy. */
          uRainIntensity: { value: 0 },
          /** Settled snow depth (DataTexture R 0–1), world XZ mapped like terrain. */
          uSnowCover: { value: makeSnowCoverPlaceholderTexture() },
          uSnowHalfExtent: { value: 200 },
          /** 0–1: camera is in the water column — lift visibility (fog + murk). */
          uUnderwater: { value: 0 },
        },
      ]),
      vertexShader: `
        #include <common>
        #include <fog_pars_vertex>
        varying vec3 vWorldPos;
        varying vec2 vUv;

        void main() {
          vUv = uv;
          vec4 mw = modelMatrix * vec4(position, 1.0);
          vWorldPos = mw.xyz;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        #include <fog_pars_fragment>
        uniform float dayPhase;
        uniform vec3 uGroundBaseColor;
        uniform float uOrganic;
        uniform float uMineral;
        uniform float uMapMix;
        uniform sampler2D map;
        uniform float uWetness;
        uniform float uTime;
        uniform vec3 uCameraPosition;
        uniform vec3 uSunDirection;
        uniform vec2 uFlowDir;
        uniform float uRainIntensity;
        uniform sampler2D uSnowCover;
        uniform float uSnowHalfExtent;
        uniform float uUnderwater;
        varying vec3 vWorldPos;
        varying vec2 vUv;

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

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p *= 2.1;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec2 xz = vWorldPos.xz;
          vec2 gp = xz * 0.012;

          vec2 warp = vec2(
            fbm(gp + vec2(0.0, 2.3)),
            fbm(gp + vec2(3.1, 0.0))
          );
          vec2 cloudy = gp + 0.35 * warp;

          float n = fbm(cloudy);
          float nWarm = fbm(cloudy * 1.15 + vec2(1.7, 4.2));
          float nCool = fbm(cloudy * 1.85 + vec2(9.1, 2.4));
          float nBase = fbm(cloudy * 0.42 + vec2(20.0, 11.0));

          vec3 warm = vec3(0.2, 0.11, 0.045) * nWarm * n * uOrganic;
          vec3 cool = vec3(0.08, 0.075, 0.12) * nCool * (0.55 + 0.45 * n) * uMineral;
          vec3 haze = vec3(0.06, 0.05, 0.04) * fbm(cloudy * 3.2 + vec2(0.5, 1.0)) * (uOrganic + uMineral) * 0.18;

          vec3 base = uGroundBaseColor * (0.48 + 0.52 * nBase);

          vec3 col = base + warm + cool + haze;

          float mm = clamp(uMapMix, 0.0, 1.0);
          if (mm > 0.001) {
            vec3 tex = texture2D(map, vUv).rgb;
            col = mix(col, tex * uGroundBaseColor, mm);
          }

          float wet = clamp(uWetness, 0.0, 1.0);
          float rain = clamp(uRainIntensity, 0.0, 1.0);
          vec3 dryCol = col;
          // Saturated soil: darker + cooler (wet grass / mud)
          vec3 wetted = col * mix(1.0, 0.8, wet);
          wetted = mix(wetted, wetted * vec3(0.88, 0.92, 1.08), wet * 0.32);
          col = mix(dryCol, wetted, wet);

          vec2 uvSnow = vec2(vWorldPos.x + uSnowHalfExtent, -vWorldPos.z + uSnowHalfExtent) / (2.0 * uSnowHalfExtent);
          uvSnow = clamp(uvSnow, vec2(0.002), vec2(0.998));
          // uSnowCover uses NearestFilter: each texel is a flat “pixel tile” of white (stamped by flakes).
          float snowRaw = texture2D(uSnowCover, uvSnow).r;
          float snowPack = pow(snowRaw, 0.5);
          vec3 snowTint = vec3(0.97, 0.98, 1.0);
          col = mix(col, snowTint, snowPack);

          float sunLit = 0.34 + 0.66 * dayPhase;
          float uw = clamp(uUnderwater, 0.0, 1.0);
          sunLit = mix(sunLit, max(sunLit, 0.52 + 0.38 * dayPhase), uw);
          col *= sunLit;

          vec3 V = normalize(uCameraPosition - vWorldPos);
          vec3 N = vec3(0.0, 1.0, 0.0);
          float NdotV = max(dot(N, V), 0.0);
          float fresnel = pow(1.0 - NdotV, 2.6);

          // Fake sky / environment reflection on wet film (stronger at grazing angles)
          vec3 skyRefl = vec3(0.38, 0.48, 0.62);
          float reflAmt = wet * (1.0 - snowPack * 0.55) * (0.28 + 0.42 * rain) * fresnel * (0.25 + 0.75 * dayPhase);
          col += skyRefl * reflAmt;

          // Sun glint on wet surface
          vec3 L = normalize(uSunDirection);
          float spec = pow(max(dot(N, normalize(V + L)), 0.0), 96.0);
          col += vec3(1.0) * spec * wet * (0.12 + 0.18 * rain) * dayPhase;

          // Extra sparkle on snow (crystalline)
          float snowSpec = pow(max(dot(N, normalize(V + L)), 0.0), 72.0) * snowPack * dayPhase;
          col += vec3(0.88, 0.94, 1.0) * snowSpec * 0.42;

          // Flowing shimmer: wind-driven streaks + cells (reads as water sheeting on heavy rain)
          vec2 fdir = normalize(uFlowDir + vec2(0.0001));
          vec2 flow = fdir * uTime * (5.5 + rain * 22.0);
          vec2 sp = vWorldPos.xz * 0.19 + flow;
          float waveA = sin(sp.x * 3.8 + sp.y * 2.1) * cos(sp.x * -1.9 + sp.y * 4.4 + uTime * 2.8);
          float waveB = sin(dot(sp, vec2(5.2, 3.7)) + uTime * 4.2);
          vec2 sp2 = vWorldPos.xz * 0.55 + fdir.yx * uTime * (3.0 + rain * 12.0);
          float cell = sin(sp2.x * 9.0) * sin(sp2.y * 8.0);
          float shimmer = pow(max(0.0, waveA * 0.5 + 0.5 + waveB * 0.15 + cell * 0.06), 2.2);
          shimmer *= wet * (0.35 + 0.65 * rain) * (0.3 + 0.7 * dayPhase);
          col += vec3(0.55, 0.65, 0.82) * shimmer * 0.52;
          col += vec3(0.92, 0.95, 1.0) * spec * shimmer * 0.35;

          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
          gl_FragColor.rgb *= mix(1.0, 1.55, uw);
        }
      `,
    });

    if (map) {
      map.colorSpace = THREE.SRGBColorSpace;
    }

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = 0;
    this.mesh.frustumCulled = false;
    /** @type {THREE.ShaderMaterial} */
    this.material = mat;
    /** Whether a real albedo texture was loaded (else only placeholder). */
    this.hasMap = !!map;
    scene.add(this.mesh);

    if (terrainHeightField) {
      terrainHeightField.attachMesh(this.mesh);
    }
  }

  /**
   * @param {number} dayPhase
   */
  setDayPhase(dayPhase) {
    this.material.uniforms.dayPhase.value = dayPhase;
  }

  /**
   * Wet ground: accumulated saturation, rain sheen, wind flow, and view-dependent reflection.
   * @param {object} o
   * @param {number} o.wetness 0–1
   * @param {number} o.time elapsed seconds (shader animation)
   * @param {THREE.PerspectiveCamera} o.camera
   * @param {number} o.rainIntensity 0–1
   * @param {number} o.windDirRad wind direction (radians, same as weather)
   * @param {THREE.Vector3} o.sunDirection toward sun, will be normalized
   * @param {number} [o.underwater] 0–1 camera in water column (lake / ocean floor visibility)
   */
  updateGroundWeather(o) {
    const u = this.material.uniforms;
    if (u.uUnderwater) u.uUnderwater.value = o.underwater ?? 0;
    if (u.uWetness) u.uWetness.value = o.wetness;
    if (u.uTime) u.uTime.value = o.time;
    if (u.uCameraPosition && o.camera) u.uCameraPosition.value.copy(o.camera.position);
    if (u.uRainIntensity) u.uRainIntensity.value = o.rainIntensity;
    if (u.uFlowDir) {
      u.uFlowDir.value.set(Math.cos(o.windDirRad), Math.sin(o.windDirRad));
    }
    if (u.uSunDirection && o.sunDirection) {
      u.uSunDirection.value.copy(o.sunDirection).normalize();
    }
  }
}

export { GROUND_EXTENT };
