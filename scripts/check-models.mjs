// Gate for the converted models (npm run check). Exit code 1 on any failure.
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

// MODELS_DIR=<dir> checks a build written elsewhere (MODELS_OUT of the model build).
const OUT = process.env.MODELS_DIR ? resolve(process.env.MODELS_DIR) : join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'public', 'models');
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
for (const k of ['c1', 'c2', 'c7', 't1', 't12', 'l1', 'l5', 'sacrum', 'coccyx', 'mandible', 'hyoid', 'teeth-upper', 'teeth-lower', 'interpubic-disc']) ok(byId.has(k), `missing ${k}`);
// Joint surfaces (Open 3D Model): the clinically central ones must be there, on both sides.
for (const k of ['medial-meniscus', 'lateral-meniscus', 'glenoid-labrum', 'acetabular-labrum', 'triangular-fibrocartilage', 'acromioclavicular-disc',
  'sternoclavicular-disc', 'cartilage-humeral-head', 'cartilage-glenoid', 'cartilage-femoral-head', 'cartilage-acetabulum', 'cartilage-distal-femur',
  'cartilage-tibial-plateau', 'cartilage-patella', 'cartilage-talus', 'cartilage-distal-humerus', 'cartilage-radial-head', 'sesamoid-hand'])
  for (const side of ['l', 'r']) ok(byId.has(`${k}-${side}`), `missing ${k}-${side}`);
for (const side of ['l', 'r']) ok(byId.get(`medial-meniscus-${side}`)?.parts.length === 3, `medial meniscus ${side} should have body + two horns`);
// One intervertebral disc per level C2-C3 ... L5-S1, each with an annulus; costal cartilage 1-12.
ok(list.filter((s) => s.kind === 'disc').length === 23, 'expected 23 intervertebral discs');
for (const s of list.filter((x) => x.kind === 'disc')) ok(s.parts.some((p) => p.key === 'annulus'), `${s.id} has no annulus`);
for (let n = 1; n <= 12; n++) for (const side of ['l', 'r']) ok(byId.has(`costal-cartilage-${n}-${side}`), `missing costal-cartilage-${n}-${side}`);
// Every joint surface is fixed to existing bones; the rig carries those.
for (const s of list.filter((x) => x.kind === 'articular' || x.kind === 'fibrocartilage')) {
  ok(Array.isArray(s.attach) && s.attach.length > 0, `${s.id} has no attach`);
  for (const b of s.attach ?? []) ok(byId.get(b)?.kind === 'bone', `${s.id} attached to unknown bone ${b}`);
}
// Mirroring: an Open 3D Model left structure is the exact mirror of its right twin.
for (const s of list) {
  if (s.side !== 'l' || s.source !== 'o3d' || s.key === 'skull-parietal') continue; // O3D models both parietal bones
  const r = byId.get(s.id.replace(/-l$/, '-r'));
  if (!r) continue;
  const d = Math.max(Math.abs(s.bbox[0][0] + r.bbox[1][0]), Math.abs(s.bbox[1][0] + r.bbox[0][0]), ...[1, 2].flatMap((k) => [Math.abs(s.bbox[0][k] - r.bbox[0][k]), Math.abs(s.bbox[1][k] - r.bbox[1][k])]));
  ok(d < 0.0005, `${s.id} is not the mirror image of ${r.id} (bbox off by ${(d * 1000).toFixed(1)} mm)`);
}
// The body stands on y = 0.
const footMin = Math.min(...list.filter((s) => s.kind === 'bone' && /^(calcaneus|metatarsal|hallux|toe|sesamoid-foot)/.test(s.key)).map((s) => s.bbox[0][1]));
ok(Math.abs(footMin) < 0.001, `lowest foot point should be y = 0, is ${footMin}`);

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
const io = new NodeIO().registerExtensions([KHRDracoMeshCompression, EXTTextureWebP]).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const idsInFiles = new Set();
for (const f of ['skeleton.glb', 'joints.glb', 'muscles.glb', 'ligaments.glb']) {
  const doc = await io.read(join(OUT, f));
  const nodes = doc.getRoot().listScenes()[0].listChildren();
  ok(nodes.length > 100, `${f} has ${nodes.length} structures`);
  for (const n of nodes) idsInFiles.add(n.getExtras().id);
  if (f === 'skeleton.glb') {
    const tex = doc.getRoot().listTextures().length;
    ok(tex > 100, `skeleton.glb should carry the bone normal maps, has ${tex} textures`);
  }
  const bad = doc.getRoot().listMeshes().filter((m) => m.listPrimitives().some((p) => !p.getAttribute('POSITION')?.getCount()));
  ok(bad.length === 0, `${f} has empty meshes`);
}
ok(list.every((s) => idsInFiles.has(s.id)), 'manifest lists structures that no GLB contains');

