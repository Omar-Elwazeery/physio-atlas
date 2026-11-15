import { describe, expect, it } from 'vitest';
import { buildCatalog, filterItems, librarySections, SUBGROUP_MIN, type CatalogItem } from '../app/lib/catalog';
import { KINDS } from '../app/lib/kinds';
import { jointSubgroup, KIND_SUBGROUPS, OTHER_LIGAMENTS, SUB_RULES, subgroupOrder } from '../app/lib/data/jointGroups';
import { FOOT, WRIST } from '../app/lib/data/softTissue';
import { structures } from './fixtures';

const catalog = buildCatalog(structures);
const tab = (t: string) => catalog.filter((c) => KINDS[c.kind].library === t);
const groupItems = (g: string) => tab('joint').filter((c) => c.group === g);
const groupsOf = (t: string) => [...new Set(tab(t).map((c) => `${c.region}|${c.group}`))].map((k) => {
  const [region, group] = k.split('|');
  return { group, items: tab(t).filter((c) => c.region === region && c.group === group) };
});
const section = (g: string, label: string) => librarySections(g, groupItems(g)).find((s) => s.label === label)?.items.map((i) => i.key) ?? [];
const subOf = (key: string) => tab('joint').find((c) => c.key === key)?.sub;

/** The longest list a student can have open at once in a group: its sub-group headers, or the rows of one sub-group. */
const longest = (g: string) => {
  const secs = librarySections(g, groupItems(g));
  return Math.max(secs.length, ...secs.map((s) => s.items.length));
};

