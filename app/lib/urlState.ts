import { DOFS, JOINTS, dofKey, type Dof } from './rig/spec';
import type { ActiveMove, Dir } from './roles';
import type { Region, Side } from './types';
import { DEFAULT_LAYERS, VIEW_IDS, type Layers, type Tab, type ViewId } from './atlasState';
import type { Pose } from './poseController';
import { validFilter, type NerveFilter } from './nerves';
import { LAYER_DEFAULTS, LAYER_KEYS } from './kinds';

/**
 * Deep-link encoding of the atlas state in the query string. Only non-default values are written:
 *
 *   ?s=supraspinatus-l                          selected structure id
 *   &tab=move                                   tab (explore is the default; `quiz` carries no `s`, so a link never names a question's answer)
 *   &pose=shoulder.abduction-adduction.l:90,elbow.flexion-extension.l:45
 *                                               non-zero joint angles, `<dofKey>:<degrees>`, comma separated
 *   &mv=shoulder.abduction-adduction.l:pos      active movement, `<dofKey>:<pos|neg>`
 *   &rom=60                                     restricted range of motion, percent of normal
 *   &view=back                                  camera preset (front is the default)
 *   &nerve=radial  or  &root=C5                 nerve-supply layer (Explore only): everything one nerve or root level supplies;
 *                                               validated against the nerve index, `nerve` wins if both are given
 *   &side=l  &off=bones,discs  &on=capsules  &reg=upper,lower  &iso=1  &mop=40  &bop=60
 *                                               side filter, layers switched off that are on by default (bones,
 *                                               muscles, discs, cartilage, articular, fibro, ligaments),
 *                                               layers switched on that are off by default (retinacula, capsules,
 *                                               bursae, fasciae), regions, isolate, opacities (%)
 *
 * Decoding validates everything against the manifest and the DOF table: unknown ids and keys are
 * dropped, numbers are clamped, and malformed input never throws.
 */

export interface UrlStateInput {
  selected: string | null;
  tab: Tab;
  pose: Pose;
  active: ActiveMove | null;
  restrict: number;
  view: ViewId;
  layers: Layers;
  nerve?: NerveFilter | null;
}

export interface UrlState {
  selected?: string;
  tab?: Tab;
  pose?: Pose;
  active?: ActiveMove;
  restrict?: number;
  view?: ViewId;
  layers?: Partial<Layers>;
  nerve?: NerveFilter;
}

const REGION_SLUG: Record<Region, string> = { 'Head & neck': 'head', Trunk: 'trunk', 'Upper limb': 'upper', 'Lower limb': 'lower' };
const SLUG_REGION = new Map(Object.entries(REGION_SLUG).map(([r, s]) => [s, r as Region]));

/** Every valid pose key, with its DOF and side. */
const DOF_KEYS: Map<string, { d: Dof; side: Side }> = new Map(
  DOFS.flatMap((d) => (d.paired ? (['l', 'r'] as const) : (['m'] as const)).map((side) => [dofKey(d, side), { d, side }] as const)),
);

