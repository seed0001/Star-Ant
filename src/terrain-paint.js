import * as THREE from "three";
import {
  applyWaterShaderMaterialUniforms,
  createWaterShaderUniforms,
  normalizeWaterShaderSettings,
} from "./water-shader-settings.js";
import { WATER_SHADERTOY_SEA_GLSL } from "./water-shadertoy-sea.js";

/** Matches {@link GROUND_EXTENT} in ground.js — world spans [-half, +half] on X and Z. */
export const TERRAIN_WORLD_HALF_EXTENT = 200;

/** 1 world unit = 1 meter — US feet to meters. */
export const FEET_TO_METERS = 0.3048;
/** Maximum dig depth below the reference surface (6 ft). */
export const DIG_MAX_DEPTH_M = 6 * FEET_TO_METERS;
/** Water table lies this far below the reference surface (3 ft). */
export const WATER_TABLE_DEPTH_M = 3 * FEET_TO_METERS;

/**
 * Reference height is only pulled down when carving below this elevation (m), so flat
 * coastlines and dug pools still use “water 3 ft below original surface” behavior, while
 * mountains/volcanoes don’t keep a sky-high water table after you lower the terrain.
 */
const ELEVATED_LAND_WATER_REF_M = 2;

/**
 * Future larger worlds: multiple heightfields could share edge vertices (same segments,
 * matching halfExtent) and be placed by world chunk (cx, cz). Import/export would carry
 * chunk id + neighbor height rows for seamless stitching — not implemented yet.
 */

/**
 * Heightmap + subdivided ground mesh for paintable elevation.
 * Grid is aligned with {@link THREE.PlaneGeometry} after `rotateX(-π/2)`:
 * world X = local plane X, world Z = −local plane Y.
 */
export class TerrainHeightField {
  /**
   * @param {number} [segments] grid segments per axis (256 → 257×257 vertices)
   */
  constructor(segments = 256) {
    this.segments = segments;
    this.halfExtent = TERRAIN_WORLD_HALF_EXTENT;
    this.size = this.halfExtent * 2;
    const n = segments + 1;
    this.gridSize = n;
    /** World-space heights (Y) at each grid vertex. */
    /** Global mean sea level offset (m) from moon tides — matches water shader. */
    this._tideOffsetM = 0;

    this.heights = new Float32Array(n * n);
    /**
     * Highest terrain Y seen at each vertex (dig baseline). Bedrock =
     * reference − {@link DIG_MAX_DEPTH_M}. Water surface = reference − {@link WATER_TABLE_DEPTH_M}.
     */
    this.referenceHeights = new Float32Array(n * n);
    /** Same buffer as R channel for grass/flower sampling. */
    this.dataTexture = new THREE.DataTexture(
      this.heights,
      n,
      n,
      THREE.RedFormat,
      THREE.FloatType
    );
    this.dataTexture.magFilter = THREE.LinearFilter;
    this.dataTexture.minFilter = THREE.LinearFilter;
    this.dataTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.dataTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.dataTexture.flipY = false;
    this.dataTexture.needsUpdate = true;

    /** Same layout as {@link heights}; used for water-table tests in grass/flower shaders. */
    this.referenceDataTexture = new THREE.DataTexture(
      this.referenceHeights,
      n,
      n,
      THREE.RedFormat,
      THREE.FloatType
    );
    this.referenceDataTexture.magFilter = THREE.LinearFilter;
    this.referenceDataTexture.minFilter = THREE.LinearFilter;
    this.referenceDataTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.referenceDataTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.referenceDataTexture.flipY = false;
    this.referenceDataTexture.needsUpdate = true;

    this.geometry = this._buildGeometry();
    this._meshRef = /** @type {THREE.Mesh | null} */ (null);
    /** Throttle expensive normal recompute while dragging. */
    this._normalsFrame = 0;
    /** @type {THREE.Mesh | null} */
    this._waterMesh = null;
  }

