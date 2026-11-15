import { describe, expect, it } from 'vitest';
import { computeRoles, movementsOfMuscle, type ActiveMove } from '../app/lib/roles';
import { ACTIONS, actionFor, parseRef } from '../app/lib/data/actions';
import { DOFS } from '../app/lib/rig/spec';
import { byId, muscles, structures } from './fixtures';

const mv = (joint: string, dof: string, dir: 'pos' | 'neg', side: 'l' | 'r' | 'm' = 'l'): ActiveMove => ({ joint, dof, dir, side });
const roles = (m: ActiveMove) => computeRoles(structures, m);

describe('computeRoles: shoulder abduction (paired limb joint)', () => {
  const left = roles(mv('shoulder', 'abduction-adduction', 'pos', 'l'));

  it('marks the LEFT deltoid acromial part and supraspinatus as prime movers', () => {
    expect(left.get('deltoid-l/acromial-part')).toBe('prime');
    expect(left.get('supraspinatus-l')).toBe('prime');
  });

  it('does not mark anything on the right side when the left arm moves', () => {
    expect(left.get('deltoid-r/acromial-part')).toBeUndefined();
    expect(left.get('supraspinatus-r')).toBeUndefined();
    for (const k of left.keys()) expect(byId.get(k.split('/')[0])!.side, k).not.toBe('r');
  });

  it('marks the other deltoid parts and serratus anterior as synergists (assist), per part', () => {
    expect(left.get('deltoid-l/clavicular-part')).toBe('assist');
    expect(left.get('deltoid-l/spinal-part')).toBe('assist');
    expect(left.get('serratus-anterior-l')).toBe('assist');
  });

  it('marks the rotator cuff stabilizers', () => {
    for (const k of ['infraspinatus-l', 'teres-minor-l', 'subscapularis-l']) expect(left.get(k), k).toBe('stab');
  });

  it('marks the adductors (prime movers of the opposite direction) as antagonists', () => {
    for (const k of ['pectoralis-major-l', 'teres-major-l', 'latissimus-dorsi-l']) expect(left.get(k), k).toBe('antagonist');
  });

  it('mirrors for the right side', () => {
    const right = roles(mv('shoulder', 'abduction-adduction', 'pos', 'r'));
    expect(right.get('deltoid-r/acromial-part')).toBe('prime');
    expect(right.get('deltoid-l/acromial-part')).toBeUndefined();
    expect(right.get('pectoralis-major-r')).toBe('antagonist');
    expect(right.get('pectoralis-major-l')).toBeUndefined();
  });

  it('treats a midline side on a paired joint as the left limb', () => {
    expect(roles(mv('shoulder', 'abduction-adduction', 'pos', 'm'))).toEqual(left);
  });

  it('adduction swaps the roles: adductors prime, deltoid acromial part and supraspinatus antagonists', () => {
    const add = roles(mv('shoulder', 'abduction-adduction', 'neg', 'l'));
    expect(add.get('pectoralis-major-l')).toBe('prime');
    expect(add.get('deltoid-l/acromial-part')).toBe('antagonist');
    expect(add.get('supraspinatus-l')).toBe('antagonist');
    // deltoid parts that are not prime movers of abduction are not antagonists
    expect(add.get('deltoid-l/clavicular-part')).toBeUndefined();
  });
});

