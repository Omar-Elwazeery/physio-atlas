// Geometry helpers for the model build: welding, connected pieces, landmarks, sphere fits, nearest-point grids,
// point-triangle distance and the bone-to-bone (ICP) fit used to carry the muscles onto the new skeleton.
// Positions are flat Float32Arrays (x, y, z, ...), triangles flat Uint32Arrays.

export type V3 = [number, number, number];
/** Row-major 3x4 affine transform [a b c tx; d e f ty; g h i tz]. */
export type Affine = number[];

export const IDENTITY: Affine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
export const applyAffine = (A: Affine, x: number, y: number, z: number): V3 => [
  A[0] * x + A[1] * y + A[2] * z + A[3], A[4] * x + A[5] * y + A[6] * z + A[7], A[8] * x + A[9] * y + A[10] * z + A[11],
];

export function bbox(arrays: Float32Array[]): [V3, V3] {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of arrays) for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[i + k]); hi[k] = Math.max(hi[k], p[i + k]); }
  return [lo, hi];
}

export function concat(arrays: Float32Array[]): Float32Array {
  const out = new Float32Array(arrays.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  return out;
}

/**
 * Joint landmarks from the geometry itself: the vertex centroid of the end slice on every axis (x0/x1, y0/y1, z0/z1 =
 * lowest/highest end, 5 % of the extent) plus wider 12 % slices on y, and the overall vertex centroid `c`. The rig
 * derives pivots from these. Identical to the function in scripts/build-models.mjs (same vertices -> same numbers).
 */
export function landmarks(arrays: Float32Array[], min: V3, max: V3): Record<string, V3> {
  const acc: Record<string, number[]> = {};
  const add = (name: string, x: number, y: number, z: number) => { const a = (acc[name] ??= [0, 0, 0, 0]); a[0] += x; a[1] += y; a[2] += z; a[3]++; };
  const ext = [0, 1, 2].map((k) => max[k] - min[k]);
  for (const pos of arrays) {
    for (let i = 0; i < pos.length; i += 3) {
      const v = [pos[i], pos[i + 1], pos[i + 2]];
      add('c', v[0], v[1], v[2]);
      for (let k = 0; k < 3; k++) {
        const n = 'xyz'[k];
        if (v[k] <= min[k] + 0.05 * ext[k]) add(`${n}0`, v[0], v[1], v[2]);
        if (v[k] >= max[k] - 0.05 * ext[k]) add(`${n}1`, v[0], v[1], v[2]);
      }
      if (v[1] <= min[1] + 0.12 * ext[1]) add('y0w', v[0], v[1], v[2]);
      if (v[1] >= max[1] - 0.12 * ext[1]) add('y1w', v[0], v[1], v[2]);
    }
  }
  const out: Record<string, V3> = {};
  for (const [k, a] of Object.entries(acc)) out[k] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]].map((x) => +x.toFixed(4)) as V3;
  return out;
}

/** Canonical vertex per vertex: vertices with (nearly) equal positions share one id. */
export function weldIds(pos: Float32Array, eps = 1e-6): Int32Array {
  const n = pos.length / 3;
  const ids = new Int32Array(n);
  const map = new Map<string, number>();
  const q = (x: number) => Math.round(x / eps);
  for (let v = 0; v < n; v++) {
    const k = `${q(pos[v * 3])},${q(pos[v * 3 + 1])},${q(pos[v * 3 + 2])}`;
    const e = map.get(k);
    if (e === undefined) { map.set(k, v); ids[v] = v; } else ids[v] = e;
  }
  return ids;
}

/** Connected pieces of a triangle mesh (vertices welded by position first), as lists of triangle indices. */
export function components(pos: Float32Array, idx: Uint32Array): number[][] {
  const w = weldIds(pos);
  const parent = Int32Array.from({ length: pos.length / 3 }, (_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let t = 0; t < idx.length; t += 3) { union(w[idx[t]], w[idx[t + 1]]); union(w[idx[t]], w[idx[t + 2]]); }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < idx.length / 3; t++) {
    const r = find(w[idx[t * 3]]);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(t);
  }
  return [...groups.values()];
}

/**
 * `ref`: where the vertices were before the build reshaped the mesh (a sheet given thickness): the positions its skin
 * weights are worked out from, so both faces of the slab move as the sheet did.
 */
