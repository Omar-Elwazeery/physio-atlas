import * as THREE from 'three';
import type { MuscleInfo, Side, Structure } from '../types';
import type { Rig, RigNode } from './rig';
import type { BoneProximity } from './proximity';
import { CERVICAL, DOFS, LUMBAR, THORACIC, dofKey } from './spec';

export type SkinSpec =
  | { mode: 'rigid'; node: string }
  | { mode: 'chain'; nodes: string[] }
  | { mode: 'spine'; nodes: string[] }
  | { mode: 'lateral'; lateral: string; medial: string }
  /**
   * Fixed to the bones of several rig nodes (ligaments, capsules, sheaths...): blended by proximity, see skinAttach.
   * `nodes` lists those nodes, then the arc nodes of the joints between them (see attachNodes).
   */
  | { mode: 'attach'; nodes: string[] };

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
  /** Chain mode: the line of action (unit vector, origin -> insertion) and the point it passes through. */
  axis?: THREE.Vector3;
  centre?: THREE.Vector3;
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
  let line: { axis: THREE.Vector3; centre: THREE.Vector3 } | undefined;

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
    // chain (an 'attach' skin without bone geometry at hand falls back to it, in the order of its nodes)
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
    line = { axis, centre: c };
  }
  geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
  return { ends, endBones, ...(line ? { axis: line.axis, centre: line.centre } : {}) };
}

/** Where a structure's strain read-out is measured: an end vertex of one of its meshes, per end, and the end bones. */
export interface StructureSkin {
  ends?: [{ part: number; v: number }, { part: number; v: number }];
  endBones?: [number, number];
  /** A baked skin has no end vertices (indices do not survive mesh compression): their bind-pose positions instead. */
  endPoints?: [THREE.Vector3, THREE.Vector3];
}

/** The strain ends of a structure whose skin the model build baked (`Structure.strainEnds`), as skinStructure would return them. */
export function bakedEnds(e: NonNullable<Structure['strainEnds']>, rig: Rig): StructureSkin {
  return { endPoints: [new THREE.Vector3(...e.at[0]), new THREE.Vector3(...e.at[1])], endBones: [rig.node(e.nodes[0]).index, rig.node(e.nodes[1]).index] };
}

/** Rig nodes a tendon may follow beyond its muscle's chain: the digits, the foot below the talus, the patella. */
const ANCHOR_NODE = /^((index|middle|ring|little|thumb|hallux|toe\d)-(proximal|middle|distal)|foot|patella)-[lr]$/;
/** Tendon-to-bone distances (metres) over which an anchor takes a vertex over: fully within R0, not at all past R1. */
const R0 = 0.003, R1 = 0.015;
/** Weight of the muscle's own nodes in the share-out when the vertex is not near their bones (keeps it continuous). */
const OWN_FLOOR = 0.25;
/** A strain end must lie within this distance (metres) of the bone it is measured on. */
const END_R = 0.01;

/**
 * Anchor nodes for a skin: the digit / foot nodes below the chain's last node (or the rigid carrier), and the
 * patella when the chain crosses the knee. Nodes already in the chain are not anchors.
 */
export function anchorNodes(spec: SkinSpec, rig: Rig): number[] {
  const chain = spec.mode === 'chain' ? spec.nodes : spec.mode === 'rigid' ? [spec.node] : [];
  if (!chain.length) return [];
  const last = chain[chain.length - 1];
  const out = new Set<string>();
  const below = (id: string) => { for (const n of rig.nodes.values()) if (n.parent === id) { if (!chain.includes(n.id) && ANCHOR_NODE.test(n.id)) out.add(n.id); below(n.id); } };
  below(last);
  const side = last.slice(-2);
  if (chain.includes(`femur${side}`) && chain.includes(`tibia${side}`)) out.add(`patella${side}`);
  return [...out].map((id) => rig.node(id).index).sort((a, b) => a - b);
}

/**
 * Skins all parts of a structure as one: the chain (or other mode) is laid out over the union of the parts, so a
 * muscle's heads and its tendons share one line of action and stay joined in every pose. With `prox`, vertices close
 * to the bones of an anchor node (a finger, the foot, the patella; see `anchorNodes`) are handed over to that node in
 * proportion to how much closer they are to it than to their own nodes' bones, so long tendons follow the digits and
 * the foot and the quadriceps tendon rides on the patella. The strain ends are the extremes of the union, each bound
 * to the node that carries most of its weight.
 */
export function skinParts(geoms: THREE.BufferGeometry[], spec: SkinSpec, rig: Rig, prox?: BoneProximity): StructureSkin {
  const counts = geoms.map((g) => g.getAttribute('position').count);
  const n = counts.reduce((a, b) => a + b, 0);
  const all = new Float32Array(n * 3);
  let o = 0;
  for (const g of geoms) { const a = g.getAttribute('position').array as Float32Array; all.set(a.subarray(0, a.length), o); o += a.length; }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(all, 3));
  const res = skinGeometry(merged, spec, rig);
  const si = merged.getAttribute('skinIndex').array as Uint16Array, sw = merged.getAttribute('skinWeight').array as Float32Array;

  const anchors = prox ? anchorNodes(spec, rig) : [];
  if (anchors.length && prox) {
    const w = new Map<number, number>();
    for (let v = 0; v < n; v++) {
      const x = all[v * 3], y = all[v * 3 + 1], z = all[v * 3 + 2];
      const q = (node: number) => 1 - smooth(R0, R1, prox.distance(node, x, y, z, R1));
      let qa = 0;
      const qs: number[] = [];
      for (const a of anchors) { const t = q(a); qs.push(t); qa += t; }
      if (qa <= 0) continue;
      let own = 0;
      for (let k = 0; k < 4; k++) if (sw[v * 4 + k] > 0) own = Math.max(own, q(si[v * 4 + k]));
      const share = qa / (Math.max(own, OWN_FLOOR) + qa);
      w.clear();
      for (let k = 0; k < 4; k++) if (sw[v * 4 + k] > 0) w.set(si[v * 4 + k], (w.get(si[v * 4 + k]) ?? 0) + sw[v * 4 + k] * (1 - share));
      anchors.forEach((a, i) => { if (qs[i] > 0) w.set(a, (w.get(a) ?? 0) + (share * qs[i]) / qa); });
      const top = [...w.entries()].sort((p, r) => r[1] - p[1] || p[0] - r[0]).slice(0, 4);
      const sum = top.reduce((s, [, x]) => s + x, 0);
      for (let k = 0; k < 4; k++) { si[v * 4 + k] = top[k]?.[0] ?? 0; sw[v * 4 + k] = top[k] ? top[k][1] / sum : 0; }
    }
  }

  o = 0;
  geoms.forEach((g, i) => {
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si.slice(o * 4, (o + counts[i]) * 4), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw.slice(o * 4, (o + counts[i]) * 4), 4));
    o += counts[i];
  });
  if (!res.ends || !res.endBones) return {};
  const at = (v: number) => { let p = 0; while (v >= counts[p]) { v -= counts[p]; p++; } return { part: p, v }; };
  let [e0, e1] = res.ends;
  let [b0, b1] = res.endBones;
  // With bone geometry at hand, the strain ends are the attachments: the extreme vertices along the line of action
  // among those within END_R of the origin bone, and of the insertion bone or an anchor it reaches (a phalanx, the
  // foot, the patella), each measured on the bone it is closest to. Plain extremes of the shape otherwise.
  if (prox && res.axis && res.centre) {
    const first = res.endBones[0], last = [res.endBones[1], ...anchors];
    const t = (v: number) => (all[v * 3] - res.centre!.x) * res.axis!.x + (all[v * 3 + 1] - res.centre!.y) * res.axis!.y + (all[v * 3 + 2] - res.centre!.z) * res.axis!.z;
    /** Extreme vertex (sign -1: lowest t, +1: highest) within r of one of `nodes`, and that node; null if none. */
    const extreme = (nodes: number[], sign: number, r: number) => {
      let bestT = -Infinity, bv = -1, bn = -1;
      for (let v = 0; v < n; v++) {
        const tv = sign * t(v);
        if (tv <= bestT) continue;
        let near = -1, bd = r;
        for (const node of nodes) { const d = prox.distance(node, all[v * 3], all[v * 3 + 1], all[v * 3 + 2], r); if (d < bd) { bd = d; near = node; } }
        if (near >= 0) { bestT = tv; bv = v; bn = near; }
      }
      return bv >= 0 ? { v: bv, node: bn } : null;
    };
    // A muscle whose tendon belongs to another structure (the vasti end on the quadriceps tendon, a few mm short of
    // the patella) gets a second, wider search before falling back to the plain extreme.
    const o0 = extreme([first], -1, END_R) ?? extreme([first], -1, 2.5 * END_R);
    const o1 = extreme(last, 1, END_R) ?? extreme(last, 1, 2.5 * END_R);
    if (o0) e0 = o0.v;
    if (o1) { e1 = o1.v; b1 = o1.node; }
    b0 = first;
  }
  return { ends: [at(e0), at(e1)], endBones: [b0, b1] };
}

