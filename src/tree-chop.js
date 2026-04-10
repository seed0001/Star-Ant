import * as THREE from "three";
import { Tree } from "@dgreenheck/ez-tree";

/**
 * World-space plane cut: dot(normalize(n), worldPos) + d — crown keeps positive side.
 * @param {THREE.Material} mat
 * @param {THREE.Vector3} planeNormalWorld
 * @param {number} planeDWorld
 * @param {boolean} discardIfNegative crown: true; stump: false
 */
function patchMaterialPlaneCut(mat, planeNormalWorld, planeDWorld, discardIfNegative) {
  const nx = planeNormalWorld.x;
  const ny = planeNormalWorld.y;
  const nz = planeNormalWorld.z;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    if (prev) prev(shader);

    if (!shader.uniforms.uChopPlaneNormal) {
      shader.uniforms.uChopPlaneNormal = { value: new THREE.Vector3() };
    }
    if (!shader.uniforms.uChopPlaneD) {
      shader.uniforms.uChopPlaneD = { value: 0 };
    }
    if (!shader.uniforms.uChopDiscardIfNegative) {
      shader.uniforms.uChopDiscardIfNegative = { value: 0 };
    }
    shader.uniforms.uChopPlaneNormal.value.set(nx, ny, nz);
    shader.uniforms.uChopPlaneD.value = planeDWorld;
    shader.uniforms.uChopDiscardIfNegative.value = discardIfNegative ? 1 : 0;

    if (!shader.vertexShader.includes("varying vec3 vChopWorldPos")) {
      shader.vertexShader = "varying vec3 vChopWorldPos;\n" + shader.vertexShader;
    }
    if (!shader.vertexShader.includes("vChopWorldPos =")) {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
      vChopWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`
      );
    }

    if (!shader.fragmentShader.includes("uniform vec3 uChopPlaneNormal")) {
      shader.fragmentShader =
        "varying vec3 vChopWorldPos;\nuniform vec3 uChopPlaneNormal;\nuniform float uChopPlaneD;\nuniform float uChopDiscardIfNegative;\n" +
        shader.fragmentShader;
    }

    const fragMarker = "EZ_TREE_CHOP_PLANE_DISCARD";
    if (shader.fragmentShader.includes(fragMarker)) {
      /* Uniforms already set above; never set needsUpdate here — it re-triggers compile forever. */
      return;
    }
    const fragPatch = `vec3 _cn = normalize(uChopPlaneNormal);
float _sd = dot(_cn, vChopWorldPos) + uChopPlaneD;
if (uChopDiscardIfNegative > 0.5) { if (_sd < -0.002) discard; } else { if (_sd > 0.002) discard; }
`;
    if (shader.fragmentShader.includes("#include <opaque_fragment>")) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `${fragPatch}// ${fragMarker}
#include <opaque_fragment>`
      );
    } else {
      shader.fragmentShader = shader.fragmentShader.replace(
        "void main() {",
        `void main() {
        ${fragPatch}// ${fragMarker}
`
      );
    }
  };
  mat.needsUpdate = true;
}

function patchMaterialHorizontalCut(mat, cutYWorld) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    if (prev) prev(shader);

    if (!shader.uniforms.uChopCutY) {
      shader.uniforms.uChopCutY = { value: cutYWorld };
    } else {
      shader.uniforms.uChopCutY.value = cutYWorld;
    }

    if (!shader.vertexShader.includes("varying vec3 vChopWorldPos")) {
      shader.vertexShader = "varying vec3 vChopWorldPos;\n" + shader.vertexShader;
    }
    if (!shader.vertexShader.includes("vChopWorldPos =")) {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
      vChopWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`
      );
    }

    if (!shader.fragmentShader.includes("uniform float uChopCutY")) {
      shader.fragmentShader = "varying vec3 vChopWorldPos;\nuniform float uChopCutY;\n" + shader.fragmentShader;
    }

    const fragMarker = "EZ_TREE_CHOP_HORIZ_DISCARD";
    if (shader.fragmentShader.includes(fragMarker)) {
      /* Uniforms already set above; never set needsUpdate here — it re-triggers compile forever. */
      return;
    }
    const fragPatch = `if (vChopWorldPos.y < uChopCutY - 0.002) discard;
`;
    if (shader.fragmentShader.includes("#include <opaque_fragment>")) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `${fragPatch}// ${fragMarker}
#include <opaque_fragment>`
      );
    } else {
      shader.fragmentShader = shader.fragmentShader.replace(
        "void main() {",
        `void main() {
        ${fragPatch}// ${fragMarker}
`
      );
    }
  };
  mat.needsUpdate = true;
}

