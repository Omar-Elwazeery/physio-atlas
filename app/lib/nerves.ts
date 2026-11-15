import { MUSCLE_INFO } from './data/muscles';

/**
 * Nerve supply derived from the `innervation` strings of the muscle data, and nothing else: no nerve or root is
 * added that a string does not name, except the few branch -> parent links in `NERVE_PARENT` below.
 * Pure (no React, DOM or three), so it can be tested and reused anywhere.
 *
 * Each string is parsed into
 *  - the named nerves it mentions, in order of appearance (`direct`), plus their parents (`nerves` holds both);
 *  - the spinal root levels of every range it quotes ("C5–C7" -> C5, C6, C7; en dash or hyphen). Roots belong to
 *    the muscle, not to one nerve: a string such as "Dorsal scapular nerve (C5) and C3–C4" gives the muscle C3-C5;
 *  - `minor` nerves: those the string itself qualifies as "sometimes" or "small".
 * "Anterior rami" and "Dorsal rami of spinal nerves" are segmental rather than a named nerve; they are kept as nerve
 * entries of kind 'rami' so that every muscle has at least one entry.
 */

export type NerveKind = 'peripheral' | 'cranial' | 'rami';
export interface NerveDef { id: string; label: string; kind: NerveKind }

const P = 'peripheral' as const, C = 'cranial' as const, R = 'rami' as const;
/** [id, label, kind, pattern found in an innervation string]. A nerve with no pattern is only ever reached as a parent. */
const NERVE_TABLE: [string, string, NerveKind, RegExp | null][] = [
  ['radial', 'Radial nerve', P, /\bradial nerve\b/i],
  ['posterior-interosseous', 'Posterior interosseous nerve', P, /\bposterior interosseous nerve\b/i],
  ['median', 'Median nerve', P, /\bmedian nerve\b/i],
  ['anterior-interosseous', 'Anterior interosseous nerve', P, /\banterior interosseous nerve\b/i],
  ['ulnar', 'Ulnar nerve', P, /\bulnar nerve\b/i],
  ['axillary', 'Axillary nerve', P, /\baxillary nerve\b/i],
  ['musculocutaneous', 'Musculocutaneous nerve', P, /\bmusculocutaneous nerve\b/i],
  ['suprascapular', 'Suprascapular nerve', P, /\bsuprascapular nerve\b/i],
  ['dorsal-scapular', 'Dorsal scapular nerve', P, /\bdorsal scapular nerve\b/i],
  ['long-thoracic', 'Long thoracic nerve', P, /\blong thoracic nerve\b/i],
  ['thoracodorsal', 'Thoracodorsal nerve', P, /\bthoracodorsal nerve\b/i],
  ['lateral-pectoral', 'Lateral pectoral nerve', P, /\blateral (?:and medial )?pectoral nerves?\b/i],
  ['medial-pectoral', 'Medial pectoral nerve', P, /\b(?:lateral and )?medial pectoral nerves?\b/i],
  ['upper-subscapular', 'Upper subscapular nerve', P, /\bupper (?:and lower )?subscapular nerves?\b/i],
  ['lower-subscapular', 'Lower subscapular nerve', P, /\b(?:upper and )?lower subscapular nerves?\b/i],
  ['nerve-to-subclavius', 'Nerve to subclavius', P, /\bnerve to subclavius\b/i],
  ['phrenic', 'Phrenic nerve', P, /\bphrenic nerve\b/i],
  ['ansa-cervicalis', 'Ansa cervicalis', P, /\bansa cervicalis\b/i],
  ['suboccipital', 'Suboccipital nerve', P, /\bsuboccipital nerve\b/i],
  ['intercostal', 'Intercostal nerves', P, /\bintercostal nerves?\b/i],
  ['subcostal', 'Subcostal nerve', P, /\bsubcostal(?: nerves?)?\b/i],
  ['thoracoabdominal', 'Thoracoabdominal nerves', P, /\bthoracoabdominal nerves?\b/i],
  ['iliohypogastric', 'Iliohypogastric nerve', P, /\biliohypogastric(?: nerves?)?\b/i],
  ['ilioinguinal', 'Ilioinguinal nerve', P, /\bilioinguinal(?: nerves?)?\b/i],
  ['femoral', 'Femoral nerve', P, /\bfemoral nerve\b/i],
  ['obturator', 'Obturator nerve', P, /\bobturator nerve\b/i],
  ['sciatic', 'Sciatic nerve', P, /\bsciatic nerve\b/i],
  ['tibial', 'Tibial nerve', P, /\btibial (?:nerve|division)\b/i],
  ['common-fibular', 'Common fibular nerve', P, /\bcommon fibular nerve\b/i],
  ['deep-fibular', 'Deep fibular nerve', P, /\bdeep fibular nerve\b/i],
  ['superficial-fibular', 'Superficial fibular nerve', P, /\bsuperficial fibular nerve\b/i],
  ['medial-plantar', 'Medial plantar nerve', P, /\bmedial plantar nerve\b/i],
  ['lateral-plantar', 'Lateral plantar nerve', P, /\blateral plantar nerve\b/i],
  ['superior-gluteal', 'Superior gluteal nerve', P, /\bsuperior gluteal nerve\b/i],
  ['inferior-gluteal', 'Inferior gluteal nerve', P, /\binferior gluteal nerve\b/i],
  ['nerve-to-piriformis', 'Nerve to piriformis', P, /\bnerve to piriformis\b/i],
  ['nerve-to-obturator-internus', 'Nerve to obturator internus', P, /\bnerve to obturator internus\b/i],
  ['nerve-to-quadratus-femoris', 'Nerve to quadratus femoris', P, /\bnerve to quadratus femoris\b/i],
  ['nerve-to-levator-ani', 'Nerve to levator ani', P, /\bnerve to levator ani\b/i],
  ['pudendal', 'Pudendal nerve', P, /\bpudendal nerve\b/i],
  ['accessory', 'Spinal accessory nerve (CN XI)', C, /\bspinal accessory nerve\b/i],
  ['facial', 'Facial nerve (CN VII)', C, /\bfacial nerve\b/i],
  ['hypoglossal', 'Hypoglossal nerve (CN XII)', C, /\bhypoglossal nerve\b/i],
  ['mandibular', 'Mandibular nerve (CN V3)', C, null],
  ['masseteric', 'Masseteric nerve', C, /\bmasseteric nerve\b/i],
  ['deep-temporal', 'Deep temporal nerves', C, /\bdeep temporal nerves?\b/i],
  ['mylohyoid', 'Mylohyoid nerve', C, /\bmylohyoid nerve\b/i],
  ['anterior-rami', 'Anterior rami of spinal nerves', R, /\banterior rami\b/i],
  ['dorsal-rami', 'Dorsal rami of spinal nerves', R, /\bdorsal rami\b/i],
];

