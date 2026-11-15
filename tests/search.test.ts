import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../app/lib/catalog';
import { ALIASES, buildSearchIndex, editDistance, fold, search, tokenize } from '../app/lib/search';
import { structures } from './fixtures';
import { KINDS } from '../app/lib/kinds';

const catalog = buildCatalog(structures);
const index = buildSearchIndex(catalog);
const q = (query: string, limit = 40) => search(index, query, limit);
const labels = (query: string, n = 5) => q(query).slice(0, n).map((r) => r.item.label);
const top = (query: string) => q(query)[0]?.item.label;
const find = (query: string, label: string) => q(query).find((r) => r.item.label === label);

describe('normalisation', () => {
  it('folds case and diacritics without changing length', () => {
    expect(fold('Éminence Ångström')).toBe('eminence angstrom');
    expect(fold('Biceps')).toHaveLength(6);
  });
  it('tokenizes and drops filler words', () => {
    expect(tokenize('  Head of  the Humerus ')).toEqual(['head', 'humerus']);
    expect(tokenize('of')).toEqual(['of']);
  });
  it('is case and diacritic insensitive when searching', () => {
    expect(top('SUPRASPINÁTUS')).toBe('Supraspinatus');
    expect(top('supraspinatus')).toBe('Supraspinatus');
  });
});

describe('ranking', () => {
  it('puts an exact name first', () => {
    expect(top('femur')).toBe('Femur');
    expect(top('Deltoid')).toBe('Deltoid');
    expect(top('biceps femoris')).toBe('Biceps Femoris');
  });
  it('orders name prefix > word start > name substring > group > other fields', () => {
    const prefix = find('biceps', 'Biceps Brachii')!.score;
    const wordStart = find('brachii', 'Biceps Brachii')!.score;
    const substring = find('rachii', 'Biceps Brachii')!.score;
    const group = find('rotator cuff', 'Teres Minor')!.score; // group is "Rotator cuff"; the alias also applies
    const groupOnly = find('stabilizers', 'Trapezius')!.score; // group: "Scapular stabilizers"
    const field = find('coracoid', 'Biceps Brachii')!.score;
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(groupOnly);
    expect(groupOnly).toBeGreaterThan(field);
    expect(group).toBeGreaterThan(0);
  });
  it('lists name matches before matches on other fields', () => {
    const r = q('radial');
    const firstReason = r.findIndex((x) => x.reason);
    expect(firstReason).toBeGreaterThan(0);
    expect(r.slice(0, firstReason).every((x) => /radial/i.test(x.item.label) || /radial/i.test(x.item.group))).toBe(true);
  });
  it('AND-s multi-word queries', () => {
    expect(top('gluteus medius')).toBe('Gluteus Medius');
    expect(q('femoris xyzzy')).toHaveLength(0);
    const r = q('shoulder abduction').map((x) => x.item.label);
    expect(r).not.toContain('Femur');
  });
  it('returns the first catalog items for an empty query', () => {
    expect(q('   ')).toHaveLength(40);
    expect(q('')[0].item.label).toBe(catalog[0].label);
  });
  it('matches one- and two-letter prefixes of names while typing', () => {
    expect(labels('bi', 2).every((l) => /^Bi/.test(l))).toBe(true);
    expect(q('c').length).toBeGreaterThan(0);
    expect(q('c')[0].item.label).toMatch(/^C/);
  });
  it('puts muscles whose field contains the whole phrase above name-only partial hits', () => {
    const r = q('radial nerve').map((x) => x.item.label);
    expect(r.indexOf('Triceps Brachii')).toBeLessThan(r.indexOf('Flexor Carpi Radialis'));
    expect(r.indexOf('Extensor Carpi Radialis Longus')).toBeLessThan(r.indexOf('Flexor Carpi Radialis'));
    expect(find('radial nerve', 'Triceps Brachii')?.reason?.text).toMatch(/^Radial nerve/);
  });
  it('treats a region as a phrase', () => {
    const r = q('upper limb', 12);
    expect(r.every((x) => x.item.region === 'Upper limb')).toBe(true);
  });
  it('sorts numbered names naturally', () => {
    expect(labels('rib', 4)).toEqual(['Rib 1', 'Rib 2', 'Rib 3', 'Rib 4']);
  });
});

