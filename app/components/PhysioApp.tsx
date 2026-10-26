'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { Activity, Bone, Box, ChevronsLeftRight, Eye, MoveHorizontal, RotateCcw, Search, User } from 'lucide-react';
import { Viewer, type VisState } from '../lib/three/viewer';
import { buildCatalog, type CatalogItem } from '../lib/catalog';
import { computeRoles, type ActiveMove } from '../lib/roles';
import type { Role } from '../lib/data/actions';
import type { Region, Structure } from '../lib/types';
import { DOFS, dofKey } from '../lib/rig/spec';
import ExplorePanel from './ExplorePanel';
import MovementPanel from './MovementPanel';
import InfoPanel from './InfoPanel';
import SearchDialog from './SearchDialog';
import LearningCards, { type ModalType } from './LearningCards';
import CompareStrip from './CompareStrip';
import LessonModal from './LessonModal';
import { ArtContext } from './Art';
import { ArtService } from '../lib/art';
import { compareCandidates, primaryMove } from '../lib/data/learning';

export type Tab = 'explore' | 'move';
export interface Layers {
  bones: boolean; muscles: boolean; discs: boolean; cartilage: boolean;
  side: 'both' | 'l' | 'r';
  regions: Region[] | null;
  muscleOpacity: number; boneOpacity: number;
  isolate: boolean;
}

const DEFAULT_LAYERS: Layers = {
  bones: true, muscles: true, discs: true, cartilage: true, side: 'both', regions: null,
  muscleOpacity: 1, boneOpacity: 1, isolate: false,
};