export const NERVES: ReadonlyMap<string, NerveDef> = new Map(NERVE_TABLE.map(([id, label, kind]) => [id, { id, label, kind }]));

/**
 * Branch -> parent. Kept small and limited to textbook relationships: a muscle supplied by the branch is also
 * "supplied by the radial nerve" in the sense a student asks. Followed transitively (deep fibular -> common
 * fibular -> sciatic).
 */
export const NERVE_PARENT: Readonly<Record<string, string>> = {
  'posterior-interosseous': 'radial',
  'anterior-interosseous': 'median',
  'deep-fibular': 'common-fibular',
  'superficial-fibular': 'common-fibular',
  'common-fibular': 'sciatic',
  tibial: 'sciatic',
  'medial-plantar': 'tibial',
  'lateral-plantar': 'tibial',
  masseteric: 'mandibular',
  'deep-temporal': 'mandibular',
  mylohyoid: 'mandibular',
};

/** Spinal root levels in craniocaudal order. */
export const ROOT_ORDER: readonly string[] = [
  ...Array.from({ length: 8 }, (_, i) => `C${i + 1}`), ...Array.from({ length: 12 }, (_, i) => `T${i + 1}`),
  ...Array.from({ length: 5 }, (_, i) => `L${i + 1}`), ...Array.from({ length: 5 }, (_, i) => `S${i + 1}`),
];
const ROOT_AT = new Map(ROOT_ORDER.map((r, i) => [r, i]));

export interface Supply {
  /** Nerves named in the string, in order of appearance. */
  direct: string[];
  /** `direct` plus their ancestors from `NERVE_PARENT`. */
  nerves: string[];
  /** Spinal root levels in craniocaudal order; empty for cranial nerves and for strings that quote no range. */
  roots: string[];
  /**
   * Root levels the string marks as "(proprioception)" (a subset of `roots`): sensory supply from the cervical plexus
   * to a muscle whose motor nerve is the accessory nerve. Whether those roots also carry motor fibres is debated.
   */
  sensoryRoots: string[];
  /** Nerves the string qualifies as "sometimes" or "small" (a subset of `nerves`). */
  minor: string[];
  /** Anything that could not be parsed: unknown root, reversed range, or a "nerve" the table does not know. */
  issues: string[];
}

