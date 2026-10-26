import { ACTIONS, actionFor, directionSide, isSymmetricSpinal, oppositeKey, parseRef, sideMatches, type Role } from './data/actions';
import type { Dof } from './rig/spec';
import { DOFS, JOINTS } from './rig/spec';
import type { Side, Structure } from './types';

export type Dir = 'pos' | 'neg';
export interface ActiveMove { joint: string; dof: string; dir: Dir; side: Side }

const RANK: Record<Role, number> = { prime: 3, antagonist: 2, assist: 1, stab: 0 };

/** Role map (`id` or `id/part` -> role) for a movement. Antagonists are the prime movers of the opposite direction. */
export function computeRoles(structures: Iterable<Structure>, mv: ActiveMove): Map<string, Role> {
  const out = new Map<string, Role>();
  const paired = JOINTS.find((j) => j.id === mv.joint)?.paired ?? false;
  const symmetric = isSymmetricSpinal(mv.joint, mv.dof);
  const list = [...structures].filter((s) => s.kind === 'muscle');

  const apply = (dir: Dir, tiers: { refs: string[]; role: Role }[]) => {
    const acting = paired ? (mv.side === 'm' ? 'l' : mv.side) : symmetric ? directionSide(dir) : null;
    for (const { refs, role } of tiers) {
      for (const ref of refs) {
        const p = parseRef(ref);
        for (const s of list) {
          if (s.key !== p.key) continue;
          if (paired && s.side !== 'm' && s.side !== acting) continue;
          if (!sideMatches(p.rule, s.side, acting as 'l' | 'r' | null)) continue;
          const k = p.part ? `${s.id}/${p.part}` : s.id;
          const cur = out.get(k);
          if (!cur || RANK[role] > RANK[cur]) out.set(k, role);
        }
      }
    }
  };

  const act = actionFor(mv.joint, mv.dof, mv.dir);
  const otherDir: Dir = mv.dir === 'pos' ? 'neg' : 'pos';
  const opp = actionFor(mv.joint, mv.dof, otherDir);
  if (opp) apply(otherDir, [{ refs: opp.prime, role: 'antagonist' }]);
  if (act) apply(mv.dir, [{ refs: act.stab ?? [], role: 'stab' }, { refs: act.assist, role: 'assist' }, { refs: act.prime, role: 'prime' }]);
  return out;
}

export interface MuscleMove { joint: string; dof: Dof; dir: Dir; role: 'prime' | 'assist' | 'stab'; name: string }

/** Movements a muscle (by key) takes part in, for the reverse lookup. */
export function movementsOfMuscle(key: string): MuscleMove[] {
  const res: MuscleMove[] = [];
  const seen = new Set<string>();
  for (const d of DOFS) {
    for (const dir of ['pos', 'neg'] as Dir[]) {
      const act = actionFor(d.joint, d.id, dir);
      if (!act) continue;
      const tiers: ['prime' | 'assist' | 'stab', string[]][] = [['prime', act.prime], ['assist', act.assist], ['stab', act.stab ?? []]];
      for (const [role, refs] of tiers) {
        if (refs.some((r) => parseRef(r).key === key)) {
          const id = `${d.joint}.${d.id}.${dir}`;
          if (seen.has(id)) continue;
          seen.add(id);
          res.push({ joint: d.joint, dof: d, dir, role, name: `${JOINTS.find((j) => j.id === d.joint)?.label ?? d.joint}: ${dir === 'pos' ? d.pos : d.neg}` });
        }
      }
    }
  }
  const order = { prime: 0, assist: 1, stab: 2 } as const;
  return res.sort((a, b) => order[a.role] - order[b.role]);
}

export { ACTIONS, oppositeKey };