// ---- muscles (phase 2: Open 3D Model limb muscles, BodyParts3D trunk/neck/head, schematic) ------------------------
// Every muscle of the app's muscle tables is still in the manifest (ids, URLs, quiz, nerve layer depend on it).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataKeys = ['upper', 'lower', 'trunk'].flatMap((f) => [...readFileSync(join(ROOT, 'app', 'lib', 'data', `muscles-${f}.ts`), 'utf8')
  .matchAll(/^\s+'?([a-z][a-z0-9-]*)'?: \{ group:/gm)].map((m) => m[1]));
ok(dataKeys.length === 170, `expected 170 muscles in the muscle tables, found ${dataKeys.length}`);
const muscleList = list.filter((s) => s.kind === 'muscle');
for (const k of dataKeys) {
  const ids = muscleList.filter((s) => s.key === k);
  ok(ids.length > 0 && ids.every((s) => s.side === 'm') === (ids.length === 1), `muscle ${k}: expected one midline or a left/right pair, found ${ids.map((s) => s.id).join(', ') || 'none'}`);
}
ok(muscleList.length === 326, `expected 326 muscle structures, found ${muscleList.length}`);
// Source per muscle: recorded, and the split the build promises.
for (const s of muscleList) ok(s.source === 'o3d' || s.source === 'bp3d', `${s.id} has no source`);
const o3dMuscles = muscleList.filter((s) => s.source === 'o3d');
for (const k of ['biceps-brachii', 'triceps-brachii', 'supraspinatus', 'flexor-digitorum-profundus', 'gluteus-maximus', 'rectus-femoris', 'gastrocnemius', 'tibialis-anterior', 'first-lumbrical-of-foot'])
  for (const side of ['l', 'r']) ok(byId.get(`${k}-${side}`)?.source === 'o3d', `${k}-${side} should come from Open 3D Model`);
for (const k of ['deltoid', 'pectoralis-major', 'trapezius', 'sternocleidomastoid', 'external-oblique', 'adductor-pollicis', 'adductor-minimus', 'coccygeus'])
  for (const side of ['l', 'r']) ok(byId.get(`${k}-${side}`)?.source === 'bp3d', `${k}-${side} should stay BodyParts3D`);
ok(muscleList.filter((s) => s.schematic).length === 16, 'expected the 8 schematic muscles on both sides');
ok(muscleList.filter((s) => s.schematic).every((s) => s.source === 'bp3d'), 'schematic muscles changed source');
// Part keys the roles table refers to (deltoid/trapezius/pectoralis major parts) are still there.
for (const [k, parts] of [['deltoid', ['clavicular-part', 'acromial-part', 'spinal-part']], ['trapezius', ['descending-part', 'transverse-part', 'ascending-part']], ['pectoralis-major', ['clavicular-part', 'sternocostal-part', 'abdominal-part']]])
  for (const side of ['l', 'r']) for (const p of parts) ok(byId.get(`${k}-${side}`)?.parts.some((x) => x.key === p), `${k}-${side} lost part ${p}`);
