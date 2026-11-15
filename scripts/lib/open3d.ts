// Open 3D Model (O3D) source rules: which files, how their object names are cleaned, which side an object is on,
// how a right-only object is mirrored, and how an O3D object maps onto the app's structure keys.
// Pure functions and tables only (no I/O), so they are unit-tested in tests/open3d.test.ts.
//
// Frame: O3D is metres, y up, +z anterior, the figure's right at -x: the same axes as the app. It stores the right
// side and the midline only; the left side is made here by mirroring (x -> -x).

export type Side = 'l' | 'r' | 'm';

/** Source files, as downloaded from caskanatomy.info (see .cache/open3d/SOURCES.md). Verified before every build. */
export const O3D_FILES = {
  'overview-skeleton': {
    url: 'https://caskanatomy.info/open3dviewer/3dmodels/overview-skeleton/overview-skeleton.glb',
    bytes: 3422276,
    sha256: 'e83543abb5c8de013a4bdcbf2c0536ae1ce92980c7aa7951c6aa3ddea804d10f',
  },
  'upper-limb': {
    url: 'https://caskanatomy.info/open3dviewer/3dmodels/upper-limb/upper-limb.glb',
    bytes: 6799076,
    sha256: '9a8b824935a399aef750c7b78bacdccfb54ae7104c3065147de0f37f69d82dfe',
  },
  'lower-limb': {
    url: 'https://caskanatomy.info/open3dviewer/3dmodels/lower-limb/lower-limb.glb',
    bytes: 6597544,
    sha256: '5ecb1ef4c07a2f6aa17021ee6f6d0bb0587595821467ec8c6a14f24ee1091173',
  },
} as const;
export type O3DFile = keyof typeof O3D_FILES;

// ---- names ------------------------------------------------------------------------------------------------------

/** Known typos and malformed names in the source, fixed explicitly (applied after whitespace clean-up). */
export const NAME_FIXES: [RegExp, string][] = [
  [/^Annulus fibrosus L1 L20$/, 'Annulus fibrosus L1 L2'],
  [/^Anulus fibrosus/, 'Annulus fibrosus'],
  [/\bsteroclavicular\b/, 'sternoclavicular'],
  [/\bIshciofemoral\b/, 'Ischiofemoral'],
  [/\bcollatertal\b/, 'collateral'],
  [/^Oblique cord or /, 'Oblique cord of '],
  [/^Cruciform ligaments or /, 'Cruciform ligaments of '],
  [/^Costal cart of (\d+(?:st|nd|rd|th))\.rib/, 'Costal cart of $1 rib'],
  [/^Vertebra (\w+) art cart\.$/, 'Vertebra $1 art cart'],
  [/^Art cart of ulna\. /, 'Art cart of ulna '],
  [/ of 2d finger/, ' of 2nd finger'],
  [/ of 3d finger/, ' of 3rd finger'],
];

/**
 * Objects that two source files name alike although they are different structures (hand and foot), renamed in the
 * file named here so the build keeps both (it otherwise treats a repeated name as the same object, as for the bones).
 */
export const FILE_RENAMES: Partial<Record<string, Record<string, string>>> = {
  'lower-limb': { 'Articular capsules of distal interphalangeal joints': 'Articular capsules of distal interphalangeal joints of foot' },
};

/**
 * Normalises an O3D object name: drops zero-width characters, turns tabs and underscores into spaces, collapses
 * runs of spaces, fixes a doubled side suffix ("Scapula.r." -> "Scapula.r") and applies NAME_FIXES.
 */
export function cleanName(raw: string): string {
  let s = raw.replace(/[​-‍⁠﻿]/g, '').replace(/[\t_]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+\.(r|l)$/, '.$1').replace(/\.(r|l)\.$/, '.$1');
  for (const [re, to] of NAME_FIXES) s = s.replace(re, to);
  return s.trim();
}

/** Splits a side suffix (".r" / ".l", or a trailing " right"/" left" word) off a cleaned name. */
export function splitSide(name: string): { base: string; side: 'l' | 'r' | null } {
  let m = name.match(/^(.*?)\s*\.(r|l)$/);
  if (m) return { base: m[1].trim(), side: m[2] as 'l' | 'r' };
  m = name.match(/^(.*?)\s+(right|left)$/i);
  if (m) return { base: m[1].trim(), side: m[2].toLowerCase() === 'left' ? 'l' : 'r' };
  return { base: name, side: null };
}

// ---- side from geometry -----------------------------------------------------------------------------------------

/** Within this distance of x = 0 (metres) an extent counts as touching the midline. */
export const MIDLINE_TOL = 0.003;

/**
 * Which side an object lies on, from its x extent alone (names are unreliable: 112 right-side objects carry no
 * ".r"). 'm' = it spans the midline roughly symmetrically (a whole midline structure, or a pair stored as one
 * object); otherwise the side its extent lies on, figure's right = -x.
 */
export function geometricSide(minX: number, maxX: number): Side {
  if (minX < -MIDLINE_TOL && maxX > MIDLINE_TOL) {
    const sym = Math.min(-minX, maxX) / Math.max(-minX, maxX);
    if (sym > 0.5) return 'm';
  }
  return minX + maxX < 0 ? 'r' : 'l';
}

// ---- mirroring --------------------------------------------------------------------------------------------------

/** Mirror image of positions in the sagittal plane (x -> -x). */
export function mirrorPositions(pos: Float32Array): Float32Array {
  const out = new Float32Array(pos);
  for (let i = 0; i < out.length; i += 3) out[i] = -out[i];
  return out;
}

/**
 * Mirrors a direction attribute. Normals (itemSize 3): x -> -x. Tangents (itemSize 4, glTF xyzw): x -> -x and the
 * handedness w -> -w, because mirroring flips the tangent frame while the UVs (and so the bitangent) stay put.
 * The app ships no tangents (three.js derives the frame per pixel from the UVs, which is mirror-safe), but phase 2
 * texture work may bake them, and must then mirror them this way.
 */
export function mirrorVectors(v: Float32Array, itemSize: 3 | 4): Float32Array {
  const out = new Float32Array(v);
  for (let i = 0; i < out.length; i += itemSize) {
    out[i] = -out[i];
    if (itemSize === 4) out[i + 3] = -out[i + 3];
  }
  return out;
}

/** Reverses the winding of every triangle, so a mirrored mesh keeps outward-facing front faces. */
export function flipWinding(idx: Uint32Array): Uint32Array {
  const out = new Uint32Array(idx);
  for (let t = 0; t < out.length; t += 3) { const b = out[t + 1]; out[t + 1] = out[t + 2]; out[t + 2] = b; }
  return out;
}

// ---- what an object is ------------------------------------------------------------------------------------------

/**
 * Tissue kinds found in O3D. Phase 1 builds bone, articular, fibrocartilage, disc, nucleus and costal; the others
 * are recognised so later phases (limb muscles and tendons; ligaments, capsules, bursae, retinacula, fasciae) only
 * need to stop skipping them.
 */
export type O3DKind =
  | 'bone' | 'articular' | 'fibrocartilage' | 'disc' | 'nucleus' | 'costal'
  | 'muscle' | 'tendon' | 'ligament' | 'capsule' | 'bursa' | 'fascia' | 'retinaculum' | 'membrane'
  | 'overlay' | 'nerve' | 'artery' | 'vein' | 'other';

/** Classifies a cleaned, side-stripped name within its top-level group ("Arm - cartilages", "Ligaments", ...). */
export function o3dKind(group: string, base: string, material = ''): O3DKind {
  const g = group.toLowerCase(), n = base.toLowerCase();
  if (/overlay/.test(g) || /^overlays/i.test(material)) return 'overlay';
  if (/^nucleus pulposus/.test(n)) return 'nucleus';
  if (/^annulus fibrosus/.test(n)) return 'disc';
  if (/^costal cart/.test(n)) return 'costal';
  if (n === 'xiphoid process') return 'bone';
  if (/ - bones$|^bones/.test(g)) return 'bone';
  if (/meniscofemoral/.test(n)) return 'ligament';
  if (/synovial membrane/.test(n)) return 'membrane';
  if (/menisc|labrum|interpubic disc|articular disc|acromioclavicular disc|fibro ?cartilage disc|^symphysis of/.test(n)) return 'fibrocartilage';
  if (/\bart(icular)? cart(s|ilages?)?\b/.test(n)) return 'articular';
  if (/nerve/.test(g)) return 'nerve';
  if (/arter/.test(g)) return 'artery';
  if (/vein/.test(g)) return 'vein';
  if (/bursa|synovia/.test(g)) return 'bursa';
  if (/^fascia/.test(g)) return /retinac|tract/.test(n) ? 'retinaculum' : 'fascia';
  if (/ligament|capsule/.test(g)) {
    if (/capsule/.test(n)) return 'capsule';
    if (/fascia|septum/.test(n)) return 'fascia';
    if (/retinac/.test(n)) return 'retinaculum';
    if (/membrane/.test(n)) return 'membrane';
    return 'ligament';
  }
  if (/muscle/.test(g)) {
    if (/sheath/.test(n)) return 'bursa';
    if (/tendon|aponeuros|hood/.test(n)) return 'tendon';
    return 'muscle';
  }
  return 'other';
}

// ---- bones: O3D name -> app key --------------------------------------------------------------------------------

const ORD: Record<string, number> = {
  '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7, '8th': 8, '9th': 9, '10th': 10, '11th': 11, '12th': 12,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
};
const FINGER: Record<number, string> = { 1: 'thumb', 2: 'index', 3: 'middle', 4: 'ring', 5: 'little' };
const TOE: Record<number, string> = { 1: 'hallux', 2: 'toe2', 3: 'toe3', 4: 'toe4', 5: 'toe5' };
const SKULL: Record<string, string> = {
  'Ethmoid Bone': 'skull-ethmoid', 'Frontal bone': 'skull-frontal', 'Occipital bone': 'skull-occipital', 'Sphenoid bone': 'skull-sphenoid',
  Vomer: 'skull-vomer', 'Inferior nasal concha bone': 'skull-inferior-nasal-concha', 'Lacrimal bone': 'skull-lacrimal', 'Maxilla bone': 'skull-maxilla',
  'Nasal bone': 'skull-nasal', 'Palatine bone': 'skull-palatine', 'Temporal bone': 'skull-temporal', 'Zygomatic bone': 'skull-zygomatic',
  'Parietal bone': 'skull-parietal', 'Mandible bone': 'mandible',
};
const CARPAL: Record<string, string> = {
  Scaphoid: 'scaphoid', 'Lunate bone': 'lunate', Triquetrum: 'triquetral', Pisiform: 'pisiform', Trapezium: 'trapezium', Trapezoid: 'trapezoid', Capitate: 'capitate', Hamate: 'hamate',
};
const TOOTH = /^(Upper|Lower) (medial incisor|lateral incisor|canine|first premolar|second premolar|first molar tooth|second molar tooth)$/;

/**
 * App structure key for an O3D bone (cleaned name without side suffix), or null. Keys match the BodyParts3D build
 * wherever .cache/open3d/mapping.tsv found a 1:1 match, so ids, URLs, tests, the catalog and the quiz keep working.
 * New in O3D: coccyx, sesamoid bones of the hand, teeth (grouped per arch, see TEETH).
 */
