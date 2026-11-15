// Length-change check: the viewer's strain read-out (Viewer.strainOf), measured headlessly for every muscle in every
// movement of the movement table at 75 % of the range, and how often it agrees with the role the table gives (prime
// movers and synergists shorten, antagonists lengthen; the info panel hides a read-out that disagrees).
// Compares the straight origin-insertion line with the line through the wrap points (MuscleInfo.strainWrap, strainVias).
// Run: npx tsx scripts/strain-report.ts [modelsDir] [--list] [--runtime] [--save f.json] [--baseline f.json]
// (modelsDir defaults to public/models; --runtime picks the strain ends with skinStructure instead of taking the ones
// the model build baked; --save keeps the rows, --baseline lists the rows that changed agreement since a saved run)
import { readFileSync, writeFileSync } from 'node:fs';
import { DOFS, dofKey } from '../app/lib/rig/spec';
import { computeRoles } from '../app/lib/roles';
import { ACTIONS, type Role } from '../app/lib/data/actions';
import { loadStrain } from './lib/strain';

const args = process.argv.slice(2);
const dir = args.find((a, i) => !a.startsWith('--') && !['--save', '--baseline', '--muscle'].includes(args[i - 1])) ?? 'public/models';
const FRACTION = 0.75;
const THRESHOLD = 0.01;
/** Movements that start at rest and go less than this many degrees (a range that begins at its limit, such as mouth closing) tell nothing. */
const MIN_ANGLE = 5;

const { list, rig, strain, hasEnds } = await loadStrain(dir, args.includes('--runtime'));

// ---- the pose table: strain of the quadriceps in two poses ----
const named = ['rectus-femoris-l', 'vastus-lateralis-l', 'vastus-medialis-l', 'vastus-intermedius-l'];
console.log('knee flexion, length change (straight line -> with wrap points)');
for (const angle of [90, 130]) {
  rig.pose({ 'knee.flexion-extension.l': angle });
  for (const id of named) console.log(`  ${angle}°  ${id.padEnd(22)} ${(strain(id, 'straight') * 100).toFixed(1).padStart(6)}% -> ${(strain(id, 'wrap') * 100).toFixed(1).padStart(6)}%`);
}

