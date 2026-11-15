import { describe, expect, it } from 'vitest';
import { MUSCLE_INFO } from '../app/lib/data/muscles';
import {
  NERVES, NERVE_INDEX, NERVE_PARENT, ROOT_ORDER, buildNerveIndex, filterLabel, musclesOfFilter, nerveOptions, parseInnervation, rootOptions, supplyOf, validFilter, viaNerves,
} from '../app/lib/nerves';
import { decodeUrlState, encodeUrlState, withDefaults } from '../app/lib/urlState';
import { atlasReducer, INITIAL_ATLAS } from '../app/lib/atlasState';
import { muscles } from './fixtures';

const keysOf = (nerve: string) => new Set(NERVE_INDEX.nerves.get(nerve));
const rootKeys = (root: string) => new Set(NERVE_INDEX.roots.get(root));

describe('parseInnervation', () => {
  it('parses every distinct innervation string in the data without issues', () => {
    const distinct = new Set(Object.values(MUSCLE_INFO).map((m) => m.innervation));
    expect(distinct.size).toBeGreaterThan(50);
    for (const text of distinct) {
      const s = parseInnervation(text);
      expect(s.issues, text).toEqual([]);
      expect(s.nerves.length, text).toBeGreaterThan(0);
      for (const n of s.nerves) expect(NERVES.has(n), `${text}: ${n}`).toBe(true);
    }
  });

  it('gives every documented muscle at least one nerve entry (a named nerve, or the segmental rami)', () => {
    for (const [key, info] of Object.entries(MUSCLE_INFO)) expect(supplyOf(key)!.nerves.length, `${key}: ${info.innervation}`).toBeGreaterThan(0);
    for (const m of muscles) expect(supplyOf(m.key), `manifest muscle ${m.key} has no entry`).toBeDefined();
  });

  it('treats different root ranges of one nerve as the same nerve', () => {
    for (const t of ['Radial nerve (C6–C8)', 'Radial nerve (C5–C6)', 'Radial nerve (C7-T1)']) expect(parseInnervation(t).direct).toEqual(['radial']);
  });

  it('expands root ranges, with an en dash or a hyphen, across region boundaries', () => {
    expect(parseInnervation('Radial nerve (C5–C7)').roots).toEqual(['C5', 'C6', 'C7']);
    expect(parseInnervation('Femoral nerve (L2-L4)').roots).toEqual(['L2', 'L3', 'L4']);
    expect(parseInnervation('Intercostal nerves (T7–T12)').roots).toEqual(['T7', 'T8', 'T9', 'T10', 'T11', 'T12']);
    expect(parseInnervation('Pudendal nerve (S1–S2)').roots).toEqual(['S1', 'S2']);
    expect(parseInnervation('Medial pectoral nerve (C8–T1)').roots).toEqual(['C8', 'T1']);
    expect(parseInnervation('Anterior rami of T12–L4').roots).toEqual(['T12', 'L1', 'L2', 'L3', 'L4']);
    expect(parseInnervation('Superior gluteal nerve (L4–S1)').roots).toEqual(['L4', 'L5', 'S1']);
    expect(parseInnervation('Suboccipital nerve (C1)').roots).toEqual(['C1']);
    expect(parseInnervation('Dorsal scapular nerve (C5) and C3–C4').roots).toEqual(['C3', 'C4', 'C5']);
  });

  it('gives cranial nerves no spinal roots', () => {
    for (const t of ['Facial nerve (CN VII)', 'Masseteric nerve (CN V3)', 'Mylohyoid nerve (CN V3)']) expect(parseInnervation(t).roots, t).toEqual([]);
    expect(parseInnervation('Spinal accessory nerve (CN XI); C2–C3').direct).toEqual(['accessory']);
  });

  it('splits strings that name several nerves', () => {
    expect(parseInnervation('Upper and lower subscapular nerves (C5–C7)').direct).toEqual(['upper-subscapular', 'lower-subscapular']);
    expect(parseInnervation('Lateral and medial pectoral nerves (C5–T1)').direct).toEqual(['lateral-pectoral', 'medial-pectoral']);
    expect(parseInnervation('Femoral nerve (L2–L3); obturator nerve (sometimes)').direct).toEqual(['femoral', 'obturator']);
    expect(parseInnervation('Femoral nerve (L2–L3); obturator nerve (sometimes)').minor).toEqual(['obturator']);
    expect(parseInnervation('Thoracoabdominal nerves (T7–T11) and subcostal nerve (T12)').direct).toEqual(['thoracoabdominal', 'subcostal']);
    expect(parseInnervation('Posterior belly: facial nerve. Anterior belly: mylohyoid nerve (CN V3)').direct).toEqual(['facial', 'mylohyoid']);
  });

  it('does not mistake "Radial half" or the nerve to obturator internus for other nerves', () => {
    const fdp = parseInnervation('Radial half (digits 2–3): anterior interosseous nerve. Ulnar half (digits 4–5): ulnar nerve (C8–T1)');
    expect(fdp.direct).toEqual(['anterior-interosseous', 'ulnar']);
    expect(parseInnervation('Nerve to obturator internus (L5–S1)').direct).toEqual(['nerve-to-obturator-internus']);
  });

  it('follows the branch table, transitively, and every table entry names real nerves', () => {
    for (const [branch, parent] of Object.entries(NERVE_PARENT)) { expect(NERVES.has(branch)).toBe(true); expect(NERVES.has(parent)).toBe(true); }
    expect(parseInnervation('Posterior interosseous nerve (C7–C8)').nerves).toEqual(['posterior-interosseous', 'radial']);
    expect(parseInnervation('Deep fibular nerve (L5–S1)').nerves).toEqual(['deep-fibular', 'common-fibular', 'sciatic']);
    expect(viaNerves(parseInnervation('Posterior interosseous nerve (C7–C8)'), 'radial')).toEqual(['posterior-interosseous']);
    expect(viaNerves(parseInnervation('Radial nerve (C6–C8)'), 'radial')).toEqual([]);
  });
});

