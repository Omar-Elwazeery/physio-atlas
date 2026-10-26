/**
 * Which muscles produce each movement. Keyed `<joint>.<dof>.<pos|neg>`.
 *
 * Entries are muscle keys, optionally `key/part` for one part of a multi-part muscle. For spinal
 * movements a prefix says which side acts relative to the movement direction (pos = left, neg = right):
 * `=` ipsilateral, `~` contralateral, none = both sides. Limb joints always use the moving limb's side.
 */
export interface Action { prime: string[]; assist: string[]; stab?: string[] }
export type Role = 'prime' | 'assist' | 'stab' | 'antagonist';

const a = (prime: string[], assist: string[] = [], stab: string[] = []): Action => ({ prime, assist, stab });

export const ACTIONS: Record<string, Action> = {
  'girdle.elevation-depression.pos': a(['trapezius/descending-part', 'levator-scapulae'], ['rhomboid-major', 'rhomboid-minor']),
  'girdle.elevation-depression.neg': a(['trapezius/ascending-part', 'pectoralis-minor', 'subclavius'], ['serratus-anterior']),
  'girdle.protraction-retraction.pos': a(['serratus-anterior', 'pectoralis-minor'], ['pectoralis-major']),
  'girdle.protraction-retraction.neg': a(['rhomboid-major', 'rhomboid-minor', 'trapezius/transverse-part'], ['trapezius/ascending-part']),

  'shoulder.flexion-extension.pos': a(['deltoid/clavicular-part', 'pectoralis-major/clavicular-part', 'coracobrachialis'], ['biceps-brachii', 'serratus-anterior', 'trapezius/descending-part', 'trapezius/ascending-part'], ['supraspinatus', 'infraspinatus', 'subscapularis', 'teres-minor']),
  'shoulder.flexion-extension.neg': a(['deltoid/spinal-part', 'teres-major', 'latissimus-dorsi'], ['triceps-brachii', 'teres-minor', 'infraspinatus']),
  'shoulder.abduction-adduction.pos': a(['deltoid/acromial-part', 'supraspinatus'], ['deltoid/clavicular-part', 'deltoid/spinal-part', 'serratus-anterior', 'trapezius/descending-part', 'trapezius/ascending-part'], ['infraspinatus', 'teres-minor', 'subscapularis']),
  'shoulder.abduction-adduction.neg': a(['pectoralis-major', 'teres-major', 'latissimus-dorsi'], ['triceps-brachii', 'coracobrachialis', 'subscapularis']),
  'shoulder.rotation.pos': a(['infraspinatus', 'teres-minor'], ['deltoid/spinal-part']),
  'shoulder.rotation.neg': a(['subscapularis', 'pectoralis-major', 'teres-major', 'latissimus-dorsi'], ['deltoid/clavicular-part']),

  'elbow.flexion-extension.pos': a(['biceps-brachii', 'brachialis', 'brachioradialis'], ['pronator-teres', 'flexor-carpi-radialis', 'extensor-carpi-radialis-longus']),
  'elbow.flexion-extension.neg': a(['triceps-brachii'], ['anconeus']),
  'forearm.pronation-supination.pos': a(['pronator-teres', 'pronator-quadratus'], ['flexor-carpi-radialis', 'brachioradialis']),
  'forearm.pronation-supination.neg': a(['supinator', 'biceps-brachii'], ['brachioradialis', 'abductor-pollicis-longus', 'extensor-pollicis-longus']),

  'wrist.flexion-extension.pos': a(['flexor-carpi-radialis', 'flexor-carpi-ulnaris', 'palmaris-longus'], ['flexor-digitorum-superficialis', 'flexor-digitorum-profundus', 'flexor-pollicis-longus', 'abductor-pollicis-longus']),
  'wrist.flexion-extension.neg': a(['extensor-carpi-radialis-longus', 'extensor-carpi-radialis-brevis', 'extensor-carpi-ulnaris'], ['extensor-digitorum', 'extensor-indicis', 'extensor-digiti-minimi', 'extensor-pollicis-longus']),
  'wrist.deviation.pos': a(['flexor-carpi-radialis', 'extensor-carpi-radialis-longus', 'abductor-pollicis-longus'], ['extensor-carpi-radialis-brevis', 'extensor-pollicis-brevis']),
  'wrist.deviation.neg': a(['flexor-carpi-ulnaris', 'extensor-carpi-ulnaris']),
  'fingers.mcp.pos': a(['flexor-digitorum-superficialis', 'flexor-digitorum-profundus'], ['lumbricals-of-hand', 'dorsal-interossei-of-hand', 'palmar-interossei-of-hand', 'flexor-digiti-minimi-brevis-of-hand']),
  'fingers.mcp.neg': a(['extensor-digitorum', 'extensor-indicis', 'extensor-digiti-minimi']),
  'fingers.pip.pos': a(['flexor-digitorum-superficialis'], ['flexor-digitorum-profundus']),
  'fingers.pip.neg': a(['extensor-digitorum'], ['lumbricals-of-hand', 'dorsal-interossei-of-hand', 'palmar-interossei-of-hand']),
  'fingers.dip.pos': a(['flexor-digitorum-profundus']),
  'fingers.dip.neg': a(['extensor-digitorum'], ['lumbricals-of-hand', 'dorsal-interossei-of-hand', 'palmar-interossei-of-hand']),
  'thumb.thumb-mcp.pos': a(['flexor-pollicis-brevis', 'flexor-pollicis-longus'], ['opponens-pollicis', 'adductor-pollicis']),
  'thumb.thumb-mcp.neg': a(['extensor-pollicis-brevis', 'extensor-pollicis-longus'], ['abductor-pollicis-longus']),
  'thumb.thumb-ip.pos': a(['flexor-pollicis-longus']),
  'thumb.thumb-ip.neg': a(['extensor-pollicis-longus']),

  'hip.flexion-extension.pos': a(['psoas-major', 'iliacus', 'rectus-femoris'], ['sartorius', 'tensor-fasciae-latae', 'pectineus', 'adductor-longus', 'adductor-brevis', 'gluteus-minimus']),
  'hip.flexion-extension.neg': a(['gluteus-maximus', 'semitendinosus', 'semimembranosus', 'biceps-femoris'], ['adductor-magnus', 'gluteus-medius']),
  'hip.abduction-adduction.pos': a(['gluteus-medius', 'gluteus-minimus'], ['tensor-fasciae-latae', 'sartorius', 'piriformis', 'gluteus-maximus']),
  'hip.abduction-adduction.neg': a(['adductor-longus', 'adductor-brevis', 'adductor-magnus', 'adductor-minimus', 'gracilis', 'pectineus'], ['quadratus-femoris', 'obturator-externus']),
  'hip.rotation.pos': a(['piriformis', 'obturator-internus', 'obturator-externus', 'gemellus-superior', 'gemellus-inferior', 'quadratus-femoris', 'gluteus-maximus'], ['sartorius']),
  'hip.rotation.neg': a(['gluteus-minimus', 'tensor-fasciae-latae', 'gluteus-medius'], ['adductor-longus', 'adductor-brevis', 'pectineus']),
  'knee.flexion-extension.pos': a(['biceps-femoris', 'semitendinosus', 'semimembranosus'], ['gracilis', 'sartorius', 'gastrocnemius', 'popliteus', 'plantaris']),
  'knee.flexion-extension.neg': a(['rectus-femoris', 'vastus-lateralis', 'vastus-medialis', 'vastus-intermedius'], ['tensor-fasciae-latae']),
  'ankle.dorsiflexion-plantarflexion.pos': a(['tibialis-anterior'], ['extensor-digitorum-longus', 'extensor-hallucis-longus', 'fibularis-tertius']),
  'ankle.dorsiflexion-plantarflexion.neg': a(['gastrocnemius', 'soleus'], ['tibialis-posterior', 'fibularis-longus', 'fibularis-brevis', 'flexor-hallucis-longus', 'flexor-digitorum-longus', 'plantaris']),
  'subtalar.inversion-eversion.pos': a(['tibialis-posterior', 'tibialis-anterior'], ['flexor-hallucis-longus', 'flexor-digitorum-longus', 'extensor-hallucis-longus']),
  'subtalar.inversion-eversion.neg': a(['fibularis-longus', 'fibularis-brevis'], ['fibularis-tertius', 'extensor-digitorum-longus']),
  'toes.mtp.pos': a(['flexor-digitorum-longus', 'flexor-hallucis-longus', 'flexor-digitorum-brevis', 'flexor-hallucis-brevis'], ['flexor-accessorius', 'first-lumbrical-of-foot', 'second-lumbrical-of-foot', 'third-lumbrical-of-foot', 'fourth-lumbrical-of-foot']),
  'toes.mtp.neg': a(['extensor-digitorum-longus', 'extensor-hallucis-longus', 'extensor-hallucis-brevis']),
  'toes.ip.pos': a(['flexor-digitorum-longus', 'flexor-hallucis-longus']),
  'toes.ip.neg': a(['extensor-digitorum-longus', 'extensor-hallucis-longus']),

  'cervical.flexion-extension.pos': a(['sternocleidomastoid', 'longus-colli', 'longus-capitis', 'rectus-capitis-anterior'], ['scalenus-anterior', 'sternohyoid', 'omohyoid']),
  'cervical.flexion-extension.neg': a(['semispinalis-capitis', 'splenius-capitis', 'longissimus-capitis', 'trapezius/descending-part', 'rectus-capitis-posterior-major', 'rectus-capitis-posterior-minor', 'obliquus-capitis-superior'], ['semispinalis-cervicis', 'splenius-cervicis', 'levator-scapulae', 'iliocostalis-cervicis', 'longissimus-cervicis']),
  'cervical.lateral-flexion.pos': a(['=sternocleidomastoid', '=scalenus-anterior', '=scalenus-medius', '=scalenus-posterior', '=splenius-capitis', '=longissimus-capitis', '=levator-scapulae'], ['=trapezius/descending-part', '=longissimus-cervicis', '=iliocostalis-cervicis', '=semispinalis-capitis', '=obliquus-capitis-superior', '=rectus-capitis-lateralis']),
  'cervical.rotation.pos': a(['=splenius-capitis', '=splenius-cervicis', '=obliquus-capitis-inferior', '~sternocleidomastoid', '~semispinalis-capitis'], ['=longissimus-capitis', '=levator-scapulae', '=iliocostalis-cervicis', '~semispinalis-cervicis', '~trapezius/descending-part', '~cervical-rotator']),
  'thoracic.flexion-extension.pos': a(['rectus-abdominis', 'external-oblique', 'internal-oblique'], ['psoas-major', 'longus-colli', 'transversus-abdominis']),
  'thoracic.flexion-extension.neg': a(['iliocostalis-thoracis', 'longissimus-thoracis', 'spinalis-thoracis', 'semispinalis-thoracis'], ['thoracic-rotator', 'interspinalis-thoracis', 'iliocostalis-lumborum', 'multifidus']),
  'thoracic.lateral-flexion.pos': a(['=external-oblique', '=internal-oblique', '=iliocostalis-thoracis', '=longissimus-thoracis'], ['=iliocostalis-lumborum', '=quadratus-lumborum', '=serratus-posterior-inferior', '=external-intercostal', '=internal-intercostal']),
  'thoracic.rotation.pos': a(['~external-oblique', '=internal-oblique', '~semispinalis-thoracis', '~thoracic-rotator', '~multifidus'], ['=iliocostalis-thoracis', '=longissimus-thoracis', '=external-intercostal', '~internal-intercostal']),
  'lumbar.flexion-extension.pos': a(['rectus-abdominis', 'external-oblique', 'internal-oblique', 'psoas-major'], ['iliacus', 'transversus-abdominis']),
  'lumbar.flexion-extension.neg': a(['iliocostalis-lumborum', 'longissimus-thoracis'], ['multifidus', 'quadratus-lumborum', 'lumbar-rotator', 'medial-lumbar-intertransversarius', 'spinalis']),
  'lumbar.lateral-flexion.pos': a(['=external-oblique', '=internal-oblique', '=quadratus-lumborum', '=iliocostalis-lumborum', '=longissimus-thoracis', '=lateral-lumbar-intertransversarius'], ['=psoas-major', '=medial-lumbar-intertransversarius']),
  'lumbar.rotation.pos': a(['~external-oblique', '=internal-oblique', '~multifidus', '~lumbar-rotator'], ['=iliocostalis-lumborum', '=longissimus-thoracis']),
  'tmj.opening.neg': a(['masseter', 'temporalis']),
  'tmj.opening.pos': a(['digastric', 'mylohyoid', 'geniohyoid'], ['sternohyoid', 'omohyoid', 'sternothyroid', 'thyrohyoid']),
};

