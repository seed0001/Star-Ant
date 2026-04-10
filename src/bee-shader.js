import * as THREE from "three";

/**
 * Hero bumblebee: optional PBR tweaks via onBeforeCompile.
 * Currently unused — string-fragile across Three.js versions; re-enable only after testing on target r###.
 * @param {THREE.Object3D} root
 */
export function applyBeeHeroMaterialEnhancements(root) {
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) && !(obj instanceof THREE.SkinnedMesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m) continue;
      if (!m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial) continue;
      if (m.userData.beeShaderEnhanced) continue;
      m.userData.beeShaderEnhanced = true;

      m.fog = true;
      m.envMapIntensity = Math.max(m.envMapIntensity ?? 0.6, 0.78);

      m.customProgramCacheKey = function beeHeroCacheKey() {
        return "beeHero_v1";
      };

      m.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
          /varying vec3 vViewPosition;/,
          "varying vec3 vViewPosition;\nvarying vec3 vBeeWorldPos;"
        );
        shader.vertexShader = shader.vertexShader.replace(
          /#include <worldpos_vertex>/,
          `#include <worldpos_vertex>
  vBeeWorldPos = worldPosition.xyz;`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          /varying vec3 vViewPosition;/,
          "varying vec3 vViewPosition;\nvarying vec3 vBeeWorldPos;"
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          /#include <map_fragment>/,
          `#include <map_fragment>
  {
    vec3 beeP = vBeeWorldPos * 38.0;
    float beeDetail = sin(beeP.x) * sin(beeP.y * 1.07) * sin(beeP.z * 0.93);
    float beeGrain = sin(dot(beeP, vec3(0.41, 0.57, 0.29))) * 0.5 + 0.5;
    diffuseColor.rgb *= 1.0 + beeDetail * 0.048 + (beeGrain - 0.5) * 0.065;
    float beeStripe = sin(vUv.x * 95.0 + vUv.y * 72.0) * 0.5 + 0.5;
    diffuseColor.rgb *= mix(0.97, 1.03, beeStripe);
  }`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          /#include <lights_physical_fragment>/,
          `#include <lights_physical_fragment>
  {
    float beeRough = sin(vUv.x * 31.0) * sin(vUv.y * 27.0) * 0.1 + 0.9;
    material.roughness = clamp(material.roughness * beeRough, 0.0, 1.0);
  }`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          /vec3 outgoingLight = totalDiffuse \+ totalSpecular \+ totalEmissiveRadiance;/,
          `vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
  {
    vec3 bn = normalize(geometryNormal);
    vec3 bv = normalize(geometryViewDir);
    float edge = pow(saturate(1.0 - abs(dot(bn, bv))), 2.8);
    vec3 warmRim = vec3(0.16, 0.14, 0.1) * edge * 0.42;
    vec3 coolRim = vec3(0.08, 0.1, 0.13) * edge * 0.28;
    outgoingLight += warmRim + coolRim;
    float upl = saturate(dot(bn, vec3(0.2, 0.92, 0.25)));
    outgoingLight += vec3(0.08, 0.07, 0.05) * upl * 0.35;
  }`
        );
      };

      m.needsUpdate = true;
    }
  });
}
