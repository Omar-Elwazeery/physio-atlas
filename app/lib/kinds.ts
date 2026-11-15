import type { Kind } from './types';

/**
 * Muscle colour (sRGB), shared by the untextured BodyParts3D muscles and, as the mean of the fibre, the textured Open
 * 3D Model ones (see three/fibre.ts), so the two read as one tissue where they meet. The fibre texture's own mean is
 * #c37b6c; BodyParts3D muscles were #c15b4d before phase 2.
 */
export const MUSCLE_COLOR = 0xc0675a;

/**
 * Everything the interface needs to know per structure kind, in one table: the layer toggle that shows it, its
 * colour, the library tab it is listed under and the opacity slider that applies. Adding a kind means adding a row
 * here (and, for a new layer, a row in LAYERS). Several kinds may share a layer.
 */
export type LayerKey = 'bones' | 'muscles' | 'discs' | 'cartilage' | 'articular' | 'fibro' | 'ligaments' | 'capsules' | 'bursae' | 'retinacula' | 'fasciae';
export type LibraryTab = 'muscle' | 'bone' | 'joint';

export interface KindInfo {
  /** Singular name, as shown above the title of the info panel. */
  label: string;
  layer: LayerKey;
  /** Viewer colour (sRGB hex) of untextured meshes, and the base of the selection / role / quiz tints. */
  color: number;
  /** PBR roughness: articular cartilage is a smooth, slightly glossy layer. */
  roughness: number;
  /** Library tab, or null for kinds that are only shown on the model. */
  library: LibraryTab | null;
  /** Which opacity slider applies. */
  opacity: 'muscle' | 'bone';
  /**
   * Opacity of the kind's untextured meshes at full slider (bursae, synovial sheaths and fasciae are see-through
   * sacs and sheets, as in the source, where they are 17-30 % opaque; here a little more, to read on the page).
   * Textured meshes take their source opacity instead (`ManifestPart.alpha`, 1 when absent). Default 1.
   */
  alpha?: number;
}

export const KINDS: Record<Kind, KindInfo> = {
  bone: { label: 'Bone', layer: 'bones', color: 0xe4d8c2, roughness: 0.62, library: 'bone', opacity: 'bone' },
  muscle: { label: 'Muscle', layer: 'muscles', color: MUSCLE_COLOR, roughness: 0.62, library: 'muscle', opacity: 'muscle' },
  disc: { label: 'Intervertebral disc', layer: 'discs', color: 0x7fb1c4, roughness: 0.55, library: null, opacity: 'bone' },
  cartilage: { label: 'Costal cartilage', layer: 'cartilage', color: 0xa4c8d6, roughness: 0.5, library: null, opacity: 'bone' },
  articular: { label: 'Articular cartilage', layer: 'articular', color: 0xd3e5e7, roughness: 0.32, library: 'joint', opacity: 'bone' },
  fibrocartilage: { label: 'Fibrocartilage', layer: 'fibro', color: 0x9dbdb2, roughness: 0.48, library: 'joint', opacity: 'bone' },
  ligament: { label: 'Ligament', layer: 'ligaments', color: 0xe6e1d3, roughness: 0.5, library: 'joint', opacity: 'bone' },
  capsule: { label: 'Joint capsule', layer: 'capsules', color: 0xd8d0c0, roughness: 0.55, library: 'joint', opacity: 'bone', alpha: 0.55 },
  fatpad: { label: 'Fat pad', layer: 'capsules', color: 0xe9cf73, roughness: 0.6, library: 'joint', opacity: 'bone' },
  bursa: { label: 'Bursa', layer: 'bursae', color: 0x6fa8dc, roughness: 0.35, library: 'joint', opacity: 'bone', alpha: 0.5 },
  sheath: { label: 'Tendon sheath', layer: 'bursae', color: 0x7cb6e6, roughness: 0.35, library: 'joint', opacity: 'muscle', alpha: 0.38 },
  retinaculum: { label: 'Retinaculum', layer: 'retinacula', color: 0xe2ddd0, roughness: 0.5, library: 'joint', opacity: 'muscle', alpha: 0.75 },
  fascia: { label: 'Fascia', layer: 'fasciae', color: 0xd9d3c7, roughness: 0.55, library: 'joint', opacity: 'muscle', alpha: 0.28 },
};

export const KIND_LIST = Object.keys(KINDS) as Kind[];

/**
 * Layer toggles in the order the Explore panel shows them, and whether each is on when the atlas opens. Capsules,
 * bursae and sheaths, retinacula and fasciae start off: switched on, they wrap the joints and limbs and hide the
 * ligaments and muscles a first look is about (retinacula float over the wrist and ankle ligaments once the muscles
 * are hidden).
 */
export const LAYERS: { key: LayerKey; label: string; title: string; on: boolean }[] = [
  { key: 'bones', label: 'Skeleton', title: 'Bones', on: true },
  { key: 'muscles', label: 'Muscles', title: 'Muscles', on: true },
  { key: 'discs', label: 'Discs', title: 'Intervertebral discs', on: true },
  { key: 'cartilage', label: 'Costal cartilage', title: 'Costal cartilage', on: true },
  { key: 'articular', label: 'Joint cartilage', title: 'Articular cartilage on the joint surfaces', on: true },
  { key: 'fibro', label: 'Menisci & labra', title: 'Fibrocartilage: menisci, labra and joint discs', on: true },
  { key: 'ligaments', label: 'Ligaments', title: 'Ligaments and interosseous membranes', on: true },
  { key: 'retinacula', label: 'Retinacula', title: 'Retinacula: bands that hold the tendons down at the wrist, ankle and knee (off at first: with the muscles hidden they cover the wrist and ankle ligaments)', on: false },
  { key: 'capsules', label: 'Capsules', title: 'Joint capsules, the synovial membrane of the knee and the infrapatellar fat pad (off at first: they cover the ligaments)', on: false },
  { key: 'bursae', label: 'Bursae & sheaths', title: 'Bursae, synovial tendon sheaths and fibrous digital sheaths (off at first)', on: false },
  { key: 'fasciae', label: 'Fasciae', title: 'Deep fasciae, intermuscular septa, the iliotibial tract and the plantar and gluteal aponeuroses (off at first: they cover the muscles)', on: false },
];
export const LAYER_KEYS = LAYERS.map((l) => l.key);
/** Whether each layer is on when the atlas opens. */
export const LAYER_DEFAULTS = Object.fromEntries(LAYERS.map((l) => [l.key, l.on])) as Record<LayerKey, boolean>;

export const LIBRARY_TABS: { tab: LibraryTab; label: string }[] = [
  { tab: 'muscle', label: 'Muscles' },
  { tab: 'bone', label: 'Bones' },
  { tab: 'joint', label: 'Joints' },
];
