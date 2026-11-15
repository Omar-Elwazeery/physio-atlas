// Baked against runtime skin of the Open 3D Model muscles: how far a vertex posed with the skin the model build baked
// (what the viewer uses) lands from where the skin the viewer would work out itself puts it, over the rig check poses
// (the presets of the soft-tissue check and every joint movement to each end of its range), and how far apart the strain
// ends are. The runtime skin is computed on the decoded (compressed) positions the viewer gets, the baked one on the
// build's full-precision ones, so this includes the quantisation of positions and of the weight bytes.
// Run: npx tsx scripts/muscle-skin-report.ts [modelsDir]     (modelsDir defaults to public/models)
import { bakedSkin, deviation, endsOf, loadModels, poseMatrices, runtimeSkin } from './lib/muscleSkin';

const dir = process.argv[2] ?? 'public/models';
const { list, rig, geo, prox } = await loadModels(dir);
const poses = poseMatrices(rig);
const rows: { id: string; max: number; mean: number; pose: number; endsMm: number; boneMatch: boolean; nodes: number }[] = [];
let baked = 0, tRuntime = 0;
for (const s of list) {
  if (s.kind !== 'muscle' || s.source !== 'o3d') continue;
  const parts = geo.get(s.id)!;
  if (!s.skin || !parts.every((p) => p.joints && p.weights)) { console.log('not baked:', s.id); continue; }
  baked++;
  const t = performance.now();
  const rt = runtimeSkin(s, parts, rig, prox);
  tRuntime += performance.now() - t;
  const dev = deviation(parts, bakedSkin(s, parts, rig), rt.skin, poses);
  const ends = endsOf(s, parts, rt.res, rig), ref = endsOf({ ...s, strainEnds: undefined }, parts, rt.res, rig);
  let endsMm = 0, boneMatch = true;
  if (ends && ref) { ref.at.forEach((p, k) => { endsMm = Math.max(endsMm, p.distanceTo(ends.at[k]) * 1000); if (ref.bones[k] !== ends.bones[k]) boneMatch = false; }); }
  else if (!!ends !== !!ref) boneMatch = false;
  rows.push({ id: s.id, max: dev.max * 1000, mean: dev.mean * 1000, pose: dev.pose, endsMm, boneMatch, nodes: s.skin.length });
}
const names = Object.keys((await import('./lib/muscleSkin')).CHECK_POSES);
rows.sort((a, b) => b.max - a.max);
console.log(`${baked} baked Open 3D Model muscles, ${poses.length} poses; runtime skin of them (this process, warm): ${tRuntime.toFixed(0)} ms`);
console.log('worst vertex deviation baked vs runtime (mm):');
for (const r of rows.slice(0, 10)) console.log(`  ${r.id.padEnd(40)} max ${r.max.toFixed(3)}  mean ${r.mean.toFixed(4)}  at ${names[r.pose]}`);
const all = rows.map((r) => r.max);
console.log(`max over all muscles ${Math.max(...all).toFixed(3)} mm; muscles above 0.5 mm: ${all.filter((x) => x > 0.5).length}, above 1 mm: ${all.filter((x) => x > 1).length}; mean of means ${(rows.reduce((a, r) => a + r.mean, 0) / rows.length).toFixed(4)} mm`);
console.log(`strain ends: max position difference ${Math.max(...rows.map((r) => r.endsMm)).toFixed(3)} mm; end bone differs in ${rows.filter((r) => !r.boneMatch).length} muscles`);
console.log(`skin nodes per muscle: max ${Math.max(...rows.map((r) => r.nodes))}`);