describe('searching other fields', () => {
  it('finds muscles by nerve and says why', () => {
    const r = q('axillary');
    const names = r.map((x) => x.item.label);
    expect(names).toContain('Deltoid');
    expect(names).toContain('Teres Minor');
    const deltoid = r.find((x) => x.item.label === 'Deltoid')!;
    expect(deltoid.reason?.label).toBe('Innervation');
    expect(deltoid.reason?.text).toMatch(/Axillary nerve/);
    expect(r.every((x) => x.item.kind === 'muscle')).toBe(true);
  });
  it('finds by nerve root, with en-dash ranges', () => {
    const r = q('C5');
    expect(r[0].item.label).toBe('Cervical Vertebra C5');
    expect(r.map((x) => x.item.label)).toContain('Deltoid');
    expect(q('radial nerve').map((x) => x.item.label)).toContain('Triceps Brachii');
  });
  it('finds by action', () => {
    expect(q('supination').map((x) => x.item.label)).toEqual(expect.arrayContaining(['Supinator', 'Biceps Brachii']));
  });
  it('finds by origin / insertion text', () => {
    const r = q('coracoid');
    expect(r.map((x) => x.item.label)).toEqual(expect.arrayContaining(['Coracobrachialis', 'Pectoralis Minor', 'Biceps Brachii']));
    expect(r.find((x) => x.item.label === 'Pectoralis Minor')?.reason?.label).toMatch(/Insertion|Origin/);
  });
  it('finds by the movements a muscle takes part in', () => {
    const r = q('shoulder abduction');
    expect(r.map((x) => x.item.label)).toEqual(expect.arrayContaining(['Deltoid', 'Supraspinatus']));
    expect(r.find((x) => x.item.label === 'Supraspinatus')?.reason?.label).toBe('Movement');
  });
  it('ranks prime movers above assisting muscles for a movement', () => {
    const r = q('elbow flexion').map((x) => x.item.label);
    expect(r.indexOf('Brachialis')).toBeLessThan(r.indexOf('Pronator Teres'));
  });
  it('does not add a reason when the name matched', () => {
    expect(q('deltoid')[0].reason).toBeUndefined();
    expect(q('femur')[0].reason).toBeUndefined();
  });
  it('matches bones by name and group', () => {
    expect(top('scapula')).toBe('Scapula');
    expect(q('shoulder girdle').map((x) => x.item.label)).toEqual(expect.arrayContaining(['Clavicle', 'Scapula']));
  });
  it('keeps reason excerpts short', () => {
    for (const r of q('nerve')) if (r.reason) expect(r.reason.text.length).toBeLessThan(120);
  });
});

describe('typo tolerance', () => {
  it.each([
    ['supraspinatis', 'Supraspinatus'],
    ['bicep', 'Biceps Brachii'],
    ['gastrocnemus', 'Gastrocnemius'],
    ['quadratus lumborem', 'Quadratus Lumborum'],
    ['tibialus anterior', 'Tibialis Anterior'],
    ['trapezeus', 'Trapezius'],
    ['subscapularus', 'Subscapularis'],
    ['gluteus maximas', 'Gluteus Maximus'],
    ['semimembranosis', 'Semimembranosus'],
    ['hammstring', 'Biceps Femoris'],
    ['rotater cuff', 'Supraspinatus'],
  ])('%s -> %s', (typo, expected) => {
    expect(labels(typo, 3)).toContain(expected);
  });
  it('is not used below 4 characters', () => {
    expect(q('xyz')).toHaveLength(0);
    expect(q('bcp')).toHaveLength(0);
  });
  it('is a fallback only, so it cannot outrank or mix with exact matches', () => {
    const exact = q('femur');
    expect(exact[0].item.label).toBe('Femur');
    // fuzzy scores are below every exact tier; none appears next to an exact hit
    expect(exact.every((r) => r.score >= 100)).toBe(true);
    expect(q('supraspinatis').every((r) => r.score < 100)).toBe(true);
  });
  it('does not flood results', () => {
    expect(q('gastrocnemus').length).toBeLessThan(10);
    expect(q('zzzzzz')).toHaveLength(0);
  });
  it('computes bounded edit distances', () => {
    expect(editDistance('kitten', 'kitten', 2)).toBe(0);
    expect(editDistance('supraspinatis', 'supraspinatus', 2)).toBe(1);
    expect(editDistance('teh', 'the', 2)).toBe(1); // transposition
    expect(editDistance('abcdef', 'uvwxyz', 2)).toBeGreaterThan(2);
  });
});

