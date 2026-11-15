// Builds the shipped models: Open 3D Model skeleton + joint cartilage, with the BodyParts3D muscles fitted onto it.
// Usage: npm run models   (= npx tsx scripts/build-open3d.ts)
//
// Stage 1 runs scripts/build-models.mjs (BodyParts3D) into .cache/build/bp3d. That build is unchanged and still
// byte-identical to the previous shipped set; here it supplies the muscles, the hyoid and the old bones the muscles
// were modelled around.
// Stage 2 (this file) reads the Open 3D Model GLBs from .cache/open3d/dl/cask/ (SHA-256 checked), cleans and
// classifies the objects, re-keys the bones to the app's existing keys, mirrors the right side to make the left,
// moves everything into the app frame (standing on y = 0), carries every muscle from the old bones onto the new ones,
// regenerates the schematic muscles against the new bones, and writes public/models/{skeleton,joints,muscles}.glb +
// structures.json.
//
// Environment:
//   MODELS_OUT=<dir>   write there instead of public/models (and skip the public/draco copy)
//   SKIP_BP3D=1        reuse .cache/build/bp3d from an earlier run instead of re-running stage 1
//   O3D_DENSITY=k      scale the surface per triangle the stored meshes are thinned to (default 1, see DENSITY; 0
//                      stores the working set: source bones, dense soft tissue)
//   O3D_TEXTURES=0     store the source images as they are (default: at the size the viewer uses, as WebP)
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, type Material, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, KHRDracoMeshCompression } from '@gltf-transform/extensions';
// @ts-expect-error draco3dgltf ships no types
import draco3d from 'draco3dgltf';
import { MeshoptSimplifier } from 'meshoptimizer';
import * as THREE from 'three';
import {
  O3D_FILES, FILE_RENAMES, NEW_BONES, MUSCLE_SKIP, OVERLAY_SKIP, SOFT_SKIP, boneKey, cleanName, costalNumber, digitOf, discKey, flipWinding, geometricSide, jointSpec,
  mirrorPositions, muscleSpec, o3dKind, softSpec, splitJointKey, splitSide, toothPart, type JointSpec, type O3DFile, type O3DKind, type Side,
  type SoftSpec,
} from './lib/open3d';
import {
  IDENTITY, applyAffine, bbox, centroid, components, concat, fitBoneTransform, fitSphere, landmarks, mergeMeshes, PointGrid,
  fitCircleAbout, refineSphere, subMesh, surfacePoints, TriGrid, weldIds, type Affine, type Mesh, type V3,
} from './lib/mesh';
import { Rig } from '../app/lib/rig/rig';
import { DOFS, HEAD_FITS } from '../app/lib/rig/spec';
import { ATTACH_ERODE, resolveSkin, skinAttach, skinGeometry, skinStructure } from '../app/lib/rig/skinning';
import { BoneProximity } from '../app/lib/rig/proximity';
import { hasMuscleInfo, muscleInfo } from '../app/lib/data/muscles';
import type { Kind, Structure } from '../app/lib/types';
// @ts-expect-error plain JS module
import { makeSchematic } from './schematic.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CASK = join(ROOT, '.cache', 'open3d', 'dl', 'cask');
const STAGE = join(ROOT, '.cache', 'build', 'bp3d');
const DEFAULT_OUT = join(ROOT, 'public', 'models');
const OUT = process.env.MODELS_OUT ? resolve(process.env.MODELS_OUT) : DEFAULT_OUT;
/**
 * Mesh density, in square millimetres of surface per triangle, and the most a simplification may move the surface
 * (metres). At the closest zoom (0.25 m across the view) a screen pixel is about 0.3 mm, so these stay under a pixel;
 * the bones' fine relief is in their normal maps, which the simplification keeps in place (UV seams locked).
 */
const DENSITY_SCALE = Number(process.env.O3D_DENSITY ?? 1);
const DENSITY = {
  bone: { mm2: 4 * DENSITY_SCALE, error: 0.00015 },
  cartilage: { mm2: 3 * DENSITY_SCALE, error: 0.00015 },
  bp3dMuscle: { mm2: 8 * DENSITY_SCALE, error: 0.00025 },
  softTextured: { mm2: 2 * DENSITY_SCALE, error: 0.0003 }, // (coarser, a capsule's rim breaks up at the end of range)
  softPlain: { mm2: 3 * DENSITY_SCALE, error: 0.0004 },
};
const TEXTURES = process.env.O3D_TEXTURES !== '0';
/** Draco encode / decode speed (0 = smallest file, 10 = fastest). */
const DRACO_SPEED = (process.env.O3D_DRACO_SPEED ?? '5,5').split(',').map(Number);
const log = (...a: unknown[]) => console.log(...a);

/** Anterior offset from O3D to the app frame (metres), from the 125-bone fit in .cache/open3d/work/align.json. */
const APP_Z = 0.0989;

// ---- 0. sources -------------------------------------------------------------------------------------------------
for (const [name, f] of Object.entries(O3D_FILES)) {
  const p = join(CASK, name, `${name}.glb`);
  const how = `Download ${f.url} to ${p} (see README "Rebuilding the models").`;
  if (!existsSync(p)) throw new Error(`Open 3D Model file missing: ${p}\n${how}`);
  const hash = createHash('sha256').update(readFileSync(p)).digest('hex');
  if (hash !== f.sha256) throw new Error(`Open 3D Model file ${p} has SHA-256 ${hash}, expected ${f.sha256} (${f.bytes} bytes).\n${how}`);
}
log('sources: SHA-256 verified for', Object.keys(O3D_FILES).join(', '));

// ---- 1. BodyParts3D stage ---------------------------------------------------------------------------------------
if (process.env.SKIP_BP3D !== '1' || !existsSync(join(STAGE, 'structures.json'))) {
  log('stage 1: BodyParts3D build ->', STAGE);
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-models.mjs')], { env: { ...process.env, MODELS_OUT: STAGE }, stdio: 'inherit' });
}

// ---- 1b. skin shards (see 8b) ------------------------------------------------------------------------------------
/** Processes that share out the soft-tissue skin step: this one (shard 0) and SKIN_SHARDS - 1 children (O3D_SKIN_SHARDS=1: none). */
const SKIN_CHILD = process.env.SKIN_SHARD !== undefined;
const SKIN_SHARDS = Math.max(1, Number(process.env.O3D_SKIN_SHARDS ?? Math.min(8, Math.floor(availableParallelism() / 2))));
const SKIN_SHARD = SKIN_CHILD ? Number(process.env.SKIN_SHARD) : 0;
const SHARD_DIR = join(ROOT, '.cache', 'build', 'skin-shards');
const kids: Promise<void>[] = SKIN_CHILD ? [] : Array.from({ length: SKIN_SHARDS - 1 }, (_, i) => new Promise<void>((res, rej) => {
  const c = spawn(process.execPath, [...process.execArgv, process.argv[1]], {
    env: { ...process.env, SKIN_SHARD: String(i + 1), O3D_SKIN_SHARDS: String(SKIN_SHARDS), SKIP_BP3D: '1' }, stdio: ['ignore', 'ignore', 'inherit'],
  });
  c.on('error', rej);
  c.on('exit', (code) => (code === 0 ? res() : rej(new Error(`skin shard ${i + 1} exited with ${code}`))));
}));
for (const p of kids) p.catch(() => undefined); // (reported where they are awaited)

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});
await MeshoptSimplifier.ready;

type Tex = { image: Uint8Array; mime: string; name: string };
/**
 * `tex` is a normal map, `map` a base-colour (fibre) texture; `tendon` marks a tendon or aponeurosis part; `alpha` the
 * opacity of a see-through source material (BLEND) on a textured part.
 */
type Part = { key: string; label: string; mesh: Mesh; tex?: Tex; map?: Tex; tendon?: boolean; alpha?: number };
interface Built {
  id: string; key: string; kind: Kind; side: Side; label: string; group: string | null; parts: Part[];
  source: 'o3d' | 'bp3d'; attach?: string[]; schematic?: boolean; fit?: Structure['fit'];
  /** Baked proximity skin (soft tissue across a joint): rig node ids, and per part the vertex node indices and weights. */
  skin?: { nodes: string[]; parts: { joints: Uint8Array; weights: Float32Array }[] };
  /** Baked strain ends of a muscle with a baked skin (see Structure.strainEnds). */
  strainEnds?: Structure['strainEnds'];
}

/** Stage-1 geometry: structure id -> parts. */
async function readStage(file: string): Promise<Map<string, { key: string; pos: Float32Array; idx: Uint32Array }[]>> {
  const doc = await io.read(file);
  const out = new Map<string, { key: string; pos: Float32Array; idx: Uint32Array }[]>();
  for (const node of doc.getRoot().listScenes()[0].listChildren()) {
    const id = (node.getExtras() as { id?: string }).id;
    if (!id) continue;
    const parts = [];
    for (const c of node.listChildren()) {
      const prim = c.getMesh()?.listPrimitives()[0];
      if (!prim) continue;
      parts.push({ key: (c.getExtras() as { part?: string }).part ?? 'main', pos: new Float32Array(prim.getAttribute('POSITION')!.getArray()!), idx: new Uint32Array(prim.getIndices()!.getArray()!) });
    }
    out.set(id, parts);
  }
  return out;
}
const oldList: Structure[] = JSON.parse(readFileSync(join(STAGE, 'structures.json'), 'utf8'));
const oldById = new Map(oldList.map((s) => [s.id, s]));
const oldGeo = new Map([...(await readStage(join(STAGE, 'skeleton.glb'))), ...(await readStage(join(STAGE, 'muscles.glb')))]);
const oldLabel = (key: string) => (oldById.get(key) ?? oldById.get(`${key}-l`))?.label;
const oldGroup = (key: string) => (oldById.get(key) ?? oldById.get(`${key}-l`))?.group ?? null;

// ---- 2. Open 3D Model objects -----------------------------------------------------------------------------------
/**
 * `use`: what the build makes of it (a muscle part via MUSCLE_TABLE, a soft-tissue structure via SOFT_TABLE /
 * OVERLAY_TABLE, or a bone / cartilage by its kind); `alpha`: the source material's opacity when it is see-through.
 */
interface Obj {
  file: O3DFile; group: string; raw: string; name: string; base: string; nameSide: 'l' | 'r' | null; kind: O3DKind; mesh: Mesh; tex?: Tex; map?: Tex; gside: Side;
  alpha?: number; use?: 'muscle' | 'soft'; soft?: SoftSpec;
}

/** One copy per distinct image: the limb files repeat the same JPEGs byte for byte. */
const imageBySha = new Map<string, Uint8Array>();
const canonicalImage = (img: Uint8Array) => {
  const h = createHash('sha256').update(img).digest('hex');
  if (!imageBySha.has(h)) imageBySha.set(h, img);
  return imageBySha.get(h)!;
};

