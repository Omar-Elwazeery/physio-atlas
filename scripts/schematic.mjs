// Schematic muscles for structures BodyParts3D does not contain. Each is a thin lofted shell between
// anatomical landmarks found on the real skeleton, flagged `schematic` in the manifest and in the UI.
// All coordinates: metres, y up, +z anterior, +x = the figure's left.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/**
 * Thin shell from a U x V grid of points. `out(p)` returns the outward direction used to orient the
 * normals. Thickness tapers to the edges so the belly is fuller than the tendinous ends.
 */
export function loft(grid, thickness, out, profile = () => 1) {
  const U = grid.length, V = grid[0].length;
  const N = Array.from({ length: U }, () => new Array(V));
  for (let u = 0; u < U; u++) for (let v = 0; v < V; v++) {
    const du = sub(grid[Math.min(U - 1, u + 1)][v], grid[Math.max(0, u - 1)][v]);
    const dv = sub(grid[u][Math.min(V - 1, v + 1)], grid[u][Math.max(0, v - 1)]);
    let n = norm(cross(du, dv));
    if (dot(n, out(grid[u][v])) < 0) n = mul(n, -1);
    N[u][v] = n;
  }
  const pos = [];
  const at = (u, v) => u * V + v;
  for (const sign of [1, -1]) {
    for (let u = 0; u < U; u++) for (let v = 0; v < V; v++) {
      const tu = U > 1 ? u / (U - 1) : 0.5, tv = V > 1 ? v / (V - 1) : 0.5;
      const t = thickness * (0.3 + 0.7 * Math.sin(Math.PI * tv)) * (0.45 + 0.55 * Math.sin(Math.PI * tu)) * profile(tv);
      pos.push(...add(grid[u][v], mul(N[u][v], (sign * t) / 2)));
    }
  }
  const off = U * V;
  const idx = [];
  const quad = (a, b, c, d, flip) => (flip ? idx.push(a, c, b, a, d, c) : idx.push(a, b, c, a, c, d));
  for (let u = 0; u < U - 1; u++) for (let v = 0; v < V - 1; v++) {
    quad(at(u, v), at(u + 1, v), at(u + 1, v + 1), at(u, v + 1), false);
    quad(off + at(u, v), off + at(u + 1, v), off + at(u + 1, v + 1), off + at(u, v + 1), true);
  }
  for (let u = 0; u < U - 1; u++) { // v = 0 and v = V-1 walls
    for (const v of [0, V - 1]) quad(at(u, v), at(u + 1, v), off + at(u + 1, v), off + at(u, v), v === 0);
  }
  for (let v = 0; v < V - 1; v++) { // u = 0 and u = U-1 walls
    for (const u of [0, U - 1]) quad(at(u, v), at(u, v + 1), off + at(u, v + 1), off + at(u, v), u !== 0);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

const smooth = (t) => t * t * (3 - 2 * t);

/** @param ctx { verts(id) => Float32Array | null, has(id) => boolean } */
export function makeSchematic(ctx) {
  const V = (id) => ctx.verts(id);
  const each = (id, fn) => { const a = V(id); if (a) for (let i = 0; i < a.length; i += 3) fn(a[i], a[i + 1], a[i + 2]); };
  /** Vertex with the extreme coordinate along `axis` (sign +1 = max), optionally filtered. */
  const ex = (ids, axis, sign, pred = () => true) => {
    let best = null, bv = -Infinity;
    for (const id of [].concat(ids)) each(id, (x, y, z) => {
      const p = [x, y, z];
      if (!pred(p)) return;
      const v = sign * (typeof axis === 'function' ? axis(p) : p[axis]);
      if (v > bv) { bv = v; best = p; }
    });
    return best;
  };
  const nearest = (ids, target) => {
    let best = null, bd = Infinity;
    for (const id of [].concat(ids)) each(id, (x, y, z) => {
      const d = (x - target[0]) ** 2 + (y - target[1]) ** 2 + (z - target[2]) ** 2;
      if (d < bd) { bd = d; best = [x, y, z]; }
    });
    return best;
  };
  const bbox = (id) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    each(id, (x, y, z) => { const p = [x, y, z]; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); } });
    return [lo, hi];
  };

  const defs = [];
  const sides = ['l', 'r'];
  const sx = (s) => (s === 'l' ? 1 : -1);
  const add3 = (key, label, side, grid, thickness, out, group, profile) =>
    defs.push({ id: side === 'm' ? key : `${key}-${side}`, key, label, side, group, parts: [{ key: 'main', label, geom: loft(grid, thickness, out, profile) }] });

  // Torso cross-section from the external oblique (anterior/lateral wall) and the spine (posterior wall).
  const EO = ['external-oblique-l', 'external-oblique-r'];
  const eoNear = (y, w) => { const pts = []; for (const id of EO) each(id, (x, yy, z) => { if (Math.abs(yy - y) < w) pts.push([x, yy, z]); }); return pts; };
  const SPINE = ['l5', 'l4', 'l3', 'l2', 'l1', 't12', 't11', 't10', 't9', 't8', 't7'];
  const torso = (y) => {
    const pts = eoNear(y, 0.02);
    let a = 0.14, zAnt = 0.1;
    if (pts.length) { a = Math.max(...pts.map((p) => Math.abs(p[0]))); zAnt = Math.max(...pts.filter((p) => Math.abs(p[0]) < 0.1).map((p) => p[2]), -Infinity); if (!isFinite(zAnt)) zAnt = Math.max(...pts.map((p) => p[2])); }
    let zPost = Infinity;
    for (const id of SPINE) each(id, (x, yy, z) => { if (Math.abs(yy - y) < 0.03 && Math.abs(x) < 0.04 && z < zPost) zPost = z; });
    if (!isFinite(zPost)) zPost = zAnt - 0.2;
    return { a, zAnt, zPost, zc: (zAnt + zPost) / 2, b: (zAnt - zPost) / 2 };
  };
  const torsoOut = (p) => { const t = torso(p[1]); const d = [p[0] / t.a, 0, (p[2] - t.zc) / t.b]; return norm(d[0] === 0 && d[2] === 0 ? [0, 0, 1] : d); };

  const need = (...ids) => ids.every((i) => ctx.has(i));

  // ---- rectus abdominis ---------------------------------------------------------------------------
  for (const s of sides) {
    if (!need(`hip-bone-${s}`, 'xiphoid')) continue;
    const hb = bbox(`hip-bone-${s}`);
    const pubis = ex(`hip-bone-${s}`, 1, -1, (p) => p[2] > hb[1][2] - 0.045 && Math.abs(p[0]) < 0.09) ?? [sx(s) * 0.04, hb[0][1], hb[1][2]];
    const xi = ctx.centroid('xiphoid');
    const yLo = pubis[1] + 0.01, yHi = xi[1] + 0.045;
    const xs = [0.012, 0.03, 0.048, 0.066, 0.082];
    const grid = xs.map((x) => Array.from({ length: 16 }, (_, k) => {
      const y = yLo + (yHi - yLo) * (k / 15);
      const xx = sx(s) * (x + 0.012 * (k / 15));
      return [xx, y, torsoZ(y, xx) - 0.014];
    }));
    function torsoZ(y, x) {
      const pts = eoNear(y, 0.012).filter((p) => Math.abs(p[0] - x) < 0.03);
      return pts.length ? Math.max(...pts.map((p) => p[2])) : torso(y).zAnt;
    }
    // three tendinous intersections divide the belly into four segments
    add3('rectus-abdominis', 'Rectus Abdominis', s, grid, 0.02, () => [0, 0, 1], 'Abdominal wall', (tv) => 0.55 + 0.45 * Math.abs(Math.sin(tv * Math.PI * 4)));
  }

  // ---- internal oblique and transversus abdominis (deeper layers of the lateral wall) ----------------
  const wall = (key, label, s, y0, y1, th0, th1, depth, thick) => {
    const nu = 11, nv = 8;
    const grid = Array.from({ length: nu }, (_, i) => Array.from({ length: nv }, (_, j) => {
      const th = th0 + (th1 - th0) * (i / (nu - 1));
      const y = y0 + (y1 - y0) * (j / (nv - 1)) + 0.03 * (1 - i / (nu - 1)); // fibres rise toward the midline
      const t = torso(y);
      const a = Math.max(0.05, t.a - depth), b = Math.max(0.05, t.b - depth);
      return [sx(s) * a * Math.sin(th), y, t.zc + b * Math.cos(th)];
    }));
    add3(key, label, s, grid, thick, torsoOut, 'Abdominal wall');
  };
  for (const s of sides) {
    if (!need(`hip-bone-${s}`, `rib-10-${s}`)) continue;
    const crest = ex(`hip-bone-${s}`, 1, 1)[1];
    const r10 = bbox(`rib-10-${s}`)[0][1];
    const r7 = bbox(`rib-7-${s}`)[0][1];
    wall('internal-oblique', 'Internal Oblique', s, crest - 0.005, r10 + 0.02, 0.14, 2.0, 0.03, 0.014);
    wall('transversus-abdominis', 'Transversus Abdominis', s, crest - 0.01, r7 + 0.03, 0.1, 2.2, 0.045, 0.011);
  }

  // ---- quadratus lumborum --------------------------------------------------------------------------
  for (const s of sides) {
    if (!need(`hip-bone-${s}`, `rib-12-${s}`, 'l3')) continue;
    const crest = ex(`hip-bone-${s}`, 1, 1, (p) => Math.abs(p[0]) < 0.12 && Math.abs(p[0]) > 0.04);
    const r12 = ex(`rib-12-${s}`, 1, -1, (p) => Math.abs(p[0]) < 0.08);
    const [lo, hi] = bbox('l3');
    const z = lo[2] + 0.35 * (hi[2] - lo[2]);
    const grid = [0, 1, 2, 3].map((u) => Array.from({ length: 10 }, (_, v) => {
      const t = v / 9;
      const x = sx(s) * (0.095 - 0.035 * t - 0.013 * (u / 3) * (1 - t) + 0.012 * (u / 3) * t);
      return [x, crest[1] + (r12[1] - crest[1]) * t, z + (u - 1.5) * 0.011];
    }));
    add3('quadratus-lumborum', 'Quadratus Lumborum', s, grid, 0.02, () => [0, 0, -1], 'Posterior abdominal wall');
  }

  // ---- multifidus (deep to the erector spinae, along the spinous processes) -------------------------
  const column = ['sacrum', 'l5', 'l4', 'l3', 'l2', 'l1', 't12', 't11', 't10', 't9', 't8', 't7', 't6', 't5', 't4', 't3', 't2', 't1', 'c7', 'c6', 'c5', 'c4', 'c3', 'c2'];
  if (column.every((c) => ctx.has(c))) {
    for (const s of sides) {
      const rows = column.map((c) => {
        const [lo, hi] = bbox(c);
        const tip = c === 'sacrum' ? lo[2] + 0.015 : lo[2] + 0.014;
        const y = c === 'sacrum' ? lo[1] + 0.1 * (hi[1] - lo[1]) + 0.08 : (lo[1] + hi[1]) / 2;
        return { y, z: tip + 0.012, w: c === 'sacrum' || c.startsWith('l') ? 0.034 : c.startsWith('t') ? 0.024 : 0.018 };
      });
      const grid = [0, 1, 2].map((u) => rows.map((r) => [sx(s) * (0.012 + (r.w / 2) * u), r.y, r.z]));
      add3('multifidus', 'Multifidus', s, grid, 0.026, () => [0, 0, -1], 'Deep spinal');
    }
  }

  // ---- latissimus dorsi ------------------------------------------------------------------------------
  for (const s of sides) {
    if (!need(`humerus-${s}`, `hip-bone-${s}`) || !['t7', 't9', 't11', 'l2', 'l4'].every((c) => ctx.has(c))) continue;
    const hum = bbox(`humerus-${s}`);
    const ins = [sx(s) * (Math.abs(ctx.centroid(`humerus-${s}`)[0]) - 0.012), hum[1][1] - 0.075, hum[1][2] - 0.015];
    const crestPost = ex(`hip-bone-${s}`, 1, 1, (p) => p[2] < ctx.centroid(`hip-bone-${s}`)[2]);
    const origins = ['t7', 't8', 't9', 't10', 't11', 't12', 'l1', 'l2', 'l3', 'l4', 'l5'].filter((c) => ctx.has(c)).map((c) => {
      const [lo, hi] = bbox(c);
      return [0.012 * sx(s), (lo[1] + hi[1]) / 2, lo[2] + 0.012];
    });
    origins.push([sx(s) * 0.045, crestPost[1] - 0.01, crestPost[2] + 0.01]);
    const grid = origins.map((o, k) => {
      const f = k / (origins.length - 1);
      const t = torso(o[1]);
      const iv = [ins[0], ins[1] - 0.012 + 0.024 * f, ins[2] - 0.006 + 0.012 * f]; // narrows to a tendon at the humerus
      // wrap the posterolateral rib cage: through a point 60 % of the way around, then up to the axilla
      const rise = Math.max(0.02, iv[1] - o[1]);
      const mid = [sx(s) * t.a * 0.78, o[1] + rise * 0.35, t.zc - t.b * 0.6];
      const side = [sx(s) * (t.a + 0.012), o[1] + rise * 0.85, t.zc - t.b * 0.05];
      return [o, lerp(o, mid, 0.5), mid, lerp(mid, side, 0.5), side, lerp(side, iv, 0.5), iv];
    });
    const transposed = grid; // [origin strip][station]
    add3('latissimus-dorsi', 'Latissimus Dorsi', s, transposed, 0.013, (p) => { const t = torso(clamp(p[1], 0.95, 1.4)); return norm([p[0] / t.a, 0.0, (p[2] - t.zc) / t.b]); }, 'Shoulder');
  }

  // ---- masseter and temporalis ---------------------------------------------------------------------
  for (const s of sides) {
    const zyg = `skull-zygomatic-${s}`;
    if (!need(zyg, 'mandible')) continue;
    const skull = ['skull-temporal', 'skull-parietal', 'skull-frontal', 'skull-sphenoid'].map((k) => (k === 'skull-frontal' || k === 'skull-sphenoid' ? k : `${k}-${s}`)).filter((i) => ctx.has(i));
    const mb = bbox('mandible');
    const angle = ex('mandible', (p) => -(p[1] + 0.9 * p[2]), 1, (p) => sx(s) * p[0] > 0.03) ?? [sx(s) * 0.05, mb[0][1], mb[0][2]];
    const cor = ex('mandible', 1, 1, (p) => sx(s) * p[0] > 0.02) ?? [sx(s) * 0.045, mb[1][1], (mb[0][2] + mb[1][2]) / 2];
    // masseter: zygomatic arch -> outer surface of the ramus and angle
    const zb = bbox(zyg);
    const arch0 = [sx(s) * (Math.abs(zb[0][0] + zb[1][0]) / 2 + 0.005), zb[0][1] + 0.004, zb[1][2] - 0.01];
    const arch1 = [arch0[0] - sx(s) * 0.004, arch0[1] + 0.004, arch0[2] - 0.06];
    const grid = [0, 1, 2, 3].map((u) => {
      const f = u / 3;
      const o = lerp(arch0, arch1, f);
      const i = [angle[0] + sx(s) * 0.008, angle[1] + 0.01 + 0.032 * f, angle[2] + 0.008 + 0.03 * f];
      const bulge = (t) => [sx(s) * 0.009 * Math.sin(Math.PI * t), 0, 0];
      return [o, add(lerp(o, i, 0.33), bulge(0.33)), add(lerp(o, i, 0.66), bulge(0.66)), i];
    });
    add3('masseter', 'Masseter', s, grid, 0.012, (p) => [sx(s), 0, 0], 'Mastication');
    // temporalis: fan on the temporal fossa -> coronoid process
    if (skull.length) {
      const grid2 = [0, 1, 2, 3, 4].map((u) => {
        const f = u / 4 - 0.5;
        const target = [sx(s) * 0.082, cor[1] + 0.045 + 0.012 * Math.abs(f), cor[2] + f * 0.07];
        const o = nearest(skull, target);
        const i = [cor[0] + sx(s) * 0.004, cor[1] - 0.006 * Math.abs(f), cor[2] + f * 0.012];
        const bulge = (t) => [sx(s) * 0.007 * Math.sin(Math.PI * t), 0, 0];
        return [o, add(lerp(o, i, 0.35), bulge(0.35)), add(lerp(o, i, 0.7), bulge(0.7)), i];
      });
      add3('temporalis', 'Temporalis', s, grid2, 0.009, () => [sx(s), 0.3, 0], 'Mastication');
    }
  }
  return defs;
}
