import { actionFor, oppositeKey, parseRef } from './actions';
import { muscleInfo } from './muscles';
import { movementsOfMuscle } from '../roles';
import { DOFS } from '../rig/spec';
import type { Structure } from '../types';

/** Educational summaries for the learning cards. Not clinical advice; verify against standard texts. */

export type TissueKind = 'muscle' | 'bone' | 'disc' | 'cartilage';

export const TISSUE: Record<TissueKind, { title: string; body: string }> = {
  muscle: {
    title: 'Skeletal muscle fibre',
    body: 'Skeletal muscle is built from long, multinucleated fibres bundled into fascicles. Inside each fibre, overlapping thin (actin) and thick (myosin) filaments repeat in units called sarcomeres. When a muscle is activated the filaments slide past each other, the sarcomeres shorten, and the whole muscle pulls on its tendon. The regular repeat of the sarcomeres gives the fibre its striped (striated) look under the microscope.',
  },
  bone: {
    title: 'Compact bone (osteons)',
    body: 'The hard outer shell of a bone is organised into osteons: concentric rings of mineralised collagen laid down around a central canal that carries blood vessels and nerves. Bone cells (osteocytes) sit in small spaces between the rings and keep the tissue alive. Bone is constantly remodelled, so it adapts to the loads it carries, which is why progressive loading strengthens it.',
  },
  disc: {
    title: 'Fibrocartilage (annulus and nucleus)',
    body: 'An intervertebral disc has a tough outer annulus fibrosus, made of concentric layers of collagen whose fibres alternate in direction, around a soft, water-rich nucleus pulposus. Together they absorb compression and allow small movements between vertebrae. Discs have little blood supply, so they heal slowly after injury.',
  },
  cartilage: {
    title: 'Hyaline cartilage',
    body: 'Hyaline cartilage is a smooth, flexible tissue made of chondrocytes embedded in a firm collagen and proteoglycan matrix. It has no blood vessels, so it depends on movement and compression to circulate nutrients, and it repairs very slowly. Here it links the ribs to the sternum and lets the chest wall flex when you breathe.',
  },
};

export const tissueOf = (s: Structure): TissueKind => (s.kind === 'muscle' ? 'muscle' : s.kind);

// ---- common conditions ---------------------------------------------------------------------------------------