async function readO3D(file: O3DFile): Promise<Obj[]> {
  const doc = await io.read(join(CASK, file, `${file}.glb`));
  const parentOf = new Map();
  for (const n of doc.getRoot().listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
  const out: Obj[] = [];
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    let p = parentOf.get(n), top = p;
    while (p) { top = p; p = parentOf.get(p); }
    const m = n.getWorldMatrix();
    const P: Mesh[] = [];
    let tex: Tex | undefined, map: Tex | undefined;
    let matName = '', alpha: number | undefined;
    for (const prim of mesh.listPrimitives()) {
      const src = prim.getAttribute('POSITION')!.getArray()!;
      const pos = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 3) {
        const x = src[i], y = src[i + 1], z = src[i + 2];
        pos[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
        pos[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        pos[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      const idx = prim.getIndices() ? new Uint32Array(prim.getIndices()!.getArray()!) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
      const uvA = prim.getAttribute('TEXCOORD_0')?.getArray();
      const mat: Material | null = prim.getMaterial();
      matName ||= mat?.getName() ?? '';
      if (mat && alpha === undefined && mat.getAlphaMode() === 'BLEND') alpha = +mat.getBaseColorFactor()[3].toFixed(2);
      const t: Texture | null = mat?.getNormalTexture() ?? null;
      if (t && !tex) tex = { image: t.getImage()!, mime: t.getMimeType(), name: t.getName() || mat!.getName() };
      const bc: Texture | null = mat?.getBaseColorTexture() ?? null;
      if (bc && !map) map = { image: canonicalImage(bc.getImage()!), mime: bc.getMimeType(), name: bc.getName() || mat!.getName() };
      P.push({ pos, idx, ...(uvA ? { uv: new Float32Array(uvA) } : {}) });
    }
    const merged = P.length === 1 ? P[0] : mergeMeshes(P);
    const cleaned = cleanName(n.getName());
    const split = splitSide(cleaned);
    const base = FILE_RENAMES[file]?.[split.base] ?? split.base, side = split.side;
    const name = base === split.base ? cleaned : `${base}${side ? `.${side}` : ''}`;
    const group = top ? top.getName() : '';
    out.push({
      file, group, raw: n.getName(), name, base, nameSide: side, kind: o3dKind(group, base, matName), mesh: merged, tex: merged.uv ? tex : undefined,
      map: merged.uv ? map : undefined, gside: 'm', ...(alpha !== undefined ? { alpha } : {}),
    });
  }
  return out;
}

const objects: Obj[] = [];
const seen = new Map<string, Obj>();
for (const f of Object.keys(O3D_FILES) as O3DFile[]) {
  for (const o of await readO3D(f)) {
    // Keyed by kind as well: "Quadriceps common tendon and patellar ligament" is both a tendon and an overlay shell.
    const sig = `${o.kind}:${o.name}`;
    const prev = seen.get(sig);
    // Bones are repeated across the files; keep the first copy that has a normal map.
    if (prev) {
      if (!prev.tex && o.tex) { objects[objects.indexOf(prev)] = o; seen.set(sig, o); }
      continue;
    }
    seen.set(sig, o);
    objects.push(o);
  }
}
// Phase 1: skeleton and joint surfaces. Phase 2: limb muscles and their tendons (only those MUSCLE_TABLE maps).
// Phase 3: ligaments, capsules, bursae, sheaths, retinacula, fasciae and the overlay shells that read as structures
// (only those SOFT_TABLE / OVERLAY_TABLE map). Nerves and vessels stay out.
const WANTED = new Set<O3DKind>([
  'bone', 'articular', 'fibrocartilage', 'disc', 'nucleus', 'costal', 'muscle', 'tendon',
  'ligament', 'capsule', 'bursa', 'fascia', 'retinaculum', 'membrane', 'overlay',
]);
const MUSCLE_GROUP = new Set<O3DKind>(['muscle', 'tendon']);
const SOFT_GROUP = new Set<O3DKind>(['ligament', 'capsule', 'bursa', 'fascia', 'retinaculum', 'membrane']);
/** O3D_OVERLAY_EVAL=1: every overlay without a table entry is built as a ligament, for the close-up evaluation. */
const OVERLAY_EVAL = process.env.O3D_OVERLAY_EVAL === '1';
const skipped: Record<'muscle' | 'soft' | 'overlay', string[]> = { muscle: [], soft: [], overlay: [] };
const used = objects.filter((o) => {
  if (!WANTED.has(o.kind)) return false;
  const overlay = o.kind === 'overlay';
  if (!overlay && !MUSCLE_GROUP.has(o.kind) && !SOFT_GROUP.has(o.kind)) return true; // bone, cartilage, disc ...
  if (!overlay && muscleSpec(o.base)) { o.use = 'muscle'; return true; }
  const soft = softSpec(o.base, overlay);
  if (soft) { o.use = 'soft'; o.soft = soft; return true; }
  if (overlay && OVERLAY_EVAL && !(o.base in OVERLAY_SKIP)) {
    const slug = o.base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    o.use = 'soft'; o.soft = { kind: 'ligament', key: `overlay-${slug}`, label: `[overlay] ${o.base}` };
    return true;
  }
  const list = overlay ? 'overlay' : MUSCLE_GROUP.has(o.kind) ? 'muscle' : 'soft';
  const reason = (overlay ? OVERLAY_SKIP : MUSCLE_GROUP.has(o.kind) ? MUSCLE_SKIP : SOFT_SKIP)[o.base] ?? MUSCLE_SKIP[o.base] ?? SOFT_SKIP[o.base];
  skipped[list].push(`${o.base}: ${reason ?? 'UNMAPPED'}`);
  return false;
});
log(`O3D: ${objects.length} distinct objects, ${used.length} used (${[...WANTED].map((k) => `${k} ${used.filter((o) => o.kind === k).length}`).join(', ')})`);
for (const [what, list] of Object.entries(skipped)) log(`  ${what} objects not used (${list.length}):\n    ${list.sort().join('\n    ')}`);
const unmapped = Object.values(skipped).flat().filter((s) => s.endsWith('UNMAPPED'));
if (unmapped.length) throw new Error(`O3D objects without a table or skip entry (MUSCLE_TABLE/MUSCLE_SKIP, SOFT_TABLE/SOFT_SKIP, OVERLAY_TABLE/OVERLAY_SKIP):\n  ${unmapped.join('\n  ')}`);

// ---- 3. app frame -----------------------------------------------------------------------------------------------
// Same axes as the app. x stays put (O3D's midline is x = 0, which keeps the mirror exact); z moves by the fitted
// offset; y moves so the lowest point of the foot bones is the floor, y = 0.
const FOOT = /^(Calcaneus|.*metatarsal bone|.*phalanx of .* finger of foot|Sesamoid bones of foot)$/;
let floor = Infinity;
for (const o of used) if (o.kind === 'bone' && FOOT.test(o.base)) for (let i = 1; i < o.mesh.pos.length; i += 3) floor = Math.min(floor, o.mesh.pos[i]);
const APP_Y = -floor;
for (const o of used) {
  const p = o.mesh.pos;
  for (let i = 0; i < p.length; i += 3) { p[i + 1] += APP_Y; p[i + 2] += APP_Z; }
  const [lo, hi] = bbox([p]);
  o.gside = geometricSide(lo[0], hi[0]);
  if (o.nameSide && o.gside !== 'm' && o.nameSide !== o.gside) log(`  side: "${o.name}" is named ${o.nameSide} but lies on ${o.gside}; using geometry`);
}
log(`frame: O3D + (0, ${APP_Y.toFixed(4)}, ${APP_Z}) m`);
// Simplify once, before mirroring, so both sides stay exact mirror images. Cartilage carries no texture, so it is
// simplified freely; the bones keep their source meshes here. This is the working set: the attachments of the soft
// tissue, the rig's fits and the fit of the muscles are worked out on it. What is stored is thinned further at the
// end (section 8a), which leaves all of those as they are.
for (const o of used) {
  if (o.kind === 'articular' || o.kind === 'fibrocartilage' || o.kind === 'nucleus') o.mesh = simplify(o.mesh, 0.5);
  else if (o.kind === 'costal') o.mesh = simplify(o.mesh, 0.6);
  else if (o.use === 'soft') o.mesh = simplifySoft(o);
}
/** Surface area of a mesh (square metres). */
function meshArea(m: Mesh): number {
  let area = 0;
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, c = m.idx[t + 2] * 3, P = m.pos;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}
/** Triangles a mesh has at `mm2` square millimetres of surface per triangle. */
function trisAt(m: Mesh, mm2: number): number { return Math.round((meshArea(m) * 1e6) / mm2); }
/**
 * Soft tissue, working set: textured meshes (ligaments, capsules: tendon atlas and normal maps) are simplified with
 * their UV seams locked, down to SOFT_TRI_MM2 square millimetres of surface per triangle; untextured see-through ones
 * (bursae, synovial sheaths, fasciae, overlay shells) are smooth blobs and sheets, simplified to half that density.
 */
function simplifySoft(o: Obj): Mesh {
  const SOFT_TRI_MM2 = 1.2;
  const m = o.mesh, tris = m.idx.length / 3;
  const textured = !!(m.uv && (o.map || o.tex));
  const want = Math.max(textured ? 200 : 120, trisAt(m, textured ? SOFT_TRI_MM2 : 2 * SOFT_TRI_MM2));
  if (want >= tris * 0.9) return textured ? m : { pos: m.pos, idx: m.idx };
  if (!textured) return simplify({ pos: m.pos, idx: m.idx }, want / tris, 0, 0.0004);
  const [out] = MeshoptSimplifier.simplifyWithAttributes(m.idx, m.pos, 3, m.uv!, 2, [0.5, 0.5], null, want * 3, 0.01, ['LockBorder']);
  return subMesh({ pos: m.pos, idx: out, uv: m.uv }, Array.from({ length: out.length / 3 }, (_, i) => i));
}

const mirrorMesh = (m: Mesh): Mesh => ({ pos: mirrorPositions(m.pos), idx: flipWinding(m.idx), ...(m.uv ? { uv: m.uv } : {}), ...(m.ref ? { ref: mirrorPositions(m.ref) } : {}) });
const flipSide = (s: Side): Side => (s === 'l' ? 'r' : s === 'r' ? 'l' : 'm');
/** Instances of an object: itself, plus its mirror image unless the source also stores the other side. */
const sidesPresent = new Map<string, Set<Side>>();
for (const o of used) { const k = `${o.kind}:${o.base}`; (sidesPresent.get(k) ?? sidesPresent.set(k, new Set()).get(k)!).add(o.gside); }
function instances(o: Obj): { side: Side; mesh: Mesh }[] {
  const out = [{ side: o.gside, mesh: o.mesh }];
  if (o.gside !== 'm' && !sidesPresent.get(`${o.kind}:${o.base}`)!.has(flipSide(o.gside))) out.push({ side: flipSide(o.gside), mesh: mirrorMesh(o.mesh) });
  return out;
}

const built = new Map<string, Built>();
const idOf = (key: string, side: Side) => (side === 'm' ? key : `${key}-${side}`);
function addPart(b: Omit<Built, 'parts'>, part: Part) {
  let s = built.get(b.id);
  if (!s) built.set(b.id, (s = { ...b, parts: [] }));
  const same = s.parts.find((p) => p.key === part.key);
  if (same) same.mesh = mergeMeshes([same.mesh, part.mesh]);
  else s.parts.push(part);
}

/** Simplifies a texture-less mesh to `ratio` of its triangles, never moving the surface by more than `error` metres. */
function simplify(m: Mesh, ratio: number, minTris = 1200, error = 0.0003): Mesh {
  const tris = m.idx.length / 3;
  if (ratio >= 1 || tris <= minTris) return m;
  // weld first so the simplifier can collapse across UV seams (these meshes carry no UVs to keep)
  const w = weldIds(m.pos);
  const idx = Uint32Array.from(m.idx, (v) => w[v]);
  const [out] = MeshoptSimplifier.simplify(idx, m.pos, 3, Math.max(minTris, Math.floor(tris * ratio)) * 3, error, ['ErrorAbsolute']);
  return subMesh({ pos: m.pos, idx: out, ...(m.ref ? { ref: m.ref } : {}) }, Array.from({ length: out.length / 3 }, (_, i) => i));
}
/**
 * Simplifies a textured mesh towards `want` triangles, never moving the surface by more than `error` metres. Its UV
 * seams (open borders of the index topology) stay where they are and the UVs weigh in the error, so the texture and
 * the normal map keep their place.
 */
function simplifyTextured(m: Mesh, want: number, error: number): Mesh {
  want = Math.max(200, want);
  if (want >= (m.idx.length / 3) * 0.9) return m;
  const [out] = MeshoptSimplifier.simplifyWithAttributes(m.idx, m.pos, 3, m.uv!, 2, [0.5, 0.5], null, want * 3, error, ['LockBorder', 'ErrorAbsolute']);
  return subMesh({ pos: m.pos, idx: out, uv: m.uv, ...(m.ref ? { ref: m.ref } : {}) }, Array.from({ length: out.length / 3 }, (_, i) => i));
}

// ---- 4. bones ---------------------------------------------------------------------------------------------------
// The limb files repeat the vertebrae under slightly different names ("Cervical vertebra (C3)" vs "vertebrae"):
// one object per key, side and part, preferring the overview-skeleton copy (read first).
const boneSeen = new Set<string>();
for (const o of used.filter((x) => x.kind === 'bone')) {
  const key = boneKey(o.base);
  if (!key) { log(`  bone skipped (no app key): "${o.name}"`); continue; }
  const tooth = toothPart(o.base);
  const sig = `${key}:${tooth?.key ?? ''}:${o.gside}`;
  if (boneSeen.has(sig)) continue;
  boneSeen.add(sig);
  const meta = { kind: 'bone' as Kind, source: 'o3d' as const, label: NEW_BONES[key]?.label ?? oldLabel(key) ?? o.base, group: NEW_BONES[key]?.group ?? oldGroup(key) };
  for (const inst of instances(o)) {
    const mesh = inst.mesh;
    if (tooth) addPart({ id: key, key, side: 'm', ...meta }, { key: tooth.key, label: tooth.label, mesh, tex: o.tex });
    else addPart({ id: idOf(key, inst.side), key, side: inst.side, ...meta }, { key: 'main', label: meta.label, mesh, tex: o.tex });
  }
}
const isPaired = (key: string) => built.has(`${key}-l`) || oldById.has(`${key}-l`);
const boneVerts = new Map<string, PointGrid>();
const boneGrid = (id: string) => {
  let g = boneVerts.get(id);
  if (!g) boneVerts.set(id, (g = new PointGrid(concat(built.get(id)!.parts.map((p) => p.mesh.pos)), 0.008)));
  return g;
};
/** Triangle grid of a new bone, for exact surface distances and inside tests. */
const newGrids = new Map<string, TriGrid>();
const triGridOf = (id: string) => {
  let g = newGrids.get(id);
  if (!g) {
    const m = mergeMeshes(built.get(id)!.parts.map((p) => ({ pos: p.mesh.pos, idx: p.mesh.idx })));
    newGrids.set(id, (g = new TriGrid(m.pos, m.idx, 0.008)));
  }
  return g;
};

// ---- 5. costal cartilage, discs, joint surfaces -----------------------------------------------------------------
for (const o of used.filter((x) => x.kind === 'costal')) {
  const n = costalNumber(o.base);
  if (!n) { log(`  costal skipped: "${o.name}"`); continue; }
  const key = `costal-cartilage-${n}`;
  for (const inst of instances(o)) {
    addPart({ id: idOf(key, inst.side), key, kind: 'cartilage', side: inst.side, label: `Costal Cartilage ${n}`, group: 'thorax', source: 'o3d', attach: [idOf(`rib-${n}`, inst.side)] },
      { key: 'main', label: `Costal Cartilage ${n}`, mesh: inst.mesh });
  }
}

const discs = new Map<string, Built>();
for (const o of used.filter((x) => x.kind === 'disc')) {
  const d = discKey(o.base);
  if (!d) { log(`  disc skipped: "${o.name}"`); continue; }
  const label = oldLabel(d.key) ?? `Intervertebral Disc of Twelfth Thoracic Vertebra`;
  addPart({ id: d.key, key: d.key, kind: 'disc', side: 'm', label, group: 'spine', source: 'o3d', attach: [d.above, d.below] },
    { key: 'annulus', label: 'Annulus fibrosus', mesh: o.mesh });
  discs.set(d.key, built.get(d.key)!);
}
// Nucleus pulposus: three multi-level objects in O3D; each piece goes to the disc whose annulus surrounds it.
for (const o of used.filter((x) => x.kind === 'nucleus')) {
  for (const tris of components(o.mesh.pos, o.mesh.idx)) {
    const piece = subMesh(o.mesh, tris);
    const c = centroid(piece.pos);
    let best: Built | null = null, bd = Infinity;
    for (const d of discs.values()) {
      const dc = centroid(d.parts[0].mesh.pos);
      const dist = Math.hypot(c[0] - dc[0], c[1] - dc[1], c[2] - dc[2]);
      if (dist < bd) { bd = dist; best = d; }
    }
    if (!best || bd > 0.02) { log(`  nucleus piece at y=${c[1].toFixed(3)} has no disc within 20 mm (nearest ${(bd * 1000).toFixed(0)} mm), dropped`); continue; }
    addPart(best, { key: 'nucleus', label: 'Nucleus pulposus', mesh: piece });
  }
}

const jointSkipped: string[] = [];
for (const o of used.filter((x) => x.kind === 'articular' || x.kind === 'fibrocartilage')) {
  const spec = jointSpec(o.base);
  if (!spec) { jointSkipped.push(o.name); continue; }
  for (const inst of instances(o)) placeJoint(spec, inst.side, inst.mesh);
}
if (jointSkipped.length) log(`  joint objects without a table entry (skipped): ${jointSkipped.join('; ')}`);

function placeJoint(spec: JointSpec, side: Side, mesh: Mesh) {
  const base = { kind: spec.kind as Kind, source: 'o3d' as const };
  const part = spec.part ?? { key: 'main', label: spec.label };
  const groupOf = (boneId: string) => built.get(boneId)?.group ?? null;
  if (spec.on.length === 1) {
    const bone = spec.on[0];
    if (!isPaired(bone)) { // midline bone (manubrium, sacrum, vertebra...): the structure keeps the object's side
      addPart({ ...base, id: idOf(spec.key, side), key: spec.key, side, label: spec.label, group: groupOf(bone), attach: [bone] }, { ...part, mesh });
      return;
    }
    if (side !== 'm') {
      const b = `${bone}-${side}`;
      addPart({ ...base, id: idOf(spec.key, side), key: spec.key, side, label: spec.label, group: groupOf(b), attach: [b] }, { ...part, mesh });
      return;
    }
    if (spec.whole) {
      addPart({ ...base, id: spec.key, key: spec.key, side: 'm', label: spec.label, group: groupOf(`${bone}-l`), attach: [`${bone}-l`, `${bone}-r`] }, { ...part, mesh });
      return;
    }
    splitTo(mesh, [`${bone}-l`, `${bone}-r`], (b, piece) => {
      const s = b.endsWith('-l') ? 'l' : 'r';
      addPart({ ...base, id: idOf(spec.key, s), key: spec.key, side: s, label: spec.label, group: groupOf(b), attach: [b] }, { ...part, mesh: piece });
    });
    return;
  }
  const cands = spec.on.map((k) => (isPaired(k) ? `${k}-${side}` : k)).filter((id) => built.has(id));
  splitTo(mesh, cands, (b, piece) => {
    const bk = built.get(b)!;
    const { key, label } = splitJointKey(spec, bk.key, bk.label);
    addPart({ ...base, id: idOf(key, side), key, side, label, group: bk.group, attach: [b] }, { key: 'main', label, mesh: piece });
  });
}

/**
 * Splits a mesh into connected pieces and hands each to the nearest of the candidate bones (mean vertex distance; of a
 * sheet given thickness, as the sheet lay: Mesh.ref).
 */
function splitTo(mesh: Mesh, cands: string[], put: (bone: string, piece: Mesh) => void) {
  const byBone = new Map<string, Mesh[]>();
  for (const tris of components(mesh.ref ?? mesh.pos, mesh.idx)) {
    const whole = subMesh(mesh, tris);
    const piece = { pos: whole.ref ?? whole.pos };
    const n = piece.pos.length / 3, step = Math.max(1, Math.floor(n / 40));
    let best = cands[0], bd = Infinity;
    for (const c of cands) {
      const g = boneGrid(c);
      let sum = 0, k = 0;
      for (let v = 0; v < n; v += step) { sum += Math.sqrt(g.nearest(piece.pos[v * 3], piece.pos[v * 3 + 1], piece.pos[v * 3 + 2], 0.1)[1]); k++; }
      if (sum / k < bd) { bd = sum / k; best = c; }
    }
    (byBone.get(best) ?? byBone.set(best, []).get(best)!).push(whole);
  }
  for (const [b, pieces] of byBone) put(b, mergeMeshes(pieces));
}

// ---- 5b. ligaments, capsules, bursae, sheaths, retinacula, fasciae -----------------------------------------------
// Each object becomes the structure SOFT_TABLE (or OVERLAY_TABLE) names, on its side, mirrored for the other side;
// digit objects are cut into one structure per digit. Then each structure gets the bones it is fixed to (`attach`):
//  - ligaments and capsules: the bones its surface touches (vertices within CONTACT of the bone surface, at least
//    CONTACT_SHARE of them, or a few);
//  - sheaths, retinacula, fasciae, and any ligament that touches nothing: the bones that are the nearest bone of at
//    least NEAR_SHARE of its vertices (the region it lies in);
//  - bursae: the one bone it touches most (they move rigidly with it);
//  - `on` in the table overrides both.
// The rig blends a structure's vertices between the bones of `attach` by proximity (app/lib/rig/skinning.ts).
const CONTACT = 0.0025, CONTACT_SHARE = 0.02, NEAR_SHARE = 0.04;
/** Overlay sheets that are bands of tissue (see thickenSheet): thickness as a share of their size, its limits, and the gap kept to bone (metres). */
const SHEET_KINDS = new Set(['ligament', 'retinaculum']);
const SHEET_T = 0.03, SHEET_RANGE: [number, number] = [0.0007, 0.0025], SHEET_CLEAR = 0.0002;
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const SOFT_KINDS: Kind[] = ['ligament', 'capsule', 'bursa', 'sheath', 'retinaculum', 'fascia', 'fatpad'];
const softSeen = new Map<string, string>(); // structure key -> O3D name (two objects must not land on one key)
/** Per-digit structures fixed to the one bone their piece was assigned to (SoftSpec.split.rigid). */
const rigidSoft = new Map<string, string>();
/** Bones (structure ids) on a side, and the midline bones; both sides for a midline structure. */
const bonesNear = (side: Side, lo: V3, hi: V3, pad: number) => [...built.values()].filter((b) => b.kind === 'bone' && (side === 'm' || b.side === side || b.side === 'm'))
  .filter((b) => { const [blo, bhi] = bbox(b.parts.map((p) => p.mesh.pos)); return [0, 1, 2].every((k) => blo[k] <= hi[k] + pad && bhi[k] >= lo[k] - pad); })
  .map((b) => b.id);

const sheetLog: string[] = [];
for (const o of used.filter((x) => x.use === 'soft')) {
  const spec = o.soft!;
  if (o.kind === 'overlay' && SHEET_KINDS.has(spec.kind) && !o.map && process.env.O3D_SHEETS !== '0') o.mesh = thickenSheet(o);
  for (const inst of instances(o)) placeSoft(o, spec, inst.side, inst.mesh);
}
log(`sheets: ${sheetLog.length} overlay sheets given thickness (details in ${join(STAGE, 'sheets.tsv')})`);
writeFileSync(join(STAGE, 'sheets.tsv'), ['object\tthickness mm\tvertices\touter\tlifted off bone\t2V/A before mm\t2V/A after mm', ...sheetLog].join('\n'));

/**
 * Gives a ligament that the source draws as a highlight sheet its thickness. Such a sheet is a closed shell whose two
 * faces lie a fraction of a millimetre apart, on the capsule or the bone. The face turned away from the bone is moved
 * outwards along its normals by SHEET_T of the sheet's size (within SHEET_RANGE); the face turned to the bone stays,
 * and the rim, whose normals lie in the sheet, moves in proportion, which bevels the edge. Any vertex inside a bone or
 * closer to it than SHEET_CLEAR is first lifted to SHEET_CLEAR above the surface, so the slab does not cut into bone.
 * The positions before all this are kept as the mesh's `ref`: the skin weights are worked out from them, so both
 * faces of the slab move together.
 */
function thickenSheet(o: Obj): Mesh {
  const m = o.mesh;
  const n = m.pos.length / 3;
  const w = weldIds(m.pos);
  const nrm = new Float64Array(n * 3);
  const volume = (P: Float32Array) => {
    let vol = 0, area = 0;
    for (let t = 0; t < m.idx.length; t += 3) {
      const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, c = m.idx[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      area += Math.hypot(nx, ny, nz) / 2;
      vol += (P[a] * nx + P[a + 1] * ny + P[a + 2] * nz) / 6;
    }
    return { vol, area };
  };
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, c = m.idx[t + 2] * 3, P = m.pos;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [w[m.idx[t]], w[m.idx[t + 1]], w[m.idx[t + 2]]]) { nrm[v * 3] += nx; nrm[v * 3 + 1] += ny; nrm[v * 3 + 2] += nz; }
  }
  const before = volume(m.pos);
  const sign = before.vol < 0 ? -1 : 1; // normals outwards whatever the winding
  const [lo, hi] = bbox([m.pos]);
  // thickness per connected piece (one object holds the ligaments of all the fingers)
  const T = new Float32Array(n);
  let tMin = Infinity, tMax = 0;
  for (const tris of components(m.pos, m.idx)) {
    const vs = new Set<number>();
    for (const t of tris) for (let k = 0; k < 3; k++) vs.add(w[m.idx[t * 3 + k]]);
    const plo = [Infinity, Infinity, Infinity], phi = [-Infinity, -Infinity, -Infinity];
    for (const v of vs) for (let k = 0; k < 3; k++) { plo[k] = Math.min(plo[k], m.pos[v * 3 + k]); phi[k] = Math.max(phi[k], m.pos[v * 3 + k]); }
    const t = Math.min(SHEET_RANGE[1], Math.max(SHEET_RANGE[0], SHEET_T * Math.hypot(phi[0] - plo[0], phi[1] - plo[1], phi[2] - plo[2])));
    for (const v of vs) T[v] = t;
    tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
  }
  const grids = bonesNear(o.gside, lo, hi, 0.03).map((id) => triGridOf(id));
  const out = new Float32Array(m.pos);
  let outer = 0, lifted = 0, reps = 0;
  for (let v = 0; v < n; v++) {
    if (w[v] !== v) continue;
    reps++;
    let x = m.pos[v * 3], y = m.pos[v * 3 + 1], z = m.pos[v * 3 + 2];
    // nearest bone surface, and the direction away from it
    let best = [Infinity, 0, 0, 0] as [number, number, number, number], g: TriGrid | null = null;
    for (const t of grids) { const c = t.closest(x, y, z, 0.03); if (c[0] < best[0]) { best = c; g = t; } }
    const l = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) || 1;
    const nx = (sign * nrm[v * 3]) / l, ny = (sign * nrm[v * 3 + 1]) / l, nz = (sign * nrm[v * 3 + 2]) / l;
    let facing = 1; // no bone within 30 mm: the whole shell swells
    if (g && best[0] > 1e-7) {
      const inside = g.inside(x, y, z), s = inside ? -1 : 1;
      const ax = (s * (x - best[1])) / best[0], ay = (s * (y - best[2])) / best[0], az = (s * (z - best[3])) / best[0];
      if (inside || best[0] < SHEET_CLEAR) { x = best[1] + ax * SHEET_CLEAR; y = best[2] + ay * SHEET_CLEAR; z = best[3] + az * SHEET_CLEAR; lifted++; }
      facing = nx * ax + ny * ay + nz * az;
    }
    const k = T[v] * smoothstep(-0.2, 0.6, facing);
    if (facing > 0.6) outer++;
    out[v * 3] = x + nx * k; out[v * 3 + 1] = y + ny * k; out[v * 3 + 2] = z + nz * k;
  }
  for (let v = 0; v < n; v++) if (w[v] !== v) { out[v * 3] = out[w[v] * 3]; out[v * 3 + 1] = out[w[v] * 3 + 1]; out[v * 3 + 2] = out[w[v] * 3 + 2]; }
  const after = volume(out);
  sheetLog.push(`${o.base}\t${(tMin * 1000).toFixed(2)}${tMax > tMin ? `-${(tMax * 1000).toFixed(2)}` : ''}\t${reps}\t${outer}\t${lifted}\t${((2 * Math.abs(before.vol) / before.area) * 1000).toFixed(2)}\t${((2 * Math.abs(after.vol) / after.area) * 1000).toFixed(2)}`);
  return { ...m, pos: out, ref: m.pos };
}

function placeSoft(o: Obj, spec: SoftSpec, side: Side, mesh: Mesh) {
  const extra = { map: o.map, tex: o.tex, ...(o.alpha !== undefined && o.map ? { alpha: o.alpha } : {}) };
  const put = (key: string, label: string, part: { key: string; label: string }, m: Mesh) => {
    const prev = softSeen.get(key);
    if (prev && prev !== o.base && !spec.part) throw new Error(`soft tissue: "${o.base}" and "${prev}" both map to ${key}`);
    if (!prev) softSeen.set(key, o.base);
    addPart({ id: idOf(key, side), key, kind: spec.kind as Kind, side, label, group: null, source: 'o3d' }, { ...part, mesh: m, ...extra });
  };
  if (spec.split) {
    const cands = spec.split.on.map((k) => `${k}-${side === 'm' ? 'r' : side}`).filter((id) => built.has(id));
    splitTo(mesh, cands, (bone, piece) => {
      const { key, label } = spec.split!.name(digitOf(built.get(bone)!.key));
      put(key, label, { key: 'main', label }, piece);
      if (spec.split!.rigid) rigidSoft.set(idOf(key, side), bone);
    });
    return;
  }
  if (spec.parts) {
    const pieces = components(mesh.pos, mesh.idx).map((tris) => subMesh(mesh, tris));
    if (pieces.length !== spec.parts.length) throw new Error(`${o.base}: ${pieces.length} pieces for parts ${spec.parts.map((p) => p.key).join(', ')}`);
    pieces.sort((a, b) => Math.abs(centroid(a.pos)[0]) - Math.abs(centroid(b.pos)[0]));
    pieces.forEach((piece, i) => put(spec.key, spec.label, spec.parts![i], piece));
    return;
  }
  put(spec.key, spec.label, spec.part ?? { key: 'main', label: spec.label }, mesh);
}

function softAttach(s: Built, spec: SoftSpec | undefined): string[] {
  if (spec?.on) return spec.on.flatMap((k) => (isPaired(k) ? (s.side === 'm' ? [`${k}-l`, `${k}-r`] : [`${k}-${s.side}`]) : [k])).filter((id) => built.has(id));
  // (a sheet given thickness touches what the sheet touched: Mesh.ref)
  const m = mergeMeshes(s.parts.map((p) => ({ pos: p.mesh.ref ?? p.mesh.pos, idx: p.mesh.idx })));
  const w = weldIds(m.pos);
  const verts: number[] = [];
  for (let v = 0; v < w.length; v++) if (w[v] === v) verts.push(v);
  const [lo, hi] = bbox([m.pos]);
  const contact = new Map<string, number>();
  for (const id of bonesNear(s.side, lo, hi, CONTACT)) {
    const g = triGridOf(id);
    let c = 0;
    for (const v of verts) if (g.distance(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2], CONTACT) < CONTACT) c++;
    if (c) contact.set(id, c);
  }
  const ranked = (cnt: Map<string, number>, share: number) => [...cnt].filter(([, c]) => c >= Math.max(3, share * verts.length)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  if (s.kind === 'bursa' || s.kind === 'fatpad') { const top = ranked(contact, 0)[0]; if (top) return [top]; }
  if (s.kind === 'ligament' || s.kind === 'capsule') { const r = ranked(contact, CONTACT_SHARE); if (r.length) return r; }
  // Region: the nearest bone of each vertex (bone vertex grids, 12 cm search).
  const near = new Map<string, number>();
  const cands = bonesNear(s.side, lo, hi, 0.12).map((id) => ({ id, box: bbox(built.get(id)!.parts.map((p) => p.mesh.pos)) }));
  const step = Math.max(1, Math.floor(verts.length / 1500));
  let n = 0;
  for (let i = 0; i < verts.length; i += step) {
    const v = verts[i], x = m.pos[v * 3], y = m.pos[v * 3 + 1], z = m.pos[v * 3 + 2];
    // bones in order of their bounding-box distance; stop once a box is farther than the best vertex found
    const order = cands.map((c) => ({ id: c.id, d: Math.hypot(Math.max(c.box[0][0] - x, 0, x - c.box[1][0]), Math.max(c.box[0][1] - y, 0, y - c.box[1][1]), Math.max(c.box[0][2] - z, 0, z - c.box[1][2])) }))
      .filter((c) => c.d < 0.12).sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));
    let best = '', bd = 0.12;
    for (const c of order) {
      if (c.d >= bd) break;
      const [j, d2] = boneGrid(c.id).nearest(x, y, z, bd);
      if (j >= 0 && Math.sqrt(d2) < bd) { bd = Math.sqrt(d2); best = c.id; }
    }
    if (best) { near.set(best, (near.get(best) ?? 0) + 1); n++; }
  }
  const r = [...near].filter(([, c]) => c >= NEAR_SHARE * n).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  return s.kind === 'bursa' || s.kind === 'fatpad' ? r.slice(0, 1) : r;
}

