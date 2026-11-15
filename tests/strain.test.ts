import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  chainLength, endCentre, isObstacle, landmarkPoint, polylineLength, resolveEnds, resolveObstacle, resolveVias, strainPathLength, wrapCylinder, wrapPoint, wrapSphere,
  type BonePoint, type StrainPath, type ViaSource,
} from '../app/lib/strain';
import { MUSCLE_INFO } from '../app/lib/data/muscles';
import { loadStrain } from '../scripts/lib/strain';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('polylineLength', () => {
  it('adds the segments in order', () => {
    expect(polylineLength([v(0, 0, 0), v(3, 4, 0), v(3, 4, 12)])).toBeCloseTo(17, 12);
    expect(polylineLength([v(1, 2, 3)])).toBe(0);
    expect(polylineLength([])).toBe(0);
  });
});

describe('wrapPoint', () => {
  const a = v(0, 0, 0);
  const c = v(10, 0, 0);
  it('is the vertex nearest to the segment, not to either end', () => {
    // flat xyz arrays, as a mesh holds them
    const bone = [new Float32Array([5, 3, 0, 4, 0.5, 0, 6, -2, 0]), new Float32Array([9, 1, 0])];
    expect(wrapPoint(bone, a, c)!.toArray()).toEqual([4, 0.5, 0]);
  });
  it('measures to the segment, which stops at its ends', () => {
    const bone = [new Float32Array([-1, 1, 0, 13, 0, 0])];
    expect(wrapPoint(bone, a, c)!.toArray()).toEqual([-1, 1, 0]);
  });
  it('has nothing to offer for a bone without vertices, and copes with a zero-length line', () => {
    expect(wrapPoint([], a, c)).toBeNull();
    expect(wrapPoint([new Float32Array([1, 2, 3, 0, 0, 1])], a, a)!.toArray()).toEqual([0, 0, 1]);
  });
});

/**
 * A knee on its own (x axis through the origin, y up, z forward): the thigh bone 0 stays, the shin bone 1 turns by the
 * angle, the patella bone 2 by half of it (as the rig's patellar track does). The numbers are the left quadriceps of the
 * model: origin 38 cm above the knee on the femur, insertion on the tibia 7.5 cm below the axis in front of it.
 */
describe('a muscle over the front of a hinge', () => {
  const turn = (deg: number) => new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(deg));
  const knee = (flexion: number) => {
    const m = [new THREE.Matrix4(), turn(flexion), turn(flexion / 2)];
    return (p: THREE.Vector3, bone: number) => p.clone().applyMatrix4(m[bone]);
  };
  const straight: StrainPath = { p0: v(0, 0.38, 0.043), b0: 0, p1: v(0, -0.075, 0.038), b1: 1 };
  const wrapped: StrainPath = { ...straight, vias: [{ p: v(0, -0.01, 0.04), b: 2 }] };
  const change = (path: StrainPath, deg: number) => strainPathLength(path, knee(deg)) / strainPathLength(path, knee(0)) - 1;

  it('reads shorter in flexion along the straight line, because the line cuts across the corner', () => {
    expect(change(straight, 90)).toBeLessThan(-0.03);
  });
  it('reads longer in flexion over the patella, by about a tenth at 90 degrees', () => {
    expect(change(wrapped, 90)).toBeGreaterThan(0.08);
    expect(change(wrapped, 90)).toBeLessThan(0.16);
  });
  it('is the sum of the two legs, each measured between its own two bones', () => {
    const at = knee(90);
    const via = at((wrapped.vias![0] as BonePoint).p, 2);
    expect(strainPathLength(wrapped, at)).toBeCloseTo(at(wrapped.p0, 0).distanceTo(via) + via.distanceTo(at(wrapped.p1, 1)), 12);
  });
  it('is the straight line without a wrap point', () => {
    const at = knee(60);
    expect(strainPathLength(straight, at)).toBeCloseTo(at(straight.p0, 0).distanceTo(at(straight.p1, 1)), 12);
  });
});