  /**
   * Flat seafloor: uniform reference surface at {@code refY} and bed at {@code floorY}
   * so the whole map starts underwater (raise land with terrain paint to build islands).
   * @param {number} [refY] reference surface Y (m), typically 0 (sea-level datum)
   * @param {number} [depthBelowWaterSurfaceM] how far below the local water surface the floor sits
   */
  fillDefaultOceanFloor(refY = 0, depthBelowWaterSurfaceM = 4) {
    const waterY = refY - WATER_TABLE_DEPTH_M;
    const floorY = waterY - Math.max(0.05, depthBelowWaterSurfaceM);
    for (let i = 0; i < this.heights.length; i++) {
      this.referenceHeights[i] = refY;
      this.heights[i] = floorY;
    }
    this.syncGroundMesh(true);
  }

  /**
   * Flat land at {@code refY}: reference and height match everywhere so the map starts dry
   * (water table is below the surface; no ocean by default).
   * @param {number} [refY] ground Y (m), typically 0
   */
  fillDefaultFlatLand(refY = 0) {
    for (let i = 0; i < this.heights.length; i++) {
      this.referenceHeights[i] = refY;
      this.heights[i] = refY;
    }
    this.syncGroundMesh(true);
  }

  /**
   * Half land / half water with a sloped beach between them. Dry land occupies +Z,
   * the ocean occupies −Z, and a smooth transition band forms the shoreline. Reference
   * stays at {@code refY} everywhere so the water surface is a single flat sheet.
   * @param {number} [refY] reference surface / sea-level datum Y (m), typically 0
   * @param {number} [depthBelowWaterSurfaceM] how far below the water surface the ocean floor sits
   */
  fillDefaultHalfBeach(refY = 0, depthBelowWaterSurfaceM = 4) {
    const waterY = refY - WATER_TABLE_DEPTH_M;
    const floorY = waterY - Math.max(0.05, depthBelowWaterSurfaceM);
    const seg = this.segments;
    const h = this.halfExtent;
    const s = this.size;
    const row = seg + 1;
    // Beach runs along world X (constant Z). Fully dry land at/above beachStartZ,
    // fully ocean floor at/below beachEndZ; the span between is the sloped beach.
    const beachStartZ = 0;
    const beachEndZ = -45;
    for (let iz = 0; iz <= seg; iz++) {
      // Same world-Z mapping as paint() / _applyHeightsToGeometry: iz=0 → +halfExtent.
      const wz = h - (iz / seg) * s;
      let t;
      if (wz >= beachStartZ) t = 0;
      else if (wz <= beachEndZ) t = 1;
      else t = (beachStartZ - wz) / (beachStartZ - beachEndZ);
      const smooth = t * t * (3 - 2 * t);
      const heightY = refY + (floorY - refY) * smooth;
      for (let ix = 0; ix <= seg; ix++) {
        const idx = ix + iz * row;
        this.referenceHeights[idx] = refY;
        this.heights[idx] = heightY;
      }
    }
    this.syncGroundMesh(true);
  }

  /**
   * @returns {THREE.BufferGeometry}
   */
  _buildGeometry() {
    const g = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    g.rotateX(-Math.PI / 2);
    this._applyHeightsToGeometry(g);
    g.computeVertexNormals();
    return g;
  }