/** Proximity blend ('attach' skins): search radius and distance floor (metres), and the band shares are sharpened over. */
export const ATTACH_MAX = 0.12, ATTACH_D0 = 0.0005, ATTACH_BAND: [number, number] = [0.15, 0.85];
/** A vertex this close (metres) to a bone vertex is on that bone: an attachment, held rigid with it. */
export const ATTACH_PIN = 0.002;
/** Rings of mesh neighbours around a meeting of two attachments to different bones that are left free to blend. */
export const ATTACH_BUFFER = 3;
/** A vertex this close (metres) to a turning joint surface lies over it: it slides there, it is not attached. */
export const ATTACH_SLIDE = 0.004;
/** ... unless following another bone of the structure through its range would take it this much deeper (metres) into the bone it lies on. */
export const ATTACH_SLIDE_IN = 0.01;
/** Length (metres) over which the proximity shares are smoothed along the surface, at the bone; it grows by the distance from the bone. */
export const ATTACH_SMOOTH = 0.012;
/**
 * Release (`AttachOptions.release`): an edge that grows beyond ATTACH_STRETCH times its length and by more than
 * ATTACH_STRETCH_MIN metres at an end of range frees the attachment vertices at its ends and next to them, if they lie
 * within ATTACH_ERODE_FIRST metres of the attachment's rim; at most ATTACH_ROUNDS times. If nothing more can be freed
 * that way while an edge still tears outright (KEEP_OUT_STRETCH), the rim widens to ATTACH_ERODE (not at a joint with
 * bulge nodes, where step 7 takes the squeeze up).
 */
export const ATTACH_STRETCH = 2.5, ATTACH_STRETCH_MIN = 0.004, ATTACH_ROUNDS = 10, ATTACH_ERODE_FIRST = 0.003, ATTACH_ERODE = 0.0045;
/**
 * Keep-out (step 7, `AttachOptions.inside`, structures over a joint with arc nodes): the result is posed at these
 * fractions of each end of range; a free vertex that ends up more than KEEP_OUT_TOL metres deeper inside one of the
 * structure's bones than at rest has its share along the arc bounded, searched in KEEP_OUT_STEPS steps and taken
 * KEEP_OUT_MARGIN further; at most KEEP_OUT_ROUNDS times. A bound that makes an edge grow beyond KEEP_OUT_STRETCH
 * times its length and by more than KEEP_OUT_STRETCH_MIN metres is first halved towards no bound, KEEP_OUT_SOFTEN
 * times, then dropped. Finally the weights where step 7 acted are relaxed towards their neighbours' KEEP_OUT_RELAX
 * times, as far as that keeps them out of the bones.
 * An axial rotation (DOF axis 'long': shoulder, hip) is also checked with the limb swung KEEP_OUT_SWING degrees either
 * way in each other plane of the joint: the limb turns at any elevation, and a check of the rotation alone leaves the
 * capsule with bounds that hold only with the arm at its rest angle (the GH capsule then entered the humeral neck in
 * flexion and tore at full abduction; phase 7). There the share is searched in KEEP_OUT_STEPS_ROT steps: the finer
 * search finds shares that the extra checks would otherwise rule out (at the knee it let the capsule in deeper).
 */
/** DOF joints whose joints step 7 also keeps soft tissue out across without arc nodes (see `keepJoint` in skinAttach). */
export const DIGIT_JOINTS = ['fingers', 'thumb', 'toes'];
export const KEEP_OUT_PARTS =[0.25, 0.5, 0.75, 1], KEEP_OUT_TOL = 0.0005, KEEP_OUT_ROUNDS = 6, KEEP_OUT_STEPS = 20, KEEP_OUT_MARGIN = 0.1;
/** Along a digit chain, a bound that changes an edge's dihedral angle by more than this (degrees) is softened, then dropped. */
export const KEEP_OUT_FOLD = 60;
export const KEEP_OUT_STRETCH = 3, KEEP_OUT_STRETCH_MIN = 0.015, KEEP_OUT_SOFTEN = 2, KEEP_OUT_RELAX = 3, KEEP_OUT_SWING = 12, KEEP_OUT_STEPS_ROT = 40;
/** Bulge (step 7, a joint with bulge nodes): shares searched in BULGE_STEPS steps; a share spreads to the next ring at BULGE_FADE of it. */
export const BULGE_STEPS = 10, BULGE_FADE = 0.98;
/** A vertex's bulge share is searched a BULGE_MARGIN further than needed; the field between the bounds is BULGE_FADE times its neighbours' mean. */
export const BULGE_MARGIN = 0.1;
/** The smoothing solve: sweep limit, over-relaxation, tolerance. */
const SOLVE_SWEEPS = 4000, SOLVE_SOR = 1.6, SOLVE_TOL = 2e-5;

export interface AttachOptions {
  /**
   * Distance to the joint surfaces that turn about their joint's centre: the cartilage of the humeral and femoral
   * heads, the femoral condyles and the distal humerus, per rig node (the model build has it; the viewer does not).
   * A capsule is fixed around such a surface, not on it, and the head turns beneath it: vertices lying over one are
   * not attached to that bone and are not drawn to it.
   */
  slide?: BoneProximity;
  /**
   * Pose the rig to each end of range of the joints the structure spans and release what tears (step 6). Poses
   * `rig` and leaves it in the neutral pose, so only for a rig nothing is drawn from (the model build).
   */
  release?: boolean;
  /** Release (step 6): the rim freed first, metres (default ATTACH_ERODE_FIRST). The knee's synovial membrane needs the wider ATTACH_ERODE at once. */
  erodeFirst?: number;
  /**
   * With `slide` and `release`: how deep (metres, 0 outside) a point given in the bind frame lies inside the bones a
   * rig node (bone index) carries. A vertex then slides over a joint surface only if following the other bones through
   * their range keeps it out of the bone it lies on; one that would be carried into it (behind the top of a femoral
   * condyle, where the shaft begins) is treated as lying on plain bone.
   */
  inside?: (node: number, x: number, y: number, z: number) => number;
}

