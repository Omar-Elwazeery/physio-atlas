// Headless rig check: builds the rig from the real manifest, binds every structure and poses joints.
// Run: npx tsx scripts/check-rig.ts
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Rig } from '../app/lib/rig/rig';
import { resolveSkin } from '../app/lib/rig/skinning';
import { DOFS, dofKey } from '../app/lib/rig/spec';
import { MUSCLE_INFO, hasMuscleInfo, muscleInfo } from '../app/lib/data/muscles';
import { ACTIONS, parseRef } from '../app/lib/data/actions';
import type { Structure } from '../app/lib/types';

const list: Structure[] = JSON.parse(readFileSync('public/models/structures.json', 'utf8'));
const map = new Map(list.map((s) => [s.id, s]));
let fail = 0;
const bad = (m: string) => { fail++; console.log('FAIL', m); };

const rig = new Rig(map);
console.log('rig nodes', rig.nodes.size);

// every bone has a carrier; every structure resolves to a skin
const unc = list.filter((s) => s.kind === 'bone' && !rig.carriedBy.has(s.id)).map((s) => s.id);
if (unc.length) bad(`bones without carrier: ${unc.join(', ')}`);
for (const s of list) {
  try { resolveSkin(s, rig, s.kind === 'muscle' && hasMuscleInfo(s.key) ? muscleInfo(s.key) : undefined); }
  catch (e) { bad(`${s.id}: ${(e as Error).message}`); }
}
// data keys exist in the manifest
const keys = new Set(list.map((s) => s.key));
for (const k of Object.keys(MUSCLE_INFO)) if (!keys.has(k)) bad(`data for unknown muscle ${k}`);
for (const [id, a] of Object.entries(ACTIONS)) for (const r of [...a.prime, ...a.assist, ...(a.stab ?? [])]) {
  const p = parseRef(r);
  if (!keys.has(p.key)) bad(`${id}: unknown muscle ${p.key}`);
  else if (p.part && !list.some((s) => s.key === p.key && s.parts.some((x) => x.key === p.part))) bad(`${id}: unknown part ${r}`);
}
const undocumented = [...new Set(list.filter((s) => s.kind === 'muscle' && !hasMuscleInfo(s.key)).map((s) => s.key))];
console.log('muscles without clinical data:', undocumented.join(' ') || 'none');

// pose each DOF to its extremes: finite matrices, and report where the hand/foot ends up
const world = (id: string) => new THREE.Vector3().setFromMatrixPosition(rig.node(id).bone.matrixWorld);
const tip = (id: string, key: string, l: 'y0' | 'y1' | 'z1' = 'y0') => {
  const s = map.get(id)!; const v = new THREE.Vector3(...s.lm[l]);
  const n = rig.node(rig.carriedBy.get(id)!);
  // bind pose -> posed
  const inv = rig.skeleton.boneInverses[n.index];
  return v.applyMatrix4(inv).applyMatrix4(n.bone.matrixWorld);
};
for (const d of DOFS) for (const side of d.paired ? ['l', 'r'] as const : ['m'] as const) for (const v of [d.min, d.max]) {
  rig.pose({ [dofKey(d, side)]: v });
  for (const n of rig.nodes.values()) if (!n.bone.matrixWorld.elements.every(Number.isFinite)) bad(`NaN at ${dofKey(d, side)}=${v}`);
}
rig.pose({});
const rest = tip('hand-l' in Object.fromEntries([]) ? '' : 'metacarpal-3-l', '', 'y0');
console.log('rest L middle metacarpal distal tip', rest.toArray().map((x) => +x.toFixed(3)));
const check = (name: string, pose: Record<string, number>, id: string, expect: (r: THREE.Vector3, p: THREE.Vector3) => boolean, lm: 'y0' | 'y1' | 'z1' = 'y0') => {
  rig.pose({});
  const r = tip(id, '', lm);
  rig.pose(pose);
  const p = tip(id, '', lm);
  const ok = expect(r, p);
  console.log(ok ? 'ok  ' : 'FAIL', name, 'rest', r.toArray().map((x) => +x.toFixed(2)), '->', p.toArray().map((x) => +x.toFixed(2)));
  if (!ok) fail++;
};
// anterior = +z, left = +x, up = +y
check('L shoulder flexion 90: hand goes forward', { 'shoulder.flexion-extension.l': 90 }, 'metacarpal-3-l', (r, p) => p.z > r.z + 0.3);
check('R shoulder flexion 90: hand goes forward', { 'shoulder.flexion-extension.r': 90 }, 'metacarpal-3-r', (r, p) => p.z > r.z + 0.3);
check('L shoulder abduction 90: hand goes left/out', { 'shoulder.abduction-adduction.l': 90 }, 'metacarpal-3-l', (r, p) => p.x > r.x + 0.3);
check('R shoulder abduction 90: hand goes right/out', { 'shoulder.abduction-adduction.r': 90 }, 'metacarpal-3-r', (r, p) => p.x < r.x - 0.3);
check('L elbow flexion 90: hand goes forward', { 'elbow.flexion-extension.l': 90 }, 'metacarpal-3-l', (r, p) => p.z > r.z + 0.15);
check('L hip flexion 90: foot goes forward', { 'hip.flexion-extension.l': 90 }, 'calcaneus-l', (r, p) => p.z > r.z + 0.3, 'y0');
check('L hip abduction 45: foot goes out', { 'hip.abduction-adduction.l': 45 }, 'calcaneus-l', (r, p) => p.x > r.x + 0.2, 'y0');
check('L knee flexion 90: heel goes back', { 'knee.flexion-extension.l': 90 }, 'calcaneus-l', (r, p) => p.z < r.z - 0.2, 'y0');
check('L ankle dorsiflexion 20: toe tip goes up', { 'ankle.dorsiflexion-plantarflexion.l': 20 }, 'metatarsal-2-l', (r, p) => p.y > r.y + 0.01, 'z1');
check('Lumbar+thoracic+cervical flexion: head goes forward', { 'lumbar.flexion-extension': 50, 'thoracic.flexion-extension': 30, 'cervical.flexion-extension': 40 }, 'skull-frontal', (r, p) => p.z > r.z + 0.2, 'y1');
check('Cervical left lateral flexion: head goes left', { 'cervical.lateral-flexion': 40 }, 'skull-frontal', (r, p) => p.x > r.x + 0.03, 'y1');
check('Wrist flexion 70: finger goes forward', { 'wrist.flexion-extension.l': 70 }, 'middle-distal-l', (r, p) => p.z > r.z + 0.04, 'y0');
check('Index MCP flexion 80: fingertip forward', { 'fingers.mcp.l': 80 }, 'index-distal-l', (r, p) => p.z > r.z + 0.01, 'y0');
check('L shoulder abduction 150 keeps humeral head near origin', { 'shoulder.abduction-adduction.l': 150 }, 'humerus-l', (r, p) => p.distanceTo(r) < 0.9, 'y1');
console.log(fail ? `${fail} FAILURES` : 'RIG CHECK PASSED');
process.exit(fail ? 1 : 0);
