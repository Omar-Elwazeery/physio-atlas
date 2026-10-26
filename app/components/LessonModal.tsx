'use client';

import { ArrowRight, Play, X } from 'lucide-react';
import { useEffect } from 'react';
import { conditionsOf, jointsCrossed, TISSUE, tissueOf } from '../lib/data/learning';
import { muscleInfo, hasMuscleInfo } from '../lib/data/muscles';
import { movementsOfMuscle, type Dir } from '../lib/roles';
import { structureRegion } from '../lib/three/viewer';
import type { Structure } from '../lib/types';
import { Art } from './Art';
import TissueArt from './TissueArt';
import type { ModalType } from './LearningCards';

const ICON: Record<ModalType, string> = { lesson: '✦', animation: '▶', system: '⌖' };
const lc = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

interface Props {
  type: ModalType;
  s: Structure;
  onClose: () => void;
  onPlay: (mv: { joint: string; dof: string; dir: Dir }, value: number) => void;
}

export default function LessonModal({ type, s, onClose, onPlay }: Props) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const region = structureRegion(s);
  const info = s.kind === 'muscle' && hasMuscleInfo(s.key) ? muscleInfo(s.key) : null;
  const moves = s.kind === 'muscle' ? movementsOfMuscle(s.key) : [];
  const title = type === 'lesson' ? `Inside the ${s.label}` : type === 'animation' ? `${s.label} in motion` : `${s.label} in the body`;
  const tissue = TISSUE[tissueOf(s)];

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={`learning-modal ${type === 'system' ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <span className="modal-icon">{ICON[type]}</span>
        <em>guided</em>
        <h2 id="modal-title">{title}</h2>

        {type === 'lesson' && (
          <>
            {info ? (
              <>
                <p>{s.label} is a muscle of the {region.toLowerCase()}, in the {lc(info.group)} group.</p>
                <dl className="lesson-facts">
                  <div><dt>Origin</dt><dd>{info.origin}</dd></div>
                  <div><dt>Insertion</dt><dd>{info.insertion}</dd></div>
                  <div><dt>Innervation</dt><dd>{info.innervation}</dd></div>
                  <div><dt>Action</dt><dd>{info.action}</dd></div>
                </dl>
              </>
            ) : (
              <p>{s.label} is part of the {region.toLowerCase()}. Choose a movement to see how it moves with the joints around it.</p>
            )}
            <div className="modal-pair">
              <figure><div className="modal-demo"><Art spec={{ kind: 'organ', id: s.id }} label={s.label} /></div><figcaption>{s.label}</figcaption></figure>
              <figure><div className="modal-demo tissue"><TissueArt kind={tissueOf(s)} /></div><figcaption>{tissue.title}</figcaption></figure>
            </div>
            <p><strong>Tissue.</strong> {tissue.body}</p>
            <h3 className="modal-sub">Common conditions</h3>
            <ul className="modal-list">{conditionsOf(s).map((c) => <li key={c}>{c}</li>)}</ul>
            {info?.note && <p className="modal-note"><b>Clinical note</b> {info.note}</p>}
          </>
        )}

        {type === 'animation' && (
          <>
            <p>Pick a movement and watch the joint move through its range while the muscles that work light up in the Movement view.</p>
            <div className="modal-demo moving"><Art spec={{ kind: 'organ', id: s.id }} label={s.label} /></div>
            {moves.length > 0 ? (
              <ul className="modal-moves">
                {moves.map((m) => (
                  <li key={`${m.joint}.${m.dof.id}.${m.dir}`}>
                    <span className={`role ${m.role}`}>{m.role === 'prime' ? 'Prime' : m.role === 'assist' ? 'Assists' : 'Stabilizes'}</span>
                    <span>{m.name}</span>
                    <button onClick={() => { onPlay({ joint: m.joint, dof: m.dof.id, dir: m.dir }, (m.dir === 'pos' ? m.dof.max : m.dof.min) * 0.75); onClose(); }} aria-label={`Play ${m.name}`}><Play size={13} /></button>
                  </li>
                ))}
              </ul>
            ) : <p className="hint">This structure does not drive a joint movement on its own.</p>}
          </>
        )}

        {type === 'system' && (
          <>
            <p>{info ? `Here is where the ${lc(s.label)} sits in the body, highlighted against the skeleton.` : `Here is where the ${lc(s.label)} sits in the skeleton.`}</p>
            <figure className="modal-figure"><Art spec={{ kind: 'location', id: s.id }} label={s.label} /></figure>
            <dl className="modal-facts">
              <div><dt>Region</dt><dd>{region}</dd></div>
              <div><dt>Crosses</dt><dd>{s.kind === 'muscle' ? jointsCrossed(s).join(', ') : s.group ?? '—'}</dd></div>
              <div><dt>Nerve</dt><dd>{info ? info.innervation.split(/[;(]/)[0].trim() : '—'}</dd></div>
            </dl>
          </>
        )}

        <button className="lesson-button" onClick={onClose}>Continue exploring <ArrowRight size={16} /></button>
      </section>
    </div>
  );
}
