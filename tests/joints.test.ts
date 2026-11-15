import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../app/lib/catalog';
import { KINDS, LAYER_KEYS } from '../app/lib/kinds';
import { jointInfo } from '../app/lib/data/joints';
import { buildSearchIndex, search } from '../app/lib/search';
import { buildPool, candidateKeys, makeQuestion, mulberry32, QUESTION_TYPES } from '../app/lib/quiz';
import { decodeUrlState, encodeUrlState, withDefaults } from '../app/lib/urlState';
import { DEFAULT_LAYERS } from '../app/lib/atlasState';
import { structureRegion } from '../app/lib/three/viewer';
import { byId, structures } from './fixtures';

const joints = structures.filter((s) => KINDS[s.kind].library === 'joint');
const catalog = buildCatalog(structures);

describe('kinds', () => {
  it('every kind in the manifest has a row, and layers are unique', () => {
    for (const s of structures) expect(KINDS[s.kind], s.kind).toBeDefined();
    expect(new Set(LAYER_KEYS).size).toBe(LAYER_KEYS.length);
    for (const k of Object.values(KINDS)) expect(LAYER_KEYS).toContain(k.layer);
  });
  it('the manifest has articular cartilage and fibrocartilage, attached to existing bones', () => {
    expect(joints.filter((s) => s.kind === 'articular').length).toBeGreaterThan(150);
    expect(joints.filter((s) => s.kind === 'fibrocartilage').length).toBeGreaterThanOrEqual(15);
    for (const s of joints) for (const b of s.attach ?? []) expect(byId.get(b)?.kind, `${s.id} -> ${b}`).toBe('bone');
  });
});

describe('joint descriptions', () => {
  it('every joint surface has a description and a named group', () => {
    for (const s of joints) {
      const j = jointInfo(s);
      expect(j.group, s.key).not.toBe('Other');
      expect(j.description.length, s.key).toBeGreaterThan(30);
      expect(j.reviewed, s.key).toBeUndefined(); // none has been checked yet
    }
  });
  it('places the hip and shoulder joint surfaces in their limb, whatever bone they sit on', () => {
    expect(structureRegion(byId.get('acetabular-labrum-l')!)).toBe('Lower limb');
    expect(structureRegion(byId.get('cartilage-acetabulum-l')!)).toBe('Lower limb');
    expect(structureRegion(byId.get('glenoid-labrum-r')!)).toBe('Upper limb');
    expect(structureRegion(byId.get('medial-meniscus-l')!)).toBe('Lower limb');
    expect(structureRegion(byId.get('cartilage-c3')!)).toBe('Head & neck');
  });
});

describe('library and search', () => {
  it('lists the joint surfaces in the Joints tab, paired left/right', () => {
    const m = catalog.find((c) => c.key === 'medial-meniscus')!;
    expect(m.ids).toEqual({ l: 'medial-meniscus-l', r: 'medial-meniscus-r' });
    expect(m.group).toBe('Knee');
    expect(catalog.find((c) => c.key === 'interpubic-disc')!.ids).toEqual({ m: 'interpubic-disc' });
  });
  it('finds menisci, labra and the TFCC, and keeps bones ahead of the cartilage named after them', () => {
    const idx = buildSearchIndex(catalog);
    const q = (s: string) => search(idx, s).map((r) => r.item.key);
    expect(q('menisci').slice(0, 2).sort()).toEqual(['lateral-meniscus', 'medial-meniscus']);
    expect(q('tfcc')[0]).toBe('triangular-fibrocartilage');
    expect(q('labrum').slice(0, 2).sort()).toEqual(['acetabular-labrum', 'glenoid-labrum']);
    expect(q('humerus')[0]).toBe('humerus');
    expect(q('femoral head')[0]).toBe('cartilage-femoral-head');
  });
});

describe('quiz', () => {
  const pool = buildPool(structures);
  it('asks to identify the larger joint structures, never per-digit or per-rib pieces', () => {
    const keys = candidateKeys(pool, { types: [...QUESTION_TYPES], regions: [] }).filter((k) => k.includes('|joint:'));
    expect(keys.length).toBeGreaterThan(10);
    expect(keys).toContain('identify|joint:medial-meniscus');
    // (cartilage- prefix: phase 3 adds single structures named after the metacarpals, e.g. the deep transverse metacarpal ligaments)
    for (const k of keys) expect(k).not.toMatch(/-(proximal|middle|distal)$|rib-|cartilage-(metacarpal|metatarsal)/);
    for (const k of keys) {
      const qn = makeQuestion(pool, k, mulberry32(3), [])!;
      expect(qn.prompt).toMatch(/joint structure/);
      const s = byId.get(qn.highlight!)!;
      expect(KINDS[s.kind].library).toBe('joint');
      expect(qn.options[qn.answer].label).toBe(s.label);
      for (const o of qn.options) expect(pool.joints.has(o.id)).toBe(true);
    }
  });
});

describe('URL state', () => {
  it('round-trips the new layer switches', () => {
    const st = { ...withDefaults({}), layers: { ...DEFAULT_LAYERS, articular: false, fibro: false } };
    const enc = encodeUrlState(st);
    expect(enc).toContain('off=articular,fibro');
    expect(decodeUrlState(enc, () => true).layers).toMatchObject({ articular: false, fibro: false });
  });
  it('keeps old links to the renamed T12-L1 disc working', () => {
    expect(decodeUrlState('s=disc', (id) => byId.has(id)).selected).toBe('disc-twelfth-thoracic-vertebra');
    expect(decodeUrlState('s=humerus-l', (id) => byId.has(id)).selected).toBe('humerus-l');
  });
});
