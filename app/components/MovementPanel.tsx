'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { DOFS, JOINTS, dofKey, type Dof } from '../lib/rig/spec';
import { actionFor, parseRef } from '../lib/data/actions';
import type { ActiveMove, Dir } from '../lib/roles';
import type { Side } from '../lib/types';

interface Props {
  pose: Record<string, number>;
  setDof: (key: string, value: number, move: ActiveMove | null) => void;
  animatePose: (t: Record<string, number>, duration?: number, move?: ActiveMove | null, onDone?: () => void) => void;
  resetPose: () => void;
  active: ActiveMove | null;
  setActive: Dispatch<SetStateAction<ActiveMove | null>>;
  restrict: number;
  setRestrict: (n: number) => void;
}

const PRESETS: { name: string; pose: Record<string, number> }[] = [
  { name: 'Squat', pose: { 'hip.flexion-extension.l': 100, 'hip.flexion-extension.r': 100, 'knee.flexion-extension.l': 110, 'knee.flexion-extension.r': 110, 'ankle.dorsiflexion-plantarflexion.l': 20, 'ankle.dorsiflexion-plantarflexion.r': 20, 'lumbar.flexion-extension': 20, 'shoulder.flexion-extension.l': 80, 'shoulder.flexion-extension.r': 80 } },
  { name: 'Overhead reach', pose: { 'shoulder.flexion-extension.l': 170, 'shoulder.flexion-extension.r': 170, 'thoracic.flexion-extension': -15, 'lumbar.flexion-extension': -12, 'elbow.flexion-extension.l': 0, 'elbow.flexion-extension.r': 0 } },
  { name: 'Gait: heel strike', pose: { 'hip.flexion-extension.l': 30, 'knee.flexion-extension.l': 3, 'ankle.dorsiflexion-plantarflexion.l': 5, 'hip.flexion-extension.r': -10, 'knee.flexion-extension.r': 10, 'ankle.dorsiflexion-plantarflexion.r': -20, 'shoulder.flexion-extension.l': -20, 'shoulder.flexion-extension.r': 25, 'elbow.flexion-extension.l': 10, 'elbow.flexion-extension.r': 25 } },
  { name: 'Forward bend', pose: { 'lumbar.flexion-extension': 55, 'thoracic.flexion-extension': 30, 'cervical.flexion-extension': 20, 'hip.flexion-extension.l': 60, 'hip.flexion-extension.r': 60, 'shoulder.flexion-extension.l': 30, 'shoulder.flexion-extension.r': 30 } },
  { name: 'Tai-chi arms', pose: { 'shoulder.abduction-adduction.l': 90, 'shoulder.abduction-adduction.r': 90, 'elbow.flexion-extension.l': 60, 'elbow.flexion-extension.r': 60, 'forearm.pronation-supination.l': 40, 'forearm.pronation-supination.r': 40, 'wrist.flexion-extension.l': 20, 'wrist.flexion-extension.r': 20 } },
];

const pretty = (k: string) => k.replace(/-of-(hand|foot)$/, '').split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

export function range(d: Dof, restrict: number): [number, number] {
  return [d.min < 0 ? d.min * restrict : d.min, d.max > 0 ? d.max * restrict : d.max];
}

