import { describe, expect, it } from 'vitest';
import {
  boneKey, cleanName, costalNumber, discKey, flipWinding, geometricSide, jointSpec, mirrorPositions, mirrorVectors, o3dKind,
  splitJointKey, splitSide, toothPart, softSpec, digitOf, FILE_RENAMES, OVERLAY_SKIP, SOFT_ENTRIES,
} from '../scripts/lib/open3d';
import { structures, byId } from './fixtures';

describe('cleanName', () => {
  it('drops zero-width characters and tabs, collapses spaces', () => {
    expect(cleanName('Art cart of humerus head​.r')).toBe('Art cart of humerus head.r');
    expect(cleanName('Art cart of tibia distal end.r\t')).toBe('Art cart of tibia distal end.r');
    expect(cleanName('Art cart of talus.r ​')).toBe('Art cart of talus.r');
    expect(cleanName('art cart of Atlas  C1')).toBe('art cart of Atlas C1');
    expect(cleanName('Sesamoid_bones_of_hand.r')).toBe('Sesamoid bones of hand.r');
  });
  it('fixes the doubled side suffix and the known typos', () => {
    expect(cleanName('Scapula.r.')).toBe('Scapula.r');
    expect(cleanName('Articular disc of steroclavicular joint.r')).toBe('Articular disc of sternoclavicular joint.r');
    expect(cleanName('Annulus fibrosus L1 L20')).toBe('Annulus fibrosus L1 L2');
    expect(cleanName('Costal cart of 1st.rib.r')).toBe('Costal cart of 1st rib.r');
    expect(cleanName('Vertebra L3 art cart.')).toBe('Vertebra L3 art cart');
    expect(cleanName('Art cart of ulna. (distal end).r')).toBe('Art cart of ulna (distal end).r');
    expect(cleanName('Oblique cord or radio-ulnar syndesmosis.r')).toBe('Oblique cord of radio-ulnar syndesmosis.r');
    expect(cleanName('Distal phalanx of 2d finger.r')).toBe('Distal phalanx of 2nd finger.r');
  });
  it('keeps abbreviations that end in a dot', () => {
    expect(cleanName('Superficial transverse metacarpal lig.')).toBe('Superficial transverse metacarpal lig.');
  });
});

describe('splitSide', () => {
  it('reads .r / .l suffixes and left/right words', () => {
    expect(splitSide('Humerus.r')).toEqual({ base: 'Humerus', side: 'r' });
    expect(splitSide('Parietal bone left')).toEqual({ base: 'Parietal bone', side: 'l' });
    expect(splitSide('Sacrum')).toEqual({ base: 'Sacrum', side: null });
  });
});

describe('geometricSide', () => {
  it('right is -x, left is +x', () => {
    expect(geometricSide(-0.17, -0.06)).toBe('r');
    expect(geometricSide(0.06, 0.17)).toBe('l');
  });
  it('a roughly symmetric extent across x = 0 is midline', () => {
    expect(geometricSide(-0.042, 0.042)).toBe('m');
    expect(geometricSide(-0.01, 0.012)).toBe('m');
  });
  it('touching or slightly crossing the midline is still one side', () => {
    expect(geometricSide(-0.074, 0.004)).toBe('r'); // right parietal bone
    expect(geometricSide(-0.025, -0.009)).toBe('r');
    expect(geometricSide(-0.002, 0.05)).toBe('l');
  });
});