/**
 * Proximity skin for a structure fixed to the bones of several rig nodes: a ligament or capsule spanning a joint,
 * a sheath, retinaculum or fascia lying along a limb. `nodeIds` lists the nodes of the bones it is fixed to and,
 * after them, the arc nodes of the joints between them (see `attachNodes`).
 *  1. Per vertex, the distance d_i to the bones of each node; a bone whose turning joint surface the vertex lies over
 *     (`opts.slide`) does not count there, provided the vertex can follow the other bones without entering it.
 *  2. Attachments: a vertex within ATTACH_PIN of a bone moves rigidly with the nearest such bone. Where attachments
 *     to two different bones meet on the mesh (a cruciate ligament touching both condyle and plateau), ATTACH_BUFFER
 *     rings of vertices around the meeting are freed again.
 *  3. Proximity share of every other vertex: t_i = (1 / d_i) / sum_j (1 / d_j), sharpened by smoothstep over
 *     ATTACH_BAND and renormalised. A vertex over a turning joint surface has none: it takes what its neighbours have.
 *  4. The weights are the smoothest field over the mesh that keeps the attachments and stays near the proximity
 *     shares: each free vertex is the mean of its neighbours and its own share, the share counting for as much as
 *     the surface within ATTACH_SMOOTH (plus its distance from the bone) of it; solved by over-relaxed Gauss-Seidel
 *     sweeps. Over a turning joint surface the field is purely harmonic, running evenly from one side to the other.
 *  5. Arc nodes: where the structure spans a joint that has them, the share between the joint's parent node and the
 *     nodes beyond the joint is laid along parent -> arc nodes -> child, so a vertex 40 % of the way across follows
 *     40 % of the rotation instead of the 40 : 60 mix of the two end positions, which cuts through the joint.
 *  6. Release (`opts.release`): the result is posed at each end of range of the joints the structure spans. Where an
 *     edge tears (ATTACH_STRETCH), the attachment vertices at its ends and next to them are freed if they are on the
 *     attachment's rim (ATTACH_ERODE), and step 4 is solved again, so the change of bone spreads out until nothing
 *     more can give or ATTACH_ROUNDS is reached. The middle of an attachment always holds.
 *  7. Keep-out (`opts.inside`, across a joint with arc nodes): the result is posed through the range (KEEP_OUT_PARTS).
 *     A free vertex that would sink into one of the bones (the posterior capsule into the tibia as the knee bends, the
 *     anterior elbow capsule into the coronoid or the humerus) gets a bound on its share along the arc: the nearest
 *     share that keeps it out in every checked pose, a margin further. Step 4 is solved again keeping the bounds
 *     (projected Gauss-Seidel), so the neighbours follow smoothly, and the check repeats. Where no share along the arc
 *     keeps it out, a joint with bulge nodes (the elbow) hands it the smallest share of them that does: it keeps how it
 *     turns and moves out from the hinge axis, and the share spreads to its neighbours (BULGE_FADE), so the capsule
 *     caught between coronoid, radial head and humerus bunches outward. Failing that, it is held to the bone it enters if
 *     that does. A bound that tears the sheet (KEEP_OUT_STRETCH) is softened, then dropped for good; at the end the
 *     weights the step changed are relaxed (KEEP_OUT_RELAX).
 * Vertices out of reach of every node (beyond ATTACH_MAX) follow the first node.
 */