export function boneKey(base: string): string | null {
  let m: RegExpMatchArray | null;
  if (SKULL[base]) return SKULL[base];
  if (CARPAL[base]) return `carpal-${CARPAL[base]}`;
  if (base === 'Atlas (C1)') return 'c1';
  if (base === 'Axis (C2)') return 'c2';
  if ((m = base.match(/^(Cervical|Thoracic|Lumbar) vertebrae? \(([CTL])(\d+)\)$/))) return `${m[2].toLowerCase()}${m[3]}`;
  if (base === 'Sacrum') return 'sacrum';
  if (base === 'Coccyx') return 'coccyx';
  if (base === 'Manubrium of sternum') return 'manubrium';
  if (base === 'Body of sternum') return 'sternum-body';
  if (base === 'Xiphoid process') return 'xiphoid';
  if ((m = base.match(/^Rib \((\w+)\)$/)) && ORD[m[1]]) return `rib-${ORD[m[1]]}`;
  if (['Clavicle', 'Scapula', 'Humerus', 'Radius', 'Ulna', 'Femur', 'Patella', 'Tibia', 'Fibula', 'Talus', 'Calcaneus'].includes(base)) return base.toLowerCase();
  if (base === 'Hip bone') return 'hip-bone';
  if ((m = base.match(/^(\w+) metacarpal bone$/)) && ORD[m[1]]) return `metacarpal-${ORD[m[1]]}`;
  if ((m = base.match(/^(Proximal|Middle|Distal) phalanx of (\w+) finger$/)) && ORD[m[2]]) {
    const f = FINGER[ORD[m[2]]];
    return f === 'thumb' && m[1] === 'Middle' ? null : `${f}-${m[1].toLowerCase()}`;
  }
  if ((m = base.match(/^(Proximal|Middle|Distal) phalanx of (\w+) finger of foot$/)) && ORD[m[2].toLowerCase()]) return `${TOE[ORD[m[2].toLowerCase()]]}-${m[1].toLowerCase()}`;
  if ((m = base.match(/^(\w+) metatarsal bone$/)) && ORD[m[1].toLowerCase()]) return `metatarsal-${ORD[m[1].toLowerCase()]}`;
  if (base === 'Navicular bone') return 'tarsal-navicular';
  if (base === 'Cuboid bone') return 'tarsal-cuboid';
  if ((m = base.match(/^(Medial|Intermediate|Lateral) cuneiform bone$/))) return `tarsal-cuneiform-${m[1].toLowerCase()}`;
  if (base === 'Sesamoid bones of foot') return 'sesamoid-foot';
  if (base === 'Sesamoid bones of hand') return 'sesamoid-hand';
  if ((m = base.match(TOOTH))) return m[1] === 'Upper' ? 'teeth-upper' : 'teeth-lower';
  return null;
}

/** Bones that BodyParts3D did not have: label and manifest group (the group decides the rig carrier and region). */
export const NEW_BONES: Record<string, { label: string; group: string }> = {
  coccyx: { label: 'Coccyx', group: 'pelvis' },
  'sesamoid-hand': { label: 'Sesamoid Bones of Hand', group: 'hand' },
  'teeth-upper': { label: 'Upper Teeth', group: 'skull' },
  'teeth-lower': { label: 'Lower Teeth', group: 'mandible' },
};

/**
 * Teeth: O3D has seven per quadrant (no third molars). Shown as two midline structures, one per arch, so the upper
 * teeth follow the skull and the lower teeth the mandible; each tooth type is a part (left and right together).
 */
export function toothPart(base: string): { key: string; label: string } | null {
  const m = base.match(TOOTH);
  if (!m) return null;
  const t = m[2].replace(' tooth', '').replace('medial incisor', 'central incisor');
  return { key: t.replace(/ /g, '-'), label: `${t[0].toUpperCase()}${t.slice(1)}s` };
}

// ---- joint surfaces: O3D name -> app structure ------------------------------------------------------------------

export type JointKind = 'articular' | 'fibrocartilage';

/**
 * Where an articular or fibrocartilage object goes. `on` lists the bone keys it may sit on:
 *  - one key: it belongs to that bone, on the object's side. An object stored as one midline piece on a paired bone
 *    (pubic symphysis surfaces) is split into its connected pieces, each going to the nearer of the two bones;
 *    with `whole` it stays one midline structure attached to both (interpubic disc).
 *  - several keys: the object covers several bones (all proximal phalanges, ...). It is split into its connected
 *    pieces, each assigned to the nearest of these bones, one structure per bone, keyed `<key>-<bone key>`.
 * `part` puts several objects into one structure (meniscus body and horns).
 */