/** Opposite direction of a movement key; antagonists are the prime movers of this one. */
export const oppositeKey = (k: string): string => (k.endsWith('.pos') ? `${k.slice(0, -4)}.neg` : `${k.slice(0, -4)}.pos`);

/**
 * For spinal DOFs, only the `pos` entry is written (the muscles act symmetrically in the other
 * direction with `=`/`~` swapped). Returns the action for either direction.
 */
export function actionFor(joint: string, dof: string, dir: 'pos' | 'neg'): Action | undefined {
  const direct = ACTIONS[`${joint}.${dof}.${dir}`];
  if (direct) return direct;
  if (dir === 'neg' && isSymmetricSpinal(joint, dof)) return ACTIONS[`${joint}.${dof}.pos`];
  return undefined;
}

const SPINAL_SYMMETRIC = new Set(['cervical.lateral-flexion', 'cervical.rotation', 'thoracic.lateral-flexion', 'thoracic.rotation', 'lumbar.lateral-flexion', 'lumbar.rotation']);
export const isSymmetricSpinal = (joint: string, dof: string) => SPINAL_SYMMETRIC.has(`${joint}.${dof}`);

/** Side that the `=`/`~` rules refer to for a direction. pos = left, neg = right. */
export const directionSide = (dir: 'pos' | 'neg'): 'l' | 'r' => (dir === 'pos' ? 'l' : 'r');

export interface ParsedRef { key: string; part: string | null; rule: '=' | '~' | null }
export function parseRef(ref: string): ParsedRef {
  let rule: '=' | '~' | null = null;
  if (ref[0] === '=' || ref[0] === '~') { rule = ref[0] as '=' | '~'; ref = ref.slice(1); }
  const [key, part] = ref.split('/');
  return { key, part: part ?? null, rule };
}

/** Does a muscle on `muscleSide` take part given the rule and the limb/direction side? */
export function sideMatches(rule: '=' | '~' | null, muscleSide: 'l' | 'r' | 'm', actingSide: 'l' | 'r' | null): boolean {
  if (muscleSide === 'm') return true;
  if (!actingSide) return true;
  if (rule === '=') return muscleSide === actingSide;
  if (rule === '~') return muscleSide !== actingSide;
  return true;
}
