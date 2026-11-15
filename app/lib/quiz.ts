import { buildCatalog, preferredId, REGIONS, type CatalogItem } from './catalog';
import { hasMuscleInfo, muscleInfo } from './data/muscles';
import { actionFor, parseRef } from './data/actions';
import { DOFS, JOINTS } from './rig/spec';
import type { MuscleInfo, Region, Structure } from './types';
import { KINDS } from './kinds';
import { jointInfo } from './data/joints';

/**
 * Quiz engine: question generation, Leitner scheduling and persistence. Pure (no React, DOM or three.js
 * state): all randomness goes through an injected `rng`, so a seed reproduces a question exactly.
 * Every question, option and explanation is built from the existing data files (muscle table, movement
 * table, structure manifest); nothing is written here.
 */

// ---- types --------------------------------------------------------------------------------------------

export const QUESTION_TYPES = ['identify', 'innervation', 'action', 'attachment', 'locate'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
/** Locate needs a clear line of sight to the muscle (deep muscles can sit behind others), so it is opt-in. */
export const DEFAULT_TYPES: QuestionType[] = ['identify', 'innervation', 'action', 'attachment'];
export const TYPE_LABEL: Record<QuestionType, string> = {
  identify: 'Identify', innervation: 'Innervation', action: 'Movement', attachment: 'Attachment', locate: 'Locate',
};

export type Rng = () => number;
export interface QuizFilter { types: QuestionType[]; /** empty = every region */ regions: Region[] }

export interface QuizOption { id: string; label: string }
export interface Question {
  /** Leitner key: `<type>|<subject>`. */
  key: string;
  type: QuestionType;
  /** Region of the structure the question is about (for an action question: of the correct muscle). */
  region: Region;
  prompt: string;
  /** Exactly four distinct options. For `locate` they are the fallback to clicking the model. */
  options: QuizOption[];
  answer: number;
  /** One line from the data, shown after answering. */
  explanation: string;
  /** Structure to highlight and focus while the question is pending (`identify` only). */
  highlight: string | null;
  /** Structure to select and focus once the question is answered. */
  reveal: string;
  /** `locate`: catalog key of the muscle the user has to click (either side counts). */
  clickKey: string | null;
}

export const mulberry32 = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const pickOne = <T,>(xs: readonly T[], rng: Rng): T => xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];

// ---- ambiguity rules ----------------------------------------------------------------------------------

const PLACEHOLDER = 'Not yet documented';
const documented = (s: string | undefined) => !!s && !s.startsWith(PLACEHOLDER);

const NERVE_STOP = new Set(['nerve', 'nerves', 'rami', 'ramus', 'spinal', 'of', 'the', 'and', 'or', 'to', 'via', 'with', 'from', 'deep', 'superficial',
  'branch', 'branches', 'division', 'divisions', 'recurrent', 'part', 'head', 'belly', 'half', 'small', 'sometimes', 'digits']);
/**
 * Branch -> parent pairs that the innervation strings themselves do not spell out. Only used to keep a
 * parent nerve from being offered as a wrong answer next to its branch (and vice versa); never shown.
 */
const NERVE_PARENT: [string[], string][] = [[['posterior', 'interosseous'], 'radial'], [['anterior', 'interosseous'], 'median']];

/**
 * Which nerves an innervation string names, as sets of identifying words per clause (root values, "nerve",
 * "deep" and similar words dropped) plus its cranial-nerve tags. Two strings whose clauses are equal or nested
 * could both be called correct, so they are never offered together.
 */
export function nerveSig(s: string): string[][] {
  const sets: string[][] = [];
  for (const m of s.matchAll(/\bCN\s+([IVX]+\d?)/gi)) sets.push([`cn${m[1].toLowerCase()}`]);
  const flat = s.replace(/\([^)]*\)/g, (m) => (/nerve|rami/i.test(m) ? ` ; ${m.slice(1, -1)} ; ` : ' ; ')).replace(/\bCN\s+[IVX]+\d?/gi, ' ');
  for (const clause of flat.split(/[;,.:]|\band\b|\bor\b/i)) {
    const words = (clause.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 1 && !NERVE_STOP.has(w));
    if (words.length) sets.push([...new Set(words)]);
  }
  for (const [need, parent] of NERVE_PARENT) if (sets.some((set) => need.every((w) => set.includes(w)))) sets.push([parent]);
  return sets;
}
export function nervesConflict(a: string[][], b: string[][]): boolean {
  return a.some((x) => b.some((y) => x.every((w) => y.includes(w)) || y.every((w) => x.includes(w))));
}

