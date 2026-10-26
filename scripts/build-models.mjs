// Builds public/models/{skeleton,muscles}.glb + structures.json from the BodyParts3D cache.
// Usage: npm run models   (expects .cache/bp3d/ from the downloader, see README)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptSimplifier } from 'meshoptimizer';
import { classifyBone, classifyMuscle, stripSide, sideOf } from './catalog.mjs';
import { makeSchematic } from './schematic.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'bp3d');
const OBJ_DIR = join(CACHE, 'extract', 'isa_BP3D_4.0_obj_99');
const OUT = join(ROOT, 'public', 'models');
mkdirSync(OUT, { recursive: true });

const have = new Set(readdirSync(OBJ_DIR).filter((f) => f.endsWith('.obj')).map((f) => f.slice(0, -4)));

// ---- 1. element -> most specific concept name -------------------------------------------
const rows = readFileSync(join(CACHE, 'isa_element_parts.txt'), 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split('\t'));
const concept = new Map(); // id -> {name, els:Set}
for (const [c, name, el] of rows) {
  if (!have.has(el)) continue;
  if (!concept.has(c)) concept.set(c, { name, els: new Set() });
  concept.get(c).els.add(el);
}
const GENERIC = /\b(organ|entity|region)\b/;
const best = new Map(); // el -> [generic, size, nameLen, name]; lowest tuple wins
const lower = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
for (const { name, els } of concept.values()) {
  const key = [GENERIC.test(name) ? 1 : 0, els.size, name.length, name];
  for (const el of els) {
    const cur = best.get(el);
    if (!cur || lower(key, cur)) best.set(el, key);
  }
}
const unionOf = (names) => {
  const s = new Set();
  for (const { name, els } of concept.values()) if (names.includes(name)) for (const e of els) s.add(e);
  return s;
};
const MUSCLE_ELS = unionOf([
  'muscle organ', 'zone of muscle organ', 'head of muscle organ', 'subdivision of muscle layer', 'muscle of trunk',
  'muscle of upper limb', 'muscle of lower limb', 'muscle of neck', 'muscle of head', 'muscle of thorax',
  'muscle of abdomen', 'muscle of pelvis', 'muscle of face',
]);

// Muscles that BodyParts3D files under concepts outside the unions above (parts of trapezius, small "set of" groups).
const EXTRA_MUSCLE = /trapezius|^set of (levatores|dorsal interossei|palmar interossei|lumbricals|anterior cervical|posterior cervical|interspinales)/;

// BodyParts3D occasionally files a mirrored mesh under the wrong side (e.g. the superficial head of flexor pollicis
// brevis). The geometry is the truth: a left structure must sit at +x, a right one at -x.
const xCache = new Map();
function centroidX(el) {
  if (xCache.has(el)) return xCache.get(el);
  let sum = 0, n = 0;
  for (const line of readFileSync(join(OBJ_DIR, `${el}.obj`), 'utf8').split('\n')) {
    if (line.charCodeAt(0) === 118 && line.charCodeAt(1) === 32) { sum += +line.split(/\s+/)[1]; n++; }
  }
  const cx = n ? sum / n : 0;
  xCache.set(el, cx);
  return cx;
}
const flipped = [];
function verifiedSide(el, side) {
  if (side === 'm') return side;
  const cx = centroidX(el);
  if (Math.abs(cx) < 8) return side; // too close to the midline to judge
  const real = cx > 0 ? 'l' : 'r';
  if (real !== side) flipped.push(el);
  return real;
}

// ---- 2. classify -------------------------------------------------------------------------
/** structures: id -> {id,key,kind,side,label,parts:Map(partKey -> {label, els[]})} */
const structures = new Map();
const skipped = [];
for (const [el, [, , , name]] of best) {
  const base = stripSide(name);
  const side = verifiedSide(el, sideOf(name));
  let cls = classifyBone(base);
  if (!cls && (MUSCLE_ELS.has(el) || EXTRA_MUSCLE.test(base))) cls = classifyMuscle(base);
  if (!cls) continue;
  const id = side === 'm' ? cls.key : `${cls.key}-${side}`;
  if (!structures.has(id)) structures.set(id, { id, key: cls.key, kind: cls.kind, side, label: cls.label, group: cls.group ?? null, parts: new Map() });
  const s = structures.get(id);
  const pk = cls.partKey ?? 'main';
  if (!s.parts.has(pk)) s.parts.set(pk, { label: cls.part ?? cls.label, els: [] });
  s.parts.get(pk).els.push(el);
}
if (flipped.length) console.log(`corrected side from geometry for ${flipped.length} elements`);
console.log('structures', structures.size, [...new Set([...structures.values()].map((s) => s.kind))].map((k) => `${k}:${[...structures.values()].filter((s) => s.kind === k).length}`).join(' '));