const MUSCLE_GROUP_CONDITIONS: Record<string, string[]> = {
  'Scapular stabilizers': ['Scapular dyskinesis', 'Upper-trapezius tension and neck pain', 'Winged scapula after nerve injury'],
  Shoulder: ['Shoulder impingement', 'Frozen shoulder (adhesive capsulitis)', 'Pectoral or latissimus strain'],
  'Rotator cuff': ['Rotator cuff tear', 'Subacromial impingement', 'Calcific tendinopathy'],
  'Arm: anterior': ['Biceps tendinopathy', 'Distal biceps rupture', 'Muscle strain'],
  'Arm: posterior': ['Triceps tendinopathy', 'Olecranon bursitis', 'Radial nerve palsy'],
  'Forearm: anterior': ["Golfer's elbow (medial epicondylalgia)", 'Carpal tunnel syndrome', 'Pronator syndrome'],
  'Forearm: posterior': ["Tennis elbow (lateral epicondylalgia)", 'De Quervain tenosynovitis', 'Radial tunnel syndrome'],
  'Hand: thenar': ['Carpal tunnel syndrome', 'Thumb osteoarthritis', 'Thenar wasting'],
  'Hand: hypothenar': ['Ulnar neuropathy', 'Guyon canal syndrome', 'Hypothenar hammer syndrome'],
  'Hand: intrinsic': ['Ulnar claw hand', 'Dupuytren contracture', 'Intrinsic muscle tightness'],
  'Hip: gluteal': ['Gluteal tendinopathy', 'Trendelenburg gait', 'Iliotibial band syndrome'],
  'Hip: deep rotators': ['Piriformis syndrome', 'Deep gluteal syndrome', 'Hip impingement'],
  'Hip: flexors': ['Hip flexor strain', 'Snapping hip (iliopsoas)', 'Psoas tightness with low back pain'],
  'Thigh: medial': ['Adductor (groin) strain', 'Osteitis pubis', 'Adductor tendinopathy'],
  'Thigh: anterior': ['Sartorius strain', 'Pes anserine bursitis', 'Anterior hip pain'],
  'Thigh: quadriceps': ['Quadriceps strain', 'Patellar tendinopathy', 'Patellofemoral pain'],
  'Thigh: hamstrings': ['Hamstring strain', 'Proximal hamstring tendinopathy', 'Referred posterior thigh pain'],
  'Leg: posterior': ['Achilles tendinopathy', 'Calf strain (tennis leg)', 'Compartment syndrome'],
  'Leg: anterior': ['Shin splints', 'Foot drop', 'Anterior compartment syndrome'],
  'Leg: lateral': ['Lateral ankle sprain', 'Peroneal tendinopathy', 'Common fibular nerve injury'],
  'Foot: plantar': ['Plantar fasciitis', 'Flat foot', 'Tarsal tunnel syndrome'],
  'Foot: dorsal': ['Extensor tendinopathy', 'Dorsal foot pain', 'Muscle strain'],
  'Erector spinae': ['Low back strain', 'Muscle spasm', 'Postural back pain'],
  Transversospinalis: ['Chronic low back pain', 'Multifidus atrophy', 'Facet joint pain'],
  Splenius: ['Cervicogenic headache', 'Neck strain', 'Tension-type headache'],
  Suboccipital: ['Tension-type headache', 'Cervicogenic headache', 'Occipital neuralgia'],
  'Deep neck flexors': ['Whiplash', 'Forward head posture', 'Neck pain'],
  Scalenes: ['Thoracic outlet syndrome', 'Neck pain', 'Brachial plexus irritation'],
  'Neck: superficial': ['Torticollis', 'Whiplash', 'Tension headache'],
  Suprahyoid: ['Temporomandibular disorder', 'Swallowing difficulty', 'Jaw pain'],
  Infrahyoid: ['Swallowing difficulty', 'Neck strain', 'Post-surgical neck tightness'],
  Respiration: ['Costochondritis', 'Breathing-pattern disorders', 'Intercostal strain'],
  'Abdominal wall': ['Diastasis recti', 'Inguinal hernia', 'Abdominal strain'],
  'Posterior abdominal wall': ['Low back pain', 'Quadratus lumborum strain', 'Pelvic obliquity'],
  'Deep spinal': ['Segmental stiffness', 'Facet joint pain', 'Stiffness after injury'],
  'Pelvic floor': ['Pelvic floor dysfunction', 'Urinary incontinence', 'Pelvic pain'],
  Mastication: ['Temporomandibular disorder', 'Bruxism', 'Masseter hypertrophy'],
};

const MUSCLE_CONDITIONS: Record<string, string[]> = {
  supraspinatus: ['Supraspinatus tear', 'Subacromial impingement', 'Calcific tendinitis'],
  'biceps-brachii': ['Long head biceps tendinopathy', 'Distal biceps rupture', 'Proximal biceps tendon rupture'],
  'gluteus-medius': ['Greater trochanteric pain syndrome', 'Trendelenburg gait', 'Gluteal tendinopathy'],
  'rectus-femoris': ['Rectus femoris strain (kicking)', 'Hip flexor tightness', 'Quadriceps contusion'],
  gastrocnemius: ['Calf strain (tennis leg)', 'Achilles tendinopathy', 'Night cramps'],
  soleus: ['Soleus strain', 'Achilles tendinopathy', 'Reduced calf pump in immobility'],
  'tibialis-anterior': ['Shin splints', 'Foot drop', 'Anterior compartment syndrome'],
  piriformis: ['Piriformis syndrome', 'Deep gluteal syndrome', 'Sciatic-type buttock pain'],
  'psoas-major': ['Psoas tightness with low back pain', 'Snapping hip', 'Psoas abscess (rare)'],
  trapezius: ['Upper-trapezius myofascial pain', 'Spinal accessory nerve injury', 'Scapular dyskinesis'],
  sternocleidomastoid: ['Congenital torticollis', 'Whiplash', 'Tension headache'],
  diaphragm: ['Hiatus hernia', 'Phrenic nerve palsy', 'Dysfunctional breathing'],
  'latissimus-dorsi': ['Latissimus strain (climbers, rowers)', 'Thoracodorsal nerve injury', 'Teres–lat overload at the shoulder'],
  multifidus: ['Chronic low back pain', 'Multifidus atrophy', 'Facet joint pain'],
  'quadratus-lumborum': ['Quadratus lumborum strain', 'Low back pain', 'Pelvic obliquity'],
  'adductor-longus': ['Adductor longus strain', 'Groin pain in athletes', 'Osteitis pubis'],
  'tensor-fasciae-latae': ['Iliotibial band friction syndrome', 'TFL tightness', 'Lateral knee pain'],
  popliteus: ['Popliteus tendinopathy', 'Posterolateral corner injury', 'Locked-knee sensation'],
  'rectus-abdominis': ['Diastasis recti', 'Rectus sheath strain', 'Athletic pubalgia'],
  subscapularis: ['Subscapularis tear', 'Anterior shoulder instability', 'Frozen shoulder'],
  'serratus-anterior': ['Winged scapula', 'Long thoracic nerve palsy', 'Scapular dyskinesis'],
  'pectoralis-major': ['Pectoralis major rupture (bench press)', 'Shoulder impingement', "Poland syndrome (absence)"],
  'flexor-carpi-ulnaris': ['Ulnar neuropathy at the elbow', "Golfer's elbow", 'Pisotriquetral pain'],
  'extensor-carpi-radialis-brevis': ["Tennis elbow (lateral epicondylalgia)", 'Radial tunnel syndrome', 'Wrist extensor strain'],
};

