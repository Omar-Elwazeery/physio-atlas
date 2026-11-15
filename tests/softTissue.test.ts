import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../app/lib/catalog';
import { KINDS, LAYERS, LAYER_DEFAULTS } from '../app/lib/kinds';
import { jointInfo } from '../app/lib/data/joints';
import { buildSearchIndex, search, ALIASES } from '../app/lib/search';
import { buildPool, candidateKeys, makeQuestion, mulberry32 } from '../app/lib/quiz';
import { decodeUrlState, encodeUrlState, withDefaults } from '../app/lib/urlState';
import { DEFAULT_LAYERS } from '../app/lib/atlasState';
import { structureRegion } from '../app/lib/three/viewer';
import { resolveSkin } from '../app/lib/rig/skinning';
import { Rig } from '../app/lib/rig/rig';
import { conditionsOf, TISSUE } from '../app/lib/data/learning';
import type { Kind } from '../app/lib/types';
import { byId, structures } from './fixtures';

const SOFT: Kind[] = ['ligament', 'capsule', 'bursa', 'sheath', 'retinaculum', 'fascia', 'fatpad'];
const soft = structures.filter((s) => SOFT.includes(s.kind));
const catalog = buildCatalog(structures);

describe('soft-tissue kinds and layers', () => {
  it('every soft kind has a table row, a layer, the Joints library and tissue text', () => {
    for (const k of SOFT) {
      expect(KINDS[k].library).toBe('joint');
      expect(LAYERS.some((l) => l.key === KINDS[k].layer)).toBe(true);
      expect(TISSUE[k].body.length).toBeGreaterThan(100);
    }
  });
  it('shows ligaments at first, hides retinacula, capsules, bursae and fasciae', () => {
    expect(LAYER_DEFAULTS).toMatchObject({ ligaments: true, retinacula: false, capsules: false, bursae: false, fasciae: false });
    expect(DEFAULT_LAYERS).toMatchObject({ ligaments: true, capsules: false, bursae: false, fasciae: false, bones: true, muscles: true });
  });
  it('the manifest has every soft kind, each from Open 3D Model and fixed to bones', () => {
    for (const k of SOFT) expect(soft.some((s) => s.kind === k), k).toBe(true);
    for (const s of soft) {
      expect(s.source, s.id).toBe('o3d');
      for (const b of s.attach ?? []) expect(byId.get(b)?.kind, `${s.id} -> ${b}`).toBe('bone');
    }
  });
});

describe('descriptions', () => {
  it('every soft-tissue structure has a one-line description, a named joint group, and no review or clinical content', () => {
    for (const s of soft) {
      const j = jointInfo(s);
      expect(j.group, s.key).not.toBe('Other');
      expect(j.description.length, s.key).toBeGreaterThan(30);
      expect(j.description, s.key).not.toMatch(/sprain|tear|rupture|bursitis|syndrome|injur/i);
      expect(j.refs, s.key).toBeUndefined();
      expect(j.reviewed, s.key).toBeUndefined();
      expect(conditionsOf(s), s.key).toEqual([]);
    }
  });
  it('files them under their joint and region', () => {
    expect(jointInfo(byId.get('anterior-cruciate-ligament-l')!).group).toBe('Knee');
    expect(jointInfo(byId.get('anterior-talofibular-ligament-l')!).group).toBe('Ankle & foot');
    expect(jointInfo(byId.get('glenohumeral-capsule-l')!).group).toBe('Shoulder girdle');
    expect(jointInfo(byId.get('mcp-capsule-index-l')!).group).toBe('Wrist & hand');
    expect(jointInfo(byId.get('mtp-capsule-hallux-l')!).group).toBe('Ankle & foot');
    expect(structureRegion(byId.get('iliofemoral-ligament-l')!)).toBe('Lower limb');
    expect(structureRegion(byId.get('fascia-lata-r')!)).toBe('Lower limb');
    expect(structureRegion(byId.get('brachial-fascia-r')!)).toBe('Upper limb');
    expect(structureRegion(byId.get('pubic-ligaments')!)).toBe('Trunk');
  });
});

