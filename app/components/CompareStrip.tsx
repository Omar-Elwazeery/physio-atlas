'use client';

import { Repeat2, X } from 'lucide-react';
import { lengthCm } from '../lib/data/learning';
import { muscleInfo } from '../lib/data/muscles';
import { structureRegion } from '../lib/three/viewer';
import type { Structure } from '../lib/types';
import { Art } from './Art';

const firstSentence = (t: string) => t.split(/(?<=[.;])\s/)[0].replace(/[.;]$/, '');
const role = (s: Structure) => (s.kind === 'muscle' ? firstSentence(muscleInfo(s.key).action) : `A bone of the ${structureRegion(s).toLowerCase()}`);
const sideTag = (s: Structure) => (s.side === 'l' ? ' (left)' : s.side === 'r' ? ' (right)' : '');

/** Floating strip that sets the selected structure beside a reference structure. */
export default function CompareStrip({ a, b, onClose, onNext }: { a: Structure; b: Structure; onClose: () => void; onNext: () => void }) {
  const la = lengthCm(a), lb = lengthCm(b);
  const ratio = lb > 0 ? la / lb : 1;
  return (
    <section className="compare-strip" aria-label="Comparison">
      <div className="compare-organ">
        <Art key={a.id} spec={{ kind: 'thumb', id: a.id }} label={a.label} />
        <span>Comparing</span><strong>{a.label}</strong><small>{[sideTag(a).replace(/[() ]/g, ''), structureRegion(a)].filter(Boolean).join(' · ')}</small>
      </div>
      <b>vs</b>
      <div className="compare-organ">
        <Art key={b.id} spec={{ kind: 'thumb', id: b.id }} label={b.label} />
        <span>Reference</span><strong>{b.label}</strong><small>{[sideTag(b).replace(/[() ]/g, ''), structureRegion(b)].filter(Boolean).join(' · ')}</small>
      </div>
      <dl>
        <div><dt>Primary role</dt><dd>{role(a)}</dd><dd className="vs-line">{role(b)}</dd></div>
        <div><dt>Scale</dt><dd>{la} cm</dd><dd className="vs-line">{lb} cm</dd><dd className="ratio">{ratio >= 1 ? `${ratio.toFixed(1)}× longer` : `${(1 / ratio).toFixed(1)}× shorter`}</dd></div>
      </dl>
      <div className="compare-actions">
        <button onClick={onNext} aria-label="Next reference" title="Next reference"><Repeat2 size={16} /></button>
        <button onClick={onClose} aria-label="Close comparison"><X size={16} /></button>
      </div>
    </section>
  );
}
