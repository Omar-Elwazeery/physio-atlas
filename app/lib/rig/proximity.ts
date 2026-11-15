/**
 * Distance from a point to the bones a rig node carries (bind pose), for skinning tendons onto the bones they reach.
 * A uniform grid over the bone vertices per node, built lazily on first use. No three.js, so the model scripts use it
 * too. Bone meshes are dense (Open 3D Model: about 1 mm between vertices on the small bones), so the nearest vertex
 * is a close enough stand-in for the nearest surface point at the 3-15 mm scale this is used at.
 */
type Grid = { cells: Map<number, number[]>; pts: Float32Array; lo: number[]; hi: number[] };
/** `nearest`: bone vertices thinned to one per 2.5 mm cube, in 15 mm cells. */
const COARSE_VOXEL = 0.0025, COARSE_H = 0.015;

export class BoneProximity {
  private grids = new Map<number, Grid | null>();

  /** `bonePositions(nodeIndex)` returns the bind-pose vertex arrays of the bones that node carries. */
  /** `h`: cell size of the grid (metres). 15 mm suits the 2-15 mm searches made here; the distances do not depend on it. */
  constructor(private bonePositions: (node: number) => ArrayLike<number>[], private h = 0.015) {}

  private key(i: number, j: number, k: number) { return ((i + 1024) * 2048 + (j + 1024)) * 2048 + (k + 1024); }

  private grid(node: number) {
    let g = this.grids.get(node);
    if (g === undefined) {
      const arrays = this.bonePositions(node);
      const total = arrays.reduce((a, p) => a + p.length, 0);
      if (!total) g = null;
      else {
        const pts = new Float32Array(total);
        let o = 0;
        for (const p of arrays) { for (let i = 0; i < p.length; i++) pts[o + i] = p[i]; o += p.length; }
        const cells = new Map<number, number[]>();
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let v = 0; v < pts.length / 3; v++) {
          for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], pts[v * 3 + a]); hi[a] = Math.max(hi[a], pts[v * 3 + a]); }
          const k = this.key(Math.floor(pts[v * 3] / this.h), Math.floor(pts[v * 3 + 1] / this.h), Math.floor(pts[v * 3 + 2] / this.h));
          const c = cells.get(k);
          if (c) c.push(v); else cells.set(k, [v]);
        }
        g = { cells, pts, lo, hi };
      }
      this.grids.set(node, g);
    }
    return g;
  }

  private coarseGrids = new Map<number, Grid | null>();

  /**
   * The node's bone vertices thinned to one per COARSE_VOXEL cube (the first in vertex order), in COARSE_H cells: for
   * `nearest`, whose callers blend over centimetres and do not need the 1 mm detail, at a fraction of the cost.
   */
  private coarse(node: number): Grid | null {
    let c = this.coarseGrids.get(node);
    if (c !== undefined) return c;
    const g = this.grid(node);
    if (!g) { this.coarseGrids.set(node, null); return null; }
    const seen = new Set<number>();
    const keep: number[] = [];
    for (let v = 0; v < g.pts.length / 3; v++) {
      const k = this.key(Math.floor(g.pts[v * 3] / COARSE_VOXEL), Math.floor(g.pts[v * 3 + 1] / COARSE_VOXEL), Math.floor(g.pts[v * 3 + 2] / COARSE_VOXEL));
      if (seen.has(k)) continue;
      seen.add(k);
      keep.push(g.pts[v * 3], g.pts[v * 3 + 1], g.pts[v * 3 + 2]);
    }
    const pts = Float32Array.from(keep);
    const cells = new Map<number, number[]>();
    for (let v = 0; v < pts.length / 3; v++) {
      const k = this.key(Math.floor(pts[v * 3] / COARSE_H), Math.floor(pts[v * 3 + 1] / COARSE_H), Math.floor(pts[v * 3 + 2] / COARSE_H));
      const a = cells.get(k);
      if (a) a.push(v); else cells.set(k, [v]);
    }
    c = { cells, pts, lo: g.lo, hi: g.hi };
    this.coarseGrids.set(node, c);
    return c;
  }

  /** Distance (metres) from (x, y, z) to the nearest bone vertex of `node`, or Infinity beyond `maxR`. */
  distance(node: number, x: number, y: number, z: number, maxR = 0.02): number {
    const g = this.grid(node);
    if (!g) return Infinity;
    if (x < g.lo[0] - maxR || x > g.hi[0] + maxR || y < g.lo[1] - maxR || y > g.hi[1] + maxR || z < g.lo[2] - maxR || z > g.hi[2] + maxR) return Infinity;
    const ci = Math.floor(x / this.h), cj = Math.floor(y / this.h), ck = Math.floor(z / this.h);
    const r = Math.ceil(maxR / this.h);
    let best = maxR * maxR;
    let found = false;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
      const c = g.cells.get(this.key(ci + i, cj + j, ck + k));
      if (!c) continue;
      for (const v of c) {
        const dx = g.pts[v * 3] - x, dy = g.pts[v * 3 + 1] - y, dz = g.pts[v * 3 + 2] - z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d <= best) { best = d; found = true; }
      }
    }
    return found ? Math.sqrt(best) : Infinity;
  }

  /**
   * Like `distance`, for longer ranges (ligaments, capsules and fasciae span centimetres): searches shells of cells
   * outwards from the first shell that can reach the bones' bounding box, and stops as soon as no farther shell can
   * hold a nearer vertex, so the cost follows the distance found rather than `maxR`.
   */
  nearest(node: number, x: number, y: number, z: number, maxR = 0.1): number {
    const g = this.coarse(node);
    if (!g) return Infinity;
    const bx = Math.max(g.lo[0] - x, 0, x - g.hi[0]), by = Math.max(g.lo[1] - y, 0, y - g.hi[1]), bz = Math.max(g.lo[2] - z, 0, z - g.hi[2]);
    const toBox = Math.hypot(bx, by, bz);
    if (toBox > maxR) return Infinity;
    const h = COARSE_H, ci = Math.floor(x / h), cj = Math.floor(y / h), ck = Math.floor(z / h);
    const R = Math.ceil(maxR / h);
    let best = Infinity;
    // shells whose farthest corner is nearer than the bounding box cannot hold a vertex
    for (let r = Math.max(0, Math.floor(toBox / (Math.sqrt(3) * h)) - 1); r <= R; r++) {
      // every vertex in shell r is at least (r - 1) * h away
      if (best <= ((r - 1) * h) ** 2) break;
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        const edge = Math.abs(i) === r || Math.abs(j) === r;
        for (let k = -r; k <= r; k += edge ? 1 : 2 * r || 1) {
          const c = g.cells.get(this.key(ci + i, cj + j, ck + k));
          if (!c) continue;
          for (const v of c) {
            const dx = g.pts[v * 3] - x, dy = g.pts[v * 3 + 1] - y, dz = g.pts[v * 3 + 2] - z;
            const d = dx * dx + dy * dy + dz * dz;
            if (d < best) best = d;
          }
        }
      }
    }
    return best <= maxR * maxR ? Math.sqrt(best) : Infinity;
  }
}
