import * as THREE from "three";
import { applySkyTuningToMaterial, createSkyTuningUniforms, normalizeSkyTuning } from "./sky-settings.js";

/**
 * Inverted sky sphere: night (stars + nebula), day (atmospheric gradient + sun),
 * layered scrolling clouds (wind-driven), storm darkening, lightning flash on clouds.
 * Sun direction moves slowly so sunsets and daytime read as dynamic.
 * Fine-tuning via {@link normalizeSkyTuning} / Settings → Sky (advanced).
 */
export class SkyDome {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    const tuningUniforms = createSkyTuningUniforms();
    const geo = new THREE.SphereGeometry(2000, 48, 32);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        dayPhase: { value: 1 },
        uSunDir: { value: new THREE.Vector3(0.35, 0.75, -0.55).normalize() },
        uStarExponent: { value: 1220 },
        uStarMult: { value: 1.25 },
        uStarCull: { value: 0.68 },
        uNebulaBlue: { value: 1 },
        uNebulaPurple: { value: 1 },
        uWindScroll: { value: new THREE.Vector2(0, 0) },
        uCloudCover: { value: 0.35 },
        uStorm: { value: 0 },
        uLightningFlash: { value: 0 },
        ...tuningUniforms,
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vDir = normalize(wp.xyz - cameraPosition);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float dayPhase;
        uniform vec3 uSunDir;
        uniform float uStarExponent;
        uniform float uStarMult;
        uniform float uStarCull;
        uniform float uNebulaBlue;
        uniform float uNebulaPurple;
        uniform vec2 uWindScroll;
        uniform float uCloudCover;
        uniform float uStorm;
        uniform float uLightningFlash;

        uniform vec3 uZenithColor;
        uniform vec3 uHorizonColor;
        uniform float uDayGradientLow;
        uniform float uDayGradientHigh;

        uniform float uAntiSunStart;
        uniform float uAntiSunEnd;
        uniform float uAntiSunHorizonY0;
        uniform float uAntiSunHorizonY1;
        uniform vec3 uOppCoolColor;
        uniform float uAntiSunBlend;
        uniform float uAntiSunWeight;

        uniform float uSunCorePow;
        uniform float uSunCoreStr;
        uniform float uSunGlowWidePow;
        uniform float uSunGlowWideStr;
        uniform float uSunGlowMidPow;
        uniform float uSunGlowMidStr;
        uniform vec3 uSunDiskColor;

        uniform float uSunsetWarmStr;
        uniform vec3 uSunsetWarmColor;
        uniform float uSunsetPinkStr;
        uniform vec3 uSunsetPinkColor;
        uniform float uSunsetTowardPow;
        uniform float uSunsetMaskLow;
        uniform float uSunsetMaskMid;
        uniform float uSunsetMaskHigh;
        uniform float uSunsetMaskTop;
        uniform float uDuskBlueStr;
        uniform vec3 uDuskBlueColor;
        uniform float uDuskYMin;
        uniform float uDuskYMax;

        uniform float uNightFadeLow;
        uniform float uNightFadeHigh;
        uniform float uNightFadeYOffset;
        uniform float uDayHorizonLow;
        uniform float uDayHorizonHigh;
        uniform float uDayHorizonYMin;
        uniform float uDayHorizonYMax;

        uniform float uStarExponentMul;
        uniform float uStarMultMul;
        uniform float uStarCullMul;

        uniform vec3 uNightGroundTint;
        uniform float uNightGroundStr;

        uniform float uCloudPanoH;
        uniform float uCloudPanoV;
        uniform float uCloudScale1;
        uniform float uCloudScale2;
        uniform float uCloudScale3;
        uniform float uCloudScroll1;
        uniform float uCloudScroll2;
        uniform float uCloudScroll3;
        uniform float uCloudSmoothMin;
        uniform float uCloudSmoothMax;
        uniform float uCloudNoiseW1;
        uniform float uCloudNoiseW2;
        uniform float uCloudNoiseW3;
        uniform float uCloudHorizonBandStart;
        uniform float uCloudHorizonBandEnd;
        uniform float uCloudHorizonBoost;
        uniform float uCloudCoverMul;
        uniform float uCloudStormCoverMul;
        uniform float uCloudAlphaBase;
        uniform float uCloudStormAlpha;
        uniform float uCloudElMin;
        uniform float uCloudElMax;
        uniform float uCloudDayMixMin;
        uniform float uCloudDayMixMax;
        uniform vec3 uCloudLitColor;
        uniform vec3 uCloudShadeBright;
        uniform vec3 uCloudShadeStorm;
        uniform float uCloudDiffuseBase;
        uniform float uCloudDiffuseSun;
        uniform float uCloudStormDiffuse;
        uniform float uStormScreenTint;