export function skinAttach(geoms: THREE.BufferGeometry[], nodeIds: string[], rig: Rig, prox: BoneProximity, opts: AttachOptions = {}): void {
  const all = nodeIds.map((id) => rig.node(id));
  const base = all.filter((nd) => !nd.spec.between);
  const bones = base.map((nd) => nd.index);
  const m = bones.length;
  const arcs = arcPlan(all, rig);
  // Ends of range of every DOF that turns one of the structure's nodes, as bone matrices (bind -> posed) per node of `all`.
  const poses: Float64Array[] = [];
  /** Half and full range, for the sliding test: per pose and pair of bone nodes (i, j), bind frame of j -> bind frame of i. */
  const sweeps: Float64Array[] = [];
  /** Keep-out (step 7): poses through the range, each with its matrices and per bone node posed -> bind frame of that node. */
  const checks: { M: Float64Array; inv: Float64Array }[] = [];
  /**
   * The joints step 7 bounds shares across: the one joint with arc nodes, or else the digit joints (MCP, IP, MTP;
   * DIGIT_JOINTS) of a structure spanning only those, where the share runs straight from the parent's bone to the next:
   * turning about the centre of the head, the base of the phalanx sweeps through the capsule's half-and-half blend. A
   * finger is straightened from the model's resting flexion in every pose (RigNodeSpec.rest), so there the neutral pose
   * is checked too, and over several digit joints all of them flexed and extended together (a fist). (On every other
   * single-joint ligament the same step halves the intrusion but folds and stretches some, e.g. the calcaneofibular
   * ligament to 1.43x: not done; phase 7 notes.)
   */
  const isDigit = (j: { node: number }) => DOFS.some((d) => DIGIT_JOINTS.includes(d.joint) && d.targets.some((tg) => tg.node === all[j.node].base));
  // A structure along a digit (a tendon sheath) spans its MCP, PIP and DIP joints at once: each gets its own split limit,
  // a vertex being bounded at the joint it is split across. Only when every joint the structure spans is a digit joint.
  const digitChain = !arcs.joints.length && arcs.plain.length > 0 && arcs.plain.every(isDigit);
  const keepJoints = arcs.joints.length === 1 ? [arcs.joints[0]] : digitChain ? arcs.plain : [];
  const keepOut = !!opts.inside && (arcs.joints.length > 0 || keepJoints.length > 0);
  /** Steps of the keep-out share search: finer over a joint with an axial rotation (KEEP_OUT_STEPS_ROT). */
  let steps = KEEP_OUT_STEPS;
  if (opts.release) {
    const ids = new Set(base.map((nd) => nd.id));
    const mat = new THREE.Matrix4();
    for (const dof of DOFS) for (const side of dof.paired ? (['l', 'r'] as const) : (['m'] as const)) {
      if (!dof.targets.some((tg) => ids.has(dof.paired ? `${tg.node}-${side}` : tg.node))) continue;
      for (const value of [dof.min, dof.max]) {
        if (!value) continue;
        for (const part of keepOut ? KEEP_OUT_PARTS : opts.slide && opts.inside ? [0.5, 1] : [1]) {
          rig.pose({ [dofKey(dof, side)]: value * part });
          const M = new Float64Array(all.length * 16);
          all.forEach((nd, i) => { mat.multiplyMatrices(nd.bone.matrixWorld, rig.skeleton.boneInverses[nd.index]); M.set(mat.elements, i * 16); });
          if (part === 1) poses.push(M);
          if (keepOut) {
            const check = (Mc: Float64Array) => {
              const inv = new Float64Array(m * 16);
              for (let i = 0; i < m; i++) { mat.fromArray(Mc, arcs.baseAt[i] * 16).invert(); inv.set(mat.elements, i * 16); }
              checks.push({ M: Mc, inv });
            };
            check(M);
            // an axial rotation of a joint the structure spans (the bone and the one it turns on are both among its
            // nodes), also with the limb swung a little in the joint's other planes (KEEP_OUT_SWING)
            if (dof.axis === 'long' && dof.targets.some((tg) => { const id = dof.paired ? `${tg.node}-${side}` : tg.node; return ids.has(id) && ids.has(rig.node(id).parent ?? ''); })) {
              steps = KEEP_OUT_STEPS_ROT;
              for (const e of DOFS) {
                if (e === dof || e.joint !== dof.joint || e.paired !== dof.paired) continue;
                for (const swing of [-KEEP_OUT_SWING, KEEP_OUT_SWING]) {
                  rig.pose({ [dofKey(dof, side)]: value * part, [dofKey(e, side)]: swing });
                  const Mc = new Float64Array(all.length * 16);
                  all.forEach((nd, i) => { mat.multiplyMatrices(nd.bone.matrixWorld, rig.skeleton.boneInverses[nd.index]); Mc.set(mat.elements, i * 16); });
                  check(Mc);
                }
              }
              rig.pose({ [dofKey(dof, side)]: value * part });
            }
          }
          if (part !== 0.5 && part !== 1) continue;
          if (!opts.slide || !opts.inside) continue;
          const R = new Float64Array(m * m * 16);
          const a = new THREE.Matrix4(), b = new THREE.Matrix4();
          for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
            a.fromArray(M, arcs.baseAt[i] * 16).invert().multiply(b.fromArray(M, arcs.baseAt[j] * 16));
            R.set(a.elements, (i * m + j) * 16);
          }
          sweeps.push(R);
        }
      }
    }
    const checkPose = (pose: Record<string, number>) => {
      rig.pose(pose);
      const M = new Float64Array(all.length * 16);
      all.forEach((nd, i) => { mat.multiplyMatrices(nd.bone.matrixWorld, rig.skeleton.boneInverses[nd.index]); M.set(mat.elements, i * 16); });
      const inv = new Float64Array(m * 16);
      for (let i = 0; i < m; i++) { mat.fromArray(M, arcs.baseAt[i] * 16).invert(); inv.set(mat.elements, i * 16); }
      checks.push({ M, inv });
    };
    // over several digit joints: all of them flexed (a fist), or extended, together
    if (keepOut && digitChain && keepJoints.length > 1) {
      const side = base[0].side;
      const spanned = DOFS.filter((d) => keepJoints.some((j) => d.targets.some((tg) => tg.node === all[j.node].base)));
      for (const end of ['min', 'max'] as const) for (const part of KEEP_OUT_PARTS) {
        const pose: Record<string, number> = {};
        for (const d of spanned) if (d[end]) pose[dofKey(d, side)] = d[end] * part;
        if (Object.keys(pose).length > 1) checkPose(pose);
      }
    }
    // the neutral pose, where a digit stands straightened from the model's resting flexion
    if (keepOut && base.some((nd) => nd.restRad)) checkPose({});
    rig.pose({});
  }
  const d = new Array(m).fill(0), g = new Array(m).fill(0), slides = new Array(m).fill(false);
  for (const geom of geoms) {
    const pos = geom.getAttribute('position').array as Float32Array;
    const n = pos.length / 3;
    // Vertices repeated along UV seams are one vertex here, so the weights cannot split along a seam.
    const rep = new Int32Array(n);
    const seen = new Map<string, number>();
    for (let v = 0; v < n; v++) {
      const k = `${Math.round(pos[v * 3] * 1e6)},${Math.round(pos[v * 3 + 1] * 1e6)},${Math.round(pos[v * 3 + 2] * 1e6)}`;
      const r = seen.get(k);
      if (r === undefined) { seen.set(k, v); rep[v] = v; } else rep[v] = r;
    }
    const nb = new Map<number, Set<number>>();
    const index = geom.getIndex();
    if (index) {
      const ia = index.array as ArrayLike<number>;
      for (let f = 0; f < ia.length; f += 3) for (let k = 0; k < 3; k++) {
        const a = rep[ia[f + k]], b = rep[ia[f + (k + 1) % 3]];
        if (a === b) continue;
        (nb.get(a) ?? nb.set(a, new Set()).get(a)!).add(b);
        (nb.get(b) ?? nb.set(b, new Set()).get(b)!).add(a);
      }
    }
    // 1-3. distances, attachments, proximity shares
    const pin = new Int16Array(n).fill(-1);
    const W = new Float32Array(n * m), prior = new Float32Array(n * m);
    /** Weight of a vertex's own share against one neighbour: (edge length / smoothing length)^2; 0 = no share. */
    const pull = new Float32Array(n);
    for (let v = 0; v < n; v++) {
      if (rep[v] !== v) continue;
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      let sliding = false, near = -1, sum = 0;
      for (let i = 0; i < m; i++) {
        d[i] = prox.nearest(bones[i], x, y, z, ATTACH_MAX);
        // (the cartilage lies on the bone, so only a bone within reach can have its cartilage this near)
        slides[i] = !!opts.slide && d[i] < 0.015 && opts.slide.distance(bones[i], x, y, z, ATTACH_SLIDE) < ATTACH_SLIDE;
        if (slides[i] && opts.inside && sweeps.length) {
          const rest = opts.inside(bones[i], x, y, z);
          for (const R of sweeps) {
            for (let j = 0; j < m && slides[i]; j++) {
              if (j === i) continue;
              const o = (i * m + j) * 16;
              if (opts.inside(bones[i], R[o] * x + R[o + 4] * y + R[o + 8] * z + R[o + 12], R[o + 1] * x + R[o + 5] * y + R[o + 9] * z + R[o + 13], R[o + 2] * x + R[o + 6] * y + R[o + 10] * z + R[o + 14]) > rest + ATTACH_SLIDE_IN) slides[i] = false;
            }
            if (!slides[i]) break;
          }
        }
        if (slides[i]) { d[i] = Infinity; sliding = true; }
        if (near < 0 || d[i] < d[near]) near = i;
        sum += Number.isFinite(d[i]) ? 1 / Math.max(d[i], ATTACH_D0) : 0;
      }
      // `nearest` thins the bones to 2.5 mm, so the attachment test takes the exact distances
      let pd = ATTACH_PIN;
      for (let i = 0; i < m; i++) {
        if (slides[i] || d[i] > ATTACH_PIN + 0.005) continue;
        const di = prox.distance(bones[i], x, y, z, ATTACH_PIN);
        if (di < pd) { pd = di; pin[v] = i; }
      }
      const nbs = nb.get(v);
      let h = 0;
      if (nbs) { for (const u of nbs) h += Math.hypot(pos[u * 3] - x, pos[u * 3 + 1] - y, pos[u * 3 + 2] - z); h /= nbs.size; }
      if (!sliding) pull[v] = (h / (ATTACH_SMOOTH + (Number.isFinite(d[near]) ? d[near] : ATTACH_MAX))) ** 2;
      if (sum <= 0) { W[v * m] = prior[v * m] = 1; continue; }
      let gs = 0;
      for (let i = 0; i < m; i++) { const t = Number.isFinite(d[i]) ? 1 / Math.max(d[i], ATTACH_D0) / sum : 0; d[i] = t; g[i] = smooth(ATTACH_BAND[0], ATTACH_BAND[1], t); gs += g[i]; }
      for (let i = 0; i < m; i++) W[v * m + i] = prior[v * m + i] = gs > 1e-6 ? g[i] / gs : d[i];
    }
    let front = [...nb.keys()].filter((v) => pin[v] >= 0 && [...nb.get(v)!].some((u) => pin[u] >= 0 && pin[u] !== pin[v]));
    const freed = new Set(front);
    for (let ring = 0; ring < ATTACH_BUFFER; ring++) {
      const next: number[] = [];
      for (const v of front) for (const u of nb.get(v)!) if (!freed.has(u)) { freed.add(u); next.push(u); }
      front = next;
    }
    for (const v of freed) pin[v] = -1;
    for (let v = 0; v < n; v++) if (pin[v] >= 0) { for (let i = 0; i < m; i++) W[v * m + i] = 0; W[v * m + pin[v]] = 1; }
    const verts = [...nb.keys()].sort((a, b) => a - b);
    const lists = new Map(verts.map((v) => [v, [...nb.get(v)!]]));
    // 4. smoothest field that keeps the attachments and stays near the proximity shares
    /** Vertices whose weights step 7 has fixed (keep-out). */
    const fixed = new Uint8Array(n);
    // Step 7 may bound a vertex's share beyond one of `keepJoints`, f = beyond / (parent + beyond), to [lo, hi] (the joint
    // is `jt[v]`); the solve keeps it there by moving the weight across that joint (along the arc, if it has arc nodes;
    // projected Gauss-Seidel).
    const J = keepJoints.length === 1 ? keepJoints[0] : null;
    /** Per joint of keepJoints: where its parent node sits among the bone nodes, the nodes beyond it, and its own node. */
    const parentAts = keepJoints.map((j) => arcs.baseAt.indexOf(j.parent));
    const beyondAts = keepJoints.map((j) => arcs.baseAt.map((a, i) => (j.beyond.includes(a) ? i : -1)).filter((i) => i >= 0));
    const nodeAts = keepJoints.map((j) => arcs.baseAt.indexOf(j.node));
    const jt = new Int8Array(n).fill(-1);
    const lo = new Float32Array(n), hi = new Float32Array(n).fill(1), lean = new Int16Array(n).fill(-1);
    // A joint with bulge nodes (the elbow): step 7 may hand a share of a vertex's weight to them, at least `bulLo`; the
    // shares spread to the neighbours, fading by BULGE_FADE per ring, so the capsule bunches out as a smooth fold.
    const BJ = J && J.bulge.length ? J : null;
    const bul = new Float32Array(n), bulLo = new Float32Array(n);
    /** Moves the weights `w[o..o+m]` across joint k to share f beyond it (the beyond nodes keep their proportions; `to` takes it all if they have none). */
    const toShare = (w: Float64Array | Float32Array, o: number, f: number, to: number, k: number) => {
      const parentAt = parentAts[k], beyondAt = beyondAts[k];
      let b = 0;
      for (const i of beyondAt) b += w[o + i];
      const r = w[o + parentAt] + b;
      if (r <= 1e-9) return;
      w[o + parentAt] = (1 - f) * r;
      for (const i of beyondAt) w[o + i] = b > 1e-9 ? (w[o + i] / b) * f * r : i === to ? f * r : 0;
    };
    const project = (v: number) => {
      if (lean[v] < 0) return;
      const k = jt[v], parentAt = parentAts[k];
      let b = 0;
      for (const i of beyondAts[k]) b += Math.max(0, W[v * m + i]);
      const p = Math.max(0, W[v * m + parentAt]), r = p + b;
      if (r <= 1e-9) return;
      const f = b / r;
      if (f < lo[v]) toShare(W, v * m, lo[v], lean[v], k);
      else if (f > hi[v]) toShare(W, v * m, hi[v], lean[v], k);
    };
    const solve = () => {
      const free = verts.filter((v) => pin[v] < 0 && !fixed[v]);
      // (the sweep over flat arrays: the same sums in the same order as walking the neighbour lists)
      const nf = free.length, off = new Int32Array(nf + 1);
      for (let f = 0; f < nf; f++) off[f + 1] = off[f] + lists.get(free[f])!.length;
      const nbr = new Int32Array(off[nf]), lamF = new Float64Array(nf), denF = new Float64Array(nf);
      for (let f = 0; f < nf; f++) {
        const L = lists.get(free[f])!;
        for (let k = 0; k < L.length; k++) nbr[off[f] + k] = L[k] * m;
        lamF[f] = L.length * pull[free[f]]; denF[f] = L.length + lamF[f];
      }
      for (let it = 0; it < SOLVE_SWEEPS; it++) {
        let change = 0;
        for (let f = 0; f < nf; f++) {
          const v = free[f], vo = v * m, lam = lamF[f], den = denF[f], k0 = off[f], k1 = off[f + 1];
          for (let i = 0; i < m; i++) {
            let sum = lam * prior[vo + i];
            for (let k = k0; k < k1; k++) sum += W[nbr[k] + i];
            const cur = W[vo + i];
            const next = cur + SOLVE_SOR * (sum / den - cur);
            const dlt = Math.abs(next - cur);
            if (dlt > change) change = dlt;
            W[vo + i] = next;
          }
          project(v);
        }
        if (change < SOLVE_TOL) break;
      }
      // over-relaxation may leave a weight a hair below 0 or the sum a hair off 1
      for (const v of free) {
        let sum = 0;
        for (let i = 0; i < m; i++) { W[v * m + i] = Math.max(0, W[v * m + i]); sum += W[v * m + i]; }
        if (sum > 0) for (let i = 0; i < m; i++) W[v * m + i] /= sum;
        project(v);
      }
    };
    // 5. arc nodes, then the four strongest influences (as positions in `all`)
    const at = new Uint8Array(n * 4), wts = new Float32Array(n * 4);
    const w = new Float64Array(all.length);
    const order = all.map((_, i) => i);
    const ver = new Uint32Array(n).fill(1);
    const influences = (v: number) => {
      w.fill(0);
      for (let i = 0; i < m; i++) w[arcs.baseAt[i]] = W[v * m + i];
      for (const a of arcs.joints) {
        const wP = w[a.parent];
        let sD = 0;
        for (const b of a.beyond) sD += w[b];
        if (wP <= 0 || sD <= 0) continue;
        const total = wP + sD, k = a.arc.length, u = (sD / total) * (k + 1), i = Math.min(k, Math.floor(u)), f = u - i;
        w[a.parent] = 0;
        if (i < k) for (const b of a.beyond) w[b] = 0; else for (const b of a.beyond) w[b] *= (total * f) / sD;
        w[i === 0 ? a.parent : a.arc[i - 1]] += total * (1 - f);
        if (i < k) w[a.arc[i]] += total * f;
      }
      if (BJ && bul[v] > 0) {
        // the share `bul[v]` of the weight on the parent, the arc nodes and the joint's node goes to their bulge twins
        const b = bul[v], tw = BJ.bulge;
        const hand = (from: number, to: number) => { w[to] += b * w[from]; w[from] *= 1 - b; };
        hand(BJ.parent, tw[0]);
        BJ.arc.forEach((a, i) => hand(a, tw[i + 1]));
        hand(BJ.node, tw[tw.length - 1]);
      }
      order.sort((a, b) => w[b] - w[a] || a - b);
      let total = 0;
      for (let k = 0; k < 4 && k < order.length; k++) total += w[order[k]];
      for (let k = 0; k < 4; k++) {
        const a = k < order.length ? order[k] : 0, x = k >= order.length ? 0 : total > 0 ? w[order[k]] / total : k === 0 ? 1 : 0;
        // (the version counts changes of what the vertex is skinned to: step 7 caches its bone-intrusion queries by it)
        if (at[v * 4 + k] !== a || wts[v * 4 + k] !== Math.fround(x)) ver[v]++;
        at[v * 4 + k] = a;
        wts[v * 4 + k] = x;
      }
    };
    solve();
    for (const v of verts) influences(v);
    // 6. release what tears at an end of range
    if (poses.length) {
      const posed = new Float32Array(n * 3);
      const edge = (a: Float32Array, u: number, v: number) => Math.hypot(a[u * 3] - a[v * 3], a[u * 3 + 1] - a[v * 3 + 1], a[u * 3 + 2] - a[v * 3 + 2]);
      // how deep inside its attachment each attached vertex lies: distance over the mesh to the nearest free vertex
      const depth = new Float64Array(n).fill(Infinity);
      for (const v of verts) if (pin[v] < 0) depth[v] = 0;
      for (let changed = true; changed;) {
        changed = false;
        for (const v of verts) {
          if (depth[v] > ATTACH_ERODE) continue;
          for (const u of lists.get(v)!) {
            const du = depth[v] + edge(pos, u, v);
            if (du < depth[u]) { depth[u] = du; changed = true; }
          }
        }
      }
      // the rim first; deeper only where the sheet still tears outright
      let erode = Math.min(opts.erodeFirst ?? ATTACH_ERODE_FIRST, ATTACH_ERODE);
      for (let round = 0; round < ATTACH_ROUNDS; round++) {
        const torn = new Set<number>();
        let rent = false;
        for (const M of poses) {
          for (const v of verts) {
            const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
            let px = 0, py = 0, pz = 0;
            for (let k = 0; k < 4; k++) {
              const wk = wts[v * 4 + k];
              if (!wk) continue;
              const o = at[v * 4 + k] * 16;
              px += wk * (M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12]);
              py += wk * (M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13]);
              pz += wk * (M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14]);
            }
            posed[v * 3] = px; posed[v * 3 + 1] = py; posed[v * 3 + 2] = pz;
          }
          for (const v of verts) for (const u of lists.get(v)!) {
            if (u < v) continue;
            const l0 = edge(pos, u, v), l1 = edge(posed, u, v);
            if (l1 > ATTACH_STRETCH * l0 && l1 - l0 > ATTACH_STRETCH_MIN) { torn.add(u); torn.add(v); }
            if (l1 > KEEP_OUT_STRETCH * l0 && l1 - l0 > KEEP_OUT_STRETCH_MIN) rent = true;
          }
        }
        let released = 0;
        for (const v of torn) for (const u of [v, ...lists.get(v)!]) if (pin[u] >= 0 && depth[u] <= erode) { pin[u] = -1; released++; }
        if (!released && rent && erode < ATTACH_ERODE && !BJ) { erode = ATTACH_ERODE; round--; continue; }
        if (!released) break;
        solve();
        for (const v of verts) influences(v);
      }
    }
    // 7. keep out of the bones
    if (checks.length && opts.inside) {
      const inside = opts.inside;
      const rest = new Map<number, Float32Array>();
      const restOf = (v: number) => {
        let r = rest.get(v);
        if (!r) { r = new Float32Array(m); for (let i = 0; i < m; i++) r[i] = inside(bones[i], pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); rest.set(v, r); }
        return r;
      };
      const P = new Float64Array(3);
      const place = (v: number, M: Float64Array, out: Float64Array | Float32Array, o3 = 0) => {
        const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
        let px = 0, py = 0, pz = 0;
        for (let k = 0; k < 4; k++) {
          const wk = wts[v * 4 + k];
          if (!wk) continue;
          const o = at[v * 4 + k] * 16;
          px += wk * (M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12]);
          py += wk * (M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13]);
          pz += wk * (M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14]);
        }
        out[o3] = px; out[o3 + 1] = py; out[o3 + 2] = pz;
      };
      const len = (a: ArrayLike<number>, u: number, v: number) => Math.hypot(a[u * 3] - a[v * 3], a[u * 3 + 1] - a[v * 3 + 1], a[u * 3 + 2] - a[v * 3 + 2]);
      const posed = new Float32Array(n * 3);
      // Along a digit chain (several digit joints, a tendon sheath), a bound that folds the sheet counts as tearing it:
      // the interior edges (a, b, with the opposite vertices c, d) whose dihedral angle changes by more than KEEP_OUT_FOLD.
      // Bounds set at neighbouring vertices across different joints otherwise raise flat fins at the PIP in a fist.
      const chain = keepJoints.length > 1 && !keepJoints[0].arc.length;
      const quads: number[] = [];
      if (chain && index) {
        const ia = index.array as ArrayLike<number>;
        const em = new Map<number, number[]>();
        for (let f = 0; f < ia.length; f += 3) for (let k = 0; k < 3; k++) {
          const a = rep[ia[f + k]], b = rep[ia[f + (k + 1) % 3]], c = rep[ia[f + (k + 2) % 3]];
          if (a === b) continue;
          const key = Math.min(a, b) * n + Math.max(a, b);
          (em.get(key) ?? em.set(key, []).get(key)!).push(a, b, c);
        }
        for (const e of em.values()) if (e.length === 6) quads.push(e[0], e[1], e[2], e[5]);
      }
      const dihedral = (P: ArrayLike<number>, a: number, b: number, c: number, d: number) => {
        const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
        const ex = P[b * 3] - ax, ey = P[b * 3 + 1] - ay, ez = P[b * 3 + 2] - az;
        const cx = P[c * 3] - ax, cy = P[c * 3 + 1] - ay, cz = P[c * 3 + 2] - az;
        const dx = P[d * 3] - ax, dy = P[d * 3 + 1] - ay, dz = P[d * 3 + 2] - az;
        const n1x = ey * cz - ez * cy, n1y = ez * cx - ex * cz, n1z = ex * cy - ey * cx;
        const n2x = dy * ez - dz * ey, n2y = dz * ex - dx * ez, n2z = dx * ey - dy * ex;
        const l = Math.hypot(n1x, n1y, n1z) * Math.hypot(n2x, n2y, n2z);
        return l > 1e-18 ? (Math.acos(Math.max(-1, Math.min(1, (n1x * n2x + n1y * n2y + n1z * n2z) / l))) * 180) / Math.PI : 0;
      };
      const restDih = quads.length ? Array.from({ length: quads.length / 4 }, (_, q) => dihedral(pos, quads[q * 4], quads[q * 4 + 1], quads[q * 4 + 2], quads[q * 4 + 3])) : [];
      /** Edges (u * n + v, u < v) stretched beyond KEEP_OUT_STRETCH (or, along a digit chain, folded beyond KEEP_OUT_FOLD) in some checked pose. */
      const torn = () => {
        const out = new Set<number>();
        for (const { M } of checks) {
          for (const v of verts) place(v, M, posed, v * 3);
          for (const v of verts) for (const u of lists.get(v)!) {
            if (u < v) continue;
            const l0 = len(pos, u, v), l1 = len(posed, u, v);
            if (l1 > KEEP_OUT_STRETCH * l0 && l1 - l0 > KEEP_OUT_STRETCH_MIN) out.add(v * n + u);
          }
          for (let q = 0; q < restDih.length; q++) {
            const a = quads[q * 4], b = quads[q * 4 + 1];
            if (Math.abs(dihedral(posed, a, b, quads[q * 4 + 2], quads[q * 4 + 3]) - restDih[q]) > KEEP_OUT_FOLD) out.add(Math.min(a, b) * n + Math.max(a, b));
          }
        }
        return out;
      };
      const before = torn();
      const held = new Set<number>(), banned = new Set<number>();
      /** Deepest a vertex goes into one of the bones beyond its rest depth over the checked poses, with its current influences, and that bone. */
      const memo = new Map<number, { ver: number; depth: number; node: number }>();
      const intrusion = (v: number) => {
        const c = memo.get(v);
        if (c && c.ver === ver[v]) return c;
        const r = intrusionOf(v);
        memo.set(v, { ver: ver[v], depth: r.depth, node: r.node });
        return r;
      };
      const intrusionOf = (v: number) => {
        const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
        let depth = 0, node = -1;
        for (const { M, inv } of checks) {
          place(v, M, P);
          const px = P[0], py = P[1], pz = P[2];
          for (let i = 0; i < m; i++) {
            const o = i * 16;
            const bx = inv[o] * px + inv[o + 4] * py + inv[o + 8] * pz + inv[o + 12];
            const by = inv[o + 1] * px + inv[o + 5] * py + inv[o + 9] * pz + inv[o + 13];
            const bz = inv[o + 2] * px + inv[o + 6] * py + inv[o + 10] * pz + inv[o + 14];
            // a vertex that moves with this bone alone cannot enter it
            if (Math.abs(bx - x) + Math.abs(by - y) + Math.abs(bz - z) < KEEP_OUT_TOL) continue;
            const dIn = inside(bones[i], bx, by, bz);
            if (dIn <= 0) continue;
            const extra = dIn - restOf(v)[i];
            if (extra > depth) { depth = extra; node = i; }
          }
        }
        return { depth, node };
      };
      const row = new Float64Array(m), cand = new Float64Array(m);
      const setRow = (v: number, w: ArrayLike<number>) => { for (let i = 0; i < m; i++) W[v * m + i] = w[i]; influences(v); };
      const shareOf = (w: ArrayLike<number>, k: number) => {
        let b = 0;
        for (const i of beyondAts[k]) b += w[i];
        const r = w[parentAts[k]] + b;
        return r > 1e-6 ? b / r : -1;
      };
      /**
       * The joint to bound a vertex at: of keepJoints next to the bone it enters (that bone is the joint's parent or its
       * node), the one with the most weight on both its sides.
       */
      const jointOf = (w: ArrayLike<number>, entered: number) => {
        let best = -1, bv = 0;
        keepJoints.forEach((_, k) => {
          if (keepJoints.length > 1 && parentAts[k] !== entered && nodeAts[k] !== entered) return;
          let b = 0;
          for (const i of beyondAts[k]) b += w[i];
          const s = Math.min(w[parentAts[k]], b);
          if (best < 0 || s > bv) { best = k; bv = s; }
        });
        return best;
      };
      /** Halves a bound towards none (KEEP_OUT_SOFTEN times), then drops it for good. */
      const softs = new Uint8Array(n);
      const release = (u: number) => {
        if (!fixed[u] && softs[u] < KEEP_OUT_SOFTEN) { softs[u]++; lo[u] *= 0.5; hi[u] = 1 - (1 - hi[u]) * 0.5; bulLo[u] *= 0.5; return; }
        held.delete(u); banned.add(u); fixed[u] = 0; lo[u] = 0; hi[u] = 1; lean[u] = -1; bulLo[u] = 0;
      };
      /** The bulge shares: the smallest field that keeps every bound and falls off by BULGE_FADE per ring (0 on attachments). */
      const spread = () => {
        if (!BJ) return;
        for (let it = 0; it < SOLVE_SWEEPS; it++) {
          let change = 0;
          for (const v of verts) {
            let next = 0;
            if (pin[v] < 0) {
              const L = lists.get(v)!;
              let s = 0;
              for (const u of L) s += bul[u];
              next = Math.max(bulLo[v], BULGE_FADE * (s / L.length));
            }
            change = Math.max(change, Math.abs(next - bul[v]));
            bul[v] = next;
          }
          if (change < SOLVE_TOL) break;
        }
      };
      const refresh = () => { solve(); spread(); for (const v of verts) influences(v); };
      /** The smallest bulge share (above what it has) that keeps the vertex out, a margin more; it becomes its lower bound. */
      const tryBulge = (v: number) => {
        if (!BJ) return false;
        const b0 = bul[v];
        let ok = false;
        for (let k = 1; k <= BULGE_STEPS && !ok; k++) {
          const b = Math.min(1, b0 + k / BULGE_STEPS);
          bul[v] = b; influences(v);
          if (intrusion(v).depth > KEEP_OUT_TOL) continue;
          const g = Math.min(1, b + BULGE_MARGIN);
          bul[v] = g; influences(v);
          bulLo[v] = intrusion(v).depth <= KEEP_OUT_TOL ? g : b;
          ok = true;
        }
        bul[v] = ok ? bulLo[v] : b0; influences(v);
        if (ok) held.add(v);
        return ok;
      };
      for (let round = 0; round < KEEP_OUT_ROUNDS; round++) {
        let changed = 0;
        for (const v of verts) {
          if (pin[v] >= 0 || fixed[v] || banned.has(v)) continue;
          const now = intrusion(v);
          if (now.depth <= KEEP_OUT_TOL) continue;
          for (let i = 0; i < m; i++) row[i] = W[v * m + i];
          const k = keepJoints.length ? (jt[v] >= 0 ? jt[v] : jointOf(row, now.node)) : -1;
          const f0 = k >= 0 && beyondAts[k].length ? shareOf(row, k) : -1;
          let done = false;
          if (f0 >= 0) {
            const to = beyondAts[k].includes(now.node) ? now.node : beyondAts[k][0];
            // the nearest share along the arc (within the bounds so far) that keeps it out, a margin further for the poses
            // between the checked ones; it becomes a bound on the share the solve may give the vertex
            const fs = Array.from({ length: steps + 1 }, (_, k) => k / steps).filter((f) => f >= lo[v] && f <= hi[v]).sort((a, b) => Math.abs(a - f0) - Math.abs(b - f0));
            for (const f of fs) {
              cand.set(row); toShare(cand, 0, f, to, k); setRow(v, cand);
              if (intrusion(v).depth > KEEP_OUT_TOL) continue;
              const g = Math.min(hi[v], Math.max(lo[v], f + Math.sign(f - f0) * KEEP_OUT_MARGIN));
              cand.set(row); toShare(cand, 0, g, to, k); setRow(v, cand);
              const fb = intrusion(v).depth <= KEEP_OUT_TOL ? g : f;
              if (fb > f0) lo[v] = fb; else hi[v] = fb;
              lean[v] = to; jt[v] = k; held.add(v); done = true;
              break;
            }
            setRow(v, row);
          }
          // out from the hinge axis (a joint with bulge nodes)
          if (!done) done = tryBulge(v);
          if (!done) {
            // onto the bone it enters, if that keeps it out
            const w = new Float64Array(m);
            w[now.node] = 1;
            setRow(v, w);
            const d = intrusion(v).depth;
            setRow(v, row);
            // (not along a digit chain: a vertex held rigid to one phalanx among blended neighbours makes a fin)
            if (!chain && d < now.depth - 1e-5) { setRow(v, w); fixed[v] = 1; held.add(v); done = true; }
          }
          if (done) changed++;
        }
        if (!changed) break;
        refresh();
        // a bound that tears the sheet is worse than the vertex it keeps out: soften it, then let go of it for good
        for (let guard = 0; guard < KEEP_OUT_ROUNDS; guard++) {
          let freed = 0;
          for (const e of torn()) {
            if (before.has(e)) continue;
            for (const u of [Math.floor(e / n), e % n]) {
              if (held.has(u)) { release(u); freed++; }
            }
          }
          if (!freed) break;
          refresh();
        }
      }
      // relax the weights where the step changed something (held or bulged vertices and their neighbours) towards their
      // neighbours', each move kept only if the vertex goes no deeper into a bone: smooths the creases the bounds leave
      if (held.size) {
        const mw = new Float64Array(m);
        const zone = new Set<number>();
        for (const v of verts) if (held.has(v) || bul[v] > 0) { zone.add(v); for (const u of lists.get(v)!) zone.add(u); }
        for (let it = 0; it < KEEP_OUT_RELAX; it++) {
          for (const v of verts) {
            if (pin[v] >= 0 || fixed[v] || !zone.has(v)) continue;
            const L = lists.get(v)!;
            const d0 = Math.max(KEEP_OUT_TOL, intrusion(v).depth);
            for (let i = 0; i < m; i++) { row[i] = W[v * m + i]; let s = 0; for (const u of L) s += W[u * m + i]; mw[i] = 0.5 * (row[i] + s / L.length); }
            const b0 = bul[v];
            let sb = 0;
            for (const u of L) sb += bul[u];
            bul[v] = 0.5 * (b0 + sb / L.length);
            setRow(v, mw);
            if (intrusion(v).depth > d0 + 1e-6) { bul[v] = b0; setRow(v, row); }
          }
        }
      }
    }
    const idx = new Uint16Array(n * 4), out = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      const r = rep[v];
      if (!nb.has(r)) { idx[v * 4] = bones[0]; out[v * 4] = 1; continue; } // a vertex no triangle uses
      for (let k = 0; k < 4; k++) { idx[v * 4 + k] = all[at[r * 4 + k]].index; out[v * 4 + k] = wts[r * 4 + k]; }
    }
    geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(out, 4));
  }
}