const BONE_GROUP_CONDITIONS: Record<string, string[]> = {
  skull: ['Skull fracture', 'Concussion with impact', 'Craniosynostosis in infants'],
  mandible: ['Mandibular fracture', 'Temporomandibular disorder', 'Jaw dislocation'],
  cervical: ['Whiplash', 'Cervical spondylosis', 'Cervical radiculopathy'],
  thoracic: ['Osteoporotic compression fracture', 'Scheuermann kyphosis', 'Scoliosis'],
  lumbar: ['Disc herniation', 'Spondylolisthesis', 'Lumbar stenosis'],
  pelvis: ['Pelvic fracture', 'Sacroiliac joint dysfunction', 'Femoroacetabular impingement'],
  neck: ['Hyoid fracture', 'Neck trauma', 'Swallowing difficulty'],
  thorax: ['Rib fracture', 'Costochondritis', 'Sternal fracture'],
  clavicle: ['Clavicle fracture', 'AC joint sprain', 'Sternoclavicular dislocation'],
  scapula: ['Scapular fracture', 'Winged scapula', 'Impingement (acromion shape)'],
  humerus: ['Proximal humerus fracture', 'Humeral shaft fracture', 'Supracondylar fracture'],
  radius: ['Distal radius (Colles) fracture', 'Radial head fracture', 'Radial head subluxation'],
  ulna: ['Olecranon fracture', 'Monteggia fracture', 'Ulnar styloid fracture'],
  hand: ['Scaphoid fracture', "Boxer's fracture", 'Carpal instability'],
  femur: ['Hip (neck of femur) fracture', 'Femoral shaft fracture', 'Slipped capital femoral epiphysis'],
  patella: ['Patellar dislocation', 'Patellofemoral pain', 'Patellar fracture'],
  tibia: ['Tibial plateau fracture', 'Tibial stress fracture', 'Osgood–Schlatter disease'],
  fibula: ['Weber ankle fracture', 'Fibular stress fracture', 'Common fibular nerve injury at the head'],
  talus: ['Talar fracture', 'Ankle sprain', 'Osteochondral lesion'],
  foot: ['Calcaneal fracture', 'Plantar heel pain', 'Metatarsal stress fracture'],
};

export function conditionsOf(s: Structure): string[] {
  if (s.kind === 'muscle') return MUSCLE_CONDITIONS[s.key] ?? MUSCLE_GROUP_CONDITIONS[muscleInfo(s.key).group] ?? ['Muscle strain', 'Overuse injury', 'Trigger points'];
  if (s.kind === 'disc') return ['Disc herniation', 'Degenerative disc disease', 'Annular tear'];
  if (s.kind === 'cartilage') return ['Costochondritis', 'Tietze syndrome', 'Rib dislocation'];
  const g = s.group ?? '';
  if (g.startsWith('digit-')) return /hallux|toe/.test(g) ? ['Toe fracture', 'Hallux rigidus', 'Bunion'] : ['Finger fracture', 'Mallet finger', 'Finger joint arthritis'];
  return BONE_GROUP_CONDITIONS[g] ?? ['Fracture', 'Stress injury', 'Arthritis of the nearby joint'];
}