const softLog: string[] = [];
for (const s of [...built.values()].filter((b) => SOFT_KINDS.includes(b.kind)).sort((a, b) => a.id.localeCompare(b.id))) {
  const spec = used.find((o) => o.use === 'soft' && softSeen.get(s.key) === o.base)?.soft;
  s.attach = rigidSoft.has(s.id) ? [rigidSoft.get(s.id)!] : softAttach(s, spec);
  if (!s.attach.length) throw new Error(`${s.id}: no bone found to attach it to`);
  s.group = built.get(s.attach[0])?.group ?? null;
  softLog.push(`${s.id}\t${s.kind}\t${s.parts.reduce((a, p) => a + p.mesh.idx.length / 3, 0)} tris\t${s.attach.join(', ')}`);
}
writeFileSync(join(STAGE, 'soft-attach.tsv'), softLog.join('\n'));
log(`soft tissue: ${softLog.length} structures (${SOFT_KINDS.map((k) => `${k} ${[...built.values()].filter((b) => b.kind === k).length}`).join(', ')}); attachments in ${join(STAGE, 'soft-attach.tsv')}`);

// ---- 6. articular-surface fits for the rig -----------------------------------------------------------------------
const r4 = (x: number) => +x.toFixed(4);
for (const side of ['l', 'r'] as const) {
  const lateralSign = side === 'l' ? 1 : -1;
  for (const key of ['cartilage-humeral-head', 'cartilage-femoral-head']) {
    const s = built.get(`${key}-${side}`);
    if (!s) continue;
    const p = concat(s.parts.map((x) => x.mesh.pos));
    const pts = []; for (let i = 0; i < p.length; i += 3) pts.push([p[i], p[i + 1], p[i + 2]]);
    s.fit = { sphere: fitSphere(pts).map(r4) as [number, number, number, number] };
  }
  // Hinges: a sphere on each half of the articular surface (capitulum / trochlea; lateral / medial posterior femoral
  // condyle). The line through the two centres approximates the flexion axis; the rig uses its midpoint.
  for (const [key, posteriorOnly] of [['cartilage-distal-humerus', false], ['cartilage-distal-femur', true]] as const) {
    const s = built.get(`${key}-${side}`);
    if (!s) continue;
    const p = concat(s.parts.map((x) => x.mesh.pos));
    const c = centroid(p);
    const halves: number[][][] = [[], []];
    for (let i = 0; i < p.length; i += 3) {
      if (posteriorOnly && (p[i + 2] > c[2] || p[i + 1] > c[1] + 0.01)) continue;
      halves[(p[i] - c[0]) * lateralSign > 0 ? 0 : 1].push([p[i], p[i + 1], p[i + 2]]);
    }
    if (halves.some((h) => h.length < 30)) continue;
    const [lat, med] = halves.map(fitSphere);
    s.fit = { axis: [lat.slice(0, 3).map(r4) as V3, med.slice(0, 3).map(r4) as V3], radii: [r4(lat[3]), r4(med[3])] };
  }
}
const pointsOf = (pos: Float32Array, vs: Iterable<number>) => [...vs].map((v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
const mean = (pts: number[][]) => [0, 1, 2].map((k) => pts.reduce((a, p) => a + p[k], 0) / pts.length);
// Heads of the digit bones (spec HEAD_FITS): the MCP, IP, MTP joints turn about the centre of the head of the bone above
// them. The cartilage of a metacarpal, metatarsal or phalanx covers its base and its head, two pieces; the piece nearest
// the next bone is fitted. A metacarpal or metatarsal head (a condyloid joint) is near a ball: geometric sphere first,
// then an algebraic sphere (which shrinks a small cap), then a circle across the axis of the joint's DOF. A phalangeal
// head is a pulley, on which a sphere fit is ill posed: the circle (a cylinder, right for the hinge) first. (Checked by
// the bones' gap and overlap across each joint's range, .cache/phase7/gap.ts.) The first plausible fit is kept: radius 2-15 mm and no more than the piece's own extent, centre on the bone side
// of the cartilage (at least a quarter radius in from its centroid, towards the bone's centroid) and within 1.25 radii
// of it. Otherwise the rig keeps its fallback pivot.
const AXIS_VEC: Partial<Record<string, V3>> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const headLog: string[] = [];
for (const side of ['l', 'r'] as const) {
  for (const [node, cart] of Object.entries(HEAD_FITS)) {
    const s = built.get(`${cart}-${side}`), child = built.get(`${node}-${side}`);
    const bone = built.get(s?.attach?.[0] ?? `${cart.replace(/^cartilage-/, '')}-${side}`);
    if (!s || !child || !bone) { headLog.push(`${node}-${side}: missing ${!s ? cart : !child ? node : 'bone'}`); continue; }
    const m = mergeMeshes(s.parts.map((p) => p.mesh));
    const childC = centroid(concat(child.parts.map((p) => p.mesh.pos)));
    const boneC = centroid(concat(bone.parts.map((p) => p.mesh.pos)));
    let best: { pts: number[][]; c: number[]; d: number } | null = null;
    for (const comp of components(m.pos, m.idx)) {
      const vs = new Set<number>(); for (const t of comp) for (let k = 0; k < 3; k++) vs.add(m.idx[t * 3 + k]);
      const pts = pointsOf(m.pos, vs), c = mean(pts), d = Math.hypot(c[0] - childC[0], c[1] - childC[1], c[2] - childC[2]);
      if (!best || d < best.d) best = { pts, c, d };
    }
    if (!best || best.pts.length < 20) { headLog.push(`${node}-${side}: head piece too small`); continue; }
    const { pts, c } = best;
    const toBone = [0, 1, 2].map((k) => boneC[k] - c[k]); const L = Math.hypot(...toBone);
    const ext = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
    const plausible = (f: number[]) => {
      if (!f.every(Number.isFinite) || f[3] < 0.002 || f[3] > 0.015 || f[3] > ext) return false;
      const v = [0, 1, 2].map((k) => f[k] - c[k]);
      return (v[0] * toBone[0] + v[1] * toBone[1] + v[2] * toBone[2]) / L >= 0.25 * f[3] && Math.hypot(...v) <= 1.25 * f[3];
    };
    const axis = AXIS_VEC[DOFS.find((d) => d.targets.some((t) => t.node === node))?.axis ?? ''];
    const alg = fitSphere(pts);
    const circle: [string, number[]][] = axis ? [['circle', fitCircleAbout(pts, axis)]] : [];
    const spheres: [string, number[]][] = [['geometric sphere', refineSphere(pts, alg)], ['algebraic sphere', alg]];
    const cands = /metacarpal|metatarsal/.test(cart) ? [...spheres, ...circle] : [...circle, ...spheres];
    const [how, f] = cands.find(([, x]) => plausible(x)) ?? ['NO FIT', null];
    headLog.push(`${node}-${side}: ${how} ${f ? `(${f.slice(0, 3).map((x) => x.toFixed(4)).join(', ')}) r ${(f[3] * 1000).toFixed(1)} mm` : ''} from ${pts.length} points`);
    if (f) s.fit = { ...s.fit, head: f.map(r4) as [number, number, number, number] };
  }
}
// Jaw: the hinge runs through the centres of the two mandibular condyles, the highest and most posterior part of each
// ramus (the coronoid process, as high, is in front): a sphere fitted to the top 10 mm of each, behind the front 25 mm.
{
  const s = built.get('mandible');
  if (s) {
    const p = concat(s.parts.map((x) => x.mesh.pos));
    const [lo, hi] = bbox([p]);
    const cond = [1, -1].map((sg) => {
      const pts: number[][] = [];
      for (let i = 0; i < p.length; i += 3) if (p[i] * sg > 0.02 && p[i + 1] > hi[1] - 0.01 && p[i + 2] < lo[2] + 0.025) pts.push([p[i], p[i + 1], p[i + 2]]);
      const alg = fitSphere(pts), geo = refineSphere(pts, alg);
      const ok = (f: number[]) => f.every(Number.isFinite) && f[3] > 0.003 && f[3] < 0.015;
      return pts.length >= 30 && (ok(geo) || ok(alg)) ? (ok(geo) ? geo : alg) : null;
    });
    if (cond[0] && cond[1]) {
      s.fit = { axis: [cond[0].slice(0, 3).map(r4) as V3, cond[1].slice(0, 3).map(r4) as V3], radii: [r4(cond[0][3]), r4(cond[1][3])] };
      headLog.push(`mandible condyles: (${s.fit.axis![0].join(', ')}) r ${(cond[0][3] * 1000).toFixed(1)} mm, (${s.fit.axis![1].join(', ')}) r ${(cond[1][3] * 1000).toFixed(1)} mm`);
    } else headLog.push('mandible condyles: NO FIT');
  }
}
writeFileSync(join(STAGE, 'head-fits.txt'), headLog.join('\n'));
log(`joint heads: ${headLog.filter((l) => !/NO FIT|missing|too small/.test(l)).length} of ${headLog.length} fitted (details in ${join(STAGE, 'head-fits.txt')})`);

// Patellar track: the rig turns the patella about a pivot by a fraction of the knee angle. Choose the pivot (near the
// knee axis) and the fraction so that the patellar cartilage stays on the femoral cartilage from 0 to 130 degrees
// without entering the femur: the smallest worst-case gap, searched coarse to fine.
for (const side of ['l', 'r'] as const) {
  const pc = built.get(`cartilage-patella-${side}`), pb = built.get(`patella-${side}`), fc = built.get(`cartilage-distal-femur-${side}`), fb = built.get(`femur-${side}`);
  if (!pc || !pb || !fc?.fit?.axis || !fb) continue;
  const [a0, a1] = fc.fit.axis;
  const knee = [0, 1, 2].map((k) => (a0[k] + a1[k]) / 2);
  const fcm = mergeMeshes(fc.parts.map((p) => p.mesh)), fbm = mergeMeshes(fb.parts.map((p) => p.mesh));
  const cartGrid = new TriGrid(fcm.pos, fcm.idx, 0.006), boneGrid = new TriGrid(fbm.pos, fbm.idx, 0.006);
  const pcPos = concat(pc.parts.map((p) => p.mesh.pos)), pbPos = concat(pb.parts.map((p) => p.mesh.pos));
  const worst = (dy: number, dz: number, ratio: number) => {
    let w = 0;
    for (const th of [30, 60, 90, 130]) {
      const ang = ratio * th * Math.PI / 180, cs = Math.cos(ang), sn = Math.sin(ang);
      const P = [knee[1] + dy, knee[2] + dz];
      const at = (pos: Float32Array, i: number): V3 => { const y = pos[i + 1] - P[0], z = pos[i + 2] - P[1]; return [pos[i], P[0] + cs * y - sn * z, P[1] + sn * y + cs * z]; };
      let gap = Infinity;
      for (let i = 0; i < pcPos.length; i += 12) {
        const q = at(pcPos, i);
        gap = Math.min(gap, cartGrid.distance(q[0], q[1], q[2], 0.08));
        if (boneGrid.inside(...q)) return Infinity;
      }
      for (let i = 0; i < pbPos.length; i += 12) if (boneGrid.inside(...at(pbPos, i))) return Infinity;
      w = Math.max(w, gap);
    }
    return w;
  };
  let best = { dy: 0, dz: 0, ratio: 0.5, w: worst(0, 0, 0.5) };
  const search = (dys: number[], dzs: number[], ratios: number[]) => {
    for (const dy of dys) for (const dz of dzs) for (const ratio of ratios) {
      const w = worst(dy, dz, ratio);
      if (w < best.w) best = { dy, dz, ratio, w };
    }
  };
  const steps = (c: number, h: number, n: number) => Array.from({ length: 2 * n + 1 }, (_, i) => c + (i - n) * h);
  search(steps(0, 0.01, 3), steps(0, 0.01, 3), [0.5, 0.6, 0.7, 0.8]);
  search(steps(best.dy, 0.0025, 2), steps(best.dz, 0.0025, 2), [best.ratio - 0.05, best.ratio, best.ratio + 0.05]);
  pc.fit = { track: { pivot: [knee[0], knee[1] + best.dy, knee[2] + best.dz].map(r4) as V3, ratio: +best.ratio.toFixed(2) } };
  log(`patellar track ${side}: pivot knee axis + (0, ${(best.dy * 1000).toFixed(1)}, ${(best.dz * 1000).toFixed(1)}) mm, ${best.ratio.toFixed(2)} x knee angle, worst gap ${(best.w * 1000).toFixed(1)} mm`);
}

// ---- 7. muscles: carry them from the old bones onto the new ones -------------------------------------------------
const oldRig = new Rig(oldById);
/** Per rig node: affine fit of the old carried bones onto the new ones. */
const nodeFit = new Map<string, Affine>();
const fitLog: string[] = [];
for (const node of oldRig.nodes.values()) {
  const common = node.carries.filter((id) => oldById.get(id)?.kind === 'bone' && built.has(id));
  if (!common.length) { nodeFit.set(node.id, IDENTITY); fitLog.push(`${node.id}: no common bone, identity`); continue; }
  const P = concat(common.flatMap((id) => oldGeo.get(id)!.map((p) => p.pos)));
  const Q = concat(common.flatMap((id) => built.get(id)!.parts.map((p) => p.mesh.pos)));
  const { A, rms, axial, cross } = fitBoneTransform(P, Q);
  nodeFit.set(node.id, A);
  const c = centroid(P), m = applyAffine(A, ...c).map((x, k) => x - c[k]);
  fitLog.push(`${node.id}: rms ${(rms * 1000).toFixed(1)} mm, centre moves [${m.map((x) => (x * 1000).toFixed(0)).join(', ')}] mm, axial ${axial.toFixed(3)}, cross ${cross.toFixed(3)}`);
}
writeFileSync(join(STAGE, 'node-fits.txt'), fitLog.join('\n'));
log(`node fits: ${nodeFit.size} rig nodes (details in ${join(STAGE, 'node-fits.txt')})`);
const boneIndexNode = oldRig.bones.map((b) => b.name);

// Residual field: the node fits are rigid + stretch, but O3D also remodelled bone surfaces locally (fossae,
// condyles). For every old bone vertex, record where its surface actually is on the new bone: the fitted position
// moved to the closest point of the new bone surface (if within 15 mm). (triGridOf: section 4.)
const oldPts: number[] = [], oldTarget: number[] = [];
for (const s of oldList) {
  if (s.kind !== 'bone' || built.get(s.id)?.source !== 'o3d') continue;
  const A = nodeFit.get(oldRig.carriedBy.get(s.id)!)!;
  const g = triGridOf(s.id);
  for (const part of oldGeo.get(s.id)!) for (let i = 0; i < part.pos.length; i += 3) {
    const t = applyAffine(A, part.pos[i], part.pos[i + 1], part.pos[i + 2]);
    const [d, qx, qy, qz] = g.closest(t[0], t[1], t[2], 0.015);
    oldPts.push(part.pos[i], part.pos[i + 1], part.pos[i + 2]);
    oldTarget.push(...(Number.isFinite(d) ? [qx, qy, qz] : t));
  }
}
const oldBoneGrid = new PointGrid(Float32Array.from(oldPts), 0.006);

/** Welded vertex adjacency (CSR) of a triangle mesh: vertices with equal positions are one node. */
function adjacency(pos: Float32Array, idx: Uint32Array) {
  const w = weldIds(pos);
  const sets = new Map<number, Set<number>>();
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = w[idx[t + k]], b = w[idx[t + (k + 1) % 3]];
    if (a === b) continue;
    (sets.get(a) ?? sets.set(a, new Set()).get(a)!).add(b);
    (sets.get(b) ?? sets.set(b, new Set()).get(b)!).add(a);
  }
  return { w, nb: sets };
}

/** Smooths a per-vertex vector field over the mesh (Jacobi); `fixed` vertices keep their value. */
function diffuse(field: Float32Array, adj: ReturnType<typeof adjacency>, iters: number, keep: number, fixed?: Uint8Array) {
  const reps = [...adj.nb.keys()];
  for (let it = 0; it < iters; it++) {
    const next = new Float32Array(field);
    for (const v of reps) {
      if (fixed?.[v]) continue;
      const nb = adj.nb.get(v)!;
      let x = 0, y = 0, z = 0;
      for (const u of nb) { x += field[u * 3]; y += field[u * 3 + 1]; z += field[u * 3 + 2]; }
      const n = nb.size;
      next[v * 3] = keep * field[v * 3] + (1 - keep) * x / n;
      next[v * 3 + 1] = keep * field[v * 3 + 1] + (1 - keep) * y / n;
      next[v * 3 + 2] = keep * field[v * 3 + 2] + (1 - keep) * z / n;
    }
    field.set(next);
  }
  // copies of a welded vertex take its value
  for (let v = 0; v < adj.w.length; v++) if (adj.w[v] !== v) { const r = adj.w[v]; field[v * 3] = field[r * 3]; field[v * 3 + 1] = field[r * 3 + 1]; field[v * 3 + 2] = field[r * 3 + 2]; }
}

const fitStats = { pushed: 0, verts: 0 };

/**
 * Pushes vertices that lie inside a new bone out to 0.8 mm above its surface and spreads the push smoothly to their
 * neighbours so the surface does not crease (up to three rounds). Returns how many vertices were inside at first.
 */
function pushOut(out: Float32Array, idx: Uint32Array, adj: ReturnType<typeof adjacency>): number {
  const n = out.length / 3;
  const [lo, hi] = bbox([out]);
  const near = [...built.values()].filter((b) => b.kind === 'bone' && b.source === 'o3d').map((b) => triGridOf(b.id))
    .filter((t) => !(t.lo[0] > hi[0] || t.hi[0] < lo[0] || t.lo[1] > hi[1] || t.hi[1] < lo[1] || t.lo[2] > hi[2] || t.hi[2] < lo[2]));
  if (!near.length) return 0;
  /** Displacement that takes point (x,y,z) out of the bone it is in, or null. */
  const exit = (x: number, y: number, z: number, min: number): number[] | null => {
    for (const t of near) {
      if (!t.inside(x, y, z)) continue;
      const [d, qx, qy, qz] = t.closest(x, y, z, 0.02);
      if (!Number.isFinite(d) || d < min) return null;
      const f = (d + 0.0008) / d;
      return [(qx - x) * f, (qy - y) * f, (qz - z) * f];
    }
    return null;
  };
  let first = 0;
  // vertices inside a bone
  for (let round = 0; round < 3; round++) {
    const disp = new Float32Array(out.length);
    const fixed = new Uint8Array(n);
    let any = 0;
    for (const v of adj.nb.keys()) {
      const e = exit(out[v * 3], out[v * 3 + 1], out[v * 3 + 2], 0.0003);
      if (!e) continue;
      disp.set(e, v * 3); fixed[v] = 1; any++;
    }
    if (!any) break;
    if (round === 0) first = any;
    diffuse(disp, adj, 6, 0.3, fixed);
    for (let i = 0; i < out.length; i++) out[i] += disp[i];
  }
  // triangles straddling a thin bone process (all three corners outside, the middle inside)
  for (let round = 0; round < 2; round++) {
    const disp = new Float32Array(out.length);
    const cnt = new Uint16Array(n);
    let any = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = adj.w[idx[t]], b = adj.w[idx[t + 1]], c = adj.w[idx[t + 2]];
      const x = (out[a * 3] + out[b * 3] + out[c * 3]) / 3, y = (out[a * 3 + 1] + out[b * 3 + 1] + out[c * 3 + 1]) / 3, z = (out[a * 3 + 2] + out[b * 3 + 2] + out[c * 3 + 2]) / 3;
      const e = exit(x, y, z, 0.0005);
      if (!e) continue;
      any++;
      for (const v of [a, b, c]) { disp[v * 3] += e[0]; disp[v * 3 + 1] += e[1]; disp[v * 3 + 2] += e[2]; cnt[v]++; }
    }
    if (!any) break;
    const fixed = new Uint8Array(n);
    for (let v = 0; v < n; v++) if (cnt[v]) { fixed[v] = 1; for (let k = 0; k < 3; k++) disp[v * 3 + k] /= cnt[v]; }
    diffuse(disp, adj, 6, 0.3, fixed);
    for (let i = 0; i < out.length; i++) out[i] += disp[i];
  }
  return first;
}
/**
 * Carries a muscle from the old bones onto the new ones:
 *  1. each vertex moves by the blend of its rig nodes' fits, with the runtime skin weights of the old rig;
 *  2. near a bone (within 20 mm of the old surface) it also follows that surface's local remodelling (residual
 *     field above), fully at the surface, fading out with distance; the correction is smoothed over the mesh;
 *  3. vertices that still end up inside a new bone are pushed out to 0.8 mm above its surface, and the push is
 *     spread smoothly to their neighbours so the surface does not crease.
 */
