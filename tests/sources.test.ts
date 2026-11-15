import { describe, expect, it } from 'vitest';
import { MUSCLE_INFO } from '../app/lib/data/muscles';
import { CONTRIBUTING_URL, SOURCES, SOURCE_LIST, citation, reviewStats } from '../app/lib/data/sources';

describe('source registry', () => {
  it('has well-formed entries keyed by their own id, with no page numbers', () => {
    expect(SOURCE_LIST.length).toBeGreaterThanOrEqual(5);
    for (const [id, s] of Object.entries(SOURCES)) {
      expect(s.id).toBe(id);
      expect(s.authors.length).toBeGreaterThan(0);
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.publisher.length).toBeGreaterThan(0);
      if (s.year !== undefined) expect(s.year).toBeGreaterThan(1990);
      expect(citation(s), id).not.toMatch(/\bpp?\.\s*\d/);
    }
  });
  it('formats a citation and leaves out what is not known', () => {
    expect(citation({ id: 'x', authors: 'A B', title: 'T', publisher: 'P' })).toBe('A B. T. P.');
    expect(citation({ id: 'x', authors: 'A B', title: 'T', edition: '2nd edition', publisher: 'P', year: 2000 })).toBe('A B. T. 2nd edition. P, 2000.');
  });
  it('points at the contributing guide', () => expect(CONTRIBUTING_URL).toMatch(/^https:\/\/.+CONTRIBUTING\.md$/));
});

describe('muscle references', () => {
  it('only uses reference ids that exist in the registry, and records a reviewer with every review', () => {
    for (const [key, m] of Object.entries(MUSCLE_INFO)) {
      for (const r of m.refs ?? []) expect(SOURCES[r], `${key} cites unknown source "${r}"`).toBeDefined();
      if (m.refs) expect(new Set(m.refs).size, `${key} repeats a source`).toBe(m.refs.length);
      if (m.reviewed) {
        expect(m.refs?.length, `${key} is marked reviewed but lists no reference`).toBeGreaterThan(0);
        expect(m.reviewed.by.trim(), key).not.toBe('');
        expect(m.reviewed.date, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('reports how much has been reviewed', () => {
    const stats = reviewStats();
    console.log(`reviewed ${stats.reviewed} of ${stats.total} muscle entries (${stats.withRefs} list references)`);
    expect(stats.total).toBe(Object.keys(MUSCLE_INFO).length);
    expect(stats.unknownRefs).toEqual([]);
    expect(stats.reviewed).toBeLessThanOrEqual(stats.withRefs);
  });

  it('counts reviewed entries and unknown references in a sample', () => {
    const base = { group: 'g', region: 'Trunk' as const, origin: 'o', insertion: 'i', innervation: 'n', action: 'a' };
    const s = reviewStats({
      a: { ...base },
      b: { ...base, refs: ['gray'] },
      c: { ...base, refs: ['gray', 'nope'], reviewed: { by: 'X', date: '2026-01-02' } },
    });
    expect(s).toEqual({ total: 3, withRefs: 2, reviewed: 1, unknownRefs: ['nope'] });
  });
});
