import type { Structure } from '../types';
import { SOFT_TABLE, softDigitInfo } from './softTissue';

/**
 * One-line descriptions of the joint surfaces (articular cartilage and fibrocartilage) from general anatomy. Like
 * the muscle entries, they carry `refs`/`reviewed` once someone has checked them against a reference; none has been
 * yet. Keys are structure keys from the model build (scripts/lib/open3d.ts).
 */
export interface JointInfo {
  description: string;
  /** Group in the Joints library tab. */
  group: string;
  refs?: string[];
  reviewed?: { by: string; date: string };
}

const SHOULDER = 'Shoulder girdle', ELBOW = 'Elbow', WRIST = 'Wrist & hand', HIP = 'Hip', KNEE = 'Knee', FOOT = 'Ankle & foot';
const SPINE = 'Spine', THORAX = 'Thorax', PELVIS = 'Pelvis';
const H = (where: string) => `Hyaline cartilage ${where}`;

const TABLE: Record<string, JointInfo> = {
  // fibrocartilage
  'glenoid-labrum': { group: SHOULDER, description: 'Fibrocartilaginous rim around the glenoid cavity of the scapula that deepens the socket of the shoulder joint.' },
  'acromioclavicular-disc': { group: SHOULDER, description: 'Small, often incomplete fibrocartilage disc inside the acromioclavicular joint, between the clavicle and the acromion.' },
  'sternoclavicular-disc': { group: SHOULDER, description: 'Fibrocartilage disc that divides the sternoclavicular joint between the medial end of the clavicle and the manubrium.' },
  'triangular-fibrocartilage': { group: WRIST, description: 'Fibrocartilage disc between the head of the ulna and the carpal bones; the central part of the triangular fibrocartilage complex (TFCC) of the wrist.' },
  'acetabular-labrum': { group: HIP, description: 'Fibrocartilaginous rim attached to the margin of the acetabulum that deepens the socket of the hip joint.' },
  'medial-meniscus': { group: KNEE, description: 'C-shaped fibrocartilage on the medial tibial plateau, between the medial condyles of the femur and tibia.' },
  'lateral-meniscus': { group: KNEE, description: 'Nearly circular fibrocartilage on the lateral tibial plateau, between the lateral condyles of the femur and tibia.' },
  'interpubic-disc': { group: PELVIS, description: 'Fibrocartilage disc joining the two pubic bones at the pubic symphysis.' },
  'sacrococcygeal-disc': { group: PELVIS, description: 'Fibrocartilage between the apex of the sacrum and the coccyx at the sacrococcygeal joint.' },
  // shoulder girdle and arm
  'cartilage-humeral-head': { group: SHOULDER, description: H('covering the head of the humerus, which articulates with the glenoid cavity at the glenohumeral (shoulder) joint.') },
  'cartilage-glenoid': { group: SHOULDER, description: H('lining the glenoid cavity of the scapula, the socket of the shoulder joint.') },
  'cartilage-acromion': { group: SHOULDER, description: H('on the acromion of the scapula at the acromioclavicular joint.') },
  'cartilage-clavicle-acromial': { group: SHOULDER, description: H('on the acromial (lateral) end of the clavicle at the acromioclavicular joint.') },
  'cartilage-clavicle-sternal': { group: SHOULDER, description: H('on the sternal (medial) end of the clavicle at the sternoclavicular joint.') },
  'cartilage-manubrium-clavicular': { group: SHOULDER, description: H('in the clavicular notch of the manubrium at the sternoclavicular joint.') },
  'cartilage-distal-humerus': { group: ELBOW, description: H('covering the trochlea and capitulum of the humerus, which articulate with the ulna and the radius at the elbow.') },
  'cartilage-radial-head': { group: ELBOW, description: H('covering the head of the radius, which articulates with the capitulum at the elbow and with the ulna at the proximal radioulnar joint.') },
  'cartilage-proximal-ulna': { group: ELBOW, description: H('lining the trochlear notch and the radial notch of the ulna at the elbow.') },
  'cartilage-distal-radius': { group: WRIST, description: H('covering the distal end of the radius, which articulates with the scaphoid and lunate at the wrist and with the ulnar head.') },
  'cartilage-ulnar-head': { group: WRIST, description: H('covering the head of the ulna at the distal radioulnar joint.') },
  // thorax
  'cartilage-manubrium-costal': { group: THORAX, description: H('on the manubrium where the first costal cartilages join the sternum.') },
  'cartilage-sternum-costal': { group: THORAX, description: H('on the body of the sternum at its joints with the costal cartilages (sternocostal joints).') },
  // spine and pelvis
  'cartilage-c1': { group: SPINE, description: H('on the articular facets of the atlas (C1), at the atlanto-occipital and atlanto-axial joints.') },
  'cartilage-c2': { group: SPINE, description: H('on the articular facets of the axis (C2), at the atlanto-axial and C2–C3 facet joints.') },
  'cartilage-sacrum-facets': { group: SPINE, description: H('on the superior articular processes of the sacrum, at the L5–S1 facet joints.') },
  'cartilage-sacrum-base': { group: SPINE, description: 'Cartilage on the base of the sacrum, at the lumbosacral junction below the L5–S1 disc.' },
  'cartilage-sacrum-apex': { group: PELVIS, description: 'Cartilage on the apex of the sacrum at the sacrococcygeal joint.' },
  'cartilage-coccyx': { group: PELVIS, description: 'Cartilage on the base of the coccyx at the sacrococcygeal joint.' },
  'cartilage-sacroiliac-sacral': { group: PELVIS, description: 'Cartilage on the auricular surface of the sacrum, the sacral side of the sacroiliac joint.' },
  'cartilage-sacroiliac-iliac': { group: PELVIS, description: 'Cartilage on the auricular surface of the ilium, the iliac side of the sacroiliac joint.' },
  'cartilage-pubic-symphysis': { group: PELVIS, description: H('covering the symphyseal surface of the pubic bone, on either side of the interpubic disc.') },
  // hip and knee
  'cartilage-acetabulum': { group: HIP, description: 'Horseshoe-shaped (lunate) articular surface of the acetabulum, which articulates with the femoral head at the hip joint.' },
  'cartilage-femoral-head': { group: HIP, description: H('covering the head of the femur, which articulates with the acetabulum at the hip joint.') },
  'cartilage-distal-femur': { group: KNEE, description: H('covering the femoral condyles and the patellar surface of the femur at the knee.') },
  'cartilage-patella': { group: KNEE, description: H('on the posterior surface of the patella, which glides on the patellar surface of the femur.') },
  'cartilage-tibial-plateau': { group: KNEE, description: H('covering the medial and lateral condyles of the tibia (the tibial plateau) at the knee.') },
  'cartilage-tibia-fibular-facet': { group: KNEE, description: H('on the fibular facet of the lateral tibial condyle, at the proximal tibiofibular joint.') },
  'cartilage-fibular-head': { group: KNEE, description: H('on the head of the fibula, at the proximal tibiofibular joint.') },
  // ankle and foot
  'cartilage-distal-tibia': { group: FOOT, description: H('on the inferior surface of the tibia and the medial malleolus, which articulate with the talus at the ankle.') },
  'cartilage-lateral-malleolus': { group: FOOT, description: H('on the medial surface of the lateral malleolus of the fibula, which articulates with the talus at the ankle.') },
  'cartilage-talus': { group: FOOT, description: H('covering the articular surfaces of the talus, at the ankle (talocrural) joint and the joints of the foot below it.') },
  'cartilage-sesamoid-foot': { group: FOOT, description: H('on the sesamoid bones under the head of the first metatarsal.') },
};