/**
 * Remove triangles on negative side of plane; orients to remove smaller count.
 */
function pruneTrianglesWithPlane(mesh, planeNormal, planeD) {
  const geo = mesh.geometry;
  if (!geo.index) return;
  mesh.updateMatrixWorld(true);
  const pos = geo.attributes.position;
  const idx = geo.index;
  const mw = mesh.matrixWorld;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cw = new THREE.Vector3();
  const n = planeNormal.clone().normalize();
  let d = planeD;

  const countNeg = () => {
    let neg = 0;
    for (let i = 0; i < idx.count; i += 3) {
      const ia = idx.getX(i);
      const ib = idx.getX(i + 1);
      const ic = idx.getX(i + 2);
      a.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia));
      b.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib));
      c.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic));
      cw.copy(a).add(b).add(c).multiplyScalar(1 / 3).applyMatrix4(mw);
      if (n.dot(cw) + d < 0) neg++;
    }
    return neg;
  };

  let neg = countNeg();
  const tri = idx.count / 3;
  if (neg > tri - neg) {
    n.negate();
    d = -d;
  }

  const out = [];
  for (let i = 0; i < idx.count; i += 3) {
    const ia = idx.getX(i);
    const ib = idx.getX(i + 1);
    const ic = idx.getX(i + 2);
    a.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia));
    b.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib));
    c.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic));
    cw.copy(a).add(b).add(c).multiplyScalar(1 / 3).applyMatrix4(mw);
    const sd = n.dot(cw) + d;
    if (sd >= 0) {
      out.push(ia, ib, ic);
    }
  }
  if (out.length < 3) {
    mesh.visible = false;
    return;
  }
  const ctor = idx.array.constructor;
  geo.setIndex(new ctor(out));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}

function pruneTrianglesInSphere(mesh, centerWorld, radius) {
  const geo = mesh.geometry;
  if (!geo.index) return;
  mesh.updateMatrixWorld(true);
  const pos = geo.attributes.position;
  const idx = geo.index;
  const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const localCenter = centerWorld.clone().applyMatrix4(inv);
  const r2 = radius * radius;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const out = [];
  for (let i = 0; i < idx.count; i += 3) {
    const ia = idx.getX(i);
    const ib = idx.getX(i + 1);
    const ic = idx.getX(i + 2);
    a.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia));
    b.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib));
    c.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic));
    const cx = (a.x + b.x + c.x) / 3;
    const cy = (a.y + b.y + c.y) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    const dx = cx - localCenter.x;
    const dy = cy - localCenter.y;
    const dz = cz - localCenter.z;
    if (dx * dx + dy * dy + dz * dz > r2) {
      out.push(ia, ib, ic);
    }
  }
  if (out.length < 3) {
    mesh.visible = false;
    return;
  }
  const ctor = idx.array.constructor;
  geo.setIndex(new ctor(out));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}

/**
 * @param {THREE.Raycaster} raycaster
 * @param {THREE.Camera} camera
 * @param {{ x: number, y: number }} ndcA
 * @param {{ x: number, y: number }} ndcB
 * @param {THREE.Object3D[]} targets
 */
function raycastSwipeEndpoints(raycaster, camera, ndcA, ndcB, targets) {
  const samples = 7;
  /** @type {{ mesh: THREE.Mesh, point: THREE.Vector3 }[]} */
  const hits = [];
  for (let s = 0; s < samples; s++) {
    const u = samples < 2 ? 0 : s / (samples - 1);
    const ndcX = THREE.MathUtils.lerp(ndcA.x, ndcB.x, u);
    const ndcY = THREE.MathUtils.lerp(ndcA.y, ndcB.y, u);
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const inter = raycaster.intersectObjects(targets, false);
    if (inter.length < 1) continue;
    hits.push({ mesh: /** @type {THREE.Mesh} */ (inter[0].object), point: inter[0].point.clone() });
  }
  if (hits.length < 2) return null;

  const byMesh = new Map();
  for (const h of hits) {
    if (!byMesh.has(h.mesh)) byMesh.set(h.mesh, []);
    byMesh.get(h.mesh).push(h);
  }
  /** @type {{ mesh: THREE.Mesh, arr: typeof hits } | null} */
  let best = null;
  for (const [mesh, arr] of byMesh) {
    if (arr.length >= 2 && (!best || arr.length > best.arr.length)) {
      best = { mesh, arr };
    }
  }
  if (!best) return null;
  const first = best.arr[0].point;
  const last = best.arr[best.arr.length - 1].point;
  if (first.distanceToSquared(last) < 1e-10) return null;
  return { mesh: best.mesh, p0: first, p1: last };
}