describe('mirroring', () => {
  it('negates x only', () => {
    expect([...mirrorPositions(new Float32Array([1, 2, 3, -4, 5, 6]))]).toEqual([-1, 2, 3, 4, 5, 6]);
  });
  it('reverses triangle winding so faces keep pointing outwards', () => {
    expect([...flipWinding(new Uint32Array([0, 1, 2, 3, 4, 5]))]).toEqual([0, 2, 1, 3, 5, 4]);
    // the mirrored triangle's geometric normal is the mirrored normal (not its opposite)
    const p = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]); // normal +z
    const m = mirrorPositions(p), w = flipWinding(new Uint32Array([0, 1, 2]));
    const v = (i: number) => [m[w[i] * 3], m[w[i] * 3 + 1], m[w[i] * 3 + 2]];
    const [a, b, c] = [v(0), v(1), v(2)];
    const e1 = b.map((x, k) => x - a[k]), e2 = c.map((x, k) => x - a[k]);
    expect(e1[0] * e2[1] - e1[1] * e2[0]).toBeGreaterThan(0); // still +z: mirroring in x keeps z
  });
  it('mirrors normals in x and flips tangent handedness', () => {
    expect([...mirrorVectors(new Float32Array([0.6, 0.8, 0]), 3)]).toEqual([-0.6, 0.8, 0].map(Math.fround));
    expect([...mirrorVectors(new Float32Array([1, 0, 0, 1]), 4)]).toEqual([-1, 0, 0, -1]);
  });
  it('mirroring twice is the identity', () => {
    const p = new Float32Array([0.1, 0.2, 0.3, -0.4, 0.5, 0.6]);
    expect([...mirrorPositions(mirrorPositions(p))]).toEqual([...p]);
    const i = new Uint32Array([0, 1, 2]);
    expect([...flipWinding(flipWinding(i))]).toEqual([0, 1, 2]);
  });
});

describe('classification and keys', () => {
  it('classifies tissues by group and name', () => {
    expect(o3dKind('Bones_right', 'Femur')).toBe('bone');
    expect(o3dKind('Cartilages', 'Medial meniscus')).toBe('fibrocartilage');
    expect(o3dKind('Ligaments', 'Anterior horn of Medial meniscus')).toBe('fibrocartilage');
    expect(o3dKind('Ligaments', 'Posterior meniscofemoral ligament')).toBe('ligament');
    expect(o3dKind('Ligaments', 'Articular cartilage of hip bone acetabulum')).toBe('articular');
    expect(o3dKind('Pectoral girdle - cartilages', 'Articular cartilage of glenohumeral joint on scapula')).toBe('articular');
    expect(o3dKind('Thorax - cartilages', '5th rib art cart of head')).toBe('articular');
    expect(o3dKind('Back - cartilages', 'Annulus fibrosus L4 L5')).toBe('disc');
    expect(o3dKind('Thorax - cartilages', 'Nucleus pulposus T1-L1')).toBe('nucleus');
    expect(o3dKind('Thorax - cartilages', 'Costal cart of 3rd rib')).toBe('costal');
    expect(o3dKind('Cartilages', 'Synovial membranes of knee', 'Overlays')).toBe('overlay');
    expect(o3dKind('Arm - muscles', 'Brachialis')).toBe('muscle');
    expect(o3dKind('Muscles', 'Calcaneal tendon')).toBe('tendon');
  });
  it('maps O3D bones onto the existing app keys', () => {
    expect(boneKey('Cervical vertebrae (C3)')).toBe('c3');
    expect(boneKey('Cervical vertebra (C3)')).toBe('c3');
    expect(boneKey('Atlas (C1)')).toBe('c1');
    expect(boneKey('Distal phalanx of 2nd finger')).toBe('index-distal');
    expect(boneKey('Proximal phalanx of first finger of foot')).toBe('hallux-proximal');
    expect(boneKey('Triquetrum')).toBe('carpal-triquetral');
    expect(boneKey('Rib (11th)')).toBe('rib-11');
    expect(boneKey('Coccyx')).toBe('coccyx');
    expect(boneKey('Lower first molar tooth')).toBe('teeth-lower');
    expect(boneKey('Nonsense')).toBeNull();
  });
  it('every mapped bone key exists in the shipped manifest', () => {
    const keys = new Set(structures.map((s) => s.key));
    for (const b of ['Femur', 'Hip bone', 'Scaphoid', 'Navicular bone', 'Medial cuneiform bone', 'Sesamoid bones of foot', 'Mandible bone', 'Upper canine'])
      expect(keys.has(boneKey(b)!), b).toBe(true);
  });
  it('groups teeth per arch with one part per tooth type', () => {
    expect(toothPart('Upper medial incisor')).toEqual({ key: 'central-incisor', label: 'Central incisors' });
    expect(toothPart('Lower second molar tooth')).toEqual({ key: 'second-molar', label: 'Second molars' });
    expect(byId.get('teeth-upper')!.parts).toHaveLength(7);
  });
  it('names joint surfaces and splits multi-bone objects per bone', () => {
    expect(jointSpec('Medial meniscus')).toMatchObject({ kind: 'fibrocartilage', key: 'medial-meniscus', on: ['tibia'] });
    expect(jointSpec('Posterior horn of Lateral meniscus')?.part?.key).toBe('posterior-horn');
    expect(jointSpec('Vertebra T7 art cart')).toMatchObject({ key: 'cartilage-t7', on: ['t7'] });
    expect(jointSpec('10th rib art cart of tubercle')).toMatchObject({ key: 'cartilage-rib-10-tubercle', on: ['rib-10'] });
    const ph = jointSpec('Art carts of middle phalanges')!;
    expect(ph.on).toEqual(['index-middle', 'middle-middle', 'ring-middle', 'little-middle']);
    expect(splitJointKey(ph, 'ring-middle', 'Middle Phalanx, Ring Finger')).toEqual({ key: 'cartilage-ring-middle', label: 'Articular Cartilage of Middle Phalanx, Ring Finger' });
    expect(jointSpec('Interpubic disc')?.whole).toBe(true);
  });
  it('keys discs by the vertebra above, as the BodyParts3D build did', () => {
    expect(discKey('Annulus fibrosus C2 C3')?.key).toBe('disc-axis');
    expect(discKey('Annulus fibrosus T3 T4')?.key).toBe('disc-third-thoracic-vertebra');
    expect(discKey('Annulus fibrosus T12 L1')?.key).toBe('disc-twelfth-thoracic-vertebra');
    expect(discKey('Annulus fibrosus L5 S1')).toMatchObject({ key: 'disc-fifth-lumbar-vertebra', above: 'l5', below: 'sacrum' });
    expect(costalNumber('Costal cart of 11th rib')).toBe(11);
  });
});

