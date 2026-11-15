// Baked against runtime skin of the Open 3D Model muscles (scripts/build-open3d.ts bakes what the viewer would work out
// on load, see skinParts). Shared by scripts/muscle-skin-report.ts and tests/muscleSkin.test.ts.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
// @ts-expect-error draco3dgltf ships no types
import draco3d from 'draco3dgltf';
import { Rig } from '../../app/lib/rig/rig';
import { bakedEnds, resolveSkin, skinStructure, type StructureSkin } from '../../app/lib/rig/skinning';
import { BoneProximity } from '../../app/lib/rig/proximity';
import { DOFS, dofKey } from '../../app/lib/rig/spec';
import { hasMuscleInfo, muscleInfo } from '../../app/lib/data/muscles';
import type { Structure } from '../../app/lib/types';

/** One mesh of a structure as the viewer receives it: decoded positions and, if baked, the file's skin attributes. */
export interface Part { pos: Float32Array; joints?: ArrayLike<number>; weights?: ArrayLike<number> }
/** Four influences per vertex: rig bone indices and weights (as the viewer binds them). */
export interface Skin { index: Uint16Array; weight: Float32Array }

export async function loadModels(dir: string) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
  const list: Structure[] = JSON.parse(readFileSync(`${dir}/structures.json`, 'utf8'));
  const byId = new Map(list.map((s) => [s.id, s]));
  const rig = new Rig(byId);
  const geo = new Map<string, Part[]>();
  for (const f of ['skeleton.glb', 'muscles.glb']) {
    const doc = await io.read(`${dir}/${f}`);
    for (const n of doc.getRoot().listScenes()[0].listChildren()) {
      geo.set((n.getExtras() as { id: string }).id, n.listChildren().flatMap((c) => c.getMesh()?.listPrimitives() ?? []).map((p) => ({
        pos: new Float32Array(p.getAttribute('POSITION')!.getArray()!),
        joints: p.getAttribute('JOINTS_0')?.getArray() ?? undefined,
        weights: p.getAttribute('WEIGHTS_0')?.getArray() ?? undefined,
      })));
    }
  }
  const prox = new BoneProximity((node) => rig.nodes.get(rig.bones[node].name)!.carries.flatMap((id) => (geo.get(id) ?? []).map((g) => g.pos)), 0.015);
  return { list, byId, rig, geo, prox };
}
export type Models = Awaited<ReturnType<typeof loadModels>>;

/** The skin the file carries, as Viewer.applyBakedSkin binds it (weights are normalised bytes). */
export function bakedSkin(s: Structure, parts: Part[], rig: Rig): Skin[] {
  const bones = s.skin!.map((id) => rig.node(id).index);
  return parts.map((p) => {
    const index = new Uint16Array(p.pos.length / 3 * 4), weight = new Float32Array(index.length);
    for (let i = 0; i < index.length; i++) { index[i] = bones[p.joints![i]] ?? bones[0]; weight[i] = p.weights![i] / 255; }
    return { index, weight };
  });
}

/** The skin the viewer works out itself when the file has none, with the strain ends it picks. */
export function runtimeSkin(s: Structure, parts: Part[], rig: Rig, prox: BoneProximity): { skin: Skin[]; res: StructureSkin } {
  const geoms = parts.map((p) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3)); return g; });
  const res = skinStructure(s, geoms, resolveSkin(s, rig, hasMuscleInfo(s.key) ? muscleInfo(s.key) : undefined), rig, prox);
  return { skin: geoms.map((g) => ({ index: g.getAttribute('skinIndex').array as Uint16Array, weight: g.getAttribute('skinWeight').array as Float32Array })), res };
}

/** Where the strain ends are, per source: bind-pose positions and rig bone indices. */
export function endsOf(s: Structure, parts: Part[], res: StructureSkin, rig: Rig): { at: THREE.Vector3[]; bones: number[] } | null {
  if (!res.endBones) return null;
  const r = s.strainEnds ? bakedEnds(s.strainEnds, rig) : res;
  const at = r.endPoints ?? res.ends?.map((e) => new THREE.Vector3(parts[e.part].pos[e.v * 3], parts[e.part].pos[e.v * 3 + 1], parts[e.part].pos[e.v * 3 + 2]));
  return at ? { at, bones: r.endBones! } : null;
}