// ---- 3. geometry --------------------------------------------------------------------------
function readObj(el) {
  const pos = [];
  const idx = [];
  for (const line of readFileSync(join(OBJ_DIR, `${el}.obj`), 'utf8').split('\n')) {
    if (line.charCodeAt(0) === 118 && line.charCodeAt(1) === 32) { // "v "
      const p = line.split(/\s+/);
      // BodyParts3D: mm, z up, anterior = -y.  Output: metres, y up, anterior = +z, left = +x.
      pos.push(+p[1] * 0.001, +p[3] * 0.001, -p[2] * 0.001);
    } else if (line.charCodeAt(0) === 102) { // "f"
      const p = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10) - 1);
      for (let i = 1; i + 1 < p.length; i++) idx.push(p[0], p[i], p[i + 1]);
    }
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

await MeshoptSimplifier.ready;
function simplify(pos, idx, ratio) {
  const tris = idx.length / 3;
  if (tris < 400 || ratio >= 1) return { pos, idx };
  const target = Math.max(300 * 3, Math.floor((idx.length * ratio) / 3) * 3);
  const [out] = MeshoptSimplifier.simplify(idx, pos, 3, target, 0.01, []);
  // compact vertices
  const remap = new Map();
  const np = [];
  const ni = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    let r = remap.get(v);
    if (r === undefined) { r = np.length / 3; remap.set(v, r); np.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
    ni[i] = r;
  }
  return { pos: new Float32Array(np), idx: ni };
}

const RATIO = { muscle: 0.5, bone: 0.4, disc: 0.5, cartilage: 0.5 };

const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

/**
 * Joint landmarks from the geometry itself: the vertex centroid of the end slice on every axis
 * (x0/x1, y0/y1, z0/z1 = lowest/highest end, 5 % of the extent) plus wider 12 % slices on y, and the
 * overall vertex centroid `c`. The rig derives pivots (femoral head, trochlea, radial head...) from these.
 */
function landmarks(arrays, min, max) {
  const acc = {};
  const add = (name, v) => { const a = (acc[name] ??= [0, 0, 0, 0]); a[0] += v[0]; a[1] += v[1]; a[2] += v[2]; a[3]++; };
  const ext = [0, 1, 2].map((k) => max[k] - min[k]);
  for (const pos of arrays) {
    for (let i = 0; i < pos.length; i += 3) {
      const v = [pos[i], pos[i + 1], pos[i + 2]];
      add('c', v);
      for (let k = 0; k < 3; k++) {
        const n = 'xyz'[k];
        if (v[k] <= min[k] + 0.05 * ext[k]) add(`${n}0`, v);
        if (v[k] >= max[k] - 0.05 * ext[k]) add(`${n}1`, v);
      }
      if (v[1] <= min[1] + 0.12 * ext[1]) add('y0w', v);
      if (v[1] >= max[1] - 0.12 * ext[1]) add('y1w', v);
    }
  }
  const out = {};
  for (const [k, a] of Object.entries(acc)) out[k] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]].map((x) => +x.toFixed(4));
  return out;
}

