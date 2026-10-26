'use client';

import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { ArrowRight, Bone, Layers as LayersIcon, Play, Repeat2, Shapes, Sparkles, Stethoscope, X, ZoomIn } from 'lucide-react';
import { hasMuscleInfo, muscleInfo } from '../lib/data/muscles';
import { movementsOfMuscle, type Dir } from '../lib/roles';
import { DOFS, JOINTS, type Dof } from '../lib/rig/spec';
import { structureRegion } from '../lib/three/viewer';
import type { Structure } from '../lib/types';
import type { Role } from '../lib/data/actions';
import type { Layers, Tab } from './PhysioApp';

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
}

const sideName = (s: Structure) => (s.side === 'l' ? 'Left' : s.side === 'r' ? 'Right' : '');
const jointLabel = (id: string) => JOINTS.find((j) => j.id === id)?.label ?? id;
const target = (d: Dof, dir: Dir) => (dir === 'pos' ? d.max * 0.75 : d.min * 0.75);
const KIND_LABEL = { muscle: 'Muscle', bone: 'Bone', disc: 'Intervertebral disc', cartilage: 'Cartilage' } as const;

export default function InfoPanel({ s, structures, tab, strain, role, close, select, layers, setLayers, demo, onLesson, onAnimate, onCompare, compareOn, canCompare }: Props) {
  const info = s.kind === 'muscle' ? muscleInfo(s.key) : null;
  const documented = s.kind === 'muscle' ? hasMuscleInfo(s.key) : true;
  const twin = s.side === 'l' ? structures.get(s.id.replace(/-l$/, '-r')) : s.side === 'r' ? structures.get(s.id.replace(/-r$/, '-l')) : null;
  const moves = useMemo(() => (s.kind === 'muscle' ? movementsOfMuscle(s.key) : []), [s]);
  const boneDofs = useMemo(() => (s.kind === 'bone' ? DOFS.filter((d) => d.targets.some((t) => t.node === s.key)) : []), [s]);
  const tris = s.parts.reduce((a, p) => a + p.tris, 0);
  const subtitle = [sideName(s), info?.group ?? s.group].filter(Boolean).join(' · ');

  return (
    <aside className="info-panel" aria-label="Selected structure">
      <div className="info-kicker">
        {s.kind === 'muscle' ? <Sparkles size={13} /> : <Bone size={13} />} {KIND_LABEL[s.kind]} · {structureRegion(s)}
        <button className="info-close" onClick={close} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="info-title-row">
        <div><h1>{s.label}</h1>{subtitle && <em>{subtitle}</em>}</div>
      </div>

      {info && documented && <p className="description">{info.action}</p>}
      {info && !documented && <p className="description">Clinical details for this muscle are not written yet. The 3D model is available.</p>}
      {!info && <p className="description">{s.kind === 'bone' ? 'Select a movement below to see how this bone moves.' : 'A supporting structure of the spine and thorax.'}</p>}
      <div className="rule" />

      {info && documented && (
        <>
          <h2>Key facts</h2>
          <dl className="key-facts">
            <div><dt><span>◇</span> Origin</dt><dd>{info.origin}</dd></div>
            <div><dt><span>⌖</span> Insertion</dt><dd>{info.insertion}</dd></div>
            <div><dt><span>⌁</span> Innervation</dt><dd>{info.innervation}</dd></div>
            <div><dt><span>◈</span> Group</dt><dd>{info.group}</dd></div>
          </dl>
        </>
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
      <p className="hint foot">{(tris / 1000).toFixed(1)}k triangles · BodyParts3D</p>
    </aside>
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
 * the role: the model estimates length from straight attachment lines, which ignore wrapping.
 */
function Behaviour({ role, strain }: { role?: Role; strain: number | null }) {
  if (!role) return <p className="strain">Not directly involved in the movement shown.</p>;
  const r = ROLE_TEXT[role];
  const agrees = strain !== null && Math.abs(strain) >= 0.01 && (r.sign === 0 || Math.sign(strain) === r.sign);
  return (
    <p className="strain" aria-live="polite">
      <b>{r.name}</b>: {r.effect}.
      {agrees && strain !== null && <> Estimated length change <b className={strain > 0 ? 'up' : 'down'}>{strain > 0 ? '+' : '−'}{Math.abs(strain * 100).toFixed(0)}%</b> (model estimate).</>}
    </p>
  );
}
