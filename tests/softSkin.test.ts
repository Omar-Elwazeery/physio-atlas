import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Rig } from '../app/lib/rig/rig';
import { ARC_JOINTS, ARC_STEPS, BULGE_JOINTS, arcNodeIds, bulgeNodeIds, bulgeScale } from '../app/lib/rig/spec';
import { KEEP_OUT_TOL, attachNodes, resolveSkin, skinAttach } from '../app/lib/rig/skinning';
import { BoneProximity } from '../app/lib/rig/proximity';
import { hasMuscleInfo, muscleInfo } from '../app/lib/data/muscles';
import { byId } from './fixtures';

const deg = (q: THREE.Quaternion) => THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(q.w))));

describe('arc nodes', () => {
  const rig = new Rig(byId);
  it('every large joint has its arc nodes on the joint centre, under the same parent, carrying nothing', () => {
    for (const id of ARC_JOINTS) for (const side of ['l', 'r'] as const) {
      const of = rig.node(`${id}-${side}`);
      const arcs = arcNodeIds(id, side).map((a) => rig.node(a));
      expect(arcs).toHaveLength(ARC_STEPS);
      for (const a of arcs) {
        expect(a.parent).toBe(of.parent);
        expect(a.pivot.distanceTo(of.pivot)).toBeLessThan(1e-9);
        expect(a.carries).toEqual([]);
      }
    }
  });
  it('turn by equal fractions of their joint, and are scaled to make up what a blend between two of them loses', () => {
    rig.pose({ 'hip.flexion-extension.l': 120 });
    const step = 120 / (ARC_STEPS + 1);
    arcNodeIds('femur', 'l').forEach((id, i) => {
      const b = rig.node(id).bone;
      expect(deg(b.quaternion)).toBeCloseTo((i + 1) * step, 4);
      expect(b.scale.x).toBeCloseTo(1 / Math.cos(THREE.MathUtils.degToRad(step / 2)), 6);
    });
    // the other side and the bones themselves are untouched
    expect(rig.node('femur-arc1-r').bone.scale.x).toBe(1);
    expect(rig.node('femur-l').bone.scale.x).toBe(1);
    rig.pose({});
    for (const id of arcNodeIds('femur', 'l')) { expect(deg(rig.node(id).bone.quaternion)).toBeCloseTo(0, 6); expect(rig.node(id).bone.scale.x).toBe(1); }
  });
  it('a point blended half-way between two arc nodes keeps its distance from the joint centre', () => {
    rig.pose({ 'hip.flexion-extension.l': 120 });
    const c = rig.node('femur-l').pivot, p = c.clone().add(new THREE.Vector3(0, 0, 0.03));
    const at = (id: string) => { const n = rig.node(id); return p.clone().applyMatrix4(rig.skeleton.boneInverses[n.index]).applyMatrix4(n.bone.matrixWorld); };
    const centre = c.clone().applyMatrix4(rig.skeleton.boneInverses[rig.node('pelvis').index]).applyMatrix4(rig.node('pelvis').bone.matrixWorld);
    const mid = at('femur-arc1-l').add(at('femur-arc2-l')).multiplyScalar(0.5);
    expect(mid.distanceTo(centre)).toBeCloseTo(0.03, 5);
    // the plain blend of pelvis and femur at 120 degrees would be at half the distance
    const plain = at('pelvis').add(at('femur-l')).multiplyScalar(0.5);
    expect(plain.distanceTo(centre)).toBeCloseTo(0.015, 4);
    rig.pose({});
  });
  it('join an attach skin only where it spans their joint', () => {
    expect(attachNodes(['pelvis', 'femur-l'], rig)).toEqual(['pelvis', 'femur-l', ...arcNodeIds('femur', 'l')]);
    expect(attachNodes(['femur-l', 'patella-l'], rig)).toEqual(['femur-l', 'patella-l']);
    expect(attachNodes(['tibia-l', 'fibula-l'], rig)).toEqual(['tibia-l', 'fibula-l']);
  });
});

