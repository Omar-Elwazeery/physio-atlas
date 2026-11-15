import type { Kind, Structure } from '../types';
import { FOOT, WRIST } from './softTissue';

/**
 * Sub-groups of the Joints library: which joint (or, failing that, which tissue) a structure is listed under inside
 * its library group ("Wrist & hand" > "Intercarpal joints"). Nothing here names a single structure: a sub-group is
 * worked out from the structure's kind, the bones it is attached to (`Structure.attach`) and, where the bones do not
 * settle it, the pattern of its key. Groups without rules of their own (knee, hip, shoulder, spine, ...) fall back
 * to one sub-group per tissue kind. The library only shows sub-groups for groups too long to read as one list (see
 * `librarySections` in catalog.ts).
 */
export interface SubRule {
  label: string;
  /** Kinds the rule applies to (any kind when absent). */
  kinds?: Kind[];
  /** Pattern the structure key must match. */
  key?: RegExp;
  /** Test on the attached bones (structure keys, without the side suffix). */
  bones?: (bones: string[]) => boolean;
}

/** Kinds that belong to one joint: ligaments, capsules, discs and fat pads (the rest lie along tendons or on one bone). */
const JOINT: Kind[] = ['ligament', 'capsule', 'fibrocartilage', 'fatpad'];
const LIGAMENT: Kind[] = ['ligament'];

const is = (re: RegExp) => (b: string) => re.test(b);
const forearm = is(/^(radius|ulna)$/), carpal = is(/^carpal-/), metacarpal = is(/^metacarpal-/);
const leg = is(/^(tibia|fibula)$/), hindfoot = is(/^(talus|calcaneus)$/), tarsal = is(/^(talus|calcaneus|tarsal-.*)$/), metatarsal = is(/^metatarsal-/);
const any = (...tests: ((b: string) => boolean)[]) => (b: string) => tests.some((t) => t(b));
const some = (bones: string[], t: (b: string) => boolean) => bones.some(t);
const all = (bones: string[], t: (b: string) => boolean) => bones.length > 0 && bones.every(t);

/** Joints of a finger or toe. `pre` is the key prefix of the foot's own structures ('toe-'), `plate` palmar or plantar. */
const digitJoints = (pre: string, plate: string, knuckle: string, names: [string, string, string, string]): SubRule[] => [
  { label: names[0], key: new RegExp(`^${knuckle}-|^${plate}-plate-${knuckle}-|transverse-meta(carp|tars)al|^intersesamoid`) },
  { label: names[1], key: new RegExp(`^${pre}pip-|^${plate}-plate-pip-`) },
  { label: names[2], key: new RegExp(`^${pre}dip-|^${plate}-plate-dip-`) },
  { label: names[3], key: new RegExp(`^${pre}ip-|^${plate}-plate-ip-`) },
];

