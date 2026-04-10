import * as THREE from "three";

/**
 * Meshy sometimes exports all-black vertex colors (breaks shading); other times real paint is in `color` — do not strip that.
 * @param {THREE.BufferGeometry} geo
 * @returns {boolean}
 */
export function vertexColorsAreUsablePaint(geo) {
  const attr = geo.attributes.color;
  if (!attr?.array) return false;
  const arr = attr.array;
  const step = attr.itemSize ?? 3;
  const samples = Math.min(Math.floor(arr.length / step), 2048);
  let maxCh = 0;
  for (let i = 0; i < samples; i++) {
    const o = i * step;
    const r = arr[o] ?? 0;
    const g = step > 1 ? arr[o + 1] ?? 0 : r;
    const b = step > 2 ? arr[o + 2] ?? 0 : g;
    const mx = Math.max(r, g, b);
    if (mx > maxCh) maxCh = mx;
  }
  return maxCh > 0.02;
}

/**
 * Meshy FBX imports can carry black vertex colors, broken transparency, or sRGB maps as linear — fixes invisible meshes.
 * @param {THREE.Object3D} root
 */
export function sanitizeImportedModel(root) {
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) && !(obj instanceof THREE.SkinnedMesh)) return;
    const g = obj.geometry;
    if (g?.attributes?.color) {
      if (vertexColorsAreUsablePaint(g)) {
        // keep
      } else {
        g.deleteAttribute("color");
      }
    }

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const hasVertexColorAttr = !!g?.attributes?.color;
    for (const raw of mats) {
      const m = raw;
      if (!m) continue;
      m.vertexColors = hasVertexColorAttr;
      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
      m.depthTest = true;
      m.side = THREE.DoubleSide;
      if ("transmission" in m && typeof m.transmission === "number") {
        m.transmission = 0;
      }
      if ("thickness" in m && typeof m.thickness === "number") {
        m.thickness = 0;
      }
      if ("ior" in m && typeof m.ior === "number") {
        m.ior = 1.5;
      }
      const texProps = ["map", "emissiveMap", "sheenColorMap", "specularColorMap"];
      for (const key of texProps) {
        const tex = /** @type {THREE.Texture | undefined} */ (m[key]);
        if (tex?.isTexture) tex.colorSpace = THREE.SRGBColorSpace;
      }
      const linearProps = ["normalMap", "roughnessMap", "metalnessMap", "aoMap"];
      for (const key of linearProps) {
        const tex = /** @type {THREE.Texture | undefined} */ (m[key]);
        if (tex?.isTexture) tex.colorSpace = THREE.LinearSRGBColorSpace;
      }
      if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
        const ms = /** @type {THREE.MeshStandardMaterial} */ (m);
        if (ms.envMapIntensity === undefined || ms.envMapIntensity < 0.2) {
          ms.envMapIntensity = 0.95;
        }
      }
    }
    obj.frustumCulled = false;
  });
}

/**
 * FBX often uses Phong/Lambert; convert so PBR + scene.environment light the mesh reliably.
 * @param {THREE.Object3D} root
 */
export function upgradeLegacyMaterials(root) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) && !(obj instanceof THREE.SkinnedMesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const out = mats.map((m) => {
      if (!m) return m;
      if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
        const ms = /** @type {THREE.MeshStandardMaterial} */ (m);
        if (ms.envMapIntensity === undefined || ms.envMapIntensity < 0.15) {
          ms.envMapIntensity = 0.95;
        }
        return m;
      }
      const std = new THREE.MeshStandardMaterial({
        color: m.color?.clone?.() ?? new THREE.Color(0xffffff),
        map: m.map ?? null,
        normalMap: m.normalMap ?? null,
        roughness: 0.58,
        metalness: 0.1,
        emissive: m.emissive?.clone?.() ?? new THREE.Color(0x000000),
        emissiveMap: m.emissiveMap ?? null,
        envMapIntensity: 0.95,
        vertexColors: !!m.vertexColors,
        emissiveIntensity: typeof m.emissiveIntensity === "number" ? m.emissiveIntensity : 1,
      });
      if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
      if (std.emissiveMap) std.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      if (std.normalMap) std.normalMap.colorSpace = THREE.LinearSRGBColorSpace;
      m.dispose();
      return std;
    });
    obj.material = Array.isArray(obj.material) ? out : out[0];
  });
}