const TEXT_STOP = new Set(('the and via with from into that which both each all its part parts portion portions medial lateral anterior posterior superior inferior upper lower proximal distal ' +
  'base surface border third half fibres fibers aspect margin process processes body side adjacent whole entire region area one two three first second').split(' '));
const stem = (w: string) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') ? w.slice(0, -1) : w);
export const textTokens = (s: string): string[] => [...new Set((s.toLowerCase().match(/[a-z]+\d*/g) ?? []).filter((w) => w.length > 2 && !TEXT_STOP.has(w)).map(stem))];
const segments = (s: string): string[] => s.toLowerCase().split(/[,;]|\band\b/).map((x) => x.trim()).filter(Boolean);

// ---- pool ---------------------------------------------------------------------------------------------

interface PoolItem {
  item: CatalogItem;
  /** Structure ids that may be highlighted: schematic shapes are approximate, so they are left out. */
  solidIds: string[];
}
interface PoolMuscle extends PoolItem {
  info: MuscleInfo;
  nerve: string[][];
  /** Tokens and segments of origin + insertion together, used to reject distractors that overlap. */
  attach: { tokens: Set<string>; segs: Set<string> };
}
interface MoveSubject {
  key: string; name: string; primeKeys: string[]; primeLabels: string[]; involved: Set<string>; opposite: Set<string>;
}
interface PoolEntry { key: string; type: QuestionType; regions: Region[] }

export interface QuizPool {
  muscles: Map<string, PoolMuscle>;
  bones: Map<string, PoolItem>;
  /** Joint surfaces large enough to identify (menisci, labra, the main articular surfaces). */
  joints: Map<string, PoolItem>;
  moves: Map<string, MoveSubject>;
  /** Tokens too common in the attachment texts to tell two muscles apart ("humerus", "ribs"). */
  generic: Set<string>;
  /** Every question key that can be generated, with the regions it can be about. */
  entries: PoolEntry[];
}

const movementName = (joint: string, dof: string, dir: 'pos' | 'neg') => {
  const d = DOFS.find((x) => x.joint === joint && x.id === dof);
  return `${JOINTS.find((j) => j.id === joint)?.label ?? joint}: ${d ? (dir === 'pos' ? d.pos : d.neg) : dof}`;
};

const GENERIC_DF = 12;
/**
 * Joint structures left out of identify questions: per-digit, per-rib and per-vertebra pieces are too small to tell
 * apart, and so are one finger's capsule or sheath from the next (soft tissue below JOINT_MIN_SIZE is left out too).
 */
const SMALL_JOINT = /-(proximal|middle|distal)$|^cartilage-(metacarpal|metatarsal|rib|[ctl]\d|sesamoid|pisiform|sacrum-|coccyx|manubrium|sternum|tibia-fibular|fibular-head)|^sacrococcygeal|-(thumb|index|middle|ring|little|hallux|toe\d)$/;
/** Smallest soft-tissue structure (bounding-box diagonal, metres) that an identify question may show. */
const JOINT_MIN_SIZE = 0.015;
const SURFACE_KINDS = new Set(['articular', 'fibrocartilage']);

const diag = (s: Structure | undefined) => (s ? Math.hypot(...s.bbox[1].map((x, i) => x - s.bbox[0][i])) : 0);