export interface Mesh { pos: Float32Array; idx: Uint32Array; uv?: Float32Array; ref?: Float32Array }

/** Sub-mesh made of the given triangles, with only the vertices they use. */
export function subMesh(m: Mesh, tris: number[]): Mesh {
  const remap = new Map<number, number>();
  const P: number[] = [], U: number[] = [], R: number[] = [];
  const I = new Uint32Array(tris.length * 3);
  let o = 0;
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const v = m.idx[t * 3 + k];
    let r = remap.get(v);
    if (r === undefined) {
      r = P.length / 3; remap.set(v, r);
      P.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]);
      if (m.uv) U.push(m.uv[v * 2], m.uv[v * 2 + 1]);
      if (m.ref) R.push(m.ref[v * 3], m.ref[v * 3 + 1], m.ref[v * 3 + 2]);
    }
    I[o++] = r;
  }
  return { pos: new Float32Array(P), idx: I, ...(m.uv ? { uv: new Float32Array(U) } : {}), ...(m.ref ? { ref: new Float32Array(R) } : {}) };
}

export function mergeMeshes(list: Mesh[]): Mesh {
  const withUv = list.every((m) => m.uv);
  const pos = concat(list.map((m) => m.pos));
  const idx = new Uint32Array(list.reduce((a, m) => a + m.idx.length, 0));
  let o = 0, off = 0;
  for (const m of list) { for (let i = 0; i < m.idx.length; i++) idx[o++] = m.idx[i] + off; off += m.pos.length / 3; }
  const withRef = list.some((m) => m.ref);
  return { pos, idx, ...(withUv ? { uv: concat(list.map((m) => m.uv!)) } : {}), ...(withRef ? { ref: concat(list.map((m) => m.ref ?? m.pos)) } : {}) };
}

/**
 * Points covering a surface no more than about `spacing` apart: each triangle's corners and an even barycentric grid
 * over it. For distance-to-surface tests against a point grid when the mesh itself is coarse.
 */
export function surfacePoints(pos: Float32Array, idx: Uint32Array, spacing: number): Float32Array {
  const out: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const edge = (i: number, j: number) => Math.hypot(pos[i] - pos[j], pos[i + 1] - pos[j + 1], pos[i + 2] - pos[j + 2]);
    const n = Math.max(1, Math.ceil(Math.max(edge(a, b), edge(b, c), edge(c, a)) / spacing));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n, w = 1 - u - v;
      out.push(w * pos[a] + u * pos[b] + v * pos[c], w * pos[a + 1] + u * pos[b + 1] + v * pos[c + 1], w * pos[a + 2] + u * pos[b + 2] + v * pos[c + 2]);
    }
  }
  return Float32Array.from(out);
}

export function centroid(pos: Float32Array): V3 {
  const c: V3 = [0, 0, 0];
  const n = pos.length / 3;
  for (let i = 0; i < pos.length; i += 3) { c[0] += pos[i]; c[1] += pos[i + 1]; c[2] += pos[i + 2]; }
  return [c[0] / n, c[1] / n, c[2] / n];
}

// ---- linear algebra ---------------------------------------------------------------------------------------------

/** Solves the n x n system M x = b (Gaussian elimination with partial pivoting). M is row-major, modified. */
export function solve(M: number[], b: number[], n: number): number[] {
  const a = M.slice(), x = b.slice();
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r * n + c]) > Math.abs(a[p * n + c])) p = r;
    if (p !== c) { for (let k = 0; k < n; k++) [a[c * n + k], a[p * n + k]] = [a[p * n + k], a[c * n + k]]; [x[c], x[p]] = [x[p], x[c]]; }
    const d = a[c * n + c] || 1e-30;
    for (let r = c + 1; r < n; r++) {
      const f = a[r * n + c] / d;
      if (!f) continue;
      for (let k = c; k < n; k++) a[r * n + k] -= f * a[c * n + k];
      x[r] -= f * x[c];
    }
  }
  for (let c = n - 1; c >= 0; c--) {
    let s = x[c];
    for (let k = c + 1; k < n; k++) s -= a[c * n + k] * x[k];
    x[c] = s / (a[c * n + c] || 1e-30);
  }
  return x;
}

