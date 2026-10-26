// Classifies BodyParts3D element files into musculoskeletal structures.
// Pure functions: no I/O, so the same rules can be unit-checked.

const ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
};

export const stripSide = (name) => name.replace(/\b(left|right) /g, '').replace(/\s+/g, ' ').trim();
export const sideOf = (name) => (/\bleft\b/.test(name) ? 'l' : /\bright\b/.test(name) ? 'r' : 'm');
export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const TITLE_SMALL = new Set(['of', 'the', 'and', 'to']);
export const titleCase = (s) =>
  s.split(' ').map((w, i) => (i > 0 && TITLE_SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

const SKULL = /^(frontal bone|parietal bone|occipital bone|temporal bone|sphenoid bone|ethmoid|zygomatic bone|maxilla|nasal bone|lacrimal bone|palatine bone|vomer|inferior nasal concha)$/;
const CARPAL = /^(scaphoid|lunate|triquetral|pisiform|trapezium|trapezoid|capitate|hamate)$/;
const FINGER = { thumb: 'thumb', 'index finger': 'index', 'middle finger': 'middle', 'ring finger': 'ring', 'little finger': 'little' };
const TOE = { 'big toe': 'hallux', 'second toe': 'toe2', 'third toe': 'toe3', 'fourth toe': 'toe4', 'little toe': 'toe5' };

/** Returns {kind:'bone'|'disc'|'cartilage', key, label, group} or null. `base` has no left/right word. */
export function classifyBone(base) {
  let m;
  if (SKULL.test(base)) return { kind: 'bone', key: `skull-${slug(base.replace(/ bone$/, ''))}`, label: titleCase(base), group: 'skull' };
  if (base === 'mandible') return { kind: 'bone', key: 'mandible', label: 'Mandible', group: 'mandible' };
  if (base === 'hyoid bone') return { kind: 'bone', key: 'hyoid', label: 'Hyoid Bone', group: 'neck' };
  if (base === 'atlas') return { kind: 'bone', key: 'c1', label: 'Atlas (C1)', group: 'cervical' };
  if (base === 'axis') return { kind: 'bone', key: 'c2', label: 'Axis (C2)', group: 'cervical' };
  if ((m = base.match(/^(\w+) (cervical|thoracic|lumbar) vertebra$/)) && ORDINALS[m[1]]) {
    const p = m[2][0] === 'c' ? 'c' : m[2][0] === 't' ? 't' : 'l';
    return { kind: 'bone', key: `${p}${ORDINALS[m[1]]}`, label: `${titleCase(m[2])} Vertebra ${p.toUpperCase()}${ORDINALS[m[1]]}`, group: m[2] };
  }
  if (base === 'sacrum') return { kind: 'bone', key: 'sacrum', label: 'Sacrum', group: 'pelvis' };
  if (base === 'manubrium') return { kind: 'bone', key: 'manubrium', label: 'Manubrium', group: 'thorax' };
  if (base === 'body of sternum' || base === 'sternum' || base === 'zone of sternum') return { kind: 'bone', key: 'sternum-body', label: 'Body of Sternum', group: 'thorax' };
  if (base === 'xiphoid process') return { kind: 'bone', key: 'xiphoid', label: 'Xiphoid Process', group: 'thorax' };
  if ((m = base.match(/^(\w+) rib$/)) && ORDINALS[m[1]]) return { kind: 'bone', key: `rib-${ORDINALS[m[1]]}`, label: `Rib ${ORDINALS[m[1]]}`, group: 'thorax' };
  if ((m = base.match(/^(\w+) costal cartilage$/)) && ORDINALS[m[1]]) return { kind: 'cartilage', key: `costal-cartilage-${ORDINALS[m[1]]}`, label: `Costal Cartilage ${ORDINALS[m[1]]}`, group: 'thorax' };
  if (base === 'clavicle') return { kind: 'bone', key: 'clavicle', label: 'Clavicle', group: 'clavicle' };
  if (base === 'scapula') return { kind: 'bone', key: 'scapula', label: 'Scapula', group: 'scapula' };
  if (base === 'humerus') return { kind: 'bone', key: 'humerus', label: 'Humerus', group: 'humerus' };
  if (base === 'radius') return { kind: 'bone', key: 'radius', label: 'Radius', group: 'radius' };
  if (base === 'ulna') return { kind: 'bone', key: 'ulna', label: 'Ulna', group: 'ulna' };
  if (CARPAL.test(base)) return { kind: 'bone', key: `carpal-${base}`, label: titleCase(base), group: 'hand' };
  if ((m = base.match(/^(\w+) metacarpal bone$/)) && ORDINALS[m[1]]) return { kind: 'bone', key: `metacarpal-${ORDINALS[m[1]]}`, label: `Metacarpal ${ORDINALS[m[1]]}`, group: 'hand' };
  if ((m = base.match(/^(proximal|middle|distal) phalanx of (.+)$/))) {
    if (FINGER[m[2]]) return { kind: 'bone', key: `${FINGER[m[2]]}-${m[1]}`, label: `${titleCase(m[1])} Phalanx, ${titleCase(m[2])}`, group: `digit-${FINGER[m[2]]}` };
    if (TOE[m[2]]) return { kind: 'bone', key: `${TOE[m[2]]}-${m[1]}`, label: `${titleCase(m[1])} Phalanx, ${titleCase(m[2])}`, group: `digit-${TOE[m[2]]}` };
  }
  if (base === 'hip bone') return { kind: 'bone', key: 'hip-bone', label: 'Hip Bone', group: 'pelvis' };
  if (base === 'femur') return { kind: 'bone', key: 'femur', label: 'Femur', group: 'femur' };
  if (base === 'patella') return { kind: 'bone', key: 'patella', label: 'Patella', group: 'patella' };
  if (base === 'tibia') return { kind: 'bone', key: 'tibia', label: 'Tibia', group: 'tibia' };
  if (base === 'fibula') return { kind: 'bone', key: 'fibula', label: 'Fibula', group: 'fibula' };
  if (base === 'talus') return { kind: 'bone', key: 'talus', label: 'Talus', group: 'talus' };
  if (base === 'calcaneus') return { kind: 'bone', key: 'calcaneus', label: 'Calcaneus', group: 'foot' };
  if (base === 'navicular bone of foot') return { kind: 'bone', key: 'tarsal-navicular', label: 'Navicular', group: 'foot' };
  if (base === 'cuboid bone') return { kind: 'bone', key: 'tarsal-cuboid', label: 'Cuboid', group: 'foot' };
  if ((m = base.match(/^(medial|intermediate|lateral) cuneiform bone$/))) return { kind: 'bone', key: `tarsal-cuneiform-${m[1]}`, label: `${titleCase(m[1])} Cuneiform`, group: 'foot' };
  if ((m = base.match(/^(\w+) metatarsal bone$/)) && ORDINALS[m[1]]) return { kind: 'bone', key: `metatarsal-${ORDINALS[m[1]]}`, label: `Metatarsal ${ORDINALS[m[1]]}`, group: 'foot' };
  if (base === 'sesamoid bone of foot') return { kind: 'bone', key: 'sesamoid-foot', label: 'Sesamoid Bones of Foot', group: 'foot' };
  if (/^intervertebral disk/.test(base)) {
    const k = base === 'intervertebral disk' ? 'disc' : `disc-${slug(base.replace('intervertebral disk of ', ''))}`;
    return { kind: 'disc', key: k, label: titleCase(base.replace('intervertebral disk', 'Intervertebral Disc')), group: 'spine' };
  }
  return null;
}

// Muscles that belong to organs we do not model (eye, larynx, pharynx, tongue, palate, gut).
const MUSCLE_EXCLUDE =
  /(arytenoid|crico|vocalis|aryepiglott|uvular|palat|glossus|pharyng|levator palpebrae|taenia|papillary|trochlea|tarsal|check ligament)/;
const EYE = /^(superior|inferior|lateral|medial) rectus$|^(superior|inferior) oblique$/;
// Section A of the pre-filter: names that are clearly vessels/organs, even if a broad concept pulled them in.
const NOT_MUSCLE = /\b(artery|arteries|vein|veins|nerve|ventricle|atrium|tributary|gland|duct|bronchus|bronchial|valve|gyrus|lobe|iris|lens|cornea|sclera|tooth|cartilage|ligament|membrane|retinaculum|fascia|tendon|tract|bone)\b/;

/** Parse "ulnar head of pronator teres" -> {part:'ulnar head', muscle:'pronator teres'} */
export function splitPart(base) {
  const m = base.match(/^(.+? (?:part|head)) of (.+)$/);
  if (m && !/ of (hand|foot)$/.test(base)) return { part: m[1], muscle: m[2] };
  return { part: null, muscle: base };
}

export function classifyMuscle(base) {
  if (EYE.test(base) || MUSCLE_EXCLUDE.test(base) || NOT_MUSCLE.test(base)) return null;
  const { part, muscle } = splitPart(base);
  const clean = muscle.replace(/ muscle$/, '').replace(/^set of /, '').replace(/^region of /, '');
  return {
    kind: 'muscle',
    key: slug(clean),
    label: titleCase(clean),
    part: part ? titleCase(part) : null,
    partKey: part ? slug(part) : 'main',
  };
}
