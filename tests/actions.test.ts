import { describe, expect, it } from 'vitest';
import { ACTIONS, actionFor, directionSide, isSymmetricSpinal, oppositeKey, parseRef, sideMatches } from '../app/lib/data/actions';
import { DOFS, JOINTS } from '../app/lib/rig/spec';
import { muscles } from './fixtures';

const allRefs = (a: { prime: string[]; assist: string[]; stab?: string[] }) => [...a.prime, ...a.assist, ...(a.stab ?? [])];

describe('parseRef', () => {
  it('parses a plain muscle key', () => {
    expect(parseRef('biceps-brachii')).toEqual({ key: 'biceps-brachii', part: null, rule: null });
  });
  it('parses a key/part reference', () => {
    expect(parseRef('deltoid/acromial-part')).toEqual({ key: 'deltoid', part: 'acromial-part', rule: null });
  });
  it('parses ipsilateral (=) and contralateral (~) prefixes, with and without a part', () => {
    expect(parseRef('=splenius-capitis')).toEqual({ key: 'splenius-capitis', part: null, rule: '=' });
    expect(parseRef('~trapezius/descending-part')).toEqual({ key: 'trapezius', part: 'descending-part', rule: '~' });
  });
});

describe('sideMatches', () => {
  it('always includes midline muscles', () => {
    expect(sideMatches('=', 'm', 'l')).toBe(true);
    expect(sideMatches('~', 'm', 'r')).toBe(true);
  });
  it('includes both sides when no acting side applies (symmetric trunk movements)', () => {
    expect(sideMatches(null, 'l', null)).toBe(true);
    expect(sideMatches('=', 'r', null)).toBe(true);
  });
  it('= keeps only the acting side, ~ keeps only the opposite side', () => {
    expect(sideMatches('=', 'l', 'l')).toBe(true);
    expect(sideMatches('=', 'r', 'l')).toBe(false);
    expect(sideMatches('~', 'l', 'l')).toBe(false);
    expect(sideMatches('~', 'r', 'l')).toBe(true);
  });
  it('a rule-less ref matches both sides even when an acting side is given', () => {
    expect(sideMatches(null, 'l', 'r')).toBe(true);
    expect(sideMatches(null, 'r', 'r')).toBe(true);
  });
});

describe('direction helpers', () => {
  it('oppositeKey swaps pos and neg', () => {
    expect(oppositeKey('elbow.flexion-extension.pos')).toBe('elbow.flexion-extension.neg');
    expect(oppositeKey('elbow.flexion-extension.neg')).toBe('elbow.flexion-extension.pos');
  });
  it('pos is left and neg is right for spinal direction rules', () => {
    expect(directionSide('pos')).toBe('l');
    expect(directionSide('neg')).toBe('r');
  });
  it('only the left/right spinal movements are symmetric', () => {
    for (const j of ['cervical', 'thoracic', 'lumbar']) {
      expect(isSymmetricSpinal(j, 'rotation')).toBe(true);
      expect(isSymmetricSpinal(j, 'lateral-flexion')).toBe(true);
      expect(isSymmetricSpinal(j, 'flexion-extension')).toBe(false);
    }
    expect(isSymmetricSpinal('shoulder', 'rotation')).toBe(false);
    expect(isSymmetricSpinal('tmj', 'opening')).toBe(false);
  });
});

describe('actionFor', () => {
  it('returns the table entry for an explicit direction', () => {
    expect(actionFor('elbow', 'flexion-extension', 'pos')?.prime).toContain('biceps-brachii');
    expect(actionFor('elbow', 'flexion-extension', 'neg')?.prime).toEqual(['triceps-brachii']);
  });
  it('reuses the pos entry for the neg direction of left/right spinal movements', () => {
    expect(actionFor('lumbar', 'rotation', 'neg')).toBe(ACTIONS['lumbar.rotation.pos']);
    expect(actionFor('cervical', 'lateral-flexion', 'neg')).toBe(ACTIONS['cervical.lateral-flexion.pos']);
  });
  it('does not invent a missing movement', () => {
    expect(actionFor('fingers', 'nonexistent', 'neg')).toBeUndefined();
    expect(actionFor('nowhere', 'flexion-extension', 'pos')).toBeUndefined();
  });
  it('every dof direction of the rig has a table entry', () => {
    for (const d of DOFS) {
      for (const dir of ['pos', 'neg'] as const) {
        expect(actionFor(d.joint, d.id, dir), `${d.joint}.${d.id}.${dir}`).toBeDefined();
      }
    }
  });
});