export function buildPool(structures: Iterable<Structure>): QuizPool {
  const list = [...structures];
  const byId = new Map(list.map((s) => [s.id, s]));
  const solid = (it: CatalogItem) => Object.values(it.ids).filter((id): id is string => !!id && !byId.get(id)?.schematic);
  const muscles = new Map<string, PoolMuscle>();
  const bones = new Map<string, PoolItem>();
  const joints = new Map<string, PoolItem>();
  for (const item of buildCatalog(list)) {
    if (item.kind === 'muscle') {
      if (!hasMuscleInfo(item.key)) continue;
      const info = muscleInfo(item.key);
      muscles.set(item.key, { item, solidIds: solid(item), info, nerve: [], attach: { tokens: new Set(), segs: new Set() } });
    } else if (item.kind === 'bone' && item.group !== 'Digits') bones.set(item.key, { item, solidIds: solid(item) });
    else if (KINDS[item.kind].library === 'joint' && !SMALL_JOINT.test(item.key) && (SURFACE_KINDS.has(item.kind) || diag(byId.get(preferredId(item))) >= JOINT_MIN_SIZE)) {
      joints.set(item.key, { item, solidIds: solid(item) });
    }
  }

  // attachment overlap: drop tokens that appear in many texts
  const df = new Map<string, number>();
  for (const m of muscles.values()) for (const f of [m.info.origin, m.info.insertion]) for (const t of textTokens(f)) df.set(t, (df.get(t) ?? 0) + 1);
  const generic = new Set([...df].filter(([, n]) => n > GENERIC_DF).map(([t]) => t));
  for (const m of muscles.values()) {
    m.nerve = nerveSig(m.info.innervation);
    for (const f of [m.info.origin, m.info.insertion]) {
      for (const t of textTokens(f)) if (!generic.has(t)) m.attach.tokens.add(t);
      for (const s of segments(f)) m.attach.segs.add(s);
    }
  }

  const moves = new Map<string, MoveSubject>();
  for (const d of DOFS) {
    for (const dir of ['pos', 'neg'] as const) {
      const act = actionFor(d.joint, d.id, dir);
      if (!act) continue;
      const opp = actionFor(d.joint, d.id, dir === 'pos' ? 'neg' : 'pos');
      const keysOf = (refs: string[]) => [...new Set(refs.map((r) => parseRef(r).key))];
      const primeKeys = keysOf(act.prime).filter((k) => muscles.has(k));
      if (!primeKeys.length) continue;
      const involved = new Set([...keysOf(act.prime), ...keysOf(act.assist), ...keysOf(act.stab ?? [])]);
      const key = `${d.joint}.${d.id}.${dir}`;
      moves.set(key, {
        key, name: movementName(d.joint, d.id, dir), primeKeys,
        primeLabels: primeKeys.map((k) => muscles.get(k)!.item.label),
        involved, opposite: new Set(opp ? keysOf(opp.prime) : []),
      });
    }
  }

  const pool: QuizPool = { muscles, bones, joints, moves, generic, entries: [] };
  const probe = (type: QuestionType, subject: string, regions: Region[]) => {
    if (build(pool, type, subject, () => 0.5)) pool.entries.push({ key: `${type}|${subject}`, type, regions });
  };
  for (const [k, m] of muscles) {
    const r = [m.item.region];
    if (m.solidIds.length) probe('identify', `muscle:${k}`, r);
    if (documented(m.info.innervation)) probe('innervation', `muscle:${k}`, r);
    if (documented(m.info.origin) || documented(m.info.insertion)) probe('attachment', `muscle:${k}`, r);
    if (m.solidIds.length) probe('locate', `muscle:${k}`, r);
  }
  for (const [k, b] of bones) if (b.solidIds.length) probe('identify', `bone:${k}`, [b.item.region]);
  for (const [k, j] of joints) if (j.solidIds.length) probe('identify', `joint:${k}`, [j.item.region]);
  for (const mv of moves.values()) probe('action', mv.key, [...new Set(mv.primeKeys.map((k) => muscles.get(k)!.item.region))]);
  return pool;
}

// ---- generation ---------------------------------------------------------------------------------------

interface Cand<T> { v: T; tier: number }

/** First `n` candidates, closest tier first and random within a tier, none that `accept` refuses. */
function pickDistractors<T>(cands: Cand<T>[], n: number, rng: Rng, accept: (c: T, chosen: T[]) => boolean): T[] | null {
  const chosen: T[] = [];
  for (const tier of [0, 1, 2]) {
    for (const c of shuffle(cands.filter((x) => x.tier === tier), rng)) {
      if (chosen.length >= n) break;
      if (accept(c.v, chosen)) chosen.push(c.v);
    }
  }
  return chosen.length === n ? chosen : null;
}

