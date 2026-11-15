import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MaterialPool, SINGLE_PASS_BELOW, type Look } from '../app/lib/three/materials';

const look = (o: Partial<Look> = {}): Look => ({ color: 0xe4d8c2, tinted: false, emissive: 0, emissiveIntensity: 0.28, opacity: 1, ...o });
const mesh = () => new THREE.Mesh(new THREE.BufferGeometry());
const tex = () => new THREE.Texture();
const std = (m: THREE.Material | THREE.Material[]) => m as THREE.MeshStandardMaterial;

describe('MaterialPool', () => {
  it('gives meshes with the same surface and look the same material', () => {
    const pool = new MaterialPool();
    const s = pool.surface(0.62, null, null, 0.9, THREE.DoubleSide);
    expect(pool.surface(0.62, null, null, 0.9, THREE.DoubleSide)).toBe(s);
    const a = mesh(), b = mesh(), c = mesh();
    pool.apply(a, s, look());
    pool.apply(b, s, look());
    pool.apply(c, s, look({ color: 0xff0000 }));
    expect(a.material).toBe(b.material);
    expect(c.material).not.toBe(a.material);
    expect(std(a.material).color.getHex()).toBe(0xe4d8c2);
    expect(std(a.material).transparent).toBe(false);
    expect(std(a.material).depthWrite).toBe(true);
    expect(std(a.material).side).toBe(THREE.DoubleSide);
    expect(pool.size).toBe(2);
  });

  it('keeps surfaces with different textures, roughness or side apart', () => {
    const pool = new MaterialPool();
    const n1 = tex(), n2 = tex();
    const keys = new Set([
      pool.surface(0.62, null, null, 0.9, THREE.DoubleSide), pool.surface(0.5, null, null, 0.9, THREE.DoubleSide),
      pool.surface(0.62, null, n1, 0.9, THREE.DoubleSide), pool.surface(0.62, null, n2, 0.9, THREE.DoubleSide),
      pool.surface(0.62, n1, null, 0.9, THREE.DoubleSide), pool.surface(0.62, null, null, 0.9, THREE.FrontSide),
    ].map((s) => s.key));
    expect(keys.size).toBe(6);
  });

  it('ignores the emissive intensity of a mesh that does not glow, and the opacity of an opaque one', () => {
    const pool = new MaterialPool();
    const s = pool.surface(0.62, null, null, 0.9, THREE.DoubleSide);
    const a = mesh(), b = mesh();
    pool.apply(a, s, look({ emissiveIntensity: 0.28, opacity: 1 }));
    pool.apply(b, s, look({ emissiveIntensity: 0.5, opacity: 0.997 }));
    expect(a.material).toBe(b.material);
    pool.apply(b, s, look({ emissive: 0x7a55c8, emissiveIntensity: 0.5 }));
    expect(b.material).not.toBe(a.material);
    expect(std(b.material).emissive.getHex()).toBe(0x7a55c8);
    expect(std(b.material).emissiveIntensity).toBe(0.5);
  });

  it('draws a see-through double-sided mesh as back faces then front faces, over the whole mesh', () => {
    const pool = new MaterialPool();
    const s = pool.surface(0.62, null, null, 0.9, THREE.DoubleSide);
    const m = mesh();
    pool.apply(m, s, look({ opacity: 0.45 }));
    const pair = m.material as THREE.MeshStandardMaterial[];
    expect(Array.isArray(pair)).toBe(true);
    expect(pair.map((x) => x.side)).toEqual([THREE.BackSide, THREE.FrontSide]);
    for (const x of pair) { expect(x.transparent).toBe(true); expect(x.opacity).toBe(0.45); expect(x.depthWrite).toBe(false); }
    expect(m.geometry.groups).toEqual([{ start: 0, count: Infinity, materialIndex: 0 }, { start: 0, count: Infinity, materialIndex: 1 }]);
    // a second mesh in the same state shares the pair itself
    const n = mesh();
    pool.apply(n, s, look({ opacity: 0.45 }));
    expect(n.material).toBe(m.material);
    // above the depth-write threshold the pair writes depth
    pool.apply(n, s, look({ opacity: 0.8 }));
    expect((n.material as THREE.MeshStandardMaterial[]).every((x) => x.depthWrite)).toBe(true);
    // back to opaque: one double-sided material again, and the groups do no harm
    pool.apply(m, s, look());
    expect(Array.isArray(m.material)).toBe(false);
    expect(std(m.material).side).toBe(THREE.DoubleSide);
  });

  it('draws faint ghosts in one pass and closed sacs front faces only', () => {
    const pool = new MaterialPool();
    const s = pool.surface(0.62, null, null, 0.9, THREE.DoubleSide);
    const ghost = mesh();
    pool.apply(ghost, s, look({ opacity: SINGLE_PASS_BELOW }));
    expect(Array.isArray(ghost.material)).toBe(false);
    expect(std(ghost.material).side).toBe(THREE.DoubleSide);
    expect(std(ghost.material).transparent).toBe(true);
    expect(std(ghost.material).forceSinglePass).toBe(true);
    const sac = pool.surface(0.35, null, null, 0.9, THREE.FrontSide);
    const bursa = mesh();
    pool.apply(bursa, sac, look({ opacity: 0.5 }));
    expect(Array.isArray(bursa.material)).toBe(false);
    expect(std(bursa.material).side).toBe(THREE.FrontSide);
    expect(std(bursa.material).transparent).toBe(true);
  });

  it('switches a fibre surface between its natural colours and a tint', () => {
    const pool = new MaterialPool();
    const s = pool.surface(0.62, tex(), null, 0.9, THREE.DoubleSide);
    const a = mesh(), b = mesh();
    pool.apply(a, s, look({ color: 0xffffff, tinted: false }));
    pool.apply(b, s, look({ color: 0xe0453a, tinted: true }));
    expect(a.material).not.toBe(b.material);
    expect(std(a.material).map).toBe(s.map);
    expect(std(a.material).userData.fibre.fibreTint.value).toBe(0);
    expect(std(b.material).userData.fibre.fibreTint.value).toBe(1);
  });

  it('sets a normal map with the green channel flipped', () => {
    const pool = new MaterialPool();
    const n = tex();
    const m = mesh();
    pool.apply(m, pool.surface(0.62, null, n, 0.9, THREE.DoubleSide), look());
    expect(std(m.material).normalMap).toBe(n);
    expect(std(m.material).normalScale.toArray()).toEqual([0.9, -0.9]);
  });

  it('drops unused materials only once it holds many, and never one in use', () => {
    const pool = new MaterialPool();
    const s = pool.surface(0.62, null, null, 0.9, THREE.DoubleSide);
    const m = mesh();
    pool.begin();
    for (let i = 0; i < 700; i++) pool.apply(m, s, look({ color: i }));
    pool.sweep();
    expect(pool.size).toBe(700); // all from the current pass
    pool.begin();
    pool.apply(m, s, look({ color: 5 }));
    const kept = m.material;
    let disposed = false;
    std(kept).addEventListener('dispose', () => { disposed = true; });
    pool.sweep();
    expect(pool.size).toBe(1);
    expect(disposed).toBe(false);
    pool.apply(m, s, look({ color: 5 }));
    expect(m.material).toBe(kept);
  });

  it('disposes its materials and the textures of its surfaces', () => {
    const pool = new MaterialPool();
    const n = tex();
    let gone = 0;
    n.addEventListener('dispose', () => { gone++; });
    const m = mesh();
    pool.apply(m, pool.surface(0.62, null, n, 0.9, THREE.DoubleSide), look());
    std(m.material).addEventListener('dispose', () => { gone++; });
    pool.dispose();
    expect(gone).toBe(2);
    expect(pool.size).toBe(0);
  });
});
