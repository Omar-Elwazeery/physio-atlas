'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import Link from 'next/link';
import { Activity, Bone, Box, Check, ChevronsLeftRight, Eye, GraduationCap, Link2, MoveHorizontal, RotateCcw, Search, User } from 'lucide-react';
import type { ROLE_PALETTES, PaletteName, VisState } from '../lib/three/viewer';
import { buildCatalog, type CatalogItem } from '../lib/catalog';
import { KINDS } from '../lib/kinds';
import { computeRoles, type ActiveMove } from '../lib/roles';
import type { Role } from '../lib/data/actions';
import type { Structure } from '../lib/types';
import { DOFS, dofKey } from '../lib/rig/spec';
import { atlasReducer, DEFAULT_LAYERS, INITIAL_ATLAS, stepStructure, structureName, type Layers, type QuizStage, type Tab, type ViewId } from '../lib/atlasState';
import type { UrlState } from '../lib/urlState';
import { musclesOfFilter, type NerveFilter } from '../lib/nerves';
import { useViewer } from '../hooks/useViewer';
import { usePose } from '../hooks/usePose';
import { usePalette, hexColor } from '../hooks/usePalette';
import { copyText, useUrlSync } from '../hooks/useUrlSync';
import ExplorePanel from './ExplorePanel';
import MovementPanel from './MovementPanel';
import QuizPanel, { QuizWelcome } from './QuizPanel';
import InfoPanel from './InfoPanel';
import QuickCard from './QuickCard';
import SearchDialog from './SearchDialog';
import LearningCards, { type ModalType } from './LearningCards';
import CompareStrip from './CompareStrip';
import LessonModal from './LessonModal';
import { ArtContext } from './Art';
import { compareCandidates, primaryMove } from '../lib/data/learning';

export type { Tab, Layers } from '../lib/atlasState';

const VIEWS = [
  { id: 'front', label: 'Front', icon: User },
  { id: 'back', label: 'Back', icon: User },
  { id: 'left', label: 'Left', icon: ChevronsLeftRight },
  { id: 'right', label: 'Right', icon: ChevronsLeftRight },
] as const satisfies readonly { id: ViewId; label: string; icon: unknown }[];

const TIPS: Record<Tab, string> = {
  explore: 'Click any muscle or bone to read its anatomy. Press Ctrl K to search.',
  move: 'Drag a slider: the muscles that work glow red, and their antagonists turn blue.',
  quiz: 'Answer with the buttons or the keys 1 to 4, then press Enter for the next question. Names stay hidden until you answer.',
};

/** Structure selected on a first visit with no state in the URL. */
const INTRO_ID = 'biceps-brachii-l';

type Hover = { id: string; x: number; y: number };
const NO_IDS: Set<string> = new Set();

