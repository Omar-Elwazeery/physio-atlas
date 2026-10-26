import * as THREE from 'three';
import type { MuscleInfo, Side, Structure } from '../types';
import type { Rig } from './rig';
import { CERVICAL, LUMBAR, THORACIC } from './spec';

export type SkinSpec =
  | { mode: 'rigid'; node: string }
  | { mode: 'chain'; nodes: string[] }
  | { mode: 'spine'; nodes: string[] }
  | { mode: 'lateral'; lateral: string; medial: string };

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Principal axis of a point cloud (power iteration on the covariance matrix). */
function principalAxis(pos: ArrayLike<number>, centroid: THREE.Vector3): THREE.Vector3 {
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  const n = pos.length / 3;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i] - centroid.x, y = pos[i + 1] - centroid.y, z = pos[i + 2] - centroid.z;
    xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z;
  }
  const v = new THREE.Vector3(1, 0.7, 0.3).normalize();
  for (let it = 0; it < 40; it++) {
    v.set(xx * v.x + xy * v.y + xz * v.z, xy * v.x + yy * v.y + yz * v.z, xz * v.x + yz * v.y + zz * v.z);
    if (v.lengthSq() === 0) return new THREE.Vector3(0, 1, 0);
    v.normalize();
  }
  void n;
  return v;
}

export interface SkinResult {
  /** Vertex indices of the two ends of a muscle (origin side first), for length-change read-outs. */
  ends?: [number, number];
  /** Rig bone indices the muscle is attached to at those two ends (origin bone, insertion bone). */
  endBones?: [number, number];
}

/** Writes skinIndex/skinWeight attributes onto the geometry. */
export function skinGeometry(geom: THREE.BufferGeometry, spec: SkinSpec, rig: Rig): SkinResult {
  const pos = geom.getAttribute('position');
  const n = pos.count;
  const idx = new Uint16Array(n * 4);
  const wts = new Float32Array(n * 4);
  const arr = pos.array as Float32Array;
  let ends: [number, number] | undefined;
  let endBones: [number, number] | undefined;

  const setWeights = (v: number, w: number[], bones: number[]) => {
    // keep the four strongest influences
    const order = w.map((x, i) => i).sort((a, b) => w[b] - w[a]).slice(0, 4);
    let sum = 0;
    for (const i of order) sum += w[i];
    if (sum <= 0) { idx[v * 4] = bones[0]; wts[v * 4] = 1; return; }
    order.forEach((i, k) => { idx[v * 4 + k] = bones[i]; wts[v * 4 + k] = w[i] / sum; });
  };

  if (spec.mode === 'rigid') {
    const b = rig.node(spec.node).index;
    for (let v = 0; v < n; v++) { idx[v * 4] = b; wts[v * 4] = 1; }
  } else if (spec.mode === 'lateral') {
    const lat = rig.node(spec.lateral).index;
    const med = rig.node(spec.medial).index;
    let lo = Infinity, hi = -Infinity;
    for (let v = 0; v < n; v++) { const x = Math.abs(arr[v * 3]); lo = Math.min(lo, x); hi = Math.max(hi, x); }
    for (let v = 0; v < n; v++) {
      const t = smooth(lo, hi, Math.abs(arr[v * 3]));
      setWeights(v, [t, 1 - t], [lat, med]);
    }
  } else if (spec.mode === 'spine') {
    const nodes = [...spec.nodes].map((id) => rig.node(id)).sort((a, b) => a.pivot.y - b.pivot.y);
    const ys = nodes.map((nd) => nd.pivot.y);
    const bones = nodes.map((nd) => nd.index);
    let lo = Infinity, hi = -Infinity, lov = 0, hiv = 0;
    for (let v = 0; v < n; v++) {
      const y = arr[v * 3 + 1];
      if (y < lo) { lo = y; lov = v; }
      if (y > hi) { hi = y; hiv = v; }
      if (y <= ys[0]) { idx[v * 4] = bones[0]; wts[v * 4] = 1; continue; }
      if (y >= ys[ys.length - 1]) { idx[v * 4] = bones[bones.length - 1]; wts[v * 4] = 1; continue; }
      let k = 0;
      while (ys[k + 1] < y) k++;
      const t = (y - ys[k]) / (ys[k + 1] - ys[k]);
      setWeights(v, [1 - t, t], [bones[k], bones[k + 1]]);
    }
    if (nodes.length > 1) { ends = [lov, hiv]; endBones = [bones[0], bones[bones.length - 1]]; }
  } else {
    const nodes = spec.nodes.map((id) => rig.node(id));
    const c = new THREE.Vector3();
    for (let v = 0; v < n; v++) c.add(new THREE.Vector3(arr[v * 3], arr[v * 3 + 1], arr[v * 3 + 2]));
    c.divideScalar(n);
    // Line of action: the part's principal axis, oriented origin -> insertion by the chain's own
    // direction. Short or wide parts (e.g. a muscle head) have an unreliable principal axis, so they
    // fall back to the chain direction.
    const chainDir = nodes[nodes.length - 1].centroid.clone().sub(nodes[0].centroid).normalize();
    const axis = principalAxis(arr, c);
    if (Math.abs(axis.dot(chainDir)) < 0.6) axis.copy(chainDir);
    else if (axis.dot(chainDir) < 0) axis.negate();
    const t = new Float32Array(n);
    let tMin = Infinity, tMax = -Infinity, vMin = 0, vMax = 0;
    for (let v = 0; v < n; v++) {
      t[v] = (arr[v * 3] - c.x) * axis.x + (arr[v * 3 + 1] - c.y) * axis.y + (arr[v * 3 + 2] - c.z) * axis.z;
      if (t[v] < tMin) { tMin = t[v]; vMin = v; }
      if (t[v] > tMax) { tMax = t[v]; vMax = v; }
    }
    const b: number[] = [];
    for (let j = 1; j < nodes.length; j++) {
      let bj = nodes[j].pivot.clone().sub(c).dot(axis);
      if (j > 1) bj = Math.max(bj, b[j - 2] + 0.004);
      b.push(bj);
    }
    const w = Math.min(0.05, Math.max(0.012, 0.1 * (tMax - tMin)));
    const bones = nodes.map((nd) => nd.index);
    const S = new Array(nodes.length + 1).fill(0);
    const wt = new Array(nodes.length).fill(0);
    for (let v = 0; v < n; v++) {
      S[0] = 1; S[nodes.length] = 0;
      for (let j = 1; j < nodes.length; j++) S[j] = smooth(b[j - 1] - w, b[j - 1] + w, t[v]);
      for (let j = 0; j < nodes.length; j++) wt[j] = Math.max(0, S[j] - S[j + 1]);
      setWeights(v, wt, bones);
    }
    ends = [vMin, vMax];
    endBones = [bones[0], bones[bones.length - 1]];
  }
  geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
  return { ends, endBones };
}