/** Least-squares sphere through points: [cx, cy, cz, r] (algebraic fit). */
export function fitSphere(pts: number[][]): [number, number, number, number] {
  const M = new Array(16).fill(0), b = [0, 0, 0, 0];
  for (const [x, y, z] of pts) {
    const row = [2 * x, 2 * y, 2 * z, 1], rhs = x * x + y * y + z * z;
    for (let i = 0; i < 4; i++) { b[i] += row[i] * rhs; for (let j = 0; j < 4; j++) M[i * 4 + j] += row[i] * row[j]; }
  }
  const [cx, cy, cz, d] = solve(M, b, 4);
  return [cx, cy, cz, Math.sqrt(Math.max(0, d + cx * cx + cy * cy + cz * cz))];
}

/**
 * Least-squares cylinder about a given axis direction: the points projected onto the plane across `axis` and a circle
 * fitted there (algebraic, then geometric). Returns [cx, cy, cz, r], the centre on the axis line at the points' mean
 * along it. For a hinge about `axis` this is the centre that keeps the surface at the most constant distance; it is
 * well posed on a pulley-shaped (bicondylar) head, where a sphere fit is not.
 */
export function fitCircleAbout(pts: number[][], axis: V3): [number, number, number, number] {
  const L = Math.hypot(...axis), a = axis.map((x) => x / L);
  const t = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = [a[1] * t[2] - a[2] * t[1], a[2] * t[0] - a[0] * t[2], a[0] * t[1] - a[1] * t[0]];
  const ul = Math.hypot(...u); for (let k = 0; k < 3; k++) u[k] /= ul;
  const w = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
  const dot = (p: number[], d: number[]) => p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
  const P = pts.map((p) => [dot(p, u), dot(p, w)]);
  const along = pts.reduce((s, p) => s + dot(p, a), 0) / pts.length;
  const M = new Array(9).fill(0), b = [0, 0, 0];
  for (const [x, y] of P) {
    const row = [2 * x, 2 * y, 1], rhs = x * x + y * y;
    for (let i = 0; i < 3; i++) { b[i] += row[i] * rhs; for (let j = 0; j < 3; j++) M[i * 3 + j] += row[i] * row[j]; }
  }
  const init = solve(M, b, 3);
  let [cx, cy] = init;
  let r = Math.sqrt(Math.max(0, init[2] + cx * cx + cy * cy));
  for (let it = 0; it < 50; it++) {
    const N = new Array(9).fill(0), g = [0, 0, 0];
    for (const [x, y] of P) {
      const dx = x - cx, dy = y - cy, dd = Math.hypot(dx, dy) || 1e-12;
      const J = [-dx / dd, -dy / dd, -1], res = dd - r;
      for (let i = 0; i < 3; i++) { g[i] -= J[i] * res; for (let j = 0; j < 3; j++) N[i * 3 + j] += J[i] * J[j]; }
    }
    const step = solve(N, g, 3);
    if (!step.every(Number.isFinite)) break;
    cx += step[0]; cy += step[1]; r += step[2];
    if (Math.hypot(...step) < 1e-9) break;
  }
  return [0, 1, 2].map((k) => cx * u[k] + cy * w[k] + along * a[k]).concat(r) as [number, number, number, number];
}

/**
 * Geometric least-squares sphere (Gauss-Newton on |p - c| - r), started from `init` (e.g. fitSphere, whose algebraic
 * fit underestimates the radius of a small cap). It can run away on a surface that is far from spherical (a pulley-
 * shaped phalangeal head): check the result.
 */
export function refineSphere(pts: number[][], init: [number, number, number, number], iters = 50): [number, number, number, number] {
  let [cx, cy, cz, r] = init;
  for (let it = 0; it < iters; it++) {
    const M = new Array(16).fill(0), b = [0, 0, 0, 0];
    for (const [x, y, z] of pts) {
      const dx = x - cx, dy = y - cy, dz = z - cz, d = Math.hypot(dx, dy, dz) || 1e-12;
      const J = [-dx / d, -dy / d, -dz / d, -1], res = d - r;
      for (let i = 0; i < 4; i++) { b[i] -= J[i] * res; for (let j = 0; j < 4; j++) M[i * 4 + j] += J[i] * J[j]; }
    }
    const step = solve(M, b, 4);
    cx += step[0]; cy += step[1]; cz += step[2]; r += step[3];
    if (!step.every(Number.isFinite)) return [NaN, NaN, NaN, NaN];
    if (Math.hypot(...step) < 1e-9) break;
  }
  return [cx, cy, cz, r];
}

