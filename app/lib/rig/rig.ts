import * as THREE from 'three';
import type { Side, Structure, V3 } from '../types';
import { DOFS, NODES, dofKey, type AxisId, type Geo, type RigNodeSpec } from './spec';

export interface RigNode {
  id: string;
  base: string;
  side: Side;
  spec: RigNodeSpec;
  parent: string | null;
  bone: THREE.Bone;
  index: number;
  /** Bind-pose world position of the joint. */
  pivot: THREE.Vector3;
  carries: string[];
  /** Centre of the geometry the node carries, bind pose. */
  centroid: THREE.Vector3;
  /** Rotation about x that cancels the model's resting flexion at this joint (radians). */
  restRad: number;
}

const ORDER: Record<AxisId, number> = { x: 0, z: 1, y: 2, forearm: 2 };
const AXES: Record<'x' | 'y' | 'z', THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

const sidesOf = (paired: boolean): Side[] => (paired ? ['l', 'r'] : ['m']);
const nid = (base: string, side: Side) => (side === 'm' ? base : `${base}-${side}`);
const flip = (s: Side): Side => (s === 'l' ? 'r' : s === 'r' ? 'l' : 'm');

interface Contribution { order: number; axis: THREE.Vector3; rad: number }

export class Rig {
  nodes = new Map<string, RigNode>();
  bones: THREE.Bone[] = [];
  skeleton!: THREE.Skeleton;
  root!: THREE.Bone;
  /** structure id -> node id */
  carriedBy = new Map<string, string>();
  private forearmAxis = new Map<Side, THREE.Vector3>();
  /** Keep the lowest foot point on the floor by moving the root vertically. */
  grounding = true;
  private groundPts: { node: RigNode; p: THREE.Vector3 }[] = [];
  private restFloor = 0;
  private rootBase = new THREE.Vector3();
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private tmp = new THREE.Quaternion();

  constructor(private structures: Map<string, Structure>) {
    this.build();
  }

  private get(id: string): Structure {
    const s = this.structures.get(id);
    if (!s) throw new Error(`rig: structure "${id}" missing from manifest`);
    return s;
  }