const tierOf = (a: CatalogItem, b: CatalogItem) => (a.group === b.group ? 0 : a.region === b.region ? 1 : 2);

/** Up to `max` characters of whole sentences from `s`. */
export function oneLine(s: string, max = 170): string {
  const parts = s.split(/(?<=[.!?])\s+/);
  let out = '';
  for (const p of parts) {
    if (out && (out + ' ' + p).length > max) break;
    out = out ? `${out} ${p}` : p;
  }
  if (out.length > max + 40) out = `${out.slice(0, max).replace(/\s+\S*$/, '')}…`;
  return /[.!?…]$/.test(out) ? out : `${out}.`;
}

function assemble(
  q: Omit<Question, 'options' | 'answer'> & { correct: QuizOption }, wrong: QuizOption[], rng: Rng,
): Question | null {
  const options = shuffle([q.correct, ...wrong], rng);
  if (new Set(options.map((o) => o.id)).size !== 4 || new Set(options.map((o) => o.label)).size !== 4) return null;
  const { correct, ...rest } = q;
  return { ...rest, options, answer: options.findIndex((o) => o.id === correct.id) };
}

const sideId = (p: PoolItem, rng: Rng) => pickOne(p.solidIds.length ? p.solidIds : Object.values(p.item.ids) as string[], rng);

