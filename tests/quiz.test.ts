import { KINDS } from '../app/lib/kinds';
import { describe, expect, it } from 'vitest';
import {
  BOX_COUNT, BOX_INTERVAL, boxCounts, buildPool, candidateKeys, clearProgress, DEFAULT_TYPES, emptyProgress, loadPrefs, loadProgress, makeQuestion, mulberry32,
  nerveSig, nervesConflict, nextQuestion, oneLine, parseProgress, pickKey, PREFS_KEY, PROGRESS_KEY, QUESTION_TYPES, recordAnswer, savePrefs, saveProgress,
  type KV, type Progress, type Question, type QuestionType,
} from '../app/lib/quiz';
import { REGIONS } from '../app/lib/catalog';
import { muscleInfo } from '../app/lib/data/muscles';
import { movementsOfMuscle } from '../app/lib/roles';
import { atlasReducer, INITIAL_ATLAS, type AtlasState } from '../app/lib/atlasState';
import { decodeUrlState, encodeUrlState, withDefaults } from '../app/lib/urlState';
import type { Region } from '../app/lib/types';
import { byId, structures } from './fixtures';

const pool = buildPool(structures);
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/** Every question the pool can make, for several seeds, with and without a region filter. */
function* allQuestions(types: readonly QuestionType[] = QUESTION_TYPES): Generator<Question> {
  for (const e of pool.entries) {
    if (!types.includes(e.type)) continue;
    for (const seed of SEEDS) {
      const q = makeQuestion(pool, e.key, mulberry32(seed * 7919 + e.key.length));
      expect(q, e.key).not.toBeNull();
      yield q!;
    }
  }
}

const subjectOf = (q: Question) => q.key.slice(q.key.indexOf('|') + 1);
const muscleKeyOf = (q: Question) => subjectOf(q).replace(/^muscle:/, '');

describe('pool', () => {
  it('has questions of every type and for every region and type combination the UI offers', () => {
    for (const t of QUESTION_TYPES) {
      expect(pool.entries.filter((e) => e.type === t).length, t).toBeGreaterThan(30);
      for (const r of REGIONS) expect(candidateKeys(pool, { types: [t], regions: [r] }).length, `${t} ${r}`).toBeGreaterThan(0);
    }
  });

  it('never uses a muscle that has no documentation, and skips it silently', () => {
    const fake = { ...byId.get('deltoid-l')!, id: 'zz-undocumented-l', key: 'zz-undocumented', label: 'Zz Undocumented' };
    const p = buildPool([...structures, fake]);
    expect(p.muscles.has('zz-undocumented')).toBe(false);
    expect(p.entries.some((e) => e.key.includes('zz-undocumented'))).toBe(false);
    for (const seed of SEEDS) for (const e of p.entries) {
      const q = makeQuestion(p, e.key, mulberry32(seed))!;
      expect(JSON.stringify(q)).not.toContain('Zz Undocumented');
    }
  });

  it('never puts the "Not yet documented" placeholder in a question', () => {
    for (const q of allQuestions()) expect(JSON.stringify(q)).not.toContain('Not yet documented');
  });
});

describe('every generated question', () => {
  it('has exactly one correct option among 4 distinct options', () => {
    let n = 0;
    for (const q of allQuestions()) {
      n++;
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options.map((o) => o.id)).size, q.key).toBe(4);
      expect(new Set(q.options.map((o) => o.label)).size, q.key).toBe(4);
      expect(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4, q.key).toBe(true);
      expect(q.prompt.length).toBeGreaterThan(5);
      expect(q.explanation.length).toBeGreaterThan(5);
      expect(byId.has(q.reveal), `${q.key} reveal ${q.reveal}`).toBe(true);
    }
    expect(n).toBeGreaterThan(5000);
  });

  it('is reproducible from a seed, and different seeds vary the options', () => {
    const key = pool.entries.find((e) => e.type === 'identify')!.key;
    expect(makeQuestion(pool, key, mulberry32(42))).toEqual(makeQuestion(pool, key, mulberry32(42)));
    const variants = new Set(SEEDS.map((s) => JSON.stringify(makeQuestion(pool, key, mulberry32(s))!.options.map((o) => o.id))));
    expect(variants.size).toBeGreaterThan(1);
  });

  it('honours the region filter', () => {
    for (const r of REGIONS) {
      const filter = { types: [...QUESTION_TYPES], regions: [r] as Region[] };
      for (const key of candidateKeys(pool, filter)) {
        for (const seed of [1, 2, 3]) expect(makeQuestion(pool, key, mulberry32(seed), filter.regions)!.region, key).toBe(r);
      }
    }
  });

  it('draws most distractors from the same region as the answer', () => {
    let same = 0, total = 0;
    for (const q of allQuestions(['identify'])) {
      const regionOf = (id: string) => pool.muscles.get(id)?.item.region ?? pool.bones.get(id)?.item.region ?? pool.joints.get(id)?.item.region;
      const want = q.region;
      for (const [i, o] of q.options.entries()) if (i !== q.answer) { total++; if (regionOf(o.id) === want) same++; }
    }
    expect(same / total).toBeGreaterThan(0.85);
  });
});