describe('ACTIONS table integrity (against the real manifest)', () => {
  const dofKeys = new Set(DOFS.flatMap((d) => [`${d.joint}.${d.id}.pos`, `${d.joint}.${d.id}.neg`]));
  const musclesByKey = new Map<string, typeof muscles>();
  for (const m of muscles) musclesByKey.set(m.key, [...(musclesByKey.get(m.key) ?? []), m]);

  it('every entry is keyed by a real rig joint, dof and direction', () => {
    const joints = new Set(JOINTS.map((j) => j.id));
    for (const k of Object.keys(ACTIONS)) {
      expect(dofKeys.has(k), `${k} matches no DOF in the rig`).toBe(true);
      expect(joints.has(k.split('.')[0])).toBe(true);
    }
  });

  it('only the symmetric spinal movements omit the neg entry', () => {
    for (const k of [...dofKeys].filter((x) => !ACTIONS[x])) {
      const [joint, dof, dir] = k.split('.');
      expect(dir).toBe('neg');
      expect(isSymmetricSpinal(joint, dof), k).toBe(true);
    }
  });

  it('every ref resolves to a muscle key that exists in the manifest', () => {
    for (const [id, a] of Object.entries(ACTIONS)) {
      for (const r of allRefs(a)) {
        const { key } = parseRef(r);
        expect(musclesByKey.has(key), `${id}: ${r} -> unknown muscle "${key}"`).toBe(true);
      }
    }
  });

  it('every key/part ref names a part that the muscle actually has', () => {
    for (const [id, a] of Object.entries(ACTIONS)) {
      for (const r of allRefs(a)) {
        const { key, part } = parseRef(r);
        if (!part) continue;
        const ok = (musclesByKey.get(key) ?? []).every((s) => s.parts.some((p) => p.key === part));
        expect(ok, `${id}: ${r} -> ${key} has no part "${part}"`).toBe(true);
      }
    }
  });

  it('every referenced muscle exists on both sides (or the midline) so a movement never silently loses a side', () => {
    for (const [id, a] of Object.entries(ACTIONS)) {
      for (const r of allRefs(a)) {
        const sides = new Set((musclesByKey.get(parseRef(r).key) ?? []).map((s) => s.side));
        const ok = sides.has('m') || (sides.has('l') && sides.has('r'));
        expect(ok, `${id}: ${r} exists on sides ${[...sides].join(',')}`).toBe(true);
      }
    }
  });

  it('every movement has at least one prime mover', () => {
    for (const [id, a] of Object.entries(ACTIONS)) expect(a.prime.length, id).toBeGreaterThan(0);
  });

  it('a muscle is not listed twice in the same movement', () => {
    for (const [id, a] of Object.entries(ACTIONS)) {
      const refs = allRefs(a);
      expect(new Set(refs).size, `${id} lists a ref twice`).toBe(refs.length);
    }
  });

  it('=/~ side rules are used only on the left/right spinal movements, never on limb joints', () => {
    for (const [id, a] of Object.entries(ACTIONS)) {
      const [joint, dof] = id.split('.');
      if (allRefs(a).some((r) => parseRef(r).rule !== null)) expect(isSymmetricSpinal(joint, dof), id).toBe(true);
    }
  });

  it('left/right spinal movements use a side rule on every paired muscle (the pos entry stands for both directions)', () => {
    for (const [id, a] of Object.entries(ACTIONS)) {
      const [joint, dof] = id.split('.');
      if (!isSymmetricSpinal(joint, dof)) continue;
      for (const r of allRefs(a)) {
        const sides = new Set((musclesByKey.get(parseRef(r).key) ?? []).map((s) => s.side));
        if (!sides.has('m')) expect(parseRef(r).rule, `${id}: ${r}`).not.toBeNull();
      }
    }
  });

  it('a prime mover of one direction is not also an assist or stabilizer of the opposite direction', () => {
    // Antagonist outranks assist/stab in computeRoles, so such an overlap would silently turn into "antagonist".
    const id = (r: string) => `${parseRef(r).key}/${parseRef(r).part}`;
    for (const k of Object.keys(ACTIONS).filter((x) => x.endsWith('.pos'))) {
      const neg = ACTIONS[oppositeKey(k)];
      if (!neg) continue;
      const pos = ACTIONS[k];
      const posPrime = new Set(pos.prime.map(id));
      const negPrime = new Set(neg.prime.map(id));
      for (const r of [...neg.assist, ...(neg.stab ?? [])]) expect(posPrime.has(id(r)), `${k}: ${r}`).toBe(false);
      for (const r of [...pos.assist, ...(pos.stab ?? [])]) expect(negPrime.has(id(r)), `${k}: ${r}`).toBe(false);
    }
  });
});