function buildDoc(kinds, label) {
  const doc = new Document();
  doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({
    method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER, encodeSpeed: 5, decodeSpeed: 5, quantizePosition: 14,
  });
  const buffer = doc.createBuffer();
  const mat = doc.createMaterial('base').setBaseColorFactor([0.85, 0.8, 0.75, 1]).setRoughnessFactor(0.7).setMetallicFactor(0);
  const scene = doc.createScene(label);
  const manifest = [];
  let tris = 0;
  for (const s of [...structures.values()].filter((x) => kinds.includes(x.kind)).sort((a, b) => a.id.localeCompare(b.id))) {
    const node = doc.createNode(s.id).setExtras({ id: s.id, kind: s.kind });
    scene.addChild(node);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const parts = [];
    const allPos = [];
    for (const [pk, part] of s.parts) {
      const P = [];
      const I = [];
      let off = 0;
      if (part.geom) { // generated geometry (schematic muscles): no simplification
        P.push(part.geom.pos);
        I.push(part.geom.idx);
      } else {
        for (const el of part.els) {
          const g = simplify(...Object.values(readObj(el)), RATIO[s.kind]);
          P.push(g.pos);
          I.push(g.idx.map((i) => i + off));
          off += g.pos.length / 3;
        }
      }
      const pos = new Float32Array(P.reduce((a, b) => a + b.length, 0));
      let o = 0;
      for (const p of P) { pos.set(p, o); o += p.length; }
      const idx = new Uint32Array(I.reduce((a, b) => a + b.length, 0));
      o = 0;
      for (const i of I) { idx.set(i, o); o += i.length; }
      for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
      allPos.push(pos);
      const acc = doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer);
      const iacc = doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer);
      const prim = doc.createPrimitive().setAttribute('POSITION', acc).setIndices(iacc).setMaterial(mat);
      const mesh = doc.createMesh(`${s.id}:${pk}`).addPrimitive(prim);
      node.addChild(doc.createNode(`${s.id}:${pk}`).setMesh(mesh).setExtras({ part: pk }));
      parts.push({ key: pk, label: part.label, tris: idx.length / 3 });
      tris += idx.length / 3;
    }
    manifest.push({
      id: s.id, key: s.key, kind: s.kind, side: s.side, label: s.label, group: s.group, parts, ...(s.schematic ? { schematic: true } : {}),
      bbox: [min.map((v) => +v.toFixed(4)), max.map((v) => +v.toFixed(4))],
      lm: landmarks(allPos, min, max),
    });
  }
  return { doc, manifest, tris };
}

// ---- 4. schematic muscles for structures BodyParts3D lacks ---------------------------------------------
const vertCache = new Map();
const schematicCtx = {
  has: (id) => structures.has(id),
  verts(id) {
    if (vertCache.has(id)) return vertCache.get(id);
    const s = structures.get(id);
    let out = null;
    if (s) {
      const arrs = [];
      for (const part of s.parts.values()) for (const el of part.els ?? []) arrs.push(readObj(el).pos);
      out = new Float32Array(arrs.reduce((a, b) => a + b.length, 0));
      let o = 0;
      for (const a of arrs) { out.set(a, o); o += a.length; }
    }
    vertCache.set(id, out);
    return out;
  },
  centroid(id) {
    const v = this.verts(id);
    const c = [0, 0, 0];
    for (let i = 0; i < v.length; i += 3) { c[0] += v[i]; c[1] += v[i + 1]; c[2] += v[i + 2]; }
    return c.map((x) => x / (v.length / 3));
  },
};
for (const d of makeSchematic(schematicCtx)) {
  if (structures.has(d.id)) continue; // never shadow real data
  structures.set(d.id, {
    id: d.id, key: d.key, kind: 'muscle', side: d.side, label: d.label, group: d.group, schematic: true,
    parts: new Map(d.parts.map((p) => [p.key, { label: p.label, geom: p.geom }])),
  });
}
console.log('schematic:', [...structures.values()].filter((s) => s.schematic).map((s) => s.id).join(' '));

const sk = buildDoc(['bone', 'disc', 'cartilage'], 'skeleton');
const mu = buildDoc(['muscle'], 'muscles');
await io.write(join(OUT, 'skeleton.glb'), sk.doc);
await io.write(join(OUT, 'muscles.glb'), mu.doc);
writeFileSync(join(OUT, 'structures.json'), JSON.stringify([...sk.manifest, ...mu.manifest]));
console.log(`skeleton: ${sk.manifest.length} structures, ${sk.tris} tris, ${(statSync(join(OUT, 'skeleton.glb')).size / 1e6).toFixed(1)} MB`);
console.log(`muscles:  ${mu.manifest.length} structures, ${mu.tris} tris, ${(statSync(join(OUT, 'muscles.glb')).size / 1e6).toFixed(1)} MB`);

// Draco decoder for the browser (three's GLTFLoader).
const dracoSrc = join(ROOT, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf');
const dracoDst = join(ROOT, 'public', 'draco');
mkdirSync(dracoDst, { recursive: true });
for (const f of readdirSync(dracoSrc)) copyFileSync(join(dracoSrc, f), join(dracoDst, f));
