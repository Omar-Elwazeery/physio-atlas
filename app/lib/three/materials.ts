import * as THREE from 'three';
import { makeFibreMaterial, setFibreTint } from './fibre';

/** What a mesh is made of, fixed when it is created: its textures, roughness and which faces are drawn. */
export interface Surface {
  /** Meshes with equal keys and equal looks are drawn with the same material object. */
  readonly key: string;
  readonly roughness: number;
  /** Fibre atlas (see fibre.ts), or null for a plain coloured surface. */
  readonly map: THREE.Texture | null;
  readonly normalMap: THREE.Texture | null;
  readonly normalScale: number;
  /** DoubleSide, or FrontSide for closed see-through sacs (bursae, sheaths, capsules). */
  readonly side: THREE.Side;
}

/** The state-dependent part of a mesh's appearance (selection, roles, fades), set on every refresh. */
export interface Look {
  /** Material colour (sRGB hex). For a fibre surface: white when natural, the state colour when tinted. */
  color: number;
  /** Fibre surfaces only: the colour carries the meaning and the texture adds detail (see fibre.ts). */
  tinted: boolean;
  emissive: number;
  emissiveIntensity: number;
  opacity: number;
}

/** At or above this opacity a mesh is drawn opaque. */
export const OPAQUE_ABOVE = 0.995;
/** Above this opacity a see-through mesh still writes depth. */
export const DEPTH_WRITE_ABOVE = 0.6;
/**
 * At or below this opacity a see-through, double-sided mesh is drawn in one pass instead of back faces then front
 * faces. The two differ only in the order the mesh's own far and near walls are blended, which changes a pixel by at
 * most opacity^2 of the difference between the two walls' shading: under 4 % here, and it halves the triangles of
 * the "not involved" ghosts (opacity 0.16) and the isolate ghosts (0.05), which are most of the body in those modes.
 */
export const SINGLE_PASS_BELOW = 0.2;

/** How a material draws its mesh: both passes at once (or the only side), or one half of a back/front pair. */
type Variant = 0 | 1 | 2;
const SINGLE: Variant = 0, BACK: Variant = 1, FRONT: Variant = 2;

/** Materials the pool may hold before it drops the ones no mesh uses (an opacity slider drag makes new ones). */
const POOL_LIMIT = 600;

let surfaceIds = 0;
const texIds = new WeakMap<THREE.Texture, number>();
const texId = (t: THREE.Texture | null) => {
  if (!t) return 0;
  let id = texIds.get(t);
  if (!id) texIds.set(t, (id = ++surfaceIds));
  return id;
};

/**
 * Shared materials for the viewer's meshes.
 *
 * The viewer used to give each of its ~1600 meshes its own material and mutate it. Two costs came with that:
 *  - every draw call re-sent the material's uniforms, because the material differed from the previous draw's;
 *  - three.js draws a see-through double-sided mesh twice (back faces, then front) by flipping `material.side` and
 *    `needsUpdate` around each draw, which re-derives the shader program key twice per mesh per frame. With a
 *    movement selected nearly the whole body is see-through, and that was most of the frame.
 * Here a material is immutable and shared by every mesh with the same surface and look (a few dozen to a couple of
 * hundred materials instead of ~1600; the bones' individual normal maps are what keeps the number up), and the
 * two-pass draw is done with a [back, front] material pair on two geometry groups that span the whole mesh: the same
 * two draws in the same order, with nothing recompiled.
 */
export class MaterialPool {
  private mats = new Map<string, { m: THREE.MeshStandardMaterial; gen: number }>();
  private pairs = new Map<string, THREE.MeshStandardMaterial[]>();
  private surfaces = new Map<string, Surface>();
  private textures = new Set<THREE.Texture>();
  private keepers: THREE.Material[] = [];
  private warmCleanup: (() => void) | null = null;
  private gen = 0;

  surface(roughness: number, map: THREE.Texture | null, normalMap: THREE.Texture | null, normalScale: number, side: THREE.Side): Surface {
    const key = `${roughness}|${texId(map)}|${texId(normalMap)}|${normalMap ? normalScale : 0}|${side}`;
    let s = this.surfaces.get(key);
    if (!s) {
      this.surfaces.set(key, (s = { key, roughness, map, normalMap, normalScale, side }));
      if (map) this.textures.add(map);
      if (normalMap) this.textures.add(normalMap);
    }
    return s;
  }

  /** Number of materials currently held (diagnostics and tests). */
  get size(): number { return this.mats.size; }

  /** Call before a pass of `apply` over every mesh; `sweep` afterwards drops what that pass did not use. */
  begin() { this.gen++; }

  /** Sets `mesh.material` to the shared material (or [back, front] pair) for this surface and look. */
  apply(mesh: THREE.Mesh, surface: Surface, look: Look) {
    const transparent = look.opacity < OPAQUE_ABOVE;
    if (transparent && surface.side === THREE.DoubleSide && look.opacity > SINGLE_PASS_BELOW) {
      const back = this.get(surface, look, BACK), front = this.get(surface, look, FRONT);
      const g = mesh.geometry;
      // Two groups over the whole mesh: with a material array three.js draws group 0 (back faces) then group 1 (front
      // faces); with a single material it ignores the groups.
      if (!g.groups.length) { g.addGroup(0, Infinity, 0); g.addGroup(0, Infinity, 1); }
      const key = `${back.uuid}|${front.uuid}`;
      let pair = this.pairs.get(key);
      if (!pair) this.pairs.set(key, (pair = [back, front]));
      mesh.material = pair;
    } else {
      mesh.material = this.get(surface, look, SINGLE);
    }
  }