function warp(s: Structure, pos: Float32Array, idx: Uint32Array): Float32Array {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const spec = resolveSkin(s, oldRig, s.kind === 'muscle' && hasMuscleInfo(s.key) ? muscleInfo(s.key) : undefined);
  skinGeometry(g, spec, oldRig);
  const si = g.getAttribute('skinIndex').array, sw = g.getAttribute('skinWeight').array;
  const n = pos.length / 3;
  const blend = (v: number, x: number, y: number, z: number): V3 => {
    const o: V3 = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const w = sw[v * 4 + k];
      if (!w) continue;
      const t = applyAffine(nodeFit.get(boneIndexNode[si[v * 4 + k]])!, x, y, z);
      o[0] += w * t[0]; o[1] += w * t[1]; o[2] += w * t[2];
    }
    return o;
  };
  const out = new Float32Array(pos.length);
  const corr = new Float32Array(pos.length);
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const b = blend(v, x, y, z);
    out.set(b, v * 3);
    const [j, d2] = oldBoneGrid.nearest(x, y, z, 0.03);
    const d = Math.sqrt(d2);
    if (j < 0 || d > 0.02) continue;
    const tp = blend(v, oldPts[j * 3], oldPts[j * 3 + 1], oldPts[j * 3 + 2]);
    const w = 1 - smoothstep(0.003, 0.02, d);
    for (let k = 0; k < 3; k++) corr[v * 3 + k] = w * (oldTarget[j * 3 + k] - tp[k]);
  }
  const adj = adjacency(pos, idx);
  diffuse(corr, adj, 4, 0.5);
  for (let i = 0; i < out.length; i++) out[i] += corr[i];

  fitStats.pushed += pushOut(out, idx, adj);
  fitStats.verts += adj.nb.size;
  return out;
}

