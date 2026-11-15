import * as THREE from 'three';
import type { MuscleInfo } from './types';

/** A point of a path that rides on a bone: bind-pose position `p`, rig bone index `b`. */
export interface BonePoint { p: THREE.Vector3; b: number }

/**
 * A wrapping surface that rides on a bone (rig bone index `b`): a sphere, or an infinite cylinder along `axis`, of
 * radius `r` round the bind-pose centre `c`. The path wraps over it only where the straight line would cut through it.
 * `side` (a bind-pose direction) makes the path always pass the centre or axis on that side, so a tendon stays on the
 * back of a joint rather than taking the shorter way round the front.
 */
export interface BoneObstacle {
  shape: 'sphere' | 'cylinder';
  c: THREE.Vector3;
  b: number;
  r: number;
  axis?: THREE.Vector3;
  side?: THREE.Vector3;
}

/** One element of a path between its ends: a via point fixed on a bone, or a surface it may wrap over. */
export type PathElement = BonePoint | BoneObstacle;

export const isObstacle = (e: PathElement): e is BoneObstacle => 'shape' in e;

/**
 * The line a muscle's length is measured along: from its origin end to its insertion end, each bound rigidly to a
 * bone (bind-pose position `p`, rig bone index `b`), optionally through via points that ride on other bones and over
 * wrapping surfaces (spheres, cylinders), in order from origin to insertion. They stand for the bones the muscle bends
 * around, such as the patella under the quadriceps tendon, the malleolus behind a tendon at the ankle or the head of a
 * metacarpal under an extensor tendon; without them a straight line cuts across the joint and reads the muscle as
 * shorter exactly where it is stretched.
 */
export interface StrainPath {
  p0: THREE.Vector3;
  b0: number;
  p1: THREE.Vector3;
  b1: number;
  vias?: PathElement[];
}

/** Maps a bind-pose point carried by a bone to its place in the current pose. */
export type AtBone = (p: THREE.Vector3, bone: number) => THREE.Vector3;

