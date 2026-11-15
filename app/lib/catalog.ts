import type { Kind, Region, Side, Structure } from './types';
import { muscleInfo } from './data/muscles';
import { structureRegion } from './three/viewer';
import { KINDS } from './kinds';
import { jointInfo } from './data/joints';
import { jointSubgroup, subgroupOrder } from './data/jointGroups';
import { fold, tokenize } from './search';

export interface CatalogItem {
  key: string;
  kind: Kind;
  label: string;
  region: Region;
  group: string;
  /** Sub-group within `group` for the Joints library (the joint, or the tissue kind): see data/jointGroups.ts. */
  sub?: string;
  ids: Partial<Record<Side, string>>;
}

/**
 * One item per anatomical name, with the left / right / midline structure ids. Kinds without a library tab
 * (`KINDS[kind].library === null`: intervertebral discs, costal cartilage) are only shown on the model.
 */
export function buildCatalog(structures: Iterable<Structure>): CatalogItem[] {
  const map = new Map<string, CatalogItem>();
  for (const s of structures) {
    if (!KINDS[s.kind].library) continue;
    const k = `${s.kind}:${s.key}`;
    let it = map.get(k);
    if (!it) {
      const joint = KINDS[s.kind].library === 'joint';
      const group = s.kind === 'muscle' ? muscleInfo(s.key).group : joint ? jointInfo(s).group : groupName(s.group);
      it = { key: s.key, kind: s.kind, label: s.label, region: structureRegion(s), group, ids: {} };
      if (joint) it.sub = jointSubgroup(group, s);
      map.set(k, it);
    }
    it.ids[s.side] = s.id;
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function groupName(g: string | null): string {
  if (!g) return 'Other';
  if (g.startsWith('digit-')) return 'Digits';
  const names: Record<string, string> = {
    skull: 'Skull', mandible: 'Skull', cervical: 'Vertebral column', thoracic: 'Vertebral column', lumbar: 'Vertebral column',
    pelvis: 'Pelvis', thorax: 'Thorax', neck: 'Skull', clavicle: 'Shoulder girdle', scapula: 'Shoulder girdle', humerus: 'Arm', radius: 'Forearm', ulna: 'Forearm',
    hand: 'Hand', femur: 'Thigh', patella: 'Knee', tibia: 'Leg', fibula: 'Leg', talus: 'Foot', foot: 'Foot',
  };
  return names[g] ?? 'Other';
}

export const REGIONS: Region[] = ['Head & neck', 'Trunk', 'Upper limb', 'Lower limb'];

export const preferredId = (it: CatalogItem): string => it.ids.l ?? it.ids.m ?? it.ids.r!;

/** A library group longer than this is listed as collapsible sub-groups; shorter ones stay one flat list. */
export const SUBGROUP_MIN = 30;

export interface LibrarySection {
  /** Sub-group name, or null for the single flat list of a short group. */
  label: string | null;
  items: CatalogItem[];
}

/**
 * The lists a library group is shown as. A short group, or one whose items all share a sub-group (muscles and bones
 * have none), is one unnamed list, as before; a long one is split by `CatalogItem.sub` in the order of
 * `subgroupOrder`. Items keep the order they come in.
 */
export function librarySections(group: string, items: CatalogItem[], min = SUBGROUP_MIN): LibrarySection[] {
  const flat: LibrarySection[] = [{ label: null, items }];
  if (items.length <= min) return flat;
  const by = new Map<string, CatalogItem[]>();
  for (const it of items) {
    const sub = it.sub ?? 'Other';
    if (!by.has(sub)) by.set(sub, []);
    by.get(sub)!.push(it);
  }
  if (by.size < 2) return flat;
  const order = subgroupOrder(group);
  const rank = (label: string) => { const i = order.indexOf(label); return i < 0 ? order.length : i; };
  return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([label, list]) => ({ label, items: list }));
}

/**
 * Items whose name contains every word of `query` (case and accents ignored; a word may also match the sub-group,
 * so "subtalar" or "mcp" list that joint). An empty query returns null: no filter.
 */
export function filterItems(items: CatalogItem[], query: string): CatalogItem[] | null {
  const tokens = tokenize(query);
  if (!tokens.length) return null;
  return items.filter((it) => {
    const hay = fold(`${it.label} ${it.sub ?? ''}`);
    return tokens.every((t) => hay.includes(t));
  });
}
