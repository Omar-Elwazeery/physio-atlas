// Measures how well the muscles sit on the skeleton, before (BodyParts3D muscles on BodyParts3D bones, from the
// stage-1 build in .cache/build/bp3d) and after (the shipped muscles on the shipped bones).
// Run: npx tsx scripts/muscle-fit-report.ts [beforeDir] [afterDir] [out.json]
//  - penetration: share of a muscle's surface area whose triangle centres lie inside a bone by more than 2 mm
//    (deep) or 0.5 mm (shallow); ray-parity inside test, exact point-triangle depth.
//  - attachment ends: the two vertices the viewer's strain read-out uses (extremes of the skin axis), and their
//    distance to the surface of the bones carried by the rig node each end is bound to.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
// @ts-expect-error draco3dgltf ships no types
import draco3d from 'draco3dgltf';
import * as THREE from 'three';
import { TriGrid, bbox } from './lib/mesh';
import { Rig } from '../app/lib/rig/rig';
import { resolveSkin, skinStructure } from '../app/lib/rig/skinning';
import { BoneProximity } from '../app/lib/rig/proximity';
import { hasMuscleInfo, muscleInfo } from '../app/lib/data/muscles';
import type { Structure } from '../app/lib/types';

const [beforeDir = '.cache/build/bp3d', afterDir = 'public/models', outFile = '.cache/phase1/muscle-fit.json'] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });

interface Geo { pos: Float32Array; idx: Uint32Array }
async function load(dir: string) {
  const list: Structure[] = JSON.parse(readFileSync(join(dir, 'structures.json'), 'utf8'));
  const geo = new Map<string, Geo[]>();
  for (const f of ['skeleton.glb', 'muscles.glb']) {
    const doc = await io.read(resolve(dir, f));
    for (const node of doc.getRoot().listScenes()[0].listChildren()) {
      const id = (node.getExtras() as { id?: string }).id;
      if (!id) continue;
      geo.set(id, node.listChildren().flatMap((c) => c.getMesh()?.listPrimitives() ?? []).map((p) => ({ pos: new Float32Array(p.getAttribute('POSITION')!.getArray()!), idx: new Uint32Array(p.getIndices()!.getArray()!) })));
    }
  }
  return { list, byId: new Map(list.map((s) => [s.id, s])), geo };
}

function measure(m: Awaited<ReturnType<typeof load>>) {
  const rig = new Rig(m.byId);
  const grids = new Map<string, TriGrid>();
  for (const s of m.list) if (s.kind === 'bone') {
    const parts = m.geo.get(s.id)!;
    let off = 0;
    const pos = new Float32Array(parts.reduce((a, p) => a + p.pos.length, 0));
    const idx = new Uint32Array(parts.reduce((a, p) => a + p.idx.length, 0));
    let o = 0, oi = 0;
    for (const p of parts) { pos.set(p.pos, o); for (let i = 0; i < p.idx.length; i++) idx[oi++] = p.idx[i] + off; o += p.pos.length; off += p.pos.length / 3; }
    grids.set(s.id, new TriGrid(pos, idx, 0.008));
  }
  const bones = [...grids.entries()];
  const prox = new BoneProximity((node) => rig.nodes.get(rig.bones[node].name)!.carries.flatMap((id) => (m.geo.get(id) ?? []).map((g) => g.pos)));
  const out: Record<string, { area: number; deep: number; shallow: number; ends?: [number, number] }> = {};
  for (const s of m.list) {
    if (s.kind !== 'muscle') continue;
    const parts = m.geo.get(s.id)!;
    let A = 0, deep = 0, shallow = 0;
    for (const g of parts) {
      const [lo, hi] = bbox([g.pos]);
      const near = bones.filter(([, b]) => !(b.lo[0] > hi[0] || b.hi[0] < lo[0] || b.lo[1] > hi[1] || b.hi[1] < lo[1] || b.lo[2] > hi[2] || b.hi[2] < lo[2]));
      const P = g.pos;
      for (let t = 0; t < g.idx.length; t += 3) {
        const a = g.idx[t] * 3, b = g.idx[t + 1] * 3, c = g.idx[t + 2] * 3;
        const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
        const ar = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
        A += ar;
        const x = (P[a] + P[b] + P[c]) / 3, y = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, z = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
        for (const [, bg] of near) {
          if (!bg.inside(x, y, z)) continue;
          const d = bg.distance(x, y, z, 0.01);
          if (d > 0.0005) shallow += ar;
          if (d > 0.002) deep += ar;
          break;
        }
      }
    }
    const r: (typeof out)[string] = { area: A, deep: deep / A, shallow: shallow / A };
    // attachment ends, as the viewer picks them (skinStructure: the whole structure for O3D muscles, else the
    // largest part with ends)
    const spec = resolveSkin(s, rig, hasMuscleInfo(s.key) ? muscleInfo(s.key) : undefined);
    const geoms = parts.map((g) => { const geom = new THREE.BufferGeometry(); geom.setAttribute('position', new THREE.BufferAttribute(g.pos, 3)); return geom; });
    const res = skinStructure(s, geoms, spec, rig, prox);
    if (res.ends && res.endBones) {
      r.ends = res.ends.map((e, k) => {
        const node = rig.nodes.get(rig.bones[res.endBones![k]].name)!;
        const g = parts[e.part];
        let d = Infinity;
        for (const id of node.carries) { const bg = grids.get(id); if (bg) d = Math.min(d, bg.distance(g.pos[e.v * 3], g.pos[e.v * 3 + 1], g.pos[e.v * 3 + 2], 0.12)); }
        return d;
      }) as [number, number];
    }
    out[s.id] = r;
  }
  return out;
}