  private build() {
    const specById = new Map(NODES.map((n) => [n.id, n]));
    for (const spec of NODES) {
      for (const side of sidesOf(spec.paired)) {
        const geo: Geo = {
          side,
          s: (key) => this.get(spec.paired ? `${key}-${side}` : key),
          other: (key) => this.get(`${key}-${flip(side)}`),
        };
        const id = nid(spec.id, side);
        const pSpec = spec.parent ? specById.get(spec.parent)! : null;
        const parent = pSpec ? nid(pSpec.id, pSpec.paired ? side : 'm') : null;
        const bone = new THREE.Bone();
        bone.name = id;
        const pivot = new THREE.Vector3(...spec.pivot(geo));
        const carries = this.expandCarries(spec, side);
        const centroid = new THREE.Vector3();
        let n = 0;
        for (const sid of carries) {
          const [lo, hi] = this.get(sid).bbox;
          centroid.add(new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2));
          n++;
        }
        if (n) centroid.divideScalar(n); else centroid.copy(pivot);
        const restRad = spec.rest ? this.restFlexion(spec, side) : 0;
        this.nodes.set(id, { id, base: spec.id, side, spec, parent, bone, index: this.bones.length, pivot, carries, centroid, restRad });
        this.bones.push(bone);
        for (const sid of carries) this.carriedBy.set(sid, id);
      }
    }
    for (const node of this.nodes.values()) {
      if (node.parent) {
        const p = this.nodes.get(node.parent)!;
        p.bone.add(node.bone);
        node.bone.position.copy(node.pivot).sub(p.pivot);
      } else {
        this.root = node.bone;
        node.bone.position.copy(node.pivot);
      }
    }
    // Pronation/supination axis: radial head -> distal ulna.
    for (const side of ['l', 'r'] as Side[]) {
      const a = new THREE.Vector3(...this.get(`radius-${side}`).lm.y1);
      const b = new THREE.Vector3(...this.get(`ulna-${side}`).lm.y0);
      this.forearmAxis.set(side, b.sub(a).normalize());
    }
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    this.rootBase.copy(this.root.position);
    for (const side of ['l', 'r'] as Side[]) {
      const pts: [string, keyof import('../types').Landmarks][] = [['calcaneus', 'y0'], ['metatarsal-1', 'z1'], ['metatarsal-5', 'z1'], ['hallux-distal', 'z1']];
      for (const [k, l] of pts) {
        const id = `${k}-${side}`;
        const node = this.nodes.get(this.carriedBy.get(id) ?? '');
        if (node) this.groundPts.push({ node, p: new THREE.Vector3(...this.get(id).lm[l]) });
      }
    }
    this.restFloor = this.floorY();
  }

  /** Lowest world-space y of the foot landmarks in the current pose. */
  private floorY(): number {
    let y = Infinity;
    for (const g of this.groundPts) {
      this.v.copy(g.p).applyMatrix4(this.skeleton.boneInverses[g.node.index]).applyMatrix4(g.node.bone.matrixWorld);
      y = Math.min(y, this.v.y);
    }
    return y;
  }

  /** Angle of a bone's long axis in the sagittal plane, degrees from straight down, positive = anterior. */
  private axisAngle(id: string): number {
    const lm = this.get(id).lm;
    return (Math.atan2(lm.y0[2] - lm.y1[2], lm.y1[1] - lm.y0[1]) * 180) / Math.PI;
  }

  private restFlexion(spec: RigNodeSpec, side: Side): number {
    const sfx = (k: string) => (spec.paired ? `${k}-${side}` : k);
    const flex = this.axisAngle(sfx(spec.carries[0])) - this.axisAngle(sfx(spec.rest!.from));
    return THREE.MathUtils.degToRad(-spec.rest!.sign * flex);
  }

  private expandCarries(spec: RigNodeSpec, side: Side): string[] {
    const out: string[] = [];
    for (const c of spec.carries) {
      if (c.startsWith('@')) {
        const g = c.slice(1);
        for (const s of this.structures.values()) if (s.group === g && (!spec.paired || s.side === side) && s.kind === 'bone') out.push(s.id);
      } else if (c.endsWith('*')) {
        const k = c.slice(0, -1);
        for (const sd of ['l', 'r']) if (this.structures.has(`${k}-${sd}`)) out.push(`${k}-${sd}`);
      } else {
        out.push(spec.paired ? `${c}-${side}` : c);
      }
    }
    return out;
  }

  /** Rig node carrying the structure, as a bone index. */
  node(id: string): RigNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`rig: no node "${id}"`);
    return n;
  }

  /** Base node id (e.g. "femur") for a muscle on `side` -> concrete node id. */
  resolve(base: string, side: Side): string {
    if (this.nodes.has(base)) return base;
    const id = nid(base, side === 'm' ? 'l' : side);
    if (!this.nodes.has(id)) throw new Error(`rig: cannot resolve "${base}" for side ${side}`);
    return id;
  }

  /**
   * Apply a pose. `angles` maps `<joint>.<dof>[.<side>]` to degrees (positive = the DOF's `pos` movement).
   * Returns the effective per-node rotation so callers can read the result (for ROM read-outs).
   */
  pose(angles: Record<string, number>) {
    const contrib = new Map<string, Contribution[]>();
    const push = (nodeId: string, c: Contribution) => {
      const a = contrib.get(nodeId);
      if (a) a.push(c); else contrib.set(nodeId, [c]);
    };
    const val = (k: string) => angles[k] ?? 0;

    for (const d of DOFS) {
      for (const side of sidesOf(d.paired)) {
        const v = val(dofKey(d, side));
        if (!v) continue;
        const sgn = d.sign * (d.mirror && side === 'r' ? -1 : 1);
        const axis = d.axis === 'forearm' ? this.forearmAxis.get(side)! : AXES[d.axis];
        for (const t of d.targets) {
          const id = nid(t.node, d.paired ? side : 'm');
          push(id, { order: ORDER[d.axis], axis, rad: THREE.MathUtils.degToRad(v * sgn * t.w) });
        }
      }
    }

    // Couplings --------------------------------------------------------------------------------------
    for (const side of ['l', 'r'] as Side[]) {
      const m = side === 'r' ? -1 : 1;
      const flex = Math.max(0, val(`shoulder.flexion-extension.${side}`));
      const abd = Math.max(0, val(`shoulder.abduction-adduction.${side}`));
      const elev = Math.max(flex, abd);
      // Scapulohumeral rhythm: the clavicle and scapula rotate upward as the arm elevates; the humerus
      // rotates back by the same amount so the arm ends exactly where the slider says.
      const clav = THREE.MathUtils.degToRad(0.15 * elev * m);
      const scap = THREE.MathUtils.degToRad(0.2 * Math.max(0, elev - 30) * m);
      if (clav) push(`clavicle-${side}`, { order: ORDER.z, axis: AXES.z, rad: clav });
      if (scap) push(`scapula-${side}`, { order: ORDER.z, axis: AXES.z, rad: scap });
      if (clav + scap) push(`humerus-${side}`, { order: -1, axis: AXES.z, rad: -(clav + scap) });
      // Patella tracks the knee at about half the angle.
      const knee = val(`knee.flexion-extension.${side}`);
      if (knee) push(`patella-${side}`, { order: 0, axis: AXES.x, rad: THREE.MathUtils.degToRad(knee * 0.5) });
    }

    for (const node of this.nodes.values()) {
      const list = contrib.get(node.id);
      this.q.identity();
      if (node.restRad) this.q.setFromAxisAngle(AXES.x, node.restRad);
      if (list) {
        list.sort((a, b) => a.order - b.order);
        for (const c of list) this.q.multiply(this.tmp.setFromAxisAngle(c.axis, c.rad));
      }
      node.bone.quaternion.copy(this.q);
    }
    this.root.position.copy(this.rootBase);
    this.root.updateMatrixWorld(true);
    if (this.grounding && this.groundPts.length) {
      this.root.position.y += this.restFloor - this.floorY();
      this.root.updateMatrixWorld(true);
    }
  }

  /** Bind-pose position of a node's pivot as a tuple. */
  pivotOf(id: string): V3 {
    const p = this.node(id).pivot;
    return [p.x, p.y, p.z];
  }
}