function build(pool: QuizPool, type: QuestionType, subject: string, rng: Rng, regions: Region[] = []): Question | null {
  const key = `${type}|${subject}`;
  const inRegion = (r: Region) => !regions.length || regions.includes(r);

  if (type === 'action') {
    const mv = pool.moves.get(subject);
    if (!mv) return null;
    const ok = mv.primeKeys.filter((k) => inRegion(pool.muscles.get(k)!.item.region));
    if (!ok.length) return null;
    const ck = pickOne(ok, rng);
    const c = pool.muscles.get(ck)!;
    const cands = [...pool.muscles.values()].filter((m) => !mv.involved.has(m.item.key));
    // one antagonist (a prime mover of the opposite movement) is the most tempting wrong answer
    const ant = pickDistractors(cands.filter((m) => mv.opposite.has(m.item.key)).map((v) => ({ v, tier: 0 })), 1, rng, () => true) ?? [];
    const rest = pickDistractors(cands.filter((m) => !ant.includes(m)).map((v) => ({ v, tier: tierOf(v.item, c.item) })), 3 - ant.length, rng, () => true);
    if (!rest) return null;
    const part = partsOf(mv, ck);
    return assemble({
      key, type, region: c.item.region, prompt: `Which of these is a prime mover for ${mv.name}?`,
      correct: { id: ck, label: c.item.label },
      explanation: `${c.item.label}${part ? ` (${part})` : ''} is a prime mover for ${mv.name}. Prime movers: ${mv.primeLabels.join(', ')}.`,
      highlight: null, reveal: preferredId(c.item), clickKey: null,
    }, [...ant, ...rest].map((m) => ({ id: m.item.key, label: m.item.label })), rng);
  }

  const [kind, k] = [subject.slice(0, subject.indexOf(':')), subject.slice(subject.indexOf(':') + 1)];
  if (kind === 'bone') {
    const b = pool.bones.get(k);
    if (!b || type !== 'identify' || !b.solidIds.length || !inRegion(b.item.region)) return null;
    const wrong = pickDistractors([...pool.bones.values()].filter((x) => x !== b && x.item.label !== b.item.label).map((v) => ({ v, tier: tierOf(v.item, b.item) })), 3, rng, () => true);
    if (!wrong) return null;
    const id = sideId(b, rng);
    return assemble({
      key, type, region: b.item.region, prompt: 'Which bone is highlighted in the 3D view?', correct: { id: b.item.key, label: b.item.label },
      explanation: `${b.item.label} is a bone of the ${b.item.region.toLowerCase()} (${b.item.group.toLowerCase()}).`,
      highlight: id, reveal: id, clickKey: null,
    }, wrong.map((x) => ({ id: x.item.key, label: x.item.label })), rng);
  }

  if (kind === 'joint') {
    const j = pool.joints.get(k);
    if (!j || type !== 'identify' || !j.solidIds.length || !inRegion(j.item.region)) return null;
    // Closest distractors: the same kind at the same joint (a ligament among ligaments), so the shape alone does not
    // give the answer away.
    const jointTier = (a: CatalogItem) => (a.kind === j.item.kind && a.group === j.item.group ? 0 : a.kind === j.item.kind || a.group === j.item.group ? 1 : 2);
    const wrong = pickDistractors([...pool.joints.values()].filter((x) => x !== j && x.item.label !== j.item.label).map((v) => ({ v, tier: jointTier(v.item) })), 3, rng, () => true);
    if (!wrong) return null;
    const id = sideId(j, rng);
    return assemble({
      key, type, region: j.item.region, prompt: 'Which joint structure is highlighted in the 3D view?', correct: { id: j.item.key, label: j.item.label },
      explanation: `${j.item.label}: ${jointInfo(j.item).description}`,
      highlight: id, reveal: id, clickKey: null,
    }, wrong.map((x) => ({ id: x.item.key, label: x.item.label })), rng);
  }

  const m = pool.muscles.get(k);
  if (kind !== 'muscle' || !m || !inRegion(m.item.region)) return null;
  const others = [...pool.muscles.values()].filter((x) => x !== m);
  const rev = preferredId(m.item);

  if (type === 'identify' || type === 'locate') {
    if (!m.solidIds.length) return null;
    const wrong = pickDistractors(others.filter((x) => x.item.label !== m.item.label).map((v) => ({ v, tier: tierOf(v.item, m.item) })), 3, rng, () => true);
    if (!wrong) return null;
    const id = sideId(m, rng);
    const identify = type === 'identify';
    return assemble({
      key, type, region: m.item.region, prompt: identify ? 'Which muscle is highlighted in the 3D view?' : `Click the ${m.item.label} on the 3D model.`,
      correct: { id: m.item.key, label: m.item.label }, explanation: `${m.item.label}: ${documented(m.info.action) ? oneLine(m.info.action) : m.info.group}`,
      highlight: identify ? id : null, reveal: id, clickKey: identify ? null : m.item.key,
    }, wrong.map((x) => ({ id: x.item.key, label: x.item.label })), rng);
  }

  if (type === 'innervation') {
    if (!documented(m.info.innervation)) return null;
    const seen = new Set<string>();
    const cands = others.filter((x) => documented(x.info.innervation) && !seen.has(x.info.innervation) && seen.add(x.info.innervation))
      .map((v) => ({ v, tier: tierOf(v.item, m.item) }));
    const wrong = pickDistractors(cands, 3, rng, (c, chosen) => !nervesConflict(c.nerve, m.nerve) && chosen.every((o) => !nervesConflict(c.nerve, o.nerve)));
    if (!wrong) return null;
    return assemble({
      key, type, region: m.item.region, prompt: `Which nerve supplies ${m.item.label}?`, correct: { id: m.info.innervation, label: m.info.innervation },
      explanation: `Innervation of ${m.item.label}: ${m.info.innervation}.`, highlight: null, reveal: rev, clickKey: null,
    }, wrong.map((x) => ({ id: x.info.innervation, label: x.info.innervation })), rng);
  }

  // attachment
  const fields = (['origin', 'insertion'] as const).filter((f) => documented(m.info[f]));
  if (!fields.length) return null;
  const field = pickOne(fields, rng);
  const text = m.info[field];
  const pt = textTokens(text).filter((t) => !pool.generic.has(t));
  const ps = segments(text);
  const clash = (x: PoolMuscle) => ps.some((s) => x.attach.segs.has(s)) || pt.some((t) => x.attach.tokens.has(t)) || x.info.origin === text || x.info.insertion === text;
  const wrong = pickDistractors(others.filter((x) => x.item.label !== m.item.label && !clash(x)).map((v) => ({ v, tier: tierOf(v.item, m.item) })), 3, rng, () => true);
  if (!wrong) return null;
  return assemble({
    key, type, region: m.item.region, prompt: `Which muscle ${field === 'origin' ? 'originates from' : 'inserts on'}: ${text}?`,
    correct: { id: m.item.key, label: m.item.label }, explanation: `${field === 'origin' ? 'Origin' : 'Insertion'} of ${m.item.label}: ${text}.`,
    highlight: null, reveal: rev, clickKey: null,
  }, wrong.map((x) => ({ id: x.item.key, label: x.item.label })), rng);
}

