import { beforeAll, describe, expect, it } from 'vitest';
import { bakedSkin, deviation, endsOf, loadModels, poseMatrices, runtimeSkin, type Models } from '../scripts/lib/muscleSkin';

/** Largest distance (metres) a baked vertex may land from where the runtime skin puts it: weight bytes and 14-bit positions. */
const TOLERANCE = 0.0015;

describe('baked skin of the Open 3D Model muscles', () => {
  let m: Models;
  let poses: Float64Array[];
  beforeAll(async () => {
    m = await loadModels('public/models');
    poses = poseMatrices(m.rig);
  }, 60_000);

  it('every Open 3D Model muscle carries a skin and strain ends; BodyParts3D muscles are left to the viewer', () => {
    const o3d = m.list.filter((s) => s.kind === 'muscle' && s.source === 'o3d');
    expect(o3d.length).toBeGreaterThan(100);
    for (const s of o3d) {
      expect(s.skin, s.id).toBeDefined();
      for (const id of s.skin!) expect(m.rig.nodes.has(id), `${s.id} ${id}`).toBe(true);
      for (const p of m.geo.get(s.id)!) { expect(p.joints, s.id).toBeDefined(); expect(p.weights, s.id).toBeDefined(); }
    }
    expect(m.list.filter((s) => s.kind === 'muscle' && s.source === 'bp3d').every((s) => !s.skin)).toBe(true);
  });

  // the quadriceps (rides on the patella), a digit tendon (follows the finger bones), the long toe flexor (the foot and toes)
  // and a muscle of the trunk
  for (const id of ['rectus-femoris-l', 'vastus-lateralis-r', 'extensor-digitorum-l', 'flexor-digitorum-longus-l', 'flexor-pollicis-longus-r', 'erector-spinae-l']) {
    it(`${id}: posed with the baked skin it lands within ${TOLERANCE * 1000} mm of the runtime skin, with the same strain ends`, () => {
      const s = m.byId.get(id);
      if (!s) return; // not part of this model build
      const parts = m.geo.get(id)!;
      const rt = runtimeSkin(s, parts, m.rig, m.prox);
      const dev = deviation(parts, bakedSkin(s, parts, m.rig), rt.skin, poses);
      expect(dev.max).toBeLessThan(TOLERANCE);
      const baked = endsOf(s, parts, rt.res, m.rig), runtime = endsOf({ ...s, strainEnds: undefined }, parts, rt.res, m.rig);
      expect(!!baked).toBe(!!runtime);
      if (baked && runtime) {
        expect(baked.bones).toEqual(runtime.bones);
        baked.at.forEach((p, k) => expect(p.distanceTo(runtime.at[k])).toBeLessThan(0.0005));
      }
    });
  }

  it('a digit tendon is handed to the finger bones: its skin reaches beyond the muscle chain', () => {
    const s = m.byId.get('extensor-digitorum-l');
    if (!s) return;
    expect(s.skin!.some((n) => /^(index|middle|ring|little)-(proximal|middle|distal)-l$/.test(n))).toBe(true);
  });

  it('the quadriceps tendon rides on the patella', () => {
    const s = m.byId.get('rectus-femoris-l');
    if (!s) return;
    expect(s.skin).toContain('patella-l');
  });
});
