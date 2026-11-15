import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import gsap from 'gsap';
import type { Kind, Region, Structure } from '../types';
import { Rig } from '../rig/rig';
import { bakedEnds, resolveSkin, skinStructure, type StructureSkin } from '../rig/skinning';
import { BoneProximity } from '../rig/proximity';
import { hasMuscleInfo, muscleInfo } from '../data/muscles';
import type { Role } from '../data/actions';
import { resolveEnds, resolvePart, resolveVias, strainPathLength, type StrainPath, type ViaSource } from '../strain';
import { MatrixStamp, SkinBounds } from './skinBounds';
import { computeSeamlessNormals } from './normals';
import { FIBRE_TEXELS_PER_M, atlasSizeFor } from './fibre';
import { MaterialPool, type Surface } from './materials';
import { softwareRendering } from './gpu';
import { KINDS, KIND_LIST, type LayerKey } from '../kinds';
import { jointInfo } from '../data/joints';

export interface VisState extends Record<LayerKey, boolean> {
  side: 'both' | 'l' | 'r';
  /** null = all regions */
  regions: Region[] | null;
  muscleOpacity: number;
  boneOpacity: number;
  /** Hide everything except the selected structure (others become faint ghosts). */
  isolate: boolean;
  hidden: Set<string>;
}

export interface Callbacks {
  onHover?: (id: string | null, x: number, y: number) => void;
  onSelect?: (id: string | null) => void;
  /** The second-stage structures (ligaments, capsules, bursae...) are now in the scene. */
  onExtras?: () => void;
}

/** Second-stage file and the kinds it holds (see Viewer.loadExtras). */
const EXTRA_FILE = '/models/ligaments.glb';
const EXTRA_KINDS = new Set<Kind>(['ligament', 'capsule', 'bursa', 'sheath', 'retinaculum', 'fascia', 'fatpad']);
/** Kinds drawn as the faint skeleton around a snapshot's subject. */
const GHOST_KINDS = new Set<Kind>(['bone', 'disc', 'cartilage', 'articular', 'fibrocartilage']);

export interface SnapshotSpec {
  ids: string[];
  size: number;
  /** Degrees around the vertical axis; 0 = seen from the front. */
  yaw: number;
  pitch: number;
  fit: 'subject' | 'body';
  /** Faint skeleton around the subject. */
  ghost?: 'none' | 'bones';
  ghostOpacity?: number;
  /** Paint the subject in the highlight colour instead of its natural colour. */
  highlight?: boolean;
  /** View from behind. */
  back?: boolean;
}

export type PaletteName = 'default' | 'cvd';

/**
 * Muscle-role colours. `cvd` uses the Okabe & Ito (2008) colour-blind-safe set: vermillion, orange, reddish purple
 * and blue. Under deuteranopia and protanopia they become dark ochre, light yellow, pale lilac-grey and saturated
 * blue, which stay apart in lightness as well as hue, and all of them read on the cream background.
 */
export const ROLE_PALETTES: Record<PaletteName, Record<Role, number>> = {
  default: { prime: 0xe0453a, assist: 0xf0902f, stab: 0xe3b72b, antagonist: 0x4a7fd1 },
  cvd: { prime: 0xd55e00, assist: 0xe69f00, stab: 0xcc79a7, antagonist: 0x0072b2 },
};
/** The default palette, kept for existing imports. */
export const ROLE_COLOR: Record<Role, number> = ROLE_PALETTES.default;
/** Nerve-layer highlight: a teal that is neither a movement-role colour nor the selection violet. */
export const HIGHLIGHT_COLOR = 0x1f9d8f;
/** Bone normal maps (Open 3D Model) are tangent-space maps in glTF's convention, used without tangents. */
const NORMAL_SCALE = 0.9;
/**
 * Normal-map texels per metre of bone (bounding-box diagonal). The source gives every bone a 512 or 1024 px map, a
 * tooth as much as a femur; on the GPU that is ~370 MB. Maps are scaled down on load to this density (powers of two,
 * at least 128 px, never up), which keeps the long bones and the skull at full size and cuts the GPU memory to ~1/3.
 */
const NORMAL_TEXELS_PER_M = 4000;

/** Scales a texture's image down to `size` px (square) on a canvas; the pixel layout (and so flipY) is unchanged. */
function shrinkTexture(tex: THREE.Texture, size: number) {
  const img = tex.image as { width: number; height: number } & CanvasImageSource;
  if (!img || img.width <= size || typeof document === 'undefined') return;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, size, size);
  (img as Partial<ImageBitmap>).close?.();
  tex.image = c;
  tex.needsUpdate = true;
}

const BONE_REGION: Record<string, Region> = {
  skull: 'Head & neck', mandible: 'Head & neck', cervical: 'Head & neck', neck: 'Head & neck',
  thoracic: 'Trunk', lumbar: 'Trunk', spine: 'Trunk', thorax: 'Trunk', pelvis: 'Trunk',
  clavicle: 'Upper limb', scapula: 'Upper limb', humerus: 'Upper limb', radius: 'Upper limb', ulna: 'Upper limb', hand: 'Upper limb',
  femur: 'Lower limb', patella: 'Lower limb', tibia: 'Lower limb', fibula: 'Lower limb', talus: 'Lower limb', foot: 'Lower limb',
};
/** Region of a joint-surface group (the hip joint is lower limb even though the acetabulum is on the pelvis). */
const JOINT_GROUP_REGION: Record<string, Region> = {
  'Shoulder girdle': 'Upper limb', Elbow: 'Upper limb', 'Wrist & hand': 'Upper limb', Hip: 'Lower limb', Knee: 'Lower limb', 'Ankle & foot': 'Lower limb',
  Thorax: 'Trunk', Pelvis: 'Trunk', 'Fasciae of upper limb': 'Upper limb', 'Fasciae of lower limb': 'Lower limb',
};
export const structureRegion = (s: Structure): Region => {
  if (s.kind === 'muscle') return muscleInfo(s.key).region;
  if (KINDS[s.kind].library === 'joint') { const r = JOINT_GROUP_REGION[jointInfo(s).group]; if (r) return r; }
  const g = s.group ?? '';
  if (g.startsWith('digit-')) return /thumb|index|middle|ring|little/.test(g) ? 'Upper limb' : 'Lower limb';
  return BONE_REGION[g] ?? 'Trunk';
};

/**
 * Cell size (metres) of the bone-distance grid the muscles are skinned with at load. The distances it returns do not
 * depend on it, only the time: the tendon search reaches 15 mm (R1 in rig/skinning.ts), which is one ring of 15 mm
 * cells (27 look-ups per query) instead of two rings of the default 10 mm cells (125), most of them empty. Measured:
 * 230 ms less in `build`, with identical skin weights and strain ends (.cache/perf/hash.mjs).
 */
const PROXIMITY_CELL = 0.015;