/** Part of a muscle that is the prime mover, from the movement table (trapezius -> "descending part"). */
function partsOf(mv: MoveSubject, muscleKey: string): string {
  const [joint, dof, dir] = mv.key.split('.');
  const act = actionFor(joint, dof, dir as 'pos' | 'neg');
  const all = (act?.prime ?? []).map(parseRef).filter((p) => p.key === muscleKey);
  return all.every((p) => p.part) ? [...new Set(all.map((p) => p.part!.replace(/-/g, ' ')))].join(', ') : '';
}

/** Generate the question for a key (`<type>|<subject>`); null when the data cannot support it. */
export function makeQuestion(pool: QuizPool, key: string, rng: Rng, regions: Region[] = []): Question | null {
  const i = key.indexOf('|');
  const type = key.slice(0, i) as QuestionType;
  if (i < 0 || !(QUESTION_TYPES as readonly string[]).includes(type)) return null;
  return build(pool, type, key.slice(i + 1), rng, regions);
}

export function candidateKeys(pool: QuizPool, f: QuizFilter): string[] {
  return pool.entries.filter((e) => f.types.includes(e.type) && (!f.regions.length || e.regions.some((r) => f.regions.includes(r)))).map((e) => e.key);
}

// ---- Leitner scheduling -------------------------------------------------------------------------------

export const BOX_COUNT = 5;
/**
 * Answers to wait before a card is due again, by box (index = box, 1..5). A miss drops the card to box 1,
 * so it returns after two other questions; a card that keeps being right drifts out to 100.
 * Measured in answered questions rather than days because a study session is short and a missed item
 * should come back within it.
 */
export const BOX_INTERVAL = [0, 2, 6, 15, 40, 100] as const;
/** Chance of preferring a due card over a new one when both exist. */
const DUE_BIAS = 0.7;

export interface Card { box: number; due: number; seen: number; right: number }
export interface Progress { v: 1; /** answers recorded so far (the scheduling clock) */ tick: number; cards: Record<string, Card> }

export const emptyProgress = (): Progress => ({ v: 1, tick: 0, cards: {} });

/** Record an answer: right moves up one box (max 5), wrong goes back to box 1. Pure. */
export function recordAnswer(p: Progress, key: string, correct: boolean): Progress {
  const tick = p.tick + 1;
  const prev = p.cards[key];
  const box = correct ? Math.min(BOX_COUNT, (prev?.box ?? 1) + 1) : 1;
  const card: Card = { box, due: tick + BOX_INTERVAL[box], seen: (prev?.seen ?? 0) + 1, right: (prev?.right ?? 0) + (correct ? 1 : 0) };
  return { v: 1, tick, cards: { ...p.cards, [key]: card } };
}

/** Which of `keys` to ask next: a due card (lowest box first) or a new one, else the soonest due. */
export function pickKey(keys: string[], p: Progress, rng: Rng, avoid?: string | null): string | null {
  const pool = keys.length > 1 ? keys.filter((k) => k !== avoid) : keys;
  if (!pool.length) return null;
  const due: string[] = [], fresh: string[] = [], later: string[] = [];
  for (const k of pool) {
    const c = p.cards[k];
    if (!c) fresh.push(k); else if (c.due <= p.tick) due.push(k); else later.push(k);
  }
  const byUrgency = (a: string, b: string) => p.cards[a].box - p.cards[b].box || p.cards[a].due - p.cards[b].due || a.localeCompare(b);
  if (due.length && (!fresh.length || rng() < DUE_BIAS)) return pickOne(due.sort(byUrgency).slice(0, 3), rng);
  if (fresh.length) return pickOne([...fresh].sort(), rng);
  return later.sort((a, b) => p.cards[a].due - p.cards[b].due || a.localeCompare(b))[0];
}

