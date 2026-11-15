'use client';

import { ArrowDown, X } from 'lucide-react';
import { hasMuscleInfo, muscleInfo } from '../lib/data/muscles';
import { jointInfo } from '../lib/data/joints';
import { KINDS } from '../lib/kinds';
import { structureRegion } from '../lib/three/viewer';
import type { Structure } from '../lib/types';

/** One- or two-sentence summary of a structure, from the same data the info panel shows. */
export function briefOf(s: Structure): string {
  if (s.kind === 'muscle') {
    return hasMuscleInfo(s.key) ? muscleInfo(s.key).action : 'Clinical details for this muscle are not written yet.';
  }
  const joint = KINDS[s.kind].library === 'joint' ? jointInfo(s) : null;
  if (joint) return joint.description;
  if (s.kind === 'bone') return `Bone of the ${structureRegion(s).toLowerCase()}. Open the full details to see the movements it takes part in.`;
  return 'A supporting structure of the spine and thorax.';
}

const sideName = (s: Structure) => (s.side === 'l' ? 'Left' : s.side === 'r' ? 'Right' : '');

/**
 * Small card over the 3D view naming the structure the user just tapped or clicked, with a short brief. Matters most
 * on phones, where the full info panel sits below the viewer and the library and would otherwise go unseen.
 */
export default function QuickCard({ s, top, onClose, onDetails }: { s: Structure; top: boolean; onClose: () => void; onDetails: () => void }) {
  const group = s.kind === 'muscle' && hasMuscleInfo(s.key) ? muscleInfo(s.key).group : structureRegion(s);
  const subtitle = [sideName(s), group].filter(Boolean).join(' · ');
  return (
    <section className={`quick-card${top ? ' top' : ''}`} aria-label={`${s.label}: summary`}>
      <button type="button" className="quick-close" onClick={onClose} aria-label="Close summary"><X size={16} /></button>
      <span className="quick-kicker">{KINDS[s.kind].label}</span>
      <h3>{s.label}</h3>
      {subtitle && <em>{subtitle}</em>}
      <p>{briefOf(s)}</p>
      <button type="button" className="quick-more" onClick={onDetails}>Full details <ArrowDown size={14} /></button>
    </section>
  );
}