/**
 * For an attach skin over `all` nodes (bones' nodes, then arc nodes): where each bone node sits in `all`, and per
 * joint with arc nodes whose parent node is also in the skin, the positions of the parent, of the arc nodes in order
 * and of every node at or beyond the joint (the joint's node and its descendants, arc nodes of deeper joints
 * included). Deepest joints first, so a structure over two such joints (the iliotibial tract) is laid along both.
 */
function arcPlan(all: RigNode[], rig: Rig) {
  const at = new Map(all.map((nd, i) => [nd.id, i]));
  const baseAt = all.map((nd, i) => (nd.spec.between ? -1 : i)).filter((i) => i >= 0);
  const depth = (nd: RigNode) => { let d = 0; for (let p = nd.parent; p; p = rig.node(p).parent) d++; return d; };
  const under = (nd: RigNode, id: string) => { for (let p: string | null = nd.id; p; p = rig.node(p).parent) if (p === id) return true; return false; };
  type Joint = { node: number; parent: number; arc: number[]; beyond: number[]; depth: number; bulge: number[] };
  const joints: Joint[] = [];
  /** Joints the skin spans that have no arc nodes (the digits, the ankle...): plain blends between parent and beyond. */
  const plain: Joint[] = [];
  for (const nd of all) {
    if (nd.spec.between || !nd.parent || !at.has(nd.parent)) continue;
    const of = all.filter((a) => a.spec.between?.of === nd.base && a.side === nd.side).sort((a, b) => a.spec.between!.t - b.spec.between!.t);
    const arc = of.filter((a) => !a.spec.between!.bulge).map((a) => at.get(a.id)!);
    if (!arc.length) { plain.push({ node: at.get(nd.id)!, parent: at.get(nd.parent)!, arc: [], beyond: all.filter((x) => under(x, nd.id)).map((x) => at.get(x.id)!), depth: depth(nd), bulge: [] }); continue; }
    // the bulge twins of parent, arc nodes and joint node, in that order (none, or one more than the arc at each end)
    const bulge = of.filter((a) => a.spec.between!.bulge).map((a) => at.get(a.id)!);
    joints.push({ node: at.get(nd.id)!, parent: at.get(nd.parent)!, arc, beyond: all.filter((x) => under(x, nd.id)).map((x) => at.get(x.id)!), depth: depth(nd), bulge: bulge.length === arc.length + 2 ? bulge : [] });
  }
  joints.sort((a, b) => b.depth - a.depth);
  return { baseAt, joints, plain };
}