/** Next question for a filter, skipping keys the data cannot support. */
export function nextQuestion(pool: QuizPool, f: QuizFilter, p: Progress, rng: Rng, avoid?: string | null): Question | null {
  let keys = candidateKeys(pool, f);
  for (let tries = 0; tries < 12 && keys.length; tries++) {
    const key = pickKey(keys, p, rng, avoid);
    if (!key) return null;
    const q = makeQuestion(pool, key, rng, f.regions);
    if (q) return q;
    keys = keys.filter((k) => k !== key);
  }
  return null;
}

/** Box counts for the keys of a filter (index 0 = not seen yet). */
export function boxCounts(keys: string[], p: Progress): number[] {
  const out = new Array(BOX_COUNT + 1).fill(0);
  for (const k of keys) out[p.cards[k]?.box ?? 0]++;
  return out;
}

// ---- persistence --------------------------------------------------------------------------------------

export const PROGRESS_KEY = 'physio-atlas:quiz:v1';
export const PREFS_KEY = 'physio-atlas:quiz-prefs:v1';
const MAX_CARDS = 4000;

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** The browser's localStorage, or null where it is missing or throws (private windows, blocked site data). */
export function defaultStorage(): KV | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

const int = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null);

/** Parse stored progress; anything malformed is dropped. Never throws. */
export function parseProgress(raw: string | null): Progress {
  const out = emptyProgress();
  if (!raw) return out;
  try {
    const j = JSON.parse(raw) as { v?: unknown; tick?: unknown; cards?: unknown };
    if (!j || typeof j !== 'object' || j.v !== 1) return out;
    out.tick = int(j.tick, 0, 1e9) ?? 0;
    if (j.cards && typeof j.cards === 'object') {
      for (const [k, c] of Object.entries(j.cards as Record<string, Record<string, unknown>>).slice(0, MAX_CARDS)) {
        const box = int(c?.box, 1, BOX_COUNT), due = int(c?.due, 0, 2e9), seen = int(c?.seen, 0, 1e9), right = int(c?.right, 0, 1e9);
        if (box !== null && due !== null && seen !== null && right !== null && k.includes('|')) out.cards[k] = { box, due, seen, right: Math.min(right, seen) };
      }
    }
  } catch { return emptyProgress(); }
  return out;
}

export function loadProgress(store: KV | null = defaultStorage()): Progress {
  try { return parseProgress(store ? store.getItem(PROGRESS_KEY) : null); } catch { return emptyProgress(); }
}
export function saveProgress(p: Progress, store: KV | null = defaultStorage()): boolean {
  try { if (!store) return false; store.setItem(PROGRESS_KEY, JSON.stringify(p)); return true; } catch { return false; }
}
export function clearProgress(store: KV | null = defaultStorage()): boolean {
  try { if (!store) return false; store.removeItem(PROGRESS_KEY); return true; } catch { return false; }
}

export const DEFAULT_FILTER: QuizFilter = { types: DEFAULT_TYPES, regions: [] };

export function loadPrefs(store: KV | null = defaultStorage()): QuizFilter {
  try {
    const j = JSON.parse((store && store.getItem(PREFS_KEY)) || 'null') as { types?: unknown; regions?: unknown } | null;
    const types = Array.isArray(j?.types) ? QUESTION_TYPES.filter((t) => (j!.types as unknown[]).includes(t)) : [];
    const regions = Array.isArray(j?.regions) ? REGIONS.filter((r) => (j!.regions as unknown[]).includes(r)) : [];
    return { types: types.length ? types : DEFAULT_TYPES, regions: regions.length === REGIONS.length ? [] : regions };
  } catch { return DEFAULT_FILTER; }
}
export function savePrefs(f: QuizFilter, store: KV | null = defaultStorage()): boolean {
  try { if (!store) return false; store.setItem(PREFS_KEY, JSON.stringify(f)); return true; } catch { return false; }
}