describe('computeRoles: other limb movements', () => {
  it('elbow flexion: biceps/brachialis prime, triceps antagonist, anconeus (an extension synergist) not involved', () => {
    const r = roles(mv('elbow', 'flexion-extension', 'pos', 'l'));
    expect(r.get('biceps-brachii-l')).toBe('prime');
    expect(r.get('brachialis-l')).toBe('prime');
    expect(r.get('triceps-brachii-l')).toBe('antagonist');
    expect(r.get('anconeus-l')).toBeUndefined();
  });

  it('elbow extension: triceps prime, anconeus assist, biceps antagonist', () => {
    const r = roles(mv('elbow', 'flexion-extension', 'neg', 'r'));
    expect(r.get('triceps-brachii-r')).toBe('prime');
    expect(r.get('anconeus-r')).toBe('assist');
    expect(r.get('biceps-brachii-r')).toBe('antagonist');
  });

  it('knee extension is quadriceps, flexion is hamstrings, and they oppose each other', () => {
    const quads = ['vastus-lateralis-l', 'vastus-medialis-l', 'vastus-intermedius-l', 'rectus-femoris-l'];
    const hams = ['biceps-femoris-l', 'semitendinosus-l', 'semimembranosus-l'];
    const ext = roles(mv('knee', 'flexion-extension', 'neg', 'l'));
    for (const k of quads) expect(ext.get(k), k).toBe('prime');
    for (const k of hams) expect(ext.get(k), k).toBe('antagonist');
    const flex = roles(mv('knee', 'flexion-extension', 'pos', 'l'));
    for (const k of hams) expect(flex.get(k), k).toBe('prime');
    for (const k of quads) expect(flex.get(k), k).toBe('antagonist');
  });

  it('ankle plantarflexion: calf prime, tibialis anterior antagonist, other side untouched', () => {
    const r = roles(mv('ankle', 'dorsiflexion-plantarflexion', 'neg', 'l'));
    expect(r.get('gastrocnemius-l')).toBe('prime');
    expect(r.get('soleus-l')).toBe('prime');
    expect(r.get('tibialis-anterior-l')).toBe('antagonist');
    expect(r.get('tibialis-anterior-r')).toBeUndefined();
  });

  it('hip flexion: iliopsoas and rectus femoris prime, gluteus maximus antagonist (same side only)', () => {
    const r = roles(mv('hip', 'flexion-extension', 'pos', 'r'));
    expect(r.get('psoas-major-r')).toBe('prime');
    expect(r.get('iliacus-r')).toBe('prime');
    expect(r.get('rectus-femoris-r')).toBe('prime');
    expect(r.get('gluteus-maximus-r')).toBe('antagonist');
    expect(r.get('gluteus-maximus-l')).toBeUndefined();
  });
});

describe('computeRoles: spine and jaw', () => {
  it('trunk flexion is bilateral: both rectus abdominis halves prime, erector spinae antagonist', () => {
    const r = roles(mv('thoracic', 'flexion-extension', 'pos', 'm'));
    expect(r.get('rectus-abdominis-l')).toBe('prime');
    expect(r.get('rectus-abdominis-r')).toBe('prime');
    expect(r.get('longissimus-thoracis-l')).toBe('antagonist');
    expect(r.get('longissimus-thoracis-r')).toBe('antagonist');
  });

  it('left lumbar rotation: RIGHT external oblique and LEFT internal oblique are prime', () => {
    const r = roles(mv('lumbar', 'rotation', 'pos', 'm'));
    expect(r.get('external-oblique-r')).toBe('prime');
    expect(r.get('internal-oblique-l')).toBe('prime');
    expect(r.get('external-oblique-l')).toBe('antagonist');
    expect(r.get('internal-oblique-r')).toBe('antagonist');
  });

  it('right lumbar rotation mirrors left: LEFT external oblique and RIGHT internal oblique are prime', () => {
    const r = roles(mv('lumbar', 'rotation', 'neg', 'm'));
    expect(r.get('external-oblique-l')).toBe('prime');
    expect(r.get('internal-oblique-r')).toBe('prime');
    expect(r.get('external-oblique-r')).toBe('antagonist');
    expect(r.get('internal-oblique-l')).toBe('antagonist');
  });

  it('left lateral flexion of the neck is driven by the left sternocleidomastoid; the right one opposes it', () => {
    const left = roles(mv('cervical', 'lateral-flexion', 'pos', 'm'));
    expect(left.get('sternocleidomastoid-l')).toBe('prime');
    expect(left.get('sternocleidomastoid-r')).toBe('antagonist');
    const right = roles(mv('cervical', 'lateral-flexion', 'neg', 'm'));
    expect(right.get('sternocleidomastoid-r')).toBe('prime');
    expect(right.get('sternocleidomastoid-l')).toBe('antagonist');
  });

  it('left neck rotation: ipsilateral splenius and CONTRALATERAL (right) sternocleidomastoid are prime', () => {
    const r = roles(mv('cervical', 'rotation', 'pos', 'm'));
    expect(r.get('splenius-capitis-l')).toBe('prime');
    expect(r.get('splenius-capitis-r')).not.toBe('prime');
    expect(r.get('sternocleidomastoid-r')).toBe('prime');
    expect(r.get('sternocleidomastoid-l')).not.toBe('prime');
  });

  it('jaw closing: masseter and temporalis prime on both sides, digastric antagonist (and the reverse for opening)', () => {
    const close = roles(mv('tmj', 'opening', 'neg', 'm'));
    for (const k of ['masseter-l', 'masseter-r', 'temporalis-l', 'temporalis-r']) expect(close.get(k), k).toBe('prime');
    expect(close.get('digastric-l')).toBe('antagonist');
    const open = roles(mv('tmj', 'opening', 'pos', 'm'));
    expect(open.get('digastric-l')).toBe('prime');
    expect(open.get('masseter-r')).toBe('antagonist');
  });
});