// ---- 7b. limb muscles and tendons from Open 3D Model -------------------------------------------------------------
// O3D modelled its muscles on its own bones, so they need no fitting: the frame shift above puts them in place. Each
// object becomes a part of the app structure MUSCLE_TABLE names (same id, key, label and group as the BodyParts3D
// structure it replaces, existing part keys kept); tendons become parts of their muscle. Vertices that sit inside a
// bone are pushed out as for the fitted muscles (O3D_MUSCLE_PUSH=0 skips that). Done on the right side before
// mirroring, so the left stays the exact mirror image.
const MUSCLE_PUSH = process.env.O3D_MUSCLE_PUSH !== '0';
const o3dMuscle = { pushed: 0, verts: 0, objects: 0 };
for (const o of used.filter((x) => x.use === 'muscle')) {
  const spec = muscleSpec(o.base)!;
  if (MUSCLE_PUSH) {
    const adj = adjacency(o.mesh.pos, o.mesh.idx);
    o3dMuscle.pushed += pushOut(o.mesh.pos, o.mesh.idx, adj);
    o3dMuscle.verts += adj.nb.size;
  }
  o3dMuscle.objects++;
  let pieces: { key: string; mesh: Mesh }[] = [{ key: spec.key, mesh: o.mesh }];
  if (spec.split) pieces = splitToStructures(o, spec.split);
  for (const piece of pieces) {
    const instances = [{ side: o.gside, mesh: piece.mesh }];
    if (o.gside !== 'm' && !sidesPresent.get(`${o.kind}:${o.base}`)!.has(flipSide(o.gside))) instances.push({ side: flipSide(o.gside), mesh: mirrorMesh(piece.mesh) });
    for (const inst of instances) {
      const id = idOf(piece.key, inst.side);
      const old = oldById.get(id);
      if (!old) throw new Error(`O3D muscle "${o.name}" maps to ${id}, which the BodyParts3D build does not have`);
      const label = spec.part.label || old.parts.find((p) => p.key === spec.part.key)?.label || old.label;
      addPart({ id, key: piece.key, kind: 'muscle', side: inst.side, label: old.label, group: old.group, source: 'o3d' },
        { key: spec.part.key, label, mesh: inst.mesh, map: o.map, tex: o.tex, ...(spec.tendon ? { tendon: true } : {}), ...(o.alpha !== undefined && o.map ? { alpha: o.alpha } : {}) });
    }
  }
}
// Existing part keys first, in the BodyParts3D order, then the new parts (tendons, extra heads, digits).
for (const b of built.values()) {
  if (b.kind !== 'muscle' || b.source !== 'o3d') continue;
  const order = oldById.get(b.id)!.parts.map((p) => p.key);
  const rank = (k: string) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  b.parts = b.parts.map((p, i) => ({ p, i })).sort((a, c) => rank(a.p.key) - rank(c.p.key) || a.i - c.i).map((x) => x.p);
  const missing = order.filter((k) => !b.parts.some((p) => p.key === k));
  if (missing.length) throw new Error(`${b.id}: O3D build lacks the app part(s) ${missing.join(', ')}`);
}
const o3dMuscleIds = [...built.values()].filter((b) => b.kind === 'muscle' && b.source === 'o3d').map((b) => b.id);
log(`O3D muscles: ${o3dMuscle.objects} objects -> ${o3dMuscleIds.length} structures; ${o3dMuscle.pushed} of ${o3dMuscle.verts} vertices were inside a bone and were pushed out`);