// ---- agreement with the movement table ----
interface Row { move: string; id: string; role: Role; straight: number; wrap: number }
const rows: Row[] = [];
let skipped = 0;
for (const d of DOFS) {
  for (const dirn of ['pos', 'neg'] as const) {
    const mv = { joint: d.joint, dof: d.id, dir: dirn, side: d.paired ? ('l' as const) : ('m' as const) };
    const roles = computeRoles(list, mv);
    if (![...roles.values()].includes('prime')) continue;
    // one row per structure, or per part where the table names one (`id/part`, read on the part's own length line)
    const perId = roles;
    const angle = (dirn === 'pos' ? d.max : d.min) * FRACTION;
    if (Math.abs(angle) < MIN_ANGLE) { skipped += [...perId].filter(([id, r]) => r !== 'stab' && hasEnds(id.split('/')[0])).length; continue; }
    rig.pose({ [dofKey(d, mv.side)]: angle });
    for (const [id, role] of perId) if (hasEnds(id.split('/')[0]) && role !== 'stab') rows.push({ move: `${d.joint}.${d.id}.${dirn}`, id, role, straight: strain(id, 'straight'), wrap: strain(id, 'wrap') });
  }
}
const agrees = (role: Role, v: number) => (role === 'antagonist' ? v >= THRESHOLD : v <= -THRESHOLD);
const tally = (pick: (r: Row) => boolean) => {
  const sel = rows.filter(pick);
  return { n: sel.length, straight: sel.filter((r) => agrees(r.role, r.straight)).length, wrap: sel.filter((r) => agrees(r.role, r.wrap)).length };
};
const show = (label: string, t: { n: number; straight: number; wrap: number }) => console.log(`${label.padEnd(24)} straight ${t.straight}/${t.n}   wrapped ${t.wrap}/${t.n}`);
console.log(`\nAgreement with the movement table (>= ${THRESHOLD * 100}% at ${FRACTION * 100}% of range)`);
show('prime movers shorten', tally((r) => r.role === 'prime'));
// Only the table's own entries for the left or midline structure (spinal movements are written for one direction and
// mirrored): the count the project's earlier notes give.
show('  (table entries, left)', tally((r) => r.role === 'prime' && r.move in ACTIONS && !r.id.endsWith('-r')));
show('prime + synergists', tally((r) => r.role === 'prime' || r.role === 'assist'));
show('antagonists lengthen', tally((r) => r.role === 'antagonist'));
show('all roles', tally(() => true));
console.log(`(${skipped} muscle-movement pairs left out: under ${MIN_ANGLE}° from rest)`);
const flips = rows.filter((r) => agrees(r.role, r.straight) !== agrees(r.role, r.wrap));
console.log(`\nchanged by the wrap: ${flips.length}`);
for (const r of flips) console.log(`  ${r.move}:${r.id} (${r.role}) ${(r.straight * 100).toFixed(1)}% -> ${(r.wrap * 100).toFixed(1)}%  ${agrees(r.role, r.wrap) ? 'now agrees' : 'now disagrees'}`);
// --save <file> keeps this run's rows; --baseline <file> compares with a saved run, row by row.
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const save = opt('--save');
if (save) writeFileSync(save, JSON.stringify(rows.map((r) => ({ key: `${r.move}:${r.id}`, role: r.role, wrap: r.wrap }))));
const base = opt('--baseline');
if (base) {
  const before = new Map((JSON.parse(readFileSync(base, 'utf8')) as { key: string; role: Role; wrap: number }[]).map((r) => [r.key, r]));
  const lost: string[] = [];
  const won: string[] = [];
  for (const r of rows) {
    // a part row compares with the saved row of its part, else with the whole muscle's
    const b = before.get(`${r.move}:${r.id}`) ?? before.get(`${r.move}:${r.id.split('/')[0]}`);
    if (!b) continue;
    const was = agrees(b.role, b.wrap);
    const now = agrees(r.role, r.wrap);
    const line = `  ${r.move}:${r.id} (${r.role}) ${(b.wrap * 100).toFixed(1)}% -> ${(r.wrap * 100).toFixed(1)}%`;
    if (was && !now) lost.push(line);
    if (!was && now) won.push(line);
  }
  console.log(`\nagainst ${base}: ${won.length} rows now agree, ${lost.length} REGRESSIONS`);
  for (const l of won) console.log(`${l}  now agrees`);
  for (const l of lost) console.log(`${l}  REGRESSION`);
}
// --muscle a,b: every row of those muscles (left or midline ids, as given), agreeing or not
const only = opt('--muscle')?.split(',');
const isOnly = (id: string) => only?.includes(id.split('/')[0]);
if (only) {
  console.log('\nrows of', only.join(', '));
  for (const r of rows.filter((x) => isOnly(x.id))) console.log(`  ${agrees(r.role, r.wrap) ? 'ok ' : 'NO '} ${r.move.padEnd(40)} ${r.id.padEnd(34)} ${r.role.padEnd(10)} ${(r.straight * 100).toFixed(1).padStart(6)}% -> ${(r.wrap * 100).toFixed(1).padStart(6)}%`);
}
if (args.includes('--list')) {
  console.log('\nstill disagreeing (wrapped):');
  for (const r of rows.filter((x) => !agrees(x.role, x.wrap)).sort((a, b) => a.move.localeCompare(b.move))) console.log(`  ${r.move.padEnd(40)} ${r.id.padEnd(34)} ${r.role.padEnd(10)} ${(r.wrap * 100).toFixed(1)}%`);
}
