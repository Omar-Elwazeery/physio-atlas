import type { SetStateAction } from 'react';
import type { Region, Structure } from './types';
import { LAYER_DEFAULTS, type LayerKey } from './kinds';
import type { ModalType } from '../components/LearningCards';
import { sameFilter, type NerveFilter } from './nerves';

/**
 * Top-level interface state of the atlas (everything except the pose, which lives in `usePose`, and the
 * viewer lifecycle, which lives in `useViewer`). A plain reducer so it can be tested without React.
 */

export type Tab = 'explore' | 'move' | 'quiz';

/**
 * What the quiz asks of the viewer. `highlight` is shown in the 3D view without being `selected`, so nothing that
 * is derived from the selection (info panel, learning cards, announcement, URL) can name it. While `locked`
 * (a question is pending) selection is refused, so the answer cannot be read off the info panel either.
 */
export interface QuizStage { highlight: string | null; locked: boolean; isolate: boolean }
export const QUIZ_IDLE: QuizStage = { highlight: null, locked: false, isolate: false };

/**
 * One switch per layer of `kinds.ts` (bones, muscles, discs, costal cartilage, articular cartilage, fibrocartilage,
 * ligaments, retinacula, capsules, bursae and sheaths, fasciae).
 */
export interface Layers extends Record<LayerKey, boolean> {
  side: 'both' | 'l' | 'r';
  regions: Region[] | null;
  muscleOpacity: number; boneOpacity: number;
  isolate: boolean;
}

export const DEFAULT_LAYERS: Layers = {
  ...LAYER_DEFAULTS, side: 'both', regions: null, muscleOpacity: 1, boneOpacity: 1, isolate: false,
};

export const VIEW_IDS = ['front', 'back', 'left', 'right'] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export interface AtlasState {
  tab: Tab;
  selected: string | null;
  layers: Layers;
  hidden: Set<string>;
  view: ViewId;
  autoRotate: boolean;
  searchOpen: boolean;
  modal: ModalType | null;
  compareOn: boolean;
  /** Index into the compare candidates of the selected structure (reset on every new selection). */
  refIdx: number;
  quiz: QuizStage;
  /** Nerve-supply layer of the Explore tab: highlight the muscles one nerve or root level supplies. */
  nerveFilter: NerveFilter | null;
}

export const INITIAL_ATLAS: AtlasState = {
  tab: 'explore', selected: null, layers: DEFAULT_LAYERS, hidden: new Set(), view: 'front', autoRotate: false,
  searchOpen: false, modal: null, compareOn: false, refIdx: 0,
  quiz: QUIZ_IDLE, nerveFilter: null,
};

/** The part of the state that a deep link can restore. */
export type AtlasRestore = Partial<Pick<AtlasState, 'tab' | 'selected' | 'view' | 'nerveFilter'>> & { layers?: Partial<Layers> };

export type AtlasAction =
  | { type: 'tab'; tab: Tab }
  | { type: 'select'; id: string | null }
  | { type: 'layers'; update: SetStateAction<Layers> }
  | { type: 'hidden'; update: SetStateAction<Set<string>> }
  | { type: 'nerveFilter'; filter: NerveFilter | null }
  /** Show the nerve layer: switch to Explore (unless in a quiz question, which never leaves unasked) and set the filter. */
  | { type: 'showNerve'; filter: NerveFilter }
  | { type: 'view'; view: ViewId }
  | { type: 'autoRotate'; on: boolean | 'toggle' }
  | { type: 'search'; open: boolean | 'toggle' }
  | { type: 'modal'; modal: ModalType | null }
  | { type: 'compare'; on: boolean | 'toggle' }
  | { type: 'nextReference' }
  | { type: 'quiz'; stage: QuizStage }
  /** Answer given: unlock, drop the highlight and select the structure so the info panel shows it. */
  | { type: 'quizReveal'; id: string; isolate: boolean }
  | { type: 'restore'; patch: AtlasRestore };

const apply = <T,>(cur: T, u: SetStateAction<T>): T => (typeof u === 'function' ? (u as (p: T) => T)(cur) : u);
const flag = (cur: boolean, v: boolean | 'toggle') => (v === 'toggle' ? !cur : v);