/**
 * Splits an O3D object that holds several app structures (the lumbricals of the foot) into its connected pieces and
 * hands each to the nearest structure: the BodyParts3D one, fitted onto the new bones, on the object's side. Every
 * structure must receive exactly one piece.
 */
function splitToStructures(o: Obj, keys: string[]): { key: string; mesh: Mesh }[] {
  const w = weldIds(o.mesh.pos);
  const comps = components(o.mesh.pos, Uint32Array.from(o.mesh.idx, (v) => w[v]));
  if (comps.length !== keys.length) throw new Error(`${o.name}: ${comps.length} pieces for ${keys.length} structures`);
  const target = keys.map((k) => {
    const s = oldById.get(idOf(k, o.gside))!;
    return centroid(concat(oldGeo.get(s.id)!.map((p) => warp(s, p.pos, p.idx))));
  });
  const pieces = comps.map((tris) => subMesh(o.mesh, tris));
  const cs = pieces.map((p) => centroid(p.pos));
  const D = cs.map((c) => target.map((t) => Math.hypot(c[0] - t[0], c[1] - t[1], c[2] - t[2])));
  // Assignment with the smallest total distance (at most 4! permutations).
  const perms = (n: number): number[][] => (n === 1 ? [[0]] : perms(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)])));
  let best = perms(keys.length)[0], bestCost = Infinity;
  for (const p of perms(keys.length)) { const c = p.reduce((a, k, i) => a + D[i][k], 0); if (c < bestCost) { bestCost = c; best = p; } }
  // Cross-check with anatomy: structures are listed medial to lateral (first lumbrical next to the hallux), so the
  // assignment must order the pieces by their distance from the midline the same way.
  const byMedial = pieces.map((_, i) => i).sort((a, b) => Math.abs(cs[a][0]) - Math.abs(cs[b][0]));
  if (!byMedial.every((pi, r) => best[pi] === r)) throw new Error(`${o.name}: nearest-structure assignment ${best.join(',')} disagrees with the medial-to-lateral order`);
  return pieces.map((piece, i) => {
    const k = best[i];
    if (D[i][k] > 0.025) throw new Error(`${o.name}: piece ${i} is ${(D[i][k] * 1000).toFixed(1)} mm from ${keys[k]}`);
    log(`  ${o.name}: piece ${piece.idx.length / 3} tris -> ${keys[k]} (${(D[i][k] * 1000).toFixed(1)} mm from the fitted BodyParts3D centroid)`);
    return { key: keys[k], mesh: piece };
  });
}

for (const s of oldList) {
  if (s.kind !== 'muscle' || s.schematic || built.has(s.id)) continue;
  const parts = oldGeo.get(s.id)!;
  built.set(s.id, {
    id: s.id, key: s.key, kind: 'muscle', side: s.side, label: s.label, group: s.group, source: 'bp3d',
    parts: parts.map((p) => ({ key: p.key, label: s.parts.find((x) => x.key === p.key)?.label ?? s.label, mesh: { pos: warp(s, p.pos, p.idx), idx: p.idx } })),
  });
}

log(`muscles: ${fitStats.pushed} of ${fitStats.verts} vertices were inside a new bone after the fit and were pushed out`);

// Hyoid: not in O3D. Kept from BodyParts3D and moved with its neighbours (mean displacement of the mandible and C3
// fits at its centre).
{
  const s = oldById.get('hyoid')!;
  const parts = oldGeo.get('hyoid')!;
  const c = centroid(concat(parts.map((p) => p.pos)));
  const d = [oldRig.carriedBy.get('mandible')!, oldRig.carriedBy.get('c3')!].map((n) => applyAffine(nodeFit.get(n)!, ...c).map((x, k) => x - c[k]));
  const shift = [0, 1, 2].map((k) => (d[0][k] + d[1][k]) / 2);
  built.set('hyoid', {
    id: 'hyoid', key: 'hyoid', kind: 'bone', side: 'm', label: s.label, group: s.group, source: 'bp3d',
    parts: parts.map((p) => ({ key: p.key, label: s.label, mesh: { pos: Float32Array.from(p.pos, (x, i) => x + shift[i % 3]), idx: p.idx } })),
  });
  log(`hyoid: kept from BodyParts3D, moved by [${shift.map((x) => (x * 1000).toFixed(1)).join(', ')}] mm`);
}

// ---- 8. schematic muscles, regenerated against the new bones ----------------------------------------------------
const vertCache = new Map<string, Float32Array | null>();
const ctx = {
  has: (id: string) => built.has(id),
  verts(id: string) {
    if (!vertCache.has(id)) vertCache.set(id, built.has(id) ? concat(built.get(id)!.parts.map((p) => p.mesh.pos)) : null);
    return vertCache.get(id)!;
  },
  centroid(id: string) { return centroid(this.verts(id)!); },
};
const schematic: string[] = [];
for (const d of makeSchematic(ctx) as { id: string; key: string; label: string; side: Side; group: string; parts: { key: string; label: string; geom: Mesh }[] }[]) {
  if (built.has(d.id)) continue;
  for (const p of d.parts) pushOut(p.geom.pos, p.geom.idx, adjacency(p.geom.pos, p.geom.idx)); // the loft may cut a bone corner
  built.set(d.id, { id: d.id, key: d.key, kind: 'muscle', side: d.side, label: d.label, group: d.group, source: 'bp3d', schematic: true, parts: d.parts.map((p) => ({ key: p.key, label: p.label, mesh: p.geom })) });
  schematic.push(d.id);
}
log('schematic:', schematic.join(' '));