// ---- facts ---------------------------------------------------------------------------------------------------

const FACTS: Record<string, string> = {
  'gluteus-maximus': 'The gluteus maximus is the largest muscle in the human body by mass.',
  sartorius: 'The sartorius is the longest muscle in the body. Its name comes from the Latin for tailor.',
  soleus: 'The calf muscles act as a "second heart": each contraction squeezes blood in the leg veins back toward the heart.',
  diaphragm: 'Your diaphragm contracts roughly 20,000 times a day without you thinking about it.',
  'latissimus-dorsi': 'The latissimus dorsi is the widest muscle of the back.',
  masseter: 'The masseter is among the strongest muscles of the body for its size.',
  'biceps-brachii': 'Biceps means "two heads": the muscle has a long and a short head that start in different places on the shoulder blade.',
  'triceps-brachii': 'Triceps means "three heads". It is the main extensor of the elbow.',
  'rectus-femoris': 'The rectus femoris is the only quadriceps muscle that also crosses the hip.',
  'psoas-major': 'The psoas major links the lumbar spine to the thigh bone, so it connects the trunk to the leg.',
  'tibialis-anterior': 'The tibialis anterior lifts your foot with every step so that your toes clear the ground.',
  'gastrocnemius': 'The gastrocnemius forms the visible bulge of the calf and joins the soleus in the Achilles tendon, the thickest tendon in the body.',
  deltoid: 'The deltoid is named for the Greek letter delta because of its triangular shape.',
  'sternocleidomastoid': 'The sternocleidomastoid is named after its three attachments: the sternum, the clavicle and the mastoid process.',
  trapezius: 'The trapezius is named for the trapezoid shape the two halves make across the back.',
  femur: 'The femur is the longest and strongest bone in the body.',
  patella: 'The patella is the largest sesamoid bone: a bone that grows inside a tendon.',
  c1: 'The atlas is named after the Greek titan who held up the sky, because it carries the skull.',
  c2: 'The axis has a tooth-like peg (the dens) that the atlas rotates around when you shake your head.',
  sacrum: 'The sacrum is formed from five vertebrae that fuse together during growth.',
  mandible: 'The mandible is the only bone of the skull that moves.',
  calcaneus: 'The calcaneus (heel bone) is the largest bone of the foot.',
  humerus: 'The humerus is the longest bone of the arm.',
  'hip-bone': 'Each hip bone is three bones (ilium, ischium and pubis) that fuse during adolescence.',
  clavicle: 'The clavicle is the only long bone that lies horizontally, and it is the most frequently broken bone in childhood.',
};

const REGION_FACTS: Record<string, string[]> = {
  'Upper limb': ['The two arms and hands contain more than a quarter of the bones in your body.', 'Your shoulder is the most mobile joint in the body, which is also why it is the most often dislocated.'],
  'Lower limb': ['Each foot has 26 bones, so the two feet hold about a quarter of all your bones.', 'Walking loads each hip with several times your body weight at every step.'],
  Trunk: ['The spine has 24 movable vertebrae stacked in three curves that act like a spring.', 'Your deep trunk muscles switch on a fraction of a second before you move an arm or leg.'],
  'Head & neck': ['The head weighs about as much as a bowling ball, and the neck muscles hold it up all day.', 'The neck has seven vertebrae, the same number as a giraffe.'],
};