const before = measure(await load(beforeDir));
const after = measure(await load(afterDir));
const ids = Object.keys(after).filter((id) => before[id]);
const pct = (x: number) => (100 * x).toFixed(1);
const mm = (x: number) => (Number.isFinite(x) ? (1000 * x).toFixed(1) : 'inf');
const sum = (o: typeof before, k: 'deep' | 'shallow') => { let a = 0, t = 0; for (const id of ids) { a += o[id][k] * o[id].area; t += o[id].area; } return a / t; };
const endsOf = (o: typeof before) => ids.flatMap((id) => o[id].ends ?? []).filter(Number.isFinite).sort((a, b) => a - b);
const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
const eb = endsOf(before), ea = endsOf(after);
const lines: string[] = [];
lines.push(`muscles compared: ${ids.length}`);
lines.push(`surface inside bone >2 mm (area-weighted, all muscles): before ${pct(sum(before, 'deep'))} %, after ${pct(sum(after, 'deep'))} %`);
lines.push(`surface inside bone >0.5 mm: before ${pct(sum(before, 'shallow'))} %, after ${pct(sum(after, 'shallow'))} %`);
lines.push(`attachment end to bone surface (mm): before median ${mm(q(eb, 0.5))}, p90 ${mm(q(eb, 0.9))}, max ${mm(eb[eb.length - 1])} | after median ${mm(q(ea, 0.5))}, p90 ${mm(q(ea, 0.9))}, max ${mm(ea[ea.length - 1])}`);
const worseDeep = ids.filter((id) => after[id].deep - before[id].deep > 0.02).sort((a, b) => (after[b].deep - before[b].deep) - (after[a].deep - before[a].deep));
lines.push(`muscles with >2 points more deep penetration (${worseDeep.length}): ${worseDeep.map((id) => `${id} ${pct(before[id].deep)}->${pct(after[id].deep)}`).join(', ')}`);
const betterDeep = ids.filter((id) => before[id].deep - after[id].deep > 0.02);
lines.push(`muscles with >2 points less deep penetration (${betterDeep.length}): ${betterDeep.map((id) => `${id} ${pct(before[id].deep)}->${pct(after[id].deep)}`).join(', ')}`);
// Ends that touched a bone before (within 10 mm): did any move more than 3 mm further away?
const pairs = ids.flatMap((id) => (before[id].ends && after[id].ends ? [0, 1].map((k) => ({ id, k, b: before[id].ends![k], a: after[id].ends![k] })) : []))
  .filter((e) => e.b < 0.01);
const near = (arr: number[]) => arr.sort((x, y) => x - y);
const nb = near(pairs.map((e) => e.b)), na = near(pairs.map((e) => e.a));
lines.push(`attachment ends within 10 mm of bone before (${pairs.length}): before median ${mm(q(nb, 0.5))}, p90 ${mm(q(nb, 0.9))} | after median ${mm(q(na, 0.5))}, p90 ${mm(q(na, 0.9))}, max ${mm(na[na.length - 1])}`);
const worseEnd = pairs.filter((e) => e.a - e.b > 0.003).sort((x, y) => (y.a - y.b) - (x.a - x.b));
lines.push(`of those, moved >3 mm further from bone (${worseEnd.length}): ${worseEnd.map((e) => `${e.id}[${e.k ? 'insertion' : 'origin'}] ${mm(e.b)}->${mm(e.a)}`).join(', ')}`);
console.log(lines.join('\n'));
writeFileSync(outFile, JSON.stringify({ summary: lines, before, after }, null, 1));