const tendonParts = o3dMuscles.flatMap((s) => s.parts.filter((p) => p.tendon));
// 14 per side from phase 2, plus phase 3's lateral bands and juncturae tendinum (extensor digitorum) and the toe
// extensor expansions (extensor digitorum longus, extensor hallucis longus).
ok(tendonParts.length === 36, `expected 18 O3D tendon parts per side, found ${tendonParts.length}`);
ok(muscleList.filter((s) => s.source !== 'o3d').every((s) => s.parts.every((p) => !p.tendon)), 'tendon parts on a non-O3D muscle');
// Textures: every O3D muscle primitive has UVs and a base-colour (fibre) texture; BodyParts3D muscles have neither.
{
  const doc = await io.read(join(OUT, 'muscles.glb'));
  const textures = doc.getRoot().listTextures();
  ok(textures.length >= 4 && textures.length <= 12, `muscles.glb should carry the fibre atlases, has ${textures.length} textures`);
  const imgs = new Set(textures.map((t) => Buffer.from(t.getImage()).toString('base64')));
  ok(imgs.size === textures.length, 'muscles.glb stores the same image more than once');
  let bad = 0;
  const pos = new Map();
  for (const n of doc.getRoot().listScenes()[0].listChildren()) {
    const s = byId.get(n.getExtras().id);
    const prims = n.listChildren().map((c) => c.getMesh().listPrimitives()[0]);
    for (const p of prims) {
      const textured = !!p.getAttribute('TEXCOORD_0') && !!p.getMaterial()?.getBaseColorTexture();
      if (textured !== (s.source === 'o3d')) bad++;
    }
    if (s.source === 'o3d') pos.set(s.id, n.listChildren().map((c) => ({ part: c.getExtras().part, pos: c.getMesh().listPrimitives()[0].getAttribute('POSITION').getArray() })));
  }
  ok(bad === 0, `${bad} muscle primitives with the wrong texturing for their source`);
  // Left = mirror image of right, vertex for vertex (as point sets: Draco may order the vertices differently).
  let worst = 0, pairs = 0;
  for (const [id, partsL] of pos) {
    if (!id.endsWith('-l')) continue;
    const partsR = pos.get(id.replace(/-l$/, '-r'));
    ok(!!partsR && partsR.length === partsL.length, `${id}: right twin missing or with other parts`);
    if (!partsR) continue;
    for (const pl of partsL) {
      const pr = partsR.find((x) => x.part === pl.part);
      ok(!!pr && pr.pos.length === pl.pos.length, `${id}:${pl.part}: right part missing or different size`);
      if (!pr || pr.pos.length !== pl.pos.length) continue;
      const h = 0.002, cells = new Map();
      const key = (x, y, z) => `${Math.floor(x / h)},${Math.floor(y / h)},${Math.floor(z / h)}`;
      for (let i = 0; i < pr.pos.length; i += 3) { const k = key(-pr.pos[i], pr.pos[i + 1], pr.pos[i + 2]); (cells.get(k) ?? cells.set(k, []).get(k)).push(i); }
      for (let i = 0; i < pl.pos.length; i += 3) {
        const [x, y, z] = [pl.pos[i], pl.pos[i + 1], pl.pos[i + 2]];
        let bd = Infinity;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++)
          for (const j of cells.get(key(x + a * h, y + b * h, z + c * h)) ?? []) bd = Math.min(bd, Math.hypot(x + pr.pos[j], y - pr.pos[j + 1], z - pr.pos[j + 2]));
        worst = Math.max(worst, bd);
      }
      pairs++;
    }
  }
  ok(pairs >= 130 && worst < 0.0002, `O3D muscles: left is not the mirror of right (${pairs} part pairs, worst vertex ${(worst * 1000).toFixed(3)} mm)`);
  console.log(`muscles: ${muscleList.length} (${o3dMuscles.length} Open 3D Model, ${muscleList.length - o3dMuscles.length} BodyParts3D incl. ${muscleList.filter((s) => s.schematic).length} schematic), ${tendonParts.length} tendon parts, ${textures.length} textures; mirror check ${pairs} part pairs, worst ${(worst * 1000).toFixed(3)} mm`);
}
// ---- ligaments, capsules, bursae, sheaths, retinacula, fasciae (phase 3, ligaments.glb) ---------------------------
const SOFT = new Set(['ligament', 'capsule', 'bursa', 'sheath', 'retinaculum', 'fascia', 'fatpad']);
const softList = list.filter((s) => SOFT.has(s.kind));
// Key structures per major joint, both sides, with the bones they must be fixed to.
const KEY_SOFT = {
  // shoulder girdle, shoulder
  'coracoacromial-ligament': ['scapula'], 'coracoclavicular-ligament': ['scapula', 'clavicle'], 'coracohumeral-ligament': ['scapula', 'humerus'],
  'superior-glenohumeral-ligament': ['humerus'], 'middle-glenohumeral-ligament': ['humerus'], 'inferior-glenohumeral-ligament': ['scapula', 'humerus'],
  'acromioclavicular-ligament': ['clavicle', 'scapula'], 'costoclavicular-ligament': ['clavicle'], 'glenohumeral-capsule': ['scapula', 'humerus'],
  // elbow, forearm, wrist
  'ulnar-collateral-ligament-of-elbow': ['humerus', 'ulna'], 'radial-collateral-ligament-of-elbow': ['humerus'], 'annular-ligament-of-radius': ['radius', 'ulna'],
  'elbow-capsule': ['humerus', 'ulna', 'radius'], 'interosseous-membrane-of-forearm': ['radius', 'ulna'], 'flexor-retinaculum': [], 'extensor-retinaculum-of-wrist': ['radius'],
  'scapholunate-ligament': ['carpal-scaphoid', 'carpal-lunate'], 'radiocarpal-capsule': ['radius'], 'dorsal-radiocarpal-ligament': ['radius'],
  // hip, pelvis
  'iliofemoral-ligament': ['hip-bone', 'femur'], 'pubofemoral-ligament': ['hip-bone', 'femur'], 'ischiofemoral-ligament': ['hip-bone', 'femur'],
  'ligament-of-head-of-femur': ['femur'], 'hip-capsule': ['hip-bone', 'femur'], 'sacrotuberous-ligament': ['hip-bone'], 'sacrospinous-ligament': ['hip-bone'],
  'iliolumbar-ligament': ['hip-bone'], 'iliotibial-tract': [],
  // knee
  'anterior-cruciate-ligament': ['femur', 'tibia'], 'posterior-cruciate-ligament': ['femur', 'tibia'], 'medial-collateral-ligament': ['femur', 'tibia'],
  'fibular-collateral-ligament': ['femur', 'fibula'], 'knee-capsule': ['femur', 'tibia'], 'posterior-meniscofemoral-ligament': ['femur'],
  'interosseous-membrane-of-leg': ['tibia', 'fibula'], 'infrapatellar-fat-pad': ['patella', 'tibia'],
  // ankle, foot
  'anterior-talofibular-ligament': ['fibula', 'talus'], 'calcaneofibular-ligament': ['fibula', 'calcaneus'], 'posterior-talofibular-ligament': ['fibula', 'talus'],
  'anterior-tibiofibular-ligament': ['tibia', 'fibula'], 'posterior-tibiofibular-ligament': ['tibia', 'fibula'], 'tibiocalcaneal-ligament': ['tibia', 'calcaneus'],
  'tibionavicular-ligament': ['tibia', 'tarsal-navicular'], 'anterior-tibiotalar-ligament': ['tibia', 'talus'], 'posterior-tibiotalar-ligament': ['tibia', 'talus'],
  'ankle-capsule': ['tibia', 'talus'], 'plantar-calcaneonavicular-ligament': ['calcaneus', 'tarsal-navicular'], 'long-plantar-ligament': ['calcaneus'],
  'plantar-aponeurosis': [], 'flexor-retinaculum-of-ankle': [],
};
for (const [k, bones] of Object.entries(KEY_SOFT)) for (const side of ['l', 'r']) {
  const s = byId.get(`${k}-${side}`);
  ok(!!s && SOFT.has(s.kind), `missing soft-tissue structure ${k}-${side}`);
  for (const b of bones) ok(s?.attach?.includes(`${b}-${side}`), `${k}-${side} should be fixed to ${b}-${side} (attach: ${s?.attach?.join(', ')})`);
}
for (const k of ['interclavicular-ligament', 'pubic-ligaments']) ok(byId.get(k)?.side === 'm', `${k} should be one midline structure`);
// Every soft structure: attached to real bones it lies against (bounding boxes within 15 mm), from Open 3D Model.
for (const s of softList) {
  ok(s.source === 'o3d', `${s.id} has no Open 3D Model source`);
  ok(Array.isArray(s.attach) && s.attach.length > 0, `${s.id} has no attach`);
  for (const b of s.attach ?? []) {
    const bs = byId.get(b);
    ok(bs?.kind === 'bone', `${s.id} attached to unknown bone ${b}`);
    if (bs) ok([0, 1, 2].every((k) => bs.bbox[0][k] <= s.bbox[1][k] + 0.015 && bs.bbox[1][k] >= s.bbox[0][k] - 0.015), `${s.id} is attached to ${b}, which is not near it`);
  }
  if (s.kind === 'bursa') ok(s.attach?.length === 1, `${s.id}: a bursa follows one bone`);
}
ok(softList.filter((s) => s.kind === 'ligament').length >= 250, `expected at least 250 ligament structures, found ${softList.filter((s) => s.kind === 'ligament').length}`);
for (const k of ['capsule', 'bursa', 'sheath', 'retinaculum', 'fascia', 'fatpad']) ok(softList.some((s) => s.kind === k), `no ${k} structures`);
{
  const doc = await io.read(join(OUT, 'ligaments.glb'));
  // The tendon and retinaculum atlases are referenced from muscles.glb by name, not stored twice.
  const mdoc = await io.read(join(OUT, 'muscles.glb'));
  const muscleImgs = new Set(mdoc.getRoot().listTextures().map((t) => Buffer.from(t.getImage()).toString('base64')));
  const texs = doc.getRoot().listTextures();
  ok(texs.every((t) => !muscleImgs.has(Buffer.from(t.getImage()).toString('base64'))), 'ligaments.glb stores an image muscles.glb already has');
  ok(new Set(texs.map((t) => Buffer.from(t.getImage()).toString('base64'))).size === texs.length, 'ligaments.glb stores the same image twice');
  const muscleTexNames = new Set(mdoc.getRoot().listTextures().map((t) => t.getName()));
  for (const m of doc.getRoot().listMaterials()) if (m.getExtras().map) ok(muscleTexNames.has(m.getExtras().map), `material ${m.getName()} names a texture muscles.glb lacks: ${m.getExtras().map}`);
  // Baked proximity skins: attributes present, indices inside the structure's node list, weights summing to 1.
  let baked = 0, badW = 0;
  const pos = new Map();
  for (const n of doc.getRoot().listScenes()[0].listChildren()) {
    const s = byId.get(n.getExtras().id);
    const prims = n.listChildren().map((c) => c.getMesh().listPrimitives()[0]);
    if (s?.skin) {
      baked++;
      ok(s.skin.length >= 2, `${s.id}: a baked skin needs two or more rig nodes`);
      for (const p of prims) {
        const J = p.getAttribute('JOINTS_0')?.getArray(), wa = p.getAttribute('WEIGHTS_0'), W = wa?.getArray();
        ok(!!J && !!W, `${s.id}: baked skin without JOINTS_0 / WEIGHTS_0`);
        if (!J || !W) continue;
        // weights are normalised bytes (255ths that add up to exactly 255) or, in older builds, floats
        const unit = wa.getNormalized() ? 255 : 1, tol = wa.getNormalized() ? 0 : 0.01;
        for (let i = 0; i < J.length; i += 4) {
          let sum = 0;
          for (let k = 0; k < 4; k++) { sum += W[i + k]; if (W[i + k] > 0 && J[i + k] >= s.skin.length) badW++; }
          if (Math.abs(sum / unit - 1) > tol) badW++;
        }
      }
    }
    pos.set(s.id, n.listChildren().map((c) => ({ part: c.getExtras().part, pos: c.getMesh().listPrimitives()[0].getAttribute('POSITION').getArray() })));
  }
  ok(badW === 0, `${badW} baked skin vertices with bad weights or indices`);
  for (const k of ['anterior-cruciate-ligament', 'knee-capsule', 'hip-capsule', 'calcaneofibular-ligament', 'glenohumeral-capsule']) ok(!!byId.get(`${k}-l`)?.skin, `${k}-l should have a baked skin across its joint`);
  // Left = mirror of right, vertex for vertex.
  let worst = 0, pairs = 0;
  for (const [id, partsL] of pos) {
    if (!id.endsWith('-l')) continue;
    const partsR = pos.get(id.replace(/-l$/, '-r'));
    ok(!!partsR && partsR.length === partsL.length, `${id}: right twin missing or with other parts`);
    if (!partsR) continue;
    for (const pl of partsL) {
      const pr = partsR.find((x) => x.part === pl.part);
      if (!pr || pr.pos.length !== pl.pos.length) { ok(false, `${id}:${pl.part}: right part missing or different size`); continue; }
      const h = 0.002, cells = new Map();
      const key = (x, y, z) => `${Math.floor(x / h)},${Math.floor(y / h)},${Math.floor(z / h)}`;
      for (let i = 0; i < pr.pos.length; i += 3) { const k = key(-pr.pos[i], pr.pos[i + 1], pr.pos[i + 2]); (cells.get(k) ?? cells.set(k, []).get(k)).push(i); }
      for (let i = 0; i < pl.pos.length; i += 3) {
        const [x, y, z] = [pl.pos[i], pl.pos[i + 1], pl.pos[i + 2]];
        let bd = Infinity;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++)
          for (const j of cells.get(key(x + a * h, y + b * h, z + c * h)) ?? []) bd = Math.min(bd, Math.hypot(x + pr.pos[j], y - pr.pos[j + 1], z - pr.pos[j + 2]));
        worst = Math.max(worst, bd);
      }
      pairs++;
    }
  }
  ok(pairs >= 300 && worst < 0.0002, `soft tissue: left is not the mirror of right (${pairs} part pairs, worst vertex ${(worst * 1000).toFixed(3)} mm)`);
  const by = {};
  for (const s of softList) by[s.kind] = (by[s.kind] ?? 0) + 1;
  console.log(`soft tissue: ${softList.length} structures ${JSON.stringify(by)}, ${baked} with a baked skin, ${texs.length} normal maps; mirror check ${pairs} part pairs, worst ${(worst * 1000).toFixed(3)} mm`);
}
ok(idsInFiles.size === list.length, `GLBs hold ${idsInFiles.size} structures, manifest ${list.length}`);
const kinds = {};
for (const s of list) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
console.log(kinds, fail ? `${fail} FAILURES` : 'GATE PASSED');
process.exit(fail ? 1 : 0);