  /**
   * @param {THREE.BufferGeometry} geo
   */
  _applyHeightsToGeometry(geo) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i);
      const wz = pos.getZ(i);
      pos.setY(i, this.getHeightBilinear(wx, wz));
    }
    pos.needsUpdate = true;
  }

  /**
   * @param {number} wx
   * @param {number} wz
   */
  uvFromWorld(wx, wz) {
    const h = this.halfExtent;
    const s = this.size;
    return {
      u: (wx + h) / s,
      v: (-wz + h) / s,
    };
  }

  /**
   * @param {number} wx
   * @param {number} wz
   */
  /**
   * @param {Float32Array} buf
   * @param {number} wx
   * @param {number} wz
   */
  _sampleBilinear(buf, wx, wz) {
    const { u: u0, v: v0 } = this.uvFromWorld(wx, wz);
    // Edge-clamp so props near the terrain rim still get surface height (formerly OOB → 0 sank meshes).
    const u = THREE.MathUtils.clamp(u0, 0, 1);
    const v = THREE.MathUtils.clamp(v0, 0, 1);
    const seg = this.segments;
    const fx = u * seg;
    const fy = v * seg;
    const x0 = Math.min(Math.floor(fx), seg - 1);
    const y0 = Math.min(Math.floor(fy), seg - 1);
    const x1 = Math.min(x0 + 1, seg);
    const y1 = Math.min(y0 + 1, seg);
    const tx = fx - x0;
    const ty = fy - y0;
    const row = seg + 1;
    const a = buf[x0 + y0 * row];
    const b = buf[x1 + y0 * row];
    const c = buf[x0 + y1 * row];
    const d = buf[x1 + y1 * row];
    const ab = THREE.MathUtils.lerp(a, b, tx);
    const cd = THREE.MathUtils.lerp(c, d, tx);
    return THREE.MathUtils.lerp(ab, cd, ty);
  }

  getHeightBilinear(wx, wz) {
    return this._sampleBilinear(this.heights, wx, wz);
  }

  /**
   * Cheap fingerprint for rebuild signatures (fish, etc.) when terrain edits change water/lakes.
   * @returns {string}
   */
  getQuickFingerprint() {
    const n = this.heights.length;
    let h = 0;
    const step = Math.max(1, Math.floor(n / 128));
    for (let i = 0; i < n; i += step) {
      h += this.heights[i] * (i + 1) * 0.001;
      h += this.referenceHeights[i] * (i + 3) * 0.0007;
    }
    return `${n}_${(h % 10000000).toFixed(3)}`;
  }

  /**
   * Water surface Y (m) at world XZ — reference surface minus water-table depth.
   * @param {number} wx
   * @param {number} wz
   */
  getWaterSurfaceHeightBilinear(wx, wz) {
    return (
      this._sampleBilinear(this.referenceHeights, wx, wz) -
      WATER_TABLE_DEPTH_M +
      this._tideOffsetM
    );
  }

  /**
   * @param {number} meters
   */
  setTideOffsetM(meters) {
    this._tideOffsetM = Number.isFinite(meters) ? meters : 0;
  }

  /**
   * @param {THREE.Mesh} mesh
   */
  attachMesh(mesh) {
    this._meshRef = mesh;
  }

  /**
   * Full sync after edits: positions + optional normals.
   * @param {boolean} [computeNormals]
   */
  syncGroundMesh(computeNormals = true) {
    const mesh = this._meshRef;
    if (!mesh?.geometry) return;
    this._applyHeightsToGeometry(mesh.geometry);
    if (computeNormals) {
      mesh.geometry.computeVertexNormals();
    }
    this.dataTexture.needsUpdate = true;
    this.referenceDataTexture.needsUpdate = true;

    if (this._waterMesh) {
      this._syncWaterMeshGeometry(this._waterMesh.geometry);
      this._waterMesh.visible = this.hasExposedWater();
      const wm = this._waterMesh.material;
      if (wm.uniforms?.uTerrainHeightMap) {
        wm.uniforms.uTerrainHeightMap.value = this.dataTexture;
      }
    }
  }

  /**
   * @param {number} cx
   * @param {number} cz
   * @param {number} radiusWorld
   * @param {"soft" | "sharp" | "level"} mode
   * @param {number} strength 0.2–4
   * @param {number} dt seconds
   * @param {1 | -1} sign raise vs lower (ignored for level)
   * @param {number} minY
   * @param {number} maxY
   */
  paint(
    cx,
    cz,
    radiusWorld,
    mode,
    strength,
    dt,
    sign,
    minY = -85,
    maxY = 120
  ) {
    const h = this.halfExtent;
    const s = this.size;
    const seg = this.segments;
    const row = seg + 1;

    const ix0 = Math.max(0, Math.floor(((cx - radiusWorld) + h) / s * seg));
    const ix1 = Math.min(seg, Math.ceil(((cx + radiusWorld) + h) / s * seg));
    const zMin = cz - radiusWorld;
    const zMax = cz + radiusWorld;
    const iyLo = Math.floor(((-zMax + h) / s) * seg);
    const iyHi = Math.ceil(((-zMin + h) / s) * seg);
    const iz0 = Math.max(0, Math.min(iyLo, iyHi));
    const iz1 = Math.min(seg, Math.max(iyLo, iyHi));

    let targetLevel = 0;
    if (mode === "level") {
      targetLevel = this._sampleSurroundingMean(cx, cz, radiusWorld);
    }

    const rate = mode === "level" ? 2.8 : 18;
    const k = strength * dt * rate;

    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const wx = -h + (ix / seg) * s;
        const wz = -(-h + (iz / seg) * s);
        const d = Math.hypot(wx - cx, wz - cz);
        if (d > radiusWorld) continue;

        const t = 1 - THREE.MathUtils.clamp(d / Math.max(radiusWorld, 1e-6), 0, 1);
        let w = 0;
        if (mode === "soft") {
          w = t * t * (3 - 2 * t);
        } else if (mode === "sharp") {
          w = Math.pow(t, 5.5);
        } else {
          w = t * t * (3 - 2 * t);
        }

        const idx = ix + iz * row;
        if (mode === "level") {
          const cur = this.heights[idx];
          const prevRef = this.referenceHeights[idx];
          let nh = THREE.MathUtils.lerp(cur, targetLevel, w * k * 0.35);
          this.referenceHeights[idx] = Math.max(this.referenceHeights[idx], nh);
          const bedrock = this.referenceHeights[idx] - DIG_MAX_DEPTH_M;
          nh = Math.max(bedrock, nh);
          if (nh < prevRef && prevRef > ELEVATED_LAND_WATER_REF_M) {
            this.referenceHeights[idx] = Math.max(nh, prevRef - DIG_MAX_DEPTH_M);
          }
          this.heights[idx] = THREE.MathUtils.clamp(nh, minY, maxY);
        } else {
          let nh = this.heights[idx] + sign * k * w;
          const prevRef = this.referenceHeights[idx];
          this.referenceHeights[idx] = Math.max(this.referenceHeights[idx], nh);
          const bedrock = this.referenceHeights[idx] - DIG_MAX_DEPTH_M;
          nh = Math.max(bedrock, nh);
          if (sign < 0 && prevRef > ELEVATED_LAND_WATER_REF_M && nh < prevRef) {
            this.referenceHeights[idx] = Math.max(nh, prevRef - DIG_MAX_DEPTH_M);
          }
          this.heights[idx] = THREE.MathUtils.clamp(nh, minY, maxY);
        }
      }
    }

    this._normalsFrame++;
    const doNormals = this._normalsFrame % 4 === 0;
    this.syncGroundMesh(doNormals);
  }

  /** Call on pointer up so normals match the final heightmap. */
  finalizeStroke() {
    this.syncGroundMesh(true);
  }

  /**
   * @returns {Float32Array}
   */
  snapshotHeights() {
    return new Float32Array(this.heights);
  }

  /**
   * Full snapshot for undo (heights + dig reference).
   * @returns {{ heights: Float32Array, referenceHeights: Float32Array }}
   */
  snapshotTerrainState() {
    return {
      heights: new Float32Array(this.heights),
      referenceHeights: new Float32Array(this.referenceHeights),
    };
  }

  /**
   * @param {{ heights: Float32Array, referenceHeights?: Float32Array } | null} state
   * @returns {boolean}
   */
  restoreTerrainState(state) {
    if (!state?.heights || state.heights.length !== this.heights.length) {
      return false;
    }
    this.heights.set(state.heights);
    if (state.referenceHeights && state.referenceHeights.length === this.referenceHeights.length) {
      this.referenceHeights.set(state.referenceHeights);
    } else {
      this.referenceHeights.set(state.heights);
    }
    this.syncGroundMesh(true);
    return true;
  }

  /**
   * @param {Float32Array} data
   * @param {Float32Array | null} [referenceData]
   * @returns {boolean}
   */
  restoreHeights(data, referenceData = null) {
    return this.restoreTerrainState({
      heights: data,
      referenceHeights: referenceData ?? undefined,
    });
  }

  /**
   * True where terrain dips below the local water surface (reference − 3 ft).
   */
  hasExposedWater() {
    for (let i = 0; i < this.heights.length; i++) {
      const ref = this.referenceHeights[i];
      const waterY = ref - WATER_TABLE_DEPTH_M;
      if (this.heights[i] < waterY - 1e-4) return true;
    }
    return false;
  }

  /**
   * True where any terrain sits at/above the local water surface — i.e. there is dry
   * ground to place plants and land critters on. Complements {@link hasExposedWater}.
   */
  hasDryLand() {
    for (let i = 0; i < this.heights.length; i++) {
      const waterY = this.referenceHeights[i] - WATER_TABLE_DEPTH_M;
      if (this.heights[i] >= waterY - 1e-4) return true;
    }
    return false;
  }

  /**
   * Horizontal water sheet at the water table; animated waves, fresnel, depth tint, foam.
   * Fragments discard where land is above the (un-displaced) water surface.
   * @param {THREE.Scene} scene
   */
  ensureWaterMesh(scene) {
    if (this._waterMesh) return;

    const geo = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      toneMapped: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTerrainHeightMap: { value: this.dataTexture },
          uTerrainHalfExtent: { value: this.halfExtent },
          uTerrainSegments: { value: this.segments },
          uTime: { value: 0 },
          uDayPhase: { value: 1 },
          uCameraPosition: { value: new THREE.Vector3() },
          uSunDirection: { value: new THREE.Vector3(0.35, 0.75, 0.25).normalize() },
          uTideOffset: { value: 0 },
          uTideWaveMul: { value: 1 },
        },
        createWaterShaderUniforms(),
      ]),
      vertexShader: `
        #include <common>
        #include <fog_pars_vertex>
        uniform float uTime;
        uniform float uWaveTimeScale;
        uniform float uWaveAmp;
        uniform float uFreq1, uFreq2, uSpeed1, uSpeed2;
        uniform float uAmpPrimary;
        uniform float uChopX, uChopZ, uChopSpeed, uChopAmp;
        uniform float uRipX, uRipZ, uRipSpdA, uRipSpdB, uRipAmp;
        uniform float uDetX, uDetZ, uDetSpd, uDetAmp;
        uniform float uTideOffset;
        uniform float uTideWaveMul;
        varying vec3 vWorldPos;
        varying float vBaseWaterY;

        ${WATER_SHADERTOY_SEA_GLSL}

        void main() {
          vec3 pos = position;
          vBaseWaterY = pos.y + uTideOffset;
          pos.y = vBaseWaterY + seaHeightGeom(pos.xz, uTime) * uTideWaveMul;
          vec4 mw = modelMatrix * vec4(pos, 1.0);
          vWorldPos = mw.xyz;
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D uTerrainHeightMap;
        uniform float uTerrainHalfExtent;
        uniform float uTerrainSegments;
        uniform float uTime;
        uniform float uDayPhase;
        uniform vec3 uCameraPosition;
        uniform vec3 uSunDirection;
        uniform float uWaveTimeScale;
        uniform float uWaveAmp;
        uniform float uFreq1, uFreq2, uSpeed1, uSpeed2;
        uniform float uAmpPrimary;
        uniform float uChopX, uChopZ, uChopSpeed, uChopAmp;
        uniform float uRipX, uRipZ, uRipSpdA, uRipSpdB, uRipAmp;
        uniform float uDetX, uDetZ, uDetSpd, uDetAmp;
        uniform float uTideOffset;
        uniform float uTideWaveMul;
        uniform float uNormalEps;
        uniform float uDiscardBias;
        uniform float uDepthAbsorb;
        uniform float uDepthShallowEdge;
        uniform float uDepthMidK, uDepthDeepK;
        uniform float uFresnelPow;
        uniform float uSpecPowMin, uSpecPowMax;
        uniform float uSpecStrength;
        uniform float uReflNight, uReflDay;
        uniform float uFoamStr;
        uniform float uFoamStart, uFoamEnd;
        uniform float uFoamFx, uFoamFz, uFoamSpd;
        uniform float uGlintGrid, uGlintPow, uGlintStr;
        uniform float uAlphaMin, uAlphaMax, uAlphaFoam, uAlphaDepth, uAlphaClampLo, uAlphaClampHi;
        uniform vec3 uColorShallow, uColorMid, uColorDeep, uColorFoam, uColorSkyRefl, uColorGlint, uColorSunSpec;
        varying vec3 vWorldPos;
        varying float vBaseWaterY;

        ${WATER_SHADERTOY_SEA_GLSL}

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          float span = uTerrainHalfExtent * 2.0;
          vec2 tuv =
            vec2(vWorldPos.x + uTerrainHalfExtent, -vWorldPos.z + uTerrainHalfExtent) / span;
          float du = 1.0 / max(uTerrainSegments, 1.0);
          vec2 tuvC = clamp(tuv, vec2(du), vec2(1.0 - du));
          float terrainH = texture2D(uTerrainHeightMap, tuvC).r;

          if (terrainH >= vBaseWaterY - uDiscardBias) discard;

          float depth = max(vBaseWaterY - terrainH, 0.0);
          vec2 wxz = vWorldPos.xz;
          float e = uNormalEps;
          float h0 = seaHeightFrag(wxz, uTime) * uTideWaveMul;
          float hx = seaHeightFrag(wxz + vec2(e, 0.0), uTime) * uTideWaveMul;
          float hz = seaHeightFrag(wxz + vec2(0.0, e), uTime) * uTideWaveMul;
          vec3 N = normalize(vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e));

          vec3 V = normalize(uCameraPosition - vWorldPos);
          vec3 L = normalize(uSunDirection);
          float NdotV = max(dot(N, V), 0.0);
          float NdotL = max(dot(N, L), 0.0);

          float fresnel = pow(1.0 - NdotV, uFresnelPow);
          vec3 R = reflect(-L, N);
          float specPow = mix(uSpecPowMin, uSpecPowMax, uDayPhase);
          float spec = pow(max(dot(R, V), 0.0), specPow);

          vec3 shallow = uColorShallow;
          vec3 mid = uColorMid;
          vec3 deep = uColorDeep;
          float dFac = 1.0 - exp(-depth * uDepthAbsorb);
          vec3 baseCol = mix(shallow, mid, smoothstep(0.0, uDepthShallowEdge, depth));
          baseCol = mix(baseCol, deep, smoothstep(uDepthMidK, uDepthDeepK, depth) * dFac);

          // Darker water when looking toward the anti-sun horizon (matches sky’s dark sector)
          vec2 Lxz = normalize(vec2(L.x, L.z) + 1e-5);
          vec2 Vxz = normalize(vec2(V.x, V.z) + 1e-5);
          float sunViewAz = dot(Lxz, Vxz);
          float awayFromSun = smoothstep(0.1, -0.8, sunViewAz);
          float darkAmt = awayFromSun * uDayPhase;
          baseCol *= mix(1.0, 0.34, darkAmt);
          baseCol = mix(baseCol, baseCol * vec3(0.88, 0.92, 1.08), darkAmt * 0.22);

          float foamEdge = smoothstep(uFoamStart, uFoamEnd, depth);
          float foamWave = 0.35 + 0.65 * sin(wxz.x * uFoamFx + wxz.y * uFoamFz + uTime * uFoamSpd);
          float foam = foamEdge * foamWave * smoothstep(0.4, 1.0, uDayPhase);

          vec3 sunSpec = uColorSunSpec * spec * uSpecStrength * uDayPhase * (0.55 + 0.45 * NdotL);

          float glint = pow(hash(floor(wxz * uGlintGrid + uTime * 0.5)), uGlintPow) * fresnel * uGlintStr * uDayPhase;
          vec3 glintCol = uColorGlint * glint;

          vec3 refl = uColorSkyRefl * fresnel * mix(uReflNight, uReflDay, uDayPhase);
          refl *= mix(1.0, 0.45, darkAmt);

          vec3 col = baseCol;
          col += sunSpec;
          col += refl;
          col = mix(col, uColorFoam, clamp(foam * uFoamStr, 0.0, 0.85));
          col += glintCol;

          float alpha = mix(uAlphaMin, uAlphaMax, fresnel);
          alpha = mix(alpha, uAlphaFoam, foam);
          alpha = clamp(alpha + depth * uAlphaDepth, uAlphaClampLo, uAlphaClampHi);

          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }
      `,
    });
    applyWaterShaderMaterialUniforms(mat, normalizeWaterShaderSettings({}));

    this._waterMesh = new THREE.Mesh(geo, mat);
    this._waterMesh.name = "WaterTable";
    this._waterMesh.frustumCulled = false;
    this._waterMesh.renderOrder = 3;
    scene.add(this._waterMesh);
    this._applyWaterHeightsToGeometry(geo);
  }

  /**
   * Drive water animation and lighting (call each frame).
   * @param {object} o
   * @param {number} o.time elapsed seconds
   * @param {number} o.dayPhase 0 night — 1 day
   * @param {THREE.Camera} o.camera
   * @param {THREE.Vector3} o.sunDirection normalized, direction **toward** the sun
   * @param {ReturnType<typeof normalizeWaterShaderSettings>} [o.water] optional user water shader settings
   */
  updateWaterShaderUniforms(o) {
    const m = this._waterMesh?.material;
    if (!m || !m.uniforms) return;
    if (m.uniforms.uTime) m.uniforms.uTime.value = o.time;
    if (m.uniforms.uDayPhase) m.uniforms.uDayPhase.value = o.dayPhase;
    if (m.uniforms.uCameraPosition && o.camera) {
      m.uniforms.uCameraPosition.value.copy(o.camera.position);
    }
    if (m.uniforms.uSunDirection && o.sunDirection) {
      m.uniforms.uSunDirection.value.copy(o.sunDirection).normalize();
    }
    if (o.tide) {
      if (m.uniforms.uTideOffset) m.uniforms.uTideOffset.value = o.tide.offsetM;
      if (m.uniforms.uTideWaveMul) m.uniforms.uTideWaveMul.value = o.tide.waveMul;
    } else {
      if (m.uniforms.uTideOffset) m.uniforms.uTideOffset.value = 0;
      if (m.uniforms.uTideWaveMul) m.uniforms.uTideWaveMul.value = 1;
    }
    if (o.water) applyWaterShaderMaterialUniforms(m, o.water);
  }

  /**
   * @param {THREE.BufferGeometry} geo
   */
  _applyWaterHeightsToGeometry(geo) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i);
      const wz = pos.getZ(i);
      pos.setY(i, this.getWaterSurfaceHeightBilinear(wx, wz));
    }
    pos.needsUpdate = true;
  }

  /**
   * @param {THREE.BufferGeometry} geo
   */
  _syncWaterMeshGeometry(geo) {
    this._applyWaterHeightsToGeometry(geo);
  }

  /**
   * Mean height on a ring outside the inner brush (surrounding terrain).
   * @param {number} cx
   * @param {number} cz
   * @param {number} radiusWorld
   */
  _sampleSurroundingMean(cx, cz, radiusWorld) {
    const samples = 24;
    const r = radiusWorld * 1.75;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < samples; i++) {
      const ang = (i / samples) * Math.PI * 2;
      const sx = cx + Math.cos(ang) * r;
      const sz = cz + Math.sin(ang) * r;
      const { u, v } = this.uvFromWorld(sx, sz);
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      sum += this.getHeightBilinear(sx, sz);
      n++;
    }
    if (n < 1) return this.getHeightBilinear(cx, cz);
    return sum / n;
  }

  /**
   * @param {(THREE.ShaderMaterial | null)[]} mats
   */
  bindGrassMaterials(mats) {
    for (const m of mats) {
      if (!m) continue;
      if (!m.uniforms.uTerrainHeightMap) continue;
      m.uniforms.uTerrainHeightMap.value = this.dataTexture;
      m.uniforms.uTerrainHalfExtent.value = this.halfExtent;
      if (m.uniforms.uTerrainSegments) {
        m.uniforms.uTerrainSegments.value = this.segments;
      }
      if (m.uniforms.uReferenceHeightMap) {
        m.uniforms.uReferenceHeightMap.value = this.referenceDataTexture;
      }
      if (m.uniforms.uWaterTableDepthM) {
        m.uniforms.uWaterTableDepthM.value = WATER_TABLE_DEPTH_M;
      }
    }
  }

  /**
   * @param {(THREE.ShaderMaterial | null)[]} mats
   */
  bindFlowerMaterials(mats) {
    for (const m of mats) {
      if (!m) continue;
      if (!m.uniforms.uTerrainHeightMap) continue;
      m.uniforms.uTerrainHeightMap.value = this.dataTexture;
      m.uniforms.uTerrainHalfExtent.value = this.halfExtent;
      if (m.uniforms.uTerrainSegments) {
        m.uniforms.uTerrainSegments.value = this.segments;
      }
      if (m.uniforms.uReferenceHeightMap) {
        m.uniforms.uReferenceHeightMap.value = this.referenceDataTexture;
      }
      if (m.uniforms.uWaterTableDepthM) {
        m.uniforms.uWaterTableDepthM.value = WATER_TABLE_DEPTH_M;
      }
    }
  }
}