describe('index anchors', () => {
  it('maps deltoid and teres minor to the axillary nerve, and only them', () => {
    expect([...keysOf('axillary')].sort()).toEqual(['deltoid', 'teres-minor']);
  });

  it('puts triceps, brachioradialis, ECRL and the posterior interosseous muscles under the radial nerve', () => {
    const radial = keysOf('radial');
    for (const k of ['triceps-brachii', 'brachioradialis', 'extensor-carpi-radialis-longus', 'supinator', 'anconeus']) expect(radial.has(k), k).toBe(true);
    const pin = keysOf('posterior-interosseous');
    expect(pin.size).toBeGreaterThan(5);
    for (const k of pin) expect(radial.has(k), `${k} (posterior interosseous) should also be radial`).toBe(true);
    expect(radial.has('biceps-brachii')).toBe(false);
  });

  it('puts deltoid and biceps under C5 and not under L5', () => {
    const c5 = rootKeys('C5');
    expect(c5.has('deltoid')).toBe(true);
    expect(c5.has('biceps-brachii')).toBe(true);
    expect(rootKeys('L5').has('deltoid')).toBe(false);
    expect(rootKeys('C8').has('deltoid')).toBe(false);
  });

  it('matches a multi-root muscle at every root inside its range', () => {
    for (const r of ['C6', 'C7', 'C8']) expect(rootKeys(r).has('triceps-brachii'), r).toBe(true);
    for (const r of ['C5', 'T1']) expect(rootKeys(r).has('triceps-brachii'), r).toBe(false);
  });

  it('is consistent: every nerve and root of a muscle lists that muscle', () => {
    const idx = buildNerveIndex(MUSCLE_INFO);
    for (const [key, s] of idx.supply) {
      for (const n of s.nerves) expect(idx.nerves.get(n)).toContain(key);
      for (const r of s.roots) expect(idx.roots.get(r)).toContain(key);
    }
    for (const r of idx.roots.keys()) expect(ROOT_ORDER).toContain(r);
  });

  it('lists pickers with counts and no empty entries', () => {
    const n = nerveOptions();
    expect(n.length).toBeGreaterThan(30);
    for (const o of n) expect(o.count).toBe(NERVE_INDEX.nerves.get(o.id)!.length);
    expect(n[0].kind).toBe('peripheral');
    const r = rootOptions();
    expect(r[0].id).toBe('C1');
    expect(r.find((x) => x.id === 'C5')!.count).toBe(NERVE_INDEX.roots.get('C5')!.length);
  });
});

describe('filter helpers', () => {
  it('validates against the index and canonicalises root ids', () => {
    expect(validFilter({ by: 'nerve', id: 'radial' })).toEqual({ by: 'nerve', id: 'radial' });
    expect(validFilter({ by: 'root', id: 'c5' })).toEqual({ by: 'root', id: 'C5' });
    expect(validFilter({ by: 'nerve', id: 'nope' })).toBeNull();
    expect(validFilter({ by: 'root', id: 'C9' })).toBeNull();
    expect(validFilter({ by: 'other', id: 'radial' })).toBeNull();
    expect(validFilter(null)).toBeNull();
  });
  it('lists muscles and labels', () => {
    expect(musclesOfFilter({ by: 'nerve', id: 'axillary' })).toContain('deltoid');
    expect(filterLabel({ by: 'nerve', id: 'radial' })).toBe('Radial nerve');
    expect(filterLabel({ by: 'root', id: 'C5' })).toBe('Root level C5');
  });
});

