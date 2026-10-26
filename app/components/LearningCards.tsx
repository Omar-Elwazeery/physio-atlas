'use client';

import { ArrowRight, BrainCircuit, FileText, Microscope, Play, Share2 } from 'lucide-react';
import { conditionsOf, factOf, primaryMove, TISSUE, tissueOf } from '../lib/data/learning';
import { muscleInfo } from '../lib/data/muscles';
import { structureRegion } from '../lib/three/viewer';
import type { Structure } from '../lib/types';
import { Art } from './Art';
import TissueArt from './TissueArt';

export type ModalType = 'lesson' | 'animation' | 'system';

interface Props {
  s: Structure;
  reference: Structure | null;
  onModal: (m: ModalType) => void;
  onCompare: () => void;
  onPlay: () => void;
}

/** The row of study cards under the viewer: a fact, the tissue, a comparison, the movement, conditions and location. */
export default function LearningCards({ s, reference, onModal, onCompare, onPlay }: Props) {
  const region = structureRegion(s);
  const move = primaryMove(s);
  const group = s.kind === 'muscle' ? muscleInfo(s.key).group : s.group ?? region;
  const tissue = tissueOf(s);

  return (
    <section className="learning-cards" aria-label={`Study resources for ${s.label}`}>
      <article className="curiosity-card">
        <span>✿</span>
        <p>{factOf(s, region)}</p>
        <em>did you know</em>
      </article>

      <article>
        <header><div><em>Microscopic</em><h3>{TISSUE[tissue].title}</h3></div><Microscope size={17} /></header>
        <div className="microscope-visual organ-card-image"><TissueArt kind={tissue} /></div>
        <button onClick={() => onModal('lesson')}>Explore tissue <ArrowRight size={14} /></button>
      </article>

      <article>
        <header><div><em>Compare</em><h3>{reference ? reference.label : 'Nothing to compare'}</h3></div><Share2 size={17} /></header>
        <div className="comparison-visual organ-card-image">
          {reference ? <Art key={reference.id} spec={{ kind: 'organ', id: reference.id }} label={reference.label} /> : null}
        </div>
        <button onClick={onCompare} disabled={!reference}>Open comparison <ArrowRight size={14} /></button>
      </article>

      <article>
        <header><div><em>Function animation</em><h3>{move ? move.label : 'No joint movement'}</h3></div><Play size={17} /></header>
        <button type="button" className="function-visual organ-card-image" onClick={onPlay} disabled={!move} aria-label={`Play the movement of ${s.label}`}>
          <Art key={s.id} spec={{ kind: 'organ', id: s.id }} label={s.label} />
          <i className="function-pulse" />
          <span className="play-badge"><Play size={18} fill="currentColor" /></span>
        </button>
        <button onClick={() => onModal('animation')}>Play animation <ArrowRight size={14} /></button>
      </article>

      <article>
        <header><div><em>Clinical notes</em><h3>Common conditions</h3></div><FileText size={17} /></header>
        <ul>{conditionsOf(s).map((c) => <li key={c}>{c}</li>)}</ul>
        <button onClick={() => onModal('lesson')}>See all <ArrowRight size={14} /></button>
      </article>

      <article className="system-card">
        <header><div><em>Where it works</em><h3>{region} · {group}</h3></div><BrainCircuit size={17} /></header>
        <button type="button" className="system-visual organ-card-image" onClick={() => onModal('system')} aria-label={`See ${s.label} in the body`}>
          <Art key={s.id} spec={{ kind: 'location', id: s.id }} label={s.label} />
        </button>
        <button onClick={() => onModal('system')}>See in the body <ArrowRight size={14} /></button>
      </article>
    </section>
  );
}