/** Symmetric 3x3 eigen-decomposition (Jacobi). Returns eigenvalues (descending) and column eigenvectors. */
export function eigSym3(S: number[]): { values: number[]; vectors: number[][] } {
  const a = S.slice();
  const V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[1] * a[1] + a[2] * a[2] + a[5] * a[5];
    if (off < 1e-30) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-30) continue;
      const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { // A = J^T A J
        const akp = a[k * 3 + p], akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - s * akq; a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k], aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk; a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k * 3 + p], vkq = V[k * 3 + q];
        V[k * 3 + p] = c * vkp - s * vkq; V[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j * 4] - a[i * 4]);
  return { values: order.map((i) => a[i * 4]), vectors: order.map((i) => [V[i], V[3 + i], V[6 + i]]) };
}

// ---- nearest neighbours -----------------------------------------------------------------------------------------

/** Uniform grid over points for nearest-point queries. */
export class PointGrid {
  private cells = new Map<number, number[]>();
  constructor(readonly pts: Float32Array, readonly h = 0.006) {
    for (let i = 0; i < pts.length / 3; i++) {
      const k = this.key(this.c(pts[i * 3]), this.c(pts[i * 3 + 1]), this.c(pts[i * 3 + 2]));
      let a = this.cells.get(k);
      if (!a) this.cells.set(k, (a = []));
      a.push(i);
    }
  }
  private c(x: number) { return Math.floor(x / this.h); }
  private key(i: number, j: number, k: number) { return ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048); }
  /** Index of the nearest point and its squared distance (searches up to `maxR` metres). */
  nearest(x: number, y: number, z: number, maxR = 0.25): [number, number] {
    const ci = this.c(x), cj = this.c(y), ck = this.c(z);
    let best = -1, bd = Infinity;
    const maxRing = Math.ceil(maxR / this.h);
    for (let r = 0; r <= maxRing; r++) {
      // the cells of shell r only, in the same (i, j, k) order as a full scan of the cube would visit them
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k += Math.abs(i) === r || Math.abs(j) === r ? 1 : 2 * r || 1) {
        const a = this.cells.get(this.key(ci + i, cj + j, ck + k));
        if (!a) continue;
        for (const p of a) {
          const dx = this.pts[p * 3] - x, dy = this.pts[p * 3 + 1] - y, dz = this.pts[p * 3 + 2] - z;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bd) { bd = d; best = p; }
        }
      }
      if (best >= 0 && Math.sqrt(bd) <= r * this.h) break;
    }
    return [best, bd];
  }
}

/** Squared distance from p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5). */
export function pointTri2(px: number, py: number, pz: number, P: Float32Array, a: number, b: number, c: number, out?: number[]): number {
  const ax = P[a], ay = P[a + 1], az = P[a + 2];
  const abx = P[b] - ax, aby = P[b + 1] - ay, abz = P[b + 2] - az;
  const acx = P[c] - ax, acy = P[c + 1] - ay, acz = P[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  // (plain assignments, not a setter closure: this runs hundreds of millions of times in a build)
  let qx = ax, qy = ay, qz = az;
  if (d1 <= 0 && d2 <= 0) { /* vertex a */ }
  else {
    const bpx = px - P[b], bpy = py - P[b + 1], bpz = pz - P[b + 2];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { qx = P[b]; qy = P[b + 1]; qz = P[b + 2]; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz; } else {
        const cpx = px - P[c], cpy = py - P[c + 1], cpz = pz - P[c + 2];
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { qx = P[c]; qy = P[c + 1]; qz = P[c + 2]; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz; } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              qx = P[b] + w * (P[c] - P[b]); qy = P[b + 1] + w * (P[c + 1] - P[b + 1]); qz = P[b + 2] + w * (P[c + 2] - P[b + 2]);
            } else {
              const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
              qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
            }
          }
        }
      }
    }
  }
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  if (out) { out[0] = qx; out[1] = qy; out[2] = qz; }
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Triangle soup in a uniform grid: distance to the surface (exact, within a search radius) and inside/outside by ray
 * parity along +x (needs a closed surface; used for comparisons, so the same bias applies before and after).
 */
