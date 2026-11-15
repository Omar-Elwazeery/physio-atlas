import type { MuscleInfo } from '../types';
import type { Direction, StrainLandmark, StrainObstacle, StrainPart } from '../strain';
import { CERVICAL, THORACIC } from '../rig/spec';

const TC = [...THORACIC, ...CERVICAL];
const U = 'Upper limb' as const;

// Surfaces the length read-out wraps over (StrainObstacle), each a cylinder along the joint's own axis of movement.
/**
 * The back of a joint of the digits: a cylinder along the joint's flexion axis (x) through its centre, out to the
 * dorsal surface of the bone end the extensor tendon crosses (`head`), passed on the dorsal side.
 */
const backOf = (joint: string, head: string): StrainObstacle => ({ wrap: 'cylinder', joint, axis: 'x', side: 'posterior', radius: { bone: head, near: 'inferior', depth: 0.006, toward: ['posterior'] } });
/** The backs of the two interphalangeal joints of a finger. */
const interphalangeal = (finger: string): StrainObstacle[] => [backOf(`${finger}-middle`, `${finger}-proximal`), backOf(`${finger}-distal`, `${finger}-middle`)];
/**
 * The back of a knuckle (MCP joint), round the metacarpal head. (Two via points, on the metacarpal head and the base of
 * the proximal phalanx, made a chord across the head: with the MCP pivot at the head centre it under-read flexion.)
 */
const knuckle = (metacarpal: number, finger: string): StrainObstacle[] => [backOf(`${finger}-proximal`, `metacarpal-${metacarpal}`)];
/** The back of the thumb's MCP and IP joints, which flex about z; the dorsal side of the thumb faces laterally. */
const backOfThumb = (joint: string, head: string): StrainObstacle => ({ wrap: 'cylinder', joint, axis: 'z', side: 'lateral', radius: { bone: head, near: 'inferior', depth: 0.006, toward: ['lateral'] } });
const THUMB_MCP = backOfThumb('thumb-proximal', 'metacarpal-1');
const THUMB_IP = backOfThumb('thumb-distal', 'thumb-proximal');
/** The palmar side of the wrist (the carpal tunnel and the pisiform), which the wrist flexors pass in front of. */
const PALMAR_WRIST: StrainObstacle = { wrap: 'cylinder', joint: 'carpus', axis: 'x', side: 'anterior', radius: { bone: 'carpal-pisiform', toward: ['anterior'] } };

/** The greater tubercle of the humerus, over which the deltoid bends in abduction. */
const GREATER_TUBERCLE: StrainLandmark = { bone: 'humerus', near: 'superior', depth: 0.06, toward: ['lateral'] };

/**
 * Upper end of the pectoralis major's length line: the top of the manubrium beside the clavicle, where the clavicular
 * and sternocostal heads meet. The end picked from the mesh lies low on the sternum and stands for the lower sternal
 * fibres, which lengthen in flexion; the movement table's flexor is the clavicular head.
 */
const PEC_UPPER_ORIGIN: StrainLandmark = { bone: 'manubrium', toward: ['anterior', 'lateral', 'superior'] };

/** The head of the humerus, which the parts of the deltoid and pectoralis major pass on the side they lie on (the anterior part in front of it, the posterior part behind it, the middle part to the side; the pectoralis major wraps it only where its line cuts through it) on the way to the shaft. */
const humeralHead = (side?: Direction): StrainObstacle => ({ wrap: 'sphere', joint: 'humerus', radius: 0.024, side });
/** The deltoid tuberosity: the lateral surface of the humeral shaft, 9 to 15 cm below its top. */
const DELTOID_TUBEROSITY: StrainLandmark = { bone: 'humerus', near: 'superior', skip: 0.09, depth: 0.15, toward: ['lateral'] };
/** The lateral lip of the intertubercular groove: the anterior, lateral edge of the upper humerus, below the tubercles. */
const GROOVE_LATERAL_LIP: StrainLandmark = { bone: 'humerus', near: 'superior', skip: 0.07, depth: 0.12, toward: ['anterior', 'lateral'] };

/**
 * The length lines of the parts of the deltoid and pectoralis major (MuscleInfo.strainParts), which the movement table
 * gives different roles, so one line for the whole muscle cannot be right for both.
 */
