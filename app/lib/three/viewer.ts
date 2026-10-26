import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import gsap from 'gsap';
import type { Region, Structure } from '../types';
import { Rig } from '../rig/rig';
import { resolveSkin, skinGeometry } from '../rig/skinning';
import { hasMuscleInfo, muscleInfo } from '../data/muscles';
import type { Role } from '../data/actions';

export interface VisState {
  bones: boolean;
  muscles: boolean;
  discs: boolean;
  cartilage: boolean;
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
}

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

export const ROLE_COLOR: Record<Role, number> = { prime: 0xe0453a, assist: 0xf0902f, stab: 0xe3b72b, antagonist: 0x4a7fd1 };
const KIND_COLOR = { bone: 0xe4d8c2, muscle: 0xc15b4d, disc: 0x7fb1c4, cartilage: 0xa4c8d6 } as const;

const BONE_REGION: Record<string, Region> = {
  skull: 'Head & neck', mandible: 'Head & neck', cervical: 'Head & neck', neck: 'Head & neck',
  thoracic: 'Trunk', lumbar: 'Trunk', spine: 'Trunk', thorax: 'Trunk', pelvis: 'Trunk',
  clavicle: 'Upper limb', scapula: 'Upper limb', humerus: 'Upper limb', radius: 'Upper limb', ulna: 'Upper limb', hand: 'Upper limb',
  femur: 'Lower limb', patella: 'Lower limb', tibia: 'Lower limb', fibula: 'Lower limb', talus: 'Lower limb', foot: 'Lower limb',
};
export const structureRegion = (s: Structure): Region => {
  if (s.kind === 'muscle') return muscleInfo(s.key).region;
  const g = s.group ?? '';
  if (g.startsWith('digit-')) return /thumb|index|middle|ring|little/.test(g) ? 'Upper limb' : 'Lower limb';
  return BONE_REGION[g] ?? 'Trunk';
};

interface Entry {
  s: Structure;
  meshes: THREE.SkinnedMesh[];
  strain?: { mesh: THREE.SkinnedMesh; i0: number; i1: number; b0: number; b1: number; rest: number; p0?: THREE.Vector3; p1?: THREE.Vector3 };
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
  private pickRT = new THREE.WebGLRenderTarget(1, 1, { colorSpace: THREE.NoColorSpace });
  private pickBuf = new Uint8Array(4);
  private dirty = true;
  private raf = 0;
  private disposed = false;
  private selected: string | null = null;
  private hovered: string | null = null;
  private roles = new Map<string, Role>();
  private vis: VisState | null = null;
  private down: { x: number; y: number } | null = null;
  private lastHoverAt = 0;
  private ro: ResizeObserver;
  private tween: gsap.core.Tween | null = null;
  private angles: Record<string, number> = {};
  private snapRT = new Map<number, THREE.WebGLRenderTarget>();