describe('identify and locate', () => {
  it('highlight a real, solid structure of the right muscle or bone, never a schematic one', () => {
    for (const q of allQuestions(['identify'])) {
      const [kind, key] = subjectOf(q).split(':');
      const s = byId.get(q.highlight!)!;
      expect(s, q.key).toBeDefined();
      expect(kind === 'joint' ? KINDS[s.kind].library : s.kind).toBe(kind);
      expect(s.key).toBe(key);
      expect(s.schematic, q.key).toBeFalsy();
      expect(q.reveal).toBe(q.highlight);
      expect(q.options[q.answer].label).toBe(s.label);
      // all options name the same kind of structure
      const tab = (o: { id: string }) => (kind === 'muscle' ? pool.muscles.get(o.id)?.item.kind : kind === 'bone' ? pool.bones.get(o.id)?.item.kind : pool.joints.get(o.id) && 'joint');
      expect(new Set(q.options.map(tab))).toEqual(new Set([kind]));
    }
  });

  it('never offers a bone from the digits (too small to pick out) and leaves no left/right twin among the options', () => {
    for (const q of allQuestions(['identify'])) for (const o of q.options) {
      if (subjectOf(q).startsWith('bone:')) expect(pool.bones.get(o.id)!.item.group).not.toBe('Digits');
      expect(o.label).not.toMatch(/\b(left|right)\b/i);
    }
  });

  it('locate asks for a muscle by name, highlights nothing, and checks the clicked muscle by key', () => {
    for (const q of allQuestions(['locate'])) {
      expect(q.highlight).toBeNull();
      expect(q.clickKey).toBe(muscleKeyOf(q));
      expect(q.options[q.answer].id).toBe(q.clickKey);
      expect(byId.get(q.reveal)!.schematic).toBeFalsy();
      expect(q.prompt).toContain(q.options[q.answer].label);
    }
  });
});

describe('innervation', () => {
  it('has the muscle\'s own innervation as the answer and no other option that names the same nerve', () => {
    for (const q of allQuestions(['innervation'])) {
      const own = muscleInfo(muscleKeyOf(q)).innervation;
      expect(q.options[q.answer].label).toBe(own);
      const ownSig = nerveSig(own);
      q.options.forEach((o, i) => {
        if (i === q.answer) return;
        expect(o.label, q.key).not.toBe(own);
        expect(nervesConflict(nerveSig(o.label), ownSig), `${q.key}: "${o.label}" vs "${own}"`).toBe(false);
        for (const [j, p] of q.options.entries()) if (j !== i && j !== q.answer) expect(nervesConflict(nerveSig(o.label), nerveSig(p.label))).toBe(false);
      });
      expect(q.explanation).toContain(own);
    }
  });

  it('treats strings that name the same nerve as the same answer', () => {
    const c = (a: string, b: string) => nervesConflict(nerveSig(a), nerveSig(b));
    expect(c('Radial nerve (C5–C6)', 'Radial nerve (C7–T1)')).toBe(true);
    expect(c('Posterior interosseous nerve (C7–C8)', 'Radial nerve (C6–C8)')).toBe(true);
    expect(c('Ulnar nerve, deep branch (C8–T1)', 'Ulnar nerve (C7–C8)')).toBe(true);
    expect(c('Median nerve (recurrent branch) and ulnar nerve (deep head)', 'Ulnar nerve (C7–C8)')).toBe(true);
    expect(c('Facial nerve (CN VII)', 'Facial nerve, cervical branch (CN VII)')).toBe(true);
    expect(c('Masseteric nerve (CN V3)', 'Deep temporal nerves (CN V3)')).toBe(true);
    expect(c('Deep fibular nerve (L5–S1)', 'Superficial fibular nerve (L5–S1)')).toBe(true);
    expect(c('Anterior rami (C1–C3)', 'Anterior rami of L1–L3')).toBe(true);
    expect(c('Femoral nerve (L2–L4)', 'Obturator nerve (L2–L4)')).toBe(false);
    expect(c('Axillary nerve (C5–C6)', 'Suprascapular nerve (C5–C6)')).toBe(false);
    expect(c('Medial plantar nerve (S1–S2)', 'Lateral plantar nerve (S1–S3)')).toBe(false);
    expect(c('Dorsal rami of spinal nerves (C8–T6)', 'Anterior rami (C2–C8)')).toBe(false);
  });
});

