import * as THREE from 'three';

/** Remembers the elements of a list of matrices so a later call can tell cheaply whether any of them changed. */
export class MatrixStamp {
  private v = new Float64Array(0);
  private set = false;

  matches(mats: readonly THREE.Matrix4[]): boolean {
    if (!this.set || this.v.length !== mats.length * 16) return false;
    const v = this.v;
    for (let i = 0, o = 0; i < mats.length; i++) {
      const e = mats[i].elements;
      for (let k = 0; k < 16; k++, o++) if (v[o] !== e[k]) return false;
    }
    return true;
  }

  record(mats: readonly THREE.Matrix4[]) {
    if (this.v.length !== mats.length * 16) this.v = new Float64Array(mats.length * 16);
    for (let i = 0; i < mats.length; i++) this.v.set(mats[i].elements, i * 16);
    this.set = true;
  }

  clear() { this.set = false; }
}

interface Item {
  mesh: THREE.SkinnedMesh;
  /** Bind-pose bounding sphere of the geometry, in bind space (after `bindMatrix`). */
  center: THREE.Vector3;
  radius: number;
  /** Bones with a non-zero weight on at least one vertex. */
  bones: number[];
}

const _c = new THREE.Vector3();
const _box = new THREE.Box3();
const _pts: THREE.Vector3[] = [];

/**
 * Conservative, cheap bounding spheres for skinned meshes whose bones are rigid (rotation + translation only).
 *
 * A skinned vertex is p' = sum_i w_i * M_i * p with w_i >= 0, sum w_i = 1 and M_i = bone.matrixWorld * boneInverse.
 * When every M_i is rigid and the bind-pose vertices lie in the sphere (c, r), each M_i * p lies in the sphere
 * (M_i * c, r), so p' lies in the convex hull of those spheres. Any sphere that encloses all the centres M_i * c,
 * grown by r, contains that hull. So the bound costs one matrix-vector product per influencing bone (one for a bone,
 * two or three for most muscles) instead of a pass over every vertex, and it can never be smaller than the posed
 * mesh: frustum culling with it cannot hide anything that is on screen.
 */
export class SkinBounds {
  private items: Item[] = [];
  private mats: THREE.Matrix4[] = [];
  private worlds: THREE.Matrix4[] = [];
  private stamp = new MatrixStamp();

  constructor(private skeleton: THREE.Skeleton) {
    this.mats = skeleton.bones.map(() => new THREE.Matrix4());
    this.worlds = skeleton.bones.map((b) => b.matrixWorld);
  }

  /** Registers a mesh bound to this skeleton and turns frustum culling on for it. */
  add(mesh: THREE.SkinnedMesh) {
    const g = mesh.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const s = g.boundingSphere!.clone().applyMatrix4(mesh.bindMatrix);
    const idx = g.getAttribute('skinIndex').array as ArrayLike<number>;
    const wt = g.getAttribute('skinWeight').array as ArrayLike<number>;
    const bones = new Set<number>();
    for (let i = 0; i < wt.length; i++) if (wt[i] > 0) bones.add(idx[i]);
    if (!bones.size) bones.add(0);
    mesh.boundingSphere = new THREE.Sphere();
    mesh.frustumCulled = true;
    // A small absolute + relative margin covers float rounding between this and the GPU's skinning.
    this.items.push({ mesh, center: s.center, radius: s.radius * 1.001 + 1e-3, bones: [...bones] });
    this.stamp.clear();
  }

  /**
   * Recomputes every sphere if any bone moved since the last call. Bone world matrices must be current.
   * Returns whether anything was recomputed.
   */
  update(): boolean {
    if (this.stamp.matches(this.worlds)) return false;
    this.stamp.record(this.worlds);
    const { bones, boneInverses } = this.skeleton;
    for (let i = 0; i < bones.length; i++) this.mats[i].multiplyMatrices(bones[i].matrixWorld, boneInverses[i]);
    for (const it of this.items) {
      const sph = it.mesh.boundingSphere!;
      if (it.bones.length === 1) {
        sph.center.copy(it.center).applyMatrix4(this.mats[it.bones[0]]);
        sph.radius = it.radius;
      } else {
        _box.makeEmpty();
        while (_pts.length < it.bones.length) _pts.push(new THREE.Vector3());
        for (let k = 0; k < it.bones.length; k++) _box.expandByPoint(_pts[k].copy(it.center).applyMatrix4(this.mats[it.bones[k]]));
        _box.getCenter(_c);
        let far = 0;
        for (let k = 0; k < it.bones.length; k++) far = Math.max(far, _pts[k].distanceTo(_c));
        sph.center.copy(_c);
        sph.radius = far + it.radius;
      }
      // Back to the mesh's local space (identity for this app's bind, but keep the general form).
      sph.applyMatrix4(it.mesh.bindMatrixInverse);
    }
    return true;
  }
}
