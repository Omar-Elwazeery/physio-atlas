'use client';

import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { ArrowRight, Bone, Layers as LayersIcon, Play, Repeat2, Shapes, Sparkles, Stethoscope, X, ZoomIn } from 'lucide-react';
import { hasMuscleInfo, muscleInfo } from '../lib/data/muscles';
import { movementsOfMuscle, type Dir } from '../lib/roles';
import { DOFS, JOINTS, type Dof } from '../lib/rig/spec';
import { structureRegion } from '../lib/three/viewer';
import type { MuscleInfo, Structure } from '../lib/types';
import type { Role } from '../lib/data/actions';
import type { Layers, Tab } from '../lib/atlasState';
import { NERVES, sameFilter, supplyOf, viaNerves, type NerveFilter } from '../lib/nerves';
import { CONTRIBUTING_URL, SOURCES, citation } from '../lib/data/sources';
import { KINDS } from '../lib/kinds';
import { jointInfo } from '../lib/data/joints';

interface Props {
  s: Structure;
  structures: Map<string, Structure>;
  tab: Tab;
  strain: number | null;
  /** Role of this structure in the movement currently shown (Movement tab). */
  role?: Role;
  close: () => void;
  select: (id: string | null, focus?: boolean) => void;
  layers: Layers;
  setLayers: Dispatch<SetStateAction<Layers>>;
  demo: (mv: { joint: string; dof: string; dir: Dir }, value: number) => void;
  onLesson: () => void;
  onAnimate: () => void;
  onCompare: () => void;
  compareOn: boolean;
  canCompare: boolean;
  /** The nerve-supply filter currently applied in Explore, and how to apply one (switches to Explore). */
  nerveFilter: NerveFilter | null;
  showNerve: (f: NerveFilter) => void;
  /** False in the quiz, where leaving for Explore would abandon the question. */
  nerveLinks: boolean;
}

const sideName = (s: Structure) => (s.side === 'l' ? 'Left' : s.side === 'r' ? 'Right' : '');
const jointLabel = (id: string) => JOINTS.find((j) => j.id === id)?.label ?? id;
const target = (d: Dof, dir: Dir) => (dir === 'pos' ? d.max * 0.75 : d.min * 0.75);
/** Where the geometry comes from, for the footer (the full credits are on the attribution page). */
const SOURCE_NAME = { o3d: 'Open 3D Model (adapted)', bp3d: 'BodyParts3D' } as const;
/** Joint surfaces: always rigid on one bone, so the "moves with" note is left out. */
const SURFACE_KINDS = new Set(['articular', 'fibrocartilage']);

