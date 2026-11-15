// Headless version of the viewer's length read-out (Viewer.strainOf): the same attachment ends, the same wrap points,
// measured on the rig without a renderer. Shared by scripts/strain-report.ts and tests/strain.test.ts.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
// @ts-expect-error draco3dgltf ships no types
import draco3d from 'draco3dgltf';
import { Rig } from '../../app/lib/rig/rig';
import { bakedEnds, resolveSkin, skinStructure } from '../../app/lib/rig/skinning';
import { BoneProximity } from '../../app/lib/rig/proximity';
import { hasMuscleInfo, muscleInfo } from '../../app/lib/data/muscles';
import { resolveEnds, resolvePart, resolveVias, strainPathLength, wrapPoint, type StrainPath, type ViaSource } from '../../app/lib/strain';
import type { Structure } from '../../app/lib/types';

export type StrainMode = 'straight' | 'wrap';

/**
 * Loads the model files in `dir` and returns the rig with a length read-out per muscle. `forceRuntime` ignores the
 * strain ends the build baked and picks them with skinStructure, to compare the two.
 */
export async function loadStrain(dir: string, forceRuntime = false) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
  const list: Structure[] = JSON.parse(readFileSync(`${dir}/structures.json`, 'utf8'));
  const byId = new Map(list.map((s) => [s.id, s]));
  const rig = new Rig(byId);

  const geo = new Map<string, Float32Array[]>();
  for (const f of ['skeleton.glb', 'muscles.glb']) {
    const doc = await io.read(`${dir}/${f}`);
    for (const n of doc.getRoot().listScenes()[0].listChildren()) {
      const id = (n.getExtras() as { id: string }).id;
      geo.set(id, n.listChildren().flatMap((c) => c.getMesh()?.listPrimitives() ?? []).map((p) => new Float32Array(p.getAttribute('POSITION')!.getArray()!)));
    }
  }
  const carried = (node: string) => rig.nodes.get(node)!.carries.flatMap((id) => geo.get(id) ?? []);
  /** Bind-pose position of the vertex of a bone (rig bone index) nearest to `from`. */
  const nearestOnBone = (bone: number, from: THREE.Vector3) => wrapPoint(carried(rig.bones[bone].name), from, from) ?? from.clone();

  const prox = new BoneProximity((node) => carried(rig.bones[node].name));
  const ends = new Map<string, StrainPath>();
  for (const s of list) {
    if (s.kind !== 'muscle') continue;
    const arrs = geo.get(s.id)!;
    const geoms = arrs.map((a) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3)); return g; });
    // a baked skin carries its strain ends (as the viewer takes them); otherwise they are worked out here, as the viewer does
    const r = s.strainEnds && !forceRuntime ? bakedEnds(s.strainEnds, rig) : skinStructure(s, geoms, resolveSkin(s, rig, hasMuscleInfo(s.key) ? muscleInfo(s.key) : undefined), rig, prox);
    if (!r.endBones) continue;
    const v = (e: { part: number; v: number }) => new THREE.Vector3(arrs[e.part][e.v * 3], arrs[e.part][e.v * 3 + 1], arrs[e.part][e.v * 3 + 2]);
    const e = r.endPoints ?? (r.ends ? [v(r.ends[0]), v(r.ends[1])] : null);
    if (!e) continue;
    ends.set(s.id, { p0: nearestOnBone(r.endBones[0], e[0]), b0: r.endBones[0], p1: nearestOnBone(r.endBones[1], e[1]), b1: r.endBones[1] });
  }
  // strainVia: the insertion end is the other muscle's.
  const own = new Map(ends);
  for (const [id, e] of own) {
    const s = byId.get(id)!;
    const via = hasMuscleInfo(s.key) ? muscleInfo(s.key).strainVia : undefined;
    const o = via ? own.get(s.side === 'm' ? via : `${via}-${s.side}`) : undefined;
    if (o) ends.set(id, { ...e, p1: o.p1, b1: o.b1 });
  }
  const src: ViaSource = {
    structure: (sid) => { const node = rig.nodes.get(rig.carriedBy.get(sid) ?? ''); return node && geo.has(sid) ? { positions: geo.get(sid)!, bone: node.index } : undefined; },
    node: (nid) => { const node = rig.nodes.get(nid); return node && { positions: carried(nid), bone: node.index, pivot: node.pivot }; },
  };
  // strainOrigin / strainInsertion: ends the muscle data names as bone landmarks.
  for (const [id, e] of ends) {
    const s = byId.get(id)!;
    if (hasMuscleInfo(s.key)) ends.set(id, resolveEnds(muscleInfo(s.key), s.side, e, src));
  }
  // strainWrap / strainVias, kept apart from `ends` so the straight line can be measured too.
  const wrapped = new Map<string, StrainPath>();
  for (const [id, e] of ends) {
    const s = byId.get(id)!;
    const vias = hasMuscleInfo(s.key) ? resolveVias(muscleInfo(s.key), s.side, e.p0, e.p1, src) : [];
    wrapped.set(id, vias.length ? { ...e, vias } : e);
  }

  // strainParts: one line per part, keyed `id/part`
  const parts = new Map<string, StrainPath>();
  for (const s of list) {
    if (s.kind !== 'muscle' || !hasMuscleInfo(s.key) || !ends.has(s.id)) continue;
    for (const [key, part] of Object.entries(muscleInfo(s.key).strainParts ?? {})) {
      const path = resolvePart(part, s.side, src);
      if (path) parts.set(`${s.id}/${key}`, path);
    }
  }

  const m = new THREE.Matrix4();
  const at = (p: THREE.Vector3, b: number) => p.clone().applyMatrix4(m.multiplyMatrices(rig.skeleton.bones[b].matrixWorld, rig.skeleton.boneInverses[b]));
  const paths = { straight: ends, wrap: wrapped };
  const pathOf = (mode: StrainMode, id: string) => (id.includes('/') ? parts.get(id) : undefined) ?? paths[mode].get(id.split('/')[0])!;
  const length = (mode: StrainMode, id: string) => strainPathLength(pathOf(mode, id), at);
  rig.pose({});
  const rest = { straight: new Map<string, number>(), wrap: new Map<string, number>() };
  for (const id of [...ends.keys(), ...parts.keys()]) { rest.straight.set(id, length('straight', id)); rest.wrap.set(id, length('wrap', id)); }

  return {
    list, byId, rig, ends, wrapped, parts,
    /**
     * Relative length change of a muscle (by id, or `id/part` for the line of a part where the muscle data has one,
     * else the whole muscle's) in the rig's current pose; 0.1 = 10 % longer than at rest.
     */
    strain: (id: string, mode: StrainMode = 'wrap') => {
      const key = parts.has(id) ? id : id.split('/')[0];
      return length(mode, key) / rest[mode].get(key)! - 1;
    },
    hasEnds: (id: string) => ends.has(id),
  };
}