export function factOf(s: Structure, region: string): string {
  if (FACTS[s.key]) return FACTS[s.key];
  if (s.kind === 'muscle') return 'There are more than 600 skeletal muscles, which together make up roughly 40% of body weight.';
  if (s.kind === 'disc') return 'The discs account for roughly a quarter of the height of the spine, which is why you are slightly taller in the morning.';
  if (s.kind === 'cartilage') return 'Costal cartilage lets your rib cage expand like a bellows with every breath.';
  const list = REGION_FACTS[region] ?? ['The adult skeleton has 206 bones.'];
  let h = 0;
  for (const c of s.key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

// ---- joints crossed and comparison ---------------------------------------------------------------------------

const JOINT_OF_PAIR: Record<string, string> = {
  'scapula>humerus': 'Shoulder', 'sternum>humerus': 'Shoulder', 't10>humerus': 'Shoulder', 'humerus>ulna': 'Elbow', 'humerus>radius': 'Elbow',
  'ulna>hand': 'Wrist', 'radius>hand': 'Wrist', 'humerus>hand': 'Wrist', 'pelvis>femur': 'Hip', 'l3>femur': 'Hip', 'femur>tibia': 'Knee',
  'tibia>talus': 'Ankle', 'skull>mandible': 'Jaw (TMJ)', 'sternum>scapula': 'Scapulothoracic', 'sternum>clavicle': 'Sternoclavicular',
};

export function jointsCrossed(s: Structure): string[] {
  if (s.kind !== 'muscle') return [];
  const info = muscleInfo(s.key);
  if (info.spine) return [info.spine.some((n) => /^[tc]\d|^l\d|skull/.test(n)) ? 'Spinal segments' : 'Pelvis and spine'];
  const chain = info.chain;
  if (!chain) return [info.carrier ? 'Moves with its bone, no joint crossed' : 'Not documented'];
  const out: string[] = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const j = JOINT_OF_PAIR[`${chain[i]}>${chain[i + 1]}`];
    if (j && !out.includes(j)) out.push(j);
  }
  // origin on one bone, insertion past an intermediate bone
  for (let i = 0; i + 2 < chain.length; i++) {
    const j = JOINT_OF_PAIR[`${chain[i]}>${chain[i + 2]}`];
    if (j && !out.includes(j)) out.push(j);
  }
  return out.length ? out : ['Not documented'];
}

const BONE_PAIR: Record<string, string> = { humerus: 'femur', femur: 'humerus', radius: 'tibia', tibia: 'radius', ulna: 'fibula', fibula: 'ulna', scapula: 'hip-bone', 'hip-bone': 'scapula' };

/** Structures worth comparing with `s`, best first (same side where the structure is paired). */
export function compareCandidates(s: Structure, structures: Map<string, Structure>): Structure[] {
  const sameSide = (key: string): Structure | undefined => {
    for (const side of [s.side, 'm', 'l'] as const) {
      const hit = structures.get(side === 'm' ? key : `${key}-${side}`);
      if (hit) return hit;
    }
    return undefined;
  };
  const keys: string[] = [];
  const push = (k: string) => { if (k !== s.key && !keys.includes(k)) keys.push(k); };
  if (s.kind === 'muscle') {
    const moves = movementsOfMuscle(s.key);
    for (const m of moves) {
      const opp = actionFor(m.joint, m.dof.id, m.dir === 'pos' ? 'neg' : 'pos');
      for (const r of opp?.prime ?? []) push(parseRef(r).key);
    }
    for (const m of moves) {
      const act = actionFor(m.joint, m.dof.id, m.dir);
      for (const r of [...(act?.prime ?? []), ...(act?.assist ?? [])]) push(parseRef(r).key);
    }
    const info = muscleInfo(s.key);
    for (const o of structures.values()) if (o.kind === 'muscle' && muscleInfo(o.key).group === info.group) push(o.key);
  } else {
    if (BONE_PAIR[s.key]) push(BONE_PAIR[s.key]);
    for (const o of structures.values()) if (o.kind === s.kind && o.group === s.group) push(o.key);
    push('femur'); push('humerus');
  }
  return keys.map(sameSide).filter((x): x is Structure => !!x);
}

export const lengthCm = (s: Structure) => Math.round(Math.max(s.bbox[1][0] - s.bbox[0][0], s.bbox[1][1] - s.bbox[0][1], s.bbox[1][2] - s.bbox[0][2]) * 100);

export { oppositeKey };

export interface PrimaryMove { joint: string; dof: string; dir: 'pos' | 'neg'; value: number; label: string }

/** The movement a structure is best known for, with a demonstration angle at 75 % of the range. */
export function primaryMove(s: Structure): PrimaryMove | null {
  if (s.kind === 'muscle') {
    const m = movementsOfMuscle(s.key).find((x) => x.role === 'prime') ?? movementsOfMuscle(s.key)[0];
    if (!m) return null;
    return { joint: m.joint, dof: m.dof.id, dir: m.dir, value: (m.dir === 'pos' ? m.dof.max : m.dof.min) * 0.75, label: m.name };
  }
  if (s.kind === 'bone') {
    const d = DOFS.find((x) => x.targets.some((t) => t.node === s.key));
    if (!d) return null;
    return { joint: d.joint, dof: d.id, dir: 'pos', value: d.max * 0.75, label: `${d.joint}: ${d.pos}` };
  }
  return null;
}