const DELTOID_PARTS: Record<string, StrainPart> = {
  'clavicular-part': { origin: { bone: 'clavicle', near: 'lateral', depth: 0.04, toward: ['anterior', 'lateral'] }, insertion: DELTOID_TUBEROSITY, vias: [humeralHead('anterior')] },
  'acromial-part': { origin: { bone: 'scapula', near: 'lateral', depth: 0.02, toward: ['superior', 'lateral'] }, insertion: DELTOID_TUBEROSITY, vias: [humeralHead('lateral')] },
  'spinal-part': { origin: { bone: 'scapula', near: 'posterior', depth: 0.06, toward: ['lateral', 'posterior'] }, insertion: DELTOID_TUBEROSITY, vias: [humeralHead('posterior')] },
};
const PECTORALIS_MAJOR_PARTS: Record<string, StrainPart> = {
  'clavicular-part': { origin: { bone: 'clavicle', near: 'medial', depth: 0.06, toward: ['anterior', 'medial'] }, insertion: GROOVE_LATERAL_LIP, vias: [humeralHead()] },
  'sternocostal-part': { origin: { bone: 'sternum-body', toward: ['anterior', 'lateral'] }, insertion: GROOVE_LATERAL_LIP, vias: [humeralHead()] },
};

/** The humeral shaft, round whose medial side teres major winds to the front of the bone (more so in external rotation). */
const HUMERAL_SHAFT: StrainObstacle = { wrap: 'cylinder', joint: 'humerus', axis: { to: 'ulna' }, radius: 0.009, side: 'medial' };