/** The rig check poses: the presets of the soft-tissue check and every joint movement to each end of its range. */
export const CHECK_POSES: Record<string, Record<string, number>> = {
  squat: { 'hip.flexion-extension.l': 100, 'hip.flexion-extension.r': 100, 'knee.flexion-extension.l': 110, 'knee.flexion-extension.r': 110, 'ankle.dorsiflexion-plantarflexion.l': 20, 'ankle.dorsiflexion-plantarflexion.r': 20, 'lumbar.flexion-extension': 20, 'shoulder.flexion-extension.l': 80, 'shoulder.flexion-extension.r': 80 },
  reach: { 'shoulder.flexion-extension.l': 170, 'shoulder.flexion-extension.r': 170, 'thoracic.flexion-extension': -15, 'lumbar.flexion-extension': -12, 'elbow.flexion-extension.l': 0, 'elbow.flexion-extension.r': 0 },
  gait: { 'hip.flexion-extension.l': 30, 'knee.flexion-extension.l': 3, 'ankle.dorsiflexion-plantarflexion.l': 5, 'hip.flexion-extension.r': -10, 'knee.flexion-extension.r': 10, 'ankle.dorsiflexion-plantarflexion.r': -20, 'shoulder.flexion-extension.l': -20, 'shoulder.flexion-extension.r': 25, 'elbow.flexion-extension.l': 10, 'elbow.flexion-extension.r': 25 },
  bend: { 'lumbar.flexion-extension': 55, 'thoracic.flexion-extension': 30, 'cervical.flexion-extension': 20, 'hip.flexion-extension.l': 60, 'hip.flexion-extension.r': 60, 'shoulder.flexion-extension.l': 30, 'shoulder.flexion-extension.r': 30 },
  taichi: { 'shoulder.abduction-adduction.l': 90, 'shoulder.abduction-adduction.r': 90, 'elbow.flexion-extension.l': 60, 'elbow.flexion-extension.r': 60, 'forearm.pronation-supination.l': 40, 'forearm.pronation-supination.r': 40, 'wrist.flexion-extension.l': 20, 'wrist.flexion-extension.r': 20 },
  fist: { 'fingers.mcp.l': 90, 'fingers.pip.l': 100, 'fingers.dip.l': 80, 'thumb.thumb-mcp.l': 50, 'thumb.thumb-ip.l': 80, 'wrist.flexion-extension.l': 60 },
  footmax: { 'ankle.dorsiflexion-plantarflexion.l': -50, 'subtalar.inversion-eversion.l': 35, 'toes.mtp.l': -70, 'toes.ip.l': 80 },
};
for (const d of DOFS) for (const v of [d.min, d.max]) if (v) for (const side of d.paired ? (['l', 'r'] as const) : (['m'] as const)) CHECK_POSES[`${dofKey(d, side)}=${v}`] = { [dofKey(d, side)]: v };

/** Bone matrices (bind -> posed) of every bone for each check pose. The rig is left in the rest pose. */
export function poseMatrices(rig: Rig): Float64Array[] {
  const m = new THREE.Matrix4();
  const out = Object.values(CHECK_POSES).map((pose) => {
    rig.pose(pose);
    const M = new Float64Array(rig.bones.length * 16);
    rig.bones.forEach((b, i) => { m.multiplyMatrices(b.matrixWorld, rig.skeleton.boneInverses[i]); M.set(m.elements, i * 16); });
    return M;
  });
  rig.pose({});
  return out;
}

/** Posed position of vertex v of a mesh under a pose (linear blend skinning with `skin`). */
function posed(pos: Float32Array, skin: Skin, v: number, M: Float64Array, out: Float64Array) {
  const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
  out[0] = out[1] = out[2] = 0;
  for (let k = 0; k < 4; k++) {
    const w = skin.weight[v * 4 + k];
    if (!w) continue;
    const o = skin.index[v * 4 + k] * 16;
    out[0] += w * (M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12]);
    out[1] += w * (M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13]);
    out[2] += w * (M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14]);
  }
}

/** Largest and mean distance (metres) between a vertex posed with skin `a` and with skin `b`, over the poses; and which pose. */
export function deviation(parts: Part[], a: Skin[], b: Skin[], poses: Float64Array[]) {
  let max = 0, sum = 0, n = 0, at = -1;
  const p = new Float64Array(3), q = new Float64Array(3);
  parts.forEach((part, i) => {
    for (let v = 0; v < part.pos.length / 3; v++) {
      for (let k = 0; k < poses.length; k++) {
        posed(part.pos, a[i], v, poses[k], p);
        posed(part.pos, b[i], v, poses[k], q);
        const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        sum += d; n++;
        if (d > max) { max = d; at = k; }
      }
    }
  });
  return { max, mean: n ? sum / n : 0, pose: at };
}