/**
 * True when ground surface at (wx, wz) is at or above the local water table (not submerged).
 * @param {TerrainHeightField | null | undefined} field
 * @param {number} wx
 * @param {number} wz
 */
export function isTerrainDryAt(field, wx, wz) {
  if (!field) return true;
  const ground = field.getHeightBilinear(wx, wz);
  const waterY = field.getWaterSurfaceHeightBilinear(wx, wz);
  return ground >= waterY - 0.03;
}

/**
 * Precomputed dry-land sample points (terrain cell centers where ground ≥ water surface).
 * Built by {@link getDryLandSpawnPoints}; used so plants and land critters spawn on islands,
 * not only when uniform random hits rare dry pixels.
 *
 * @typedef {{ xs: Float32Array, zs: Float32Array, length: number }} DryLandSpawnPoints
 */

/**
 * Scans the heightfield on a grid and records world XZ at each cell center where
 * {@link isTerrainDryAt} is true. O(segments²) — intended for content rebuilds, not per frame.
 * @param {TerrainHeightField | null | undefined} field
 * @returns {DryLandSpawnPoints}
 */
export function getDryLandSpawnPoints(field) {
  const empty = { xs: new Float32Array(0), zs: new Float32Array(0), length: 0 };
  if (!field) return empty;
  const seg = field.segments;
  const h = field.halfExtent;
  const s = field.size;
  const xs = [];
  const zs = [];
  for (let iz = 0; iz < seg; iz++) {
    for (let ix = 0; ix < seg; ix++) {
      const u = (ix + 0.5) / seg;
      const v = (iz + 0.5) / seg;
      const wx = -h + u * s;
      const wz = h - v * s;
      if (isTerrainDryAt(field, wx, wz)) {
        xs.push(wx);
        zs.push(wz);
      }
    }
  }
  return {
    xs: Float32Array.from(xs),
    zs: Float32Array.from(zs),
    length: xs.length,
  };
}