export function atlasReducer(s: AtlasState, a: AtlasAction): AtlasState {
  switch (a.type) {
    case 'tab':
      if (s.tab === a.tab) return s;
      // entering the quiz starts blind (nothing selected, selection locked) until the panel reports its question
      return a.tab === 'quiz' ? { ...s, tab: a.tab, selected: null, quiz: { highlight: null, locked: true, isolate: false } } : { ...s, tab: a.tab, quiz: QUIZ_IDLE };
    case 'select':
      if (s.tab === 'quiz' && s.quiz.locked) return s;
      return s.selected === a.id ? s : { ...s, selected: a.id, refIdx: 0 };
    case 'layers': { const layers = apply(s.layers, a.update); return layers === s.layers ? s : { ...s, layers }; }
    case 'hidden': { const hidden = apply(s.hidden, a.update); return hidden === s.hidden ? s : { ...s, hidden }; }
    case 'nerveFilter': return sameFilter(s.nerveFilter, a.filter) ? s : { ...s, nerveFilter: a.filter };
    case 'showNerve': {
      if (s.tab === 'quiz' && s.quiz.locked) return s;
      const next = s.tab === 'explore' ? s : { ...s, tab: 'explore' as const, quiz: QUIZ_IDLE };
      return sameFilter(next.nerveFilter, a.filter) ? next : { ...next, nerveFilter: a.filter };
    }
    case 'view': return s.view === a.view ? s : { ...s, view: a.view };
    case 'autoRotate': return { ...s, autoRotate: flag(s.autoRotate, a.on) };
    case 'search': {
      const open = flag(s.searchOpen, a.open);
      return open && s.tab === 'quiz' && s.quiz.locked ? s : { ...s, searchOpen: open }; // search would let a pending question be looked up
    }
    case 'modal': return s.modal === a.modal ? s : { ...s, modal: a.modal };
    case 'compare': return { ...s, compareOn: flag(s.compareOn, a.on) };
    case 'nextReference': return { ...s, refIdx: s.refIdx + 1 };
    case 'quiz': {
      const q = a.stage;
      if (q.highlight === s.quiz.highlight && q.locked === s.quiz.locked && q.isolate === s.quiz.isolate) return s;
      return { ...s, quiz: q, selected: q.locked ? null : s.selected };
    }
    case 'quizReveal': return { ...s, quiz: { highlight: null, locked: false, isolate: a.isolate }, selected: a.id, refIdx: s.selected === a.id ? s.refIdx : 0 };
    case 'restore': {
      const { layers, tab, selected, view, nerveFilter } = a.patch;
      const next: AtlasState = { ...s, layers: layers ? { ...s.layers, ...layers } : s.layers };
      if (tab !== undefined) next.tab = tab;
      if (next.tab === 'quiz') { next.selected = null; next.quiz = { highlight: null, locked: true, isolate: false }; return next; }
      if (view !== undefined) next.view = view;
      if (nerveFilter !== undefined) next.nerveFilter = nerveFilter;
      if (selected !== undefined && selected !== s.selected) { next.selected = selected; next.refIdx = 0; }
      return next;
    }
  }
}

/** Human-readable name of a structure, with its side. */
export const structureName = (s: Structure) =>
  `${s.label}${s.side === 'l' ? ', left' : s.side === 'r' ? ', right' : ''}`;

/**
 * Next / previous structure among `ids` (sorted by name, then side) relative to `current`.
 * Returns null when there is nothing to step to.
 */
export function stepStructure(
  ids: Iterable<string>, structures: Map<string, Structure>, current: string | null, dir: 1 | -1,
): { id: string; index: number; count: number } | null {
  const order = { l: 0, m: 1, r: 2 } as const;
  const list = [...ids].map((id) => structures.get(id)).filter((s): s is Structure => !!s)
    .sort((a, b) => a.label.localeCompare(b.label) || order[a.side] - order[b.side] || a.id.localeCompare(b.id));
  if (!list.length) return null;
  const at = current ? list.findIndex((s) => s.id === current) : -1;
  const index = at < 0 ? (dir > 0 ? 0 : list.length - 1) : (at + dir + list.length) % list.length;
  return { id: list[index].id, index, count: list.length };
}