/**
 * @param {THREE.Vector3} p0
 * @param {THREE.Vector3} p1
 * @param {THREE.Camera} camera
 */
function planeFromKnifeSwipe(p0, p1, camera) {
  const swipe = new THREE.Vector3().subVectors(p1, p0);
  if (swipe.lengthSq() < 1e-10) return null;
  const viewDir = new THREE.Vector3();
  camera.getWorldDirection(viewDir);
  let n = new THREE.Vector3().crossVectors(swipe, viewDir);
  if (n.lengthSq() < 1e-10) {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    n.crossVectors(swipe, right);
  }
  if (n.lengthSq() < 1e-10) {
    n.crossVectors(swipe, new THREE.Vector3(0, 1, 0));
  }
  if (n.lengthSq() < 1e-10) return null;
  n.normalize();
  const midpoint = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
  const d = -n.dot(midpoint);
  return { normal: n, d, midpoint };
}

export class TreeChopSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {import("./trees.js").TreeForest} treeForest
   */
  constructor(scene, treeForest) {
    this.scene = scene;
    this.treeForest = treeForest;
    this.raycaster = new THREE.Raycaster();
    /** Match camera far plane so cuts work from across the field, not only within ~500 units. */
    this.raycaster.far = 50000;
    /** @type {FallingTree[]} */
    this.fallen = [];
    this.chopMode = false;
    this.dragging = false;
    this.minSwipeNdc = 0.022;

    /**
     * While set: panoramic orbit shot during a falling tree; world animation pauses in main.
     * @type {{
     *   pivot: THREE.Vector3;
     *   fallingRef: FallingTree;
     *   orbitAngle: number;
     *   orbitSpeed: number;
     *   radius: number;
     *   heightOffset: number;
     *   lookAtYOffset: number;
     *   initialized: boolean;
     *   savedPosition?: THREE.Vector3;
     *   savedQuaternion?: THREE.Quaternion;
     * } | null}
     */
    this._cinematic = null;
    /** @type {number | null} */
    this._savedCameraFov = null;
    /** After cinematic ends, main should sync free-flight euler from the camera. */
    this.needsEulerSync = false;
  }

  /**
   * True while the tree is still in the "falling" state (wide orbit shot active).
   */
  isCinematicActive() {
    if (!this._cinematic) return false;
    const f = this._cinematic.fallingRef;
    return !!(f && f.state === "falling");
  }

  /**
   * Orbit camera around the fall pivot; call once per frame after {@link update}.
   * @param {THREE.PerspectiveCamera} camera
   * @param {number} dt
   * @returns {boolean} true if this frame fully drives the camera (skip free-flight movement / look).
   */
  updateCinematicCamera(camera, dt) {
    if (!this._cinematic) return false;
    const c = this._cinematic;
    const f = c.fallingRef;
    if (!f || f.state !== "falling") {
      this._endCinematic(camera);
      return false;
    }

    if (!c.initialized) {
      c.savedPosition = camera.position.clone();
      c.savedQuaternion = camera.quaternion.clone();

      this._savedCameraFov = camera.fov;
      camera.fov = Math.min(85, camera.fov + 18);
      camera.updateProjectionMatrix();

      const flat = new THREE.Vector3().subVectors(camera.position, c.pivot);
      flat.y = 0;
      const dist = flat.length();
      c.radius = THREE.MathUtils.clamp(dist > 0.5 ? dist : 18, 12, 48);
      c.heightOffset = THREE.MathUtils.clamp(camera.position.y - c.pivot.y, 3, 18);
      c.orbitAngle = Math.atan2(flat.x, flat.z);
      c.initialized = true;
    }

    c.orbitAngle += c.orbitSpeed * dt;
    const px = c.pivot.x + Math.sin(c.orbitAngle) * c.radius;
    const pz = c.pivot.z + Math.cos(c.orbitAngle) * c.radius;
    const py = c.pivot.y + c.heightOffset;
    camera.position.set(px, py, pz);
    const look = new THREE.Vector3(
      c.pivot.x,
      c.pivot.y + c.lookAtYOffset,
      c.pivot.z
    );
    camera.lookAt(look);
    return true;
  }

  /**
   * @param {THREE.PerspectiveCamera} camera
   */
  _endCinematic(camera) {
    const c = this._cinematic;
    if (c?.savedPosition && c.savedQuaternion) {
      camera.position.copy(c.savedPosition);
      camera.quaternion.copy(c.savedQuaternion);
      this.needsEulerSync = true;
    }
    if (this._savedCameraFov != null) {
      camera.fov = this._savedCameraFov;
      camera.updateProjectionMatrix();
      this._savedCameraFov = null;
    }
    this._cinematic = null;
  }

  /**
   * @param {THREE.Vector3} pivotWorld
   * @param {FallingTree} fallingRef
   */
  _beginCinematic(pivotWorld, fallingRef) {
    this._cinematic = {
      pivot: pivotWorld.clone(),
      fallingRef,
      orbitAngle: 0,
      orbitSpeed: 0.4,
      radius: 0,
      heightOffset: 6,
      lookAtYOffset: 0.9,
      initialized: false,
    };
  }

  /**
   * @param {THREE.Camera} camera
   * @param {{ x: number, y: number }} ndcStart
   * @param {{ x: number, y: number }} ndcEnd
   */
  tryCutFromSwipe(camera, ndcStart, ndcEnd) {
    const swipeLen = Math.hypot(ndcEnd.x - ndcStart.x, ndcEnd.y - ndcStart.y);
    if (swipeLen < this.minSwipeNdc) {
      const mx = (ndcStart.x + ndcEnd.x) * 0.5;
      const my = (ndcStart.y + ndcEnd.y) * 0.5;
      return this._tryTapFallback(camera, mx, my);
    }
    if (this._tryChopStandingSwipe(camera, ndcStart, ndcEnd)) return true;
    if (this._tryPruneFallenSwipe(camera, ndcStart, ndcEnd)) return true;
    return false;
  }

  /**
   * @param {THREE.Camera} camera
   * @param {number} ndcX
   * @param {number} ndcY
   */
  _tryTapFallback(camera, ndcX, ndcY) {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const trees = this.treeForest.trees;
    if (trees.length > 0) {
      const targets = [];
      for (const t of trees) {
        targets.push(t.branchesMesh, t.leavesMesh);
      }
      const hits = this.raycaster.intersectObjects(targets, false);
      if (hits.length > 0) {
        const hit = hits[0];
        const tree = /** @type {Tree | null} */ (hit.object.parent);
        if (tree instanceof Tree) {
          const cutY = hit.point.y;
          const trunkH =
            typeof tree.userData.trunkHeightApprox === "number"
              ? tree.userData.trunkHeightApprox
              : tree.scale.x * 8;
          const dx = hit.point.x - tree.position.x;
          const dz = hit.point.z - tree.position.z;
          const distH = Math.sqrt(dx * dx + dz * dz);
          const trunkR = Math.max(0.28, tree.scale.x * 1.35);
          const maxReach = Math.max(trunkR * 3.5, 6);
          if (cutY >= 0.08 && cutY <= trunkH * 1.05 && distH <= maxReach) {
            this._chopTreeHorizontal(tree, hit.point, cutY);
            return true;
          }
        }
      }
    }

    /** @type {THREE.Mesh[]} */
    const fallenTargets = [];
    for (const f of this.fallen) {
      if (f.state !== "settled") continue;
      fallenTargets.push(f.branchesMesh, f.leavesMesh);
    }
    if (fallenTargets.length < 1) return false;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const fh = this.raycaster.intersectObjects(fallenTargets, false);
    if (fh.length < 1) return false;
    pruneTrianglesInSphere(/** @type {THREE.Mesh} */ (fh[0].object), fh[0].point, 0.14);
    return true;
  }

  /**
   * @param {THREE.Camera} camera
   * @param {{ x: number, y: number }} ndcA
   * @param {{ x: number, y: number }} ndcB
   */
  _tryChopStandingSwipe(camera, ndcA, ndcB) {
    const trees = this.treeForest.trees;
    if (trees.length < 1) return false;
    const targets = [];
    for (const t of trees) {
      targets.push(t.branchesMesh, t.leavesMesh);
    }
    const ep = raycastSwipeEndpoints(this.raycaster, camera, ndcA, ndcB, targets);
    if (!ep) return false;
    const tree = /** @type {Tree | null} */ (ep.mesh.parent);
    if (!(tree instanceof Tree)) return false;

    const trunkH =
      typeof tree.userData.trunkHeightApprox === "number" ? tree.userData.trunkHeightApprox : tree.scale.x * 8;
    const trunkR = Math.max(0.28, tree.scale.x * 1.35);
    const maxReach = Math.max(trunkR * 5, 8);
    const M = new THREE.Vector3().addVectors(ep.p0, ep.p1).multiplyScalar(0.5);
    const dx = M.x - tree.position.x;
    const dz = M.z - tree.position.z;
    const distH = Math.sqrt(dx * dx + dz * dz);
    if (M.y < 0.05 || M.y > trunkH * 1.12 || distH > maxReach) {
      return false;
    }

    const plane = planeFromKnifeSwipe(ep.p0, ep.p1, camera);
    if (!plane) return false;
    const midpoint = plane.midpoint.clone();
    const n = plane.normal.clone();
    let d = plane.d;
    const topHint = new THREE.Vector3(tree.position.x, tree.position.y + trunkH * 0.65, tree.position.z);
    if (n.dot(topHint) + d < 0) {
      n.negate();
      d = -d;
    }

    this._chopTreePlane(tree, midpoint, n, d, trunkH);
    return true;
  }

  /**
   * @param {THREE.Camera} camera
   * @param {{ x: number, y: number }} ndcA
   * @param {{ x: number, y: number }} ndcB
   */
  _tryPruneFallenSwipe(camera, ndcA, ndcB) {
    /** @type {THREE.Mesh[]} */
    const targets = [];
    /** @type {FallingTree[]} */
    const settled = [];
    for (const f of this.fallen) {
      if (f.state !== "settled") continue;
      settled.push(f);
      targets.push(f.branchesMesh, f.leavesMesh);
    }
    if (targets.length < 1) return false;

    const ep = raycastSwipeEndpoints(this.raycaster, camera, ndcA, ndcB, targets);
    if (!ep) return false;

    const plane = planeFromKnifeSwipe(ep.p0, ep.p1, camera);
    if (!plane) return false;

    const affected = new Set();
    for (const f of settled) {
      if (f.branchesMesh === ep.mesh || f.leavesMesh === ep.mesh) {
        affected.add(f.branchesMesh);
        affected.add(f.leavesMesh);
      }
    }
    for (const m of affected) {
      pruneTrianglesWithPlane(m, plane.normal, plane.d);
    }
    return true;
  }

  /**
   * @param {Tree} tree
   * @param {THREE.Vector3} hitWorld
   * @param {number} cutY
   */
  _chopTreeHorizontal(tree, hitWorld, cutY) {
    const treeForest = this.treeForest;
    tree.updateMatrixWorld(true);

    const stumpR = Math.max(0.22, tree.scale.x * 1.2);
    const stumpGeo = new THREE.CylinderGeometry(stumpR * 0.92, stumpR, Math.max(0.08, cutY), 12);
    stumpGeo.translate(0, cutY * 0.5, 0);
    const stumpMat = tree.branchesMesh.material;
    const stumpMatClone = Array.isArray(stumpMat) ? stumpMat[0].clone() : stumpMat.clone();
    const stump = new THREE.Mesh(stumpGeo, stumpMatClone);
    stump.castShadow = true;
    stump.receiveShadow = true;
    stump.position.set(tree.position.x, 0, tree.position.z);
    stump.rotation.y = tree.rotation.y;
    this.scene.add(stump);

    const branchesClone = tree.branchesMesh.clone(true);
    const leavesClone = tree.leavesMesh.clone(true);

    const applyCut = (mesh) => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const next = mats.map((m) => {
        const c = m.clone();
        patchMaterialHorizontalCut(c, cutY);
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? next : next[0];
    };
    applyCut(branchesClone);
    applyCut(leavesClone);

    this._attachFallingTree(tree, treeForest, hitWorld, branchesClone, leavesClone);
  }

  /**
   * @param {Tree} tree
   * @param {THREE.Vector3} pivotWorld
   * @param {THREE.Vector3} planeNormal
   * @param {number} planeD
   * @param {number} trunkH
   */
  _chopTreePlane(tree, pivotWorld, planeNormal, planeD, trunkH) {
    const treeForest = this.treeForest;
    tree.updateMatrixWorld(true);

    const stumpR = Math.max(0.22, tree.scale.x * 1.2);
    const stumpGeo = new THREE.CylinderGeometry(stumpR * 0.92, stumpR, Math.max(0.15, trunkH), 12);
    stumpGeo.translate(0, trunkH * 0.5, 0);
    const stumpMat = tree.branchesMesh.material;
    const stumpMatClone = Array.isArray(stumpMat) ? stumpMat[0].clone() : stumpMat.clone();
    patchMaterialPlaneCut(stumpMatClone, planeNormal, planeD, false);
    const stump = new THREE.Mesh(stumpGeo, stumpMatClone);
    stump.castShadow = true;
    stump.receiveShadow = true;
    stump.position.set(tree.position.x, 0, tree.position.z);
    stump.rotation.y = tree.rotation.y;
    this.scene.add(stump);

    const branchesClone = tree.branchesMesh.clone(true);
    const leavesClone = tree.leavesMesh.clone(true);

    const applyCut = (mesh) => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const next = mats.map((m) => {
        const c = m.clone();
        patchMaterialPlaneCut(c, planeNormal, planeD, true);
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? next : next[0];
    };
    applyCut(branchesClone);
    applyCut(leavesClone);

    this._attachFallingTree(tree, treeForest, pivotWorld, branchesClone, leavesClone);
  }

  /**
   * @param {Tree} tree
   * @param {import("./trees.js").TreeForest} treeForest
   * @param {THREE.Vector3} pivotWorld
   * @param {THREE.Mesh} branchesClone
   * @param {THREE.Mesh} leavesClone
   */
  _attachFallingTree(tree, treeForest, pivotWorld, branchesClone, leavesClone) {
    const shell = new THREE.Group();
    shell.add(branchesClone, leavesClone);

    treeForest.removeTree(tree);

    const pivot = new THREE.Group();
    pivot.name = "TreeChopPivot";
    pivot.position.copy(pivotWorld);
    this.scene.add(pivot);

    shell.position.set(
      tree.position.x - pivotWorld.x,
      tree.position.y - pivotWorld.y,
      tree.position.z - pivotWorld.z
    );
    shell.rotation.copy(tree.rotation);
    shell.scale.copy(tree.scale);
    pivot.add(shell);

    const fallDir = new THREE.Vector3(pivotWorld.x - tree.position.x, 0, pivotWorld.z - tree.position.z);
    if (fallDir.lengthSq() < 1e-6) fallDir.set(1, 0, 0);
    else fallDir.normalize();
    const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fallDir).normalize();

    const falling = new FallingTree(pivot, shell, branchesClone, leavesClone, axis);
    this.fallen.push(falling);
    this._beginCinematic(pivotWorld, falling);
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    for (const f of this.fallen) {
      f.update(dt);
    }
  }
}