const VIEWS = [
  { id: 'front', label: 'Front', icon: User },
  { id: 'back', label: 'Back', icon: User },
  { id: 'left', label: 'Left', icon: ChevronsLeftRight },
  { id: 'right', label: 'Right', icon: ChevronsLeftRight },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

const TIPS: Record<Tab, string> = {
  explore: 'Click any muscle or bone to read its anatomy. Press Ctrl K to search.',
  move: 'Drag a slider: the muscles that work glow red, and their antagonists turn blue.',
};

export default function PhysioApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [structures, setStructures] = useState<Map<string, Structure>>(new Map());
  const [tab, setTab] = useState<Tab>('explore');
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [pose, setPoseState] = useState<Record<string, number>>({});
  const [active, setActive] = useState<ActiveMove | null>(null);
  const [restrict, setRestrict] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [strain, setStrain] = useState<number | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [view, setView] = useState<ViewId>('front');
  const [art, setArt] = useState<ArtService | null>(null);
  const [modal, setModal] = useState<ModalType | null>(null);
  const [compareOn, setCompareOn] = useState(false);
  const [refIdx, setRefIdx] = useState(0);
  const introSelected = useRef(false);
  const poseRef = useRef(pose);
  poseRef.current = pose;
  const tweenRef = useRef<gsap.core.Tween | gsap.core.Timeline | null>(null);

  const catalog = useMemo<CatalogItem[]>(() => buildCatalog(structures.values()), [structures]);

  // ---- viewer lifecycle ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current!;
    let viewer: Viewer;
    try {
      viewer = new Viewer(canvas, {
        onSelect: (id) => setSelected(id),
        onHover: (id, x, y) => setHover(id ? { id, x, y } : null),
      });
    } catch {
      setError('WebGL is not available in this browser.');
      return;
    }
    viewerRef.current = viewer;
    viewer.load(setProgress).then(() => {
      setStructures(new Map(viewer.structures));
      setArt(new ArtService(viewer, viewer.structures));
      setReady(true);
      if (!introSelected.current) { introSelected.current = true; setSelected('biceps-brachii-l'); }
    }).catch((e) => setError(String(e?.message ?? e)));
    return () => { viewer.dispose(); viewerRef.current = null; };
  }, []);

  // ---- push state into the viewer -----------------------------------------------------------------
  const vis: VisState = useMemo(() => ({ ...layers, hidden }), [layers, hidden]);
  useEffect(() => { viewerRef.current?.setVisibility(vis); }, [vis, ready]);
  useEffect(() => { viewerRef.current?.setSelected(selected); }, [selected, ready, layers.isolate]);
  useEffect(() => { if (ready) viewerRef.current?.setPose(pose); }, [pose, ready]);
  useEffect(() => { viewerRef.current?.setAutoRotate(autoRotate); }, [autoRotate, ready]);

  const roles = useMemo(() => {
    if (!ready || tab !== 'move' || !active) return new Map<string, Role>();
    return computeRoles(structures.values(), active);
  }, [ready, tab, active, structures]);
  useEffect(() => { viewerRef.current?.setRoles(roles); }, [roles, ready]);

  // Live length change of the selected muscle while moving.
  useEffect(() => {
    const v = viewerRef.current;
    if (!ready || !v || !selected || tab !== 'move') { setStrain(null); return; }
    setStrain(v.strainOf(selected));
  }, [pose, selected, tab, ready]);

  // Cmd/Ctrl+K
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen((o) => !o); }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ---- actions --------------------------------------------------------------------------------------
  const select = useCallback((id: string | null, focus = false) => {
    setSelected(id);
    if (id && focus) viewerRef.current?.focusOn([id]);
  }, []);

  const setDof = useCallback((key: string, value: number, move: ActiveMove | null) => {
    tweenRef.current?.kill();
    setPoseState((p) => ({ ...p, [key]: value }));
    if (move) setActive(move);
  }, []);

  /** Animate any number of pose values to targets over `duration` seconds. */
  const animatePose = useCallback((targets: Record<string, number>, duration = 1.1, move?: ActiveMove | null, onDone?: () => void) => {
    tweenRef.current?.kill();
    const from = { ...poseRef.current };
    const proxy = { t: 0 };
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (move) setActive(move);
    tweenRef.current = gsap.to(proxy, {
      t: 1, duration: reduce ? 0 : duration, ease: 'power2.inOut', onComplete: onDone,
      onUpdate: () => {
        const next: Record<string, number> = { ...poseRef.current };
        for (const [k, v] of Object.entries(targets)) next[k] = (from[k] ?? 0) + (v - (from[k] ?? 0)) * proxy.t;
        setPoseState(next);
      },
    });
  }, []);

  const resetPose = useCallback(() => {
    const zero: Record<string, number> = {};
    for (const k of Object.keys(poseRef.current)) zero[k] = 0;
    animatePose(zero, 0.7, null);
    setActive(null);
  }, [animatePose]);

  const goView = (v: ViewId | 'reset') => {
    viewerRef.current?.setView(v);
    setView(v === 'reset' ? 'front' : v);
  };

  // Dev-only hook for visual checks (see scripts/shot.mjs).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as Record<string, unknown>).__physio = {
      pose: (p: Record<string, number>, move?: ActiveMove) => { setPoseState(p); if (move) { setTab('move'); setActive(move); } },
      select: (id: string | null) => select(id, true),
      tab: (t: Tab) => setTab(t),
      viewer: () => viewerRef.current,
      layers: (l: Partial<Layers>) => setLayers((x) => ({ ...x, ...l })),
      hide: (ids: string[]) => setHidden(new Set(ids)),
    };
  }, [select]);

  const selRole = useMemo<Role | undefined>(() => {
    if (!selected) return undefined;
    const direct = roles.get(selected);
    if (direct) return direct;
    const order: Role[] = ['prime', 'antagonist', 'assist', 'stab'];
    const found = [...roles.entries()].filter(([k]) => k.startsWith(`${selected}/`)).map(([, r]) => r);
    return order.find((r) => found.includes(r));
  }, [roles, selected]);

  const hoverStruct = hover ? structures.get(hover.id) : null;
  const selStruct = selected ? structures.get(selected) ?? null : null;
  const candidates = useMemo(() => (selStruct ? compareCandidates(selStruct, structures) : []), [selStruct, structures]);
  const reference = candidates.length ? candidates[refIdx % candidates.length] : null;
  useEffect(() => { setRefIdx(0); }, [selected]);

  /** Switch to the Movement view and animate the selected structure's side through a movement. */
  const demoMove = useCallback((mv: { joint: string; dof: string; dir: 'pos' | 'neg' }, value: number) => {
    if (!selStruct) return;
    const d = DOFS.find((x) => x.joint === mv.joint && x.id === mv.dof);
    if (!d) return;
    const side = d.paired ? (selStruct.side === 'r' ? 'r' : 'l') : 'm';
    setTab('move');
    animatePose({ [dofKey(d, side)]: value }, 1.2, { joint: mv.joint, dof: mv.dof, dir: mv.dir, side });
  }, [selStruct, animatePose]);
  const counts = useMemo(() => {
    let muscles = 0, bones = 0;
    for (const c of catalog) c.kind === 'muscle' ? muscles++ : bones++;
    return { muscles, bones };
  }, [catalog]);

  return (
    <ArtContext.Provider value={art}>
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => { setSelected(null); goView('reset'); }} aria-label="Physio Atlas home">
          <strong>Physio Atlas<sup>3D</sup></strong>
          <em>see how the body moves</em>
        </button>
        <nav className="main-nav" role="tablist" aria-label="Mode">
          {([['explore', 'Explore', Bone], ['move', 'Movement', Activity]] as const).map(([t, l, Icon]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              <Icon size={16} /><span>{l}</span>
            </button>
          ))}
        </nav>
        <button className="search-box" onClick={() => setSearchOpen(true)} aria-label="Search structures">
          <Search size={16} /><span>Search muscles and bones</span><kbd>Ctrl K</kbd>
        </button>
        <a className="credits" href="/attribution">Credits</a>
      </header>

      <div className="workspace">
        <aside className="organ-library">
          <div className="panel-heading">
            <span>{tab === 'explore' ? 'Library' : 'Joints and movement'}</span>
            <small>{tab === 'explore' ? `${counts.muscles} muscles · ${counts.bones} bones` : 'ranges follow AAOS norms'}</small>
          </div>
          <div className="library-scroll">
            {tab === 'explore' && (
              <ExplorePanel catalog={catalog} layers={layers} setLayers={setLayers} selected={selected} select={select}
                hidden={hidden} setHidden={setHidden} structures={structures} />
            )}
            {tab === 'move' && (
              <MovementPanel pose={pose} setDof={setDof} animatePose={animatePose} resetPose={resetPose}
                active={active} setActive={setActive} restrict={restrict} setRestrict={setRestrict} />
            )}
          </div>
        </aside>

        <section className="viewer-shell">
          <div className="viewer-glow" aria-hidden />
          <div className="three-mount"><canvas ref={canvasRef} aria-label="3D anatomy viewer" /></div>

          <div className="viewer-tools" role="group" aria-label="Camera">
            {VIEWS.map(({ id, label, icon: Icon }) => (
              <button key={id} className={`tool-button ${view === id ? 'active' : ''}`} onClick={() => goView(id)} aria-label={`${label} view`}>
                <Icon size={18} />{label}
              </button>
            ))}
            <button className="tool-button" onClick={() => goView('reset')} aria-label="Reset camera"><RotateCcw size={18} />Reset</button>
          </div>

          <div className="tip-note" aria-hidden>
            <span><Eye size={13} /> tip</span>
            <p>{TIPS[tab]}</p>
          </div>

          {active && tab === 'move' && <Legend />}

          <div className="view-caption">
            <span>Viewing</span>
            <strong>{VIEWS.find((v) => v.id === view)?.label} view</strong>
          </div>
          <button className="auto-rotate" onClick={() => setAutoRotate((a) => !a)} aria-pressed={autoRotate}>
            Auto-rotate <span className={`switch ${autoRotate ? 'on' : ''}`}><i /></span>
          </button>

          {!ready && !error && (
            <div className="model-loader" role="status">
              <div className="loader-orbit"><Box size={20} /></div>
              <strong>Preparing the anatomy…</strong>
              <span>{Math.round(progress * 100)}%</span>
            </div>
          )}
          {error && <div className="model-loader error" role="alert"><strong>{error}</strong></div>}
        </section>

        {selStruct ? (
          <InfoPanel s={selStruct} structures={structures} tab={tab} strain={strain} role={selRole}
            close={() => setSelected(null)} select={select} layers={layers} setLayers={setLayers}
            demo={demoMove}
            onLesson={() => setModal('lesson')} onAnimate={() => setModal('animation')}
            onCompare={() => setCompareOn((c) => !c)} compareOn={compareOn} canCompare={!!reference} />
        ) : (
          <Welcome counts={counts} openSearch={() => setSearchOpen(true)} />
        )}
      </div>

      {selStruct && (
        <LearningCards s={selStruct} reference={reference} onModal={setModal}
          onCompare={() => setCompareOn(true)}
          onPlay={() => { const m = primaryMove(selStruct); if (m) demoMove({ joint: m.joint, dof: m.dof, dir: m.dir }, m.value); }} />
      )}

      {compareOn && selStruct && reference && (
        <CompareStrip a={selStruct} b={reference} onClose={() => setCompareOn(false)} onNext={() => setRefIdx((i) => i + 1)} />
      )}
      {modal && selStruct && <LessonModal type={modal} s={selStruct} onClose={() => setModal(null)} onPlay={demoMove} />}

      {hoverStruct && hover && (
        <div className="tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          {hoverStruct.label}{hoverStruct.side !== 'm' ? ` (${hoverStruct.side === 'l' ? 'left' : 'right'})` : ''}
        </div>
      )}
      {searchOpen && <SearchDialog catalog={catalog} close={() => setSearchOpen(false)} pick={(id) => { select(id, true); setSearchOpen(false); }} />}
    </main>
    </ArtContext.Provider>
  );
}