describe('computeRoles: general behaviour', () => {
  it('returns an empty map for an unknown movement', () => {
    expect(roles(mv('shoulder', 'no-such-dof', 'pos')).size).toBe(0);
    expect(roles(mv('no-such-joint', 'flexion-extension', 'pos')).size).toBe(0);
  });

  it('ignores bones, discs and cartilage', () => {
    const r = roles(mv('shoulder', 'abduction-adduction', 'pos', 'l'));
    for (const k of r.keys()) expect(byId.get(k.split('/')[0])!.kind, k).toBe('muscle');
    const noMuscles = structures.filter((s) => s.kind !== 'muscle');
    expect(computeRoles(noMuscles, mv('elbow', 'flexion-extension', 'pos')).size).toBe(0);
  });

  it('accepts any iterable of structures', () => {
    expect(computeRoles(byId.values(), mv('elbow', 'flexion-extension', 'pos'))).toEqual(roles(mv('elbow', 'flexion-extension', 'pos')));
  });

  it('every role key is a real muscle id, or id/part where the muscle has that part', () => {
    for (const d of DOFS) {
      for (const dir of ['pos', 'neg'] as const) {
        for (const side of ['l', 'r'] as const) {
          for (const k of roles(mv(d.joint, d.id, dir, side)).keys()) {
            const [id, part] = k.split('/');
            const s = byId.get(id);
            expect(s, k).toBeDefined();
            expect(s!.kind).toBe('muscle');
            if (part) expect(s!.parts.some((p) => p.key === part), k).toBe(true);
          }
        }
      }
    }
  });

  it('limb movements: every prime ref is prime, and every prime of the opposite direction is antagonist', () => {
    for (const d of DOFS.filter((x) => x.paired)) {
      for (const dir of ['pos', 'neg'] as const) {
        const act = actionFor(d.joint, d.id, dir)!;
        const opp = actionFor(d.joint, d.id, dir === 'pos' ? 'neg' : 'pos')!;
        for (const side of ['l', 'r'] as const) {
          const r = roles(mv(d.joint, d.id, dir, side));
          const idsOf = (ref: string) => {
            const p = parseRef(ref);
            return muscles
              .filter((s) => s.key === p.key && (s.side === side || s.side === 'm'))
              .map((s) => (p.part ? `${s.id}/${p.part}` : s.id));
          };
          const label = `${d.joint}.${d.id}.${dir}.${side}`;
          for (const ref of act.prime) for (const k of idsOf(ref)) expect(r.get(k), `${label} ${k}`).toBe('prime');
          for (const ref of opp.prime) {
            for (const k of idsOf(ref)) {
              // a muscle that is prime in both directions (none expected) would stay prime
              expect(['antagonist', 'prime'], `${label} ${k}`).toContain(r.get(k));
            }
          }
        }
      }
    }
  });

  it('spinal movements always have both prime movers and antagonists', () => {
    for (const d of DOFS.filter((x) => !x.paired)) {
      for (const dir of ['pos', 'neg'] as const) {
        const vals = [...roles(mv(d.joint, d.id, dir, 'm')).values()];
        expect(vals, `${d.joint}.${d.id}.${dir}`).toContain('prime');
        expect(vals, `${d.joint}.${d.id}.${dir}`).toContain('antagonist');
      }
    }
  });
});