  constructor(private canvas: HTMLCanvasElement, private cb: Callbacks = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, 0.95, 4.3);
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

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerleave', this.onLeave);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const moved = this.controls.update();
      if (this.dirty || moved) { this.dirty = false; this.renderer.render(this.scene, this.camera); }
    };
    loop();
  }

  invalidate() { this.dirty = true; }

  private resize() {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  // ---- loading -------------------------------------------------------------------------------------
  async load(onProgress?: (p: number) => void) {
    const manifest: Structure[] = await (await fetch('/models/structures.json')).json();
    this.structures = new Map(manifest.map((s) => [s.id, s]));
    this.rig = new Rig(this.structures);
    this.scene.add(this.rig.root);

    const draco = new DRACOLoader().setDecoderPath('/draco/');
    const loader = new GLTFLoader().setDRACOLoader(draco);
    const progress = [0, 0];
    const report = () => onProgress?.((progress[0] + progress[1]) / 2);
    const files = ['/models/skeleton.glb', '/models/muscles.glb'];
    const gltfs = await Promise.all(files.map((f, i) => loader.loadAsync(f, (e) => {
      if (e.lengthComputable) { progress[i] = e.loaded / e.total; report(); }
    })));
    draco.dispose();

    for (const gltf of gltfs) {
      for (const grp of gltf.scene.children) {
        const id = grp.userData.id as string | undefined;
        const s = id ? this.structures.get(id) : undefined;
        if (!s) continue;
        const entry: Entry = { s, meshes: [] };
        const spec = resolveSkin(s, this.rig, s.kind === 'muscle' && hasMuscleInfo(s.key) ? muscleInfo(s.key) : undefined);
        let best: { mesh: THREE.SkinnedMesh; ends: [number, number]; endBones: [number, number]; count: number } | null = null;
        for (const child of grp.children) {
          const m = child as THREE.Mesh;
          if (!m.isMesh) continue;
          const geom = m.geometry as THREE.BufferGeometry;
          geom.computeVertexNormals();
          const res = skinGeometry(geom, spec, this.rig);
          const mat = new THREE.MeshStandardMaterial({ color: KIND_COLOR[s.kind], roughness: 0.62, metalness: 0.04, side: THREE.DoubleSide });
          const sm = new THREE.SkinnedMesh(geom, mat);
          sm.userData = { id: s.id, part: m.userData.part ?? 'main' };
          sm.frustumCulled = false;
          sm.bind(this.rig.skeleton, new THREE.Matrix4());
          this.scene.add(sm);
          entry.meshes.push(sm);
          this.pickables.push(sm);
          sm.userData.pickIndex = this.pickables.length;
          sm.userData.pickMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setRGB(((this.pickables.length) & 255) / 255, ((this.pickables.length >> 8) & 255) / 255, ((this.pickables.length >> 16) & 255) / 255, THREE.LinearSRGBColorSpace),
            toneMapped: false, side: THREE.DoubleSide,
          });
          const count = geom.getAttribute('position').count;
          if (res.ends && res.endBones && (!best || count > best.count)) best = { mesh: sm, ends: res.ends, endBones: res.endBones, count };
        }
        if (best) entry.strain = { mesh: best.mesh, i0: best.ends[0], i1: best.ends[1], b0: best.endBones[0], b1: best.endBones[1], rest: 0 };
        this.entries.set(s.id, entry);
      }
    }
    this.rig.pose({});
    for (const e of this.entries.values()) if (e.strain) { this.snapEnds(e.strain); e.strain.rest = this.endDistance(e.strain); }
    this.invalidate();
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
    const raw = st.mesh.geometry.getAttribute('position');
    st.p0 = this.nearestOnBone(st.b0, new THREE.Vector3().fromBufferAttribute(raw, st.i0));
    st.p1 = this.nearestOnBone(st.b1, new THREE.Vector3().fromBufferAttribute(raw, st.i1));
  }

  /**
   * Distance between the muscle's two attachment points, each bound rigidly to its own bone, so the value
   * is the length of the muscle-tendon unit rather than of the belly alone.
   */
  private endDistance(st: NonNullable<Entry['strain']>): number {
    const skel = this.rig.skeleton;
    const m = new THREE.Matrix4();
    const at = (p: THREE.Vector3, bone: number) => p.clone().applyMatrix4(m.multiplyMatrices(skel.bones[bone].matrixWorld, skel.boneInverses[bone]));
    return at(st.p0!, st.b0).distanceTo(at(st.p1!, st.b1));
  }

  /** Relative length change of a muscle in the current pose (0.1 = 10 % longer than at rest). */
  strainOf(id: string): number | null {
    const st = this.entries.get(id)?.strain;
    if (!st || !st.rest) return null;
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
    this.rig.pose(angles);
    this.invalidate();
  }

  // ---- appearance ---------------------------------------------------------------------------------
  setVisibility(v: VisState) { this.vis = v; this.refresh(); }
  setRoles(roles: Map<string, Role>) { this.roles = roles; this.refresh(); }
  setSelected(id: string | null) { this.selected = id; this.refresh(); }

  private roleOf(id: string, part: string): Role | undefined {
    return this.roles.get(`${id}/${part}`) ?? this.roles.get(id);
  }

  private refresh() {
    const v = this.vis;
    if (!v) return;
    const rolesOn = this.roles.size > 0;
    for (const { s, meshes } of this.entries.values()) {
      const layer = s.kind === 'bone' ? v.bones : s.kind === 'muscle' ? v.muscles : s.kind === 'disc' ? v.discs : v.cartilage;
      const sideOk = v.side === 'both' || s.side === 'm' || s.side === v.side;
      const regionOk = !v.regions || v.regions.includes(structureRegion(s));
      let shown = layer && sideOk && regionOk && !v.hidden.has(s.id);
      const isSel = s.id === this.selected;
      let opacity = s.kind === 'muscle' ? v.muscleOpacity : v.boneOpacity;
      if (v.isolate && this.selected && !isSel) opacity = Math.min(opacity, 0.05);
      for (const m of meshes) {
        const mat = m.material as THREE.MeshStandardMaterial;
        const role = rolesOn ? this.roleOf(s.id, m.userData.part) : undefined;
        let color = KIND_COLOR[s.kind] as number;
        let o = opacity;
        if (role) { color = ROLE_COLOR[role]; o = Math.max(o, 0.97); }
        else if (rolesOn && s.kind === 'muscle') { color = 0xb7a99c; o = Math.min(o, 0.16); }
        else if (rolesOn && s.kind !== 'muscle') o = Math.min(o, 0.45);
        mat.color.setHex(color);
        mat.emissive.setHex(isSel ? 0x7a55c8 : s.id === this.hovered ? 0x8d6bcc : 0x000000);
        mat.emissiveIntensity = isSel ? 0.5 : 0.28;
        const transparent = o < 0.995;
        if (mat.transparent !== transparent) { mat.transparent = transparent; mat.needsUpdate = true; }
        mat.opacity = o;
        mat.depthWrite = o > 0.6;
        m.visible = shown && o > 0.005;
        m.userData.pickable = m.visible && o > 0.2;
      }
    }
    this.invalidate();
  }

  // ---- picking ------------------------------------------------------------------------------------
  private pickAt(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor(clientX - rect.left), y = Math.floor(clientY - rect.top);
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
    const saved = new Map<THREE.SkinnedMesh, { mat: THREE.Material | THREE.Material[]; vis: boolean }>();
    for (const m of this.pickables) {
      saved.set(m, { mat: m.material, vis: m.visible });
      m.material = m.userData.pickMat;
      m.visible = m.visible && m.userData.pickable !== false;
    }
    const bg = this.scene.background;
    const clear = new THREE.Color(); this.renderer.getClearColor(clear);
    const alpha = this.renderer.getClearAlpha();
    this.scene.background = null;
    this.renderer.setClearColor(0x000000, 1);
    this.camera.setViewOffset(rect.width, rect.height, x, y, 1, 1);
    this.renderer.setRenderTarget(this.pickRT);
    this.renderer.render(this.scene, this.camera);
    this.renderer.readRenderTargetPixels(this.pickRT, 0, 0, 1, 1, this.pickBuf);
    this.renderer.setRenderTarget(null);
    this.camera.clearViewOffset();
    this.renderer.setClearColor(clear, alpha);
    this.scene.background = bg;
    for (const [m, s] of saved) { m.material = s.mat; m.visible = s.vis; }
    const idx = this.pickBuf[0] | (this.pickBuf[1] << 8) | (this.pickBuf[2] << 16);
    if (!idx) return null;
    return (this.pickables[idx - 1]?.userData.id as string) ?? null;
  }

  private onDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY }; };
  private onUp = (e: PointerEvent) => {
    const d = this.down; this.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
    this.cb.onSelect?.(this.pickAt(e.clientX, e.clientY));
  };
  private onMove = (e: PointerEvent) => {
    if (e.buttons) return;
    const now = performance.now();
    if (now - this.lastHoverAt < 45) return;
    this.lastHoverAt = now;
    const id = this.pickAt(e.clientX, e.clientY);
    if (id !== this.hovered) { this.hovered = id; this.refresh(); this.canvas.style.cursor = id ? 'pointer' : 'grab'; }
    this.cb.onHover?.(id, e.clientX, e.clientY);
  };
  private onLeave = () => {
    if (this.hovered) { this.hovered = null; this.refresh(); }
    this.cb.onHover?.(null, 0, 0);
  };

  // ---- camera -------------------------------------------------------------------------------------
  private flyTo(target: THREE.Vector3, dir: THREE.Vector3, dist: number) {
    this.tween?.kill();
    const from = { t: 0 };
    const t0 = this.controls.target.clone(), p0 = this.camera.position.clone();
    const p1 = target.clone().addScaledVector(dir.normalize(), dist);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.tween = gsap.to(from, {
      t: 1, duration: reduce ? 0 : 0.9, ease: 'power3.inOut',
      onUpdate: () => {
        this.controls.target.lerpVectors(t0, target, from.t);
        this.camera.position.lerpVectors(p0, p1, from.t);
        this.controls.update(); this.invalidate();
      },
    });
  }

  focusOn(ids: string[]) {
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
   * library glyphs and the illustrations on the learning cards.
   */
  snapshot(spec: SnapshotSpec): string {
    const size = spec.size;
    const kindMat: Record<string, THREE.Material> = {};
    const mk = (hex: number, opacity = 1) => new THREE.MeshStandardMaterial({
      color: hex, roughness: 0.6, metalness: 0.04, side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
    });
    for (const k of Object.keys(KIND_COLOR) as (keyof typeof KIND_COLOR)[]) kindMat[k] = mk(KIND_COLOR[k]);
    const highlight = mk(0xe0685a);
    const ghost = mk(0xcdbfae, spec.ghostOpacity ?? 0.22);
    const subjects = new Set(spec.ids);

    const saved: { m: THREE.SkinnedMesh; mat: THREE.Material | THREE.Material[]; vis: boolean }[] = [];
    for (const [id, e] of this.entries) {
      for (const m of e.meshes) {
        saved.push({ m, mat: m.material, vis: m.visible });
        if (subjects.has(id)) { m.material = spec.highlight ? highlight : kindMat[e.s.kind]; m.visible = true; }
        else if (spec.ghost === 'bones' && e.s.kind !== 'muscle') { m.material = ghost; m.visible = true; }
        else m.visible = false;
      }
    }
    this.rig.pose({});

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
    const clear = new THREE.Color(); this.renderer.getClearColor(clear);
    const alpha = this.renderer.getClearAlpha();
    const bg = this.scene.background;
    this.scene.background = null;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setRenderTarget(rt);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    const px = new Uint8Array(size * size * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(clear, alpha);
    this.scene.background = bg;

    for (const { m, mat, vis } of saved) { m.material = mat; m.visible = vis; }
    this.rig.pose(this.angles);
    for (const mt of [...Object.values(kindMat), highlight, ghost]) mt.dispose();

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
    this.invalidate();
    return canvas.toDataURL('image/png');
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.tween?.kill();
    this.ro.disconnect();
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerleave', this.onLeave);
    this.controls.dispose();
    for (const m of this.pickables) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      (m.userData.pickMat as THREE.Material).dispose();
    }
    this.pickRT.dispose();
    for (const rt of this.snapRT.values()) rt.dispose();
    this.renderer.dispose();
  }
}