function Legend() {
  return (
    <ul className="legend" aria-label="Muscle roles">
      <li><i style={{ background: '#e0453a' }} />Prime mover</li>
      <li><i style={{ background: '#f0902f' }} />Synergist</li>
      <li><i style={{ background: '#e3b72b' }} />Stabilizer</li>
      <li><i style={{ background: '#4a7fd1' }} />Antagonist</li>
    </ul>
  );
}

function Welcome({ counts, openSearch }: { counts: { muscles: number; bones: number }; openSearch: () => void }) {
  return (
    <aside className="info-panel" aria-label="Welcome">
      <div className="info-kicker"><Bone size={13} /> Welcome</div>
      <div className="info-title-row">
        <div><h1>Physio Atlas</h1><em>muscles, joints and movement</em></div>
      </div>
      <p className="description">Explore the muscles and bones in 3D, then move any joint through its range and watch which muscles do the work.</p>
      <div className="rule" />
      <h2>How to use it</h2>
      <dl className="key-facts">
        <div><dt><span>◇</span> Select</dt><dd>Click a muscle or bone, or pick one from the library, to see where it attaches and what it does.</dd></div>
        <div><dt><span>⌁</span> Move</dt><dd>Switch to Movement and drag a slider. Prime movers glow red, helpers orange, antagonists blue.</dd></div>
        <div><dt><span>⌖</span> Look</dt><dd>Drag to turn the body, scroll to zoom, and use the rail on the left for standard views.</dd></div>
        <div><dt><span>❋</span> Inside</dt><dd>Fade the muscles or isolate one to see the structures beneath.</dd></div>
      </dl>
      <div className="medical-note"><MoveHorizontal size={16} /><p><b>In the model</b>{counts.muscles} muscles and {counts.bones} bones, left and right, with 16 joints and their ranges of motion.</p></div>
      <button className="lesson-button" onClick={openSearch}>Search the library <Search size={16} /></button>
    </aside>
  );
}