describe('bulge nodes (elbow)', () => {
  const rig = new Rig(byId);
  it('one twin for the parent, each arc node and the joint, joining the elbow attach skin', () => {
    const ids = bulgeNodeIds('ulna', 'l');
    expect(ids).toHaveLength(ARC_STEPS + 2);
    expect(attachNodes(['humerus-l', 'ulna-l'], rig)).toEqual(['humerus-l', 'ulna-l', ...arcNodeIds('ulna', 'l'), ...ids]);
    for (const id of ids) expect(rig.node(id).pivot.distanceTo(rig.node('ulna-l').pivot)).toBeLessThan(1e-9);
  });
  it('turn as their twin does and push a point out from the hinge axis, not along it; next to nothing straight', () => {
    // straight is a few degrees from the bind pose (the model rests slightly flexed): a few percent at most
    rig.pose({});
    for (const id of bulgeNodeIds('ulna', 'l')) expect(rig.node(id).bone.scale.y).toBeLessThan(1.05);
    rig.pose({ 'elbow.flexion-extension.l': 150 });
    const c = rig.node('ulna-l').pivot, p = c.clone().add(new THREE.Vector3(0.01, 0, 0.02));
    const at = (id: string) => { const n = rig.node(id); return p.clone().applyMatrix4(rig.skeleton.boneInverses[n.index]).applyMatrix4(n.bone.matrixWorld); };
    const hum = rig.node('humerus-l');
    const local = (q: THREE.Vector3) => q.applyMatrix4(hum.bone.matrixWorld.clone().invert()).add(hum.pivot);
    const ids = bulgeNodeIds('ulna', 'l'), k = BULGE_JOINTS.ulna;
    const angle = THREE.MathUtils.degToRad(deg(rig.node('ulna-l').bone.quaternion));
    for (const [plain, twin] of [['humerus-l', ids[0]], ['ulna-l', ids[ids.length - 1]]]) {
      const a = local(at(plain)).sub(c), b = local(at(twin)).sub(c);
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(Math.hypot(b.y, b.z) / Math.hypot(a.y, a.z)).toBeCloseTo(bulgeScale(k, angle), 5);
      expect(Math.atan2(b.y, b.z)).toBeCloseTo(Math.atan2(a.y, a.z), 5);
    }
    rig.pose({});
  });
});

describe('wrist in two levels', () => {
  const rig = new Rig(byId);
  it('the proximal carpal row is its own node between the radius and the hand', () => {
    expect(rig.carriedBy.get('carpal-lunate-l')).toBe('carpus-l');
    expect(rig.carriedBy.get('carpal-pisiform-l')).toBe('carpus-l');
    expect(rig.carriedBy.get('carpal-capitate-l')).toBe('hand-l');
    expect(rig.carriedBy.get('metacarpal-3-l')).toBe('hand-l');
    expect(rig.node('hand-l').parent).toBe('carpus-l');
    expect(rig.node('carpus-l').parent).toBe('radius-l');
  });
  it('wrist flexion is shared: the proximal row turns half as far as the hand', () => {
    rig.pose({ 'wrist.flexion-extension.l': 80 });
    const rel = (id: string) => rig.node(id).bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(rig.node('radius-l').bone.getWorldQuaternion(new THREE.Quaternion()).invert());
    expect(deg(rel('carpus-l'))).toBeCloseTo(40, 4);
    expect(deg(rel('hand-l'))).toBeCloseTo(80, 4);
    rig.pose({});
  });
  it('a forearm muscle chain crosses both levels; a hand muscle chain is unchanged', () => {
    const fcr = byId.get('flexor-carpi-radialis-l')!;
    const spec = resolveSkin(fcr, rig, muscleInfo(fcr.key));
    expect(spec.mode).toBe('chain');
    if (spec.mode === 'chain') {
      const i = spec.nodes.indexOf('hand-l');
      expect(i).toBeGreaterThan(0);
      expect(spec.nodes[i - 1]).toBe('carpus-l');
    }
    for (const s of byId.values()) {
      if (s.kind !== 'muscle' || !hasMuscleInfo(s.key)) continue;
      const sk = resolveSkin(s, rig, muscleInfo(s.key));
      if (sk.mode === 'chain' && /^hand-/.test(sk.nodes[0])) expect(sk.nodes.some((n) => n.startsWith('carpus-')), s.id).toBe(false);
    }
  });
});