describe('sub-groups of the Joints library', () => {
  it('gives every joint structure a sub-group, and muscles and bones none', () => {
    for (const c of tab('joint')) expect(c.sub, c.key).toBeTruthy();
    for (const c of [...tab('muscle'), ...tab('bone')]) expect(c.sub, c.key).toBeUndefined();
  });

  it('is the same for the left and the right structure of a pair', () => {
    for (const s of structures) {
      if (KINDS[s.kind].library !== 'joint') continue;
      const it = tab('joint').find((c) => c.kind === s.kind && c.key === s.key)!;
      expect(jointSubgroup(it.group, s), s.id).toBe(it.sub);
    }
  });

  it('files the wrist and hand under their joints', () => {
    expect(subOf('scapholunate-ligament')).toBe('Intercarpal joints');
    expect(subOf('pisohamate-ligament')).toBe('Intercarpal joints');
    expect(subOf('radiate-carpal-ligament')).toBe('Intercarpal joints');
    expect(subOf('radioscaphocapitate-ligament')).toBe('Radiocarpal (wrist) joint');
    expect(subOf('radiocarpal-capsule')).toBe('Radiocarpal (wrist) joint');
    expect(subOf('ulnar-collateral-ligament-of-wrist')).toBe('Radiocarpal (wrist) joint');
    expect(section(WRIST, 'Distal radioulnar joint').sort()).toEqual(['dorsal-radioulnar-ligament', 'palmar-radioulnar-ligament', 'triangular-fibrocartilage']);
    expect(section(WRIST, 'Carpometacarpal and intermetacarpal joints').sort()).toEqual([
      'dorsal-carpometacarpal-ligaments', 'dorsal-metacarpal-ligaments', 'interosseous-metacarpal-ligaments',
      'palmar-carpometacarpal-ligaments', 'palmar-metacarpal-ligaments', 'pisometacarpal-ligament',
    ]);
    expect(subOf('mcp-capsule-index')).toBe('Metacarpophalangeal (MCP) joints');
    expect(subOf('palmar-plate-mcp-thumb')).toBe('Metacarpophalangeal (MCP) joints');
    expect(subOf('deep-transverse-metacarpal-ligaments')).toBe('Metacarpophalangeal (MCP) joints');
    expect(subOf('pip-collateral-ligaments-ring')).toBe('Proximal interphalangeal (PIP) joints');
    expect(subOf('dip-capsule-little')).toBe('Distal interphalangeal (DIP) joints');
    expect(section(WRIST, 'Interphalangeal joint of thumb').sort()).toEqual(['ip-capsule-thumb', 'ip-collateral-ligaments-thumb', 'palmar-plate-ip-thumb']);
    expect(subOf('fibrous-digital-sheath-thumb')).toBe('Tendon sheaths of the fingers');
    expect(subOf('flexor-pollicis-longus-sheath')).toBe('Tendon sheaths at the wrist');
    expect(subOf('flexor-retinaculum')).toBe('Retinacula');
    expect(subOf('cartilage-scaphoid')).toBe('Joint surfaces: wrist and carpus');
    expect(subOf('cartilage-distal-radius')).toBe('Joint surfaces: wrist and carpus');
    expect(subOf('cartilage-metacarpal-1')).toBe('Joint surfaces: metacarpals and phalanges');
  });

  it('files the ankle and foot under their joints', () => {
    expect(subOf('anterior-talofibular-ligament')).toBe('Ankle (talocrural) joint');
    expect(section(FOOT, 'Ankle (talocrural) joint').sort()).toEqual([
      'ankle-capsule', 'anterior-talofibular-ligament', 'anterior-tibiotalar-ligament', 'calcaneofibular-ligament',
      'posterior-talofibular-ligament', 'posterior-tibiotalar-ligament', 'tibiocalcaneal-ligament', 'tibionavicular-ligament',
    ]);
    expect(section(FOOT, 'Distal tibiofibular joint (syndesmosis)').sort()).toEqual(['anterior-tibiofibular-ligament', 'posterior-tibiofibular-ligament', 'transverse-tibiofibular-ligament']);
    expect(section(FOOT, 'Subtalar joint').sort()).toEqual([
      'anterior-talocalcaneal-ligament', 'cervical-ligament', 'interosseous-talocalcaneal-ligament', 'medial-talocalcaneal-ligament', 'posterior-talocalcaneal-ligament',
    ]);
    expect(section(FOOT, 'Midtarsal (transverse tarsal) joint').sort()).toEqual([
      'bifurcate-ligament', 'dorsal-calcaneocuboid-ligament', 'long-plantar-ligament', 'plantar-calcaneocuboid-ligament', 'plantar-calcaneonavicular-ligament', 'talonavicular-ligament',
    ]);
    expect(section(FOOT, 'Intertarsal joints')).toHaveLength(9);
    expect(subOf('dorsal-intercuneiform-ligaments')).toBe('Intertarsal joints');
    expect(section(FOOT, 'Tarsometatarsal and intermetatarsal joints').sort()).toEqual([
      'dorsal-metatarsal-ligaments', 'dorsal-tarsometatarsal-ligaments', 'interosseous-cuneometatarsal-ligaments',
      'interosseous-metatarsal-ligaments', 'plantar-metatarsal-ligaments', 'plantar-tarsometatarsal-ligaments',
    ]);
    expect(subOf('mtp-capsule-hallux')).toBe('Metatarsophalangeal (MTP) joints');
    expect(subOf('intersesamoid-ligament')).toBe('Metatarsophalangeal (MTP) joints');
    expect(subOf('toe-pip-capsule-toe3')).toBe('Proximal interphalangeal (PIP) joints');
    expect(subOf('plantar-plate-dip-toe5')).toBe('Distal interphalangeal (DIP) joints');
    expect(subOf('toe-ip-capsule-hallux')).toBe('Interphalangeal joint of great toe');
    expect(subOf('toe-fibrous-sheath-hallux')).toBe('Tendon sheaths of the toes');
    expect(subOf('tibialis-posterior-sheath')).toBe('Tendon sheaths at the ankle');
    expect(subOf('retrocalcaneal-bursa')).toBe('Bursae');
    expect(subOf('cartilage-talus')).toBe('Joint surfaces: ankle and tarsus');
    expect(subOf('cartilage-sesamoid-foot')).toBe('Joint surfaces: metatarsals and toes');
  });

  it('leaves no ligament, capsule or disc of the wrist or foot unsorted', () => {
    const generic = new Set<string>([OTHER_LIGAMENTS, 'Joint capsules', 'Menisci, labra and discs', 'Fat pads', 'Tendon sheaths', 'Joint surfaces', 'Other']);
    for (const g of [WRIST, FOOT]) {
      for (const c of groupItems(g)) expect(generic.has(c.sub!), `${c.key} -> ${c.sub}`).toBe(false);
    }
  });

  it('falls back to the tissue kind where a group has no joint rules', () => {
    expect(subOf('anterior-cruciate-ligament')).toBe('Ligaments');
    expect(subOf('medial-meniscus')).toBe('Menisci, labra and discs');
    expect(subOf('pes-anserine-bursa')).toBe('Bursae');
    expect(subOf('knee-capsule')).toBe('Joint capsules');
    expect(subOf('cartilage-patella')).toBe('Joint surfaces');
    expect(subOf('fascia-lata')).toBe('Fasciae');
    expect(new Set(KIND_SUBGROUPS.map(([k]) => k))).toEqual(new Set(Object.entries(KINDS).filter(([, v]) => v.library === 'joint').map(([k]) => k)));
  });

  it('every rule is used by the model, so none is dead', () => {
    for (const [g, rules] of Object.entries(SUB_RULES)) {
      const used = new Set(groupItems(g).map((c) => c.sub));
      for (const r of rules) expect(used.has(r.label), `${g}: ${r.label}`).toBe(true);
    }
  });
});