describe('soft-tissue tables (phase 3)', () => {
  it('maps the clinically central ligaments, overlay shells included, to stable keys and kinds', () => {
    expect(softSpec('Anterior cruciate ligament')).toMatchObject({ kind: 'ligament', key: 'anterior-cruciate-ligament' });
    expect(softSpec('Articular capsule of knee joint')).toMatchObject({ kind: 'capsule', key: 'knee-capsule' });
    expect(softSpec('Subacromial-subdeltoid bursa')).toMatchObject({ kind: 'bursa' });
    expect(softSpec('Iliotibial tract')).toMatchObject({ kind: 'fascia', key: 'iliotibial-tract' });
    expect(softSpec('Medial collateral ligament')).toBeNull(); // only as an overlay shell
    expect(softSpec('Medial collateral ligament', true)).toMatchObject({ kind: 'ligament', key: 'medial-collateral-ligament' });
    expect(softSpec('Descending part of Iliofemoral ligament', true)).toMatchObject({ key: 'iliofemoral-ligament', part: { key: 'descending-part' } });
  });
  it('names one structure per digit for the digit objects', () => {
    const s = softSpec('Articular capsules of distal interphalangeal joints')!;
    expect(s.split!.name('index')).toEqual({ key: 'dip-capsule-index', label: 'Distal Interphalangeal Joint Capsule (Index Finger)' });
    expect(s.split!.name('thumb')).toEqual({ key: 'ip-capsule-thumb', label: 'Interphalangeal Joint Capsule (Thumb)' });
    expect(digitOf('little-proximal')).toBe('little');
    expect(FILE_RENAMES['lower-limb']!['Articular capsules of distal interphalangeal joints']).toBe('Articular capsules of distal interphalangeal joints of foot');
  });
  it('gives every skipped overlay a reason and maps no object twice', () => {
    for (const [k, why] of Object.entries(OVERLAY_SKIP)) { expect(why.length, k).toBeGreaterThan(20); expect(softSpec(k, true), k).toBeNull(); }
    const keys = SOFT_ENTRIES().filter(([, s]) => !s.split && !s.part).map(([, s]) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('builds every mapped structure on both sides (or once on the midline)', () => {
    for (const [, s] of SOFT_ENTRIES()) {
      if (s.split) continue;
      expect(byId.has(`${s.key}-l`) || byId.has(s.key), s.key).toBe(true);
    }
  });
});