describe('action', () => {
  it('has a prime mover as the answer and no muscle that takes part in the movement as a wrong option', () => {
    for (const q of allQuestions(['action'])) {
      const move = subjectOf(q);
      const inMove = (key: string) => movementsOfMuscle(key).find((m) => `${m.joint}.${m.dof.id}.${m.dir}` === move);
      expect(inMove(q.options[q.answer].id)?.role, q.key).toBe('prime');
      q.options.forEach((o, i) => { if (i !== q.answer) expect(inMove(o.id), `${q.key}: ${o.label}`).toBeUndefined(); });
      expect(byId.get(q.reveal)!.key).toBe(q.options[q.answer].id);
    }
  });

  it('usually includes an antagonist (a prime mover of the opposite movement) as a tempting wrong answer', () => {
    let withAntagonist = 0, total = 0;
    for (const q of allQuestions(['action'])) {
      total++;
      const move = subjectOf(q);
      const opposite = move.endsWith('.pos') ? `${move.slice(0, -4)}.neg` : `${move.slice(0, -4)}.pos`;
      if (q.options.some((o, i) => i !== q.answer && movementsOfMuscle(o.id).some((m) => `${m.joint}.${m.dof.id}.${m.dir}` === opposite && m.role === 'prime'))) withAntagonist++;
    }
    expect(withAntagonist / total).toBeGreaterThan(0.5);
  });
});

describe('attachment', () => {
  it('names the muscle that really has the text, and no wrong option has that text or a shared landmark', () => {
    for (const q of allQuestions(['attachment'])) {
      const m = /^Which muscle (originates from|inserts on): (.*)\?$/s.exec(q.prompt)!;
      expect(m, q.prompt).not.toBeNull();
      const field = m[1] === 'originates from' ? 'origin' : 'insertion';
      const own = muscleInfo(muscleKeyOf(q));
      expect(own[field]).toBe(m[2]);
      expect(q.options[q.answer].id).toBe(muscleKeyOf(q));
      q.options.forEach((o, i) => {
        if (i === q.answer) return;
        const info = muscleInfo(o.id);
        expect(info.origin, `${q.key}: ${o.label}`).not.toBe(m[2]);
        expect(info.insertion, `${q.key}: ${o.label}`).not.toBe(m[2]);
        const segs = (s: string) => s.toLowerCase().split(/[,;]|\band\b/).map((x) => x.trim()).filter(Boolean);
        const mine = new Set(segs(m[2]));
        expect(segs(info.origin).concat(segs(info.insertion)).some((s) => mine.has(s)), `${q.key}: ${o.label} shares a segment`).toBe(false);
      });
    }
  });
});

describe('oneLine', () => {
  it('keeps whole sentences within the limit and ends with a full stop', () => {
    expect(oneLine('Flexes the elbow')).toBe('Flexes the elbow.');
    expect(oneLine('A. B. C.', 5)).toBe('A. B.');
    expect(oneLine('x'.repeat(400))).toMatch(/…$/);
  });
});