export class TriGrid {
  private cells = new Map<number, number[]>();
  private cols = new Map<number, number[]>();
  readonly lo: V3; readonly hi: V3;
  private stamp = 0;
  private seen: Uint32Array;
  constructor(readonly pos: Float32Array, readonly idx: Uint32Array, readonly h = 0.008) {
    this.seen = new Uint32Array(idx.length / 3);
    [this.lo, this.hi] = bbox([pos]);
    for (let t = 0; t < idx.length / 3; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const mn = [0, 1, 2].map((k) => Math.floor(Math.min(pos[a + k], pos[b + k], pos[c + k]) / h));
      const mx = [0, 1, 2].map((k) => Math.floor(Math.max(pos[a + k], pos[b + k], pos[c + k]) / h));
      for (let i = mn[0]; i <= mx[0]; i++) for (let j = mn[1]; j <= mx[1]; j++) for (let k = mn[2]; k <= mx[2]; k++) {
        const key = this.key(i, j, k);
        let arr = this.cells.get(key);
        if (!arr) this.cells.set(key, (arr = []));
        arr.push(t);
      }
      for (let j = mn[1]; j <= mx[1]; j++) for (let k = mn[2]; k <= mx[2]; k++) {
        const key = this.key(0, j, k);
        let arr = this.cols.get(key);
        if (!arr) this.cols.set(key, (arr = []));
        arr.push(t);
      }
    }
  }
  private key(i: number, j: number, k: number) { return ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048); }
  /** Distance to the nearest triangle, or Infinity beyond `maxR`. */
  distance(x: number, y: number, z: number, maxR = 0.03): number {
    return this.closest(x, y, z, maxR)[0];
  }
  /** [distance, closest x, y, z] on the surface; distance Infinity (and the query point) beyond `maxR`. */
  closest(x: number, y: number, z: number, maxR = 0.03): [number, number, number, number] {
    const h = this.h, ci = Math.floor(x / h), cj = Math.floor(y / h), ck = Math.floor(z / h);
    let bd = Infinity;
    const q = [x, y, z], tmp = [0, 0, 0];
    const R = Math.ceil(maxR / h);
    // (a stamp per triangle instead of a Set per query)
    const stamp = ++this.stamp, seen = this.seen;
    for (let r = 0; r <= R; r++) {
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k += Math.abs(i) === r || Math.abs(j) === r ? 1 : 2 * r || 1) {
        const arr = this.cells.get(this.key(ci + i, cj + j, ck + k));
        if (!arr) continue;
        for (const t of arr) {
          if (seen[t] === stamp) continue;
          seen[t] = stamp;
          const d = pointTri2(x, y, z, this.pos, this.idx[t * 3] * 3, this.idx[t * 3 + 1] * 3, this.idx[t * 3 + 2] * 3, tmp);
          if (d < bd) { bd = d; q[0] = tmp[0]; q[1] = tmp[1]; q[2] = tmp[2]; }
        }
      }
      if (bd < Infinity && Math.sqrt(bd) <= r * h) break;
    }
    const d = Math.sqrt(bd);
    return d <= maxR ? [d, q[0], q[1], q[2]] : [Infinity, x, y, z];
  }
  inside(x: number, y0: number, z0: number): boolean {
    if (x > this.hi[0] || y0 < this.lo[1] || y0 > this.hi[1] || z0 < this.lo[2] || z0 > this.hi[2]) return false;
    const y = y0 + 1.37e-7, z = z0 + 2.11e-7;
    const arr = this.cols.get(this.key(0, Math.floor(y / this.h), Math.floor(z / this.h)));
    if (!arr) return false;
    const P = this.pos;
    let n = 0;
    for (const t of arr) {
      const a = this.idx[t * 3] * 3, b = this.idx[t * 3 + 1] * 3, c = this.idx[t * 3 + 2] * 3;
      const e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const det = e1y * e2z - e1z * e2y; // ray dir (1,0,0): det = e1 . (dir x e2) = e1y*(-e2z)... sign irrelevant
      if (Math.abs(det) < 1e-18) continue;
      const sy = y - P[a + 1], sz = z - P[a + 2];
      const u = (sy * e2z - sz * e2y) / det, v = (e1y * sz - e1z * sy) / det;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const xi = P[a] + u * (P[b] - P[a]) + v * (P[c] - P[a]);
      if (xi > x) n++;
    }
    return (n & 1) === 1;
  }
}

// ---- bone-to-bone fit -------------------------------------------------------------------------------------------