interface Entry {
  s: Structure;
  meshes: THREE.SkinnedMesh[];
  /** Strain read-out: the bind-pose position of an end vertex per end (`e0`, `e1`), the rig bones they are bound to. */
  strain?: { e0: THREE.Vector3; e1: THREE.Vector3; b0: number; b1: number; rest: number; p0?: THREE.Vector3; p1?: THREE.Vector3; vias?: StrainPath['vias']; parts?: Record<string, { path: StrainPath; rest: number }> };
}

/** Pick-buffer pixels per CSS pixel. 1 gives the same precision as the old per-pixel pick (half-res on 2x screens). */
const PICK_SCALE = 1;
const MAX_PICK_PIXELS = 2_400_000;
/** Minimum spacing of hover updates sent to the app (the last position is always delivered). */
const HOVER_MS = 45;
const KEY_ROTATE = THREE.MathUtils.degToRad(7.5);
const KEY_PAN_PX = 40;
const KEY_ZOOM = 1.15;

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
/** A promise that never settles: what `load()` hands back once the viewer has been disposed. */
const halt = <T,>() => new Promise<T>(() => {});
/** User-timing marks of the load phases (visible in the browser's performance panel; see .cache/perf/load.mjs). */
const mark = (name: string) => { if (typeof performance !== 'undefined') performance.mark?.(`physio:${name}`); };

async function fetchBuffer(url: string, signal: AbortSignal, onProgress: (f: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    onProgress(1);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    onProgress(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  onProgress(1);
  return out.buffer;
}

function disposeGltf(gltfs: GLTF[]) {
  for (const g of gltfs) {
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mt of Array.isArray(m.material) ? m.material : [m.material]) mt.dispose();
    });
  }
}

/**
 * A skin the model build baked (Structure.skin): the vertices' JOINTS_0 index the structure's list of rig node ids;
 * rewritten to this rig's bone indices.
 */
function applyBakedSkin(s: Structure, nodes: string[], geoms: THREE.BufferGeometry[], rig: Rig): StructureSkin {
  const bones = nodes.map((id) => rig.node(id).index);
  for (const g of geoms) {
    const src = g.getAttribute('skinIndex');
    const idx = new Uint16Array(src.count * 4);
    for (let i = 0; i < idx.length; i++) idx[i] = bones[(src.array as ArrayLike<number>)[i]] ?? bones[0];
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  }
  const e = s.strainEnds;
  return e ? bakedEnds(e, rig) : {};
}

/** Sets opacity and the flags that go with it, recompiling only when transparency actually flips. */
function setOpacity(mat: THREE.Material, o: number) {
  const t = o < 1;
  if (mat.transparent !== t) { mat.transparent = t; mat.needsUpdate = true; }
  mat.opacity = o;
  mat.depthWrite = !t;
}

/**
 * Whether the canvas is multisampled: where a GPU draws it, not where the browser falls back to a software rasteriser
 * (SwiftShader, WARP, llvmpipe). There the 4x multisampling is most of the frame: with every layer on, a frame takes
 * about 600 ms with it and 190 ms without (headless Chrome, SwiftShader), at the price of jagged edges. `?msaa=1` or
 * `?msaa=0` in the page address forces it either way (for screenshots taken in a headless browser).
 */
function wantMultisampling(): boolean {
  const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('msaa') : null;
  if (forced === '1' || forced === '0') return forced === '1';
  return !softwareRendering();
}

