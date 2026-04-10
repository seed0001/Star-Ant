/**
 * GLSL snippets: Shadertoy-style multi-octave ocean (from iq / Khangeldy CodePen style).
 * Used by {@link TerrainHeightField} water mesh — not raymarched; height is evaluated on the plane.
 * @module
 */

/**
 * Shared + height functions. Requires uniforms: uFreq1, uAmpPrimary, uChopX, uChopZ,
 * uWaveTimeScale, uWaveAmp, uSpeed1 (same names as existing water shader).
 */
export const WATER_SHADERTOY_SEA_GLSL = /* glsl */ `
float shadertoyHash(vec2 p) {
  float h = dot(p, vec2(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

float shadertoyNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return -1.0 + 2.0 * mix(
    mix(shadertoyHash(i + vec2(0.0, 0.0)), shadertoyHash(i + vec2(1.0, 0.0)), u.x),
    mix(shadertoyHash(i + vec2(0.0, 1.0)), shadertoyHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float seaOctave(vec2 uv, float choppy) {
  uv += shadertoyNoise(uv);
  vec2 wv = 1.0 - abs(sin(uv));
  vec2 swv = abs(cos(uv));
  wv = mix(wv, swv, wv);
  return pow(1.0 - pow(wv.x * wv.y, 0.65), choppy);
}

float seaHeightGeom(vec2 xz, float rawTime) {
  float freq = uFreq1 * 0.38;
  float amp = uAmpPrimary * 11.0;
  float choppy = clamp(uChopX * 0.55 + uChopZ * 0.45 + 0.55, 0.75, 4.0);
  vec2 uv = xz;
  uv.x *= 0.75;
  mat2 rotM = mat2(1.6, 1.2, -1.2, 1.6);
  float seaTime = rawTime * uWaveTimeScale * (uSpeed1 * 0.5 + 0.4);
  float d;
  float h = 0.0;
  for (int i = 0; i < 3; i++) {
    d = seaOctave((uv + seaTime) * freq, choppy);
    d += seaOctave((uv - seaTime) * freq, choppy);
    h += d * amp;
    uv *= rotM;
    freq *= 1.9;
    amp *= 0.22;
    choppy = mix(choppy, 1.0, 0.2);
  }
  return h * uWaveAmp;
}

float seaHeightFrag(vec2 xz, float rawTime) {
  float freq = uFreq1 * 0.38;
  float amp = uAmpPrimary * 11.0;
  float choppy = clamp(uChopX * 0.55 + uChopZ * 0.45 + 0.55, 0.75, 4.0);
  vec2 uv = xz;
  uv.x *= 0.75;
  mat2 rotM = mat2(1.6, 1.2, -1.2, 1.6);
  float seaTime = rawTime * uWaveTimeScale * (uSpeed1 * 0.5 + 0.4);
  float d;
  float h = 0.0;
  for (int i = 0; i < 5; i++) {
    d = seaOctave((uv + seaTime) * freq, choppy);
    d += seaOctave((uv - seaTime) * freq, choppy);
    h += d * amp;
    uv *= rotM;
    freq *= 1.9;
    amp *= 0.22;
    choppy = mix(choppy, 1.0, 0.2);
  }
  return h * uWaveAmp;
}
`;