describe('baked skins of the big joints', () => {
  const rig = new Rig(byId);
  it('the capsules of the shoulder, elbow, hip and knee are laid along the arc nodes', () => {
    for (const [id, joint] of [['glenohumeral-capsule-l', 'humerus'], ['elbow-capsule-l', 'ulna'], ['hip-capsule-l', 'femur'], ['knee-capsule-l', 'tibia'], ['hip-capsule-r', 'femur']] as const) {
      const s = byId.get(id)!;
      for (const a of arcNodeIds(joint, s.side)) expect(s.skin, id).toContain(a);
      for (const n of s.skin!) expect(rig.nodes.has(n), n).toBe(true);
    }
  });
});

describe('skinAttach on a strip across the hip', () => {
  // A strip of quads from the acetabular rim (on the hip bone) over the femoral head to the femoral neck: its ends
  // are held by the bones, the weights run across, and the arc nodes take the middle.
  const rig = new Rig(byId);
  const pelvis = rig.node('pelvis'), femur = rig.node('femur-l');
  const c = femur.pivot;
  // stand-in bones: a few points 1 mm under each end of the strip
  const a = new THREE.Vector3(-0.03, 0.02, 0).add(c), b = new THREE.Vector3(0.03, -0.02, 0).add(c);
  const cloud = (p: THREE.Vector3) => { const out: number[] = []; for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) out.push(p.x + i * 0.001, p.y + j * 0.001, p.z - 0.001); return new Float32Array(out); };
  const prox = new BoneProximity((node) => (node === pelvis.index ? [cloud(a)] : node === femur.index ? [cloud(b)] : []));
  const N = 24, pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= N; i++) for (const w of [-0.004, 0.004]) { const p = a.clone().lerp(b, i / N); pos.push(p.x, p.y + w, p.z); }
  for (let i = 0; i < N; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setIndex(idx);
  const nodes = attachNodes(['pelvis', 'femur-l'], rig);
  skinAttach([geom], nodes, rig, prox);
  const si = geom.getAttribute('skinIndex').array, sw = geom.getAttribute('skinWeight').array;
  const weightOf = (v: number, node: number) => { let w = 0; for (let k = 0; k < 4; k++) if (si[v * 4 + k] === node) w += sw[v * 4 + k]; return w; };
  it('holds the ends on their bones', () => {
    expect(weightOf(0, pelvis.index)).toBeCloseTo(1, 5);
    expect(weightOf(N * 2, femur.index)).toBeCloseTo(1, 5);
  });
  it('gives every vertex weights that add up to 1, on at most two neighbouring nodes of the arc', () => {
    const order = [pelvis.index, ...arcNodeIds('femur', 'l').map((id) => rig.node(id).index), femur.index];
    for (let v = 0; v <= N * 2 + 1; v++) {
      let sum = 0;
      const used: number[] = [];
      for (let k = 0; k < 4; k++) if (sw[v * 4 + k] > 1e-6) { sum += sw[v * 4 + k]; used.push(order.indexOf(si[v * 4 + k])); }
      expect(sum).toBeCloseTo(1, 5);
      expect(used.every((u) => u >= 0)).toBe(true);
      expect(used.length).toBeLessThanOrEqual(2);
      if (used.length === 2) expect(Math.abs(used[0] - used[1])).toBe(1);
    }
  });
  it('runs from the pelvis to the femur without going back', () => {
    const order = [pelvis.index, ...arcNodeIds('femur', 'l').map((id) => rig.node(id).index), femur.index];
    const along = (v: number) => { let t = 0; for (let k = 0; k < 4; k++) t += sw[v * 4 + k] * order.indexOf(si[v * 4 + k]); return t; };
    for (let i = 1; i <= N; i++) expect(along(i * 2)).toBeGreaterThanOrEqual(along((i - 1) * 2) - 1e-4);
    expect(along(N)).toBeGreaterThan(0.5);
    expect(along(N)).toBeLessThan(order.length - 1.5);
  });
});