/** Least-squares affine transform taking points p to points q (pairs). */
export function solveAffine(p: number[][], q: number[][], w?: number[]): Affine {
  const M = new Array(16).fill(0);
  const B = [new Array(4).fill(0), new Array(4).fill(0), new Array(4).fill(0)];
  for (let i = 0; i < p.length; i++) {
    const wi = w ? w[i] : 1;
    const r = [p[i][0], p[i][1], p[i][2], 1];
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) M[a * 4 + b] += wi * r[a] * r[b];
      for (let k = 0; k < 3; k++) B[k][a] += wi * r[a] * q[i][k];
    }
  }
  const rows = B.map((b) => solve(M, b, 4));
  return [...rows[0], ...rows[1], ...rows[2]];
}

/** Closest-to-identity check: singular values of the linear part (sqrt of eigenvalues of L^T L). */
export function singularValues(A: Affine): number[] {
  const L = [A[0], A[1], A[2], A[4], A[5], A[6], A[8], A[9], A[10]];
  const S = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) S[i * 3 + j] += L[k * 3 + i] * L[k * 3 + j];
  return eigSym3(S).values.map((x) => Math.sqrt(Math.max(0, x)));
}

function sample(pts: Float32Array, max: number): number[][] {
  const n = pts.length / 3, step = Math.max(1, Math.floor(n / max));
  const out: number[][] = [];
  for (let i = 0; i < n; i += step) out.push([pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]]);
  return out;
}

/** Rotation best aligning centred point sets x -> y (Kabsch), from the SVD of the cross-covariance. */
export function kabsch(H: number[]): number[] {
  // H = sum x y^T (row-major). SVD via the eigenvectors of H^T H.
  const HtH = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) HtH[i * 3 + j] += H[k * 3 + i] * H[k * 3 + j];
  const { values, vectors: V } = eigSym3(HtH);
  const U: number[][] = [];
  for (let c = 0; c < 3; c++) {
    const s = Math.sqrt(Math.max(values[c], 0));
    const v = V[c];
    if (s > 1e-12 && c < 2) U.push([0, 1, 2].map((r) => (H[r * 3] * v[0] + H[r * 3 + 1] * v[1] + H[r * 3 + 2] * v[2]) / s));
    else { const a = U[0], b = U[1]; U.push([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]); }
  }
  // R = V D U^T with det(R) = +1
  const det3 = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const Vm = [0, 1, 2].map((r) => [V[0][r], V[1][r], V[2][r]]), Um = [0, 1, 2].map((r) => [U[0][r], U[1][r], U[2][r]]);
  const d = Math.sign(det3(Vm) * det3(Um)) || 1;
  const R = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let c = 0; c < 3; c++) R[i * 3 + j] += V[c][i] * (c === 2 ? d : 1) * U[c][j];
  return R;
}

export interface BoneFit {
  A: Affine;
  /** RMS of the final (trimmed) correspondences, metres. */
  rms: number;
  /** Stretch along the old bone's long axis and across it (1 = unchanged). */
  axial: number;
  cross: number;
}

/**
 * Fits the transform that carries an old bone (points P) onto its new version (points Q): a rotation and
 * translation plus a stretch along the old bone's principal axis and a (smaller) uniform scale across it, so a
 * remodelled bone that is 15 mm shorter or slightly slimmer is matched without the shearing an unconstrained affine
 * fit falls into on long thin bones. Symmetric ICP (old->new and new->old closest points, worst 10 % trimmed),
 * started from the centroid shift; both scales are kept within +-12 %.
 */