describe('Leitner scheduling', () => {
  const K = 'identify|muscle:deltoid';

  it('promotes one box per correct answer, up to the last box', () => {
    let p = emptyProgress();
    const boxes: number[] = [];
    for (let i = 0; i < 6; i++) { p = recordAnswer(p, K, true); boxes.push(p.cards[K].box); }
    expect(boxes).toEqual([2, 3, 4, 5, 5, 5]);
    expect(p.cards[K]).toMatchObject({ seen: 6, right: 6 });
  });

  it('sends a missed question back to box 1, whatever box it was in', () => {
    let p = emptyProgress();
    for (let i = 0; i < 4; i++) p = recordAnswer(p, K, true);
    expect(p.cards[K].box).toBe(5);
    p = recordAnswer(p, K, false);
    expect(p.cards[K].box).toBe(1);
    expect(p.cards[K]).toMatchObject({ seen: 5, right: 4 });
    expect(recordAnswer(emptyProgress(), K, false).cards[K].box).toBe(1);
  });

  it('is pure: the input progress is never changed, and the clock ticks once per answer', () => {
    const p0 = emptyProgress();
    const p1 = recordAnswer(p0, K, true);
    expect(p0).toEqual(emptyProgress());
    expect(p1.tick).toBe(1);
    expect(recordAnswer(p1, 'x|y', false).tick).toBe(2);
  });

  it('schedules a card BOX_INTERVAL[box] answers ahead, so a miss returns sooner than a hit', () => {
    const miss = recordAnswer(emptyProgress(), K, false);
    const hit = recordAnswer(emptyProgress(), K, true);
    expect(miss.cards[K].due - miss.tick).toBe(BOX_INTERVAL[1]);
    expect(hit.cards[K].due - hit.tick).toBe(BOX_INTERVAL[2]);
    expect(BOX_INTERVAL[1]).toBeLessThan(BOX_INTERVAL[2]);
    for (let b = 1; b < BOX_COUNT; b++) expect(BOX_INTERVAL[b]).toBeLessThan(BOX_INTERVAL[b + 1]);
  });

  it('asks a due card before a new one, lowest box first, and never the question just asked', () => {
    let p = emptyProgress();
    p = recordAnswer(p, 'identify|a', false);        // box 1, due in 2
    p = recordAnswer(p, 'identify|b', true);         // box 2, due in 6
    p = recordAnswer(p, 'identify|c', true);
    p = recordAnswer(p, 'identify|d', true);          // tick 4: a is due (3 + 2 = 5? not yet)
    const keys = ['identify|a', 'identify|b', 'identify|c', 'identify|d', 'identify|new'];
    p = { ...p, tick: 20 };                           // everything is due by now
    for (let seed = 1; seed <= 20; seed++) {
      const k = pickKey(keys, p, mulberry32(seed), null)!;
      expect(['identify|new', 'identify|a', 'identify|b', 'identify|c']).toContain(k); // one of the 3 most urgent, or fresh
    }
    // with no new questions available, the lowest box comes first
    const onlySeen = keys.slice(0, 4);
    const first = new Set(Array.from({ length: 30 }, (_, i) => pickKey(onlySeen, p, mulberry32(i + 1), null)));
    expect(first.has('identify|a')).toBe(true);
    for (let seed = 1; seed <= 20; seed++) expect(pickKey(keys, p, mulberry32(seed), 'identify|a')).not.toBe('identify|a');
    expect(pickKey(['only'], p, mulberry32(1), 'only')).toBe('only');
    expect(pickKey([], p, mulberry32(1))).toBeNull();
  });

  it('brings a missed question back within a few answers, while a correct one stays away', () => {
    const pl = pool;
    const f = { types: [...DEFAULT_TYPES], regions: [] };
    const rng = mulberry32(99);
    let p = emptyProgress();
    const first = nextQuestion(pl, f, p, rng)!;
    p = recordAnswer(p, first.key, false);
    let back = -1;
    for (let i = 1; i <= 8 && back < 0; i++) {
      const q = nextQuestion(pl, f, p, rng, null)!;
      if (q.key === first.key) back = i;
      p = recordAnswer(p, q.key, true);
    }
    expect(back).toBeGreaterThan(0);
    expect(back).toBeLessThanOrEqual(8);

    // a question answered right once is not due again for BOX_INTERVAL[2] answers
    const q0 = nextQuestion(pl, f, emptyProgress(), mulberry32(5))!;
    let p2 = recordAnswer(emptyProgress(), q0.key, true);
    for (let i = 0; i < BOX_INTERVAL[2] - 1; i++) {
      const q = nextQuestion(pl, f, p2, mulberry32(i + 1))!;
      expect(q.key).not.toBe(q0.key);
      p2 = recordAnswer(p2, q.key, true);
    }
  });

  it('summarises boxes for a set of keys', () => {
    let p = recordAnswer(emptyProgress(), 'a|1', true);
    p = recordAnswer(p, 'b|1', false);
    expect(boxCounts(['a|1', 'b|1', 'c|1'], p)).toEqual([1, 1, 1, 0, 0, 0]);
  });

  it('always finds a question for the default filter and for each single type', () => {
    for (const types of [DEFAULT_TYPES, ...QUESTION_TYPES.map((t) => [t])]) {
      for (const seed of [1, 2, 3]) expect(nextQuestion(pool, { types, regions: [] }, emptyProgress(), mulberry32(seed))).not.toBeNull();
    }
    expect(nextQuestion(pool, { types: [], regions: [] }, emptyProgress(), mulberry32(1))).toBeNull();
  });
});