describe('the model: muscles that run over a bone', () => {
  let model: Awaited<ReturnType<typeof loadStrain>>;
  beforeAll(async () => { model = await loadStrain('public/models'); }, 60_000);

  it('every muscle with a strainWrap finds a wrap point on that bone, on each side', () => {
    const wrapKeys = Object.entries(MUSCLE_INFO).filter(([, m]) => m.strainWrap).map(([k]) => k);
    expect(wrapKeys.length).toBeGreaterThan(0);
    for (const k of wrapKeys) {
      const ids = model.list.filter((s) => s.kind === 'muscle' && s.key === k).map((s) => s.id);
      expect(ids.length, k).toBeGreaterThan(0);
      for (const id of ids) expect(model.wrapped.get(id)?.vias?.length, id).toBe(1);
    }
  });

  it.each(['l', 'r'] as const)('the quadriceps (%s) lengthen in knee flexion, which the straight line misreads as shortening', (side) => {
    const key = `knee.flexion-extension.${side}`;
    const ids = ['rectus-femoris', 'vastus-lateralis', 'vastus-medialis', 'vastus-intermedius'].map((k) => `${k}-${side}`);
    model.rig.pose({});
    for (const id of ids) expect(Math.abs(model.strain(id)), id).toBeLessThan(1e-9);
    for (const angle of [45, 90, 130]) {
      model.rig.pose({ [key]: angle });
      for (const id of ids) expect(model.strain(id, 'wrap'), `${id} at ${angle}`).toBeGreaterThan(0.01);
    }
    model.rig.pose({ [key]: 90 });
    for (const id of ids) expect(model.strain(id, 'straight'), `${id} straight`).toBeLessThan(0);
  });

  it('the rectus femoris still shortens in hip flexion, where it is a prime mover', () => {
    model.rig.pose({ 'hip.flexion-extension.l': 90 });
    expect(model.strain('rectus-femoris-l', 'wrap')).toBeLessThan(-0.01);
  });

  it('the wrist extensors lengthen in wrist flexion', () => {
    model.rig.pose({ 'wrist.flexion-extension.l': 52 });
    for (const id of ['extensor-carpi-radialis-longus-l', 'extensor-carpi-radialis-brevis-l', 'extensor-carpi-ulnaris-l']) {
      expect(model.strain(id, 'wrap'), id).toBeGreaterThan(0.01);
    }
  });

  it('every entry of a strainVias (landmark or wrapping surface) finds its bone, on each side', () => {
    const withVias = Object.entries(MUSCLE_INFO).filter(([, m]) => m.strainVias);
    expect(withVias.length).toBeGreaterThan(0);
    for (const [k, info] of withVias) {
      const ids = model.list.filter((s) => s.kind === 'muscle' && s.key === k).map((s) => s.id);
      expect(ids.length, k).toBeGreaterThan(0);
      for (const id of ids) expect(model.wrapped.get(id)?.vias?.length, id).toBe(info.strainVias!.length);
    }
  });

  // Each movement a muscle takes part in, at 75 % of its range (the movement table decides which way it should go).
  const moves: [string, Record<string, number>, number][] = [
    ['gluteus-maximus', { 'hip.flexion-extension': 90 }, +1],
    ['iliacus', { 'hip.flexion-extension': -22.5 }, +1],
    ['psoas-major', { 'hip.flexion-extension': -22.5 }, +1],
    ['deltoid', { 'shoulder.abduction-adduction': 135 }, -1],
    ['tibialis-posterior', { 'ankle.dorsiflexion-plantarflexion': -37.5 }, -1],
    ['flexor-hallucis-longus', { 'ankle.dorsiflexion-plantarflexion': -37.5 }, -1],
    ['flexor-digitorum-longus', { 'ankle.dorsiflexion-plantarflexion': -37.5 }, -1],
    ['fibularis-longus', { 'ankle.dorsiflexion-plantarflexion': -37.5 }, -1],
    ['flexor-hallucis-longus', { 'toes.ip': 60 }, -1],
    ['extensor-digitorum', { 'fingers.mcp': 67.5 }, +1],
    ['extensor-digiti-minimi', { 'fingers.mcp': 67.5 }, +1],
    // round wrapping surfaces (StrainObstacle), each with the opposite movement the muscle drives
    ['extensor-indicis', { 'fingers.mcp': 67.5 }, +1],
    ['extensor-indicis', { 'fingers.mcp': -22.5 }, -1],
    ['extensor-digitorum', { 'fingers.pip': 75 }, +1],
    ['extensor-digitorum', { 'fingers.dip': 60 }, +1],
    ['extensor-pollicis-longus', { 'thumb.thumb-ip': 60 }, +1],
    ['palmaris-longus', { 'wrist.flexion-extension': -52.5 }, +1],
    ['palmaris-longus', { 'wrist.flexion-extension': 60 }, -1],
    ['flexor-carpi-ulnaris', { 'wrist.flexion-extension': -52.5 }, +1],
    ['flexor-carpi-ulnaris', { 'wrist.flexion-extension': 60 }, -1],
    ['flexor-carpi-radialis', { 'wrist.flexion-extension': -52.5 }, +1],
    ['flexor-digitorum-longus', { 'toes.mtp': -52.5 }, +1],
    ['flexor-digitorum-longus', { 'toes.mtp': 30 }, -1],
    ['teres-major', { 'shoulder.rotation': -52.5 }, -1],
    // ends from bone landmarks (strainOrigin): the upper fibres of pectoralis major in early flexion
    ['pectoralis-major', { 'shoulder.flexion-extension': 60 }, -1],
    ['pectoralis-major', { 'shoulder.rotation': -52.5 }, -1],
  ];
  it.each(['l', 'r'] as const)('muscles bent round a landmark go the way the movement table says (%s)', (side) => {
    for (const [key, pose, sign] of moves) {
      const id = `${key}-${side}`;
      model.rig.pose(Object.fromEntries(Object.entries(pose).map(([dof, a]) => [`${dof}.${side}`, a])));
      const s = model.strain(id, 'wrap');
      expect(Math.sign(s) === sign && Math.abs(s) >= 0.01, `${id} ${JSON.stringify(pose)}: ${(s * 100).toFixed(1)} %`).toBe(true);
    }
  });

  // [muscle part, pose, the way its own line goes] from the movement table: each row names the part that acts
  const partMoves: [string, Record<string, number>, number][] = [
    ['deltoid/clavicular-part', { 'shoulder.flexion-extension': 60 }, -1],
    ['deltoid/clavicular-part', { 'shoulder.flexion-extension': -45 }, +1],
    ['deltoid/spinal-part', { 'shoulder.flexion-extension': -45 }, -1],
    ['deltoid/spinal-part', { 'shoulder.flexion-extension': 60 }, +1],
    ['deltoid/acromial-part', { 'shoulder.abduction-adduction': 90 }, -1],
    ['deltoid/acromial-part', { 'shoulder.abduction-adduction': -30 }, +1],
    ['pectoralis-major/clavicular-part', { 'shoulder.flexion-extension': 135 }, -1],
    ['pectoralis-major/clavicular-part', { 'shoulder.flexion-extension': -45 }, +1],
  ];
  it.each(['l', 'r'] as const)('the parts of the deltoid and pectoralis major each have a line, and go the way the table says for their part (%s)', (side) => {
    for (const [part, pose, sign] of partMoves) {
      const id = `${part.split('/')[0]}-${side}`;
      expect(model.parts.has(`${id}/${part.split('/')[1]}`), part).toBe(true);
      model.rig.pose(Object.fromEntries(Object.entries(pose).map(([dof, a]) => [`${dof}.${side}`, a])));
      const s = model.strain(`${id}/${part.split('/')[1]}`, 'wrap');
      expect(Math.sign(s) === sign && Math.abs(s) >= 0.01, `${id} ${part} ${JSON.stringify(pose)}: ${(s * 100).toFixed(1)} %`).toBe(true);
    }
  });
  it.each(['l', 'r'] as const)('a part line is its own: it starts on the bone the part arises from and ends on the humerus (%s)', (side) => {
    const bone = (k: string) => model.rig.bones[model.parts.get(k)!.b0].name;
    expect(bone(`deltoid-${side}/clavicular-part`)).toBe(`clavicle-${side}`);
    expect(bone(`deltoid-${side}/acromial-part`)).toBe(`scapula-${side}`);
    expect(bone(`deltoid-${side}/spinal-part`)).toBe(`scapula-${side}`);
    expect(bone(`pectoralis-major-${side}/clavicular-part`)).toBe(`clavicle-${side}`);
    for (const [k, p] of model.parts) if (k.endsWith(`-${side}/clavicular-part`) || k.includes(`-${side}/`)) expect(model.rig.bones[p.b1].name, k).toBe(`humerus-${side}`);
    // a muscle without part lines, or a row naming no part, reads on the whole muscle's line
    model.rig.pose({ [`shoulder.abduction-adduction.${side}`]: -30 });
    expect(model.strain(`pectoralis-major-${side}`)).toBe(model.strain(`pectoralis-major-${side}/no-such-part`));
  });
  it('landmarkPoint with skip takes the landmark from a band along the bone', () => {
    const bone = [new Float32Array([0, 10, 0, 5, 9, 0, 2, 6, 0, 1, 1, 0])];
    const lm = { near: 'superior' as const, toward: ['lateral' as const] };
    expect(landmarkPoint(bone, { ...lm, depth: 10 }, 'l')!.toArray()).toEqual([5, 9, 0]);
    expect(landmarkPoint(bone, { ...lm, skip: 3, depth: 5 }, 'l')!.toArray()).toEqual([2, 6, 0]);
  });

  it('the masseters, measured from the zygomatic bone to the angle of the mandible, lengthen as the mouth opens', () => {
    for (const id of ['masseter-l', 'masseter-r']) {
      const e = model.ends.get(id)!;
      expect(model.rig.bones[e.b0].name, id).toBe('skull');
      expect(model.rig.bones[e.b1].name, id).toBe('mandible');
      // the origin lies in front of the jaw joint and above the insertion, as the muscle runs down and back
      const tmj = model.rig.nodes.get('mandible')!.pivot;
      expect(e.p0.z, id).toBeGreaterThan(tmj.z);
      expect(e.p0.y, id).toBeGreaterThan(e.p1.y);
      model.rig.pose({ 'tmj.opening': 21 });
      expect(model.strain(id), id).toBeGreaterThan(0.05);
    }
  });

  it('every wrapping surface of the muscle data has a positive radius and a centre on its bone, on each side', () => {
    let n = 0;
    for (const p of model.wrapped.values()) {
      for (const e of p.vias ?? []) {
        if (!isObstacle(e)) continue;
        n++;
        expect(e.r).toBeGreaterThan(0.001);
        expect(e.r).toBeLessThan(0.03);
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe('wrapSphere', () => {
  const o = v(0, 0, 0);
  it('is the straight line when the line misses the sphere', () => {
    const w = wrapSphere(v(-2, 1.5, 0), v(2, 1.5, 0), o, 1);
    expect(w.length).toBeCloseTo(4, 12);
    expect(w.entry).toBeUndefined();
  });
  it('is tangent, great-circle arc, tangent when the line cuts it', () => {
    const p = v(-2, 0.5, 0);
    const s = v(2, 0.5, 0);
    const d = p.length();
    const arc = Math.PI - 2 * Math.atan(0.25) - 2 * Math.acos(1 / d);
    const w = wrapSphere(p, s, o, 1);
    expect(w.length).toBeCloseTo(2 * Math.sqrt(d * d - 1) + arc, 12);
    // over the side the line passed on, touching the sphere at the tangent points
    expect(w.entry!.length()).toBeCloseTo(1, 12);
    expect(w.entry!.y).toBeGreaterThan(0.5);
    expect(w.entry!.distanceTo(p) + w.arc! + w.exit!.distanceTo(s)).toBeCloseTo(w.length, 12);
  });
  it('picks a plane when the line runs through the centre, and wraps half way round less the tangents', () => {
    const w = wrapSphere(v(-2, 0, 0), v(2, 0, 0), o, 1);
    expect(w.length).toBeCloseTo(2 * Math.sqrt(3) + Math.PI / 3, 12);
  });
  it('is straight when an end lies inside the sphere, or the ends coincide', () => {
    expect(wrapSphere(v(-0.5, 0, 0), v(2, 0, 0), o, 1).length).toBeCloseTo(2.5, 12);
    expect(wrapSphere(v(2, 0, 0), v(2, 0, 0), o, 1).length).toBe(0);
  });
  it('rotates freely: the same answer for the same configuration turned and moved', () => {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.3, -1.1, 2)).setPosition(0.4, -2, 7);
    const a = wrapSphere(v(-2, 0.5, 0.2), v(2, 0.3, -0.1), o, 1).length;
    const b = wrapSphere(v(-2, 0.5, 0.2).applyMatrix4(m), v(2, 0.3, -0.1).applyMatrix4(m), o.clone().applyMatrix4(m), 1).length;
    expect(b).toBeCloseTo(a, 10);
  });
});

describe('wrapCylinder', () => {
  const o = v(0, 0, 0);
  const z = v(0, 0, 1);
  const flat = 2 * Math.sqrt(2 ** 2 + 0.5 ** 2 - 1) + Math.PI - 2 * Math.atan(0.25) - 2 * Math.acos(1 / Math.hypot(2, 0.5));
  it('is the straight line when the line misses the cylinder', () => {
    expect(wrapCylinder(v(-2, 1.5, 0), v(2, 1.5, 3), o, z, 1).length).toBeCloseTo(Math.hypot(4, 3), 12);
  });
  it('wraps round the near side as a circle does, across the axis', () => {
    expect(wrapCylinder(v(-2, 0.5, 0), v(2, 0.5, 0), o, z, 1).length).toBeCloseTo(flat, 12);
  });
  it('runs as a helix along the axis: unrolled, the path is a straight line', () => {
    const w = wrapCylinder(v(-2, 0.5, -1), v(2, 0.5, 2), o, z, 1);
    expect(w.length).toBeCloseTo(Math.hypot(flat, 3), 12);
    expect(w.entry!.distanceTo(v(-2, 0.5, -1)) + w.arc! + w.exit!.distanceTo(v(2, 0.5, 2))).toBeCloseTo(w.length, 12);
    // the tangent points lie on the surface
    expect(Math.hypot(w.entry!.x, w.entry!.y)).toBeCloseTo(1, 12);
  });
  it('with a side, wraps over that side even when the line passes the other, and not when it clears that side', () => {
    // the line passes under the axis; held to the top, the path goes over it, the long way
    const forced = wrapCylinder(v(-2, -0.5, 0), v(2, -0.5, 0), o, z, 1, v(0, 1, 0));
    const d = Math.hypot(2, 0.5);
    expect(forced.length).toBeCloseTo(2 * Math.sqrt(d * d - 1) + Math.PI + 2 * Math.atan(0.25) - 2 * Math.acos(1 / d), 12);
    expect(forced.entry!.y).toBeGreaterThan(0);
    // without a side it takes the short way, under the axis (the same length by symmetry, on the other side)
    expect(wrapCylinder(v(-2, -0.5, 0), v(2, -0.5, 0), o, z, 1).entry!.y).toBeLessThan(0);
    // clear of the cylinder on the held side: straight
    expect(wrapCylinder(v(-2, 1.5, 0), v(2, 1.5, 0), o, z, 1, v(0, 1, 0)).length).toBeCloseTo(4, 12);
    // beyond the cylinder (both ends to one side of it): straight, even with the line below the axis
    expect(wrapCylinder(v(2, -1, 0), v(4, -1, 0), o, z, 1, v(0, 1, 0)).length).toBeCloseTo(2, 12);
  });
  it('is continuous as the line comes onto the cylinder', () => {
    const at = (y: number) => wrapCylinder(v(-2, y, 0), v(2, y, 0), o, z, 1, v(0, 1, 0)).length;
    expect(at(1 - 1e-7)).toBeCloseTo(at(1 + 1e-7), 6);
    expect(at(1 + 1e-7)).toBeCloseTo(4, 6);
  });
  it('is straight when an end lies inside the cylinder', () => {
    expect(wrapCylinder(v(0.2, 0.2, 5), v(3, 0, 0), o, z, 1).length).toBeCloseTo(v(0.2, 0.2, 5).distanceTo(v(3, 0, 0)), 12);
  });
  it('turns a tendon over a pulley by radius x angle: a hinge flexed by 90 degrees adds r x pi/2', () => {
    // a tendon along the back (-z) of a hinge (axis x at the origin), 1 cm from the axis, ends 10 cm either side; the
    // distal end swings forward by 90 degrees, the tendon stays on the outside of the bend
    const r = 0.01;
    const back = v(0, 0, -1);
    const rest = wrapCylinder(v(0, 0.1, -r), v(0, -0.1, -r), o, v(1, 0, 0), r, back).length;
    const bent = wrapCylinder(v(0, 0.1, -r), v(0, -r, 0.1), o, v(1, 0, 0), r, back).length;
    expect(rest).toBeCloseTo(0.2, 12);
    expect(bent - rest).toBeCloseTo((r * Math.PI) / 2, 12);
  });
});

describe('chainLength', () => {
  it('runs over two cylinders in a row along their common tangent', () => {
    // pulleys of radius 0.5 at x = -1 and x = 1, held to the top; ends 3 units out on the axis line
    const cyl = (x: number) => ({ shape: 'cylinder' as const, c: v(x, 0, 0), r: 0.5, axis: v(0, 0, 1), side: v(0, 1, 0) });
    const d = 2;
    const tangent = Math.sqrt(d * d - 0.25);
    const arc = 0.5 * (Math.PI / 2 - Math.acos(0.5 / d));
    expect(chainLength(v(-3, 0, 0), v(3, 0, 0), [cyl(-1), cyl(1)])).toBeCloseTo(2 * (tangent + arc) + 2, 9);
  });
  it('is the straight line without obstacles, or when none is touched', () => {
    expect(chainLength(v(0, 0, 0), v(3, 4, 0), [])).toBe(5);
    expect(chainLength(v(-3, 2, 0), v(3, 2, 0), [{ shape: 'sphere', c: v(0, 0, 0), r: 1 }])).toBeCloseTo(6, 12);
  });
});

describe('strainPathLength with a wrapping surface', () => {
  it('wraps the segment between the fixed points the surface stands in, and leaves the others straight', () => {
    const at = (p: THREE.Vector3) => p.clone();
    const path: StrainPath = { p0: v(-2, 0.5, 5), b0: 0, p1: v(2, 0.5, 0), b1: 0, vias: [{ p: v(-2, 0.5, 0), b: 0 }, { shape: 'cylinder', c: v(0, 0, 0), b: 0, r: 1, axis: v(0, 0, 1) }] };
    expect(strainPathLength(path, at)).toBeCloseTo(5 + wrapCylinder(v(-2, 0.5, 0), v(2, 0.5, 0), v(0, 0, 0), v(0, 0, 1), 1).length, 12);
  });
  it('carries the surface with its bone: turning everything together changes nothing', () => {
    const m = new THREE.Matrix4().makeRotationY(0.7);
    const path: StrainPath = { p0: v(-2, 0.5, 0), b0: 0, p1: v(2, 0.5, 1), b1: 0, vias: [{ shape: 'cylinder', c: v(0, 0, 0), b: 0, r: 1, axis: v(0, 0, 1), side: v(0, 1, 0) }] };
    expect(strainPathLength(path, (p) => p.clone().applyMatrix4(m))).toBeCloseTo(strainPathLength(path, (p) => p.clone()), 12);
  });
});

describe('resolveObstacle and resolveEnds', () => {
  const bones: Record<string, { positions: Float32Array[]; bone: number; pivot?: THREE.Vector3 }> = {
    'humerus-l': { positions: [new Float32Array([0, 0, 0])], bone: 5, pivot: v(0, 1, 0) },
    'ulna-l': { positions: [new Float32Array([0, 0, 0])], bone: 6, pivot: v(0, 0, 0) },
    // a bone end 2 cm wide: vertices at y 0 (the end) and y 0.05
    'metatarsal-1-l': { positions: [new Float32Array([0, 0, 0, 0, 0.02, 0, 0, 0.01, 0.01, 0, 0.05, 0])], bone: 9 },
  };
  const src: ViaSource = { structure: (id) => bones[id], node: (id) => bones[id] };
  it('centres a cylinder on a joint, along an axis or towards another joint, with a radius read off a landmark', () => {
    const o = resolveObstacle({ wrap: 'cylinder', joint: 'humerus', axis: { to: 'ulna' }, radius: 0.009, side: 'medial' }, 'l', src)!;
    expect(o.b).toBe(5);
    expect(o.c.toArray()).toEqual([0, 1, 0]);
    expect(o.axis!.toArray()).toEqual([0, -1, 0]);
    expect(o.side!.toArray()).toEqual([-1, 0, 0]);
    const lm = resolveObstacle({ wrap: 'cylinder', joint: 'humerus', axis: 'y', radius: { bone: 'metatarsal-1', toward: ['anterior'] } }, 'l', src)!;
    // the landmark (0, 0.01, 0.01) is 1 cm from the vertical axis through (0, 1, 0)
    expect(lm.r).toBeCloseTo(0.01, 7);
  });
  it('centres on the end of a bone, and gives up when the joint or bone is missing', () => {
    expect(endCentre(bones['metatarsal-1-l'].positions, 'inferior', 0.012, 'l')!.toArray().map((x) => +x.toFixed(6))).toEqual([0, 0.005, 0.005]);
    const o = resolveObstacle({ wrap: 'sphere', centre: { bone: 'metatarsal-1', near: 'inferior', depth: 0.012 }, radius: 0.004 }, 'l', src)!;
    expect(o.b).toBe(9);
    expect(resolveObstacle({ wrap: 'sphere', joint: 'femur', radius: 0.01 }, 'l', src)).toBeNull();
    expect(resolveObstacle({ wrap: 'cylinder', joint: 'humerus', axis: { to: 'tibia' }, radius: 0.01 }, 'l', src)).toBeNull();
  });
  it('replaces an end named as a landmark and keeps the other', () => {
    const path: StrainPath = { p0: v(1, 1, 1), b0: 1, p1: v(2, 2, 2), b1: 2 };
    const out = resolveEnds({ strainOrigin: { bone: 'metatarsal-1', toward: ['superior'] } }, 'l', path, src);
    expect(out.p0.toArray()).toEqual([0, Math.fround(0.05), 0]);
    expect(out.b0).toBe(9);
    expect(out.p1).toBe(path.p1);
    expect(resolveEnds({}, 'l', path, src)).toEqual(path);
  });
});

describe('landmarkPoint', () => {
  // a box of vertices, 10 cm tall, 4 wide, 2 deep: x -2..2, y 0..10, z -1..1
  const box = [new Float32Array([-2, 0, -1, 2, 0, -1, -2, 10, 1, 2, 10, 1, 0, 5, 0, -2, 9.5, -1])];
  it('is the vertex furthest in a direction', () => {
    expect(landmarkPoint(box, { toward: ['superior'] }, 'l')!.toArray()).toEqual([-2, 10, 1]);
    expect(landmarkPoint(box, { toward: ['posterior'] }, 'l')!.y).toBe(0);
  });
  it('adds directions together, so a diagonal edge can be named', () => {
    expect(landmarkPoint(box, { toward: ['posterior', 'medial'] }, 'l')!.toArray()).toEqual([-2, 0, -1]);
    expect(landmarkPoint(box, { toward: ['posterior', 'lateral'] }, 'l')!.toArray()).toEqual([2, 0, -1]);
  });
  it('turns lateral and medial round for the right side, where lateral is towards -x', () => {
    expect(landmarkPoint(box, { toward: ['lateral', 'superior'] }, 'r')!.toArray()).toEqual([-2, 10, 1]);
    expect(landmarkPoint(box, { toward: ['lateral', 'superior'] }, 'l')!.toArray()).toEqual([2, 10, 1]);
  });
  it('looks only within `depth` of the extreme in `near`', () => {
    // the lowest 1 cm holds only the two bottom corners; the most anterior of them is chosen, not the top of the box
    expect(landmarkPoint(box, { near: 'inferior', depth: 1, toward: ['anterior', 'lateral'] }, 'l')!.toArray()).toEqual([2, 0, -1]);
    expect(landmarkPoint(box, { near: 'superior', depth: 1, toward: ['inferior'] }, 'l')!.toArray()).toEqual([-2, 9.5, -1]);
  });
  it('is null for a bone without vertices', () => {
    expect(landmarkPoint([], { toward: ['superior'] }, 'l')).toBeNull();
  });
});

describe('resolveVias', () => {
  const bones: Record<string, { positions: Float32Array[]; bone: number }> = {
    'tibia-l': { positions: [new Float32Array([0, 0, 0, 1, 5, 0])], bone: 3 },
    'calcaneus-l': { positions: [new Float32Array([0, 0, 0, 0, 1, -1])], bone: 7 },
    'patella-l': { positions: [new Float32Array([5, 5, 5, 0.1, 0.1, 0.1])], bone: 4 },
  };
  const src: ViaSource = {
    structure: (id) => bones[id],
    node: (id) => bones[id],
  };
  const a = v(0, 0, 0);
  const c = v(1, 0, 0);
  it('puts landmarks in the order given, each on its own bone', () => {
    const vias = resolveVias({ strainVias: [{ bone: 'tibia', toward: ['superior'] }, { bone: 'calcaneus', toward: ['posterior'] }] }, 'l', a, c, src) as BonePoint[];
    expect(vias.map((x) => x.b)).toEqual([3, 7]);
    expect(vias[0].p.toArray()).toEqual([1, 5, 0]);
    expect(vias[1].p.toArray()).toEqual([0, 1, -1]);
  });
  it('skips a landmark whose bone is missing', () => {
    expect(resolveVias({ strainVias: [{ bone: 'femur', toward: ['superior'] }, { bone: 'tibia', toward: ['superior'] }] }, 'l', a, c, src).map((x) => x.b)).toEqual([3]);
  });
  it('falls back to the nearest-to-the-line wrap point of a strainWrap node, and prefers strainVias when both are given', () => {
    const wrap = resolveVias({ strainWrap: 'patella' }, 'l', a, c, src) as BonePoint[];
    expect(wrap.map((x) => x.b)).toEqual([4]);
    expect(wrap[0].p.toArray()[0]).toBeCloseTo(0.1, 6);
    expect(resolveVias({ strainWrap: 'patella', strainVias: [{ bone: 'tibia', toward: ['superior'] }] }, 'l', a, c, src).map((x) => x.b)).toEqual([3]);
    expect(resolveVias({}, 'l', a, c, src)).toEqual([]);
  });
});

/**
 * An ankle on its own (x axis through the origin, y up, z forward): a flexor tendon from the back of the shin runs
 * behind the medial malleolus (on the tibia), under the heel (on the foot) and on to the toes. The straight line from the
 * shin to the toes lengthens as the foot points down, because the toes swing away from it; round the two landmarks it shortens.
 */
describe('a tendon round the back of an ankle', () => {
  const foot = (plantarflexion: number) => new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(plantarflexion));
  const at = (deg: number) => (p: THREE.Vector3, bone: number) => (bone === 1 ? p.clone().applyMatrix4(foot(deg)) : p.clone());
  const straight: StrainPath = { p0: v(0, 0.3, -0.015), b0: 0, p1: v(0, -0.05, 0.15), b1: 1 };
  const bent: StrainPath = { ...straight, vias: [{ p: v(0, 0.02, -0.02), b: 0 }, { p: v(0, -0.02, -0.03), b: 1 }] };
  const change = (p: StrainPath, deg: number) => strainPathLength(p, at(deg)) / strainPathLength(p, at(0)) - 1;
  it('lengthens along the straight line and shortens round the landmarks', () => {
    expect(change(straight, 40)).toBeGreaterThan(0.01);
    expect(change(bent, 40)).toBeLessThan(-0.01);
  });
});