describe('URL state', () => {
  const yes = () => true;
  it('round-trips a nerve filter and a root filter', () => {
    for (const nerve of [{ by: 'nerve', id: 'radial' }, { by: 'root', id: 'C5' }] as const) {
      const q = encodeUrlState({ ...withDefaults({}), nerve });
      expect(q).toBe(nerve.by === 'nerve' ? 'nerve=radial' : 'root=C5');
      expect(decodeUrlState(q, yes).nerve).toEqual(nerve);
      expect(withDefaults(decodeUrlState(q, yes)).nerve).toEqual(nerve);
    }
  });
  it('writes nothing without a filter, and nothing outside Explore', () => {
    expect(encodeUrlState(withDefaults({}))).toBe('');
    expect(encodeUrlState({ ...withDefaults({ tab: 'move' }), nerve: { by: 'nerve', id: 'radial' } })).toBe('tab=move');
    expect(encodeUrlState({ ...withDefaults({ tab: 'quiz' }), nerve: { by: 'root', id: 'C5' } })).toBe('tab=quiz');
  });
  it('drops unknown or malformed values and ignores the filter in a quiz link', () => {
    for (const q of ['nerve=nope', 'root=C99', 'nerve=', 'root=%E0%A4%A', 'nerve=__proto__', 'root=constructor']) expect(decodeUrlState(q, yes).nerve, q).toBeUndefined();
    expect(decodeUrlState('root=c6', yes).nerve).toEqual({ by: 'root', id: 'C6' });
    expect(decodeUrlState('nerve=radial&root=C5', yes).nerve).toEqual({ by: 'nerve', id: 'radial' });
    expect(decodeUrlState('tab=quiz&nerve=radial', yes).nerve).toBeUndefined();
  });
  it('keeps the other fields intact next to the filter', () => {
    const st = decodeUrlState('s=deltoid-l&tab=explore&nerve=axillary&side=l', (id) => id === 'deltoid-l');
    expect(st.selected).toBe('deltoid-l');
    expect(st.nerve).toEqual({ by: 'nerve', id: 'axillary' });
    expect(st.layers?.side).toBe('l');
  });
});

describe('atlas state', () => {
  const radial = { by: 'nerve', id: 'radial' } as const;
  it('sets and clears the filter', () => {
    const a = atlasReducer(INITIAL_ATLAS, { type: 'nerveFilter', filter: radial });
    expect(a.nerveFilter).toEqual(radial);
    expect(atlasReducer(a, { type: 'nerveFilter', filter: { ...radial } })).toBe(a);
    expect(atlasReducer(a, { type: 'nerveFilter', filter: null }).nerveFilter).toBeNull();
  });
  it('showNerve switches to Explore from Movement, but never leaves a pending quiz question', () => {
    const move = atlasReducer(INITIAL_ATLAS, { type: 'tab', tab: 'move' });
    const shown = atlasReducer(move, { type: 'showNerve', filter: radial });
    expect(shown.tab).toBe('explore');
    expect(shown.nerveFilter).toEqual(radial);
    const quiz = atlasReducer(INITIAL_ATLAS, { type: 'tab', tab: 'quiz' });
    expect(atlasReducer(quiz, { type: 'showNerve', filter: radial })).toBe(quiz);
  });
  it('restores the filter from a link, but not into a quiz', () => {
    expect(atlasReducer(INITIAL_ATLAS, { type: 'restore', patch: { nerveFilter: radial } }).nerveFilter).toEqual(radial);
    expect(atlasReducer(INITIAL_ATLAS, { type: 'restore', patch: { tab: 'quiz', nerveFilter: radial } }).nerveFilter).toBeNull();
  });
});

describe('proprioceptive root levels', () => {
  it('marks the cervical roots of trapezius and sternocleidomastoid as proprioceptive, and no others', () => {
    expect(supplyOf('trapezius')?.sensoryRoots).toEqual(['C3', 'C4']);
    expect(supplyOf('sternocleidomastoid')?.sensoryRoots).toEqual(['C2', 'C3']);
    const others = [...NERVE_INDEX.supply].filter(([k, s]) => s.sensoryRoots.length && k !== 'trapezius' && k !== 'sternocleidomastoid');
    expect(others).toEqual([]);
  });
  it('keeps them in the root index so the filter still lists them', () => {
    expect(NERVE_INDEX.roots.get('C4')).toContain('trapezius');
    expect(parseInnervation('Radial nerve (C6–C8)').sensoryRoots).toEqual([]);
  });
});