// ---- 8a. density of the stored meshes ----------------------------------------------------------------------------
// Everything above worked on the source bones and a dense working set. What is stored is thinned to DENSITY: bones and
// textured soft tissue with their UV seams locked, cartilage, untextured soft tissue and the BodyParts3D muscles
// (smooth shapes without a texture) freely; none moves its surface by more than the error given there. A right-side
// structure that is the mirror image of its left twin is made from the thinned twin, so the two stay mirror images
// vertex for vertex. O3D_DENSITY=0 stores the working set as it is.
if (DENSITY_SCALE) {
  const before = { tris: 0 }, after = { tris: 0 };
  const count = (b: Built) => b.parts.reduce((a, p) => a + p.mesh.idx.length / 3, 0);
  const thin = (b: Built, p: Part): Mesh => {
    const m = p.mesh, tris = m.idx.length / 3;
    const textured = !!(m.uv && (p.map || p.tex));
    const d = b.kind === 'bone' ? DENSITY.bone : b.kind === 'articular' || b.kind === 'fibrocartilage' ? DENSITY.cartilage : b.kind === 'muscle' ? DENSITY.bp3dMuscle : textured ? DENSITY.softTextured : DENSITY.softPlain;
    const want = trisAt(m, d.mm2);
    if (textured) return simplifyTextured(m, want, d.error);
    return simplify(m.uv ? { pos: m.pos, idx: m.idx, ...(m.ref ? { ref: m.ref } : {}) } : m, want / tris, b.kind === 'bone' ? 200 : SOFT_KINDS.includes(b.kind) ? 120 : 300, d.error);
  };
  // Mirror images as sets of vertices: the pieces of a digit object may have been joined in another order on the
  // other side, and a few objects are stored for both sides (mirror images to within microns).
  const cloud = (m: Mesh, sign: number) => {
    const keys: string[] = [];
    for (let i = 0; i < m.pos.length; i += 3) keys.push(`${Math.round(sign * m.pos[i] * 5e4)},${Math.round(m.pos[i + 1] * 5e4)},${Math.round(m.pos[i + 2] * 5e4)}`);
    return keys.sort().join(';');
  };
  const mirrorOf = (a: Mesh, b: Mesh) => a.pos.length === b.pos.length && a.idx.length === b.idx.length && cloud(a, 1) === cloud(b, -1);
  const wanted = (b: Built) => (b.kind === 'bone' && b.source === 'o3d') || b.kind === 'articular' || b.kind === 'fibrocartilage' || SOFT_KINDS.includes(b.kind)
    || (b.kind === 'muscle' && b.source === 'bp3d' && !b.schematic);
  const done = new Map<string, Mesh[]>(); // left structure id -> its parts before thinning
  for (const b of [...built.values()].filter(wanted).sort((a, c) => a.id.localeCompare(c.id))) {
    before.tris += count(b);
    const twin = b.side === 'r' ? built.get(b.id.replace(/-r$/, '-l')) : undefined;
    const twinWas = twin ? done.get(twin.id) : undefined;
    if (twin && twinWas && twinWas.length === b.parts.length && b.parts.every((p, i) => mirrorOf(p.mesh, twinWas[i]))) {
      b.parts.forEach((p, i) => { p.mesh = mirrorMesh(twin.parts[i].mesh); });
    } else {
      if (b.side === 'l') done.set(b.id, b.parts.map((p) => p.mesh));
      for (const p of b.parts) p.mesh = thin(b, p);
    }
    after.tris += count(b);
  }
  log(`density: ${before.tris} -> ${after.tris} triangles in the bones, joint cartilage, soft tissue and BodyParts3D muscles`);
}