/**
 * The nodes of an attach skin: the nodes of the bones the structure is fixed to and, after them, the arc nodes of each
 * joint between two of them that has arc nodes (shoulder, elbow, hip, knee).
 */
export function attachNodes(nodes: string[], rig: Rig): string[] {
  const out = [...nodes];
  for (const id of nodes) {
    const nd = rig.node(id);
    if (!nd.parent || !nodes.includes(nd.parent)) continue;
    for (const a of rig.nodes.values()) if (a.spec.between?.of === nd.base && a.side === nd.side) out.push(a.id);
  }
  return out;
}

/**
 * Skins one structure's meshes and picks its strain ends. Open 3D Model muscles are skinned as a whole
 * (`skinParts`, with tendon anchoring when `prox` is given); structures fixed to several bones ('attach') by
 * proximity (`skinAttach`, which needs `prox`); everything else per part as before, the ends taken from the part with
 * the most vertices.
 */
export function skinStructure(s: Structure, geoms: THREE.BufferGeometry[], spec: SkinSpec, rig: Rig, prox?: BoneProximity, attach?: AttachOptions): StructureSkin {
  if (s.kind === 'muscle' && s.source === 'o3d') return skinParts(geoms, spec, rig, prox);
  if (spec.mode === 'attach' && prox) { skinAttach(geoms, spec.nodes, rig, prox, attach); return {}; }
  let best: { part: number; ends: [number, number]; endBones: [number, number]; count: number } | null = null;
  geoms.forEach((g, part) => {
    const r = skinGeometry(g, spec, rig);
    const count = g.getAttribute('position').count;
    if (r.ends && r.endBones && (!best || count > best.count)) best = { part, ends: r.ends, endBones: r.endBones, count };
  });
  if (!best) return {};
  const b = best as { part: number; ends: [number, number]; endBones: [number, number] };
  return { ends: [{ part: b.part, v: b.ends[0] }, { part: b.part, v: b.ends[1] }], endBones: b.endBones };
}