describe('skinAttach keep-out (step 7)', () => {
  // The same strip, with a stand-in femur that fills the space just behind the femoral half of the strip (z below the
  // joint centre, x beyond 1 cm short of it): as the hip turns, the part of the strip that lags behind the femur would
  // sink into it. With `inside` (and the release poses) the skin bounds those vertices' share along the arc, so none
  // goes in.
  const rig = new Rig(byId);
  const pelvis = rig.node('pelvis'), femur = rig.node('femur-l');
  const c = femur.pivot;
  const a = new THREE.Vector3(-0.03, 0.02, 0).add(c), b = new THREE.Vector3(0.03, -0.02, 0).add(c);
  const cloud = (p: THREE.Vector3) => { const out: number[] = []; for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) out.push(p.x + i * 0.001, p.y + j * 0.001, p.z - 0.001); return new Float32Array(out); };
  const prox = new BoneProximity((node) => (node === pelvis.index ? [cloud(a)] : node === femur.index ? [cloud(b)] : []));
  const inside = (node: number, x: number, _y: number, z: number) => (node === femur.index && x > c.x - 0.01 ? Math.max(0, c.z - z) : 0);
  const strip = () => {
    const N = 24, pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= N; i++) for (const w of [-0.004, 0.004]) { const p = a.clone().lerp(b, i / N); pos.push(p.x, p.y + w, p.z); }
    for (let i = 0; i < N; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  };
  /** Deepest any vertex of the skinned strip goes into the stand-in femur, over the hip's ends of range. */
  const deepest = (g: THREE.BufferGeometry) => {
    const pos = g.getAttribute('position').array, si = g.getAttribute('skinIndex').array, sw = g.getAttribute('skinWeight').array;
    let worst = 0;
    const poses: Record<string, number>[] = [{ 'hip.flexion-extension.l': 120 }, { 'hip.flexion-extension.l': -30 }, { 'hip.rotation.l': 45 }, { 'hip.rotation.l': -45 }];
    for (const pose of poses) {
      rig.pose(pose);
      const toBind = new THREE.Matrix4().multiplyMatrices(femur.bone.matrixWorld, rig.skeleton.boneInverses[femur.index]).invert();
      for (let v = 0; v < pos.length / 3; v++) {
        const p = new THREE.Vector3(), q = new THREE.Vector3();
        for (let k = 0; k < 4; k++) {
          if (!sw[v * 4 + k]) continue;
          const bone = rig.bones[si[v * 4 + k]];
          q.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]).applyMatrix4(rig.skeleton.boneInverses[si[v * 4 + k]]).applyMatrix4(bone.matrixWorld);
          p.addScaledVector(q, sw[v * 4 + k]);
        }
        p.applyMatrix4(toBind);
        worst = Math.max(worst, inside(femur.index, p.x, p.y, p.z));
      }
    }
    rig.pose({});
    return worst;
  };
  const nodes = attachNodes(['pelvis', 'femur-l'], rig);
  it('without it, the strip sinks into the bone', () => {
    const g = strip();
    skinAttach([g], nodes, rig, prox, { release: true });
    expect(deepest(g)).toBeGreaterThan(0.003);
  });
  it('with it, no vertex goes in further than the tolerance', () => {
    const g = strip();
    skinAttach([g], nodes, rig, prox, { release: true, inside });
    expect(deepest(g)).toBeLessThan(KEEP_OUT_TOL + 1e-4);
  });
});
