export type V3 = [number, number, number];
export type Side = 'l' | 'r' | 'm';
export type Kind = 'bone' | 'muscle' | 'disc' | 'cartilage';

/** Joint landmarks from the converter: end-slice centroids per axis (0 = low end, 1 = high end). */
export interface Landmarks {
  c: V3;
  x0: V3; x1: V3; y0: V3; y1: V3; z0: V3; z1: V3;
  y0w: V3; y1w: V3;
}

export interface ManifestPart { key: string; label: string; tris: number }

export interface Structure {
  id: string;
  key: string;
  kind: Kind;
  side: Side;
  label: string;
  group: string | null;
  parts: ManifestPart[];
  bbox: [V3, V3];
  lm: Landmarks;
  /** Generated shape for a structure BodyParts3D does not contain (drawn approximately). */
  schematic?: boolean;
}

/** How a structure is bound to the rig. */
export type Skin =
  | { mode: 'rigid'; bone: string }
  /** Muscle crossing joints: ordered rig bones from origin to insertion, blended around each joint. */
  | { mode: 'chain'; bones: string[] }
  /** Follows a column of segments, blended by height (spine, neck, discs, erectors). */
  | { mode: 'spine'; bones: string[] }
  /** Two bones blended along |x| (costal cartilages: rib at the lateral end, sternum medially). */
  | { mode: 'lateral'; lateral: string; medial: string };

export type Region = 'Upper limb' | 'Lower limb' | 'Trunk' | 'Head & neck';

export interface MuscleInfo {
  /** Compartment or functional group shown in the tree. */
  group: string;
  region: Region;
  origin: string;
  insertion: string;
  innervation: string;
  action: string;
  /** Rig bones from origin to insertion for the chain skin; omitted -> rigid on `carrier`. */
  chain?: string[];
  carrier?: string;
  spine?: string[];
  /** Short clinical pearl, optional. */
  note?: string;
}