const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

/**
 * Description and library group for a structure of the Joints library: joint surfaces (families such as carpals,
 * phalanges and ribs by rule) and the soft tissue of the joints (data/softTissue.ts).
 */
export function jointInfo(s: Pick<Structure, 'key' | 'label'>): JointInfo {
  const t = TABLE[s.key] ?? SOFT_TABLE[s.key] ?? softDigitInfo(s.key);
  if (t) return t;
  const k = s.key;
  let m: RegExpMatchArray | null;
  if ((m = k.match(/^cartilage-([ctl])(\d+)$/))) {
    return { group: SPINE, description: H(`on the articular facets of vertebra ${m[1].toUpperCase()}${m[2]}, at its facet (zygapophyseal) joints with the vertebrae above and below.`) };
  }
  if ((m = k.match(/^cartilage-rib-(\d+)-(head|tubercle)$/))) {
    return m[2] === 'head'
      ? { group: THORAX, description: H(`on the head of the ${ORD[+m[1]]} rib, at its joint with the vertebral column (costovertebral joint).`) }
      : { group: THORAX, description: H(`on the tubercle of the ${ORD[+m[1]]} rib, at its joint with the transverse process (costotransverse joint).`) };
  }
  const bone = s.label.replace(/^Articular Cartilage of /, '');
  if (/^cartilage-(scaphoid|lunate|triquetrum|pisiform|trapezium|trapezoid|capitate|hamate|metacarpal-\d|(thumb|index|middle|ring|little)-(proximal|middle|distal))$/.test(k)) {
    return { group: WRIST, description: H(`covering the joint surfaces of the ${bone.toLowerCase()}.`) };
  }
  if (/^cartilage-(calcaneus|navicular|cuboid|(medial|intermediate|lateral)-cuneiform|metatarsal-\d|(hallux|toe\d)-(proximal|middle|distal))$/.test(k)) {
    return { group: FOOT, description: H(`covering the joint surfaces of the ${bone.toLowerCase()}.`) };
  }
  return { group: 'Other', description: 'Cartilage on a joint surface.' };
}