        varying vec3 vDir;

        float hash(vec3 p) {
          return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
        }

        float noise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          float n000 = hash(i);
          float n100 = hash(i + vec3(1.0, 0.0, 0.0));
          float n010 = hash(i + vec3(0.0, 1.0, 0.0));
          float n110 = hash(i + vec3(1.0, 1.0, 0.0));
          float n001 = hash(i + vec3(0.0, 0.0, 1.0));
          float n101 = hash(i + vec3(1.0, 0.0, 1.0));
          float n011 = hash(i + vec3(0.0, 1.0, 1.0));
          float n111 = hash(i + vec3(1.0, 1.0, 1.0));
          float nx00 = mix(n000, n100, f.x);
          float nx10 = mix(n010, n110, f.x);
          float nx01 = mix(n001, n101, f.x);
          float nx11 = mix(n011, n111, f.x);
          float nxy0 = mix(nx00, nx10, f.y);
          float nxy1 = mix(nx01, nx11, f.y);
          return mix(nxy0, nxy1, f.z);
        }

        float fbm(vec3 p) {
          float amp = 0.5;
          float sum = 0.0;
          vec3 shift = vec3(100.0);
          for (int i = 0; i < 5; i++) {
            sum += noise(p) * amp;
            p = p * 2.0 + shift;
            amp *= 0.5;
          }
          return sum;
        }

        float fbm2(vec2 p) {
          float amp = 0.5;
          float sum = 0.0;
          vec2 sh = vec2(13.7, 17.3);
          for (int i = 0; i < 5; i++) {
            sum += noise(vec3(p, float(i) * 0.1)) * amp;
            p = p * 2.1 + sh;
            amp *= 0.5;
          }
          return sum;
        }

        void main() {
          vec3 direction = normalize(vDir);
          vec3 sunDir = normalize(uSunDir);

          float starExp = uStarExponent * uStarExponentMul;
          float starM = uStarMult * uStarMultMul;
          float starCull = clamp(uStarCull * uStarCullMul, 0.0, 0.999);

          vec3 d = direction;
          float cr = 0.8192;
          float sr = 0.5736;
          float dx = d.x * cr - d.z * sr;
          float dz = d.x * sr + d.z * cr;
          d = vec3(dx, d.y, dz);
          vec3 q = vec3(d.x * 719.3, d.y * 683.1, d.z * 701.7);
          q += vec3(
            sin(d.y * 31.7 + d.z * 17.2 + d.x * 9.1) * 3.4,
            cos(d.x * 29.1 + d.z * 13.4 + d.y * 11.3) * 3.1,
            sin(d.x * 37.3 + d.y * 22.1 + d.z * 7.9) * 3.3
          );
          vec3 starCell = floor(q);
          float starGrain = hash(starCell);
          float stars = pow(starGrain, starExp) * starM;
          if (hash(starCell + vec3(31.0)) < starCull) stars = 0.0;
          stars *= 0.9 + 0.1 * sin(time * 1.5 + starGrain * 20.0);

          vec3 nebulaPos = direction * 3.0 + time * 0.005;
          float n = fbm(nebulaPos);
          vec3 deepBlue = vec3(0.02, 0.08, 0.32) * fbm(nebulaPos * 1.2 + vec3(0.5, 1.0, 0.3)) * uNebulaBlue;
          vec3 blueNebula = vec3(0.03, 0.1, 0.38) * fbm(nebulaPos * 1.5 + 1.0) * uNebulaBlue;
          vec3 purpleNebula = vec3(0.16, 0.04, 0.38) * fbm(nebulaPos * 2.0 + 5.0) * uNebulaPurple;
          vec3 violetHaze = vec3(0.1, 0.02, 0.22) * fbm(nebulaPos * 2.8 + vec3(2.0, 4.0, 1.0)) * uNebulaPurple;
          float nbMix = (uNebulaBlue + uNebulaPurple) * 0.5;
          vec3 finalNebula = (deepBlue + blueNebula + purpleNebula + violetHaze) * n * 0.58;
          finalNebula += vec3(0.04, 0.02, 0.12) * fbm(nebulaPos * 0.8 + vec3(time * 0.02)) * nbMix;

          vec3 nightColor = finalNebula + vec3(stars);
          float nearGround = 1.0 - smoothstep(-0.12, 0.22, direction.y);
          nightColor += uNightGroundTint * uNightGroundStr * nearGround;

          float y = max(direction.y, -0.15);
          vec3 zenith = uZenithColor;
          vec3 horizonDay = uHorizonColor;
          vec3 dayBase = mix(horizonDay, zenith, smoothstep(uDayGradientLow, uDayGradientHigh, y));

          vec2 xzDir = normalize(vec2(direction.x, direction.z) + 1e-5);
          vec2 xzSun = normalize(vec2(sunDir.x, sunDir.z) + 1e-5);
          float sunAzimuthDot = dot(xzDir, xzSun);
          float antiSun = smoothstep(uAntiSunStart, uAntiSunEnd, sunAzimuthDot);
          float horizonRing = smoothstep(uAntiSunHorizonY0, uAntiSunHorizonY1, y);
          vec3 oppCool = uOppCoolColor;
          dayBase = mix(dayBase, mix(dayBase, oppCool, uAntiSunBlend),
            antiSun * horizonRing * dayPhase * uAntiSunWeight);

          float sunDot = max(dot(direction, sunDir), 0.0);
          float sunDisk =
            pow(sunDot, uSunCorePow) * uSunCoreStr
            + pow(sunDot, uSunGlowWidePow) * uSunGlowWideStr
            + pow(sunDot, uSunGlowMidPow) * uSunGlowMidStr;
          vec3 sunCol = uSunDiskColor * sunDisk;

          float sunH = sunDir.y;
          float sunsetMask =
            smoothstep(uSunsetMaskLow, uSunsetMaskMid, sunH) *
            (1.0 - smoothstep(uSunsetMaskHigh, uSunsetMaskTop, sunH));
          float towardSun = pow(max(dot(direction, sunDir), 0.0), uSunsetTowardPow);
          vec3 sunsetWarm = uSunsetWarmColor * towardSun * sunsetMask * uSunsetWarmStr;
          vec3 sunsetPink = uSunsetPinkColor * towardSun * sunsetMask * uSunsetPinkStr * smoothstep(-0.1, 0.2, direction.y);
          float duskBlue = (1.0 - smoothstep(0.0, 0.35, sunH)) * smoothstep(uDuskYMin, uDuskYMax, direction.y);
          dayBase = mix(dayBase, uDuskBlueColor, duskBlue * uDuskBlueStr);

          vec3 dayColor = dayBase + sunCol + sunsetWarm + sunsetPink;

          float nightFade = smoothstep(uNightFadeLow, uNightFadeHigh, direction.y + uNightFadeYOffset);
          float dayHorizon = mix(uDayHorizonLow, uDayHorizonHigh, smoothstep(uDayHorizonYMin, uDayHorizonYMax, direction.y));

          vec3 skyMix = mix(nightColor, dayColor, dayPhase);
          skyMix *= mix(nightFade, dayHorizon, dayPhase);

          float el = direction.y;
          vec2 pano = vec2(atan(direction.x, direction.z), asin(clamp(el, -1.0, 1.0)));
          pano *= vec2(uCloudPanoH, uCloudPanoV);
          vec2 scroll = uWindScroll;
          vec2 cuv1 = pano * uCloudScale1 + scroll * uCloudScroll1;
          vec2 cuv2 = pano * uCloudScale2 + scroll * uCloudScroll2 + vec2(17.2, 9.4);
          vec2 cuv3 = pano * uCloudScale3 - scroll * uCloudScroll3 + vec2(-31.0, 22.0);

          float n1 = fbm2(cuv1);
          float n2 = fbm2(cuv2);
          float n3 = fbm2(cuv3);
          float cloudRaw = smoothstep(uCloudSmoothMin, uCloudSmoothMax,
            n1 * uCloudNoiseW1 + n2 * uCloudNoiseW2 + n3 * uCloudNoiseW3);
          float horizonBand = smoothstep(uCloudHorizonBandStart, uCloudHorizonBandEnd, 1.0 - abs(el));
          cloudRaw = mix(cloudRaw, min(1.0, cloudRaw * 1.35), horizonBand * uCloudHorizonBoost);

          float cover = clamp(uCloudCover * uCloudCoverMul + uStorm * uCloudStormCoverMul, 0.0, 1.0);
          float clouds = cloudRaw * cover;

          vec3 cloudLit = uCloudLitColor;
          float diffuse = uCloudDiffuseBase + uCloudDiffuseSun * max(dot(vec3(0.0, 1.0, 0.0), sunDir) * 0.5 + 0.5, 0.15);
          diffuse = mix(diffuse, 0.22, uStorm * uCloudStormDiffuse);
          vec3 cloudShade = mix(uCloudShadeBright, uCloudShadeStorm, uStorm);
          vec3 cloudCol = mix(cloudShade, cloudLit * diffuse, n2 * 0.5 + 0.35);
          cloudCol += vec3(0.85, 0.92, 1.0) * uLightningFlash * (0.35 + n1 * 0.4);

          float cloudAlpha = clouds * (uCloudAlphaBase + uStorm * uCloudStormAlpha);
          cloudAlpha *= smoothstep(uCloudElMin, uCloudElMax, el);
          vec3 withClouds = mix(skyMix, cloudCol, cloudAlpha * mix(uCloudDayMixMin, uCloudDayMixMax, dayPhase));

          vec3 stormTint = mix(vec3(1.0), vec3(0.55, 0.58, 0.72), uStorm * uStormScreenTint);
          vec3 finalColor = withClouds * stormTint;

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    /** Scratch for sun direction (toward sun); updated every frame in {@link update}. */
    this._sunDir = new THREE.Vector3(0.35, 0.75, -0.55).normalize();
    /** @type {ReturnType<typeof normalizeSkyTuning>} */
    this._tuning = normalizeSkyTuning({});
  }

  /**
   * @param {unknown} raw partial sky tuning (see `normalizeSkyTuning` in sky-settings.js)
   */
  setSkyTuning(raw) {
    this._tuning = normalizeSkyTuning(raw);
    applySkyTuningToMaterial(this.mesh.material, this._tuning);
  }

  /**
   * Matches the sky shader’s sun disk and drives scene lighting when synced from main.
   * @param {THREE.Vector3} [target]
   * @returns {THREE.Vector3}
   */
  getSunDirection(target) {
    const out = target ?? new THREE.Vector3();
    return out.copy(this._sunDir);
  }

  /**
   * @param {number} elapsedSeconds
   * @param {THREE.Vector3} cameraPosition
   * @param {number} dayPhase
   * @param {object} [w]
   * @param {number} [w.windSpeed]
   * @param {number} [w.windDirRad]
   * @param {number} [w.cloudCover] 0..1
   * @param {number} [w.storm] 0..1 rain/lightning composite
   * @param {number} [w.lightningFlash] 0..1
   */
  update(elapsedSeconds, cameraPosition, dayPhase, w) {
    this.mesh.position.copy(cameraPosition);
    const u = this.mesh.material.uniforms;
    u.time.value = elapsedSeconds;
    u.dayPhase.value = dayPhase;

    const windSpeed = w?.windSpeed ?? 1;
    const windDirRad = w?.windDirRad ?? 0;
    const wx = Math.cos(windDirRad) * windSpeed;
    const wz = Math.sin(windDirRad) * windSpeed;
    u.uWindScroll.value.set(
      wx * elapsedSeconds * 0.018 + wz * elapsedSeconds * 0.007,
      -wx * elapsedSeconds * 0.006 + wz * elapsedSeconds * 0.019
    );

    u.uCloudCover.value = THREE.MathUtils.clamp(w?.cloudCover ?? 0.35, 0, 1);
    u.uStorm.value = THREE.MathUtils.clamp(w?.storm ?? 0, 0, 1);
    u.uLightningFlash.value = THREE.MathUtils.clamp(w?.lightningFlash ?? 0, 0, 1);

    const tun = this._tuning;
    const elev =
      THREE.MathUtils.lerp(tun.sunElevMin, tun.sunElevMax, dayPhase) * (Math.PI * tun.sunElevPiMul);
    const az = elapsedSeconds * tun.sunAzimuthSpeed;
    const c = Math.cos(az);
    const s = Math.sin(az);
    this._sunDir.set(c * Math.cos(elev), Math.sin(elev), s * Math.cos(elev)).normalize();
    u.uSunDir.value.copy(this._sunDir);
  }
}