export default function InfoPanel({ s, structures, tab, strain, role, close, select, layers, setLayers, demo, onLesson, onAnimate, onCompare, compareOn, canCompare, nerveFilter, showNerve, nerveLinks }: Props) {
  const info = s.kind === 'muscle' ? muscleInfo(s.key) : null;
  const documented = s.kind === 'muscle' ? hasMuscleInfo(s.key) : true;
  const twin = s.side === 'l' ? structures.get(s.id.replace(/-l$/, '-r')) : s.side === 'r' ? structures.get(s.id.replace(/-r$/, '-l')) : null;
  const moves = useMemo(() => (s.kind === 'muscle' ? movementsOfMuscle(s.key) : []), [s]);
  const boneDofs = useMemo(() => (s.kind === 'bone' ? DOFS.filter((d) => d.targets.some((t) => t.node === s.key)) : []), [s]);
  const tris = s.parts.reduce((a, p) => a + p.tris, 0);
  const joint = KINDS[s.kind].library === 'joint' ? jointInfo(s) : null;
  const subtitle = [sideName(s), info?.group ?? s.group].filter(Boolean).join(' · ');

  return (
    <aside className="info-panel" aria-label="Selected structure">
      <div className="info-kicker">
        {s.kind === 'muscle' ? <Sparkles size={13} /> : <Bone size={13} />} {KINDS[s.kind].label} · {structureRegion(s)}
        <button className="info-close" onClick={close} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="info-title-row">
        <div><h1>{s.label}</h1>{subtitle && <em>{subtitle}</em>}</div>
      </div>

      {info && documented && <p className="description">{info.action}</p>}
      {info && !documented && <p className="description">Clinical details for this muscle are not written yet. The 3D model is available.</p>}
      {joint && <p className="description">{joint.description}</p>}
      {!info && !joint && <p className="description">{s.kind === 'bone' ? 'Select a movement below to see how this bone moves.' : 'A supporting structure of the spine and thorax.'}</p>}
      <div className="rule" />

      {info && documented && (
        <>
          <h2>Key facts</h2>
          <dl className="key-facts">
            <div><dt><span>◇</span> Origin</dt><dd>{info.origin}</dd></div>
            <div><dt><span>⌖</span> Insertion</dt><dd>{info.insertion}</dd></div>
            <div><dt><span>⌁</span> Innervation</dt><dd>{info.innervation}{nerveLinks && <NerveButtons muscleKey={s.key} active={nerveFilter} show={showNerve} />}</dd></div>
            <div><dt><span>◈</span> Group</dt><dd>{info.group}</dd></div>
          </dl>
        </>
      )}

      {info && documented && <Sources info={info} />}
      {joint && <Sources info={joint} />}
      {joint && s.parts.length > 1 && <p className="hint">Parts: {s.parts.map((p) => p.label).join(' · ')}</p>}
      {joint && !SURFACE_KINDS.has(s.kind) && s.attach && s.attach.length > 0 && (
        <p className="hint attach-note">In the model it moves with: {[...new Set(s.attach.map((id) => structures.get(id)?.label ?? id))].join(' · ')}</p>
      )}

      {s.schematic && (
        <div className="fun-note"><Shapes size={15} /><p><b>Schematic shape</b>This muscle is not part of the source dataset. Its outline is generated between its real attachment sites and is approximate; the clinical details are accurate.</p></div>
      )}
      {info?.note && <div className="medical-note"><Stethoscope size={16} /><p><b>Clinical note</b>{info.note}</p></div>}
      {s.kind === 'muscle' && s.parts.length > 1 && <p className="hint">Parts: {s.parts.map((p) => p.label).join(' · ')}</p>}

      {s.kind === 'muscle' && tab === 'move' && <Behaviour role={role} strain={strain} />}

      {moves.length > 0 && (
        <>
          <h2>Movements</h2>
          <ul className="moves">
            {moves.map((m) => (
              <li key={`${m.joint}.${m.dof.id}.${m.dir}`}>
                <span className={`role ${m.role}`}>{m.role === 'prime' ? 'Prime' : m.role === 'assist' ? 'Assists' : 'Stabilizes'}</span>
                <span className="mv">{m.name}</span>
                <button onClick={() => demo({ joint: m.joint, dof: m.dof.id, dir: m.dir }, target(m.dof, m.dir))} aria-label={`Show ${m.name}`}><Play size={12} /></button>
              </li>
            ))}
          </ul>
        </>
      )}

      {boneDofs.length > 0 && (
        <>
          <h2>Moves at</h2>
          <ul className="moves">
            {boneDofs.flatMap((d) => (['pos', 'neg'] as Dir[]).map((dir) => (
              <li key={`${d.joint}.${d.id}.${dir}`}>
                <span className="mv">{jointLabel(d.joint)}: {dir === 'pos' ? d.pos : d.neg} ({Math.abs(dir === 'pos' ? d.max : d.min)}°)</span>
                <button onClick={() => demo({ joint: d.joint, dof: d.id, dir }, target(d, dir))} aria-label={`Show ${d.pos}`}><Play size={12} /></button>
              </li>
            )))}
          </ul>
        </>
      )}

      <button className="lesson-button" onClick={onLesson}>View lesson <ArrowRight size={16} /></button>
      <div className="action-grid">
        <button onClick={onAnimate}><Play size={15} /> Animate</button>
        <button className={compareOn ? 'active' : ''} onClick={onCompare} disabled={!canCompare}><Repeat2 size={15} /> Compare</button>
        <button onClick={() => select(s.id, true)}><ZoomIn size={15} /> Zoom</button>
        <button className={layers.isolate ? 'active' : ''} onClick={() => setLayers((l) => ({ ...l, isolate: !l.isolate }))}><LayersIcon size={15} /> Isolate</button>
        {twin && <button onClick={() => select(twin.id, true)}><Repeat2 size={15} /> Switch to {sideName(twin).toLowerCase()} <ArrowRight size={13} /></button>}
      </div>
      <p className="hint foot">{(tris / 1000).toFixed(1)}k triangles · {SOURCE_NAME[s.source ?? 'bp3d']}</p>
    </aside>
  );
}