/** Length of the polyline through the points. */
export function polylineLength(points: readonly THREE.Vector3[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += points[i].distanceTo(points[i - 1]);
  return sum;
}

/**
 * The shortest way from `p` to `s` over an obstacle: its length, and where it touches the surface (`entry`, `exit`,
 * with the length `arc` of the stretch on the surface) when it does. Without contact `length` is the straight distance.
 */
export interface Wrap {
  length: number;
  entry?: THREE.Vector3;
  exit?: THREE.Vector3;
  arc?: number;
}

const TAU = Math.PI * 2;

/**
 * The way from P to S (2D, relative to a circle of radius `r` at the origin) round the circle on the side `(nx, ny)`:
 * tangent from P, arc, tangent to S. Null when either point is inside the circle or the straight line already clears
 * the circle on that side (the arc would be negative).
 */
function arcPath(px: number, py: number, sx: number, sy: number, r: number, nx: number, ny: number) {
  const dp = Math.hypot(px, py);
  const ds = Math.hypot(sx, sy);
  if (dp <= r || ds <= r) return null;
  // Angles are taken from n, in (-pi, pi]: the path may not cross -n (the far side), so it goes round from P's angle to
  // S's the way that passes n, and wraps only when the tangent points come in that order (a positive arc).
  const an = Math.atan2(ny, nx);
  const rel = (a: number) => ((((a - an + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  const bp = rel(Math.atan2(py, px));
  const bs = rel(Math.atan2(sy, sx));
  const dir = bs >= bp ? 1 : -1;
  const e = bp + dir * Math.acos(r / dp);
  const x = bs - dir * Math.acos(r / ds);
  const arc = dir * (x - e);
  if (!(arc > 0)) return null;
  return { e: e + an, x: x + an, arc, tp: Math.sqrt(dp * dp - r * r), ts: Math.sqrt(ds * ds - r * r) };
}

/** Closest point of the 2D segment P-S to the origin. */
function closest2(px: number, py: number, sx: number, sy: number): [number, number] {
  const dx = sx - px;
  const dy = sy - py;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? THREE.MathUtils.clamp(-(px * dx + py * dy) / l2, 0, 1) : 0;
  return [px + t * dx, py + t * dy];
}

/** The side to pass a circle on when none is given: towards the closest point of the segment, or null when it clears the circle. */
function freeSide(px: number, py: number, sx: number, sy: number, r: number): [number, number] | null {
  const [qx, qy] = closest2(px, py, sx, sy);
  const q = Math.hypot(qx, qy);
  if (q >= r) return null;
  // through the centre exactly: either way is as short; take the left of the direction of travel
  return q > 1e-12 ? [qx, qy] : [-(sy - py), sx - px];
}

/** Any unit vector perpendicular to `a` (a unit vector), the same one each time for the same `a`. */
function perpendicular(a: THREE.Vector3): THREE.Vector3 {
  const t = Math.abs(a.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  return t.sub(a.clone().multiplyScalar(t.dot(a))).normalize();
}

/**
 * Shortest path from `p` to `s` over a sphere (centre `c`, radius `r`): the straight line when it misses the sphere,
 * else the tangent from `p`, the great-circle arc in the plane of `p`, `s` and the centre, and the tangent to `s`.
 * Straight as well when either end lies inside the sphere.
 */
export function wrapSphere(p: THREE.Vector3, s: THREE.Vector3, c: THREE.Vector3, r: number, side?: THREE.Vector3): Wrap {
  const straight = { length: p.distanceTo(s) };
  const P = p.clone().sub(c);
  const S = s.clone().sub(c);
  let normal = new THREE.Vector3().crossVectors(P, S);
  if (normal.lengthSq() < 1e-20) {
    // p, s and the centre in a line: any plane through them will do
    const d = S.clone().sub(P);
    if (d.lengthSq() === 0) return straight;
    normal = perpendicular(d.normalize());
  }
  const u = P.clone().normalize();
  const v = new THREE.Vector3().crossVectors(normal.normalize(), u);
  const px = P.length();
  const sx = S.dot(u);
  const sy = S.dot(v);
  let n: [number, number] | null = side ? [side.dot(u), side.dot(v)] : null;
  if (!n || Math.hypot(n[0], n[1]) < 1e-9) n = freeSide(px, 0, sx, sy, r);
  const a = n && arcPath(px, 0, sx, sy, r, n[0], n[1]);
  if (!a) return straight;
  const on = (ang: number) => c.clone().addScaledVector(u, r * Math.cos(ang)).addScaledVector(v, r * Math.sin(ang));
  return { length: a.tp + r * a.arc + a.ts, entry: on(a.e), exit: on(a.x), arc: r * a.arc };
}

/**
 * Shortest path from `p` to `s` over an infinite cylinder (centre `c` on its axis, unit `axis`, radius `r`): straight
 * when the line misses it, else tangent, helical arc, tangent, which unrolled is a straight line, so its length is
 * the hypotenuse of the length across the axis and the distance along it. With `side` (a direction across the axis) the
 * path always passes on that side and wraps as soon as the straight line would cross it; without, it wraps the shorter
 * way and only when the straight line cuts the cylinder. Straight when either end lies inside the cylinder.
 */
export function wrapCylinder(p: THREE.Vector3, s: THREE.Vector3, c: THREE.Vector3, axis: THREE.Vector3, r: number, side?: THREE.Vector3): Wrap {
  const straight = { length: p.distanceTo(s) };
  const u = perpendicular(axis);
  const v = new THREE.Vector3().crossVectors(axis, u);
  const P = p.clone().sub(c);
  const S = s.clone().sub(c);
  const [px, py, hp] = [P.dot(u), P.dot(v), P.dot(axis)];
  const [sx, sy, hs] = [S.dot(u), S.dot(v), S.dot(axis)];
  let n: [number, number] | null = side ? [side.dot(u), side.dot(v)] : null;
  if (!n || Math.hypot(n[0], n[1]) < 1e-9) n = freeSide(px, py, sx, sy, r);
  const a = n && arcPath(px, py, sx, sy, r, n[0], n[1]);
  if (!a) return straight;
  const across = a.tp + r * a.arc + a.ts;
  const dh = hs - hp;
  const on = (ang: number, h: number) => c.clone().addScaledVector(u, r * Math.cos(ang)).addScaledVector(v, r * Math.sin(ang)).addScaledVector(axis, h);
  return {
    length: Math.hypot(across, dh),
    entry: on(a.e, hp + (dh * a.tp) / across),
    exit: on(a.x, hp + (dh * (a.tp + r * a.arc)) / across),
    arc: Math.hypot(r * a.arc, (dh * r * a.arc) / across),
  };
}

/** An obstacle placed in the current pose. */
interface Posed { shape: BoneObstacle['shape']; c: THREE.Vector3; r: number; axis?: THREE.Vector3; side?: THREE.Vector3 }

const wrapOver = (o: Posed, p: THREE.Vector3, s: THREE.Vector3): Wrap =>
  o.shape === 'sphere' ? wrapSphere(p, s, o.c, o.r, o.side) : wrapCylinder(p, s, o.c, o.axis!, o.r, o.side);

/**
 * Length from `a` to `b` over the obstacles in order. One obstacle is exact; with more, each is wrapped in turn
 * between the point the path leaves the one before and the point it meets the one after, a few times over (the joints
 * of a finger are far enough apart for this to settle at once).
 */
export function chainLength(a: THREE.Vector3, b: THREE.Vector3, obs: readonly Posed[]): number {
  if (!obs.length) return a.distanceTo(b);
  const w: Wrap[] = obs.map(() => ({ length: 0 }));
  const rounds = obs.length === 1 ? 1 : 6;
  for (let k = 0; k < rounds; k++) {
    for (let i = 0; i < obs.length; i++) {
      let from = a;
      for (let j = i - 1; j >= 0; j--) if (w[j].exit) { from = w[j].exit!; break; }
      let to = b;
      for (let j = i + 1; j < obs.length; j++) if (w[j].entry) { to = w[j].entry!; break; }
      w[i] = wrapOver(obs[i], from, to);
    }
  }
  let sum = 0;
  let cur = a;
  for (const x of w) {
    if (!x.entry) continue;
    sum += cur.distanceTo(x.entry) + x.arc!;
    cur = x.exit!;
  }
  return sum + cur.distanceTo(b);
}

/** Length of the path in the current pose: origin, the via points in order, insertion, wrapping over the obstacles between them. */
export function strainPathLength(path: StrainPath, at: AtBone): number {
  let sum = 0;
  let from = at(path.p0, path.b0);
  let obs: Posed[] = [];
  const dir = (c: THREE.Vector3, d: THREE.Vector3 | undefined, b: number) => d && at(c.clone().add(d), b).sub(at(c, b)).normalize();
  for (const e of path.vias ?? []) {
    if (isObstacle(e)) {
      obs.push({ shape: e.shape, c: at(e.c, e.b), r: e.r, axis: dir(e.c, e.axis, e.b), side: dir(e.c, e.side, e.b) });
      continue;
    }
    const to = at(e.p, e.b);
    sum += chainLength(from, to, obs);
    from = to;
    obs = [];
  }
  return sum + chainLength(from, at(path.p1, path.b1), obs);
}

/**
 * The wrap point of a straight origin-to-insertion line over a bone: the bone vertex closest to that line (so the
 * point where the line rests on the bone in the bind pose). `positions` are flat xyz arrays of the bone's vertices.
 * Null when the bone has none.
 */
export function wrapPoint(positions: Iterable<ArrayLike<number>>, a: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 | null {
  const ab = new THREE.Vector3().subVectors(c, a);
  const len2 = ab.lengthSq();
  const v = new THREE.Vector3();
  const on = new THREE.Vector3();
  let best: THREE.Vector3 | null = null;
  let bd = Infinity;
  for (const arr of positions) {
    for (let i = 0; i + 2 < arr.length; i += 3) {
      v.set(arr[i], arr[i + 1], arr[i + 2]);
      const t = len2 > 0 ? THREE.MathUtils.clamp(v.clone().sub(a).dot(ab) / len2, 0, 1) : 0;
      const d = v.distanceToSquared(on.copy(a).addScaledVector(ab, t));
      if (d < bd) { bd = d; (best ??= new THREE.Vector3()).copy(v); }
    }
  }
  return best;
}

/** Anatomical directions of the standing body in the bind pose: y up, z forward, x towards the body's left. */
export type Direction = 'anterior' | 'posterior' | 'superior' | 'inferior' | 'medial' | 'lateral';

/**
 * A landmark of a bone for a wrap point, found from the bone's own shape instead of a coordinate: among the vertices
 * within `depth` metres of the bone's extreme in direction `near` (all of them if `near` is left out), the one furthest
 * `toward` the directions given together (e.g. the posterior and medial edge of the lower end of the tibia is
 * `{ bone: 'tibia', near: 'inferior', depth: 0.03, toward: ['posterior', 'medial'] }`, the medial malleolus). `bone` is a
 * structure key (`tibia`, `calcaneus`, `metacarpal-3`) and the landmark is taken on the muscle's side.
 */
export interface StrainLandmark {
  bone: string;
  toward: Direction[];
  near?: Direction;
  depth?: number;
  /** With `near`: leave out the vertices within this many metres of the extreme, so the landmark is taken from a band along the bone (the deltoid tuberosity lies 9 to 15 cm below the top of the humerus). */
  skip?: number;
}

/** Unit vector of a direction for structures on a side; the midline counts as left. */
export function directionVector(d: Direction, side: 'l' | 'r' | 'm'): THREE.Vector3 {
  const lateral = side === 'r' ? -1 : 1;
  switch (d) {
    case 'anterior': return new THREE.Vector3(0, 0, 1);
    case 'posterior': return new THREE.Vector3(0, 0, -1);
    case 'superior': return new THREE.Vector3(0, 1, 0);
    case 'inferior': return new THREE.Vector3(0, -1, 0);
    case 'lateral': return new THREE.Vector3(lateral, 0, 0);
    case 'medial': return new THREE.Vector3(-lateral, 0, 0);
  }
}

/**
 * A surface a muscle wraps over, for the length read-out (an entry of MuscleInfo.strainVias): a sphere round a joint
 * centre (the humeral head under the deltoid), or a cylinder through it along an axis (the head of a metacarpal under
 * an extensor tendon, the humeral shaft under teres major). The path wraps over it only where the straight line would
 * cut through it, so unlike a via point it lets go when the joint turns the other way.
 */
export interface StrainObstacle {
  wrap: 'sphere' | 'cylinder';
  /** Rig node (without side) whose joint centre is the obstacle's centre; its bone carries the obstacle. */
  joint?: string;
  /**
   * Instead of `joint`: the centre of the end of a bone, as the mean of its vertices within `depth` of its extreme in
   * direction `near` (the head of a metatarsal is `{ bone: 'metatarsal-2', near: 'anterior', depth: 0.012 }`); the
   * bone's rig node carries the obstacle.
   */
  centre?: { bone: string; near: Direction; depth: number };
  /**
   * Cylinder axis: a bind-pose axis (the axis the joint's movement turns about, as in rig/spec), or the direction to
   * another rig node's joint centre (`{ to: 'ulna' }` from the shoulder: the long axis of the humerus).
   */
  axis?: 'x' | 'y' | 'z' | { to: string };
  /** Radius in metres, or the distance from the centre (from the axis for a cylinder) to a landmark of a bone. */
  radius: number | StrainLandmark;
  /**
   * The path always passes the axis (centre, for a sphere) on this side, the palmar side of the wrist for a flexor
   * tendon; without it the path wraps the shorter way and only where the straight line cuts the surface.
   */
  side?: Direction;
}

export const isStrainObstacle = (e: StrainLandmark | StrainObstacle): e is StrainObstacle => 'wrap' in e;

/** Where the wrap points of a muscle are looked up: the model's bones, as vertices and as the rig bone that carries them. */
export interface ViaSource {
  /** A structure by id (a bone). */
  structure(id: string): { positions: ArrayLike<number>[]; bone: number } | undefined;
  /** A rig node by id: all the bones it carries together, and its joint centre in the bind pose. */
  node(id: string): { positions: ArrayLike<number>[]; bone: number; pivot?: THREE.Vector3 } | undefined;
}

/** A landmark of a bone on `side` (see StrainLandmark) as a point on the rig bone that carries it, or null. */
export function resolveLandmark(lm: StrainLandmark, side: 'l' | 'r' | 'm', src: ViaSource): BonePoint | null {
  const bone = src.structure(`${lm.bone}-${side}`) ?? src.structure(lm.bone);
  const p = bone && landmarkPoint(bone.positions, lm, side);
  return bone && p ? { p, b: bone.bone } : null;
}

const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

/** An obstacle of the muscle data on `side`, placed on its rig bone in the bind pose, or null when its joint or landmark is missing. */
export function resolveObstacle(o: StrainObstacle, side: 'l' | 'r' | 'm', src: ViaSource): BoneObstacle | null {
  const node = (id: string) => (side === 'm' ? undefined : src.node(`${id}-${side}`)) ?? src.node(id);
  let at: { bone: number; pivot?: THREE.Vector3 } | undefined;
  if (o.centre) {
    const bone = src.structure(`${o.centre.bone}-${side}`) ?? src.structure(o.centre.bone);
    const pivot = bone && endCentre(bone.positions, o.centre.near, o.centre.depth, side);
    at = bone && pivot ? { bone: bone.bone, pivot } : undefined;
  } else if (o.joint) at = node(o.joint);
  if (!at?.pivot) return null;
  const c = at.pivot.clone();
  let axis: THREE.Vector3 | undefined;
  if (o.wrap === 'cylinder') {
    const to = typeof o.axis === 'object' ? node(o.axis.to)?.pivot : undefined;
    axis = typeof o.axis === 'object' ? to?.clone().sub(c).normalize() : AXIS[o.axis ?? 'x'].clone();
    if (!axis || !(axis.lengthSq() > 0)) return null;
  }
  let r: number;
  if (typeof o.radius === 'number') r = o.radius;
  else {
    const lm = resolveLandmark(o.radius, side, src);
    if (!lm) return null;
    const d = lm.p.clone().sub(c);
    r = axis ? d.sub(axis.clone().multiplyScalar(d.dot(axis))).length() : d.length();
  }
  return { shape: o.wrap, c, b: at.bone, r, axis, side: o.side && directionVector(o.side, side) };
}

/**
 * The via points and wrapping surfaces of a muscle on `side` (see MuscleInfo.strainVias and strainWrap), in order from
 * origin to insertion; `p0` and `p1` are the bind-pose ends of its straight line. Empty for a muscle that has none.
 */
export function resolveVias(info: Pick<MuscleInfo, 'strainWrap' | 'strainVias'>, side: 'l' | 'r' | 'm', p0: THREE.Vector3, p1: THREE.Vector3, src: ViaSource): PathElement[] {
  const out: PathElement[] = [];
  if (info.strainVias) {
    for (const e of info.strainVias) {
      const x = isStrainObstacle(e) ? resolveObstacle(e, side, src) : resolveLandmark(e, side, src);
      if (x) out.push(x);
    }
  } else if (info.strainWrap) {
    const node = src.node(side === 'm' ? info.strainWrap : `${info.strainWrap}-${side}`);
    const p = node && wrapPoint(node.positions, p0, p1);
    if (node && p) out.push({ p, b: node.bone });
  }
  return out;
}

/**
 * The ends of a muscle's length line after the muscle data's corrections (MuscleInfo.strainOrigin, strainInsertion):
 * an end the data names as a bone landmark replaces the one picked from the mesh.
 */
export function resolveEnds(info: Pick<MuscleInfo, 'strainOrigin' | 'strainInsertion'>, side: 'l' | 'r' | 'm', path: StrainPath, src: ViaSource): StrainPath {
  const o = info.strainOrigin && resolveLandmark(info.strainOrigin, side, src);
  const i = info.strainInsertion && resolveLandmark(info.strainInsertion, side, src);
  return { ...path, ...(o && { p0: o.p, b0: o.b }), ...(i && { p1: i.p, b1: i.b }) };
}

/**
 * The length line of one part of a muscle (a key of the structure's parts, as the movement table names them: the
 * clavicular part of the deltoid), from bone landmarks at both ends, over the same kind of vias as the whole muscle's.
 * The movement table gives each part its own role, and one line for the whole muscle averages them away.
 */
export interface StrainPart {
  origin: StrainLandmark;
  insertion: StrainLandmark;
  vias?: (StrainLandmark | StrainObstacle)[];
}

/** The length line of a muscle part on `side` (see StrainPart), or null when a landmark or a bone is missing. */
export function resolvePart(part: StrainPart, side: 'l' | 'r' | 'm', src: ViaSource): StrainPath | null {
  const o = resolveLandmark(part.origin, side, src);
  const i = resolveLandmark(part.insertion, side, src);
  if (!o || !i) return null;
  const vias = resolveVias({ strainVias: part.vias }, side, o.p, i.p, src);
  return { p0: o.p, b0: o.b, p1: i.p, b1: i.b, ...(vias.length && { vias }) };
}

/** Mean of the vertices (flat xyz arrays) within `depth` of the bone's extreme in direction `near`: the centre of that end of the bone. Null without vertices. */
export function endCentre(positions: ArrayLike<number>[], near: Direction, depth: number, side: 'l' | 'r' | 'm'): THREE.Vector3 | null {
  const d = directionVector(near, side);
  const v = new THREE.Vector3();
  let top = -Infinity;
  for (const arr of positions) for (let i = 0; i + 2 < arr.length; i += 3) top = Math.max(top, d.dot(v.set(arr[i], arr[i + 1], arr[i + 2])));
  const sum = new THREE.Vector3();
  let n = 0;
  for (const arr of positions) {
    for (let i = 0; i + 2 < arr.length; i += 3) {
      if (d.dot(v.set(arr[i], arr[i + 1], arr[i + 2])) < top - depth) continue;
      sum.add(v);
      n++;
    }
  }
  return n ? sum.divideScalar(n) : null;
}

/** Bind-pose position of a landmark among the vertices (flat xyz arrays) of a bone, or null when it has none. */
export function landmarkPoint(positions: ArrayLike<number>[], lm: Pick<StrainLandmark, 'toward' | 'near' | 'depth' | 'skip'>, side: 'l' | 'r' | 'm'): THREE.Vector3 | null {
  const toward = new THREE.Vector3();
  for (const d of lm.toward) toward.add(directionVector(d, side));
  const near = lm.near ? directionVector(lm.near, side) : null;
  const v = new THREE.Vector3();
  let top = -Infinity;
  if (near) for (const arr of positions) for (let i = 0; i + 2 < arr.length; i += 3) top = Math.max(top, near.dot(v.set(arr[i], arr[i + 1], arr[i + 2])));
  const floor = near ? top - (lm.depth ?? 0) : -Infinity;
  const ceil = near ? top - (lm.skip ?? 0) : Infinity;
  let best: THREE.Vector3 | null = null;
  let bd = -Infinity;
  for (const arr of positions) {
    for (let i = 0; i + 2 < arr.length; i += 3) {
      v.set(arr[i], arr[i + 1], arr[i + 2]);
      if (near && (near.dot(v) < floor || near.dot(v) > ceil)) continue;
      const d = toward.dot(v);
      if (d > bd) { bd = d; (best ??= new THREE.Vector3()).copy(v); }
    }
  }
  return best;
}