// ---- 8b. proximity skin of the soft tissue, baked ---------------------------------------------------------------
// Structures fixed to the bones of several rig nodes (ligaments, capsules, sheaths, retinacula, fasciae spanning a
// joint) are blended between them by proximity (app/lib/rig/skinning.ts, skinAttach). That search takes seconds, so it
// runs here, on the rig the app builds from this manifest, and ships as vertex attributes: JOINTS_0 = index into the
// structure's `skin` list of rig node ids, WEIGHTS_0 = weights (normalised bytes). The viewer maps the node ids to its
// rig bones. The build has what the viewer lacks: the turning joint surfaces a capsule slides over, the bone surfaces
// to test against, and a rig of its own to pose, so skinAttach can release what tears at the ends of range.
const manifestOf = (s: Built): Structure => {
  const arrays = s.parts.map((p) => p.mesh.pos);
  const [lo, hi] = bbox(arrays);
  return {
    id: s.id, key: s.key, kind: s.kind, side: s.side, label: s.label, group: s.group,
    parts: s.parts.map((p) => ({ key: p.key, label: p.label, tris: p.mesh.idx.length / 3, ...(p.tendon ? { tendon: true } : {}), ...(p.alpha !== undefined ? { alpha: p.alpha } : {}) })),
    ...(s.schematic ? { schematic: true } : {}),
    source: s.source,
    ...(s.attach ? { attach: s.attach } : {}),
    ...(s.skin ? { skin: s.skin.nodes } : {}),
    ...(s.strainEnds ? { strainEnds: s.strainEnds } : {}),
    ...(s.fit ? { fit: s.fit } : {}),
    bbox: [lo.map(r4) as V3, hi.map(r4) as V3],
    lm: landmarks(arrays, lo, hi) as unknown as Structure['lm'],
  };
};
{
  const t0 = Date.now();
  const newRig = new Rig(new Map([...built.values()].map((s) => [s.id, manifestOf(s)])));
  const carried = (node: number) => newRig.nodes.get(newRig.bones[node].name)!.carries;
  const newProx = new BoneProximity((node) => carried(node).flatMap((id) => built.get(id)?.parts.map((p) => p.mesh.pos) ?? []));
  // Joint surfaces that turn about their joint's centre (the cartilage the rig's fits were made to: humeral and femoral
  // heads, femoral condyles, distal humerus), sampled every 1.5 mm: soft tissue lying over them slides (skinAttach).
  const turning = new Map<string, Float32Array[]>();
  for (const c of built.values()) {
    if (c.kind !== 'articular' || c.attach?.length !== 1 || !(c.fit?.sphere || c.fit?.axis)) continue;
    (turning.get(c.attach[0]) ?? turning.set(c.attach[0], []).get(c.attach[0])!).push(...c.parts.map((p) => surfacePoints(p.mesh.pos, p.mesh.idx, 0.0015)));
  }
  const slide = new BoneProximity((node) => carried(node).flatMap((id) => turning.get(id) ?? []));
  /** Depth of a point inside the bones a rig node carries (0 outside). */
  const inside = (node: number, x: number, y: number, z: number) => {
    let d = 0;
    for (const id of carried(node)) {
      if (built.get(id)?.kind !== 'bone') continue;
      const g = triGridOf(id);
      if (!g.inside(x, y, z)) continue;
      const c = g.closest(x, y, z, 0.03)[0];
      d = Math.max(d, Number.isFinite(c) ? c : 0.03);
    }
    return d;
  };
  const otherSide = (id: string) => id.replace(/-([lr])$/, (_, sd) => (sd === 'l' ? '-r' : '-l'));
  let n = 0, verts = 0, mirrored = 0;
  // The skins of the structures that are not a mirror image take most of the build (a minute or more each for the digit
  // sheaths and the knee), and each is independent of the others: they are shared out between SKIN_SHARDS processes
  // (this one and the children started at the top, each repeating the cheap steps before this one), the children write
  // theirs to a file, and this process collects them. Output is the same as computing them one after the other.
  type SkinJob = { s: Built; spec: ReturnType<typeof resolveSkin>; cost: number };
  const jobs: SkinJob[] = [], mirrors: (() => void)[] = [];
  for (const s of [...built.values()].filter((b) => SOFT_KINDS.includes(b.kind)).sort((a, b) => a.id.localeCompare(b.id))) {
    const spec = resolveSkin(manifestOf(s), newRig);
    if (spec.mode !== 'attach') continue;
    n++; verts += s.parts.reduce((a, p) => a + p.mesh.pos.length / 3, 0);
    // The right side is the mirror image of the left, vertex for vertex: its skin is the left one on the right nodes.
    const twin = s.side === 'r' ? built.get(otherSide(s.id)) : undefined;
    if (twin?.skin && twin.skin.nodes.length === spec.nodes.length && twin.skin.nodes.every((id) => spec.nodes.includes(otherSide(id)))
      && twin.parts.length === s.parts.length && twin.parts.every((p, i) => p.mesh.pos.length === s.parts[i].mesh.pos.length)) {
      const to = twin.skin.nodes.map((id) => spec.nodes.indexOf(otherSide(id)));
      s.skin = { nodes: spec.nodes, parts: [] };
      mirrors.push(() => {
        s.skin = { nodes: spec.nodes, parts: twin.skin!.parts.map((p) => ({ joints: Uint8Array.from(p.joints, (j, i) => (p.weights[i] >= 0.5 / 255 ? to[j] : 0)), weights: p.weights })) };
      });
      mirrored++;
      continue;
    }
    s.skin = { nodes: spec.nodes, parts: [] }; // (until its job has run: a mirrored twin checks the nodes)
    jobs.push({ s, spec, cost: s.parts.reduce((a, p) => a + p.mesh.pos.length / 3, 0) * spec.nodes.length });
  }
  // longest first onto the least loaded shard
  const shardOf = new Map<SkinJob, number>(), load = new Array<number>(SKIN_SHARDS).fill(0);
  for (const j of [...jobs].sort((a, b) => b.cost - a.cost)) {
    const k = load.indexOf(Math.min(...load));
    shardOf.set(j, k); load[k] += j.cost;
  }
  for (const { s, spec } of jobs.filter((j) => shardOf.get(j) === SKIN_SHARD)) {
    const geoms = s.parts.map((p) => {
      const g = new THREE.BufferGeometry();
      // a sheet given thickness is skinned as the sheet it was (Mesh.ref)
      g.setAttribute('position', new THREE.BufferAttribute(p.mesh.ref ?? p.mesh.pos, 3));
      g.setIndex(new THREE.BufferAttribute(p.mesh.idx, 1));
      return g;
    });
    // (the knee's synovial membrane needs the wide rim at once: 3 mm first costs it 60 % more bone intrusion; phase 8)
    skinAttach(geoms, spec.nodes, newRig, newProx, { slide, release: true, inside, ...(s.key === 'knee-synovial-membrane' ? { erodeFirst: ATTACH_ERODE } : {}) });
    const local = new Map(spec.nodes.map((id, i) => [newRig.node(id).index, i]));
    s.skin = {
      nodes: spec.nodes,
      parts: geoms.map((g) => {
        const si = g.getAttribute('skinIndex').array as Uint16Array, sw = g.getAttribute('skinWeight').array as Float32Array;
        return { joints: Uint8Array.from(si, (b, i) => (sw[i] >= 0.5 / 255 ? local.get(b)! : 0)), weights: Float32Array.from(sw) };
      }),
    };
  }
  if (SKIN_CHILD) {
    // a child: hand its skins over and stop
    mkdirSync(SHARD_DIR, { recursive: true });
    const mine: Record<string, { joints: number[]; weights: number[] }[]> = {};
    for (const { s } of jobs.filter((j) => shardOf.get(j) === SKIN_SHARD)) mine[s.id] = s.skin!.parts.map((p) => ({ joints: Array.from(p.joints), weights: Array.from(p.weights) }));
    writeFileSync(join(SHARD_DIR, `shard-${SKIN_SHARD}.json`), JSON.stringify(mine));
    process.exit(0);
  }
  await Promise.all(kids);
  for (let k = 1; k < SKIN_SHARDS; k++) {
    const theirs: Record<string, { joints: number[]; weights: number[] }[]> = JSON.parse(readFileSync(join(SHARD_DIR, `shard-${k}.json`), 'utf8'));
    for (const { s } of jobs.filter((j) => shardOf.get(j) === k)) s.skin!.parts = theirs[s.id].map((p) => ({ joints: Uint8Array.from(p.joints), weights: Float32Array.from(p.weights) }));
  }
  for (const m of mirrors) m();
  log(`soft-tissue skin: ${n} structures blended across rig nodes (${mirrored} taken from their left twin), ${verts} vertices, ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  // Open 3D Model muscles: the skin the viewer would work out on load (skinStructure -> skinParts: the chain laid over
  // all parts, tendons handed to the digits, foot and patella by their distance to those bones), baked the same way,
  // and the strain ends (the attachment vertices) as bind-pose positions. Saves ~0.4 s of load. BodyParts3D muscles
  // (28 ms of work for as many vertices again) stay with the viewer.
  const tm = Date.now();
  let muscles = 0, mverts = 0;
  for (const s of [...built.values()].filter((b) => b.kind === 'muscle' && b.source === 'o3d').sort((a, b) => a.id.localeCompare(b.id))) {
    const manifest = manifestOf(s);
    const geoms = s.parts.map((p) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.mesh.pos, 3));
      return g;
    });
    const res = skinStructure(manifest, geoms, resolveSkin(manifest, newRig, hasMuscleInfo(s.key) ? muscleInfo(s.key) : undefined), newRig, newProx);
    const skins = geoms.map((g) => ({ si: g.getAttribute('skinIndex').array as Uint16Array, sw: g.getAttribute('skinWeight').array as Float32Array }));
    const used = new Set<number>();
    for (const { si, sw } of skins) for (let i = 0; i < si.length; i++) if (sw[i] >= 0.5 / 255) used.add(si[i]);
    const bones = [...used].sort((a, b) => a - b);
    if (!bones.length || bones.length > 255) throw new Error(`${s.id}: ${bones.length} skin nodes`);
    const local = new Map(bones.map((b, i) => [b, i]));
    s.skin = {
      nodes: bones.map((b) => newRig.bones[b].name),
      parts: skins.map(({ si, sw }) => ({ joints: Uint8Array.from(si, (b, i) => (sw[i] >= 0.5 / 255 ? local.get(b)! : 0)), weights: Float32Array.from(sw) })),
    };
    if (res.ends && res.endBones) {
      const at = res.ends.map((e) => [0, 1, 2].map((k) => Math.round(s.parts[e.part].mesh.pos[e.v * 3 + k] * 1e5) / 1e5) as V3) as [V3, V3];
      s.strainEnds = { at, nodes: [newRig.bones[res.endBones[0]].name, newRig.bones[res.endBones[1]].name] };
    }
    muscles++; mverts += s.parts.reduce((a, p) => a + p.mesh.pos.length / 3, 0);
  }
  log(`muscle skin: ${muscles} Open 3D Model muscles, ${mverts} vertices, ${((Date.now() - tm) / 1000).toFixed(1)} s`);
}

// ---- 9. write ---------------------------------------------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
/**
 * Base-colour atlases already stored in an earlier file (muscles.glb), by image: a later file (ligaments.glb) does not
 * store them again but names them in the material's extras (`{ map: <texture name> }`); the viewer takes the texture
 * it already has. Normal maps are stored in the file that uses them, once per image.
 */
const storedMaps = new Map<Uint8Array, string>();

/**
 * Images as they are stored. The viewer shrinks each normal map to NORMAL_TEXELS_PER_M texels per metre of the largest
 * structure that uses it (a power of two, at least 128 px; app/lib/three/viewer.ts), so a map stored larger than that
 * is only download: it is stored at that size. Every image is then re-encoded as WebP (EXT_texture_webp, which
 * three.js's GLTFLoader reads without further set-up) when that is smaller than the source JPEG. Needs `sharp`; without
 * it, or with O3D_TEXTURES=0, the source images are stored unchanged.
 */
const NORMAL_TEXELS_PER_M = 4000, WEBP_QUALITY = 90;
const stored = new Map<Uint8Array, { image: Uint8Array; mime: string }>();
if (TEXTURES) {
  type Sharp = (input: Uint8Array) => { metadata(): Promise<{ width?: number; height?: number }>; resize(w: number, h: number, o: object): ReturnType<Sharp>; webp(o: object): ReturnType<Sharp>; raw(): ReturnType<Sharp>; removeAlpha(): ReturnType<Sharp>; toBuffer(): Promise<Buffer> };
  // sharp is not a declared dependency (it comes with Next), so it is looked up by name at run time; typed above for what is used
  const sharpModule = 'sharp';
  const sharp: Sharp | null = await import(sharpModule).then((x: { default: unknown }) => x.default as Sharp, () => null);
  if (!sharp) log('textures: sharp is not installed, storing the source images unchanged');
  else {
    const need = new Map<Uint8Array, number>(); // normal map -> px the viewer keeps
    const maps = new Set<Uint8Array>();
    for (const b of built.values()) {
      const [lo, hi] = bbox(b.parts.map((p) => p.mesh.pos));
      const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
      for (const p of b.parts) {
        if (!p.mesh.uv) continue;
        if (p.tex) need.set(p.tex.image, Math.max(need.get(p.tex.image) ?? 0, Math.max(128, 2 ** Math.ceil(Math.log2(diag * NORMAL_TEXELS_PER_M)))));
        if (p.map) maps.add(p.map.image);
      }
    }
    let before = 0, after = 0, shrunk = 0, webp = 0, mse = 0, pixels = 0;
    for (const image of [...need.keys(), ...maps]) {
      if (stored.has(image)) continue;
      const meta = await sharp(image).metadata();
      const size = Math.min(meta.width!, need.get(image) ?? meta.width!);
      const resized = size < meta.width! ? sharp(image).resize(size, size, { kernel: 'lanczos3' }) : sharp(image);
      const out = new Uint8Array(await resized.webp({ quality: WEBP_QUALITY, effort: 6, smartSubsample: true }).toBuffer());
      before += image.byteLength;
      if (size === meta.width! && out.byteLength >= image.byteLength) { stored.set(image, { image, mime: 'image/jpeg' }); after += image.byteLength; continue; }
      // how far the stored image is from the source at that size (for the log)
      const ref = await (size < meta.width! ? sharp(image).resize(size, size, { kernel: 'lanczos3' }) : sharp(image)).removeAlpha().raw().toBuffer();
      const got = await sharp(out).removeAlpha().raw().toBuffer();
      for (let i = 0; i < ref.length; i++) mse += (ref[i] - got[i]) ** 2;
      pixels += ref.length;
      stored.set(image, { image: out, mime: 'image/webp' });
      after += out.byteLength; webp++;
      if (size < meta.width!) shrunk++;
    }
    log(`textures: ${stored.size} images, ${(before / 1e6).toFixed(2)} -> ${(after / 1e6).toFixed(2)} MB; ${shrunk} normal maps stored at the size the viewer uses, ${webp} as WebP (quality ${WEBP_QUALITY}, PSNR ${(10 * Math.log10(255 * 255 / (mse / Math.max(1, pixels)))).toFixed(1)} dB against the source at that size)`);
  }
}

/**
 * Skin weights as normalised bytes: each vertex's four weights in 255ths, rounded so that they add up to exactly 255
 * (the largest takes the remainder). A third of the size of floats in the file, and unlike quantised floats the sum is
 * exact, so a vertex is not scaled towards the origin by a rounding error.
 */
function weightBytes(w: Float32Array): Uint8Array {
  const out = new Uint8Array(w.length);
  for (let i = 0; i < w.length; i += 4) {
    const sum = w[i] + w[i + 1] + w[i + 2] + w[i + 3] || 1;
    let top = 0, used = 0;
    for (let k = 0; k < 4; k++) { out[i + k] = Math.round((255 * w[i + k]) / sum); used += out[i + k]; if (w[i + k] > w[i + top]) top = k; }
    out[i + top] += 255 - used;
  }
  return out;
}

function writeDoc(kinds: Kind[], label: string) {
  const doc = new Document();
  doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({
    method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER, encodeSpeed: DRACO_SPEED[0], decodeSpeed: DRACO_SPEED[1],
    quantizationBits: { POSITION: 14, TEX_COORD: 12 },
  });
  const buffer = doc.createBuffer();
  const plain = doc.createMaterial('base').setBaseColorFactor([0.85, 0.8, 0.75, 1]).setRoughnessFactor(0.7).setMetallicFactor(0);
  const mats = new Map<Uint8Array, Material>();
  const texs = new Map<Uint8Array, Texture>();
  const texture = (t: Tex) => {
    let x = texs.get(t.image);
    if (!x) {
      const st = stored.get(t.image) ?? { image: t.image, mime: t.mime };
      if (st.mime === 'image/webp') doc.createExtension(EXTTextureWebP).setRequired(true);
      texs.set(t.image, (x = doc.createTexture(t.name).setImage(st.image).setMimeType(st.mime)));
      texBytes += st.image.byteLength;
    }
    return x;
  };
  /** Muscle materials: one per (base-colour texture, normal map) pair. */
  const muscleMats = new Map<string, Material>();
  const scene = doc.createScene(label);
  const manifest: Structure[] = [];
  let tris = 0, verts = 0, texBytes = 0;
  for (const s of [...built.values()].filter((x) => kinds.includes(x.kind)).sort((a, b) => a.id.localeCompare(b.id))) {
    const node = doc.createNode(s.id).setExtras({ id: s.id, kind: s.kind });
    scene.addChild(node);
    s.parts.forEach((p, pi) => {
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(p.mesh.pos).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(p.mesh.idx).setBuffer(buffer));
      const sk = s.skin?.parts[pi];
      if (sk) {
        prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(sk.joints).setBuffer(buffer));
        prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weightBytes(sk.weights)).setNormalized(true).setBuffer(buffer));
      }
      let mat = plain;
      if (p.map && p.mesh.uv && storedMaps.has(p.map.image) && !texs.has(p.map.image)) {
        // Soft tissue on a muscle atlas stored in muscles.glb: name it instead of storing it again.
        prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(p.mesh.uv).setBuffer(buffer));
        const ref = storedMaps.get(p.map.image)!;
        const k = `ref:${ref}|${p.tex?.name ?? ''}`;
        let m = muscleMats.get(k);
        if (!m) {
          m = doc.createMaterial(`${label}: ${ref}${p.tex ? ` + ${p.tex.name}` : ''}`).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.6).setMetallicFactor(0).setExtras({ map: ref });
          if (p.tex) m.setNormalTexture(texture(p.tex));
          muscleMats.set(k, m);
        }
        mat = m;
      } else if (p.map && p.mesh.uv) {
        // Muscle with a fibre texture (and, for the extensor hoods, a normal map).
        prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(p.mesh.uv).setBuffer(buffer));
        const k = `${p.map.name}|${p.tex?.name ?? ''}`;
        let m = muscleMats.get(k);
        if (!m) {
          m = doc.createMaterial(`muscle: ${p.map.name}`).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.62).setMetallicFactor(0).setBaseColorTexture(texture(p.map));
          if (p.tex) m.setNormalTexture(texture(p.tex));
          muscleMats.set(k, m);
        }
        if (!storedMaps.has(p.map.image)) storedMaps.set(p.map.image, p.map.name);
        mat = m;
      } else if (p.tex && p.mesh.uv) {
        prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(p.mesh.uv).setBuffer(buffer));
        let m = mats.get(p.tex.image);
        if (!m) {
          m = doc.createMaterial(p.tex.name).setBaseColorFactor([0.9, 0.8, 0.69, 1]).setRoughnessFactor(0.6).setMetallicFactor(0).setNormalTexture(texture(p.tex));
          mats.set(p.tex.image, m);
        }
        mat = m;
      }
      prim.setMaterial(mat);
      node.addChild(doc.createNode(`${s.id}:${p.key}`).setMesh(doc.createMesh(`${s.id}:${p.key}`).addPrimitive(prim)).setExtras({ part: p.key }));
      tris += p.mesh.idx.length / 3;
      verts += p.mesh.pos.length / 3;
    });
    manifest.push(manifestOf(s));
  }
  return { doc, manifest, tris, verts, texBytes };
}

// muscles before ligaments: ligaments.glb refers to the atlases muscles.glb stores (see storedMaps).
const files: [string, Kind[]][] = [['skeleton', ['bone', 'disc', 'cartilage']], ['joints', ['articular', 'fibrocartilage']], ['muscles', ['muscle']], ['ligaments', SOFT_KINDS]];
const all: Structure[] = [];
for (const [name, kinds] of files) {
  const r = writeDoc(kinds, name);
  await io.write(join(OUT, `${name}.glb`), r.doc);
  all.push(...r.manifest);
  const count = (k: Kind) => r.manifest.filter((s) => s.kind === k).length;
  log(`${name}.glb: ${kinds.map((k) => `${k} ${count(k)}`).join(', ')}; ${r.tris} tris, ${r.verts} verts, textures ${(r.texBytes / 1e6).toFixed(2)} MB, file ${(statSync(join(OUT, `${name}.glb`)).size / 1e6).toFixed(2)} MB`);
}
writeFileSync(join(OUT, 'structures.json'), JSON.stringify(all));
log(`structures.json: ${all.length} structures, ${(statSync(join(OUT, 'structures.json')).size / 1e6).toFixed(2)} MB`);

if (OUT === DEFAULT_OUT) {
  const dracoSrc = join(ROOT, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf');
  const dracoDst = join(ROOT, 'public', 'draco');
  mkdirSync(dracoDst, { recursive: true });
  for (const f of readdirSync(dracoSrc)) copyFileSync(join(dracoSrc, f), join(dracoDst, f));
}