  private get(s: Surface, look: Look, variant: Variant): THREE.MeshStandardMaterial {
    const transparent = look.opacity < OPAQUE_ABOVE;
    const opacity = transparent ? Math.round(look.opacity * 1000) / 1000 : 1;
    const emissiveIntensity = look.emissive ? look.emissiveIntensity : 0;
    const key = `${s.key}|${variant}|${look.color}|${s.map && look.tinted ? 1 : 0}|${look.emissive}|${emissiveIntensity}|${opacity}`;
    let e = this.mats.get(key);
    if (!e) {
      const m = make(s, variant);
      m.color.setHex(look.color);
      if (s.map) setFibreTint(m, look.tinted);
      m.emissive.setHex(look.emissive);
      m.emissiveIntensity = emissiveIntensity;
      m.transparent = transparent;
      m.opacity = opacity;
      m.depthWrite = opacity > DEPTH_WRITE_ABOVE;
      this.mats.set(key, (e = { m, gen: this.gen }));
    }
    e.gen = this.gen;
    return e.m;
  }

  /** Drops the materials the last pass left unused, once the pool has grown past its limit. */
  sweep() {
    if (this.mats.size <= POOL_LIMIT) return;
    const gone = new Set<string>();
    for (const [key, e] of this.mats) {
      if (e.gen === this.gen) continue;
      gone.add(e.m.uuid);
      e.m.dispose();
      this.mats.delete(key);
    }
    for (const [key, pair] of this.pairs) if (pair.some((m) => gone.has(m.uuid))) this.pairs.delete(key);
  }

  /**
   * Starts compiling the shader programs the viewer uses, without waiting for the models: the browser compiles them
   * in the background (KHR_parallel_shader_compile) while the files download and decode. The programs depend only on
   * what kind of surface a mesh has, not on its geometry or textures, so stand-ins with placeholder textures are
   * enough. Resolves with the stand-ins once the programs are compiled: drawing them once (they are single points,
   * so nothing shows) makes three.js look up each program's uniforms and attributes, a few hundred blocking calls to
   * the GPU process that would otherwise fall in the first frame. The stand-in materials are kept until `dispose`,
   * which also keeps the programs alive whatever the pool sweeps.
   *
   * `lit` is the scene whose lights the real meshes are drawn under.
   */
  warm(renderer: THREE.WebGLRenderer, lit: THREE.Scene, camera: THREE.Camera): Promise<THREE.Object3D> {
    const px = () => { const t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); t.needsUpdate = true; return t; };
    const map = px(), nmap = px();
    map.colorSpace = THREE.SRGBColorSpace;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(9, 3)); // a triangle of no area: draws no pixel
    geom.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(12), 4));
    geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const skeleton = new THREE.Skeleton([new THREE.Bone()]);
    const group = new THREE.Group();
    const add = (m: THREE.Material) => {
      const sm = new THREE.SkinnedMesh(geom, m);
      sm.bind(skeleton, new THREE.Matrix4());
      sm.frustumCulled = false;
      group.add(sm);
      this.keepers.push(m);
    };
    for (const [hasMap, hasNormal] of WARM_SURFACES) {
      const s: Surface = { key: '', roughness: 0.6, map: hasMap ? map : null, normalMap: hasNormal ? nmap : null, normalScale: 1, side: THREE.DoubleSide };
      // Opaque, as everything is in the first view; then the see-through forms (the back/front pair of a faded or
      // "other structures" mesh, the single pass of a ghost), so that choosing a movement does not stall either.
      const opaque = make(s, SINGLE);
      add(opaque);
      for (const v of [BACK, FRONT, SINGLE]) {
        const m = make(s, v);
        m.transparent = true;
        m.depthWrite = false;
        add(m);
      }
    }
    this.warmCleanup = () => { geom.dispose(); map.dispose(); nmap.dispose(); skeleton.dispose(); };
    group.updateMatrixWorld(true);
    return renderer.compileAsync(group, camera, lit).then(() => group, () => group);
  }

  /** Releases every material and every texture a surface named. The meshes must not be drawn afterwards. */
  dispose() {
    for (const e of this.mats.values()) e.m.dispose();
    for (const t of this.textures) t.dispose();
    for (const k of this.keepers) k.dispose();
    this.warmCleanup?.(); this.warmCleanup = null;
    this.mats.clear(); this.pairs.clear(); this.surfaces.clear(); this.textures.clear();
    this.keepers = [];
  }
}

/** Surface kinds whose programs are compiled ahead: [fibre atlas, normal map]. */
const WARM_SURFACES: [boolean, boolean][] = [[false, false], [false, true], [true, false], [true, true]];

function make(s: Surface, variant: Variant): THREE.MeshStandardMaterial {
  const m = s.map
    ? makeFibreMaterial(s.map, s.roughness)
    : new THREE.MeshStandardMaterial({ roughness: s.roughness, metalness: 0.04 });
  if (s.normalMap) {
    // No tangent attribute: three.js derives the tangent frame per pixel from the UVs, which also holds on the
    // mirrored left side. glTF normal maps then need a flipped green channel (as GLTFLoader does).
    m.normalMap = s.normalMap;
    m.normalScale.set(s.normalScale, -s.normalScale);
  }
  m.side = variant === BACK ? THREE.BackSide : variant === FRONT ? THREE.FrontSide : s.side;
  // Only reached by see-through double-sided meshes at or below SINGLE_PASS_BELOW; the rest get a back/front pair.
  m.forceSinglePass = true;
  return m;
}