export class Viewer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.05, 30);
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  rig!: Rig;
  structures = new Map<string, Structure>();
  private entries = new Map<string, Entry>();
  private pickables: THREE.SkinnedMesh[] = [];
  private dirty = true;
  private raf = 0;
  private disposed = false;
  private selected: string | null = null;
  private hovered: string | null = null;
  private roles = new Map<string, Role>();
  /** Muscles coloured as a group (nerve layer); the other muscles are ghosted. Ignored while `roles` are shown. */
  private highlight: Set<string> | null = null;
  private palette: PaletteName = 'default';
  private vis: VisState | null = null;
  private down: { x: number; y: number } | null = null;
  private ro: ResizeObserver;
  private tween: gsap.core.Tween | null = null;
  private angles: Record<string, number> = {};
  private snapRT = new Map<number, THREE.WebGLRenderTarget>();
  private snapMats: { kind: Record<Kind, THREE.MeshStandardMaterial>; highlight: THREE.MeshStandardMaterial; ghost: THREE.MeshStandardMaterial } | null = null;
  /** Canvas size in CSS pixels, as last given to the renderer. */
  private size = { w: 1, h: 1 };
  private prevTabIndex: string | null;

  // Loading.
  private abort = new AbortController();
  private loading: Promise<void> | null = null;

  /** Shared materials of the meshes (see materials.ts). */
  private pool = new MaterialPool();
  /** Settles when the first frame with the models in it has been drawn. */
  private painted: Promise<void>;
  private markPainted: (() => void) | null = null;

  /** Second-stage files (ligaments.glb): settles when they are in the scene, or failed. */
  private extras: Promise<void> = new Promise(() => {});
  private extrasDone = false;
  /** Base-colour atlases by texture name, for files that name one instead of storing it. */
  private atlases = new Map<string, THREE.Texture>();
  private prox: BoneProximity | null = null;

  // Culling and pose tracking.
  private bounds: SkinBounds | null = null;
  private boneWorlds: THREE.Matrix4[] = [];
  private camMats: THREE.Matrix4[];

  // Picking (see the picking section below).
  private pickRT = new THREE.WebGLRenderTarget(1, 1, { colorSpace: THREE.NoColorSpace });
  private pickData: Uint8Array = new Uint8Array(4);
  private pickValid = false;
  private pickInFlight = false;
  private pickSeq = 0;
  /** Size of the grid `pickData` holds (the render target may already have been resized for the next one). */
  private pickW = 0;
  private pickH = 0;
  /** Bumped whenever the set of pickable meshes changes. */
  private pickVersion = 0;
  private pickDrawnVersion = -1;
  private pickCam = new MatrixStamp();
  private pickPose = new MatrixStamp();
  /** State seen by the previous pick request that found the buffer stale. */
  private reqCam = new MatrixStamp();
  private reqPose = new MatrixStamp();
  private reqVersion = -1;
  private reqW = 0;
  private reqH = 0;
  private pointRT = new THREE.WebGLRenderTarget(1, 1, { colorSpace: THREE.NoColorSpace });
  private pointBuf = new Uint8Array(4);
  private pickSavedMat: (THREE.Material | THREE.Material[])[] = [];
  private pickSavedVis: boolean[] = [];
  private clearTmp = new THREE.Color();

  // Hover throttling (with a trailing update so the last pointer position is always resolved).
  private lastHoverAt = -Infinity;
  private hoverTimer = 0;
  private hoverPos: { x: number; y: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private cb: Callbacks = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: wantMultisampling(), alpha: true });
    // A previous viewer on the same canvas (React StrictMode remount) leaves its GL context behind; start from a
    // known state rather than whatever it had bound.
    this.renderer.resetState();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, 0.95, 4.3);
    this.camMats = [this.camera.matrixWorld, this.camera.projectionMatrix];
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.88, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.25;
    this.controls.maxDistance = 8;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.invalidate());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x1c2230, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(2, 3.5, 4); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd0ff, 1.0); fill.position.set(-3, 1.5, 1.5); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.2); rim.position.set(0, 2, -4); this.scene.add(rim);
    // Nothing in the scene moves except the rig's bones (updated in syncPose) and the camera (updated by the renderer):
    // the lights and the meshes get their world matrices once, here and in addGltfs, rather than on every frame.
    this.scene.matrixWorldAutoUpdate = false;
    this.scene.updateMatrixWorld(true);
    this.painted = new Promise((resolve) => { this.markPainted = resolve; });

    // Keyboard access: the canvas takes focus in the tab order unless the page already set a tabindex.
    this.prevTabIndex = canvas.getAttribute('tabindex');
    if (this.prevTabIndex === null) canvas.tabIndex = 0;

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('keydown', this.onKey);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const moved = this.controls.update();
      if (this.dirty || moved) {
        this.dirty = false;
        this.syncPose();
        const first = this.markPainted && this.entries.size;
        if (first) mark('first-frame-start');
        this.renderer.render(this.scene, this.camera);
        if (first) { mark('first-frame'); this.markPainted?.(); this.markPainted = null; }
      }
    };
    loop();
  }

  invalidate() { this.dirty = true; }

  private resize() {
    if (this.disposed) return;
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  // ---- loading -------------------------------------------------------------------------------------
  /**
   * Fetches and binds the models. Calling it again returns the same promise. If the viewer is disposed before
   * loading finishes, the downloads are aborted and the returned promise never settles, so neither `then` nor
   * `catch` handlers of a torn-down caller run (e.g. a React effect cleaned up by StrictMode).
   */
  load(onProgress?: (p: number) => void): Promise<void> {
    if (this.disposed) return halt();
    // A failed load may be retried; a pending or finished one is shared.
    this.loading ??= this.loadModels(onProgress).catch((e) => { this.loading = null; throw e; });
    return this.loading;
  }

  private async loadModels(onProgress?: (p: number) => void): Promise<void> {
    const signal = this.abort.signal;
    try {
      const res = await fetch('/models/structures.json', { signal });
      if (!res.ok) throw new Error(`Could not load the structure list (HTTP ${res.status})`);
      const manifest: Structure[] = await res.json();
      mark('manifest');
      if (this.disposed) return halt();

      // The shader programs compile in the background while the models download and decode, and are bound by drawing
      // their stand-ins once, unless the models got here first (see MaterialPool.warm).
      void this.pool.warm(this.renderer, this.scene, this.camera).then((standIns) => {
        if (this.disposed || this.entries.size) return;
        this.scene.add(standIns);
        this.renderer.render(this.scene, this.camera);
        this.scene.remove(standIns);
        mark('programs');
      });
      const files = ['/models/skeleton.glb', '/models/joints.glb', '/models/muscles.glb'];
      // Ligaments, capsules, bursae, sheaths, retinacula and fasciae come after the first paint (see loadExtras); the
      // download starts now, alongside the others, but nothing waits for it.
      const extra = manifest.some((s) => EXTRA_KINDS.has(s.kind)) ? fetchBuffer(EXTRA_FILE, signal, () => {}) : null;
      extra?.catch(() => {});
      const progress = files.map(() => 0);
      const report = () => { if (!this.disposed) onProgress?.(progress.reduce((a, b) => a + b, 0) / files.length); };
      // One decoder for both stages, fetched and compiled alongside the models rather than after them. Each file is
      // decoded as soon as it has arrived, while the others are still downloading.
      const draco = new DRACOLoader().setDecoderPath('/draco/');
      draco.preload();
      const loader = new GLTFLoader().setDRACOLoader(draco);
      const settled = await Promise.allSettled(files.map(async (f, i) =>
        loader.parseAsync(await fetchBuffer(f, signal, (p) => { progress[i] = p; report(); }), '/models/')));
      const gltfs = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed || this.disposed) {
        // Released here, after every decode settled, so a dispose() mid-decode cannot strand a worker task.
        draco.dispose();
        disposeGltf(gltfs);
        if (this.disposed) return halt();
        throw failed!.reason;
      }
      mark('parsed');
      try {
        this.build(new Map(manifest.map((s) => [s.id, s])), gltfs);
      } catch (e) {
        draco.dispose();
        throw e;
      }
      mark('built');
      if (extra) this.extras = this.loadExtras(extra, loader, draco);
      else { draco.dispose(); this.extras = Promise.resolve(); }
      this.extras.then(() => { this.extrasDone = true; });
    } catch (e) {
      if (this.disposed) return halt();
      throw e;
    }
  }

  /**
   * Second stage: the soft tissue of the joints (ligaments.glb), added to the running scene once it has downloaded and
   * decoded, so the bones and muscles are on screen first. A failure leaves the atlas without these layers.
   */
  private async loadExtras(buffer: Promise<ArrayBuffer>, loader: GLTFLoader, draco: DRACOLoader): Promise<void> {
    let gltf: GLTF | null = null;
    try {
      const buf = await buffer;
      if (this.disposed) return;
      gltf = await loader.parseAsync(buf, '/models/');
    } catch (e) {
      if (!this.disposed) console.warn('Physio Atlas: the ligament layers could not be loaded.', e);
      return;
    } finally {
      draco.dispose();
    }
    if (this.disposed) { disposeGltf([gltf]); return; }
    this.addGltfs([gltf]);
    mark('extras');
    this.pickVersion++;
    this.refresh();
    this.invalidate();
    this.cb.onExtras?.();
  }

  /** Resolves once the meshes of structure `id` are in the scene (at once for the first-stage files). */
  /** Whether the second-stage files have been added (or have failed). */
  get complete(): boolean { return this.extrasDone; }

  /** Resolves once the first frame showing the models has been drawn (never, if the viewer is disposed before). */
  whenPainted(): Promise<void> { return this.painted; }

  whenLoaded(id: string): Promise<void> {
    return this.entries.has(id) || this.extrasDone ? Promise.resolve() : this.extras;
  }

  private build(structures: Map<string, Structure>, gltfs: GLTF[]) {
    this.structures = structures;
    const rig = (this.rig = new Rig(structures));
    this.scene.add(rig.root);
    this.bounds = new SkinBounds(rig.skeleton);
    this.boneWorlds = rig.bones.map((b) => b.matrixWorld);
    // Bone vertices per rig node, for tendons that follow the digits, the foot and the patella (see skinParts) and for
    // the proximity skin of ligaments and capsules (skinAttach). The skeleton file comes first, so the bones are in
    // `entries` before any muscle asks.
    this.prox = new BoneProximity((node) => (this.rig.nodes.get(this.rig.bones[node].name)?.carries ?? [])
      .flatMap((sid) => (this.entries.get(sid)?.meshes ?? []).map((m) => m.geometry.getAttribute('position').array)), PROXIMITY_CELL);
    this.addGltfs(gltfs);
    rig.pose({});
    // A muscle that inserts through a tendon drawn as part of another muscle measures its length through that tendon
    // to the bone (MuscleInfo.strainVia): its insertion end is the other muscle's.
    for (const e of this.entries.values()) {
      const via = e.strain && e.s.kind === 'muscle' && hasMuscleInfo(e.s.key) ? muscleInfo(e.s.key).strainVia : undefined;
      const v = via ? this.entries.get(e.s.side === 'm' ? via : `${via}-${e.s.side}`)?.strain : undefined;
      if (e.strain && v) Object.assign(e.strain, { e1: v.e1, b1: v.b1 });
    }
    for (const e of this.entries.values()) {
      if (!e.strain) continue;
      this.snapEnds(e.strain);
      this.addWrap(e);
      e.strain.rest = this.endDistance(e.strain);
      for (const p of Object.values(e.strain.parts ?? {})) p.rest = this.pathLength(p.path);
    }
    if (Object.keys(this.angles).length) rig.pose(this.angles);
    this.syncPose();
    this.pickVersion++;
    this.refresh();
    this.invalidate();
  }

  /** Turns the structures of loaded glTF files into skinned meshes bound to the rig. */
  private addGltfs(gltfs: GLTF[]) {
    const { rig, structures, prox } = this;
    const bounds = this.bounds!;
    const mapSize = new Map<THREE.Texture, number>();
    for (const gltf of gltfs) {
      for (const grp of gltf.scene.children) {
        const id = grp.userData.id as string | undefined;
        const s = id ? structures.get(id) : undefined;
        if (!s) continue;
        const entry: Entry = { s, meshes: [] };
        const spec = resolveSkin(s, rig, s.kind === 'muscle' && hasMuscleInfo(s.key) ? muscleInfo(s.key) : undefined);
        const children = grp.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);
        const geoms = children.map((m) => m.geometry as THREE.BufferGeometry);
        // Models built with baked normals ship them. Textured meshes repeat vertices along UV seams, so their
        // normals are computed across the seams; the others are welded already.
        for (const geom of geoms) if (!geom.getAttribute('normal')) { if (geom.getAttribute('uv')) computeSeamlessNormals(geom); else geom.computeVertexNormals(); }
        const res = s.skin && geoms.every((g) => g.getAttribute('skinIndex') && g.getAttribute('skinWeight'))
          ? applyBakedSkin(s, s.skin, geoms, rig)
          : skinStructure(s, geoms, spec, rig, prox ?? undefined);
        children.forEach((m, partIndex) => {
          const geom = geoms[partIndex];
          const k = KINDS[s.kind];
          const src = m.material as THREE.MeshStandardMaterial;
          // A muscle atlas this file names rather than stores (ligaments.glb, see the model build): the one already loaded.
          const map = src.map ?? (typeof src.userData.map === 'string' ? this.atlases.get(src.userData.map) : undefined) ?? null;
          if (src.map?.name) this.atlases.set(src.map.name, src.map);
          const textured = !!(map && geom.getAttribute('uv'));
          const part = s.parts.find((p) => p.key === (m.userData.part ?? 'main'));
          const alpha = part?.alpha ?? (textured ? 1 : k.alpha ?? 1);
          // Closed see-through sacs (bursae, sheaths, capsules) show their outer surface only: drawing the inside too
          // would blend two layers in an order that flickers as the view turns. Fasciae are open sheets: both sides.
          const side = alpha < 1 && s.kind !== 'fascia' && s.kind !== 'muscle' ? THREE.FrontSide : THREE.DoubleSide;
          const nmap = src.normalMap && geom.getAttribute('uv') ? src.normalMap : null;
          if (nmap) {
            const diag = Math.hypot(...s.bbox[1].map((x, i) => x - s.bbox[0][i]));
            mapSize.set(nmap, Math.max(mapSize.get(nmap) ?? 0, diag * NORMAL_TEXELS_PER_M));
          }
          // Fibre atlases are shared by many muscles: keep the size the most demanding mesh needs (see fibre.ts). The fibre
          // runs along the muscle, so anisotropic filtering keeps it from blurring where the surface turns away.
          if (textured) map!.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
          if (src.map && textured) mapSize.set(src.map, Math.max(mapSize.get(src.map) ?? 0, atlasSizeFor(geom, FIBRE_TEXELS_PER_M)));
          const surface = this.pool.surface(k.roughness, textured ? map : null, nmap, NORMAL_SCALE, side);
          const sm = new THREE.SkinnedMesh(geom);
          sm.userData = { id: s.id, part: m.userData.part ?? 'main', pickable: true, alpha, surface };
          // Until the first refresh: the kind's own colour (a fibre texture shows its natural colours under white).
          this.pool.apply(sm, surface, { color: textured ? 0xffffff : k.color, tinted: false, emissive: 0, emissiveIntensity: 0, opacity: alpha });
          sm.bind(rig.skeleton, new THREE.Matrix4());
          bounds.add(sm);
          this.scene.add(sm);
          // The scene does not update world matrices per frame (see the constructor); a mesh never moves.
          sm.updateMatrixWorld(true);
          entry.meshes.push(sm);
          this.pickables.push(sm);
          const n = this.pickables.length;
          sm.userData.pickIndex = n;
          sm.userData.pickMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setRGB((n & 255) / 255, ((n >> 8) & 255) / 255, ((n >> 16) & 255) / 255, THREE.LinearSRGBColorSpace),
            toneMapped: false, side: THREE.DoubleSide,
          });
        });
        if (res.endBones && (res.ends || res.endPoints)) {
          const [e0, e1] = res.endPoints ?? res.ends!.map((e) => new THREE.Vector3().fromBufferAttribute(geoms[e.part].getAttribute('position'), e.v));
          entry.strain = { e0, e1, b0: res.endBones[0], b1: res.endBones[1], rest: 0 };
        }
        this.entries.set(s.id, entry);
      }
    }
    for (const [tex, want] of mapSize) shrinkTexture(tex, Math.max(128, 2 ** Math.ceil(Math.log2(want))));
    // The source meshes' own materials were never used.
    for (const gltf of gltfs) gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) for (const mt of Array.isArray(m.material) ? m.material : [m.material]) mt.dispose();
    });
  }

  /** Bind-pose position of the bone vertex nearest to `from`, among the bones a rig node carries. */
  private nearestOnBone(boneIndex: number, from: THREE.Vector3): THREE.Vector3 {
    const node = this.rig.nodes.get(this.rig.bones[boneIndex].name)!;
    let best = from.clone(), bd = Infinity;
    const v = new THREE.Vector3();
    for (const sid of node.carries) {
      for (const m of this.entries.get(sid)?.meshes ?? []) {
        const p = m.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i);
          const d = v.distanceToSquared(from);
          if (d < bd) { bd = d; best.copy(v); }
        }
      }
    }
    return best;
  }

  /** Attach each end of the muscle to the nearest point of the bone it is bound to. */
  private snapEnds(st: NonNullable<Entry['strain']>) {
    st.p0 = this.nearestOnBone(st.b0, st.e0);
    st.p1 = this.nearestOnBone(st.b1, st.e1);
  }

  /**
   * Corrections of the muscle data to its length line: ends named as bone landmarks (MuscleInfo.strainOrigin,
   * strainInsertion), and the bones and surfaces it bends around (strainWrap, strainVias).
   */
  private addWrap(e: Entry) {
    const st = e.strain;
    if (!st || e.s.kind !== 'muscle' || !hasMuscleInfo(e.s.key)) return;
    const positions = (sid: string) => (this.entries.get(sid)?.meshes ?? []).map((m) => m.geometry.getAttribute('position').array);
    const src: ViaSource = {
      structure: (id) => { const node = this.rig.nodes.get(this.rig.carriedBy.get(id) ?? ''); return node && this.entries.has(id) ? { positions: positions(id), bone: node.index } : undefined; },
      node: (id) => { const node = this.rig.nodes.get(id); return node && { positions: node.carries.flatMap(positions), bone: node.index, pivot: node.pivot }; },
    };
    const info = muscleInfo(e.s.key);
    const ends = resolveEnds(info, e.s.side, st as StrainPath, src);
    Object.assign(st, { p0: ends.p0, b0: ends.b0, p1: ends.p1, b1: ends.b1 });
    const vias = resolveVias(info, e.s.side, st.p0!, st.p1!, src);
    if (vias.length) st.vias = vias;
    // one line per part for the muscles whose parts the movement table treats apart (MuscleInfo.strainParts)
    for (const [key, part] of Object.entries(info.strainParts ?? {})) {
      const path = resolvePart(part, e.s.side, src);
      if (path) (st.parts ??= {})[key] = { path, rest: 0 };
    }
  }

  /**
   * Length of the line between the muscle's two attachment points (through its wrap point, if it has one), each end
   * bound rigidly to its own bone, so the value is the length of the muscle-tendon unit rather than of the belly alone.
   */
  private endDistance(st: NonNullable<Entry['strain']>): number {
    return this.pathLength(st as StrainPath);
  }

  private pathLength(path: StrainPath): number {
    const skel = this.rig.skeleton;
    const m = new THREE.Matrix4();
    const at = (p: THREE.Vector3, bone: number) => p.clone().applyMatrix4(m.multiplyMatrices(skel.bones[bone].matrixWorld, skel.boneInverses[bone]));
    return strainPathLength(path, at);
  }

  /**
   * Relative length change of a muscle in the current pose (0.1 = 10 % longer than at rest). With `part` (a key of the
   * muscle's parts) the length of that part's own line, when the muscle data has one (MuscleInfo.strainParts), else of
   * the whole muscle's.
   */
  strainOf(id: string, part?: string): number | null {
    const st = this.entries.get(id)?.strain;
    if (!st || !st.rest) return null;
    const p = part ? st.parts?.[part] : undefined;
    if (p?.rest) return this.pathLength(p.path) / p.rest - 1;
    return this.endDistance(st) / st.rest - 1;
  }

  /** Dev diagnostic: RMS vertex radius around the centroid per structure in the current pose. */
  spread(): Record<string, number> {
    const out: Record<string, number> = {};
    const pts: THREE.Vector3[] = [];
    const v = new THREE.Vector3();
    for (const [id, e] of this.entries) {
      pts.length = 0;
      for (const m of e.meshes) {
        const n = m.geometry.getAttribute('position').count;
        const step = Math.max(1, Math.floor(n / 300));
        for (let i = 0; i < n; i += step) { m.getVertexPosition(i, v); pts.push(v.clone()); }
      }
      const c = new THREE.Vector3();
      pts.forEach((p) => c.add(p));
      c.divideScalar(pts.length || 1);
      out[id] = Math.sqrt(pts.reduce((a, p) => a + p.distanceToSquared(c), 0) / (pts.length || 1));
    }
    return out;
  }

  /** Dev diagnostic: structures whose posed bounding box grew much larger than at rest (mis-skinned). */
  stretched(ratio = 1.6): { id: string; ratio: number }[] {
    const out: { id: string; ratio: number }[] = [];
    const v = new THREE.Vector3();
    for (const [id, e] of this.entries) {
      const box = new THREE.Box3();
      for (const m of e.meshes) {
        const n = m.geometry.getAttribute('position').count;
        const step = Math.max(1, Math.floor(n / 400));
        for (let i = 0; i < n; i += step) { m.getVertexPosition(i, v); box.expandByPoint(v); }
      }
      const rest = new THREE.Vector3(...e.s.bbox[1]).distanceTo(new THREE.Vector3(...e.s.bbox[0]));
      const now = box.min.distanceTo(box.max);
      if (now / rest > ratio) out.push({ id, ratio: +(now / rest).toFixed(2) });
    }
    return out.sort((a, b) => b.ratio - a.ratio);
  }

  setPose(angles: Record<string, number>) {
    this.angles = angles;
    if (!this.rig || this.disposed) return;
    this.rig.pose(angles);
    this.invalidate();
  }

  /**
   * Brings the culling spheres up to date with the bones. Cheap when nothing moved (a matrix compare), and catches
   * any pose change, including direct `rig.pose()` calls from dev tools.
   */
  private syncPose() {
    if (!this.rig || !this.bounds) return;
    this.rig.root.updateMatrixWorld();
    this.bounds.update();
  }

  // ---- appearance ---------------------------------------------------------------------------------
  setVisibility(v: VisState) { this.vis = v; this.refresh(); }
  setRoles(roles: Map<string, Role>) { this.roles = roles; this.refresh(); }
  setSelected(id: string | null) { this.selected = id; this.refresh(); }
  /** Colours these structure ids in HIGHLIGHT_COLOR and ghosts the other muscles (bones fade); null or empty clears. Movement roles win over it. */
  setHighlight(ids: Set<string> | null) { this.highlight = ids && ids.size ? ids : null; this.refresh(); }

  /** Switches the muscle-role colours (e.g. to the colour-blind-safe set) and redraws. */
  setPalette(name: PaletteName) {
    if (!Object.prototype.hasOwnProperty.call(ROLE_PALETTES, name) || name === this.palette) return;
    this.palette = name;
    this.refresh();
    this.invalidate();
  }

  private roleOf(id: string, part: string): Role | undefined {
    return this.roles.get(`${id}/${part}`) ?? this.roles.get(id);
  }

  private refresh() {
    const v = this.vis;
    if (!v || this.disposed) return;
    const rolesOn = this.roles.size > 0;
    const hl = rolesOn ? null : this.highlight;
    const pal = ROLE_PALETTES[this.palette];
    let pickChanged = false;
    this.pool.begin();
    for (const { s, meshes } of this.entries.values()) {
      const layer = v[KINDS[s.kind].layer];
      const sideOk = v.side === 'both' || s.side === 'm' || s.side === v.side;
      const regionOk = !v.regions || v.regions.includes(structureRegion(s));
      const shown = layer && sideOk && regionOk && !v.hidden.has(s.id);
      const isSel = s.id === this.selected;
      let opacity = KINDS[s.kind].opacity === 'muscle' ? v.muscleOpacity : v.boneOpacity;
      if (v.isolate && this.selected && !isSel) opacity = Math.min(opacity, 0.05);
      for (const m of meshes) {
        const surface = m.userData.surface as Surface;
        const role = rolesOn ? this.roleOf(s.id, m.userData.part) : undefined;
        let color = KINDS[s.kind].color;
        let o = opacity;
        if (role) { color = pal[role]; o = Math.max(o, 0.97); }
        else if (rolesOn && s.kind === 'muscle') { color = 0xb7a99c; o = Math.min(o, 0.16); }
        else if (rolesOn && s.kind !== 'muscle') o = Math.min(o, 0.45);
        else if (hl && s.kind === 'muscle') {
          if (hl.has(s.id)) { color = HIGHLIGHT_COLOR; o = Math.max(o, 0.97); } else { color = 0xb7a99c; o = Math.min(o, 0.16); }
        } else if (hl) o = Math.min(o, 0.45);
        // Textured muscle: natural texture colours, or the state colour with the texture as detail (see fibre.ts).
        const tinted = !!surface.map && color !== KINDS[s.kind].color;
        // See-through tissue (bursae, sheaths, fasciae, the bicipital aponeurosis...) keeps its own opacity on top of
        // the slider; whether it can be picked follows the slider only, so a faint sheath is still clickable.
        const shownO = o * (m.userData.alpha ?? 1);
        this.pool.apply(m, surface, {
          color: surface.map && !tinted ? 0xffffff : color,
          tinted,
          emissive: isSel ? 0x7a55c8 : s.id === this.hovered ? 0x8d6bcc : 0x000000,
          emissiveIntensity: isSel ? 0.5 : 0.28,
          opacity: shownO,
        });
        m.visible = shown && shownO > 0.005;
        const pickable = m.visible && o > 0.2;
        if (m.userData.pickable !== pickable) { m.userData.pickable = pickable; pickChanged = true; }
      }
    }
    this.pool.sweep();
    if (pickChanged) this.pickVersion++;
    this.invalidate();
  }

  /** Ids of the structures that are currently drawn and can be picked, in manifest order. */
  visibleIds(): string[] {
    const out: string[] = [];
    for (const id of this.structures.keys()) {
      const e = this.entries.get(id);
      if (e && e.meshes.some((m) => m.visible && m.userData.pickable)) out.push(id);
    }
    return out;
  }

  // ---- picking ------------------------------------------------------------------------------------
  // Picking renders mesh indices as colours. Two paths share that ID pass:
  //  - the pick buffer: the whole view at canvas size, copied to the CPU and reused for every hover and click until
  //    the camera, the pose, the pickable set or the size changes. It is drawn only on request, once the state has
  //    held still between two requests, and read back asynchronously (PBO + fence) so the main thread never waits
  //    for the GPU to finish it;
  //  - a one-pixel render (the camera's view offset narrowed to the pixel under the pointer) answers any request
  //    the buffer cannot: while the camera or the pose is changing, or while the buffer's readback is in flight.
  //    Frustum culling against that one-pixel frustum skips nearly every mesh, so it is cheap.
  // Both rasterise the same pixel of the same grid, so they agree exactly, and both reflect the current state.

  private pickSize() {
    const { w, h } = this.size;
    let s = PICK_SCALE;
    if (w * h * s * s > MAX_PICK_PIXELS) s = Math.sqrt(MAX_PICK_PIXELS / (w * h));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }

  /** Whether the state (camera, pose, pickable set, size) matches the one recorded in the given stamps. */
  private sameState(cam: MatrixStamp, pose: MatrixStamp, version: number, w: number, h: number, sw: number, sh: number) {
    return version === this.pickVersion && sw === w && sh === h && cam.matches(this.camMats) && pose.matches(this.boneWorlds);
  }

  /** Swaps in the ID materials, renders into `target`, optionally reads `w` x `h` pixels, restores everything. */
  private idPass(target: THREE.WebGLRenderTarget, w: number, h: number, out: Uint8Array | null) {
    this.syncPose();
    const ms = this.pickables, mats = this.pickSavedMat, vis = this.pickSavedVis;
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      mats[i] = m.material; vis[i] = m.visible;
      m.material = m.userData.pickMat;
      m.visible = m.visible && m.userData.pickable === true;
    }
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    r.getClearColor(this.clearTmp);
    const alpha = r.getClearAlpha();
    const bg = this.scene.background;
    try {
      this.scene.background = null;
      r.setClearColor(0x000000, 1);
      r.setRenderTarget(target);
      r.render(this.scene, this.camera);
      if (out) r.readRenderTargetPixels(target, 0, 0, w, h, out);
    } finally {
      r.setRenderTarget(prevTarget);
      r.setClearColor(this.clearTmp, alpha);
      this.scene.background = bg;
      for (let i = 0; i < ms.length; i++) { ms[i].material = mats[i]; ms[i].visible = vis[i]; }
    }
  }

  /** Draws the pick buffer for the current state and starts its readback; it becomes usable when that lands. */
  private startPickBuffer(w: number, h: number) {
    if (this.pickRT.width !== w || this.pickRT.height !== h) this.pickRT.setSize(w, h);
    this.idPass(this.pickRT, w, h, null);
    // Stamp the state the buffer shows now; a request made after the state moves on will see it as stale.
    const cam = new MatrixStamp(), pose = new MatrixStamp();
    cam.record(this.camMats); pose.record(this.boneWorlds);
    const version = this.pickVersion;
    const seq = ++this.pickSeq;
    this.pickInFlight = true;
    this.renderer.readRenderTargetPixelsAsync(this.pickRT, 0, 0, w, h, new Uint8Array(w * h * 4)).then((data) => {
      if (this.disposed || seq !== this.pickSeq) return;
      this.pickData = data as Uint8Array;
      this.pickCam = cam; this.pickPose = pose;
      this.pickDrawnVersion = version;
      this.pickW = w; this.pickH = h;
      this.pickValid = true;
    }).catch(() => { /* context lost or disposed: the one-pixel path keeps working */ }).finally(() => {
      if (seq === this.pickSeq) this.pickInFlight = false;
    });
  }

  /** ID of the single pick-grid pixel (x, y), rendered on its own. */
  private renderPickPoint(x: number, y: number, w: number, h: number): number {
    this.camera.setViewOffset(w, h, x, y, 1, 1);
    try {
      this.idPass(this.pointRT, 1, 1, this.pointBuf);
    } finally {
      this.camera.clearViewOffset();
    }
    const d = this.pointBuf;
    return d[0] | (d[1] << 8) | (d[2] << 16);
  }

  private pickAt(clientX: number, clientY: number): string | null {
    if (this.disposed || !this.pickables.length) return null;
    const rect = this.canvas.getBoundingClientRect();
    const dx = clientX - rect.left, dy = clientY - rect.top;
    if (!(dx >= 0 && dy >= 0 && dx < rect.width && dy < rect.height)) return null;
    const { w, h } = this.pickSize();
    // Multiply before dividing: at 1:1 scale an integer pointer position then maps to exactly its own pixel
    // ((437 / 684) * 684 is 436.99999999999994 in floating point, which would pick the neighbour).
    const x = Math.min(w - 1, Math.floor((dx * w) / rect.width)), y = Math.min(h - 1, Math.floor((dy * h) / rect.height));
    // Bring the matrices the stamps compare up to date (OrbitControls and the rig only touch local transforms).
    this.camera.updateMatrixWorld();
    this.rig.root.updateMatrixWorld();
    let idx: number;
    const fresh = this.pickValid && this.sameState(this.pickCam, this.pickPose, this.pickDrawnVersion, w, h, this.pickW, this.pickH);
    if (fresh) {
      const o = ((h - 1 - y) * w + x) * 4, d = this.pickData;
      idx = d[o] | (d[o + 1] << 8) | (d[o + 2] << 16);
    } else {
      // Unchanged since the previous request -> worth caching the whole view; still changing -> don't bother.
      const settled = this.sameState(this.reqCam, this.reqPose, this.reqVersion, w, h, this.reqW, this.reqH);
      this.reqCam.record(this.camMats); this.reqPose.record(this.boneWorlds);
      this.reqVersion = this.pickVersion; this.reqW = w; this.reqH = h;
      // Answer first: the one-pixel readback waits for queued GPU work, so it goes ahead of the full buffer.
      idx = this.renderPickPoint(x, y, w, h);
      if (settled && !this.pickInFlight) this.startPickBuffer(w, h);
    }
    if (!idx) return null;
    return (this.pickables[idx - 1]?.userData.id as string) ?? null;
  }

  // A second finger (pinch zoom) cancels the tap, so lifting the fingers does not select what is under them.
  private onDown = (e: PointerEvent) => { this.down = e.isPrimary ? { x: e.clientX, y: e.clientY } : null; };
  private onUp = (e: PointerEvent) => {
    const d = this.down; this.down = null;
    // Fingers drift more than a mouse during a tap.
    if (!d || !e.isPrimary || Math.hypot(e.clientX - d.x, e.clientY - d.y) > (e.pointerType === 'mouse' ? 5 : 10)) return;
    this.cb.onSelect?.(this.pickAt(e.clientX, e.clientY));
  };
  private onMove = (e: PointerEvent) => {
    if (e.buttons) { this.cancelHover(); return; }
    this.hoverPos = { x: e.clientX, y: e.clientY };
    const wait = this.lastHoverAt + HOVER_MS - performance.now();
    if (wait <= 0) this.hoverNow();
    else if (!this.hoverTimer) this.hoverTimer = window.setTimeout(() => { this.hoverTimer = 0; this.hoverNow(); }, wait);
  };
  private hoverNow() {
    const p = this.hoverPos;
    if (!p || this.disposed) return;
    this.lastHoverAt = performance.now();
    const id = this.pickAt(p.x, p.y);
    if (id !== this.hovered) { this.hovered = id; this.refresh(); this.canvas.style.cursor = id ? 'pointer' : 'grab'; }
    this.cb.onHover?.(id, p.x, p.y);
  }
  private cancelHover() {
    if (this.hoverTimer) { clearTimeout(this.hoverTimer); this.hoverTimer = 0; }
    this.hoverPos = null;
  }
  private onLeave = () => {
    this.cancelHover();
    if (this.hovered) { this.hovered = null; this.refresh(); }
    this.cb.onHover?.(null, 0, 0);
  };

  /**
   * Keyboard control while the canvas has focus: arrows orbit, Shift+arrows pan, +/- zoom, Home resets the view.
   * Steps glide with the controls' damping, or land at once when the user prefers reduced motion.
   */
  private onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const c = this.controls;
    let act: () => void;
    switch (e.key) {
      case 'ArrowLeft': act = e.shiftKey ? () => c.pan(KEY_PAN_PX, 0) : () => c.rotateLeft(KEY_ROTATE); break;
      case 'ArrowRight': act = e.shiftKey ? () => c.pan(-KEY_PAN_PX, 0) : () => c.rotateLeft(-KEY_ROTATE); break;
      case 'ArrowUp': act = e.shiftKey ? () => c.pan(0, KEY_PAN_PX) : () => c.rotateUp(KEY_ROTATE); break;
      case 'ArrowDown': act = e.shiftKey ? () => c.pan(0, -KEY_PAN_PX) : () => c.rotateUp(-KEY_ROTATE); break;
      case '+': case '=': act = () => c.dollyIn(1 / KEY_ZOOM); break;
      case '-': case '_': act = () => c.dollyOut(1 / KEY_ZOOM); break;
      case 'Home': e.preventDefault(); this.setView('reset'); return;
      default: return;
    }
    e.preventDefault();
    this.tween?.kill(); this.tween = null;
    if (reducedMotion()) {
      const damping = c.enableDamping;
      c.enableDamping = false;
      act();
      c.enableDamping = damping;
    } else act();
    this.invalidate();
  };

  // ---- camera -------------------------------------------------------------------------------------
  private flyTo(target: THREE.Vector3, dir: THREE.Vector3, dist: number) {
    this.tween?.kill();
    const from = { t: 0 };
    const t0 = this.controls.target.clone(), p0 = this.camera.position.clone();
    const p1 = target.clone().addScaledVector(dir.normalize(), dist);
    this.tween = gsap.to(from, {
      t: 1, duration: reducedMotion() ? 0 : 0.9, ease: 'power3.inOut',
      onUpdate: () => {
        if (this.disposed) return;
        this.controls.target.lerpVectors(t0, target, from.t);
        this.camera.position.lerpVectors(p0, p1, from.t);
        this.controls.update(); this.invalidate();
      },
    });
  }

  focusOn(ids: string[]) {
    // A second-stage structure whose meshes are still on their way: focus once they are in.
    if (!this.extrasDone && ids.some((id) => this.structures.has(id) && !this.entries.has(id))) {
      this.extras.then(() => { if (!this.disposed) this.focusOn(ids); });
      return;
    }
    // Bounds of the *posed* geometry: sample vertices through the skeleton.
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const id of ids) {
      for (const m of this.entries.get(id)?.meshes ?? []) {
        const n = m.geometry.getAttribute('position').count;
        const step = Math.max(1, Math.floor(n / 300));
        for (let i = 0; i < n; i += step) { m.getVertexPosition(i, v); box.expandByPoint(v); }
      }
    }
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const dist = Math.max(0.55, Math.max(size.x, size.y, size.z) * 2.6);
    const dir = this.camera.position.clone().sub(this.controls.target);
    this.flyTo(box.getCenter(new THREE.Vector3()), dir, dist);
  }

  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 1.1;
    this.invalidate();
  }

  setView(name: 'front' | 'back' | 'left' | 'right' | 'top' | 'reset') {
    const dirs = { front: [0, 0.1, 1], back: [0, 0.1, -1], left: [1, 0.1, 0], right: [-1, 0.1, 0], top: [0, 1, 0.001], reset: [0, 0.1, 1] } as const;
    const d = dirs[name];
    this.flyTo(new THREE.Vector3(0, 0.88, 0), new THREE.Vector3(d[0], d[1], d[2]), name === 'top' ? 3.4 : 4.3);
  }

  // ---- offscreen artwork ---------------------------------------------------------------------------
  /**
   * Renders structures in the rest pose to a PNG data URL, without touching the visible view. Used for the
   * library glyphs and the illustrations on the learning cards. Throws if the viewer is not loaded or was disposed.
   */
  snapshot(spec: SnapshotSpec): string {
    if (this.disposed) throw new Error('Viewer was disposed');
    if (!this.rig) throw new Error('Viewer is not loaded');
    const size = spec.size;
    const mk = (hex: number) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.6, metalness: 0.04, side: THREE.DoubleSide });
    const mats = (this.snapMats ??= {
      kind: Object.fromEntries(KIND_LIST.map((k) => [k, mk(KINDS[k].color)])) as Record<Kind, THREE.MeshStandardMaterial>,
      highlight: mk(0xe0685a),
      ghost: mk(0xcdbfae),
    });
    setOpacity(mats.ghost, spec.ghostOpacity ?? 0.22);
    const subjects = new Set(spec.ids);

    const saved: { m: THREE.SkinnedMesh; mat: THREE.Material | THREE.Material[]; vis: boolean }[] = [];
    const r = this.renderer;
    const clear = new THREE.Color(); r.getClearColor(clear);
    const alpha = r.getClearAlpha();
    const bg = this.scene.background;
    const prevTarget = r.getRenderTarget();
    const px = new Uint8Array(size * size * 4);
    try {
      for (const [id, e] of this.entries) {
        for (const m of e.meshes) {
          saved.push({ m, mat: m.material, vis: m.visible });
          if (subjects.has(id)) { m.material = spec.highlight ? mats.highlight : mats.kind[e.s.kind]; m.visible = true; }
          else if (spec.ghost === 'bones' && GHOST_KINDS.has(e.s.kind)) { m.material = mats.ghost; m.visible = true; }
          else m.visible = false;
        }
      }
      this.rig.pose({});
      this.syncPose();

      // frame
      const box = new THREE.Box3();
      const v = new THREE.Vector3();
      for (const id of spec.ids) {
        for (const m of this.entries.get(id)?.meshes ?? []) {
          const n = m.geometry.getAttribute('position').count;
          const step = Math.max(1, Math.floor(n / 400));
          for (let i = 0; i < n; i += step) { m.getVertexPosition(i, v); box.expandByPoint(v); }
        }
      }
      const cam = new THREE.PerspectiveCamera(spec.fit === 'body' ? 24 : 28, 1, 0.02, 30);
      let target: THREE.Vector3, dist: number;
      if (spec.fit === 'body' || box.isEmpty()) {
        target = new THREE.Vector3(0, 0.9, 0.05);
        dist = 0.98 / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.04;
      } else {
        const sph = box.getBoundingSphere(new THREE.Sphere());
        target = sph.center;
        dist = Math.max(0.12, sph.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.12);
      }
      const yaw = THREE.MathUtils.degToRad(spec.yaw) + (spec.back ? Math.PI : 0);
      const pitch = THREE.MathUtils.degToRad(spec.pitch);
      cam.position.set(
        target.x + dist * Math.sin(yaw) * Math.cos(pitch),
        target.y + dist * Math.sin(pitch),
        target.z + dist * Math.cos(yaw) * Math.cos(pitch),
      );
      cam.lookAt(target);

      let rt = this.snapRT.get(size);
      if (!rt) { rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 }); this.snapRT.set(size, rt); }
      this.scene.background = null;
      r.setClearColor(0x000000, 0);
      r.setRenderTarget(rt);
      r.clear();
      r.render(this.scene, cam);
      r.readRenderTargetPixels(rt, 0, 0, size, size, px);
    } finally {
      r.setRenderTarget(prevTarget);
      r.setClearColor(clear, alpha);
      this.scene.background = bg;
      for (const { m, mat, vis } of saved) { m.material = mat; m.visible = vis; }
      // Back to the live pose. The pick buffer compares bone matrices, so it stays valid when they come back equal.
      this.rig.pose(this.angles);
      this.syncPose();
    }

    // The target holds linear, premultiplied-by-coverage colour: unpremultiply, encode as sRGB, flip rows.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    const enc = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
    for (let y = 0; y < size; y++) {
      const src = (size - 1 - y) * size * 4, dst = y * size * 4;
      for (let x = 0; x < size; x++) {
        const o = x * 4, a = px[src + o + 3] / 255;
        img.data[dst + o + 3] = px[src + o + 3];
        if (a <= 0) continue;
        for (let c = 0; c < 3; c++) img.data[dst + o + c] = Math.min(255, Math.round(enc(Math.min(1, px[src + o + c] / 255 / a)) * 255));
      }
    }
    ctx.putImageData(img, 0, 0);
    // The main view is untouched (the snapshot went to its own target and the pose is back): nothing to redraw.
    return canvas.toDataURL('image/png');
  }

  /**
   * Releases everything: the render loop, listeners, tweens, GPU resources and any download in flight. Safe to call
   * more than once, and a new Viewer may be created on the same canvas afterwards.
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    cancelAnimationFrame(this.raf);
    this.tween?.kill(); this.tween = null;
    this.cancelHover();
    this.ro.disconnect();
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerleave', this.onLeave);
    c.removeEventListener('keydown', this.onKey);
    if (this.prevTabIndex === null) c.removeAttribute('tabindex');
    c.style.cursor = '';
    this.controls.dispose();
    for (const m of this.pickables) {
      m.geometry.dispose();
      (m.userData.pickMat as THREE.Material).dispose();
    }
    this.pool.dispose(); // the shared materials and their textures
    if (this.snapMats) {
      for (const mt of [...Object.values(this.snapMats.kind), this.snapMats.highlight, this.snapMats.ghost]) mt.dispose();
      this.snapMats = null;
    }
    this.rig?.skeleton.dispose();
    this.pickRT.dispose();
    this.pointRT.dispose();
    for (const rt of this.snapRT.values()) rt.dispose();
    this.snapRT.clear();
    this.scene.clear();
    this.pickables = [];
    this.entries.clear();
    this.renderer.dispose();
    // The DRACO loader, if a decode is in flight, is released by loadModels() / loadExtras() once that decode settles.
  }
}