/** Ordered: the first rule that matches wins, and the order is the order of the sub-groups in the library. */
export const SUB_RULES: Record<string, SubRule[]> = {
  [WRIST]: [
    { label: 'Distal radioulnar joint', kinds: JOINT, key: /radioulnar|^triangular-fibrocartilage$/ },
    { label: 'Radiocarpal (wrist) joint', kinds: JOINT, bones: (b) => some(b, forearm) && some(b, carpal) },
    { label: 'Intercarpal joints', kinds: LIGAMENT, key: /^(?!.*metacarpal)/, bones: (b) => some(b, carpal) && all(b, any(carpal, metacarpal)) },
    { label: 'Carpometacarpal and intermetacarpal joints', kinds: LIGAMENT, key: /^(?!.*transverse)/, bones: (b) => some(b, metacarpal) && all(b, any(carpal, metacarpal)) },
    ...digitJoints('', 'palmar', 'mcp', ['Metacarpophalangeal (MCP) joints', 'Proximal interphalangeal (PIP) joints', 'Distal interphalangeal (DIP) joints', 'Interphalangeal joint of thumb']),
    { label: 'Retinacula', kinds: ['retinaculum'] },
    { label: 'Tendon sheaths at the wrist', kinds: ['sheath'], bones: (b) => some(b, any(forearm, carpal)) },
    { label: 'Tendon sheaths of the fingers', kinds: ['sheath'] },
    { label: 'Joint surfaces: wrist and carpus', kinds: ['articular'], bones: (b) => all(b, any(forearm, carpal)) },
    { label: 'Joint surfaces: metacarpals and phalanges', kinds: ['articular'] },
  ],
  [FOOT]: [
    { label: 'Distal tibiofibular joint (syndesmosis)', kinds: JOINT, key: /tibiofibular/ },
    { label: 'Ankle (talocrural) joint', kinds: JOINT, bones: (b) => some(b, leg) && some(b, tarsal) },
    { label: 'Subtalar joint', kinds: LIGAMENT, bones: (b) => all(b, hindfoot) && b.length > 1 },
    { label: 'Midtarsal (transverse tarsal) joint', kinds: LIGAMENT, bones: (b) => some(b, hindfoot) && some(b, (x) => !hindfoot(x)) },
    { label: 'Intertarsal joints', kinds: LIGAMENT, key: /^(?!.*metatarsal)/, bones: (b) => some(b, tarsal) && all(b, any(tarsal, metatarsal)) },
    { label: 'Tarsometatarsal and intermetatarsal joints', kinds: LIGAMENT, key: /^(?!.*transverse)/, bones: (b) => some(b, metatarsal) && all(b, any(tarsal, metatarsal)) },
    ...digitJoints('toe-', 'plantar', 'mtp', ['Metatarsophalangeal (MTP) joints', 'Proximal interphalangeal (PIP) joints', 'Distal interphalangeal (DIP) joints', 'Interphalangeal joint of great toe']),
    { label: 'Retinacula', kinds: ['retinaculum'] },
    { label: 'Tendon sheaths at the ankle', kinds: ['sheath'], bones: (b) => some(b, any(leg, tarsal)) },
    { label: 'Tendon sheaths of the toes', kinds: ['sheath'] },
    { label: 'Bursae', kinds: ['bursa'] },
    { label: 'Joint surfaces: ankle and tarsus', kinds: ['articular'], bones: (b) => all(b, any(leg, tarsal)) },
    { label: 'Joint surfaces: metatarsals and toes', kinds: ['articular'] },
  ],
};

/** Sub-group of a kind no rule claimed, in library order. A ligament that lands here in a group with rules is unsorted. */
export const KIND_SUBGROUPS: [Kind, string][] = [
  ['ligament', 'Ligaments'],
  ['capsule', 'Joint capsules'],
  ['fibrocartilage', 'Menisci, labra and discs'],
  ['fatpad', 'Fat pads'],
  ['retinaculum', 'Retinacula'],
  ['sheath', 'Tendon sheaths'],
  ['bursa', 'Bursae'],
  ['articular', 'Joint surfaces'],
  ['fascia', 'Fasciae'],
];
const KIND_LABEL = new Map(KIND_SUBGROUPS);
/** Name of the per-kind sub-group for ligaments in a group that sorts its ligaments by joint. */
export const OTHER_LIGAMENTS = 'Other ligaments';

const kindLabel = (group: string, kind: Kind) => (kind === 'ligament' && SUB_RULES[group] ? OTHER_LIGAMENTS : KIND_LABEL.get(kind));

/** Sub-group of a Joints-library structure within its library group, or undefined for kinds the library does not sub-group. */
export function jointSubgroup(group: string, s: Pick<Structure, 'key' | 'kind' | 'attach'>): string | undefined {
  const bones = (s.attach ?? []).map((id) => id.replace(/-[lr]$/, ''));
  for (const r of SUB_RULES[group] ?? []) {
    if (r.kinds && !r.kinds.includes(s.kind)) continue;
    if (r.key && !r.key.test(s.key)) continue;
    if (r.bones && !r.bones(bones)) continue;
    return r.label;
  }
  return kindLabel(group, s.kind);
}

/** Sub-group names of a library group in the order the library lists them: joints first, then the tissue kinds. */
export function subgroupOrder(group: string): string[] {
  const out = (SUB_RULES[group] ?? []).map((r) => r.label);
  for (const [kind] of KIND_SUBGROUPS) out.push(kindLabel(group, kind)!);
  return [...new Set(out)];
}