/**
 * Random point on dry land with jitter inside the terrain cell square around the dry sample.
 * Uses almost the full half-cell span (was ±0.42 cell, which left bare strips along every
 * cell boundary ~1.5m apart — looked like a grid). Retries with new random offsets if the
 * sample lands in water near an edge.
 * @param {DryLandSpawnPoints | null | undefined} dry
 * @param {TerrainHeightField} field
 * @param {() => number} rng01
 * @returns {{ x: number, z: number } | null}
 */
export function pickRandomDryXZ(dry, field, rng01) {
  if (!dry || dry.length < 1 || !field) return null;
  const j = Math.floor(rng01() * dry.length);
  const cx = dry.xs[j];
  const cz = dry.zs[j];
  const cell = field.size / field.segments;
  const span = cell * 0.5 * 0.98;
  for (let attempt = 0; attempt < 10; attempt++) {
    const x = cx + (rng01() - 0.5) * 2 * span;
    const z = cz + (rng01() - 0.5) * 2 * span;
    if (isTerrainDryAt(field, x, z)) {
      return { x, z };
    }
  }
  return { x: cx, z: cz };
}

/**
 * Prefer {@link pickRandomDryXZ} when `dry` is non-empty; otherwise uniform square + rejection.
 * @param {TerrainHeightField | null | undefined} terrain
 * @param {DryLandSpawnPoints | null | undefined} dry
 * @param {() => number} rng01
 * @param {number} spread half-extent on X/Z (matches field spread)
 * @returns {{ x: number, z: number, groundY: number }} `groundY` is {@link TerrainHeightField.getHeightBilinear} at (x,z), or 0 without terrain.
 */
export function sampleLandXZForSpawn(terrain, dry, rng01, spread) {
  if (terrain && dry && dry.length > 0) {
    const p = pickRandomDryXZ(dry, terrain, rng01);
    if (p) {
      const groundY = terrain.getHeightBilinear(p.x, p.z);
      return { x: p.x, z: p.z, groundY };
    }
  }
  let x = 0;
  let z = 0;
  for (let attempt = 0; attempt < 96; attempt++) {
    x = (rng01() * 2 - 1) * spread;
    z = (rng01() * 2 - 1) * spread;
    if (!terrain || isTerrainDryAt(terrain, x, z)) {
      const groundY = terrain ? terrain.getHeightBilinear(x, z) : 0;
      return { x, z, groundY };
    }
  }
  const groundY = terrain ? terrain.getHeightBilinear(x, z) : 0;
  return { x, z, groundY };
}