/**
 * A chain that comes down the forearm onto the hand crosses the wrist in its two levels: the proximal carpal row
 * (`carpus`) is put in before the hand, so a tendon bends at the radiocarpal and the midcarpal joint as the bones do.
 */
function wristLevels(chain: string[], rig: Rig): string[] {
  return chain.flatMap((id, i) => {
    const m = /^hand(-[lr])$/.exec(id);
    const carpus = m ? `carpus${m[1]}` : '';
    return m && i > 0 && chain[i - 1] !== carpus && rig.nodes.has(carpus) ? [carpus, id] : [id];
  });
}

const SPINE_ALL = [...LUMBAR, ...THORACIC, ...CERVICAL];
const CERV_HEAD = [...CERVICAL, 'skull'];

/** Chooses how a structure is bound to the rig. */
export function resolveSkin(s: Structure, rig: Rig, info?: MuscleInfo): SkinSpec {
  const side: Side = s.side;
  if (s.kind === 'disc') return { mode: 'spine', nodes: SPINE_ALL };
  if (s.kind === 'cartilage') {
    const n = +s.key.replace('costal-cartilage-', '');
    // The floating ribs' cartilage tips (11, 12) do not reach the sternum: they move with their rib.
    if (n >= 11) return { mode: 'rigid', node: rig.carriedBy.get(s.attach?.[0] ?? '') ?? `t${n}` };
    return { mode: 'lateral', lateral: `t${n}`, medial: 'sternum' };
  }
  if (s.kind === 'bone') return { mode: 'rigid', node: rig.carriedBy.get(s.id) ?? 'pelvis' };
  if (s.attach?.length) {
    // Fixed to bones: rigid with the bone (articular cartilage, menisci, labra, bursae, ligaments between bones that
    // move together), or blended by proximity across the joint when the bones move separately (ligaments, capsules,
    // sheaths, retinacula, fasciae).
    const nodes = [...new Set(s.attach.map((id) => rig.carriedBy.get(id)).filter((n): n is string => !!n))];
    if (nodes.length === 1) return { mode: 'rigid', node: nodes[0] };
    if (nodes.length > 1) return { mode: 'attach', nodes: attachNodes(nodes, rig) };
  }

  const res = (b: string) => rig.resolve(b, side);
  if (info?.chain && info.chain.length > 1) return { mode: 'chain', nodes: wristLevels(info.chain.map(res), rig) };
  if (info?.spine) return { mode: 'spine', nodes: info.spine.map(res) };
  if (info?.carrier) return { mode: 'rigid', node: res(info.carrier) };
  // Deep spinal muscles without curated data: follow their spinal region.
  if (/lumbar|lumbrical-?back/.test(s.key)) return { mode: 'spine', nodes: ['pelvis', ...LUMBAR] };
  if (/thoracic|thoracis|intercostal|rotator|spinalis/.test(s.key)) return { mode: 'spine', nodes: [...LUMBAR, ...THORACIC] };
  if (/cervic|capitis|colli/.test(s.key)) return { mode: 'spine', nodes: CERV_HEAD };
  return { mode: 'rigid', node: 'pelvis' };
}