const ROOT_RE = /\b([CTLS])(\d{1,2})(?:\s*[–-]\s*([CTLS])?(\d{1,2}))?(?!\d)/g;
const MINOR_RE = /\b(?:sometimes|small)\b/i;
const SENSORY_RE = /^\s*\((?:proprioception|proprioceptive|sensory)\b/i;

export function parseInnervation(text: string): Supply {
  const issues: string[] = [];
  const hits: { id: string; at: number; end: number }[] = [];
  for (const [id, , , re] of NERVE_TABLE) {
    if (!re) continue;
    const m = re.exec(text);
    if (m) hits.push({ id, at: m.index, end: m.index + m[0].length });
  }
  hits.sort((a, b) => a.at - b.at);
  const direct = hits.map((h) => h.id);
  const nerves = [...direct];
  for (const id of direct) for (let p = NERVE_PARENT[id]; p && !nerves.includes(p); p = NERVE_PARENT[p]) nerves.push(p);

  const minor = hits.filter((h) => MINOR_RE.test(text.slice(h.end).split(/[;.]/)[0].slice(0, 40))).map((h) => h.id);

  const roots = new Set<number>(), sensory = new Set<number>(), motor = new Set<number>();
  for (const m of text.matchAll(ROOT_RE)) {
    const a = ROOT_AT.get(`${m[1]}${m[2]}`);
    const b = m[4] === undefined ? a : ROOT_AT.get(`${m[3] ?? m[1]}${m[4]}`);
    if (a === undefined || b === undefined || b < a) { issues.push(`root range "${m[0]}"`); continue; }
    const into = SENSORY_RE.test(text.slice(m.index + m[0].length)) ? sensory : motor;
    for (let i = a; i <= b; i++) { roots.add(i); into.add(i); }
  }

  // Anything that still reads like a nerve once the recognised ones are removed is a gap in the table.
  let rest = text;
  for (const [, , , re] of NERVE_TABLE) if (re) rest = rest.replace(new RegExp(re.source, 'gi'), ' ');
  if (/\bnerves?\b|\brami\b/i.test(rest.replace(/\bspinal nerves\b/gi, ' ').replace(/\bnerve to\b/gi, ' '))) issues.push(`unrecognised nerve in "${text}"`);
  if (!direct.length) issues.push(`no nerve in "${text}"`);

  const levels = (set: Set<number>) => [...set].sort((x, y) => x - y).map((i) => ROOT_ORDER[i]);
  return { direct, nerves, roots: levels(roots), sensoryRoots: levels(new Set([...sensory].filter((i) => !motor.has(i)))), minor, issues };
}

/** The nerves in `s.direct` through whose branch table the muscle also counts under `id` (empty when `id` is named directly). */
export function viaNerves(s: Supply, id: string): string[] {
  if (s.direct.includes(id)) return [];
  return s.direct.filter((d) => { for (let p = NERVE_PARENT[d]; p; p = NERVE_PARENT[p]) if (p === id) return true; return false; });
}

export interface NerveIndex {
  /** Nerve id -> muscle keys (direct and through the branch table), in data order. */
  nerves: Map<string, string[]>;
  /** Root level -> muscle keys whose quoted ranges include it. */
  roots: Map<string, string[]>;
  supply: Map<string, Supply>;
}

export function buildNerveIndex(info: Record<string, { innervation: string }>): NerveIndex {
  const nerves = new Map<string, string[]>(), roots = new Map<string, string[]>(), supply = new Map<string, Supply>();
  const add = (m: Map<string, string[]>, k: string, key: string) => { const l = m.get(k); if (l) l.push(key); else m.set(k, [key]); };
  for (const [key, mi] of Object.entries(info)) {
    const s = parseInnervation(mi.innervation);
    supply.set(key, s);
    for (const n of s.nerves) add(nerves, n, key);
    for (const r of s.roots) add(roots, r, key);
  }
  return { nerves, roots, supply };
}

/** The index of the real muscle data. */
export const NERVE_INDEX: NerveIndex = buildNerveIndex(MUSCLE_INFO);

export const supplyOf = (key: string, idx: NerveIndex = NERVE_INDEX): Supply | undefined => idx.supply.get(key);

/** Nerves that supply at least one muscle, grouped for a picker: cranial, spinal rami, then the rest, each A-Z. */
export function nerveOptions(idx: NerveIndex = NERVE_INDEX): (NerveDef & { count: number })[] {
  const rank: Record<NerveKind, number> = { peripheral: 0, cranial: 1, rami: 2 };
  return [...idx.nerves].map(([id, keys]) => ({ ...NERVES.get(id)!, count: keys.length }))
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.label.localeCompare(b.label));
}

/** Root levels that supply at least one muscle, craniocaudal. */
export const rootOptions = (idx: NerveIndex = NERVE_INDEX): { id: string; count: number }[] =>
  ROOT_ORDER.filter((r) => idx.roots.has(r)).map((id) => ({ id, count: idx.roots.get(id)!.length }));

/** A "show me everything this nerve / this root level supplies" filter. */
export interface NerveFilter { by: 'nerve' | 'root'; id: string }

export const sameFilter = (a: NerveFilter | null, b: NerveFilter | null) => a === b || (!!a && !!b && a.by === b.by && a.id === b.id);

/** Canonical form of a filter (root ids upper-cased), or null when it does not exist in the index. */
export function validFilter(f: { by: string; id: string } | null | undefined, idx: NerveIndex = NERVE_INDEX): NerveFilter | null {
  if (!f) return null;
  if (f.by === 'nerve') return idx.nerves.has(f.id) ? { by: 'nerve', id: f.id } : null;
  if (f.by === 'root') { const id = f.id.toUpperCase(); return idx.roots.has(id) ? { by: 'root', id } : null; }
  return null;
}

export const musclesOfFilter = (f: NerveFilter, idx: NerveIndex = NERVE_INDEX): string[] => (f.by === 'nerve' ? idx.nerves : idx.roots).get(f.id) ?? [];

export const filterLabel = (f: NerveFilter) => (f.by === 'nerve' ? NERVES.get(f.id)?.label ?? f.id : `Root level ${f.id}`);