describe('aliases', () => {
  it('every alias target exists in structures.json', () => {
    const muscles = new Set(structures.filter((s) => s.kind === 'muscle').map((s) => s.key));
    const bones = new Set(structures.filter((s) => s.kind === 'bone').map((s) => s.key));
    const joints = new Set(structures.filter((s) => KINDS[s.kind].library === 'joint').map((s) => s.key));
    for (const a of ALIASES) {
      for (const k of a.muscles ?? []) expect(muscles.has(k), `muscle ${k} (${a.terms[0]})`).toBe(true);
      for (const k of a.bones ?? []) expect(bones.has(k), `bone ${k} (${a.terms[0]})`).toBe(true);
      for (const k of a.joints ?? []) expect(joints.has(k), `joint ${k} (${a.terms[0]})`).toBe(true);
    }
  });
  it('has no duplicate terms', () => {
    const terms = ALIASES.flatMap((a) => a.terms.map(fold));
    expect(terms.filter((t, i) => terms.indexOf(t) !== i)).toEqual([]);
  });
  it.each([
    ['lats', ['Latissimus Dorsi']],
    ['traps', ['Trapezius']],
    ['pecs', ['Pectoralis Major', 'Pectoralis Minor']],
    ['quads', ['Rectus Femoris', 'Vastus Lateralis', 'Vastus Medialis', 'Vastus Intermedius']],
    ['hamstrings', ['Biceps Femoris', 'Semitendinosus', 'Semimembranosus']],
    ['glutes', ['Gluteus Maximus', 'Gluteus Medius', 'Gluteus Minimus']],
    ['calf', ['Gastrocnemius', 'Soleus']],
    ['rotator cuff', ['Supraspinatus', 'Infraspinatus', 'Teres Minor', 'Subscapularis']],
    ['SCM', ['Sternocleidomastoid']],
    ['ITB', ['Tensor Fasciae Latae']],
    ['TFL', ['Tensor Fasciae Latae']],
    ['it band', ['Tensor Fasciae Latae']],
    ['shoulder blade', ['Scapula']],
    ['collarbone', ['Clavicle']],
    ['kneecap', ['Patella']],
    ['shin bone', ['Tibia']],
    ['thigh bone', ['Femur']],
    ['peroneus longus', ['Fibularis Longus']],
  ])('%s', (query, expected) => {
    expect(new Set(labels(query, expected.length))).toEqual(new Set(expected));
  });
  it('explains alias matches', () => {
    expect(q('quads')[0].reason).toEqual({ label: 'Part of', text: 'Quadriceps' });
    expect(q('lats')[0].reason).toEqual({ label: 'Also called', text: 'lats' });
  });
  it('lets a direct name match beat an alias prefix', () => {
    expect(labels('trap', 2)).toContain('Trapezius');
    expect(find('trap', 'Trapezius')!.reason).toBeUndefined();
  });
});

describe('performance', () => {
  it('builds the index and answers quickly', () => {
    const t0 = performance.now();
    const idx = buildSearchIndex(catalog);
    const built = performance.now() - t0;
    const t1 = performance.now();
    for (const query of ['a', 'abduction', 'supraspinatis', 'axillary nerve', 'x y z']) search(idx, query);
    const searched = performance.now() - t1;
    expect(built).toBeLessThan(500);
    expect(searched).toBeLessThan(200);
  });
});