describe('librarySections', () => {
  it('keeps short groups as one flat list, in the order given', () => {
    for (const t of ['muscle', 'bone', 'joint']) {
      for (const { group, items } of groupsOf(t)) {
        if (items.length > SUBGROUP_MIN) continue;
        expect(librarySections(group, items), group).toEqual([{ label: null, items }]);
      }
    }
    expect(librarySections('Hip', groupItems('Hip'))).toHaveLength(1);
    expect(librarySections('Elbow', groupItems('Elbow'))).toHaveLength(1);
  });

  it('never splits the Muscles or Bones tabs', () => {
    for (const t of ['muscle', 'bone']) for (const { group, items } of groupsOf(t)) expect(librarySections(group, items, 0), group).toHaveLength(1);
  });

  it('splits every long group, keeps every item exactly once and sorts sub-groups joints first', () => {
    const long = groupsOf('joint').filter((g) => g.items.length > SUBGROUP_MIN);
    expect(long.map((g) => g.group).sort()).toEqual([FOOT, 'Knee', 'Shoulder girdle', WRIST].sort());
    for (const { group, items } of long) {
      const secs = librarySections(group, items);
      expect(secs.length, group).toBeGreaterThan(1);
      expect(secs.flatMap((s) => s.items.map((i) => i.key)).sort(), group).toEqual(items.map((i) => i.key).sort());
      const order = subgroupOrder(group);
      const ranks = secs.map((s) => order.indexOf(s.label!));
      expect(ranks.every((r) => r >= 0), group).toBe(true);
      expect([...ranks].sort((a, b) => a - b), group).toEqual(ranks);
      for (const s of secs) expect(s.items.map((i) => i.label), `${group}: ${s.label}`).toEqual([...s.items.map((i) => i.label)].sort((a, b) => a.localeCompare(b)));
    }
  });

  it('shows at most 20 rows at once in the wrist and the foot, where it was 134 and 139', () => {
    expect(groupItems(WRIST).length).toBeGreaterThan(100);
    expect(groupItems(FOOT).length).toBeGreaterThan(100);
    expect(longest(WRIST)).toBeLessThanOrEqual(20);
    expect(longest(FOOT)).toBeLessThanOrEqual(20);
    expect(longest('Knee')).toBeLessThanOrEqual(20);
    expect(longest('Shoulder girdle')).toBeLessThanOrEqual(20);
  });

  it('lists the wrist from the forearm to the fingertips', () => {
    expect(librarySections(WRIST, groupItems(WRIST)).map((s) => s.label)).toEqual([
      'Distal radioulnar joint', 'Radiocarpal (wrist) joint', 'Intercarpal joints', 'Carpometacarpal and intermetacarpal joints',
      'Metacarpophalangeal (MCP) joints', 'Proximal interphalangeal (PIP) joints', 'Distal interphalangeal (DIP) joints', 'Interphalangeal joint of thumb',
      'Retinacula', 'Tendon sheaths at the wrist', 'Tendon sheaths of the fingers', 'Joint surfaces: wrist and carpus', 'Joint surfaces: metacarpals and phalanges',
    ]);
  });

  it('does not split a long group whose items share one sub-group, and files items without one under Other', () => {
    const mk = (n: number, sub?: string): CatalogItem[] => Array.from({ length: n }, (_, i) => ({ key: `k${sub}${i}`, kind: 'ligament', label: `L${i}`, region: 'Trunk', group: 'g', sub, ids: {} }));
    expect(librarySections('g', mk(40, 'Ligaments'))).toHaveLength(1);
    expect(librarySections('g', mk(40))).toHaveLength(1);
    expect(librarySections('g', [...mk(20, 'Ligaments'), ...mk(20)]).map((s) => s.label)).toEqual(['Ligaments', 'Other']);
    expect(librarySections('g', [...mk(2, 'Ligaments'), ...mk(2, 'Bursae')], 3).map((s) => [s.label, s.items.length])).toEqual([['Ligaments', 2], ['Bursae', 2]]);
  });
});

describe('filterItems', () => {
  const joints = tab('joint');
  const keys = (q: string, items = joints) => filterItems(items, q)?.map((i) => i.key);

  it('returns null for a query without a letter or digit', () => {
    expect(filterItems(joints, '')).toBeNull();
    expect(filterItems(joints, '   ')).toBeNull();
    expect(filterItems(joints, '(-)')).toBeNull();
  });

  it('finds a structure from part of its name, whatever the case', () => {
    expect(keys('scaphol')).toEqual(['scapholunate-ligament']);
    expect(keys('ATFL')).toEqual(['anterior-talofibular-ligament']);
    expect(keys('anterior TALOFIB')).toEqual(['anterior-talofibular-ligament']);
    expect(keys('zzzz')).toEqual([]);
  });

  it('needs every word, in any order', () => {
    expect(keys('index collateral proximal')).toEqual(['pip-collateral-ligaments-index']);
    expect(keys('ligament cruciate')!.sort()).toEqual(['anterior-cruciate-ligament', 'posterior-cruciate-ligament']);
  });

  it('matches the sub-group name too, so a joint can be asked for', () => {
    expect(keys('subtalar')!.sort()).toEqual(section(FOOT, 'Subtalar joint').sort());
    expect(keys('syndesmosis')).toHaveLength(3);
  });

  it('only looks in the items it is given, and keeps their order', () => {
    expect(keys('biceps', tab('bone'))).toEqual([]);
    const found = filterItems(joints, 'bursa')!;
    expect(found.length).toBeGreaterThan(20);
    expect(found).toEqual(joints.filter((i) => found.includes(i)));
  });
});
