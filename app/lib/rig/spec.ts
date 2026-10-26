import type { Side, Structure, V3 } from '../types';

/**
 * Rig specification. Model space: metres, y up, +z anterior, +x = the figure's left.
 *
 * Paired nodes (`paired: true`) are instantiated per side as `<id>-l` / `<id>-r`; their carried
 * structure keys get the same side suffix. For an unpaired node, `key*` carries both sides, and
 * `@group` carries every structure of that manifest group (on the node's side when paired).
 */
export interface RigNodeSpec {
  id: string;
  parent: string | null;
  paired: boolean;
  pivot: (g: Geo) => V3;
  carries: string[];
  /**
   * The model rests with this joint partly flexed. `from` is the structure key of the segment
   * proximal to the joint; the rig measures the resting flexion between the two long axes and
   * cancels it, so that a DOF value of 0 means a straight joint. `sign` is the DOF's sign.
   */
  rest?: { from: string; sign: 1 | -1 };
}

export interface Geo {
  side: Side;
  /** Structure for a key on this node's side (or the unpaired one). */
  s: (key: string) => Structure;
  /** Structure for a key on the opposite side. */
  other: (key: string) => Structure;
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const up = (v: V3, d: number): V3 => [v[0], v[1] + d, v[2]];
const medialEnd = (g: Geo, key: string) => (g.side === 'l' ? g.s(key).lm.x0 : g.s(key).lm.x1);
const lateralEnd = (g: Geo, key: string) => (g.side === 'l' ? g.s(key).lm.x1 : g.s(key).lm.x0);

/** Centre of a vertebral body (anterior part of the bounding box, lower third). */
const vertebra = (key: string) => (g: Geo): V3 => {
  const [lo, hi] = g.s(key).bbox;
  return [(lo[0] + hi[0]) / 2, lo[1] + 0.3 * (hi[1] - lo[1]), hi[2] - 0.32 * (hi[2] - lo[2])];
};

export const LUMBAR = ['l5', 'l4', 'l3', 'l2', 'l1'];
export const THORACIC = ['t12', 't11', 't10', 't9', 't8', 't7', 't6', 't5', 't4', 't3', 't2', 't1'];
export const CERVICAL = ['c7', 'c6', 'c5', 'c4', 'c3', 'c2', 'c1'];
export const FINGERS = ['index', 'middle', 'ring', 'little'] as const;
export const TOES = ['toe2', 'toe3', 'toe4', 'toe5'] as const;

const CARPALS = ['carpal-scaphoid', 'carpal-lunate', 'carpal-triquetral', 'carpal-pisiform', 'carpal-trapezium', 'carpal-trapezoid', 'carpal-capitate', 'carpal-hamate'];

export const NODES: RigNodeSpec[] = [];
const node = (n: RigNodeSpec) => NODES.push(n);

// --- axial skeleton ------------------------------------------------------------------------------
node({ id: 'pelvis', parent: null, paired: false, pivot: (g) => g.s('sacrum').lm.c, carries: ['sacrum', 'hip-bone*'] });

let prev = 'pelvis';
for (const k of LUMBAR) { node({ id: k, parent: prev, paired: false, pivot: vertebra(k), carries: [k] }); prev = k; }
for (const k of THORACIC) {
  const n = k.slice(1);
  node({ id: k, parent: prev, paired: false, pivot: vertebra(k), carries: [k, `rib-${n}*`] });
  prev = k;
}
for (const k of CERVICAL) { node({ id: k, parent: prev, paired: false, pivot: vertebra(k), carries: [k] }); prev = k; }
node({ id: 'skull', parent: 'c1', paired: false, pivot: (g) => { const [lo, hi] = g.s('c1').bbox; return [0, hi[1] - 0.004, hi[2] - 0.35 * (hi[2] - lo[2])]; }, carries: ['@skull', 'hyoid'] });
node({
  id: 'mandible', parent: 'skull', paired: false,
  pivot: (g) => { const [lo, hi] = g.s('mandible').bbox; return [0, hi[1] - 0.014, lo[2] + 0.27 * (hi[2] - lo[2])]; },
  carries: ['mandible'],
});
node({ id: 'sternum', parent: 't6', paired: false, pivot: (g) => g.s('sternum-body').lm.c, carries: ['manubrium', 'sternum-body', 'xiphoid'] });

// --- upper limb ----------------------------------------------------------------------------------
node({ id: 'clavicle', parent: 'sternum', paired: true, pivot: (g) => medialEnd(g, 'clavicle'), carries: ['clavicle'] });
node({ id: 'scapula', parent: 'clavicle', paired: true, pivot: (g) => lateralEnd(g, 'clavicle'), carries: ['scapula'] });
node({ id: 'humerus', parent: 'scapula', paired: true, pivot: (g) => up(g.s('humerus').lm.y1, -0.014), carries: ['humerus'] });
node({ id: 'ulna', parent: 'humerus', paired: true, pivot: (g) => up(g.s('humerus').lm.y0, 0.012), carries: ['ulna'], rest: { from: 'humerus', sign: -1 } });
node({ id: 'radius', parent: 'ulna', paired: true, pivot: (g) => up(g.s('radius').lm.y1, -0.006), carries: ['radius'] });
node({ id: 'hand', parent: 'radius', paired: true, pivot: (g) => up(g.s('radius').lm.y0, 0.008), carries: [...CARPALS, 'metacarpal-1', 'metacarpal-2', 'metacarpal-3', 'metacarpal-4', 'metacarpal-5'] });
const MC: Record<string, number> = { index: 2, middle: 3, ring: 4, little: 5 };
for (const f of FINGERS) {
  node({ id: `${f}-proximal`, parent: 'hand', paired: true, pivot: (g) => up(g.s(`${f}-proximal`).lm.y1, -0.003), carries: [`${f}-proximal`], rest: { from: `metacarpal-${MC[f]}`, sign: -1 } });
  node({ id: `${f}-middle`, parent: `${f}-proximal`, paired: true, pivot: (g) => up(g.s(`${f}-middle`).lm.y1, -0.002), carries: [`${f}-middle`], rest: { from: `${f}-proximal`, sign: -1 } });
  node({ id: `${f}-distal`, parent: `${f}-middle`, paired: true, pivot: (g) => up(g.s(`${f}-distal`).lm.y1, -0.002), carries: [`${f}-distal`], rest: { from: `${f}-middle`, sign: -1 } });
}
node({ id: 'thumb-proximal', parent: 'hand', paired: true, pivot: (g) => up(g.s('thumb-proximal').lm.y1, -0.003), carries: ['thumb-proximal'] });
node({ id: 'thumb-distal', parent: 'thumb-proximal', paired: true, pivot: (g) => up(g.s('thumb-distal').lm.y1, -0.002), carries: ['thumb-distal'] });

// --- lower limb ----------------------------------------------------------------------------------
node({ id: 'femur', parent: 'pelvis', paired: true, pivot: (g) => up(g.s('femur').lm.y1, -0.022), carries: ['femur'] });
const knee = (g: Geo): V3 => up(g.s('femur').lm.y0, 0.02);
node({ id: 'patella', parent: 'femur', paired: true, pivot: knee, carries: ['patella'] });
node({ id: 'tibia', parent: 'femur', paired: true, pivot: knee, carries: ['tibia'] });
node({ id: 'fibula', parent: 'tibia', paired: true, pivot: knee, carries: ['fibula'] });
node({ id: 'talus', parent: 'tibia', paired: true, pivot: (g) => g.s('talus').lm.c, carries: ['talus'] });
node({ id: 'foot', parent: 'talus', paired: true, pivot: (g) => up(g.s('talus').lm.c, -0.012), carries: ['@foot'] });
for (const t of ['hallux', ...TOES]) {
  const phal = t === 'hallux' ? ['proximal', 'distal'] : ['proximal', 'middle', 'distal'];
  let p = 'foot';
  for (const ph of phal) {
    const key = `${t}-${ph}`;
    node({ id: key, parent: p, paired: true, pivot: (g) => g.s(key).lm.z0, carries: [key] });
    p = key;
  }
}

// ===================================================================================================
export type AxisId = 'x' | 'y' | 'z' | 'forearm';

export interface Dof {
  id: string;
  joint: string;
  label: string;
  /** Name of the movement for positive values / negative values. */
  pos: string;
  neg: string;
  axis: AxisId;
  /** Sign of the rotation about `axis` for positive values on the left / midline. */
  sign: 1 | -1;
  /** Flip the sign on the right side (frontal and transverse plane movements). */
  mirror: boolean;
  min: number;
  max: number;
  paired: boolean;
  targets: { node: string; w: number }[];
  note?: string;
}

export const DOFS: Dof[] = [];
const dof = (d: Omit<Dof, 'targets'> & { node?: string; targets?: Dof['targets'] }) => {
  const { node: n, targets, ...rest } = d;
  DOFS.push({ ...rest, targets: targets ?? [{ node: n!, w: 1 }] });
};
const even = (ids: string[]) => ids.map((node) => ({ node, w: 1 / ids.length }));

// Shoulder girdle and shoulder
dof({ id: 'elevation-depression', joint: 'girdle', label: 'Scapular elevation', pos: 'Elevation', neg: 'Depression', axis: 'z', sign: 1, mirror: true, min: -10, max: 40, paired: true, node: 'clavicle', note: 'Sternoclavicular joint; the scapula follows through the acromioclavicular joint.' });
dof({ id: 'protraction-retraction', joint: 'girdle', label: 'Scapular protraction', pos: 'Protraction', neg: 'Retraction', axis: 'y', sign: -1, mirror: true, min: -15, max: 25, paired: true, node: 'clavicle' });
dof({ id: 'flexion-extension', joint: 'shoulder', label: 'Flexion / Extension', pos: 'Flexion', neg: 'Extension', axis: 'x', sign: -1, mirror: false, min: -60, max: 180, paired: true, node: 'humerus', note: 'Total elevation includes about 60° of scapulothoracic rotation (scapulohumeral rhythm).' });
dof({ id: 'abduction-adduction', joint: 'shoulder', label: 'Abduction / Adduction', pos: 'Abduction', neg: 'Adduction', axis: 'z', sign: 1, mirror: true, min: -30, max: 180, paired: true, node: 'humerus' });
dof({ id: 'rotation', joint: 'shoulder', label: 'External / Internal rotation', pos: 'External rotation', neg: 'Internal rotation', axis: 'y', sign: 1, mirror: true, min: -70, max: 90, paired: true, node: 'humerus' });
// Elbow and forearm
dof({ id: 'flexion-extension', joint: 'elbow', label: 'Flexion / Extension', pos: 'Flexion', neg: 'Extension', axis: 'x', sign: -1, mirror: false, min: -5, max: 150, paired: true, node: 'ulna' });
dof({ id: 'pronation-supination', joint: 'forearm', label: 'Pronation / Supination', pos: 'Pronation', neg: 'Supination', axis: 'forearm', sign: 1, mirror: true, min: -80, max: 80, paired: true, node: 'radius', note: 'The radius rotates around the ulna at the proximal and distal radioulnar joints.' });
// Wrist and hand
dof({ id: 'flexion-extension', joint: 'wrist', label: 'Flexion / Extension', pos: 'Flexion', neg: 'Extension', axis: 'x', sign: -1, mirror: false, min: -70, max: 80, paired: true, node: 'hand' });
dof({ id: 'deviation', joint: 'wrist', label: 'Radial / Ulnar deviation', pos: 'Radial deviation', neg: 'Ulnar deviation', axis: 'z', sign: 1, mirror: true, min: -30, max: 20, paired: true, node: 'hand' });
dof({ id: 'mcp', joint: 'fingers', label: 'MCP flexion / extension', pos: 'MCP flexion', neg: 'MCP extension', axis: 'x', sign: -1, mirror: false, min: -30, max: 90, paired: true, targets: FINGERS.map((f) => ({ node: `${f}-proximal`, w: 1 })) });
dof({ id: 'pip', joint: 'fingers', label: 'PIP flexion', pos: 'PIP flexion', neg: 'PIP extension', axis: 'x', sign: -1, mirror: false, min: 0, max: 100, paired: true, targets: FINGERS.map((f) => ({ node: `${f}-middle`, w: 1 })) });
dof({ id: 'dip', joint: 'fingers', label: 'DIP flexion', pos: 'DIP flexion', neg: 'DIP extension', axis: 'x', sign: -1, mirror: false, min: 0, max: 80, paired: true, targets: FINGERS.map((f) => ({ node: `${f}-distal`, w: 1 })) });
dof({ id: 'thumb-mcp', joint: 'thumb', label: 'Thumb MCP flexion', pos: 'MCP flexion', neg: 'MCP extension', axis: 'z', sign: -1, mirror: true, min: 0, max: 50, paired: true, node: 'thumb-proximal' });
dof({ id: 'thumb-ip', joint: 'thumb', label: 'Thumb IP flexion', pos: 'IP flexion', neg: 'IP extension', axis: 'z', sign: -1, mirror: true, min: -20, max: 80, paired: true, node: 'thumb-distal' });
// Hip
dof({ id: 'flexion-extension', joint: 'hip', label: 'Flexion / Extension', pos: 'Flexion', neg: 'Extension', axis: 'x', sign: -1, mirror: false, min: -30, max: 120, paired: true, node: 'femur' });
dof({ id: 'abduction-adduction', joint: 'hip', label: 'Abduction / Adduction', pos: 'Abduction', neg: 'Adduction', axis: 'z', sign: 1, mirror: true, min: -30, max: 45, paired: true, node: 'femur' });
dof({ id: 'rotation', joint: 'hip', label: 'External / Internal rotation', pos: 'External rotation', neg: 'Internal rotation', axis: 'y', sign: 1, mirror: true, min: -45, max: 45, paired: true, node: 'femur' });
// Knee, ankle, foot
dof({ id: 'flexion-extension', joint: 'knee', label: 'Flexion / Extension', pos: 'Flexion', neg: 'Extension', axis: 'x', sign: 1, mirror: false, min: -5, max: 135, paired: true, node: 'tibia', note: 'The patella glides on the femur at about half the knee angle.' });
dof({ id: 'dorsiflexion-plantarflexion', joint: 'ankle', label: 'Dorsiflexion / Plantarflexion', pos: 'Dorsiflexion', neg: 'Plantarflexion', axis: 'x', sign: -1, mirror: false, min: -50, max: 20, paired: true, node: 'talus' });
dof({ id: 'inversion-eversion', joint: 'subtalar', label: 'Inversion / Eversion', pos: 'Inversion', neg: 'Eversion', axis: 'z', sign: -1, mirror: true, min: -15, max: 35, paired: true, node: 'foot' });
dof({ id: 'mtp', joint: 'toes', label: 'MTP flexion / extension', pos: 'MTP flexion', neg: 'MTP extension', axis: 'x', sign: 1, mirror: false, min: -70, max: 40, paired: true, targets: ['hallux', ...TOES].map((t) => ({ node: `${t}-proximal`, w: 1 })) });
dof({ id: 'ip', joint: 'toes', label: 'Interphalangeal flexion', pos: 'IP flexion', neg: 'IP extension', axis: 'x', sign: 1, mirror: false, min: 0, max: 80, paired: true, targets: ['hallux-distal', ...TOES.flatMap((t) => [`${t}-middle`, `${t}-distal`])].map((n) => ({ node: n, w: 1 })) });
// Spine
const cervicalW = [
  { node: 'skull', w: 0.28 }, { node: 'c1', w: 0.12 },
  ...['c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map((node) => ({ node, w: 0.1 })),
];
const cervicalRot = [
  { node: 'c1', w: 0.45 }, { node: 'c2', w: 0.1 }, { node: 'skull', w: 0.05 },
  ...['c3', 'c4', 'c5', 'c6', 'c7'].map((node) => ({ node, w: 0.08 })),
];
dof({ id: 'flexion-extension', joint: 'cervical', label: 'Flexion / Extension', pos: 'Flexion', neg: 'Extension', axis: 'x', sign: 1, mirror: false, min: -60, max: 50, paired: false, targets: cervicalW });
dof({ id: 'lateral-flexion', joint: 'cervical', label: 'Lateral flexion (left / right)', pos: 'Left lateral flexion', neg: 'Right lateral flexion', axis: 'z', sign: -1, mirror: false, min: -45, max: 45, paired: false, targets: cervicalW });
dof({ id: 'rotation', joint: 'cervical', label: 'Rotation (left / right)', pos: 'Left rotation', neg: 'Right rotation', axis: 'y', sign: 1, mirror: false, min: -80, max: 80, paired: false, targets: cervicalRot });
dof({ id: 'flexion-extension', joint: 'thoracic', label: 'Flexion / Extension', pos: 'Flexion', neg: 'Extension', axis: 'x', sign: 1, mirror: false, min: -25, max: 35, paired: false, targets: even(THORACIC) });
dof({ id: 'lateral-flexion', joint: 'thoracic', label: 'Lateral flexion (left / right)', pos: 'Left lateral flexion', neg: 'Right lateral flexion', axis: 'z', sign: -1, mirror: false, min: -25, max: 25, paired: false, targets: even(THORACIC) });
dof({ id: 'rotation', joint: 'thoracic', label: 'Rotation (left / right)', pos: 'Left rotation', neg: 'Right rotation', axis: 'y', sign: 1, mirror: false, min: -35, max: 35, paired: false, targets: even(THORACIC) });
dof({ id: 'flexion-extension', joint: 'lumbar', label: 'Flexion / Extension', pos: 'Flexion', neg: 'Extension', axis: 'x', sign: 1, mirror: false, min: -25, max: 60, paired: false, targets: even(LUMBAR) });
dof({ id: 'lateral-flexion', joint: 'lumbar', label: 'Lateral flexion (left / right)', pos: 'Left lateral flexion', neg: 'Right lateral flexion', axis: 'z', sign: -1, mirror: false, min: -25, max: 25, paired: false, targets: even(LUMBAR) });
dof({ id: 'rotation', joint: 'lumbar', label: 'Rotation (left / right)', pos: 'Left rotation', neg: 'Right rotation', axis: 'y', sign: 1, mirror: false, min: -10, max: 10, paired: false, targets: even(LUMBAR) });
dof({ id: 'opening', joint: 'tmj', label: 'Mouth opening', pos: 'Depression (opening)', neg: 'Elevation (closing)', axis: 'x', sign: 1, mirror: false, min: 0, max: 28, paired: false, node: 'mandible' });

export interface JointInfo { id: string; label: string; region: 'Upper limb' | 'Lower limb' | 'Spine & head'; paired: boolean }
export const JOINTS: JointInfo[] = [
  { id: 'cervical', label: 'Cervical spine & head', region: 'Spine & head', paired: false },
  { id: 'thoracic', label: 'Thoracic spine', region: 'Spine & head', paired: false },
  { id: 'lumbar', label: 'Lumbar spine', region: 'Spine & head', paired: false },
  { id: 'tmj', label: 'Temporomandibular joint', region: 'Spine & head', paired: false },
  { id: 'girdle', label: 'Shoulder girdle', region: 'Upper limb', paired: true },
  { id: 'shoulder', label: 'Shoulder (glenohumeral)', region: 'Upper limb', paired: true },
  { id: 'elbow', label: 'Elbow', region: 'Upper limb', paired: true },
  { id: 'forearm', label: 'Forearm', region: 'Upper limb', paired: true },
  { id: 'wrist', label: 'Wrist', region: 'Upper limb', paired: true },
  { id: 'fingers', label: 'Fingers', region: 'Upper limb', paired: true },
  { id: 'thumb', label: 'Thumb', region: 'Upper limb', paired: true },
  { id: 'hip', label: 'Hip', region: 'Lower limb', paired: true },
  { id: 'knee', label: 'Knee', region: 'Lower limb', paired: true },
  { id: 'ankle', label: 'Ankle', region: 'Lower limb', paired: true },
  { id: 'subtalar', label: 'Subtalar (foot)', region: 'Lower limb', paired: true },
  { id: 'toes', label: 'Toes', region: 'Lower limb', paired: true },
];

/** Pose state key: `<joint>.<dof>` for unpaired joints, `<joint>.<dof>.<l|r>` for paired ones. */
export const dofKey = (d: Dof, side: Side) => (d.paired ? `${d.joint}.${d.id}.${side}` : `${d.joint}.${d.id}`);

export { add };