export interface JointSpec {
  kind: JointKind;
  key: string;
  label: string;
  on: string[];
  whole?: boolean;
  part?: { key: string; label: string };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const PHAL = (ph: 'proximal' | 'middle' | 'distal', foot: boolean) =>
  (foot ? ['hallux', 'toe2', 'toe3', 'toe4', 'toe5'] : ['thumb', 'index', 'middle', 'ring', 'little'])
    .filter((d) => ph !== 'middle' || (d !== 'thumb' && d !== 'hallux'))
    .map((d) => `${d}-${ph}`);
const A = (key: string, label: string, ...on: string[]): JointSpec => ({ kind: 'articular', key, label, on });
const F = (key: string, label: string, ...on: string[]): JointSpec => ({ kind: 'fibrocartilage', key, label, on });

const JOINT_TABLE: Record<string, JointSpec> = {
  // shoulder girdle, arm, forearm
  'Art cart of humerus head': A('cartilage-humeral-head', 'Articular Cartilage of Humeral Head', 'humerus'),
  'Art cart of humerus distal end': A('cartilage-distal-humerus', 'Articular Cartilage of Distal Humerus', 'humerus'),
  'Art cart of radius head': A('cartilage-radial-head', 'Articular Cartilage of Radial Head', 'radius'),
  'Art cart of radius distal end': A('cartilage-distal-radius', 'Articular Cartilage of Distal Radius', 'radius'),
  'Art cart of ulna (proximal end)': A('cartilage-proximal-ulna', 'Articular Cartilage of Proximal Ulna', 'ulna'),
  'Art cart of ulna (distal end)': A('cartilage-ulnar-head', 'Articular Cartilage of Ulnar Head', 'ulna'),
  'Articular cartilage of glenohumeral joint on scapula': A('cartilage-glenoid', 'Articular Cartilage of Glenoid Cavity', 'scapula'),
  'Articular cartilage of acromioclavicular joint on scapula': A('cartilage-acromion', 'Articular Cartilage of Acromion', 'scapula'),
  'Articular cartilage of acromioclavicular joint on clavicle': A('cartilage-clavicle-acromial', 'Articular Cartilage of Acromial End of Clavicle', 'clavicle'),
  'Articular cartilage of sternoclavicular joint on clavicle': A('cartilage-clavicle-sternal', 'Articular Cartilage of Sternal End of Clavicle', 'clavicle'),
  'art cart of sternoclavicular joint on manubrium': A('cartilage-manubrium-clavicular', 'Articular Cartilage of Clavicular Notch', 'manubrium'),
  'art cart of sternocostal joint on manubrium': A('cartilage-manubrium-costal', 'Articular Cartilage of Manubrium (Sternocostal)', 'manubrium'),
  'art cart of sternocostal joints on sternal body': A('cartilage-sternum-costal', 'Articular Cartilage of Sternal Body (Sternocostal)', 'sternum-body'),
  'Glenoid labrum': F('glenoid-labrum', 'Glenoid Labrum', 'scapula'),
  'Acromioclavicular disc': F('acromioclavicular-disc', 'Acromioclavicular Disc', 'clavicle'),
  'Articular disc of sternoclavicular joint': F('sternoclavicular-disc', 'Sternoclavicular Disc', 'clavicle'),
  'Triangular fibro cartilage disc': F('triangular-fibrocartilage', 'Triangular Fibrocartilage (TFCC Disc)', 'radius'),
  // wrist and hand
  'Art cart of scaphoid bone': A('cartilage-scaphoid', 'Articular Cartilage of Scaphoid', 'carpal-scaphoid'),
  'Art cart of lunate bone': A('cartilage-lunate', 'Articular Cartilage of Lunate', 'carpal-lunate'),
  'Art cart of triquetrum bone': A('cartilage-triquetrum', 'Articular Cartilage of Triquetrum', 'carpal-triquetral'),
  'Art cart of pisiform bone': A('cartilage-pisiform', 'Articular Cartilage of Pisiform', 'carpal-pisiform'),
  'Art cart of trapezium bone': A('cartilage-trapezium', 'Articular Cartilage of Trapezium', 'carpal-trapezium'),
  'Art cart of trapezoid bone': A('cartilage-trapezoid', 'Articular Cartilage of Trapezoid', 'carpal-trapezoid'),
  'Art cart of capitate bone': A('cartilage-capitate', 'Articular Cartilage of Capitate', 'carpal-capitate'),
  'Art cart of hamate bone': A('cartilage-hamate', 'Articular Cartilage of Hamate', 'carpal-hamate'),
  'Art carts of metacarpal bones': A('cartilage', 'Articular Cartilage', ...range(5).map((i) => `metacarpal-${i}`)),
  'Art carts of proximal phalanges': A('cartilage', 'Articular Cartilage', ...PHAL('proximal', false)),
  'Art carts of middle phalanges': A('cartilage', 'Articular Cartilage', ...PHAL('middle', false)),
  'Art carts of distal phalanges': A('cartilage', 'Articular Cartilage', ...PHAL('distal', false)),
  // spine, thorax, pelvis
  'art cart of Atlas C1': A('cartilage-c1', 'Articular Cartilage of Atlas (C1)', 'c1'),
  'art cart of Axis C2': A('cartilage-c2', 'Articular Cartilage of Axis (C2)', 'c2'),
  'art cart of sacrum art process': A('cartilage-sacrum-facets', 'Articular Cartilage of Sacral Superior Articular Processes', 'sacrum'),
  'art cart of sacrum lumbosacral joint': A('cartilage-sacrum-base', 'Articular Cartilage of Sacral Base (Lumbosacral Joint)', 'sacrum'),
  'Art cart of sacroiliac joint on sacrum': A('cartilage-sacroiliac-sacral', 'Articular Cartilage of Sacroiliac Joint (Sacral Side)', 'sacrum'),
  'Art cart of sacroiliac joint on hip bone': A('cartilage-sacroiliac-iliac', 'Articular Cartilage of Sacroiliac Joint (Iliac Side)', 'hip-bone'),
  'Art cart of sacrococcygeal joint on sacrum': A('cartilage-sacrum-apex', 'Articular Cartilage of Sacral Apex (Sacrococcygeal Joint)', 'sacrum'),
  'Art cart of sacrococcygeal joint on coccyx': A('cartilage-coccyx', 'Articular Cartilage of Coccyx (Sacrococcygeal Joint)', 'coccyx'),
  'Symphysis of sacrococcygeal joint': F('sacrococcygeal-disc', 'Sacrococcygeal Disc', 'sacrum'),
  'Art cart of hip bone pubis': A('cartilage-pubic-symphysis', 'Articular Cartilage of Pubic Symphysis', 'hip-bone'),
  'Interpubic disc': { ...F('interpubic-disc', 'Interpubic Disc', 'hip-bone'), whole: true },
  'Articular cartilage of hip bone acetabulum': A('cartilage-acetabulum', 'Articular Cartilage of Acetabulum (Lunate Surface)', 'hip-bone'),
  'Acetabular labrum': F('acetabular-labrum', 'Acetabular Labrum', 'hip-bone'),
  // hip, knee, leg
  'Art cart of femur head': A('cartilage-femoral-head', 'Articular Cartilage of Femoral Head', 'femur'),
  'Art cart of femur distal end': A('cartilage-distal-femur', 'Articular Cartilage of Femoral Condyles', 'femur'),
  'Art cart of patella': A('cartilage-patella', 'Articular Cartilage of Patella', 'patella'),
  'Art cart of tibia proximal end': A('cartilage-tibial-plateau', 'Articular Cartilage of Tibial Plateau', 'tibia'),
  'Art cart of tibia distal end': A('cartilage-distal-tibia', 'Articular Cartilage of Distal Tibia', 'tibia'),
  'Art cart of tibia proximal tibiofibular joint': A('cartilage-tibia-fibular-facet', 'Articular Cartilage of Fibular Facet of Tibia', 'tibia'),
  'Art cart of fibula proximal tibiofibular joint': A('cartilage-fibular-head', 'Articular Cartilage of Fibular Head', 'fibula'),
  'Art cart of fibula talofibular joint': A('cartilage-lateral-malleolus', 'Articular Cartilage of Lateral Malleolus', 'fibula'),
  'Medial meniscus': { ...F('medial-meniscus', 'Medial Meniscus', 'tibia'), part: { key: 'body', label: 'Body' } },
  'Anterior horn of Medial meniscus': { ...F('medial-meniscus', 'Medial Meniscus', 'tibia'), part: { key: 'anterior-horn', label: 'Anterior horn' } },
  'Posterior horn of Medial meniscus': { ...F('medial-meniscus', 'Medial Meniscus', 'tibia'), part: { key: 'posterior-horn', label: 'Posterior horn' } },
  'Lateral meniscus': { ...F('lateral-meniscus', 'Lateral Meniscus', 'tibia'), part: { key: 'body', label: 'Body' } },
  'Anterior horn of Lateral meniscus': { ...F('lateral-meniscus', 'Lateral Meniscus', 'tibia'), part: { key: 'anterior-horn', label: 'Anterior horn' } },
  'Posterior horn of Lateral meniscus': { ...F('lateral-meniscus', 'Lateral Meniscus', 'tibia'), part: { key: 'posterior-horn', label: 'Posterior horn' } },
  // ankle and foot
  'Art cart of talus': A('cartilage-talus', 'Articular Cartilage of Talus', 'talus'),
  'Art cart of calcaneus': A('cartilage-calcaneus', 'Articular Cartilage of Calcaneus', 'calcaneus'),
  'Art cart of navicular bone': A('cartilage-navicular', 'Articular Cartilage of Navicular', 'tarsal-navicular'),
  'Art cart of cuboid bone': A('cartilage-cuboid', 'Articular Cartilage of Cuboid', 'tarsal-cuboid'),
  'Art cart of medial cuneiform bone': A('cartilage-medial-cuneiform', 'Articular Cartilage of Medial Cuneiform', 'tarsal-cuneiform-medial'),
  'Art cart of intermediate cuneiform bone': A('cartilage-intermediate-cuneiform', 'Articular Cartilage of Intermediate Cuneiform', 'tarsal-cuneiform-intermediate'),
  'Art cart of lateral cuneiform bone': A('cartilage-lateral-cuneiform', 'Articular Cartilage of Lateral Cuneiform', 'tarsal-cuneiform-lateral'),
  'Art cart of Sesamoid bones': A('cartilage-sesamoid-foot', 'Articular Cartilage of Sesamoid Bones of Foot', 'sesamoid-foot'),
  'Art carts of metatarsal bones': A('cartilage', 'Articular Cartilage', ...range(5).map((i) => `metatarsal-${i}`)),
  'Art carts of proximal phalanges of foot': A('cartilage', 'Articular Cartilage', ...PHAL('proximal', true)),
  'Art carts of middle phalanges of foot': A('cartilage', 'Articular Cartilage', ...PHAL('middle', true)),
  'Art carts of distal phalanges of foot': A('cartilage', 'Articular Cartilage', ...PHAL('distal', true)),
};

const VERT = /^([CTL])(\d+)$/;
const VERT_NAME: Record<string, string> = { C: 'Cervical', T: 'Thoracic', L: 'Lumbar' };

/** Joint-surface structure for an O3D cartilage object (cleaned base name), or null if it is not one. */
export function jointSpec(base: string): JointSpec | null {
  if (JOINT_TABLE[base]) return JOINT_TABLE[base];
  let m = base.match(/^Vertebra (\w+) art cart$/);
  if (m && VERT.test(m[1])) {
    const k = m[1].toLowerCase();
    return A(`cartilage-${k}`, `Articular Cartilage of ${VERT_NAME[m[1][0]]} Vertebra ${m[1]} (Facets)`, k);
  }
  m = base.match(/^(\d+)(?:st|nd|rd|th) rib art cart of (head|tubercle)$/);
  if (m) return A(`cartilage-rib-${m[1]}-${m[2]}`, `Articular Cartilage of ${m[2] === 'head' ? 'Head' : 'Tubercle'} of Rib ${m[1]}`, `rib-${m[1]}`);
  return null;
}

/** Joint-surface key and label for one bone of a multi-bone object (`spec.key === 'cartilage'`). */
export function splitJointKey(spec: JointSpec, boneKey: string, boneLabel: string): { key: string; label: string } {
  return { key: `${spec.key}-${boneKey}`, label: `${spec.label} of ${boneLabel}` };
}

// ---- limb muscles and tendons: O3D name -> app structure (phase 2) -----------------------------------------------

/**
 * Where an O3D muscle or tendon object goes: the app muscle `key` (unchanged, so ids, URLs, roles, the quiz and the
 * nerve layer keep working) and the part of that structure it becomes. `part.key` reuses the BodyParts3D part key
 * wherever the app already has that part ("long-head", "main", ...); new parts (tendons, extra heads, single digits)
 * get new keys. `tendon` marks a tendon or aponeurosis part (drawn in the tendon colour).
 * `split` hands each connected piece of one O3D object to the nearest of several app structures (O3D stores the four
 * lumbricals of the foot as one object; the app has one structure per lumbrical).
 */
export interface MuscleSpec {
  key: string;
  part: { key: string; label: string };
  tendon?: boolean;
  split?: string[];
}

const M = (key: string, part = 'main', label?: string): MuscleSpec => ({ key, part: { key: part, label: label ?? '' } });
const T = (key: string, part: string, label: string): MuscleSpec => ({ key, part: { key: part, label }, tendon: true });
const DIGIT_WORD = ['', 'First', 'Second', 'Third', 'Fourth'];
const digitParts = (key: string, what: string, n: number) =>
  Object.fromEntries(range(n).map((i) => [`${ORD_NAME[i]} ${what}`, M(key, i === 1 ? 'main' : `${ORD_WORD[i]}`, `${DIGIT_WORD[i]} ${what.replace(/ of hand$/, '')}`)]));
const ORD_NAME = ['', '1st', '2nd', '3rd', '4th'];
const ORD_WORD = ['', 'first', 'second', 'third', 'fourth'];

const MUSCLE_TABLE: Record<string, MuscleSpec> = {
  // shoulder girdle and shoulder (deltoid, pectoralis major and trapezius stay BodyParts3D: see MUSCLE_SKIP)
  'Infraspinatus muscle': M('infraspinatus'),
  'Supraspinatus muscle': M('supraspinatus'),
  'Subscapularis muscle': M('subscapularis'),
  'Teres minor muscle': M('teres-minor'),
  'Teres major muscle': M('teres-major'),
  'Levator scapulae': M('levator-scapulae'),
  'Rhomboid major muscle': M('rhomboid-major'),
  'Rhomboid minor muscle': M('rhomboid-minor'),
  'Serratus anterior muscle': M('serratus-anterior'),
  'Pectoralis minor muscle': M('pectoralis-minor'),
  'Subclavius muscle': M('subclavius'),
  // arm
  'Coracobrachialis muscle': M('coracobrachialis'),
  'Brachialis muscle': M('brachialis'),
  'Long head of biceps brachii': M('biceps-brachii', 'long-head'),
  'Short head of biceps brachii': M('biceps-brachii', 'short-head'),
  'Common tendon of biceps brachii': T('biceps-brachii', 'tendon', 'Distal tendon'),
  'Bicipital aponeurosis': T('biceps-brachii', 'bicipital-aponeurosis', 'Bicipital aponeurosis'),
  'Long head of triceps brachii': M('triceps-brachii', 'long-head'),
  'Lateral head of triceps brachii': M('triceps-brachii', 'lateral-head'),
  'Medial head of triceps brachii': M('triceps-brachii', 'medial-head'),
  'Common tendon of triceps brachii': T('triceps-brachii', 'tendon', 'Common tendon'),
  // forearm
  'Anconeus muscle': M('anconeus'),
  'Brachioradialis muscle': M('brachioradialis'),
  'Humeral head of pronator teres': M('pronator-teres', 'humeral-head'),
  'Ulnar head of pronator teres': M('pronator-teres', 'ulnar-head'),
  'Pronator quadratus': M('pronator-quadratus'),
  'Supinator': M('supinator'),
  'Flexor carpi radialis': M('flexor-carpi-radialis'),
  'Palmaris longus muscle': M('palmaris-longus'),
  // Palmaris longus inserts into the palmar aponeurosis; BodyParts3D drew the two as one structure too.
  'Aponeurosis palmaris': T('palmaris-longus', 'palmar-aponeurosis', 'Palmar aponeurosis'),
  'Humeral head of flexor carpi ulnaris': M('flexor-carpi-ulnaris', 'humeral-head'),
  'Ulnar head of flexor carpi ulnaris': M('flexor-carpi-ulnaris', 'ulnar-head'),
  'Common tendon of flexor carpi ulnaris': T('flexor-carpi-ulnaris', 'tendon', 'Common tendon'),
  'Flexor digitorum superficialis humero-ulnar head': M('flexor-digitorum-superficialis', 'main', 'Humero-ulnar head'),
  'Flexor digitorum superficialis radial head': M('flexor-digitorum-superficialis', 'radial-head', 'Radial head'),
  'Flexor digitorum profundus': M('flexor-digitorum-profundus'),
  'Flexor pollicis longus': M('flexor-pollicis-longus'),
  'Extensor carpi radialis longus': M('extensor-carpi-radialis-longus'),
  'Extensor carpi radialis brevis': M('extensor-carpi-radialis-brevis'),
  'Extensor digitorum': M('extensor-digitorum'),
  'Extensor hood of 2nd finger': T('extensor-digitorum', 'extensor-hoods', 'Extensor hoods (dorsal digital expansions)'),
  'Extensor hood of 3rd finger': T('extensor-digitorum', 'extensor-hoods', 'Extensor hoods (dorsal digital expansions)'),
  'Extensor hood of 4th finger': T('extensor-digitorum', 'extensor-hoods', 'Extensor hoods (dorsal digital expansions)'),
  'Extensor hood of 5th finger': T('extensor-digitorum', 'extensor-hoods', 'Extensor hoods (dorsal digital expansions)'),
  'Extensor digiti minimi': M('extensor-digiti-minimi'),
  'Humeral head of extensor carpi ulnaris': M('extensor-carpi-ulnaris', 'main', 'Humeral head'),
  'Ulnar head of extensor carpi ulnaris': M('extensor-carpi-ulnaris', 'ulnar-head', 'Ulnar head'),
  'Common tendon of extensor carpi ulnaris': T('extensor-carpi-ulnaris', 'tendon', 'Common tendon'),
  'Abductor pollicis longus': M('abductor-pollicis-longus'),
  'Extensor pollicis brevis': M('extensor-pollicis-brevis'),
  'Extensor pollicis longus': M('extensor-pollicis-longus'),
  'Extensor indicis': M('extensor-indicis'),
  // hand
  'Abductor pollicis brevis': M('abductor-pollicis-brevis'),
  'Deep head of flexor pollicis brevis': M('flexor-pollicis-brevis', 'main', 'Deep head'),
  'Superficial head of flexor pollicis brevis': M('flexor-pollicis-brevis', 'superficial-head'),
  'Opponens pollicis muscle': M('opponens-pollicis'),
  'Abductor digiti minimi': M('abductor-digiti-minimi-of-hand'),
  'Flexor digiti minimi brevis of hand': M('flexor-digiti-minimi-brevis-of-hand'),
  'Opponens digiti minimi muscle of hand': M('opponens-digiti-minimi-of-hand'),
  ...digitParts('lumbricals-of-hand', 'lumbrical of hand', 4),
  ...digitParts('dorsal-interossei-of-hand', 'dorsal interosseus of hand', 4),
  ...digitParts('palmar-interossei-of-hand', 'palmar interosseus of hand', 3),
  // hip
  'Gluteus maximus muscle': M('gluteus-maximus'),
  'Gluteus medius muscle': M('gluteus-medius'),
  'Gluteus minimus muscle': M('gluteus-minimus'),
  'Tensor fasciae latae': M('tensor-fasciae-latae'),
  'Piriformis muscle': M('piriformis'),
  'Obturator internus': M('obturator-internus'),
  'Obturator externus': M('obturator-externus'),
  'Superior gemellus muscle': M('gemellus-superior'),
  'Inferior gemellus muscle': M('gemellus-inferior'),
  'Quadratus femoris muscle': M('quadratus-femoris'),
  'Iliacus muscle': M('iliacus'),
  'Psoas major': M('psoas-major'),
  // thigh
  'Pectineus muscle': M('pectineus'),
  'Adductor longus': M('adductor-longus'),
  'Adductor brevis': M('adductor-brevis'),
  'Adductor magnus': M('adductor-magnus'),
  'Gracilis muscle': M('gracilis'),
  'Sartorius muscle': M('sartorius'),
  'Pes anserinus common tendon': T('sartorius', 'pes-anserinus', 'Pes anserinus (common insertion with gracilis and semitendinosus)'),
  'Rectus femoris': M('rectus-femoris'),
  'Quadriceps common tendon and patellar ligament': T('rectus-femoris', 'quadriceps-tendon', 'Quadriceps tendon and patellar ligament (common to the quadriceps)'),
  'Vastus lateralis muscle': M('vastus-lateralis'),
  'Vastus medialis muscle': M('vastus-medialis'),
  'Vastus intermedius muscle': M('vastus-intermedius'),
  'Long head of biceps femoris': M('biceps-femoris', 'long-head'),
  'Short head of biceps femoris': M('biceps-femoris', 'short-head'),
  'Common tendon of biceps femoris': T('biceps-femoris', 'tendon', 'Distal tendon'),
  'Common tendon of Semitendinosus and Long head of biceps femoris': T('biceps-femoris', 'proximal-tendon', 'Common proximal tendon (with semitendinosus)'),
  'Semitendinosus muscle': M('semitendinosus'),
  'Semimembranosus muscle': M('semimembranosus'),
  'Semimembranosus muscle tendon': T('semimembranosus', 'tendon', 'Tendon'),
  // leg
  'Popliteus muscle': M('popliteus'),
  'Lateral head of gastrocnemius': M('gastrocnemius', 'lateral-head'),
  'Medial head of gastrocnemius': M('gastrocnemius', 'medial-head'),
  'Calcaneal tendon': T('gastrocnemius', 'calcaneal-tendon', 'Calcaneal (Achilles) tendon (common to gastrocnemius and soleus)'),
  'Soleus muscle': M('soleus'),
  'Plantaris muscle': M('plantaris'),
  'Tibialis posterior muscle': M('tibialis-posterior'),
  'Flexor hallucis longus': M('flexor-hallucis-longus'),
  'Flexor digitorum longus': M('flexor-digitorum-longus'),
  'Tibialis anterior muscle': M('tibialis-anterior'),
  'Extensor hallucis longus': M('extensor-hallucis-longus'),
  'Extensor digitorum longus': M('extensor-digitorum-longus'),
  'Extensor digitorum longus tendons': T('extensor-digitorum-longus', 'tendons', 'Tendons'),
  'Fibularis tertius muscle': M('fibularis-tertius'),
  'Fibularis longus muscle': M('fibularis-longus'),
  'Fibularis brevis muscle': M('fibularis-brevis'),
  // foot
  'Extensor hallucis brevis': M('extensor-hallucis-brevis'),
  'Quadratus plantae muscle': M('flexor-accessorius'),
  'Flexor digitorum brevis': M('flexor-digitorum-brevis'),
  'Abductor hallucis': M('abductor-hallucis'),
  'Oblique head of adductor hallucis': M('adductor-hallucis', 'oblique-head'),
  'Transverse head of adductor hallucis': M('adductor-hallucis', 'transverse-head'),
  'Medial head of flexor hallucis brevis': M('flexor-hallucis-brevis', 'medial-head'),
  'Lateral head of flexor hallucis brevis': M('flexor-hallucis-brevis', 'lateral-head'),
  'Abductor digiti minimi of foot': M('abductor-digiti-minimi-of-foot'),
  'Flexor digiti minimi brevis of foot': M('flexor-digiti-minimi-brevis-of-foot'),
  'Opponens digiti minimi muscle of foot': M('opponens-digiti-minimi-of-foot'),
  'Lumbrical muscles of foot': { ...M('first-lumbrical-of-foot'), split: ['first', 'second', 'third', 'fourth'].map((n) => `${n}-lumbrical-of-foot`) },
  'Plantar interossei muscles': { ...M('first-plantar-interosseous-of-foot'), split: ['first', 'second', 'third'].map((n) => `${n}-plantar-interosseous-of-foot`) },
  // Phase 3: parts of the extensor mechanism that O3D files under ligaments. They are tendon, so they join their
  // muscle like the extensor hoods above (the interossei and lumbricals also insert into the lateral bands).
  'Lateral band of 2nd finger': T('extensor-digitorum', 'lateral-bands', 'Lateral bands'),
  'Lateral band of 3rd finger': T('extensor-digitorum', 'lateral-bands', 'Lateral bands'),
  'Lateral band of 4th finger': T('extensor-digitorum', 'lateral-bands', 'Lateral bands'),
  'Lateral band of 5th finger': T('extensor-digitorum', 'lateral-bands', 'Lateral bands'),
  'Intertendinous connections of extensor digitorum': T('extensor-digitorum', 'juncturae-tendinum', 'Intertendinous connections (juncturae tendinum)'),
  'Extensor apparatus of 1st toe': T('extensor-hallucis-longus', 'extensor-expansion', 'Extensor expansion (dorsal digital expansion)'),
  'Extensor apparatus of 2nd toe': T('extensor-digitorum-longus', 'extensor-expansions', 'Extensor expansions (dorsal digital expansions)'),
  'Extensor apparatus of 3rd toe': T('extensor-digitorum-longus', 'extensor-expansions', 'Extensor expansions (dorsal digital expansions)'),
  'Extensor apparatus of 4th toe': T('extensor-digitorum-longus', 'extensor-expansions', 'Extensor expansions (dorsal digital expansions)'),
  'Extensor apparatus of 5th toe': T('extensor-digitorum-longus', 'extensor-expansions', 'Extensor expansions (dorsal digital expansions)'),
};

/**
 * O3D muscle-group objects that are deliberately not used, and why. Anything else that is neither in MUSCLE_TABLE nor
 * here is reported by the build as unmapped.
 */
export const MUSCLE_SKIP: Record<string, string> = {
  'Deltoid muscle': 'kept on BodyParts3D: the app has clavicular/acromial/spinal parts, O3D one mesh',
  'Pectoralis major': 'kept on BodyParts3D: the app has clavicular/sternocostal/abdominal parts, O3D one mesh',
  'Trapezius muscle': 'kept on BodyParts3D: the app has descending/transverse/ascending parts, O3D one mesh',
  'Adductor pollicis': 'kept on BodyParts3D: the app has oblique and transverse heads, O3D one mesh',
  'Latissimus dorsi': 'the schematic latissimus dorsi stays as it is',
  'Coccygeus muscle': 'kept on BodyParts3D: a pelvic-floor (trunk) muscle, next to the BodyParts3D levator ani parts',
  'Palmaris brevis muscle': 'not in the app (no muscle data yet)',
  'Psoas minor': 'not in the app (no muscle data yet)',
  'Articularis genus': 'not in the app (no muscle data yet)',
  'Extensor digitorum brevis': 'not in the app (no muscle data yet)',
  '1st Dorsal interossei muscles of foot': 'not in the app (no muscle data yet)',
  '2nd Dorsal interossei muscles of foot': 'not in the app (no muscle data yet)',
  '3rd Dorsal interossei muscles of foot': 'not in the app (no muscle data yet)',
  '4th Dorsal interossei muscles of foot': 'not in the app (no muscle data yet)',
  // Plantar aponeurosis, superficial transverse metacarpal ligament and infrapatellar fat pad: see SOFT_TABLE.
};

/** App structure (and part) for an O3D muscle or tendon object (cleaned name without side suffix), or null. */
export function muscleSpec(base: string): MuscleSpec | null {
  const s = MUSCLE_TABLE[base];
  return s ? { ...s, part: { ...s.part } } : null;
}

/** App muscle keys that phase 2 builds from O3D. */
export const O3D_MUSCLE_KEYS = [...new Set(Object.values(MUSCLE_TABLE).flatMap((s) => s.split ?? [s.key]))].sort();

// ---- ligaments, capsules, bursae, sheaths, retinacula, fasciae (phase 3) -----------------------------------------

/**
 * App kinds for the soft tissue of the joints. `fatpad` is the infrapatellar fat pad; the knee's synovial membrane
 * is drawn as a `capsule` (the lining of the capsule); `sheath` covers synovial tendon sheaths and the fibrous digital
 * sheaths; `fascia` covers deep fasciae, intermuscular septa and the aponeuroses that are not part of a muscle
 * (plantar, gluteal) and the iliotibial tract.
 */
export type SoftKind = 'ligament' | 'capsule' | 'bursa' | 'sheath' | 'retinaculum' | 'fascia' | 'fatpad';

/**
 * Where an O3D soft-tissue object goes.
 *  - `split`: one structure per digit. The object is cut into its connected pieces and each piece goes to the nearest
 *    of the `on` bones (keys); the digit is that bone's key prefix and `name(digit)` gives the structure key and label.
 *    With `rigid`, each piece is fixed to that bone alone (the palmar and plantar plates, attached firmly to the base
 *    of the distal bone of their joint and sliding over the head of the proximal one).
 *  - `parts`: the connected pieces become named parts of one structure, ordered from the midline outwards.
 *  - `on`: bones (keys) the structure is fixed to, instead of the contact search the build runs otherwise.
 */
export interface SoftSpec {
  kind: SoftKind;
  key: string;
  label: string;
  split?: { on: string[]; name: (digit: string) => { key: string; label: string }; rigid?: boolean };
  parts?: { key: string; label: string }[];
  /** The part of the structure this object is (several objects make one structure: the iliofemoral ligament). */
  part?: { key: string; label: string };
  on?: string[];
}

const S = (kind: SoftKind) => (key: string, label: string, extra: Partial<SoftSpec> = {}): SoftSpec => ({ kind, key, label, ...extra });
const LIG = S('ligament'), CAP = S('capsule'), BUR = S('bursa'), SHE = S('sheath'), RET = S('retinaculum'), FAS = S('fascia');

export const DIGIT_NAME: Record<string, string> = {
  thumb: 'Thumb', index: 'Index Finger', middle: 'Middle Finger', ring: 'Ring Finger', little: 'Little Finger',
  hallux: 'Great Toe', toe2: 'Second Toe', toe3: 'Third Toe', toe4: 'Fourth Toe', toe5: 'Fifth Toe',
};
/** Digit of a phalanx key ("index-proximal" -> "index"). */
export const digitOf = (boneKey: string) => boneKey.split('-')[0];
const perDigit = (key: string, label: string, ipKey?: string, ipLabel?: string) => (d: string) =>
  (d === 'thumb' || d === 'hallux') && ipKey ? { key: `${ipKey}-${d}`, label: `${ipLabel} (${DIGIT_NAME[d]})` } : { key: `${key}-${d}`, label: `${label} (${DIGIT_NAME[d]})` };
const FINGERS4 = ['index', 'middle', 'ring', 'little'].map((d) => `${d}-proximal`);

const SOFT_TABLE: Record<string, SoftSpec> = {
  // ---- shoulder girdle and shoulder
  'Articular capsule of glenohumeral joint': CAP('glenohumeral-capsule', 'Glenohumeral Joint Capsule'),
  'Coracohumeral ligament': LIG('coracohumeral-ligament', 'Coracohumeral Ligament'),
  'Coraco-acromial ligament': LIG('coracoacromial-ligament', 'Coracoacromial Ligament'),
  'Coracoclavicular ligament': LIG('coracoclavicular-ligament', 'Coracoclavicular Ligament', { parts: [{ key: 'conoid', label: 'Conoid ligament' }, { key: 'trapezoid', label: 'Trapezoid ligament' }] }),
  'Acromioclavicular capsule': CAP('acromioclavicular-capsule', 'Acromioclavicular Joint Capsule'),
  'Sternoclavicular capsule': CAP('sternoclavicular-capsule', 'Sternoclavicular Joint Capsule'),
  'Costoclavicular ligament': LIG('costoclavicular-ligament', 'Costoclavicular Ligament'),
  'Interclavicular ligament': LIG('interclavicular-ligament', 'Interclavicular Ligament'),
  'Superior transverse scapular ligament': LIG('superior-transverse-scapular-ligament', 'Superior Transverse Scapular Ligament'),
  'Inferior transverse scapular ligament': LIG('inferior-transverse-scapular-ligament', 'Inferior Transverse Scapular (Spinoglenoid) Ligament'),
  'Subacromial-subdeltoid bursa': BUR('subacromial-subdeltoid-bursa', 'Subacromial-Subdeltoid Bursa'),
  'Subcutaneous acromial bursa': BUR('subcutaneous-acromial-bursa', 'Subcutaneous Acromial Bursa'),
  'Subtendinous bursa of trapezius': BUR('subtendinous-bursa-of-trapezius', 'Subtendinous Bursa of Trapezius'),
  'Infraserratus bursa': BUR('infraserratus-bursa', 'Infraserratus (Scapulothoracic) Bursa'),
  'Supraserratus bursa': BUR('supraserratus-bursa', 'Supraserratus (Scapulothoracic) Bursa'),
  'Coracobrachial bursa': BUR('coracobrachial-bursa', 'Coracobrachial Bursa'),
  'Subtendinous bursa of infraspinatus muscle': BUR('subtendinous-bursa-of-infraspinatus', 'Subtendinous Bursa of Infraspinatus'),
  'Subtendinous bursa of latissimus dorsi': BUR('subtendinous-bursa-of-latissimus-dorsi', 'Subtendinous Bursa of Latissimus Dorsi'),
  'Subtendinous bursa of subscapularis': BUR('subtendinous-bursa-of-subscapularis', 'Subtendinous Bursa of Subscapularis'),
  'Subtendinous bursa of teres major': BUR('subtendinous-bursa-of-teres-major', 'Subtendinous Bursa of Teres Major'),
  'Long head of biceps brachii tendon sheath': SHE('biceps-long-head-tendon-sheath', 'Synovial Sheath of Long Head of Biceps'),
  // ---- arm and elbow
  'Brachial fascia': FAS('brachial-fascia', 'Brachial Fascia'),
  'Lateral intermuscular septum of arm': FAS('lateral-intermuscular-septum-of-arm', 'Lateral Intermuscular Septum of Arm'),
  'Medial intermuscular septum of arm': FAS('medial-intermuscular-septum-of-arm', 'Medial Intermuscular Septum of Arm'),
  'Articular capsule of elbow joint': CAP('elbow-capsule', 'Elbow Joint Capsule'),
  'Quadrate ligament': LIG('quadrate-ligament', 'Quadrate Ligament'),
  'Oblique cord of radio-ulnar syndesmosis': LIG('oblique-cord', 'Oblique Cord'),
  'Interosseous membrane of forearm': LIG('interosseous-membrane-of-forearm', 'Interosseous Membrane of Forearm'),
  'Subcutaneous olecranon bursa': BUR('subcutaneous-olecranon-bursa', 'Subcutaneous Olecranon Bursa'),
  'Intratendinous olecranon bursa': BUR('intratendinous-olecranon-bursa', 'Intratendinous Olecranon Bursa'),
  'Subtendinous bursa of triceps brachii': BUR('subtendinous-bursa-of-triceps-brachii', 'Subtendinous Bursa of Triceps Brachii'),
  'Bicipitoradial bursa': BUR('bicipitoradial-bursa', 'Bicipitoradial Bursa'),
  'Interosseous cubital bursa': BUR('interosseous-cubital-bursa', 'Interosseous Cubital Bursa'),
  'Antebrachial fascia': FAS('antebrachial-fascia', 'Antebrachial Fascia'),
  // ---- wrist and hand
  'Dorsal radio-ulnar ligament': LIG('dorsal-radioulnar-ligament', 'Dorsal Radioulnar Ligament'),
  'Palmar radio-ulnar ligament': LIG('palmar-radioulnar-ligament', 'Palmar Radioulnar Ligament'),
  'Articular capsule of radiocarpal joint': CAP('radiocarpal-capsule', 'Radiocarpal (Wrist) Joint Capsule'),
  'Intercarpal articulations': LIG('intercarpal-ligaments', 'Intercarpal Ligaments'),
  'Radiate carpal ligament': LIG('radiate-carpal-ligament', 'Radiate Carpal Ligament'),
  'Radioscaphocapitate ligament': LIG('radioscaphocapitate-ligament', 'Radioscaphocapitate Ligament'),
  'Scaphocapitate ligament': LIG('scaphocapitate-ligament', 'Scaphocapitate Ligament'),
  'Scapholunate interosseus ligament': LIG('scapholunate-ligament', 'Scapholunate Interosseous Ligament'),
  'Lunotriquetral interosseous ligament': LIG('lunotriquetral-ligament', 'Lunotriquetral Interosseous Ligament'),
  'Palmar lunotriquetral ligament': LIG('palmar-lunotriquetral-ligament', 'Palmar Lunotriquetral Ligament'),
  'Dorsal scaphotriquetral ligament': LIG('dorsal-scaphotriquetral-ligament', 'Dorsal Scaphotriquetral Ligament'),
  'Palmar scaphotriquetral ligament': LIG('palmar-scaphotriquetral-ligament', 'Palmar Scaphotriquetral Ligament'),
  'Scaphotrapeziotrapezoidal ligament': LIG('scaphotrapeziotrapezoid-ligament', 'Scaphotrapeziotrapezoid (STT) Ligament'),
  'Trapeziotrapezoidal interosseous ligament': LIG('trapeziotrapezoid-ligament', 'Trapeziotrapezoid Interosseous Ligament'),
  'Trapezoideocapitate interosseous ligament': LIG('trapezoidocapitate-interosseous-ligament', 'Trapezoidocapitate Interosseous Ligament'),
  'Palmar trapezoideocapitate ligament': LIG('palmar-trapezoidocapitate-ligament', 'Palmar Trapezoidocapitate Ligament'),
  'Capitohamate interosseus ligament': LIG('capitohamate-interosseous-ligament', 'Capitohamate Interosseous Ligament'),
  'Palmar capitohamate ligament': LIG('palmar-capitohamate-ligament', 'Palmar Capitohamate Ligament'),
  'Triquetrocapitate ligament': LIG('triquetrocapitate-ligament', 'Triquetrocapitate Ligament'),
  'Triquetrohamate ligament': LIG('triquetrohamate-ligament', 'Triquetrohamate Ligament'),
  'Pisohamate ligament': LIG('pisohamate-ligament', 'Pisohamate Ligament'),
  'Pisotriquetral ligament': LIG('pisotriquetral-ligament', 'Pisotriquetral Ligaments'),
  'Ulnopisiform ligament': LIG('ulnopisiform-ligament', 'Ulnopisiform Ligament'),
  'Ulnotriquetral ligament': LIG('ulnotriquetral-ligament', 'Ulnotriquetral Ligament'),
  'Dorsal ulnocarpal ligament': LIG('dorsal-ulnocarpal-ligament', 'Dorsal Ulnocarpal Ligament'),
  'Dorsal carpometacarpal ligaments': LIG('dorsal-carpometacarpal-ligaments', 'Dorsal Carpometacarpal Ligaments'),
  'Palmar carpometacarpal ligaments': LIG('palmar-carpometacarpal-ligaments', 'Palmar Carpometacarpal Ligaments'),
  'Dorsal metacarpal ligaments': LIG('dorsal-metacarpal-ligaments', 'Dorsal Metacarpal Ligaments'),
  'Palmar metacarpal ligaments': LIG('palmar-metacarpal-ligaments', 'Palmar Metacarpal Ligaments'),
  'Interosseous metacarpal ligaments': LIG('interosseous-metacarpal-ligaments', 'Interosseous Metacarpal Ligaments'),
  'Deep transverse metacarpal ligament': LIG('deep-transverse-metacarpal-ligaments', 'Deep Transverse Metacarpal Ligaments'),
  'Superficial transverse metacarpal lig.': LIG('superficial-transverse-metacarpal-ligament', 'Superficial Transverse Metacarpal Ligament'),
  'Articular capsules of metacarpophalangeal joints': CAP('mcp-capsule', '', { split: { on: PHAL('proximal', false), name: perDigit('mcp-capsule', 'Metacarpophalangeal Joint Capsule') } }),
  'Articular capsules of proximal interphalangeal joints': CAP('pip-capsule', '', { split: { on: FINGERS4, name: perDigit('pip-capsule', 'Proximal Interphalangeal Joint Capsule') } }),
  'Articular capsules of distal interphalangeal joints': CAP('dip-capsule', '', { split: { on: PHAL('distal', false), name: perDigit('dip-capsule', 'Distal Interphalangeal Joint Capsule', 'ip-capsule', 'Interphalangeal Joint Capsule') } }),
  'Extensor retinaculum of wrist': RET('extensor-retinaculum-of-wrist', 'Extensor Retinaculum of Wrist'),
  'Flexor retinaculum': RET('flexor-retinaculum', 'Flexor Retinaculum (Transverse Carpal Ligament)'),
  'Thickened part of antebrachial fascia': RET('palmar-carpal-ligament', 'Palmar Carpal Ligament'),
  'Fibrous sheath of digits of hand': SHE('fibrous-digital-sheath', '', { split: { on: FINGERS4, name: perDigit('fibrous-digital-sheath', 'Fibrous Digital Sheath') } }),
  'Fibrous sheath of digits of hand thumb': SHE('fibrous-digital-sheath-thumb', 'Fibrous Digital Sheath (Thumb)'),
  'Synovial sheaths of fingers': SHE('digital-synovial-sheath', '', { split: { on: FINGERS4, name: perDigit('digital-synovial-sheath', 'Digital Synovial Sheath') } }),
  'Common flexor tendon sheath': SHE('common-flexor-sheath', 'Common Flexor Sheath (Ulnar Bursa)'),
  'Flexor pollicis longus tendon sheath': SHE('flexor-pollicis-longus-sheath', 'Synovial Sheath of Flexor Pollicis Longus (Radial Bursa)'),
  'Flexor carpi radialis tendon sheath': SHE('flexor-carpi-radialis-sheath', 'Synovial Sheath of Flexor Carpi Radialis'),
  'Abductor pollicis longus tendon sheath': SHE('abductor-pollicis-longus-sheath', 'Synovial Sheath of Abductor Pollicis Longus'),
  'Extensor pollicis brevis tendon sheath': SHE('extensor-pollicis-brevis-sheath', 'Synovial Sheath of Extensor Pollicis Brevis'),
  'Extensor carpi radialis longus tendon sheath': SHE('extensor-carpi-radialis-longus-sheath', 'Synovial Sheath of Extensor Carpi Radialis Longus'),
  'Extensor carpi radialis brevis tendon sheath': SHE('extensor-carpi-radialis-brevis-sheath', 'Synovial Sheath of Extensor Carpi Radialis Brevis'),
  'Extensor pollicis longus tendon sheath': SHE('extensor-pollicis-longus-sheath', 'Synovial Sheath of Extensor Pollicis Longus'),
  'Extensor digitorum - Extensor indicis tendon sheath': SHE('extensor-digitorum-sheath', 'Synovial Sheath of Extensor Digitorum and Extensor Indicis'),
  'Extensor digiti minimi tendon sheath': SHE('extensor-digiti-minimi-sheath', 'Synovial Sheath of Extensor Digiti Minimi'),
  'Extensor carpi ulnaris tendon sheath': SHE('extensor-carpi-ulnaris-sheath', 'Synovial Sheath of Extensor Carpi Ulnaris'),
  // ---- pelvis
  'Anterior sacro-iliac ligament': LIG('anterior-sacroiliac-ligament', 'Anterior Sacroiliac Ligament'),
  'Interossea / Posterior sacro-iliac ligament': LIG('posterior-sacroiliac-ligament', 'Interosseous and Posterior Sacroiliac Ligaments'),
  'Iliolumbar ligament': LIG('iliolumbar-ligament', 'Iliolumbar Ligament'),
  'Sacrospinous ligament': LIG('sacrospinous-ligament', 'Sacrospinous Ligament'),
  'Sacrotuberal ligament': LIG('sacrotuberous-ligament', 'Sacrotuberous Ligament'),
  'Sup, Inf, Ant, Post, Pubic ligaments': LIG('pubic-ligaments', 'Pubic Ligaments'),
  'Intercornual ligament': LIG('intercornual-ligament', 'Intercornual Ligament'),
  'Obturator membrane': LIG('obturator-membrane', 'Obturator Membrane'),
  // ---- hip and thigh
  'Hip joint capsule': CAP('hip-capsule', 'Hip Joint Capsule'),
  'Ligament of head of femur': LIG('ligament-of-head-of-femur', 'Ligament of Head of Femur'),
  'Transverse acetabular ligament': LIG('transverse-acetabular-ligament', 'Transverse Acetabular Ligament', { on: ['hip-bone'] }),
  'Bursa of piriformis': BUR('bursa-of-piriformis', 'Bursa of Piriformis'),
  'Iliopectineal bursa': BUR('iliopectineal-bursa', 'Iliopectineal (Iliopsoas) Bursa'),
  'Subtendinous bursa of iliacus': BUR('subtendinous-bursa-of-iliacus', 'Subtendinous Bursa of Iliacus'),
  'Intermuscular gluteal bursae': BUR('intermuscular-gluteal-bursae', 'Intermuscular Gluteal Bursae'),
  'Sciatic bursa of gluteus maximus (Ischiogluteal bursa)': BUR('ischiogluteal-bursa', 'Ischial (Ischiogluteal) Bursa of Gluteus Maximus'),
  'Sciatic bursa of obturator internus': BUR('sciatic-bursa-of-obturator-internus', 'Sciatic Bursa of Obturator Internus'),
  'Subtendinous bursa of obturator internus': BUR('subtendinous-bursa-of-obturator-internus', 'Subtendinous Bursa of Obturator Internus'),
  'Subcutaneous trochanteric bursa': BUR('subcutaneous-trochanteric-bursa', 'Subcutaneous Trochanteric Bursa'),
  'Trochanteric bursa of gluteus maximus': BUR('trochanteric-bursa-of-gluteus-maximus', 'Trochanteric Bursa of Gluteus Maximus'),
  'Trochanteric bursae of gluteus medius': BUR('trochanteric-bursae-of-gluteus-medius', 'Trochanteric Bursae of Gluteus Medius'),
  'Trochanteric bursa of gluteus minimus': BUR('trochanteric-bursa-of-gluteus-minimus', 'Trochanteric Bursa of Gluteus Minimus'),
  'Superior bursa of biceps femoris': BUR('superior-bursa-of-biceps-femoris', 'Superior Bursa of Biceps Femoris'),
  'Fascia lata': FAS('fascia-lata', 'Fascia Lata'),
  'Iliotibial tract': FAS('iliotibial-tract', 'Iliotibial Tract (IT Band)'),
  'Gluteal aponeurosis': FAS('gluteal-aponeurosis', 'Gluteal Aponeurosis'),
  'Lateral femoral intermuscular septum': FAS('lateral-femoral-intermuscular-septum', 'Lateral Femoral Intermuscular Septum'),
  'Medial femoral intermuscular septum': FAS('medial-femoral-intermuscular-septum', 'Medial Femoral Intermuscular Septum'),
  // ---- knee
  'Articular capsule of knee joint': CAP('knee-capsule', 'Knee Joint Capsule'),
  'Anterior cruciate ligament': LIG('anterior-cruciate-ligament', 'Anterior Cruciate Ligament (ACL)'),
  'Posterior cruciate ligament': LIG('posterior-cruciate-ligament', 'Posterior Cruciate Ligament (PCL)'),
  'Fibular collateral ligament': LIG('fibular-collateral-ligament', 'Fibular (Lateral) Collateral Ligament'),
  'Posterior meniscofemoral ligament': LIG('posterior-meniscofemoral-ligament', 'Posterior Meniscofemoral Ligament'),
  'Transverse ligament of knee': LIG('transverse-ligament-of-knee', 'Transverse Ligament of Knee'),
  'Ligaments of fibular head': LIG('ligaments-of-fibular-head', 'Ligaments of Fibular Head'),
  'Infrapatellar fat pad': S('fatpad')('infrapatellar-fat-pad', 'Infrapatellar Fat Pad', { on: ['patella', 'tibia'] }),
  'Subcutaneous prepatellar bursa': BUR('subcutaneous-prepatellar-bursa', 'Subcutaneous Prepatellar Bursa'),
  'Subfascial prepatellar bursa': BUR('subfascial-prepatellar-bursa', 'Subfascial Prepatellar Bursa'),
  'Subtendinous prepatellar bursa': BUR('subtendinous-prepatellar-bursa', 'Subtendinous Prepatellar Bursa'),
  'Subcutaneous Infrapatellar bursa': BUR('subcutaneous-infrapatellar-bursa', 'Subcutaneous Infrapatellar Bursa'),
  'Deep Infrapatellar bursa': BUR('deep-infrapatellar-bursa', 'Deep Infrapatellar Bursa'),
  'Subcutaneous bursa of tuberosity of tibia': BUR('subcutaneous-bursa-of-tibial-tuberosity', 'Subcutaneous Bursa of Tibial Tuberosity'),
  'Pes anserine bursa': BUR('pes-anserine-bursa', 'Pes Anserine Bursa'),
  'Subtendinous bursa of sartorius': BUR('subtendinous-bursa-of-sartorius', 'Subtendinous Bursa of Sartorius'),
  'Semimembranosus bursa deep to tendon': BUR('semimembranosus-bursa', 'Semimembranosus Bursa'),
  'Medial subtendinous bursa of gastrocnemius muscle': BUR('medial-subtendinous-bursa-of-gastrocnemius', 'Medial Subtendinous Bursa of Gastrocnemius'),
  'Lateral subtendinous bursa of gastrocnemius muscle': BUR('lateral-subtendinous-bursa-of-gastrocnemius', 'Lateral Subtendinous Bursa of Gastrocnemius'),
  'Inferior subtendinous bursa of biceps femoris': BUR('inferior-subtendinous-bursa-of-biceps-femoris', 'Inferior Subtendinous Bursa of Biceps Femoris'),
  'Subpopliteal recess': BUR('subpopliteal-recess', 'Subpopliteal Recess'),
  // ---- leg
  'Interosseous membrane of leg': LIG('interosseous-membrane-of-leg', 'Interosseous Membrane of Leg'),
  'Crural fascia': FAS('crural-fascia', 'Crural (Deep) Fascia of Leg'),
  'Anterior intermuscular septum of leg': FAS('anterior-intermuscular-septum-of-leg', 'Anterior Intermuscular Septum of Leg'),
  'Posterior intermuscular septum of leg': FAS('posterior-intermuscular-septum-of-leg', 'Posterior Intermuscular Septum of Leg'),
  'Transverse intermuscular septum of leg': FAS('transverse-intermuscular-septum-of-leg', 'Transverse Intermuscular Septum of Leg'),
  // ---- ankle and foot
  'Capsule of talocrural joint': CAP('ankle-capsule', 'Ankle (Talocrural) Joint Capsule'),
  'Anterior talofibular ligament': LIG('anterior-talofibular-ligament', 'Anterior Talofibular Ligament (ATFL)'),
  'Calcaneofibular ligament': LIG('calcaneofibular-ligament', 'Calcaneofibular Ligament (CFL)'),
  'Anterior tibiofibular ligament': LIG('anterior-tibiofibular-ligament', 'Anterior Inferior Tibiofibular Ligament'),
  'Posterior tibiofibular ligament': LIG('posterior-tibiofibular-ligament', 'Posterior Inferior Tibiofibular Ligament'),
  'Transverse tibiofibular ligament': LIG('transverse-tibiofibular-ligament', 'Transverse Tibiofibular Ligament', { on: ['tibia', 'fibula'] }),
  'Anterior tibiotalar ligament (Tibiospring lig.)': LIG('anterior-tibiotalar-ligament', 'Anterior Tibiotalar Part of Deltoid Ligament'),
  'Posterior tibiotalar ligament': LIG('posterior-tibiotalar-ligament', 'Posterior Tibiotalar Part of Deltoid Ligament'),
  'Tibiocalcaneal ligament': LIG('tibiocalcaneal-ligament', 'Tibiocalcaneal Part of Deltoid Ligament'),
  'Tibionavicular ligament': LIG('tibionavicular-ligament', 'Tibionavicular Part of Deltoid Ligament'),
  'Interosseus talocalcaneal ligament': LIG('interosseous-talocalcaneal-ligament', 'Interosseous Talocalcaneal Ligament'),
  'Cervical ligament (anterior talocalcaneal ligament)': LIG('cervical-ligament', 'Cervical Ligament'),
  'Anterior talocalcaneal ligament': LIG('anterior-talocalcaneal-ligament', 'Anterior Talocalcaneal Ligament'),
  'Medial talocalcaneal ligament': LIG('medial-talocalcaneal-ligament', 'Medial Talocalcaneal Ligament'),
  'Posterior talocalcaneal ligament': LIG('posterior-talocalcaneal-ligament', 'Posterior Talocalcaneal Ligament'),
  'Talonavicular ligament': LIG('talonavicular-ligament', 'Dorsal Talonavicular Ligament'),
  'Bifurcatum ligament': LIG('bifurcate-ligament', 'Bifurcate Ligament'),
  'Dorsal calcaneocuboid ligament': LIG('dorsal-calcaneocuboid-ligament', 'Dorsal Calcaneocuboid Ligament'),
  'Plantar calcaneocuboid ligament': LIG('plantar-calcaneocuboid-ligament', 'Plantar Calcaneocuboid (Short Plantar) Ligament'),
  'Plantar calcaneonavicular ligament': LIG('plantar-calcaneonavicular-ligament', 'Plantar Calcaneonavicular (Spring) Ligament', { on: ['calcaneus', 'tarsal-navicular'] }),
  'Long plantar ligament': LIG('long-plantar-ligament', 'Long Plantar Ligament'),
  'Dorsal cuboidonavicular ligament': LIG('dorsal-cuboideonavicular-ligament', 'Dorsal Cuboideonavicular Ligament'),
  'Plantar cuboideonavicular ligament': LIG('plantar-cuboideonavicular-ligament', 'Plantar Cuboideonavicular Ligament'),
  'Dorsal cuneocuboid ligament': LIG('dorsal-cuneocuboid-ligament', 'Dorsal Cuneocuboid Ligament'),
  'Plantar cuneocuboid ligament': LIG('plantar-cuneocuboid-ligament', 'Plantar Cuneocuboid Ligament'),
  'Dorsal cuneonavicular ligaments': LIG('dorsal-cuneonavicular-ligaments', 'Dorsal Cuneonavicular Ligaments'),
  'Plantar cuneonavicular ligaments': LIG('plantar-cuneonavicular-ligaments', 'Plantar Cuneonavicular Ligaments'),
  'Dorsal intercuneiform ligaments': LIG('dorsal-intercuneiform-ligaments', 'Dorsal Intercuneiform Ligaments'),
  'Plantar intercuneiform ligaments': LIG('plantar-intercuneiform-ligaments', 'Plantar Intercuneiform Ligaments'),
  'Intercuneiform interosseus ligaments': LIG('interosseous-intercuneiform-ligaments', 'Interosseous Intercuneiform Ligaments'),
  'Cuneometatarsal interosseus ligaments': LIG('interosseous-cuneometatarsal-ligaments', 'Interosseous Cuneometatarsal Ligaments'),
  'Dorsal tarsometatarsal ligaments': LIG('dorsal-tarsometatarsal-ligaments', 'Dorsal Tarsometatarsal Ligaments'),
  'Plantar tarsometatarsal ligaments': LIG('plantar-tarsometatarsal-ligaments', 'Plantar Tarsometatarsal Ligaments'),
  'Dorsal metatarsal ligaments': LIG('dorsal-metatarsal-ligaments', 'Dorsal Metatarsal Ligaments'),
  'Plantar metatarsal ligaments': LIG('plantar-metatarsal-ligaments', 'Plantar Metatarsal Ligaments'),
  'Metatarsal interosseous ligaments': LIG('interosseous-metatarsal-ligaments', 'Interosseous Metatarsal Ligaments'),
  'Deep transverse metatarsal ligament': LIG('deep-transverse-metatarsal-ligaments', 'Deep Transverse Metatarsal Ligaments'),
  'Superficial transverse metatarsal ligament': LIG('superficial-transverse-metatarsal-ligament', 'Superficial Transverse Metatarsal Ligament'),
  'Intersesamoid ligament': LIG('intersesamoid-ligament', 'Intersesamoid Ligament'),
  'Articular capsules of metatarsophalangeal joints': CAP('mtp-capsule', '', { split: { on: PHAL('proximal', true), name: perDigit('mtp-capsule', 'Metatarsophalangeal Joint Capsule') } }),
  'Articular capsules of proximal interphalangeal': CAP('toe-pip-capsule', '', { split: { on: PHAL('proximal', true), name: perDigit('toe-pip-capsule', 'Proximal Interphalangeal Joint Capsule', 'toe-ip-capsule', 'Interphalangeal Joint Capsule') } }),
  'Articular capsules of distal interphalangeal joints of foot': CAP('toe-dip-capsule', '', { split: { on: PHAL('distal', true).filter((k) => k !== 'hallux-distal'), name: perDigit('toe-dip-capsule', 'Distal Interphalangeal Joint Capsule') } }),
  'Flexor retinaculum of ankle': RET('flexor-retinaculum-of-ankle', 'Flexor Retinaculum of Ankle'),
  'Superior extensor retinaculum of ankle': RET('superior-extensor-retinaculum', 'Superior Extensor Retinaculum of Ankle'),
  'Inferior extensor retinaculum': RET('inferior-extensor-retinaculum', 'Inferior Extensor Retinaculum of Ankle'),
  'Superior fibular retinaculum': RET('superior-fibular-retinaculum', 'Superior Fibular Retinaculum'),
  'Inferior fibular retinaculum': RET('inferior-fibular-retinaculum', 'Inferior Fibular Retinaculum'),
  'Plantar aponeurosis': FAS('plantar-aponeurosis', 'Plantar Aponeurosis (Plantar Fascia)'),
  'Tibialis anterior tendon sheath': SHE('tibialis-anterior-sheath', 'Synovial Sheath of Tibialis Anterior'),
  'Extensor hallucis longus tendon sheath': SHE('extensor-hallucis-longus-sheath', 'Synovial Sheath of Extensor Hallucis Longus'),
  'Extensor digitorum longus-fibularis tertius vaginae tendinum': SHE('extensor-digitorum-longus-sheath', 'Synovial Sheath of Extensor Digitorum Longus and Fibularis Tertius'),
  'Tibialis posterior tendon sheath': SHE('tibialis-posterior-sheath', 'Synovial Sheath of Tibialis Posterior'),
  'Flexor digitorum longus tendon sheath': SHE('flexor-digitorum-longus-sheath', 'Synovial Sheath of Flexor Digitorum Longus'),
  'Flexor hallucis longus tendon sheath': SHE('flexor-hallucis-longus-sheath', 'Synovial Sheath of Flexor Hallucis Longus'),
  'Common tendon sheath of fibularis muscles': SHE('common-fibular-sheath', 'Common Synovial Sheath of Fibularis Muscles'),
  'Plantar tendinous sheath of fibularis longus': SHE('plantar-fibularis-longus-sheath', 'Plantar Synovial Sheath of Fibularis Longus'),
  'Synovial sheaths of toes': SHE('toe-synovial-sheath', '', { split: { on: PHAL('proximal', true), name: perDigit('toe-synovial-sheath', 'Digital Synovial Sheath') } }),
  'Subcutaneous bursa of medial malleolus': BUR('subcutaneous-bursa-of-medial-malleolus', 'Subcutaneous Bursa of Medial Malleolus'),
  'Subcutaneous bursa of lateral malleolus': BUR('subcutaneous-bursa-of-lateral-malleolus', 'Subcutaneous Bursa of Lateral Malleolus'),
  'Subtendinous bursa of tibialis anterior': BUR('subtendinous-bursa-of-tibialis-anterior', 'Subtendinous Bursa of Tibialis Anterior'),
  'Subcutaneous calcaneal bursa': BUR('subcutaneous-calcaneal-bursa', 'Subcutaneous Calcaneal Bursa'),
  'Subtendinous calcaneal bursa': BUR('retrocalcaneal-bursa', 'Retrocalcaneal (Subtendinous Calcaneal) Bursa'),
};

/**
 * O3D "overlay" shells (green, 13 % opacity in the source): highlight regions drawn over a capsule, a bone or a muscle.
 * Those that read correctly as an opaque structure are used here; every other overlay is listed in OVERLAY_SKIP with
 * the reason. See .cache/phase3/notes.md for the evaluation (thickness, contact, close-up renders).
 */
const MID4 = ['index', 'middle', 'ring', 'little'].map((d) => `${d}-middle`);
const OVERLAY_TABLE: Record<string, SoftSpec> = {
  // Thin bands painted over the capsule or bone (2V/A 0.2-0.6 mm): drawn as opaque sheets they read as the ligament.
  'Superior glenohumeral ligament': LIG('superior-glenohumeral-ligament', 'Superior Glenohumeral Ligament'),
  'Middle glenohumeral ligament': LIG('middle-glenohumeral-ligament', 'Middle Glenohumeral Ligament'),
  'Inferior glenohumeral ligament': LIG('inferior-glenohumeral-ligament', 'Inferior Glenohumeral Ligament'),
  'Transverse humeral ligament': LIG('transverse-humeral-ligament', 'Transverse Humeral Ligament'),
  'Acromioclavicular ligament': LIG('acromioclavicular-ligament', 'Acromioclavicular Ligament'),
  'Anterior sternoclavicular ligament': LIG('anterior-sternoclavicular-ligament', 'Anterior Sternoclavicular Ligament'),
  'Posterior Sternoclavicular ligament': LIG('posterior-sternoclavicular-ligament', 'Posterior Sternoclavicular Ligament'),
  'Radial annular ligament': LIG('annular-ligament-of-radius', 'Annular Ligament of Radius'),
  'Radial collateral ligament of elbow': LIG('radial-collateral-ligament-of-elbow', 'Radial (Lateral) Collateral Ligament of Elbow'),
  'Ulnar collateral ligament of elbow': LIG('ulnar-collateral-ligament-of-elbow', 'Ulnar (Medial) Collateral Ligament of Elbow'),
  'Dorsal radiocarpal ligament': LIG('dorsal-radiocarpal-ligament', 'Dorsal Radiocarpal Ligament'),
  'Palmar radiocarpal ligament': LIG('palmar-radiocarpal-ligament', 'Palmar Radiocarpal Ligament'),
  'Palmar ulnocarpal ligament': LIG('palmar-ulnocarpal-ligament', 'Palmar Ulnocarpal Ligament'),
  'Dorsal intercarpal ligament': LIG('dorsal-intercarpal-ligament', 'Dorsal Intercarpal Ligament'),
  'Radial collateral ligament of wrist': LIG('radial-collateral-ligament-of-wrist', 'Radial Collateral Ligament of Wrist'),
  'Ulnar collateral ligament of wrist': LIG('ulnar-collateral-ligament-of-wrist', 'Ulnar Collateral Ligament of Wrist'),
  'Pisometacarpal ligament': LIG('pisometacarpal-ligament', 'Pisometacarpal Ligament'),
  'Collateral ligaments of metacarpophalangeal joints': LIG('mcp-collateral-ligaments', '', { split: { on: PHAL('proximal', false), name: perDigit('mcp-collateral-ligaments', 'Collateral Ligaments of Metacarpophalangeal Joint') } }),
  'Collateral ligaments of interphalangeal joints': LIG('pip-collateral-ligaments', '', { split: { on: MID4, name: perDigit('pip-collateral-ligaments', 'Collateral Ligaments of Proximal Interphalangeal Joint') } }),
  'Collateral ligaments of distal phalangeal joints': LIG('dip-collateral-ligaments', '', { split: { on: PHAL('distal', false), name: perDigit('dip-collateral-ligaments', 'Collateral Ligaments of Distal Interphalangeal Joint', 'ip-collateral-ligaments', 'Collateral Ligaments of Interphalangeal Joint') } }),
  'Palmar ligaments of metacarpophalangeal joints': LIG('palmar-plate-mcp', '', { split: { on: PHAL('proximal', false), name: perDigit('palmar-plate-mcp', 'Palmar Plate of Metacarpophalangeal Joint'), rigid: true } }),
  'Palmar ligaments of interphalangeal joints': LIG('palmar-plate-pip', '', { split: { on: MID4, name: perDigit('palmar-plate-pip', 'Palmar Plate of Proximal Interphalangeal Joint'), rigid: true } }),
  'Palmar ligaments of distal phalangeal joints': LIG('palmar-plate-dip', '', { split: { on: PHAL('distal', false), name: perDigit('palmar-plate-dip', 'Palmar Plate of Distal Interphalangeal Joint', 'palmar-plate-ip', 'Palmar Plate of Interphalangeal Joint'), rigid: true } }),
  'Transverse part of Iliofemoral ligament': LIG('iliofemoral-ligament', 'Iliofemoral Ligament', { part: { key: 'transverse-part', label: 'Transverse (superior) part' } }),
  'Descending part of Iliofemoral ligament': LIG('iliofemoral-ligament', 'Iliofemoral Ligament', { part: { key: 'descending-part', label: 'Descending (inferior) part' } }),
  'Pubofemoral ligament': LIG('pubofemoral-ligament', 'Pubofemoral Ligament'),
  'Ischiofemoral ligament': LIG('ischiofemoral-ligament', 'Ischiofemoral Ligament'),
  'Zona orbicularis of hip joint': LIG('zona-orbicularis', 'Zona Orbicularis'),
  'Medial collateral ligament': LIG('medial-collateral-ligament', 'Tibial (Medial) Collateral Ligament'),
  'Oblique popliteal ligament': LIG('oblique-popliteal-ligament', 'Oblique Popliteal Ligament'),
  'Arcuate ligament': LIG('arcuate-popliteal-ligament', 'Arcuate Popliteal Ligament'),
  'Medial patellar retinaculum (horizontal part)': RET('medial-patellar-retinaculum', 'Medial Patellar Retinaculum', { part: { key: 'horizontal-part', label: 'Horizontal part' } }),
  'Medial patellar retinaculum (vertical part)': RET('medial-patellar-retinaculum', 'Medial Patellar Retinaculum', { part: { key: 'vertical-part', label: 'Vertical part' } }),
  'Lateral patellar retinaculum (horizontal part)': RET('lateral-patellar-retinaculum', 'Lateral Patellar Retinaculum', { part: { key: 'horizontal-part', label: 'Horizontal part' } }),
  'Lateral patellar retinaculum (vertical part)': RET('lateral-patellar-retinaculum', 'Lateral Patellar Retinaculum', { part: { key: 'vertical-part', label: 'Vertical part' } }),
  'Posterior talofibular ligament': LIG('posterior-talofibular-ligament', 'Posterior Talofibular Ligament (PTFL)'),
  'Collateral ligaments of metatarsophalangeal joints': LIG('mtp-collateral-ligaments', '', { split: { on: PHAL('proximal', true), name: perDigit('mtp-collateral-ligaments', 'Collateral Ligaments of Metatarsophalangeal Joint') } }),
  'Collateral ligament of proximal interphalangeal joints': LIG('toe-pip-collateral-ligaments', '', { split: { on: PHAL('proximal', true), name: perDigit('toe-pip-collateral-ligaments', 'Collateral Ligaments of Proximal Interphalangeal Joint', 'toe-ip-collateral-ligaments', 'Collateral Ligaments of Interphalangeal Joint') } }),
  'Collateral ligaments of distal interphalangeal joints': LIG('toe-dip-collateral-ligaments', '', { split: { on: PHAL('distal', true).filter((k) => k !== 'hallux-distal'), name: perDigit('toe-dip-collateral-ligaments', 'Collateral Ligaments of Distal Interphalangeal Joint') } }),
  'Palmar ligaments of metatarsophalangeal joints': LIG('plantar-plate-mtp', '', { split: { on: PHAL('proximal', true), name: perDigit('plantar-plate-mtp', 'Plantar Plate of Metatarsophalangeal Joint'), rigid: true } }),
  'Palmar ligament of proximal interphalangeal joints': LIG('plantar-plate-pip', '', { split: { on: [...PHAL('middle', true), 'hallux-distal'], name: perDigit('plantar-plate-pip', 'Plantar Plate of Proximal Interphalangeal Joint', 'plantar-plate-ip', 'Plantar Plate of Interphalangeal Joint'), rigid: true } }),
  'Palmar ligaments of distal interphalangeal joints': LIG('plantar-plate-dip', '', { split: { on: PHAL('distal', true).filter((k) => k !== 'hallux-distal'), name: perDigit('plantar-plate-dip', 'Plantar Plate of Distal Interphalangeal Joint'), rigid: true } }),
  // Volumetric shells (2V/A 1.5-2.9 mm) that are real sacs.
  'Suprapatellar bursa overlay': BUR('suprapatellar-bursa', 'Suprapatellar Bursa'),
  // The knee's synovial membrane: a thin shell, drawn see-through with the capsules.
  'Synovial membranes of knee': CAP('knee-synovial-membrane', 'Synovial Membrane of Knee'),
  // An opaque, textured mesh that O3D files under Overlays.
  'Fibrous sheath of toes': SHE('toe-fibrous-sheath', '', { split: { on: PHAL('proximal', true), name: perDigit('toe-fibrous-sheath', 'Fibrous Digital Sheath') } }),
};

const MUSCLE_PART_SHELL = 'highlight shell of a muscle part (the muscle itself is drawn; its parts come from BodyParts3D)';
const SPACE = 'outline of a space or passage, not a structure';
const PULLEY = 'pulley region painted on the fibrous digital sheath, which is drawn (the shell would z-fight with it)';
/** O3D overlay shells that are not used, and why. */
export const OVERLAY_SKIP: Record<string, string> = {
  'Abdominal head of pectoralis major muscle': MUSCLE_PART_SHELL, 'Clavicular head of pectoralis major muscle': MUSCLE_PART_SHELL, 'Sternocostal head of pectoralis major muscle': MUSCLE_PART_SHELL,
  'Acromial part of deltoid muscle': MUSCLE_PART_SHELL, 'Clavicular part of deltoid muscle': MUSCLE_PART_SHELL, 'Spinal part of deltoid muscle': MUSCLE_PART_SHELL,
  'Ascending part of Trapezius muscle': MUSCLE_PART_SHELL, 'Descending part of Trapezius muscle': MUSCLE_PART_SHELL, 'Transverse part of trapezius muscle': MUSCLE_PART_SHELL,
  'Oblique head of adductor pollicis': MUSCLE_PART_SHELL, 'Transverse head of adductor pollicis': MUSCLE_PART_SHELL, 'Adductor minimus overlay': MUSCLE_PART_SHELL,
  'Quadriceps common tendon and patellar ligament': 'highlight shell of the quadriceps tendon, which is drawn as part of rectus femoris',
  'Tendinous arch of soleus': 'highlight of the origin of soleus (a muscle attachment, not a joint ligament)',
  'Adductor canal': SPACE, 'Adductor hiatus': SPACE, 'Femoral canal': SPACE, 'Femoral ring': SPACE, 'Femoral triangle': SPACE, 'Saphenous opening': SPACE,
  'Annular ligament(A1) of 1st finger': PULLEY, 'Annular ligament(A2) of 1st finger': PULLEY, 'Oblique ligament of 1st finger': PULLEY,
  'Annular ligaments of 2nd finger A1-A5': PULLEY, 'Annular ligaments of 3rd finger A1-A5': PULLEY, 'Annular ligaments of 4th finger A1-A5': PULLEY, 'Annular ligaments of 5th finger A1-A5': PULLEY,
  'Cruciform ligaments of 2nd finger': PULLEY, 'Cruciform ligaments of 3rd finger': PULLEY, 'Cruciform ligaments of 4th finger': PULLEY, 'Cruciform ligaments of 5th finger': PULLEY,
  'Annular ligaments of 1st toe A1-A5': PULLEY, 'Annular ligaments of 2nd toe A1-A5': PULLEY, 'Annular ligaments of 3rd toe A1-A5': PULLEY, 'Annular ligaments of 4th toe A1-A5': PULLEY, 'Annular ligaments of 5th toe A1-A5': PULLEY,
  'Cruciform ligaments of 1st toe': PULLEY, 'Cruciform ligaments of 2nd toe': PULLEY, 'Cruciform ligaments of 3rd toe': PULLEY, 'Cruciform ligaments of 4th toe': PULLEY, 'Cruciform ligaments of 5th toe': PULLEY,
  'Collateral ligaments of metacarpal joints': 'second shell over the same ten metacarpophalangeal sites as "Collateral ligaments of metacarpophalangeal joints" (used); which ligament it marks is unclear',
  'Conoid ligament (part of coracoclavicular ligament)': 'region of the coracoclavicular ligament mesh, which is used; its conoid and trapezoid parts are its two pieces',
  'Trapezoid ligament (part of coracoclavicular ligament)': 'region of the coracoclavicular ligament mesh, which is used; its conoid and trapezoid parts are its two pieces',
  'Subacromial bursa': 'region of the subacromial-subdeltoid bursa, which is used (44 % of the shell lies inside the acromion)',
  'Subdeltoid bursa': 'region of the subacromial-subdeltoid bursa, which is used',
  'Calcaneocuboid ligament': 'limb of the bifurcate ligament, which is used',
  'Calcaneonavicular ligament': 'limb of the bifurcate ligament, which is used',
  'Anterior ligament of fibular head': 'region of "Ligaments of fibular head", which is used',
  'Posterior ligament of fibular head': 'region of "Ligaments of fibular head", which is used',
  'Anterior pubic ligament': 'region of "Sup, Inf, Ant, Post, Pubic ligaments", which is used',
  'Posterior pubic ligament': 'region of "Sup, Inf, Ant, Post, Pubic ligaments", which is used',
};

/** O3D soft-tissue objects (not overlays) that are not used, and why. */
export const SOFT_SKIP: Record<string, string> = {};

/** App structure for an O3D soft-tissue object (cleaned name without side suffix), or null. */
export function softSpec(base: string, overlay = false): SoftSpec | null {
  const s = (overlay ? OVERLAY_TABLE : SOFT_TABLE)[base];
  return s ? { ...s } : null;
}
/** For tests: every table entry. */
export const SOFT_ENTRIES = (): [string, SoftSpec, boolean][] => [
  ...Object.entries(SOFT_TABLE).map(([k, v]) => [k, v, false] as [string, SoftSpec, boolean]),
  ...Object.entries(OVERLAY_TABLE).map(([k, v]) => [k, v, true] as [string, SoftSpec, boolean]),
];

// ---- intervertebral discs and costal cartilage ------------------------------------------------------------------

const ORDINAL_WORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const REGION_WORD: Record<string, string> = { C: 'cervical', T: 'thoracic', L: 'lumbar' };

/**
 * Disc key for an O3D annulus ("Annulus fibrosus T3 T4"), keyed by the vertebra above as BodyParts3D did
 * ("disc-third-thoracic-vertebra"; C2-C3 is "disc-axis"). The T12-L1 disc, which the BodyParts3D build called
 * plain "disc", is "disc-twelfth-thoracic-vertebra".
 */
export function discKey(base: string): { key: string; above: string; below: string } | null {
  const m = base.match(/^Annulus fibrosus ([CTL])(\d+) ([CTLS])(\d+)$/i);
  if (!m) return null;
  const r = m[1].toUpperCase(), n = +m[2];
  const above = `${r.toLowerCase()}${n}`, below = `${m[3].toLowerCase()}${m[4]}`;
  if (r === 'C' && n === 2) return { key: 'disc-axis', above, below: below === 's1' ? 'sacrum' : below };
  return { key: `disc-${ORDINAL_WORD[n]}-${REGION_WORD[r]}-vertebra`, above, below: below === 's1' ? 'sacrum' : below };
}

/** Costal cartilage number from "Costal cart of 3rd rib". */
export function costalNumber(base: string): number | null {
  const m = base.match(/^Costal cart of (\d+)(?:st|nd|rd|th) rib$/);
  return m ? +m[1] : null;
}
