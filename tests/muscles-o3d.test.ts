import { describe, expect, it } from 'vitest';
import { MUSCLE_SKIP, O3D_MUSCLE_KEYS, muscleSpec, o3dKind } from '../scripts/lib/open3d';
import { MUSCLE_INFO } from '../app/lib/data/muscles';
import { BoneProximity } from '../app/lib/rig/proximity';
import { byId, muscles } from './fixtures';

describe('O3D muscle table', () => {
  it('maps muscles and tendons onto existing app keys and parts', () => {
    expect(muscleSpec('Long head of biceps brachii')).toEqual({ key: 'biceps-brachii', part: { key: 'long-head', label: '' } });
    expect(muscleSpec('Common tendon of biceps brachii')).toMatchObject({ key: 'biceps-brachii', part: { key: 'tendon' }, tendon: true });
    expect(muscleSpec('Calcaneal tendon')).toMatchObject({ key: 'gastrocnemius', tendon: true });
    expect(muscleSpec('3rd dorsal interosseus of hand')).toMatchObject({ key: 'dorsal-interossei-of-hand', part: { key: 'third', label: 'Third dorsal interosseus' } });
    expect(muscleSpec('1st lumbrical of hand')?.part.key).toBe('main');
    expect(muscleSpec('Lumbrical muscles of foot')?.split).toEqual(['first', 'second', 'third', 'fourth'].map((n) => `${n}-lumbrical-of-foot`));
    expect(muscleSpec('Quadratus plantae muscle')?.key).toBe('flexor-accessorius');
  });
  it('keeps the part-structured and missing muscles out', () => {
    for (const n of ['Deltoid muscle', 'Pectoralis major', 'Trapezius muscle', 'Adductor pollicis', 'Latissimus dorsi', 'Coccygeus muscle']) {
      expect(muscleSpec(n)).toBeNull();
      expect(MUSCLE_SKIP[n]).toBeTruthy();
    }
  });
  it('only names keys the app has, and no trunk, neck or head muscle', () => {
    for (const k of O3D_MUSCLE_KEYS) {
      expect(MUSCLE_INFO[k], k).toBeTruthy();
      expect(['Upper limb', 'Lower limb']).toContain(MUSCLE_INFO[k].region);
    }
  });
  it('classifies tendons and aponeuroses in the muscle groups as tendon', () => {
    expect(o3dKind('Muscles', 'Calcaneal tendon')).toBe('tendon');
    expect(o3dKind('Arm - muscles', 'Bicipital aponeurosis')).toBe('tendon');
    expect(o3dKind('Hand and wrist - muscles', 'Extensor hood of 2nd finger')).toBe('tendon');
  });
});

describe('shipped muscles', () => {
  it('has every muscle of the muscle tables, sourced as the build promises', () => {
    for (const k of Object.keys(MUSCLE_INFO)) {
      const ids = muscles.filter((s) => s.key === k);
      expect(ids.length, k).toBeGreaterThan(0);
      for (const s of ids) expect(s.source, s.id).toBe(O3D_MUSCLE_KEYS.includes(k) ? 'o3d' : 'bp3d');
    }
  });
  it('keeps the BodyParts3D part keys of the muscles it replaces and adds tendon parts', () => {
    expect(byId.get('biceps-brachii-l')!.parts.map((p) => p.key)).toEqual(['short-head', 'long-head', 'bicipital-aponeurosis', 'tendon']);
    expect(byId.get('gastrocnemius-r')!.parts.find((p) => p.key === 'calcaneal-tendon')?.tendon).toBe(true);
    expect(byId.get('flexor-pollicis-brevis-l')!.parts.map((p) => p.key)).toEqual(['main', 'superficial-head']);
  });
});

describe('BoneProximity', () => {
  it('measures the distance to the nearest bone vertex of a node, within range', () => {
    const p = new BoneProximity((n) => (n === 0 ? [new Float32Array([0, 0, 0, 0.01, 0, 0])] : []));
    expect(p.distance(0, 0.013, 0, 0)).toBeCloseTo(0.003, 6);
    expect(p.distance(0, 0.5, 0, 0)).toBe(Infinity);
    expect(p.distance(1, 0, 0, 0)).toBe(Infinity);
  });
});
