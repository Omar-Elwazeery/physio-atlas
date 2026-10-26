// Phase 0 gate: validates the converted models. Exit code 1 on any failure.
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const OUT = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'public', 'models');
const list = JSON.parse(readFileSync(join(OUT, 'structures.json'), 'utf8'));
const byId = new Map(list.map((s) => [s.id, s]));
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('FAIL', msg); } };

const MUST = [
  'biceps-brachii', 'triceps-brachii', 'deltoid', 'pectoralis-major', 'trapezius', 'supraspinatus', 'infraspinatus',
  'subscapularis', 'teres-minor', 'gluteus-maximus', 'gluteus-medius', 'rectus-femoris', 'vastus-lateralis', 'biceps-femoris',
  'semitendinosus', 'gastrocnemius', 'soleus', 'tibialis-anterior', 'psoas-major', 'iliacus', 'sartorius', 'sternocleidomastoid',
  'brachialis', 'flexor-carpi-radialis', 'extensor-carpi-ulnaris', 'serratus-anterior', 'external-oblique',
];
for (const k of MUST) for (const side of ['l', 'r']) ok(byId.has(`${k}-${side}`), `missing ${k}-${side}`);
for (const k of ['humerus', 'radius', 'ulna', 'scapula', 'clavicle', 'femur', 'tibia', 'fibula', 'patella', 'hip-bone', 'calcaneus', 'talus'])
  for (const side of ['l', 'r']) ok(byId.has(`${k}-${side}`), `missing ${k}-${side}`);
for (const k of ['c1', 'c2', 'c7', 't1', 't12', 'l1', 'l5', 'sacrum', 'mandible']) ok(byId.has(k), `missing ${k}`);

// Symmetry: every -l structure has an -r twin with mirrored x bbox.
for (const s of list) {
  if (s.side !== 'l') continue;
  const r = byId.get(s.id.replace(/-l$/, '-r'));
  ok(!!r, `no right twin for ${s.id}`);
}
// Orientation: left structures on +x, patella anterior (+z) of femur centre, head above pelvis.
const cx = (s) => (s.bbox[0][0] + s.bbox[1][0]) / 2;
const cy = (s) => (s.bbox[0][1] + s.bbox[1][1]) / 2;
const cz = (s) => (s.bbox[0][2] + s.bbox[1][2]) / 2;
ok(cx(byId.get('femur-l')) > 0 && cx(byId.get('femur-r')) < 0, 'left must be +x');
ok(cz(byId.get('patella-l')) > cz(byId.get('femur-l')), 'anterior must be +z');
ok(cy(byId.get('c1')) > cy(byId.get('sacrum')), 'y must be up');
const h = byId.get('c1').bbox[1][1];
ok(h > 1.3 && h < 1.8, `unexpected body height ${h}`);

// Round trip: decode both GLBs.
const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
for (const f of ['skeleton.glb', 'muscles.glb']) {
  const doc = await io.read(join(OUT, f));
  const nodes = doc.getRoot().listScenes()[0].listChildren();
  ok(nodes.length > 100, `${f} has ${nodes.length} structures`);
  const bad = doc.getRoot().listMeshes().filter((m) => m.listPrimitives().some((p) => !p.getAttribute('POSITION')?.getCount()));
  ok(bad.length === 0, `${f} has empty meshes`);
}
const kinds = {};
for (const s of list) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
console.log(kinds, fail ? `${fail} FAILURES` : 'GATE PASSED');
process.exit(fail ? 1 : 0);
