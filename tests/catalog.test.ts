import { describe, expect, it } from 'vitest';
import { buildCatalog, preferredId, REGIONS, type CatalogItem } from '../app/lib/catalog';
import { muscleInfo } from '../app/lib/data/muscles';
import type { Structure } from '../app/lib/types';
import { byId, structures } from './fixtures';

const catalog = buildCatalog(structures);
const item = (kind: string, key: string) => catalog.find((c) => c.kind === kind && c.key === key)!;

describe('buildCatalog', () => {
  it('has one item per anatomical name (no duplicate kind+key)', () => {
    expect(new Set(catalog.map((c) => `${c.kind}:${c.key}`)).size).toBe(catalog.length);
  });

  it('leaves out discs and costal cartilage but keeps every bone, muscle, joint surface and joint soft tissue', () => {
    expect(catalog.some((c) => c.kind === 'disc' || c.kind === 'cartilage')).toBe(false);
    const listed = new Set(['bone', 'muscle', 'articular', 'fibrocartilage', 'ligament', 'capsule', 'bursa', 'sheath', 'retinaculum', 'fascia', 'fatpad']);
    const expected = new Set(structures.filter((s) => listed.has(s.kind)).map((s) => `${s.kind}:${s.key}`));
    expect(catalog.length).toBe(expected.size);
  });

  it('pairs left and right ids under one item (deltoid)', () => {
    const d = item('muscle', 'deltoid');
    expect(d.ids).toEqual({ l: 'deltoid-l', r: 'deltoid-r' });
    expect(d.label).toBe(byId.get('deltoid-l')!.label);
  });

  it('pairs left and right bones (humerus) and keeps midline structures on m only', () => {
    expect(item('bone', 'humerus').ids).toEqual({ l: 'humerus-l', r: 'humerus-r' });
    expect(item('bone', 'c1').ids).toEqual({ m: 'c1' });
  });

  it('every id in an item exists in the manifest on the side it is filed under, with the matching kind and key', () => {
    for (const c of catalog) {
      for (const [side, id] of Object.entries(c.ids)) {
        const s = byId.get(id!);
        expect(s, `${c.key}.${side}`).toBeDefined();
        expect(s!.side).toBe(side);
        expect(s!.key).toBe(c.key);
        expect(s!.kind).toBe(c.kind);
      }
    }
  });

  it('paired structures are complete: a left id implies a right id (and vice versa), never mixed with a midline id', () => {
    for (const c of catalog) {
      expect(Boolean(c.ids.l), `${c.kind}:${c.key} left/right`).toBe(Boolean(c.ids.r));
      if (c.ids.m) expect(c.ids.l ?? c.ids.r, `${c.kind}:${c.key} has both midline and paired ids`).toBeUndefined();
    }
  });

  it('is sorted by label', () => {
    const labels = catalog.map((c) => c.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it('puts muscles in their documented group and region', () => {
    const d = item('muscle', 'deltoid');
    expect(d.group).toBe(muscleInfo('deltoid').group);
    expect(d.region).toBe('Upper limb');
    expect(item('muscle', 'gluteus-maximus').region).toBe('Lower limb');
    expect(item('muscle', 'rectus-abdominis').region).toBe('Trunk');
    expect(item('muscle', 'sternocleidomastoid').region).toBe('Head & neck');
  });

  it('groups bones by body part and assigns regions', () => {
    expect(item('bone', 'humerus').group).toBe('Arm');
    expect(item('bone', 'femur').group).toBe('Thigh');
    expect(item('bone', 'humerus').region).toBe('Upper limb');
    expect(item('bone', 'femur').region).toBe('Lower limb');
    for (const c of catalog) {
      expect(REGIONS, `${c.kind}:${c.key}`).toContain(c.region);
      expect(c.group.length).toBeGreaterThan(0);
    }
  });

  it('does not depend on the order of the input', () => {
    const reversed = buildCatalog([...structures].reverse());
    expect(reversed.map((c) => [c.kind, c.key, c.ids])).toEqual(catalog.map((c) => [c.kind, c.key, c.ids]));
  });

  it('accepts any iterable (e.g. Map.values())', () => {
    expect(buildCatalog(byId.values())).toHaveLength(catalog.length);
  });

  it('keeps a bone and a muscle that share a key as separate items', () => {
    const mk = (kind: Structure['kind'], side: Structure['side']): Structure => ({
      ...byId.get('deltoid-l')!,
      id: `x-${kind}-${side}`,
      key: 'x',
      kind,
      side,
    });
    const out = buildCatalog([mk('bone', 'l'), mk('muscle', 'l'), mk('muscle', 'r')]);
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.kind === 'muscle')!.ids).toEqual({ l: 'x-muscle-l', r: 'x-muscle-r' });
    expect(out.find((c) => c.kind === 'bone')!.ids).toEqual({ l: 'x-bone-l' });
  });
});

describe('preferredId', () => {
  const base: CatalogItem = { key: 'k', kind: 'muscle', label: 'K', region: 'Trunk', group: 'g', ids: {} };

  it('prefers the left structure', () => {
    expect(preferredId({ ...base, ids: { l: 'a-l', r: 'a-r' } })).toBe('a-l');
    expect(preferredId(item('muscle', 'deltoid'))).toBe('deltoid-l');
  });
  it('falls back to the midline structure, then to the right', () => {
    expect(preferredId({ ...base, ids: { m: 'a' } })).toBe('a');
    expect(preferredId({ ...base, ids: { r: 'a-r' } })).toBe('a-r');
    expect(preferredId(item('bone', 'sacrum'))).toBe('sacrum');
  });
  it('always returns an id that exists in the manifest', () => {
    for (const c of catalog) expect(byId.has(preferredId(c)), c.key).toBe(true);
  });
});