/** In-memory Storage, optionally failing. */
const memory = (init: Record<string, string> = {}): KV & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
};
const broken: KV = {
  getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => { throw new Error('SecurityError'); },
};

describe('persistence', () => {
  it('round-trips progress through storage under a versioned key', () => {
    const store = memory();
    let p = recordAnswer(emptyProgress(), 'identify|muscle:deltoid', true);
    p = recordAnswer(p, 'action|elbow.flexion-extension.pos', false);
    expect(saveProgress(p, store)).toBe(true);
    expect(PROGRESS_KEY).toMatch(/:v1$/);
    expect(Object.keys(store.data)).toEqual([PROGRESS_KEY]);
    expect(loadProgress(store)).toEqual(p);
    expect(clearProgress(store)).toBe(true);
    expect(loadProgress(store)).toEqual(emptyProgress());
  });

  it('tolerates storage that throws on every call', () => {
    expect(loadProgress(broken)).toEqual(emptyProgress());
    expect(saveProgress(emptyProgress(), broken)).toBe(false);
    expect(clearProgress(broken)).toBe(false);
    expect(loadPrefs(broken).types).toEqual(DEFAULT_TYPES);
    expect(savePrefs({ types: ['identify'], regions: [] }, broken)).toBe(false);
  });

  it('tolerates storage that is missing', () => {
    expect(loadProgress(null)).toEqual(emptyProgress());
    expect(saveProgress(emptyProgress(), null)).toBe(false);
    expect(clearProgress(null)).toBe(false);
    expect(loadPrefs(null).types).toEqual(DEFAULT_TYPES);
    // and with no global localStorage at all (node): the defaults go through the same guards
    expect(loadProgress()).toEqual(emptyProgress());
    expect(saveProgress(emptyProgress())).toBe(false);
  });

  it('tolerates a throwing localStorage getter (blocked site data)', () => {
    const g = globalThis as unknown as { localStorage?: unknown };
    Object.defineProperty(g, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    try {
      expect(loadProgress()).toEqual(emptyProgress());
      expect(saveProgress(emptyProgress())).toBe(false);
    } finally { delete g.localStorage; }
  });

  it('ignores corrupt, foreign-version and out-of-range data', () => {
    for (const raw of [null, '', 'not json', '{', '[]', 'null', '{"v":2,"tick":1,"cards":{}}', '{"v":1,"cards":5}', '{"v":"1"}']) {
      expect(parseProgress(raw), String(raw)).toEqual(emptyProgress());
    }
    const messy = parseProgress(JSON.stringify({
      v: 1, tick: 7.6, cards: {
        'a|b': { box: 9, due: 12, seen: 3, right: 99 },        // clamped
        'no-separator': { box: 1, due: 1, seen: 1, right: 1 },  // not a question key
        'c|d': { box: 'x', due: 1, seen: 1, right: 1 },         // bad field
        'e|f': null,
      },
    }));
    expect(messy.tick).toBe(8);
    expect(Object.keys(messy.cards)).toEqual(['a|b']);
    expect(messy.cards['a|b']).toEqual({ box: BOX_COUNT, due: 12, seen: 3, right: 3 });
    expect(loadProgress(memory({ [PROGRESS_KEY]: 'garbage' }))).toEqual(emptyProgress());
  });

  it('keeps and validates the filter preferences', () => {
    const store = memory();
    expect(loadPrefs(store)).toEqual({ types: DEFAULT_TYPES, regions: [] });
    expect(savePrefs({ types: ['locate', 'identify'], regions: ['Trunk'] }, store)).toBe(true);
    expect(loadPrefs(store)).toEqual({ types: ['identify', 'locate'], regions: ['Trunk'] });
    store.setItem(PREFS_KEY, JSON.stringify({ types: ['nope'], regions: ['Nowhere'] }));
    expect(loadPrefs(store)).toEqual({ types: DEFAULT_TYPES, regions: [] });
    store.setItem(PREFS_KEY, JSON.stringify({ types: ['action'], regions: [...REGIONS] }));
    expect(loadPrefs(store)).toEqual({ types: ['action'], regions: [] });
  });

  it('continues a session after a failed save (the in-memory progress is still usable)', () => {
    let p: Progress = emptyProgress();
    for (let i = 0; i < 3; i++) { p = recordAnswer(p, `identify|k${i}`, i % 2 === 0); saveProgress(p, broken); }
    expect(p.tick).toBe(3);
    expect(Object.keys(p.cards)).toHaveLength(3);
  });
});

describe('quiz state: no spoilers, normal behaviour afterwards', () => {
  const start = (s: AtlasState = INITIAL_ATLAS) => atlasReducer(s, { type: 'tab', tab: 'quiz' });

  it('starts blind: entering the quiz clears the selection and locks it', () => {
    const s = start(atlasReducer(INITIAL_ATLAS, { type: 'select', id: 'deltoid-l' }));
    expect(s.tab).toBe('quiz');
    expect(s.selected).toBeNull();
    expect(s.quiz.locked).toBe(true);
  });

  it('refuses selection and search while a question is pending, and keeps the highlight out of `selected`', () => {
    let s = atlasReducer(start(), { type: 'quiz', stage: { highlight: 'biceps-brachii-l', locked: true, isolate: true } });
    expect(s.selected).toBeNull();
    expect(s.quiz.highlight).toBe('biceps-brachii-l');
    expect(atlasReducer(s, { type: 'select', id: 'deltoid-l' }).selected).toBeNull();
    expect(atlasReducer(s, { type: 'search', open: true }).searchOpen).toBe(false);
    expect(atlasReducer(s, { type: 'search', open: 'toggle' }).searchOpen).toBe(false);
    s = atlasReducer(s, { type: 'quizReveal', id: 'biceps-brachii-l', isolate: true });
    expect(s.selected).toBe('biceps-brachii-l');
    expect(s.quiz).toEqual({ highlight: null, locked: false, isolate: true });
    expect(atlasReducer(s, { type: 'select', id: 'deltoid-l' }).selected).toBe('deltoid-l');
    expect(atlasReducer(s, { type: 'search', open: true }).searchOpen).toBe(true);
  });

  it('locking the quiz drops a selection that was made while no question was pending', () => {
    let s = atlasReducer(start(), { type: 'quizReveal', id: 'deltoid-l', isolate: false });
    s = atlasReducer(s, { type: 'quiz', stage: { highlight: null, locked: true, isolate: false } });
    expect(s.selected).toBeNull();
  });

  it('leaving the quiz restores normal selection and search', () => {
    let s = atlasReducer(start(), { type: 'quiz', stage: { highlight: 'biceps-brachii-l', locked: true, isolate: true } });
    s = atlasReducer(s, { type: 'tab', tab: 'move' });
    expect(s.quiz).toEqual({ highlight: null, locked: false, isolate: false });
    expect(atlasReducer(s, { type: 'select', id: 'deltoid-l' }).selected).toBe('deltoid-l');
    expect(atlasReducer(s, { type: 'search', open: true }).searchOpen).toBe(true);
    s = atlasReducer(atlasReducer(s, { type: 'tab', tab: 'quiz' }), { type: 'tab', tab: 'explore' });
    expect(atlasReducer(s, { type: 'select', id: 'deltoid-l' }).selected).toBe('deltoid-l');
  });

  it('a restored deep link into the quiz starts blind and ignores any structure in the URL', () => {
    const s = atlasReducer(INITIAL_ATLAS, { type: 'restore', patch: { tab: 'quiz', selected: 'deltoid-l' } });
    expect(s.tab).toBe('quiz');
    expect(s.selected).toBeNull();
    expect(s.quiz.locked).toBe(true);
  });

  it('the URL never carries the structure in the quiz tab, and tab=quiz round-trips', () => {
    const base = withDefaults({ selected: 'deltoid-l', tab: 'quiz' });
    const q = encodeUrlState(base);
    expect(q).toBe('tab=quiz');
    expect(q).not.toContain('deltoid');
    expect(encodeUrlState({ ...base, tab: 'explore' })).toBe('s=deltoid-l');
    expect(decodeUrlState('tab=quiz', () => true)).toEqual({ tab: 'quiz' });
    // a hand-written link with a structure is stripped too
    expect(decodeUrlState('tab=quiz&s=deltoid-l', () => true)).toEqual({ tab: 'quiz' });
    expect(decodeUrlState('s=deltoid-l&tab=quiz', () => true).selected).toBeUndefined();
    expect(decodeUrlState('tab=nonsense', () => true)).toEqual({});
  });
});