export default function MovementPanel({ pose, setDof, animatePose, resetPose, active, restrict, setRestrict }: Props) {
  const [openJoint, setOpenJoint] = useState<string>('shoulder');
  const [mirror, setMirror] = useState(false);

  const groups = ['Spine & head', 'Upper limb', 'Lower limb'] as const;

  const change = (d: Dof, side: Side, value: number) => {
    const dir: Dir = value >= 0 ? 'pos' : 'neg';
    const move: ActiveMove = { joint: d.joint, dof: d.id, dir, side };
    setDof(dofKey(d, side), value, move);
    if (mirror && d.paired) setDof(dofKey(d, side === 'l' ? 'r' : 'l'), value, move);
  };

  const play = (d: Dof, side: Side) => {
    const [lo, hi] = range(d, restrict);
    const key = dofKey(d, side);
    const mv = (dir: Dir): ActiveMove => ({ joint: d.joint, dof: d.id, dir, side });
    const targets = (v: number) => (mirror && d.paired ? { [key]: v, [dofKey(d, side === 'l' ? 'r' : 'l')]: v } : { [key]: v });
    animatePose(targets(hi), 1.6, mv('pos'), () => {
      if (lo < -1) animatePose(targets(lo), 2.2, mv('neg'), () => animatePose(targets(0), 1.2, mv('neg')));
      else animatePose(targets(0), 1.2, mv('pos'));
    });
  };

  const musclesFor = (m: ActiveMove) => {
    const a = actionFor(m.joint, m.dof, m.dir);
    if (!a) return null;
    const names = (refs: string[]) => [...new Set(refs.map((r) => { const p = parseRef(r); return pretty(p.key) + (p.part ? ` (${p.part.replace(/-/g, ' ')})` : ''); }))];
    return { prime: names(a.prime), assist: names(a.assist), stab: names(a.stab ?? []) };
  };
  const acting = active ? musclesFor(active) : null;
  const activeDof = active ? DOFS.find((x) => x.joint === active.joint && x.id === active.dof) : null;

  return (
    <div className="panel">
      <section>
        <h2>Poses</h2>
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.name} className="chip" onClick={() => animatePose(p.pose, 1.4, null)}>{p.name}</button>
          ))}
          <button className="chip warn" onClick={resetPose}>Reset all</button>
        </div>
        <label className="chip check"><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />Move both sides together</label>
        <label className="row">Range of motion: {Math.round(restrict * 100)}% of normal
          <input type="range" min={0.2} max={1} step={0.05} value={restrict} onChange={(e) => setRestrict(+e.target.value)} />
        </label>
        {restrict < 1 && <p className="hint">Simulating a restricted joint: every slider is limited to {Math.round(restrict * 100)}% of its normal range.</p>}
      </section>

      {acting && active && activeDof && (
        <section className="acting" aria-live="polite">
          <h2>{(JOINTS.find((j) => j.id === active.joint)?.label ?? '')}: {active.dir === 'pos' ? activeDof.pos : activeDof.neg}</h2>
          {acting.prime.length > 0 && <p><i className="dot" style={{ background: '#ef4444' }} /><b>Prime movers</b> {acting.prime.join(', ')}</p>}
          {acting.assist.length > 0 && <p><i className="dot" style={{ background: '#f59e0b' }} /><b>Synergists</b> {acting.assist.join(', ')}</p>}
          {acting.stab.length > 0 && <p><i className="dot" style={{ background: '#facc15' }} /><b>Stabilizers</b> {acting.stab.join(', ')}</p>}
          <p><i className="dot" style={{ background: '#3b82f6' }} /><b>Antagonists</b> the opposite movement&apos;s prime movers (blue)</p>
        </section>
      )}

      {groups.map((g) => (
        <section key={g}>
          <h3>{g}</h3>
          {JOINTS.filter((j) => j.region === g).map((j) => {
            const dofs = DOFS.filter((d) => d.joint === j.id);
            const open = openJoint === j.id;
            return (
              <div key={j.id} className="joint">
                <button className="tree-head" aria-expanded={open} onClick={() => setOpenJoint(open ? '' : j.id)}>
                  <span className={`caret ${open ? 'open' : ''}`}>▸</span>{j.label}
                </button>
                {open && dofs.map((d) => (
                  <div key={d.id} className="dof">
                    <div className="dof-title">{d.label}</div>
                    {d.note && <p className="hint">{d.note}</p>}
                    {(d.paired ? (['l', 'r'] as Side[]) : (['m'] as Side[])).map((side) => {
                      const key = dofKey(d, side);
                      const v = pose[key] ?? 0;
                      const [lo, hi] = range(d, restrict);
                      const pct = v >= 0 ? (d.max ? (v / d.max) * 100 : 0) : (d.min ? (v / d.min) * 100 : 0);
                      return (
                        <div key={side} className="slider">
                          <div className="slider-head">
                            {d.paired && <span className="side-tag">{side === 'l' ? 'Left' : 'Right'}</span>}
                            <output>{Math.abs(Math.round(v)) === 0 ? 'Neutral' : `${v > 0 ? d.pos : d.neg} ${Math.abs(Math.round(v))}°`}</output>
                            <span className="pct">{Math.round(pct)}% of normal</span>
                            <button className="play" onClick={() => play(d, side)} aria-label={`Play ${d.label}`} title="Play through the range">▶</button>
                          </div>
                          <input type="range" min={lo} max={hi} step={1} value={Math.min(hi, Math.max(lo, v))}
                            aria-label={`${j.label} ${d.label}${d.paired ? ` ${side === 'l' ? 'left' : 'right'}` : ''}`}
                            onChange={(e) => change(d, side, +e.target.value)} />
                          <div className="ends"><span>{lo < 0 ? `${d.neg} ${Math.round(-lo)}°` : ''}</span><span>{d.pos} {Math.round(hi)}°</span></div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </section>
      ))}
      <p className="hint foot">Ranges follow standard goniometric norms (AAOS). Joint centres are estimated from the model, so treat angles as illustrative.</p>
    </div>
  );
}