export default function PhysioApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverSink = useRef<((h: Hover | null) => void) | null>(null);
  const registerHover = useCallback((fn: ((h: Hover | null) => void) | null) => { hoverSink.current = fn; }, []);
  /** Quiz 'locate' questions take a click on the model as their answer; the handler returns true when it used the click. */
  const clickSink = useRef<((id: string | null) => boolean) | null>(null);
  const registerClick = useCallback((fn: ((id: string | null) => boolean) | null) => { clickSink.current = fn; }, []);
  const [atlas, dispatch] = useReducer(atlasReducer, INITIAL_ATLAS);
  const { tab, selected, layers, hidden, view, autoRotate, searchOpen, modal, compareOn, refIdx, quiz, nerveFilter } = atlas;
  const quizTab = tab === 'quiz';
  /** A quiz question is pending: nothing may be selected, searched or hovered, because that would name the answer. */
  const blind = quizTab && quiz.locked;

  /** Structure picked on the model itself: it gets a summary card over the view (the info panel may be off screen). */
  const [cardId, setCardId] = useState<string | null>(null);
  /** The card opens on the half of the view away from the tap, so it never covers what was just picked. */
  const [cardTop, setCardTop] = useState(false);
  const onViewerPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setCardTop(e.clientY - r.top > r.height / 2);
  }, []);
  const { viewerRef, viewer, ready, progress, error, structures, art } = useViewer(canvasRef, {
    onSelect: (id) => { if (!clickSink.current?.(id)) { dispatch({ type: 'select', id }); setCardId(id); } },
    onHover: (id, x, y) => hoverSink.current?.(id ? { id, x, y } : null),
  });
  const { pose, active, setActive, restrict, setRestrict, setDof, animatePose, resetPose, replacePose, currentPose } = usePose(viewer);
  const { palette, setPalette, colors, roleVars } = usePalette(viewer);

  const catalog = useMemo<CatalogItem[]>(() => buildCatalog(structures.values()), [structures]);

  // ---- actions --------------------------------------------------------------------------------------
  const select = useCallback((id: string | null, focus = false) => {
    if (blind) return;
    dispatch({ type: 'select', id });
    // Picked from the library or the search while its layer is off (capsules, bursae, fasciae start off): show the layer.
    const layer = id ? KINDS[structures.get(id)?.kind ?? 'bone'].layer : null;
    if (layer && !layers[layer]) dispatch({ type: 'layers', update: (l) => ({ ...l, [layer]: true }) });
    if (id && focus) viewerRef.current?.focusOn([id]);
  }, [viewerRef, blind, structures, layers]);
  const quizStage = useCallback((stage: QuizStage) => dispatch({ type: 'quiz', stage }), []);
  const quizReveal = useCallback((id: string, isolate: boolean) => dispatch({ type: 'quizReveal', id, isolate }), []);
  const quizFocus = useCallback((ids: string[]) => viewerRef.current?.focusOn(ids), [viewerRef]);
  const quizResetView = useCallback(() => viewerRef.current?.setView('reset'), [viewerRef]);
  const setTab = useCallback((t: Tab) => dispatch({ type: 'tab', tab: t }), []);
  const setLayers = useCallback((update: SetStateAction<Layers>) => dispatch({ type: 'layers', update }), []);
  const setHidden = useCallback((update: SetStateAction<Set<string>>) => dispatch({ type: 'hidden', update }), []);
  const setNerveFilter = useCallback((filter: NerveFilter | null) => dispatch({ type: 'nerveFilter', filter }), []);
  const showNerve = useCallback((filter: NerveFilter) => dispatch({ type: 'showNerve', filter }), []);
  const setModal = useCallback((m: ModalType | null) => dispatch({ type: 'modal', modal: m }), []);
  const closeModal = useCallback(() => dispatch({ type: 'modal', modal: null }), []);
  const openSearch = useCallback(() => dispatch({ type: 'search', open: true }), []);
  const closeSearch = useCallback(() => dispatch({ type: 'search', open: false }), []);
  const goView = useCallback((v: ViewId | 'reset') => {
    viewerRef.current?.setView(v);
    dispatch({ type: 'view', view: v === 'reset' ? 'front' : v });
  }, [viewerRef]);

  // ---- push state into the viewer -----------------------------------------------------------------
  // The quiz shows the whole body whatever the Explore filters are, and isolates the structure it asks about; the
  // layer of that structure is switched on even where it starts off (a capsule, a bursa).
  const quizSubject = quizTab ? structures.get(quiz.highlight ?? selected ?? '') : undefined;
  const quizLayer = quizSubject ? KINDS[quizSubject.kind].layer : null;
  const vis: VisState = useMemo(() => (quizTab
    ? { ...DEFAULT_LAYERS, ...(quizLayer ? { [quizLayer]: true } : {}), isolate: quiz.isolate || (!quiz.locked && layers.isolate), hidden: NO_IDS }
    : { ...layers, hidden }), [quizTab, quiz, layers, hidden, quizLayer]);
  const viewerSel = quizTab && quiz.highlight ? quiz.highlight : selected;
  useEffect(() => { viewerRef.current?.setVisibility(vis); }, [viewerRef, vis, ready]);
  useEffect(() => { viewerRef.current?.setSelected(viewerSel); }, [viewerRef, viewerSel, ready, vis.isolate]);
  useEffect(() => { viewerRef.current?.setAutoRotate(autoRotate); }, [viewerRef, autoRotate, ready]);

  // Nerve layer: the structure ids of the muscles the chosen nerve / root level supplies. Explore only: the Movement
  // tab colours by role, and the quiz must never be coloured by a filter that could hint at its answer.
  const highlight = useMemo(() => {
    if (!ready || tab !== 'explore' || !nerveFilter) return null;
    const keys = new Set(musclesOfFilter(nerveFilter));
    const ids = new Set<string>();
    for (const s of structures.values()) if (s.kind === 'muscle' && keys.has(s.key)) ids.add(s.id);
    return ids;
  }, [ready, tab, nerveFilter, structures]);
  useEffect(() => { viewerRef.current?.setHighlight(highlight); }, [viewerRef, highlight, ready]);

  const roles = useMemo(() => {
    if (!ready || tab !== 'move' || !active) return new Map<string, Role>();
    return computeRoles(structures.values(), active);
  }, [ready, tab, active, structures]);
  useEffect(() => { viewerRef.current?.setRoles(roles); }, [viewerRef, roles, ready]);

  /** The role of the selected muscle, and the part it belongs to when the table names parts (so the length is read on that part's line). */
  const selMove = useMemo<{ role: Role; part?: string } | undefined>(() => {
    if (!selected) return undefined;
    const direct = roles.get(selected);
    if (direct) return { role: direct };
    const order: Role[] = ['prime', 'antagonist', 'assist', 'stab'];
    const found = [...roles.entries()].filter(([k]) => k.startsWith(`${selected}/`)).map(([k, r]) => ({ role: r, part: k.slice(selected.length + 1) }));
    return order.map((r) => found.find((f) => f.role === r)).find(Boolean);
  }, [roles, selected]);
  const selRole = selMove?.role;
  const selPart = selMove?.part;

  // Live length change of the selected muscle. The viewer is already posed at (or, mid-tween, slightly
  // ahead of) the committed `pose`, so this follows the committed pose at its ~10 Hz rate.
  const strain = useMemo(() => {
    if (!viewer || !selected || tab !== 'move') return null;
    void pose;
    return viewer.strainOf(selected, selPart);
  }, [viewer, pose, selected, selPart, tab]);

  // ---- deep links ---------------------------------------------------------------------------------
  const isStructure = useCallback((id: string) => structures.has(id), [structures]);
  const urlInput = useMemo(() => ({ selected, tab, pose, active, restrict, view, layers, nerve: nerveFilter }), [selected, tab, pose, active, restrict, view, layers, nerveFilter]);
  const onRestore = useCallback((u: UrlState | null) => {
    if (!u) {
      if (structures.has(INTRO_ID)) dispatch({ type: 'select', id: INTRO_ID });
      return;
    }
    dispatch({ type: 'restore', patch: { selected: u.selected, tab: u.tab, layers: u.layers, nerveFilter: u.nerve ?? null } });
    if (u.pose) replacePose(u.pose);
    if (u.active) setActive(u.active);
    if (u.restrict !== undefined) setRestrict(u.restrict);
    if (u.view && u.view !== 'front') goView(u.view);
  }, [structures, replacePose, setActive, setRestrict, goView]);
  const { linkFor } = useUrlSync({ ready, isStructure, state: urlInput, onRestore });

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyTimer = useRef(0);
  const copyLink = useCallback(async () => {
    const url = linkFor({ ...urlInput, pose: currentPose() });
    const ok = await copyText(url);
    setCopyState(ok ? 'copied' : 'failed');
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyState('idle'), 2200);
  }, [linkFor, urlInput, currentPose]);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  // ---- keyboard -----------------------------------------------------------------------------------
  // Cmd/Ctrl+K
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); dispatch({ type: 'search', open: 'toggle' }); }
      if (e.key === 'Escape') dispatch({ type: 'search', open: false });
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  /** Position of the last keyboard step, announced with the selection. */
  const [stepInfo, setStepInfo] = useState<{ id: string; index: number; count: number } | null>(null);
  const onCanvasKey = (e: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (blind && (e.key === '[' || e.key === ']')) return;
    if (e.key === '[' || e.key === ']') {
      const v = viewerRef.current;
      if (!v || !ready) return;
      e.preventDefault();
      const next = stepStructure(v.visibleIds(), structures, selected, e.key === ']' ? 1 : -1);
      if (!next) return;
      setStepInfo(next);
      select(next.id);
    } else if (e.key === 'Escape' && selected && !searchOpen && !modal) {
      e.preventDefault();
      select(null);
    } else if (e.key === 'Home') {
      dispatch({ type: 'view', view: 'front' }); // the viewer resets the camera on Home
    }
  };

  // Dev-only hook for visual checks (see scripts/shot.mjs).
  const commits = useRef(0);
  useEffect(() => { commits.current++; });
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as Record<string, unknown>).__physio = {
      pose: (p: Record<string, number>, move?: ActiveMove) => { replacePose(p); if (move) { setTab('move'); setActive(move); } },
      animate: animatePose,
      setDof,
      currentPose,
      select: (id: string | null) => select(id, true),
      tab: setTab,
      viewer: () => viewerRef.current,
      layers: (l: Partial<Layers>) => setLayers((x) => ({ ...x, ...l })),
      hide: (ids: string[]) => setHidden(new Set(ids)),
      nerve: (f: NerveFilter | null) => setNerveFilter(f),
      commits: () => commits.current,
    };
  }, [select, replacePose, animatePose, setDof, currentPose, setTab, setActive, setLayers, setHidden, setNerveFilter, viewerRef]);

  // ---- derived ------------------------------------------------------------------------------------
  const selStruct = selected ? structures.get(selected) ?? null : null;
  const candidates = useMemo(() => (selStruct ? compareCandidates(selStruct, structures) : []), [selStruct, structures]);
  const reference = candidates.length ? candidates[refIdx % candidates.length] : null;

  /** Switch to the Movement view and animate the selected structure's side through a movement. */
  const demoMove = useCallback((mv: { joint: string; dof: string; dir: 'pos' | 'neg' }, value: number) => {
    if (!selStruct) return;
    const d = DOFS.find((x) => x.joint === mv.joint && x.id === mv.dof);
    if (!d) return;
    const side = d.paired ? (selStruct.side === 'r' ? 'r' : 'l') : 'm';
    setTab('move');
    animatePose({ [dofKey(d, side)]: value }, 1.2, { joint: mv.joint, dof: mv.dof, dir: mv.dir, side });
  }, [selStruct, animatePose, setTab]);
  const counts = useMemo(() => {
    let muscles = 0, bones = 0, joints = 0;
    for (const c of catalog) {
      const tab = KINDS[c.kind].library;
      if (tab === 'muscle') muscles++; else if (tab === 'bone') bones++; else if (tab === 'joint') joints++;
    }
    return { muscles, bones, joints };
  }, [catalog]);

  const selName = selStruct ? structureName(selStruct) : null;
  const cardStruct = !quizTab && cardId && cardId === selected ? selStruct : null;
  const showDetails = useCallback(() => {
    setCardId(null);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelector('.info-panel')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, []);
  const announcement = blind ? '' : selStruct
    ? `Selected: ${selName}${stepInfo?.id === selStruct.id ? `, ${stepInfo.index + 1} of ${stepInfo.count}` : ''}`
    : ready ? 'No structure selected' : '';

  return (
    <ArtContext.Provider value={art}>
    <main className="app-shell" style={roleVars}>
      <header className="topbar">
        <button className="brand" onClick={() => { select(null); goView('reset'); }} aria-label="Physio Atlas home">
          <strong>Physio Atlas<sup>3D</sup></strong>
          <em>see how the body moves</em>
        </button>
        <nav className="main-nav" role="tablist" aria-label="Mode">
          {([['explore', 'Explore', Bone], ['move', 'Movement', Activity], ['quiz', 'Quiz', GraduationCap]] as const).map(([t, l, Icon]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              <Icon size={16} /><span>{l}</span>
            </button>
          ))}
        </nav>
        <button className="search-box" onClick={openSearch} disabled={blind} aria-label="Search structures" title={blind ? 'Search is switched off while a quiz question is open' : undefined}>
          <Search size={16} /><span>Search muscles and bones</span><kbd>Ctrl K</kbd>
        </button>
        <div className="topbar-actions">
          <button className="credits copy-link" onClick={copyLink} disabled={!ready} aria-label="Copy a link to this view">
            {copyState === 'copied' ? <Check size={15} aria-hidden /> : <Link2 size={15} aria-hidden />}
            <span>{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy link'}</span>
          </button>
          <Link className="credits" href="/attribution">Credits</Link>
        </div>
        <p className="sr-only" role="status">{copyState === 'copied' ? 'Link copied to the clipboard' : copyState === 'failed' ? 'Could not copy the link' : ''}</p>
      </header>

      <div className="workspace">
        <aside className="organ-library">
          <div className="panel-heading">
            <span>{tab === 'explore' ? 'Library' : tab === 'quiz' ? 'Quiz' : 'Joints and movement'}</span>
            <small>{tab === 'explore' ? `${counts.muscles} muscles · ${counts.bones} bones · ${counts.joints} joint structures` : tab === 'quiz' ? 'test yourself on the atlas data' : 'ranges follow AAOS norms'}</small>
          </div>
          <div className="library-scroll">
            {tab === 'explore' && (
              <ExplorePanel catalog={catalog} layers={layers} setLayers={setLayers} selected={selected} select={select}
                hidden={hidden} setHidden={setHidden} structures={structures} nerveFilter={nerveFilter} setNerveFilter={setNerveFilter} />
            )}
            {tab === 'move' && (
              <MovementPanel pose={pose} setDof={setDof} animatePose={animatePose} resetPose={resetPose}
                active={active} setActive={setActive} restrict={restrict} setRestrict={setRestrict} />
            )}
            {ready && (
              <QuizPanel active={quizTab} structures={structures} stage={quizStage} reveal={quizReveal} focus={quizFocus} resetView={quizResetView} registerClick={registerClick} />
            )}
          </div>
        </aside>

        <section className="viewer-shell">
          <div className="viewer-glow" aria-hidden />
          <div className="three-mount" onPointerUpCapture={onViewerPointerUp}>
            <canvas ref={canvasRef} tabIndex={0} onKeyDown={onCanvasKey}
              aria-label={`3D anatomy viewer${quiz.highlight && quizTab ? '. A structure is highlighted for the quiz question' : selName ? `. Selected: ${selName}` : ''}`} aria-describedby="viewer-keys" />
          </div>
          <p id="viewer-keys" className="sr-only">
            Arrow keys turn the model, Shift and arrows pan, plus and minus zoom, and Home resets the view. Press ] or [ to select the next or previous visible structure, and Escape to clear the selection.
          </p>
          <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>

          <div className="viewer-tools" role="group" aria-label="Camera">
            {VIEWS.map(({ id, label, icon: Icon }) => (
              <button key={id} className={`tool-button ${view === id ? 'active' : ''}`} onClick={() => goView(id)} aria-label={`${label} view`}>
                <Icon size={18} />{label}
              </button>
            ))}
            <button className="tool-button" onClick={() => goView('reset')} aria-label="Reset camera"><RotateCcw size={18} />Reset</button>
          </div>

          <div className="tip-note" role="note" aria-label="Tip">
            <span aria-hidden><Eye size={13} /> tip</span>
            <p>{TIPS[tab]}</p>
          </div>

          {cardStruct && <QuickCard key={cardStruct.id} s={cardStruct} top={cardTop} onClose={() => setCardId(null)} onDetails={showDetails} />}

          {active && tab === 'move' && <Legend palette={palette} setPalette={setPalette} colors={colors} />}

          <div className="view-caption">
            <span>Viewing</span>
            <strong>{VIEWS.find((v) => v.id === view)?.label} view</strong>
          </div>
          <button className="auto-rotate" onClick={() => dispatch({ type: 'autoRotate', on: 'toggle' })} aria-pressed={autoRotate}>
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
            close={() => select(null)} select={select} layers={quizTab ? { ...layers, isolate: vis.isolate } : layers} setLayers={setLayers}
            demo={demoMove} nerveFilter={tab === 'explore' ? nerveFilter : null} showNerve={showNerve} nerveLinks={!quizTab}
            onLesson={() => setModal('lesson')} onAnimate={() => setModal('animation')}
            onCompare={() => dispatch({ type: 'compare', on: 'toggle' })} compareOn={compareOn} canCompare={!!reference} />
        ) : quizTab ? (
          <QuizWelcome />
        ) : (
          <Welcome counts={counts} openSearch={openSearch} />
        )}
      </div>

      {selStruct && (
        <LearningCards s={selStruct} reference={reference} onModal={setModal}
          onCompare={() => dispatch({ type: 'compare', on: true })}
          onPlay={() => { const m = primaryMove(selStruct); if (m) demoMove({ joint: m.joint, dof: m.dof, dir: m.dir }, m.value); }} />
      )}

      {compareOn && selStruct && reference && (
        <CompareStrip a={selStruct} b={reference} onClose={() => dispatch({ type: 'compare', on: false })} onNext={() => dispatch({ type: 'nextReference' })} />
      )}
      {modal && selStruct && <LessonModal type={modal} s={selStruct} onClose={closeModal} onPlay={demoMove} />}

      <HoverTip register={registerHover} structures={structures} suppress={blind} />
      {searchOpen && <SearchDialog catalog={catalog} close={closeSearch} pick={(id) => { select(id, true); closeSearch(); }} />}
    </main>
    </ArtContext.Provider>
  );
}