export function fitBoneTransform(P: Float32Array, Q: Float32Array, iters = 40): BoneFit {
  const ps = sample(P, 3000), qs = sample(Q, 3000);
  const qGrid = new PointGrid(Q, 0.006);
  const cp = centroid(P), cq = centroid(Q);
  let cov = new Array(9).fill(0);
  for (const p of ps) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i * 3 + j] += (p[i] - cp[i]) * (p[j] - cp[j]);
  const ax = eigSym3(cov).vectors[0];
  cov = [];
  let R = [1, 0, 0, 0, 1, 0, 0, 0, 1], t = [cq[0], cq[1], cq[2]], sa = 1, sc = 1;
  // x = S (p - cp); q ~ R x + t
  const S = (p: number[]): number[] => {
    const d = [p[0] - cp[0], p[1] - cp[1], p[2] - cp[2]];
    const a = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2];
    return [0, 1, 2].map((k) => sc * d[k] + (sa - sc) * a * ax[k]);
  };
  const toAffine = (): Affine => {
    // linear part L = R * Smat, Smat = sc I + (sa - sc) a a^T; translation t - L cp
    const Sm = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => (i === j ? sc : 0) + (sa - sc) * ax[i] * ax[j]));
    const L = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) L[i * 3 + j] += R[i * 3 + k] * Sm[k * 3 + j];
    const tt = [0, 1, 2].map((i) => t[i] - (L[i * 3] * cp[0] + L[i * 3 + 1] * cp[1] + L[i * 3 + 2] * cp[2]));
    return [L[0], L[1], L[2], tt[0], L[3], L[4], L[5], tt[1], L[6], L[7], L[8], tt[2]];
  };
  let rms = Infinity;
  for (let it = 0; it < iters; it++) {
    const A = toAffine();
    const pairs: { p: number[]; q: number[]; d: number }[] = [];
    const tP = new Float32Array(ps.length * 3);
    ps.forEach((p, i) => {
      const x = applyAffine(A, p[0], p[1], p[2]);
      tP[i * 3] = x[0]; tP[i * 3 + 1] = x[1]; tP[i * 3 + 2] = x[2];
      const [j, d] = qGrid.nearest(x[0], x[1], x[2]);
      if (j >= 0) pairs.push({ p, q: [Q[j * 3], Q[j * 3 + 1], Q[j * 3 + 2]], d });
    });
    const pGrid = new PointGrid(tP, 0.006);
    for (const q of qs) {
      const [j, d] = pGrid.nearest(q[0], q[1], q[2]);
      if (j >= 0) pairs.push({ p: ps[j], q, d });
    }
    pairs.sort((a, b) => a.d - b.d);
    const keep = pairs.slice(0, Math.floor(pairs.length * 0.9));
    rms = Math.sqrt(keep.reduce((a, x) => a + x.d, 0) / keep.length);
    // (1) rotation + translation for the current scales
    const X = keep.map((k) => S(k.p)), Y = keep.map((k) => k.q);
    const mx = [0, 1, 2].map((k) => X.reduce((a, x) => a + x[k], 0) / X.length), my = [0, 1, 2].map((k) => Y.reduce((a, y) => a + y[k], 0) / Y.length);
    const H = new Array(9).fill(0);
    for (let i = 0; i < X.length; i++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) H[a * 3 + b] += (X[i][a] - mx[a]) * (Y[i][b] - my[b]);
    R = kabsch(H);
    t = [0, 1, 2].map((i) => my[i] - (R[i * 3] * mx[0] + R[i * 3 + 1] * mx[1] + R[i * 3 + 2] * mx[2]));
    // (2) scales for that rotation: in the old frame, q' = R^T (q - t) ~ sc d + (sa - sc) a a.d
    let na = 0, da = 0, nc = 0, dc = 0;
    for (const k of keep) {
      const d = [k.p[0] - cp[0], k.p[1] - cp[1], k.p[2] - cp[2]];
      const r = [k.q[0] - t[0], k.q[1] - t[1], k.q[2] - t[2]];
      const qq = [0, 1, 2].map((j) => R[j] * r[0] + R[3 + j] * r[1] + R[6 + j] * r[2]);
      const a = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2], qa = qq[0] * ax[0] + qq[1] * ax[1] + qq[2] * ax[2];
      na += a * qa; da += a * a;
      const dp = [0, 1, 2].map((j) => d[j] - a * ax[j]), qp = [0, 1, 2].map((j) => qq[j] - qa * ax[j]);
      nc += dp[0] * qp[0] + dp[1] * qp[1] + dp[2] * qp[2]; dc += dp[0] * dp[0] + dp[1] * dp[1] + dp[2] * dp[2];
    }
    const clamp = (x: number) => Math.min(1.12, Math.max(0.88, x));
    const nsa = clamp(da ? na / da : 1), nsc = clamp(dc ? nc / dc : 1);
    const delta = Math.abs(nsa - sa) + Math.abs(nsc - sc);
    sa = nsa; sc = nsc;
    if (it > 5 && delta < 1e-6) break;
  }
  return { A: toAffine(), rms, axial: sa, cross: sc };
}
