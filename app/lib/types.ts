import type { StrainLandmark, StrainObstacle, StrainPart } from './strain';

export type V3 = [number, number, number];
export type Side = 'l' | 'r' | 'm';
/**
 * Structure kinds. `cartilage` is costal cartilage (it predates the joint kinds); `articular` is articular (hyaline)
 * cartilage on a joint surface; `fibrocartilage` covers menisci, labra and the discs of joints other than the
 * intervertebral ones (`disc`). Per-kind labels, colours, layers and library tabs live in `kinds.ts`.
 * The soft tissue of the joints (Open 3D Model): `ligament` (also interosseous membranes), `capsule` (joint capsules
 * and the knee's synovial membrane), `bursa`, `sheath` (synovial tendon sheaths, fibrous digital sheaths),
 * `retinaculum`, `fascia` (deep fasciae, septa, the plantar and gluteal aponeuroses, the iliotibial tract), `fatpad`.
 */
export type Kind =
  | 'bone' | 'muscle' | 'disc' | 'cartilage' | 'articular' | 'fibrocartilage'
  | 'ligament' | 'capsule' | 'bursa' | 'sheath' | 'retinaculum' | 'fascia' | 'fatpad';

/** Joint landmarks from the converter: end-slice centroids per axis (0 = low end, 1 = high end). */
export interface Landmarks {
  c: V3;
  x0: V3; x1: V3; y0: V3; y1: V3; z0: V3; z1: V3;
  y0w: V3; y1w: V3;
}

export interface ManifestPart {
  key: string;
  label: string;
  tris: number;
  /** A tendon or aponeurosis drawn as part of its muscle (Open 3D Model muscles). */
  tendon?: boolean;
  /** Opacity of a see-through part (the bicipital aponeurosis, the extensor hoods), from the source material. */
  alpha?: number;
}

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
  /** Dataset the geometry comes from: Open 3D Model or BodyParts3D (absent in manifests built before the switch). */
  source?: 'o3d' | 'bp3d';
  /**
   * Bone structure ids this structure is fixed to. One id: it moves rigidly with that bone (articular cartilage,
   * menisci, labra, bursae). Discs list the vertebrae above and below, costal cartilage its rib (their skins are their
   * own). Ligaments and capsules list the bones they attach to, and sheaths, retinacula and fasciae the bones they lie
   * along: their vertices are blended between those bones by proximity (see rig/skinning.ts, mode 'attach').
   */
  attach?: string[];
  /**
   * Rig node ids of a proximity skin the model build baked into the mesh (vertex attributes JOINTS_0 / WEIGHTS_0
   * index this list): soft tissue blended across a joint. Absent: the viewer skins the structure itself.
   */
  skin?: string[];
  /**
   * Strain ends of a muscle whose skin the build baked: the bind-pose positions of the two attachment vertices (origin
   * side first) and the rig node ids of the bones they are measured on. The viewer takes them instead of the extreme
   * vertices skinStructure would pick (vertex indices do not survive the mesh compression, so positions are kept).
   */
  strainEnds?: { at: [V3, V3]; nodes: [string, string] };
  /**
   * Fits to an articular surface, made by the build for the rig (sphere: centre + radius; axis: two centres; on the
   * mandible, the two condyles).
   */
  fit?: {
    sphere?: [number, number, number, number]; axis?: [V3, V3]; radii?: [number, number];
    /** Sphere (centre + radius) fitted to the head of a digit bone only: the part of its cartilage at the next joint (spec HEAD_FITS). */
    head?: [number, number, number, number];
    /** Patellar track: the patella turns about `pivot` by `ratio` x the knee angle (fitted to stay on the femur). */
    track?: { pivot: V3; ratio: number };
  };
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
  /**
   * Muscle whose insertion end the length read-out uses instead of this muscle's own: for a muscle that inserts
   * through a tendon the model draws as part of another muscle (soleus through the calcaneal tendon of gastrocnemius,
   * the vasti through the quadriceps tendon of rectus femoris), so its length runs on to the bone.
   */
  strainVia?: string;
  /**
   * Rig node (without side) of a bone the muscle bends around, for the length read-out: the line runs origin, then the
   * point of that bone that touches the straight line at rest, then insertion. The quadriceps run over the patella;
   * without it the straight line cuts across the front of the knee and reads them shorter in flexion, when they are
   * stretched. Fixed to the bone, so it is a simple via point rather than a sliding wrap surface.
   */
  strainWrap?: string;
  /**
   * Wrap points placed on bone landmarks, in order from origin to insertion, for the length read-out (used instead of
   * `strainWrap`): where the tendon bends round a malleolus, a metatarsal head or the like, which no nearest-to-the-line
   * rule finds. Each landmark is found from the bone's own shape (see `StrainLandmark`), so no coordinates are stored.
   * An entry may instead be a wrapping surface (`StrainObstacle`: a sphere or cylinder round a joint centre), which the
   * line wraps over only where it would otherwise cut through it.
   */
  strainVias?: (StrainLandmark | StrainObstacle)[];
  /**
   * Origin end of the length line as a bone landmark, used instead of the end picked from the mesh where that one is
   * misplaced (the masseter's lies behind the jaw joint in the model) or stands for the wrong head of the muscle.
   */
  strainOrigin?: StrainLandmark;
  /** Insertion end of the length line as a bone landmark (see `strainOrigin`). */
  strainInsertion?: StrainLandmark;
  /**
   * A length line per part of the muscle (keys of the structure's parts), for muscles whose parts the movement table
   * gives different roles (the deltoid, pectoralis major). A table row that names a part is read on that part's line;
   * a row that names none, on the whole muscle's.
   */
  strainParts?: Record<string, StrainPart>;
  /** Short clinical pearl, optional. */
  note?: string;
  /** Ids (see `data/sources.ts`) of the references this entry was checked against. Absent = not yet checked. */
  refs?: string[];
  /** Who checked the entry against `refs`, and when (ISO date, e.g. 2026-03-14). */
  reviewed?: { by: string; date: string };
}