class FallingTree {
  /**
   * @param {THREE.Group} pivot
   * @param {THREE.Group} shell
   * @param {THREE.Mesh} branchesMesh
   * @param {THREE.Mesh} leavesMesh
   * @param {THREE.Vector3} fallAxisWorld
   */
  constructor(pivot, shell, branchesMesh, leavesMesh, fallAxisWorld) {
    this.pivot = pivot;
    this.shell = shell;
    this.branchesMesh = branchesMesh;
    this.leavesMesh = leavesMesh;
    this.fallAxis = fallAxisWorld.clone();
    this.state = "falling";
    this.angle = 0;
    this.angularVel = 0;
    this.groundAngle = Math.PI * 0.5 - 0.08;
    this.bend = 0;
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    if (this.state === "falling") {
      const g = 4.2;
      this.angularVel += g * Math.cos(this.angle) * dt;
      this.angularVel *= 0.995;
      const step = this.angularVel * dt;
      this.pivot.rotateOnWorldAxis(this.fallAxis, step);
      this.angle += Math.abs(step);

      this.shell.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this.shell);
      if (box.min.y < 0.05 || this.angle > this.groundAngle) {
        this.state = "settled";
        this.angularVel *= 0.35;
      }
    } else if (this.state === "settled") {
      this.bend = Math.min(1, this.bend + dt * 1.8);
      const lm = this.leavesMesh?.material;
      const sh = lm?.userData?.shader;
      if (sh?.uniforms?.uWindStrength) {
        const w = 0.55 + this.bend * 1.2;
        sh.uniforms.uWindStrength.value.set(w, 0, w);
      }
      this.shell.rotation.x += (1 - this.bend) * 0.04 * dt;
    }
  }
}