describe('movementsOfMuscle', () => {
  it('lists shoulder abduction and flexion as prime movements of the deltoid, before its assisting ones', () => {
    const list = movementsOfMuscle('deltoid');
    const find = (dof: string, dir: string) => list.find((m) => m.joint === 'shoulder' && m.dof.id === dof && m.dir === dir);
    expect(find('abduction-adduction', 'pos')?.role).toBe('prime');
    expect(find('abduction-adduction', 'pos')?.name).toBe('Shoulder (glenohumeral): Abduction');
    expect(find('flexion-extension', 'pos')?.role).toBe('prime'); // clavicular part
    expect(find('flexion-extension', 'neg')?.role).toBe('prime'); // spinal part
    const roleOrder = list.map((m) => ({ prime: 0, assist: 1, stab: 2 })[m.role]);
    expect(roleOrder).toEqual([...roleOrder].sort((a, b) => a - b));
  });

  it('biceps brachii: elbow flexion and forearm supination prime, shoulder flexion assist, no elbow extension', () => {
    const list = movementsOfMuscle('biceps-brachii');
    const find = (joint: string, dir: string) => list.find((m) => m.joint === joint && m.dir === dir);
    expect(find('elbow', 'pos')?.role).toBe('prime');
    expect(find('forearm', 'neg')?.role).toBe('prime');
    expect(find('forearm', 'neg')?.name).toBe('Forearm: Supination');
    expect(list.find((m) => m.joint === 'shoulder' && m.dof.id === 'flexion-extension')?.role).toBe('assist');
    expect(find('elbow', 'neg')).toBeUndefined();
  });

  it('reports a stabilizer role for the rotator cuff in shoulder flexion', () => {
    const m = movementsOfMuscle('subscapularis').find((x) => x.dof.id === 'flexion-extension' && x.dir === 'pos');
    expect(m?.role).toBe('stab');
  });

  it('includes both directions of left/right spinal movements for the obliques', () => {
    const list = movementsOfMuscle('external-oblique');
    for (const dir of ['pos', 'neg']) {
      expect(list.some((m) => m.joint === 'lumbar' && m.dof.id === 'rotation' && m.dir === dir), `lumbar rotation ${dir}`).toBe(true);
    }
  });

  it('returns nothing for an unknown muscle, and never lists a movement twice', () => {
    expect(movementsOfMuscle('no-such-muscle')).toEqual([]);
    for (const key of new Set(muscles.map((m) => m.key))) {
      const ids = movementsOfMuscle(key).map((m) => `${m.joint}.${m.dof.id}.${m.dir}`);
      expect(new Set(ids).size, key).toBe(ids.length);
    }
  });

  it('is consistent with the ACTIONS table: a muscle appears exactly where some tier names it, with its best role', () => {
    const rank = { prime: 0, assist: 1, stab: 2 } as const;
    type R = keyof typeof rank;
    const expected = new Map<string, Map<string, R>>();
    for (const k of Object.keys(ACTIONS)) {
      const [joint, dof] = k.split('.');
      for (const dir of ['pos', 'neg'] as const) {
        const act = actionFor(joint, dof, dir)!;
        const tiers: [R, string[]][] = [['prime', act.prime], ['assist', act.assist], ['stab', act.stab ?? []]];
        for (const [role, refs] of tiers) {
          for (const ref of refs) {
            const key = parseRef(ref).key;
            const mid = `${joint}.${dof}.${dir}`;
            const m = expected.get(key) ?? new Map<string, R>();
            const cur = m.get(mid);
            if (!cur || rank[role] < rank[cur]) m.set(mid, role);
            expected.set(key, m);
          }
        }
      }
    }
    for (const [key, want] of expected) {
      const got = new Map(movementsOfMuscle(key).map((m) => [`${m.joint}.${m.dof.id}.${m.dir}`, m.role]));
      expect(got, key).toEqual(want);
    }
    // And the reverse lookup never invents a muscle: keys outside the table have no movements.
    for (const key of new Set(muscles.map((m) => m.key))) {
      if (!expected.has(key)) expect(movementsOfMuscle(key), key).toEqual([]);
    }
  });
});