/** Structure ids of older model builds that were renamed, so their links keep working. */
export const LEGACY_IDS: Record<string, string> = {
  // the BodyParts3D build called the T12-L1 disc plain "disc"
  disc: 'disc-twelfth-thoracic-vertebra',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
/** Like encodeURIComponent, but keeps the separators of this format readable. */
const enc = (s: string) => encodeURIComponent(s).replace(/%3A/gi, ':').replace(/%2C/gi, ',');
const num = (s: string | null): number | null => {
  if (s === null || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const pct = (v: number) => Math.round(v * 100);

export function encodeUrlState(st: UrlStateInput): string {
  const out: [string, string][] = [];
  if (st.selected && st.tab !== 'quiz') out.push(['s', st.selected]);
  if (st.tab !== 'explore') out.push(['tab', st.tab]);

  const pose: string[] = [];
  for (const [key] of DOF_KEYS) {
    const v = round1(st.pose[key] ?? 0);
    if (Number.isFinite(v) && v !== 0) pose.push(`${key}:${v}`);
  }
  if (pose.length) out.push(['pose', pose.join(',')]);

  if (st.active) {
    const d = DOFS.find((x) => x.joint === st.active!.joint && x.id === st.active!.dof);
    if (d) {
      const side: Side = d.paired ? (st.active.side === 'r' ? 'r' : 'l') : 'm';
      out.push(['mv', `${dofKey(d, side)}:${st.active.dir}`]);
    }
  }
  if (st.restrict < 0.995) out.push(['rom', String(pct(st.restrict))]);
  if (st.view !== 'front') out.push(['view', st.view]);

  if (st.nerve && st.tab === 'explore') out.push([st.nerve.by, st.nerve.id]); // like `s`, never written for a quiz; the layer only shows in Explore

  const l = st.layers;
  if (l.side !== 'both') out.push(['side', l.side]);
  const off = LAYER_KEYS.filter((k) => LAYER_DEFAULTS[k] && !l[k]);
  if (off.length) out.push(['off', off.join(',')]);
  const on = LAYER_KEYS.filter((k) => !LAYER_DEFAULTS[k] && l[k]);
  if (on.length) out.push(['on', on.join(',')]);
  if (l.regions) out.push(['reg', l.regions.length ? l.regions.map((r) => REGION_SLUG[r]).join(',') : 'none']);
  if (l.isolate) out.push(['iso', '1']);
  if (l.muscleOpacity < 0.995) out.push(['mop', String(pct(l.muscleOpacity))]);
  if (l.boneOpacity < 0.995) out.push(['bop', String(pct(l.boneOpacity))]);

  return out.map(([k, v]) => `${k}=${enc(v)}`).join('&');
}

/**
 * Parse and validate a query string. `isStructure` checks ids against the loaded manifest.
 * Returns only the fields that were present and valid.
 */
export function decodeUrlState(search: string, isStructure: (id: string) => boolean): UrlState {
  const res: UrlState = {};
  let p: URLSearchParams;
  try {
    if (search.length > 8000) return res;
    p = new URLSearchParams(search);
  } catch {
    return res;
  }
  const field = (name: string, fn: (v: string) => void) => {
    const v = p.get(name);
    if (v === null) return;
    try { fn(v); } catch { /* ignore this field */ }
  };

  field('s', (v) => { const id = LEGACY_IDS[v] ?? v; if (isStructure(id)) res.selected = id; });
  field('tab', (v) => { if (v === 'explore' || v === 'move' || v === 'quiz') res.tab = v; });
  if (res.tab === 'quiz') delete res.selected;

  field('pose', (v) => {
    const pose: Pose = {};
    for (const item of v.split(',').slice(0, DOF_KEYS.size * 2)) {
      const i = item.lastIndexOf(':');
      if (i <= 0) continue;
      const hit = DOF_KEYS.get(item.slice(0, i));
      const n = num(item.slice(i + 1));
      if (!hit || n === null) continue;
      pose[item.slice(0, i)] = clamp(n, hit.d.min, hit.d.max);
    }
    if (Object.keys(pose).length) res.pose = pose;
  });

  field('mv', (v) => {
    const i = v.lastIndexOf(':');
    const dir = v.slice(i + 1) as Dir;
    const hit = i > 0 ? DOF_KEYS.get(v.slice(0, i)) : undefined;
    if (!hit || (dir !== 'pos' && dir !== 'neg')) return;
    if (!JOINTS.some((j) => j.id === hit.d.joint)) return;
    res.active = { joint: hit.d.joint, dof: hit.d.id, dir, side: hit.side };
  });

  field('rom', (v) => {
    const n = num(v);
    if (n !== null) res.restrict = Math.round(clamp(n, 20, 100) / 5) * 5 / 100;
  });
  field('view', (v) => { if ((VIEW_IDS as readonly string[]).includes(v)) res.view = v as ViewId; });

  const nerve = (by: 'nerve' | 'root') => field(by, (v) => { if (!res.nerve) { const f = validFilter({ by, id: v }); if (f) res.nerve = f; } });
  nerve('nerve');
  nerve('root');
  if (res.tab === 'quiz') delete res.nerve;

  const layers: Partial<Layers> = {};
  field('side', (v) => { if (v === 'l' || v === 'r' || v === 'both') layers.side = v; });
  field('off', (v) => {
    const off = new Set(v.split(','));
    for (const k of LAYER_KEYS) if (off.has(k)) layers[k] = false;
  });
  field('on', (v) => {
    const on = new Set(v.split(','));
    for (const k of LAYER_KEYS) if (on.has(k) && layers[k] !== false) layers[k] = true;
  });
  field('reg', (v) => {
    if (v === 'none') { layers.regions = []; return; }
    const regions = [...new Set(v.split(',').map((s) => SLUG_REGION.get(s)).filter((r): r is Region => !!r))];
    if (regions.length) layers.regions = regions.length === SLUG_REGION.size ? null : regions;
  });
  field('iso', (v) => { if (v === '1') layers.isolate = true; });
  field('mop', (v) => { const n = num(v); if (n !== null) layers.muscleOpacity = clamp(n, 0, 100) / 100; });
  field('bop', (v) => { const n = num(v); if (n !== null) layers.boneOpacity = clamp(n, 0, 100) / 100; });
  if (Object.keys(layers).length) res.layers = { ...layers };

  return res;
}

/** Fold a decoded state over the defaults (handy for tests and for the copy-link round trip). */
export function withDefaults(u: UrlState): UrlStateInput {
  return {
    selected: u.selected ?? null, tab: u.tab ?? 'explore', pose: u.pose ?? {}, active: u.active ?? null,
    restrict: u.restrict ?? 1, view: u.view ?? 'front', layers: { ...DEFAULT_LAYERS, ...u.layers }, nerve: u.nerve ?? null,
  };
}