/**
 * Mouse-hover label. Holds its own state so pointer movement over the canvas re-renders only this,
 * not the whole app. (Mouse only; the selection is announced to screen readers separately.)
 */
function HoverTip({ register, structures, suppress }: { register: (fn: ((h: Hover | null) => void) | null) => void; structures: Map<string, Structure>; suppress: boolean }) {
  const [hover, setHover] = useState<Hover | null>(null);
  useEffect(() => {
    register(setHover);
    return () => register(null);
  }, [register]);
  const s = hover ? structures.get(hover.id) : null;
  if (!s || !hover || suppress) return null;
  return (
    <div className="tip" style={{ left: hover.x + 14, top: hover.y + 14 }} aria-hidden>
      {s.label}{s.side !== 'm' ? ` (${s.side === 'l' ? 'left' : 'right'})` : ''}
    </div>
  );
}

const LEGEND: [Role, string][] = [['prime', 'Prime mover'], ['assist', 'Synergist'], ['stab', 'Stabilizer'], ['antagonist', 'Antagonist']];

function Legend({ palette, setPalette, colors }: { palette: PaletteName; setPalette: (p: PaletteName) => void; colors: (typeof ROLE_PALETTES)[PaletteName] }) {
  const cvd = palette === 'cvd';
  return (
    <ul className="legend" aria-label="Muscle roles">
      {LEGEND.map(([role, label]) => <li key={role}><i style={{ background: hexColor(colors[role]) } as CSSProperties} />{label}</li>)}
      <li className="legend-toggle">
        <button type="button" className="palette-toggle" aria-pressed={cvd} onClick={() => setPalette(cvd ? 'default' : 'cvd')}
          title="Use colours that stay distinct with red-green colour blindness">
          Colour-blind safe <span className={`switch ${cvd ? 'on' : ''}`} aria-hidden><i /></span>
        </button>
      </li>
    </ul>
  );
}

function Welcome({ counts, openSearch }: { counts: { muscles: number; bones: number; joints: number }; openSearch: () => void }) {
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
      <div className="medical-note"><MoveHorizontal size={16} /><p><b>In the model</b>{counts.muscles} muscles, {counts.bones} bones and {counts.joints} joint structures (cartilage, menisci, labra, ligaments, capsules, bursae, sheaths, retinacula and fasciae), left and right, with 16 joints and their ranges of motion.</p></div>
      <button className="lesson-button" onClick={openSearch}>Search the library <Search size={16} /></button>
    </aside>
  );
}
