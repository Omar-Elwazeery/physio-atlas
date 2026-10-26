import type { Kind, Region, Side, Structure } from './types';
import { muscleInfo } from './data/muscles';
import { structureRegion } from './three/viewer';

export interface CatalogItem {
  key: string;
  kind: Kind;
  label: string;
  region: Region;
  group: string;
  ids: Partial<Record<Side, string>>;
}

/** One item per anatomical name, with the left / right / midline structure ids. */
export function buildCatalog(structures: Iterable<Structure>): CatalogItem[] {
  const map = new Map<string, CatalogItem>();
  for (const s of structures) {
    if (s.kind === 'cartilage' || s.kind === 'disc') continue;
    const k = `${s.kind}:${s.key}`;
    let it = map.get(k);
    if (!it) {
      it = {
        key: s.key, kind: s.kind, label: s.label, region: structureRegion(s),
        group: s.kind === 'muscle' ? muscleInfo(s.key).group : groupName(s.group), ids: {},
      };
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