describe('catalog and search', () => {
  it('lists soft tissue in the Joints library, paired left/right, midline structures once', () => {
    const acl = catalog.find((c) => c.key === 'anterior-cruciate-ligament')!;
    expect(acl.kind).toBe('ligament');
    expect(acl.ids).toEqual({ l: 'anterior-cruciate-ligament-l', r: 'anterior-cruciate-ligament-r' });
    expect(acl.group).toBe('Knee');
    expect(catalog.find((c) => c.key === 'interclavicular-ligament')!.ids).toEqual({ m: 'interclavicular-ligament' });
  });
  it('finds ligaments by name and by the abbreviations students use', () => {
    const idx = buildSearchIndex(catalog);
    const q = (s: string) => search(idx, s).map((r) => r.item.key);
    expect(q('acl')[0]).toBe('anterior-cruciate-ligament');
    expect(q('pcl')[0]).toBe('posterior-cruciate-ligament');
    expect(q('mcl')[0]).toBe('medial-collateral-ligament');
    expect(q('lcl')[0]).toBe('fibular-collateral-ligament');
    expect(q('atfl')[0]).toBe('anterior-talofibular-ligament');
    expect(q('spring ligament')[0]).toBe('plantar-calcaneonavicular-ligament');
    expect(q('carpal tunnel')[0]).toBe('flexor-retinaculum');
    expect(q('plantar fascia')[0]).toBe('plantar-aponeurosis');
    expect(q('deltoid ligament').slice(0, 4).sort()).toEqual(['anterior-tibiotalar-ligament', 'posterior-tibiotalar-ligament', 'tibiocalcaneal-ligament', 'tibionavicular-ligament']);
    expect(q('cruciate').slice(0, 2).sort()).toEqual(['anterior-cruciate-ligament', 'posterior-cruciate-ligament']);
    expect(q('knee capsule')[0]).toBe('knee-capsule');
    expect(q('prepatellar bursa')).toContain('subcutaneous-prepatellar-bursa');
    // the muscle keeps its place ahead of the soft tissue that shares an alias
    expect(q('itb')[0]).toBe('tensor-fasciae-latae');
    expect(q('itb')).toContain('iliotibial-tract');
    expect(q('deltoid')[0]).toBe('deltoid');
  });
  it('every soft-tissue alias target exists in the manifest', () => {
    const keys = new Set(structures.map((s) => s.key));
    for (const a of ALIASES) for (const k of a.joints ?? []) expect(keys.has(k), k).toBe(true);
  });
});

describe('quiz', () => {
  const pool = buildPool(structures);
  const keys = candidateKeys(pool, { types: ['identify'], regions: [] }).filter((k) => k.startsWith('identify|joint:'));
  it('asks to identify the larger ligaments, capsules and bursae, not per-digit or tiny ones', () => {
    for (const k of ['anterior-cruciate-ligament', 'medial-collateral-ligament', 'anterior-talofibular-ligament', 'knee-capsule', 'subacromial-subdeltoid-bursa'])
      expect(keys, k).toContain(`identify|joint:${k}`);
    for (const k of keys) expect(k).not.toMatch(/-(thumb|index|middle|ring|little|hallux|toe\d)$/);
    expect(keys).not.toContain('identify|joint:trapeziotrapezoid-ligament');
  });
  it('never puts the answer in the prompt, and offers distractors of the same kind where it can', () => {
    let sameKind = 0, total = 0;
    for (const k of keys.filter((x) => SOFT.includes(byId.get(`${x.split(':')[1]}-l`)?.kind ?? byId.get(x.split(':')[1])!.kind))) {
      const q = makeQuestion(pool, k, mulberry32(7), [])!;
      expect(q, k).not.toBeNull();
      const s = byId.get(q.highlight!)!;
      expect(q.prompt).toBe('Which joint structure is highlighted in the 3D view?');
      expect(q.prompt.toLowerCase()).not.toContain(s.label.toLowerCase());
      expect(q.options[q.answer].label).toBe(s.label);
      for (const o of q.options) { total++; if (catalog.find((c) => c.key === o.id)!.kind === s.kind) sameKind++; }
    }
    expect(sameKind / total).toBeGreaterThan(0.9);
  });
});

describe('URL state', () => {
  it('writes layers that start off as on=, and layers that start on as off=', () => {
    const st = { ...withDefaults({}), layers: { ...DEFAULT_LAYERS, capsules: true, bursae: true, ligaments: false } };
    const enc = encodeUrlState(st);
    expect(enc).toContain('off=ligaments');
    expect(enc).toContain('on=capsules,bursae');
    expect(decodeUrlState(enc, () => true).layers).toMatchObject({ capsules: true, bursae: true, ligaments: false });
    expect(encodeUrlState(withDefaults({}))).toBe('');
  });
  it('keeps old links working and ignores unknown layer names', () => {
    expect(decodeUrlState('off=bones,articular', () => true).layers).toEqual({ bones: false, articular: false });
    expect(decodeUrlState('on=nonsense,fasciae', () => true).layers).toEqual({ fasciae: true });
    expect(decodeUrlState('s=anterior-cruciate-ligament-l', (id) => byId.has(id)).selected).toBe('anterior-cruciate-ligament-l');
  });
});

describe('skinning', () => {
  const rig = new Rig(byId);
  it('blends a ligament across its joint and keeps a bursa or an intercarpal ligament rigid', () => {
    // the bones' nodes, then the arc nodes of the knee between them
    expect(resolveSkin(byId.get('anterior-cruciate-ligament-l')!, rig)).toEqual({ mode: 'attach', nodes: ['femur-l', 'tibia-l', 'tibia-arc1-l', 'tibia-arc2-l', 'tibia-arc3-l'] });
    expect(resolveSkin(byId.get('retrocalcaneal-bursa-l')!, rig).mode).toBe('rigid');
    // both bones are in the proximal carpal row, which is one rig node
    expect(resolveSkin(byId.get('scapholunate-ligament-l')!, rig)).toEqual({ mode: 'rigid', node: 'carpus-l' });
  });
  it('the structures blended across nodes carry a baked skin naming rig nodes', () => {
    for (const s of soft) {
      const spec = resolveSkin(s, rig);
      if (spec.mode !== 'attach') continue;
      expect(s.skin, s.id).toEqual(spec.nodes);
      for (const n of s.skin!) expect(rig.nodes.has(n), n).toBe(true);
    }
  });
});