/** Clinical data, upper limb. Educational summary; verify against Gray's / Kendall before clinical use. */
export const UPPER: Record<string, MuscleInfo> = {
  trapezius: { group: 'Scapular stabilizers', region: U, origin: 'Medial third of superior nuchal line, external occipital protuberance, ligamentum nuchae, spinous processes C7–T12', insertion: 'Lateral third of clavicle, acromion, spine of scapula', innervation: 'Spinal accessory nerve (CN XI); C3–C4 (proprioception)', action: 'Upper: elevates scapula, extends and laterally flexes neck. Middle: retracts scapula. Lower: depresses scapula. Upper + lower fibres: upward rotation of scapula.', spine: TC, note: 'Weak lower trapezius with dominant upper trapezius is a common scapular dyskinesis pattern.' },
  'latissimus-dorsi': { group: 'Shoulder', region: U, origin: 'Spinous processes T7–L5 via the thoracolumbar fascia, posterior iliac crest, lower 3–4 ribs, inferior angle of scapula', insertion: 'Floor of the intertubercular groove of the humerus', innervation: 'Thoracodorsal nerve (C6–C8)', action: 'Shoulder extension, adduction and internal rotation; depresses the shoulder girdle (climbing, crutch walking)', chain: ['t10', 'humerus'] },
  'levator-scapulae': { group: 'Scapular stabilizers', region: U, origin: 'Transverse processes of C1–C4', insertion: 'Superior angle and upper medial border of scapula', innervation: 'Dorsal scapular nerve (C5) and C3–C4', action: 'Elevates and downwardly rotates scapula; lateral flexion and rotation of neck to same side', spine: CERVICAL },
  'rhomboid-major': { group: 'Scapular stabilizers', region: U, origin: 'Spinous processes T2–T5', insertion: 'Medial border of scapula below the spine', innervation: 'Dorsal scapular nerve (C4–C5)', action: 'Retracts, downwardly rotates and elevates scapula', spine: THORACIC.slice(4, 11) },
  'rhomboid-minor': { group: 'Scapular stabilizers', region: U, origin: 'Ligamentum nuchae, spinous processes C7–T1', insertion: 'Medial border of scapula at the root of the spine', innervation: 'Dorsal scapular nerve (C4–C5)', action: 'Retracts, downwardly rotates and elevates scapula', spine: ['t3', 't2', 't1', 'c7', 'c6'] },
  'serratus-anterior': { group: 'Scapular stabilizers', region: U, origin: 'Outer surfaces of ribs 1–8 (9)', insertion: 'Anterior surface of the medial border of scapula', innervation: 'Long thoracic nerve (C5–C7)', action: 'Protracts and upwardly rotates scapula; holds scapula against the thorax', carrier: 't5', note: 'Long thoracic nerve palsy produces a winged scapula.' },
  'pectoralis-minor': { group: 'Scapular stabilizers', region: U, origin: 'Ribs 3–5 near the costal cartilages', insertion: 'Coracoid process of scapula', innervation: 'Medial pectoral nerve (C8–T1)', action: 'Protracts and depresses scapula; tips the scapula anteriorly', chain: ['sternum', 'scapula'] },
  subclavius: { group: 'Scapular stabilizers', region: U, origin: 'First rib and its costal cartilage', insertion: 'Inferior surface of the middle third of clavicle', innervation: 'Nerve to subclavius (C5–C6)', action: 'Depresses clavicle and stabilizes the sternoclavicular joint', chain: ['sternum', 'clavicle'] },
  deltoid: { group: 'Shoulder', region: U, origin: 'Lateral third of clavicle, acromion, spine of scapula', insertion: 'Deltoid tuberosity of humerus', innervation: 'Axillary nerve (C5–C6)', action: 'Anterior part: flexion and internal rotation. Middle part: abduction. Posterior part: extension and external rotation.', chain: ['scapula', 'humerus'], strainVias: [GREATER_TUBERCLE], strainParts: DELTOID_PARTS, note: 'Axillary nerve injury (e.g. anterior dislocation) weakens abduction and flattens the shoulder contour.' },
  supraspinatus: { group: 'Rotator cuff', region: U, origin: 'Supraspinous fossa of scapula', insertion: 'Superior facet of greater tubercle of humerus', innervation: 'Suprascapular nerve (C5–C6)', action: 'Initiates abduction; compresses and centres the humeral head in the glenoid', chain: ['scapula', 'humerus'], note: 'Most commonly torn rotator cuff tendon; painful arc 60–120° abduction.' },
  infraspinatus: { group: 'Rotator cuff', region: U, origin: 'Infraspinous fossa of scapula', insertion: 'Middle facet of greater tubercle', innervation: 'Suprascapular nerve (C5–C6)', action: 'External rotation of the arm; posterior stability of the glenohumeral joint', chain: ['scapula', 'humerus'] },
  'teres-minor': { group: 'Rotator cuff', region: U, origin: 'Upper two thirds of lateral border of scapula', insertion: 'Inferior facet of greater tubercle', innervation: 'Axillary nerve (C5–C6)', action: 'External rotation; weak adduction', chain: ['scapula', 'humerus'] },
  subscapularis: { group: 'Rotator cuff', region: U, origin: 'Subscapular fossa', insertion: 'Lesser tubercle of humerus', innervation: 'Upper and lower subscapular nerves (C5–C7)', action: 'Internal rotation; anterior stability of the glenohumeral joint', chain: ['scapula', 'humerus'], note: 'Tested with the lift-off and belly-press tests.' },
  'teres-major': { group: 'Shoulder', region: U, origin: 'Inferior angle and lower lateral border of scapula', insertion: 'Medial lip of intertubercular groove', innervation: 'Lower subscapular nerve (C5–C7)', action: 'Internal rotation, adduction and extension of the arm', chain: ['scapula', 'humerus'], strainVias: [HUMERAL_SHAFT] },
  coracobrachialis: { group: 'Arm: anterior', region: U, origin: 'Coracoid process of scapula', insertion: 'Medial aspect of humeral shaft (midpoint)', innervation: 'Musculocutaneous nerve (C5–C7)', action: 'Flexion and adduction of the arm', chain: ['scapula', 'humerus'] },
  'pectoralis-major': { group: 'Shoulder', region: U, origin: 'Clavicular head: medial half of clavicle. Sternocostal head: sternum and costal cartilages 1–6. Abdominal part: external oblique aponeurosis', insertion: 'Lateral lip of intertubercular groove', innervation: 'Lateral and medial pectoral nerves (C5–T1)', action: 'Adduction and internal rotation; clavicular part flexes the arm, sternocostal part extends it from a flexed position', chain: ['sternum', 'humerus'], strainOrigin: PEC_UPPER_ORIGIN, strainParts: PECTORALIS_MAJOR_PARTS },
  'biceps-brachii': { group: 'Arm: anterior', region: U, origin: 'Short head: coracoid process. Long head: supraglenoid tubercle', insertion: 'Radial tuberosity and bicipital aponeurosis', innervation: 'Musculocutaneous nerve (C5–C6)', action: 'Elbow flexion, forearm supination; weak shoulder flexion', chain: ['scapula', 'humerus', 'radius'], note: 'Most effective as a flexor with the forearm supinated.' },
  brachialis: { group: 'Arm: anterior', region: U, origin: 'Anterior distal half of humerus', insertion: 'Coronoid process and tuberosity of ulna', innervation: 'Musculocutaneous nerve (C5–C6); radial nerve (small lateral part)', action: 'Elbow flexion in every forearm position (the workhorse flexor)', chain: ['humerus', 'ulna'] },
  'triceps-brachii': { group: 'Arm: posterior', region: U, origin: 'Long head: infraglenoid tubercle. Lateral head: posterior humerus above the radial groove. Medial head: posterior humerus below the groove', insertion: 'Olecranon of ulna', innervation: 'Radial nerve (C6–C8)', action: 'Elbow extension; long head also extends and adducts the shoulder', chain: ['scapula', 'humerus', 'ulna'] },
  anconeus: { group: 'Arm: posterior', region: U, origin: 'Lateral epicondyle of humerus', insertion: 'Lateral olecranon and proximal posterior ulna', innervation: 'Radial nerve (C7–T1)', action: 'Assists elbow extension; stabilizes the elbow', chain: ['humerus', 'ulna'] },
  brachioradialis: { group: 'Forearm: posterior', region: U, origin: 'Lateral supracondylar ridge of humerus', insertion: 'Radial styloid process', innervation: 'Radial nerve (C5–C6)', action: 'Elbow flexion, strongest with the forearm in mid-position', chain: ['humerus', 'radius'], note: 'A radial-nerve muscle on the flexor side of the arm.' },
  'pronator-teres': { group: 'Forearm: anterior', region: U, origin: 'Humeral head: medial epicondyle. Ulnar head: coronoid process', insertion: 'Middle of lateral surface of radius', innervation: 'Median nerve (C6–C7)', action: 'Forearm pronation; weak elbow flexion', chain: ['humerus', 'radius'] },
  'pronator-quadratus': { group: 'Forearm: anterior', region: U, origin: 'Distal anterior ulna', insertion: 'Distal anterior radius', innervation: 'Anterior interosseous nerve (C8–T1)', action: 'Forearm pronation (initiates and sustains)', carrier: 'radius' },
  supinator: { group: 'Forearm: posterior', region: U, origin: 'Lateral epicondyle, supinator crest of ulna, radial collateral ligament', insertion: 'Proximal radius (lateral, posterior and anterior surfaces)', innervation: 'Posterior interosseous nerve (C5–C6)', action: 'Forearm supination', carrier: 'radius', note: 'The posterior interosseous nerve passes through it (arcade of Frohse).' },
  'flexor-carpi-radialis': { group: 'Forearm: anterior', region: U, origin: 'Medial epicondyle (common flexor tendon)', insertion: 'Base of 2nd (and 3rd) metacarpal', innervation: 'Median nerve (C6–C7)', action: 'Wrist flexion, radial deviation', chain: ['humerus', 'ulna', 'hand'], strainVias: [PALMAR_WRIST] },
  'palmaris-longus': { group: 'Forearm: anterior', region: U, origin: 'Medial epicondyle', insertion: 'Flexor retinaculum and palmar aponeurosis', innervation: 'Median nerve (C7–C8)', action: 'Weak wrist flexion; tenses the palmar aponeurosis', chain: ['humerus', 'ulna', 'hand'], strainVias: [PALMAR_WRIST], note: 'Absent in about 15% of people; a common tendon graft donor.' },
  'flexor-carpi-ulnaris': { group: 'Forearm: anterior', region: U, origin: 'Humeral head: medial epicondyle. Ulnar head: olecranon and posterior border of ulna', insertion: 'Pisiform, hook of hamate, base of 5th metacarpal', innervation: 'Ulnar nerve (C7–C8)', action: 'Wrist flexion, ulnar deviation', chain: ['humerus', 'ulna', 'hand'], strainVias: [PALMAR_WRIST] },
  'flexor-digitorum-superficialis': { group: 'Forearm: anterior', region: U, origin: 'Medial epicondyle, coronoid process, anterior radius', insertion: 'Sides of the middle phalanges of digits 2–5', innervation: 'Median nerve (C7–T1)', action: 'Flexes the PIP joints (and MCP and wrist)', chain: ['humerus', 'ulna', 'hand'] },
  'flexor-digitorum-profundus': { group: 'Forearm: anterior', region: U, origin: 'Proximal anterior ulna and interosseous membrane', insertion: 'Bases of the distal phalanges of digits 2–5', innervation: 'Radial half (digits 2–3): anterior interosseous nerve. Ulnar half (digits 4–5): ulnar nerve (C8–T1)', action: 'Flexes the DIP joints (and PIP, MCP, wrist)', chain: ['ulna', 'hand'] },
  'flexor-pollicis-longus': { group: 'Forearm: anterior', region: U, origin: 'Anterior radius and interosseous membrane', insertion: 'Base of the distal phalanx of the thumb', innervation: 'Anterior interosseous nerve (C8–T1)', action: 'Flexes the thumb interphalangeal joint', chain: ['radius', 'hand'] },
  'extensor-carpi-radialis-longus': { group: 'Forearm: posterior', region: U, origin: 'Lateral supracondylar ridge', insertion: 'Base of 2nd metacarpal', innervation: 'Radial nerve (C6–C7)', action: 'Wrist extension, radial deviation', chain: ['humerus', 'ulna', 'hand'], strainWrap: 'carpus' },
  'extensor-carpi-radialis-brevis': { group: 'Forearm: posterior', region: U, origin: 'Lateral epicondyle (common extensor tendon)', insertion: 'Base of 3rd metacarpal', innervation: 'Posterior interosseous nerve (C7–C8)', action: 'Wrist extension and radial deviation; stabilizes the wrist during grip', chain: ['humerus', 'ulna', 'hand'], strainWrap: 'carpus', note: 'Origin site in lateral epicondylalgia ("tennis elbow").' },
  'extensor-digitorum': { group: 'Forearm: posterior', region: U, origin: 'Lateral epicondyle', insertion: 'Extensor expansions of digits 2–5', innervation: 'Posterior interosseous nerve (C7–C8)', action: 'Extends the MCP joints (and IP joints, wrist)', chain: ['humerus', 'ulna', 'hand'], strainVias: [...knuckle(3, 'middle'), ...interphalangeal('middle')] },
  'extensor-digiti-minimi': { group: 'Forearm: posterior', region: U, origin: 'Common extensor tendon', insertion: 'Extensor expansion of the little finger', innervation: 'Posterior interosseous nerve (C7–C8)', action: 'Extends the little finger', chain: ['humerus', 'ulna', 'hand'], strainVias: knuckle(5, 'little') },
  'extensor-carpi-ulnaris': { group: 'Forearm: posterior', region: U, origin: 'Lateral epicondyle and posterior border of ulna', insertion: 'Base of 5th metacarpal', innervation: 'Posterior interosseous nerve (C7–C8)', action: 'Wrist extension, ulnar deviation', chain: ['humerus', 'ulna', 'hand'], strainWrap: 'carpus' },
  'abductor-pollicis-longus': { group: 'Forearm: posterior', region: U, origin: 'Posterior radius, ulna and interosseous membrane', insertion: 'Base of 1st metacarpal', innervation: 'Posterior interosseous nerve (C7–C8)', action: 'Abducts and extends the thumb; radial deviation of the wrist', chain: ['radius', 'hand'], note: 'With EPB, its tendons are tender in de Quervain tenosynovitis.' },
  'extensor-pollicis-brevis': { group: 'Forearm: posterior', region: U, origin: 'Posterior radius and interosseous membrane', insertion: 'Base of proximal phalanx of thumb', innervation: 'Posterior interosseous nerve (C7–C8)', action: 'Extends the thumb MCP joint', chain: ['radius', 'hand'], strainVias: [THUMB_MCP] },
  'extensor-pollicis-longus': { group: 'Forearm: posterior', region: U, origin: 'Posterior ulna and interosseous membrane', insertion: 'Base of distal phalanx of thumb', innervation: 'Posterior interosseous nerve (C7–C8)', action: 'Extends the thumb IP joint', chain: ['ulna', 'hand'], strainVias: [THUMB_MCP, THUMB_IP] },
  'extensor-indicis': { group: 'Forearm: posterior', region: U, origin: 'Distal posterior ulna', insertion: 'Extensor expansion of the index finger', innervation: 'Posterior interosseous nerve (C7–C8)', action: 'Extends the index finger independently', chain: ['ulna', 'hand'], strainVias: [backOf('index-proximal', 'metacarpal-2'), ...interphalangeal('index')] },
  'abductor-pollicis-brevis': { group: 'Hand: thenar', region: U, origin: 'Flexor retinaculum, scaphoid and trapezium', insertion: 'Lateral base of proximal phalanx of thumb', innervation: 'Median nerve (recurrent branch, C8–T1)', action: 'Abducts the thumb (palmar abduction)', carrier: 'hand' },
  'flexor-pollicis-brevis': { group: 'Hand: thenar', region: U, origin: 'Flexor retinaculum and trapezium', insertion: 'Base of proximal phalanx of thumb', innervation: 'Median nerve (recurrent branch) and ulnar nerve (deep head)', action: 'Flexes the thumb MCP joint', carrier: 'hand' },
  'opponens-pollicis': { group: 'Hand: thenar', region: U, origin: 'Flexor retinaculum and trapezium', insertion: 'Lateral border of 1st metacarpal', innervation: 'Median nerve (recurrent branch, C8–T1)', action: 'Opposition of the thumb', carrier: 'hand' },
  'adductor-pollicis': { group: 'Hand: thenar', region: U, origin: 'Capitate, bases of 2nd–3rd metacarpals, shaft of 3rd metacarpal', insertion: 'Base of proximal phalanx of thumb (ulnar side)', innervation: 'Ulnar nerve, deep branch (C8–T1)', action: 'Adducts the thumb (key pinch)', carrier: 'hand', note: 'Weak in ulnar nerve palsy; Froment sign.' },
  'abductor-digiti-minimi-of-hand': { group: 'Hand: hypothenar', region: U, origin: 'Pisiform and flexor carpi ulnaris tendon', insertion: 'Ulnar base of proximal phalanx of little finger', innervation: 'Ulnar nerve, deep branch (C8–T1)', action: 'Abducts the little finger', carrier: 'hand' },
  'flexor-digiti-minimi-brevis-of-hand': { group: 'Hand: hypothenar', region: U, origin: 'Hook of hamate and flexor retinaculum', insertion: 'Base of proximal phalanx of little finger', innervation: 'Ulnar nerve, deep branch (C8–T1)', action: 'Flexes the little finger MCP joint', carrier: 'hand' },
  'lumbricals-of-hand': { group: 'Hand: intrinsic', region: U, origin: 'Tendons of flexor digitorum profundus', insertion: 'Extensor expansions (radial side) of digits 2–5', innervation: 'Median nerve (digits 2–3) and ulnar nerve, deep branch (digits 4–5), C8–T1', action: 'Flex the MCP joints and extend the IP joints', carrier: 'hand' },
  'dorsal-interossei-of-hand': { group: 'Hand: intrinsic', region: U, origin: 'Adjacent sides of two metacarpals (four bipennate muscles)', insertion: 'Proximal phalanges and extensor expansions of digits 2–4', innervation: 'Ulnar nerve, deep branch (C8–T1)', action: 'Abduct digits 2–4 away from the middle finger (DAB); flex MCP, extend IP joints', carrier: 'hand' },
  'palmar-interossei-of-hand': { group: 'Hand: intrinsic', region: U, origin: 'Palmar surfaces of metacarpals 2, 4 and 5', insertion: 'Proximal phalanges and extensor expansions', innervation: 'Ulnar nerve, deep branch (C8–T1)', action: 'Adduct digits toward the middle finger (PAD); flex MCP, extend IP joints', carrier: 'hand' },
  'opponens-digiti-minimi-of-hand': { group: 'Hand: hypothenar', region: U, origin: 'Hook of hamate and flexor retinaculum', insertion: 'Medial border of 5th metacarpal', innervation: 'Ulnar nerve, deep branch (C8–T1)', action: 'Draws the 5th metacarpal forward (cupping the hand)', carrier: 'hand' },
};