const SPINE_ALL = [...LUMBAR, ...THORACIC, ...CERVICAL];
const CERV_HEAD = [...CERVICAL, 'skull'];

/** Chooses how a structure is bound to the rig. */
export function resolveSkin(s: Structure, rig: Rig, info?: MuscleInfo): SkinSpec {
  const side: Side = s.side;
  if (s.kind === 'disc') return { mode: 'spine', nodes: SPINE_ALL };
  if (s.kind === 'cartilage') {
    const n = s.key.replace('costal-cartilage-', '');
    return { mode: 'lateral', lateral: `t${n}`, medial: 'sternum' };
  }
  if (s.kind === 'bone') return { mode: 'rigid', node: rig.carriedBy.get(s.id) ?? 'pelvis' };

  const res = (b: string) => rig.resolve(b, side);
  if (info?.chain && info.chain.length > 1) return { mode: 'chain', nodes: info.chain.map(res) };
  if (info?.spine) return { mode: 'spine', nodes: info.spine.map(res) };
  if (info?.carrier) return { mode: 'rigid', node: res(info.carrier) };
  // Deep spinal muscles without curated data: follow their spinal region.
  if (/lumbar|lumbrical-?back/.test(s.key)) return { mode: 'spine', nodes: ['pelvis', ...LUMBAR] };
  if (/thoracic|thoracis|intercostal|rotator|spinalis/.test(s.key)) return { mode: 'spine', nodes: [...LUMBAR, ...THORACIC] };
  if (/cervic|capitis|colli/.test(s.key)) return { mode: 'spine', nodes: CERV_HEAD };
  return { mode: 'rigid', node: 'pelvis' };
}