/** Each nerve and root level the innervation text names, as a button that shows everything it supplies. */
function NerveButtons({ muscleKey, active, show }: { muscleKey: string; active: NerveFilter | null; show: (f: NerveFilter) => void }) {
  const sup = supplyOf(muscleKey);
  if (!sup || (!sup.nerves.length && !sup.roots.length)) return null;
  const chip = (f: NerveFilter, text: string, label: string, title?: string) => {
    const on = sameFilter(active, f);
    return <button key={`${f.by}:${f.id}`} type="button" className={`nerve-chip ${on ? 'on' : ''}`} aria-pressed={on} aria-label={label} title={title ?? label} onClick={() => show(f)}>{text}</button>;
  };
  return (
    <span className="nerve-chips">
      {sup.nerves.length > 0 && <span className="nerve-chips-row"><i>Nerves</i>{sup.nerves.map((id) => {
        const label = NERVES.get(id)!.label;
        const via = sup.direct.includes(id) ? [] : viaNerves(sup, id);
        return chip({ by: 'nerve', id }, label, `Show all muscles supplied by the ${label.toLowerCase()}`, via.length ? `Parent of the ${NERVES.get(via[0])!.label.toLowerCase()}. Show all muscles it supplies` : undefined);
      })}</span>}
      {sup.roots.length > 0 && <span className="nerve-chips-row"><i>Roots</i>{sup.roots.map((id) => chip({ by: 'root', id }, id, `Show all muscles with root level ${id}`))}</span>}
    </span>
  );
}

/** Honest provenance: which references the entry was checked against, or that it has not been. */
function Sources({ info }: { info: Pick<MuscleInfo, 'refs' | 'reviewed'> }) {
  const refs = info.refs ?? [];
  return (
    <>
      <h2>Sources</h2>
      {refs.length > 0 ? (
        <>
          <p className="hint">Checked against:</p>
          <ul className="sources">{refs.map((r) => <li key={r}>{SOURCES[r] ? citation(SOURCES[r]) : r}</li>)}</ul>
        </>
      ) : (
        <p className="hint">Not yet checked against a reference.{' '}
          <a href={CONTRIBUTING_URL} target="_blank" rel="noopener noreferrer">How to check and record it</a></p>
      )}
      {info.reviewed && <p className="hint">Reviewed by {info.reviewed.by} on {info.reviewed.date}.</p>}
    </>
  );
}

const ROLE_TEXT: Record<Role, { name: string; effect: string; sign: -1 | 0 | 1 }> = {
  prime: { name: 'Prime mover', effect: 'shortens as it contracts to produce this movement', sign: -1 },
  assist: { name: 'Synergist', effect: 'shortens as it helps produce this movement', sign: -1 },
  stab: { name: 'Stabilizer', effect: 'holds its length (isometric) to steady the joint', sign: 0 },
  antagonist: { name: 'Antagonist', effect: 'is lengthened, and must relax or lengthen under control', sign: 1 },
};

/**
 * The movement table decides the role. The geometric length change is only shown when it agrees with
 * the role: the model estimates length from one attachment line per muscle that bends only over the bones and
 * surfaces the muscle data names (`strainWrap`, `strainVias`), so wrapping elsewhere is ignored.
 */
function Behaviour({ role, strain }: { role?: Role; strain: number | null }) {
  if (!role) return <p className="strain">Not directly involved in the movement shown.</p>;
  const r = ROLE_TEXT[role];
  const agrees = strain !== null && Math.abs(strain) >= 0.01 && (r.sign === 0 || Math.sign(strain) === r.sign);
  return (
    <p className="strain">
      {/* Only the role is live: the length estimate changes many times a second during an animation. */}
      <span aria-live="polite"><b>{r.name}</b>: {r.effect}.</span>
      {agrees && strain !== null && <> Estimated length change <b className={strain > 0 ? 'up' : 'down'}>{strain > 0 ? '+' : '−'}{Math.abs(strain * 100).toFixed(0)}%</b> (model estimate).</>}
    </p>
  );
}
