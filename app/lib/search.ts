/**
 * Search over the structure catalog. Pure and dependency-free (no DOM, no three): it only reads the clinical
 * data tables, so it can be unit tested in plain node.
 *
 * Muscles are searched by name, group, region, innervation, action, origin / insertion text and the movements
 * they take part in; bones by name, group and region. Ranking, best first:
 *   exact name, name prefix, word-start in the name, name substring, group, other fields, typo-tolerant name.
 * Multi-word queries are AND-ed across words. Everything is case and diacritic insensitive.
 */
import type { CatalogItem } from './catalog';
import { muscleInfo } from './data/muscles';
import { movementsOfMuscle } from './roles';
import { KINDS } from './kinds';
import { jointInfo } from './data/joints';

export interface MatchReason {
  /** e.g. "Innervation", "Origin", "Movement", "Also called", "Part of". */
  label: string;
  text: string;
}

export interface SearchResult {
  item: CatalogItem;
  score: number;
  /** Present when the match was not on the name or group, so the list can say why the item is there. */
  reason?: MatchReason;
}

// ---------------------------------------------------------------------------------------------------------------
// normalisation

/**
 * Lower-case and strip diacritics one character at a time, so the result has the same length as the input and
 * indexes into it can be used to cut a snippet out of the original text.
 */
export function fold(s: string): string {
  let out = '';
  for (const ch of s) {
    const base = ch.normalize('NFD').charAt(0).toLowerCase();
    out += base.length === 1 ? base : ch;
  }
  return out;
}

const isAlnum = (c: string) => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
const words = (folded: string): string[] => folded.split(/[^a-z0-9]+/).filter(Boolean);

/** Words of a query, folded, without filler words (unless nothing else is left). */
export function tokenize(query: string): string[] {
  const all = words(fold(query));
  const keep = all.filter((w) => !STOP.has(w));
  return keep.length ? keep : all;
}
const STOP = new Set(['of', 'the', 'and', 'to', 'a', 'in', 'for', 'with']);

/** Spellings students use that differ from the catalog's. Applied per word. */
const WORD_SYNONYM: Record<string, string> = {
  peroneus: 'fibularis', peroneal: 'fibularis', peronei: 'fibularis', fibular: 'fibularis',
  vertebrae: 'vertebra', phalanges: 'phalanx', scapulae: 'scapula', sterni: 'sternum',
};

interface Variant { t: string; /** must equal a whole word (plural stripped, synonym) rather than start or sit inside one */ whole: boolean }

/** A query word and the other spellings that should count as the same word. */
function variants(tok: string): Variant[] {
  const v: Variant[] = [{ t: tok, whole: false }];
  if (tok.length > 3 && tok.endsWith('s') && !tok.endsWith('ss')) v.push({ t: tok.slice(0, -1), whole: true });
  const syn = WORD_SYNONYM[tok];
  if (syn) v.push({ t: syn, whole: true });
  return v;
}

// ---------------------------------------------------------------------------------------------------------------
// aliases

interface Alias {
  /** Phrases a student might type. */
  terms: string[];
  muscles?: string[];
  bones?: string[];
  /** Structures of the Joints library (cartilage, ligaments, capsules, bursae... keys). */
  joints?: string[];
  /** Shown as "Part of: …" when the alias names a group; otherwise "Also called: <term>". */
  as?: string;
}

const RIBS = Array.from({ length: 12 }, (_, i) => `rib-${i + 1}`);
const CARPALS = ['scaphoid', 'lunate', 'triquetral', 'pisiform', 'trapezium', 'trapezoid', 'capitate', 'hamate'].map((n) => `carpal-${n}`);
const TARSALS = ['calcaneus', 'talus', 'tarsal-navicular', 'tarsal-cuboid', 'tarsal-cuneiform-medial', 'tarsal-cuneiform-intermediate', 'tarsal-cuneiform-lateral'];

/** Every target key is checked against public/models/structures.json in tests/search.test.ts. */
export const ALIASES: Alias[] = [
  // ---- muscles ----
  { terms: ['lats', 'lat'], muscles: ['latissimus-dorsi'] },
  { terms: ['traps'], muscles: ['trapezius'] },
  { terms: ['pecs', 'pec', 'pectorals', 'chest'], muscles: ['pectoralis-major', 'pectoralis-minor'], as: 'Pectorals' },
  { terms: ['delts', 'delt'], muscles: ['deltoid'] },
  { terms: ['rhomboids'], muscles: ['rhomboid-major', 'rhomboid-minor'], as: 'Rhomboids' },
  { terms: ['quads', 'quad', 'quadriceps'], muscles: ['rectus-femoris', 'vastus-lateralis', 'vastus-medialis', 'vastus-intermedius'], as: 'Quadriceps' },
  { terms: ['hamstrings', 'hamstring', 'hammies'], muscles: ['biceps-femoris', 'semitendinosus', 'semimembranosus'], as: 'Hamstrings' },
  { terms: ['glutes', 'glute', 'gluteals', 'gluteal muscles'], muscles: ['gluteus-maximus', 'gluteus-medius', 'gluteus-minimus'], as: 'Gluteals' },
  { terms: ['hip abductors'], muscles: ['gluteus-medius', 'gluteus-minimus', 'tensor-fasciae-latae'], as: 'Hip abductors' },
  { terms: ['adductors', 'groin', 'groin muscles'], muscles: ['adductor-longus', 'adductor-brevis', 'adductor-magnus', 'adductor-minimus', 'gracilis', 'pectineus'], as: 'Hip adductors' },
  { terms: ['hip flexors'], muscles: ['iliacus', 'psoas-major', 'rectus-femoris', 'tensor-fasciae-latae', 'sartorius', 'pectineus'], as: 'Hip flexors' },
  { terms: ['iliopsoas'], muscles: ['iliacus', 'psoas-major'], as: 'Iliopsoas' },
  { terms: ['calf', 'calves', 'calf muscles', 'triceps surae', 'achilles'], muscles: ['gastrocnemius', 'soleus'], as: 'Calf (triceps surae)' },
  { terms: ['peroneals', 'peroneus'], muscles: ['fibularis-longus', 'fibularis-brevis', 'fibularis-tertius'], as: 'Fibularis (peroneal) muscles' },
  { terms: ['tfl'], muscles: ['tensor-fasciae-latae'] },
  { terms: ['itb', 'it band', 'iliotibial band'], muscles: ['tensor-fasciae-latae'], joints: ['iliotibial-tract'], as: 'Iliotibial band and tensor fasciae latae' },
  { terms: ['rotator cuff', 'cuff', 'sits'], muscles: ['supraspinatus', 'infraspinatus', 'teres-minor', 'subscapularis'], as: 'Rotator cuff' },
  { terms: ['scm', 'sternomastoid'], muscles: ['sternocleidomastoid'] },
  { terms: ['scalenes'], muscles: ['scalenus-anterior', 'scalenus-medius', 'scalenus-posterior'], as: 'Scalenes' },
  { terms: ['abs', 'abdominals', 'abdominal muscles', 'six pack'], muscles: ['rectus-abdominis', 'external-oblique', 'internal-oblique', 'transversus-abdominis'], as: 'Abdominal wall' },
  { terms: ['obliques'], muscles: ['external-oblique', 'internal-oblique'], as: 'Obliques' },
  { terms: ['tva'], muscles: ['transversus-abdominis'] },
  { terms: ['erector spinae', 'erectors', 'spinal erectors'], muscles: ['iliocostalis-cervicis', 'iliocostalis-thoracis', 'iliocostalis-lumborum', 'longissimus-capitis', 'longissimus-cervicis', 'longissimus-thoracis', 'spinalis', 'spinalis-thoracis'], as: 'Erector spinae' },
  { terms: ['intercostals'], muscles: ['external-intercostal', 'internal-intercostal', 'innermost-intercostal'], as: 'Intercostals' },
  { terms: ['pelvic floor', 'levator ani'], muscles: ['coccygeus', 'iliococcygeus', 'pubococcygeus', 'puborectalis'], as: 'Pelvic floor' },
  { terms: ['suboccipitals', 'suboccipital muscles'], muscles: ['rectus-capitis-posterior-major', 'rectus-capitis-posterior-minor', 'obliquus-capitis-inferior', 'obliquus-capitis-superior'], as: 'Suboccipitals' },
  { terms: ['suprahyoid', 'suprahyoids'], muscles: ['digastric', 'mylohyoid', 'geniohyoid', 'stylohyoid'], as: 'Suprahyoid muscles' },
  { terms: ['infrahyoid', 'infrahyoids'], muscles: ['sternohyoid', 'sternothyroid', 'thyrohyoid', 'omohyoid'], as: 'Infrahyoid muscles' },
  { terms: ['mastication', 'chewing', 'jaw muscles'], muscles: ['masseter', 'temporalis'], as: 'Muscles of mastication' },
  { terms: ['thenar', 'thenar muscles'], muscles: ['abductor-pollicis-brevis', 'flexor-pollicis-brevis', 'opponens-pollicis'], as: 'Thenar muscles' },
  { terms: ['hypothenar', 'hypothenar muscles'], muscles: ['abductor-digiti-minimi-of-hand', 'flexor-digiti-minimi-brevis-of-hand', 'opponens-digiti-minimi-of-hand'], as: 'Hypothenar muscles' },
  // ---- bones ----
  { terms: ['shoulder blade'], bones: ['scapula'] },
  { terms: ['collarbone', 'collar bone'], bones: ['clavicle'] },
  { terms: ['kneecap', 'knee cap'], bones: ['patella'] },
  { terms: ['shin', 'shin bone', 'shinbone'], bones: ['tibia'] },
  { terms: ['thigh bone', 'thighbone'], bones: ['femur'] },
  { terms: ['upper arm bone'], bones: ['humerus'] },
  { terms: ['forearm bones'], bones: ['radius', 'ulna'], as: 'Forearm bones' },
  { terms: ['heel bone', 'heel'], bones: ['calcaneus'] },
  { terms: ['ankle bone'], bones: ['talus'] },
  { terms: ['breastbone', 'breast bone', 'sternum'], bones: ['sternum-body', 'manubrium', 'xiphoid'], as: 'Sternum' },
  { terms: ['jaw', 'jaw bone', 'jawbone'], bones: ['mandible'] },
  { terms: ['cheekbone', 'cheek bone'], bones: ['skull-zygomatic'] },
  { terms: ['rib cage', 'ribcage'], bones: [...RIBS, 'sternum-body', 'manubrium', 'xiphoid'], as: 'Rib cage' },
  { terms: ['wrist bones', 'carpals', 'carpal bones'], bones: CARPALS, as: 'Carpal bones' },
  { terms: ['ankle bones', 'tarsals', 'tarsal bones'], bones: TARSALS, as: 'Tarsal bones' },
  { terms: ['teeth', 'tooth', 'dentition'], bones: ['teeth-upper', 'teeth-lower'], as: 'Teeth' },
  { terms: ['tailbone', 'tail bone'], bones: ['coccyx'] },
  // ---- joint surfaces ----
  { terms: ['menisci', 'meniscus', 'knee cartilage', 'cartilage of the knee'], joints: ['medial-meniscus', 'lateral-meniscus'], as: 'Menisci' },
  { terms: ['labrum', 'labra'], joints: ['glenoid-labrum', 'acetabular-labrum'], as: 'Labra' },
  { terms: ['tfcc', 'triangular fibrocartilage complex'], joints: ['triangular-fibrocartilage'] },
  { terms: ['pubic symphysis', 'symphysis pubis'], joints: ['interpubic-disc', 'cartilage-pubic-symphysis', 'pubic-ligaments'], as: 'Pubic symphysis' },
  // ---- ligaments, capsules, bursae, sheaths, retinacula, fasciae ----
  { terms: ['acl'], joints: ['anterior-cruciate-ligament'] },
  { terms: ['pcl'], joints: ['posterior-cruciate-ligament'] },
  { terms: ['cruciates', 'cruciate ligaments'], joints: ['anterior-cruciate-ligament', 'posterior-cruciate-ligament'], as: 'Cruciate ligaments' },
  { terms: ['lcl', 'lateral collateral ligament', 'lateral collateral ligament of knee'], joints: ['fibular-collateral-ligament'] },
  { terms: ['mcl', 'medial collateral ligament', 'tibial collateral ligament'], joints: ['medial-collateral-ligament'] },
  { terms: ['atfl'], joints: ['anterior-talofibular-ligament'] },
  { terms: ['cfl'], joints: ['calcaneofibular-ligament'] },
  { terms: ['ptfl'], joints: ['posterior-talofibular-ligament'] },
  { terms: ['lateral ankle ligaments', 'lateral collateral ligament of ankle'], joints: ['anterior-talofibular-ligament', 'calcaneofibular-ligament', 'posterior-talofibular-ligament'], as: 'Lateral ligaments of the ankle' },
  { terms: ['deltoid ligament', 'medial collateral ligament of ankle'], joints: ['anterior-tibiotalar-ligament', 'posterior-tibiotalar-ligament', 'tibiocalcaneal-ligament', 'tibionavicular-ligament'], as: 'Deltoid ligament' },
  { terms: ['syndesmosis', 'high ankle ligaments', 'aitfl', 'pitfl'], joints: ['anterior-tibiofibular-ligament', 'posterior-tibiofibular-ligament', 'transverse-tibiofibular-ligament', 'interosseous-membrane-of-leg'], as: 'Tibiofibular syndesmosis' },
  { terms: ['spring ligament'], joints: ['plantar-calcaneonavicular-ligament'] },
  { terms: ['short plantar ligament'], joints: ['plantar-calcaneocuboid-ligament'] },
  { terms: ['plantar fascia'], joints: ['plantar-aponeurosis'] },
  { terms: ['carpal tunnel', 'transverse carpal ligament'], joints: ['flexor-retinaculum'] },
  { terms: ['tarsal tunnel'], joints: ['flexor-retinaculum-of-ankle'] },
  { terms: ['ligamentum teres', 'round ligament of femur'], joints: ['ligament-of-head-of-femur'] },
  { terms: ['hip ligaments'], joints: ['iliofemoral-ligament', 'pubofemoral-ligament', 'ischiofemoral-ligament'], as: 'Ligaments of the hip capsule' },
  { terms: ['y ligament', 'ligament of bigelow'], joints: ['iliofemoral-ligament'] },
  { terms: ['ucl', 'ulnar collateral ligament'], joints: ['ulnar-collateral-ligament-of-elbow', 'ulnar-collateral-ligament-of-wrist'], as: 'Ulnar collateral ligaments' },
  { terms: ['rcl', 'radial collateral ligament'], joints: ['radial-collateral-ligament-of-elbow', 'radial-collateral-ligament-of-wrist'], as: 'Radial collateral ligaments' },
  { terms: ['annular ligament'], joints: ['annular-ligament-of-radius'] },
  { terms: ['scapholunate', 'sl ligament', 'sli'], joints: ['scapholunate-ligament'] },
  { terms: ['glenohumeral ligaments', 'gh ligaments'], joints: ['superior-glenohumeral-ligament', 'middle-glenohumeral-ligament', 'inferior-glenohumeral-ligament'], as: 'Glenohumeral ligaments' },
  { terms: ['coracoacromial arch'], joints: ['coracoacromial-ligament'] },
  { terms: ['conoid', 'trapezoid ligament'], joints: ['coracoclavicular-ligament'] },
  { terms: ['subacromial bursa', 'subdeltoid bursa'], joints: ['subacromial-subdeltoid-bursa'] },
  { terms: ['retrocalcaneal', 'achilles bursa'], joints: ['retrocalcaneal-bursa', 'subcutaneous-calcaneal-bursa'], as: 'Bursae of the calcaneal tendon' },
  { terms: ['prepatellar bursa', 'housemaids knee'], joints: ['subcutaneous-prepatellar-bursa', 'subfascial-prepatellar-bursa', 'subtendinous-prepatellar-bursa'], as: 'Prepatellar bursae' },
  { terms: ['trochanteric bursa', 'greater trochanter bursa'], joints: ['trochanteric-bursa-of-gluteus-maximus', 'trochanteric-bursae-of-gluteus-medius', 'trochanteric-bursa-of-gluteus-minimus', 'subcutaneous-trochanteric-bursa'], as: 'Trochanteric bursae' },
  { terms: ['hoffa fat pad', 'hoffa'], joints: ['infrapatellar-fat-pad'] },
  { terms: ['ulnar bursa'], joints: ['common-flexor-sheath'] },
  { terms: ['radial bursa'], joints: ['flexor-pollicis-longus-sheath'] },
  { terms: ['pulleys', 'flexor pulleys', 'annular pulleys'], joints: ['fibrous-digital-sheath-index', 'fibrous-digital-sheath-middle', 'fibrous-digital-sheath-ring', 'fibrous-digital-sheath-little', 'fibrous-digital-sheath-thumb'], as: 'Fibrous digital sheaths (pulleys)' },
  { terms: ['volar plate', 'palmar plate'], joints: ['palmar-plate-mcp-index', 'palmar-plate-mcp-middle', 'palmar-plate-mcp-ring', 'palmar-plate-mcp-little', 'palmar-plate-mcp-thumb'], as: 'Palmar plates' },
];

const EXACT_ALIAS = 1500;
const PREFIX_ALIAS = 600;
const ALIAS_PREFIX_MIN = 3;

// ---------------------------------------------------------------------------------------------------------------
// index

interface Field {
  label: string;
  /** Folded text matched against. */
  text: string;
  /** Text shown in the reason (defaults to the original field text). */
  raw: string;
  weight: number;
  /** Words without filler words, joined by spaces, for whole-phrase matching. */
  key: string;
}

interface Entry {
  item: CatalogItem;
  name: string;
  nameWords: string[];
  /** Name words joined by single spaces, for whole-query comparisons. */
  nameKey: string;
  group: string;
  fields: Field[];
}

export interface SearchIndex {
  entries: Entry[];
  /** folded alias term -> entries it points at, with the term as written */
  aliases: { term: string; key: string; display: string; as?: string; targets: Entry[] }[];
}

const FIELD_WEIGHT = { Innervation: 170, Movement: 160, Action: 150, Origin: 130, Insertion: 130, Region: 100 } as const;
const ROLE_NAME = { prime: 'prime mover', assist: 'assists', stab: 'stabilizes' } as const;
const ROLE_BONUS = { prime: 10, assist: 5, stab: 0 } as const;

const mkField = (label: string, text: string, raw: string, weight: number): Field => {
  const folded = fold(text);
  return { label, text: folded, raw, weight, key: words(folded).filter((w) => !STOP.has(w)).join(' ') };
};
const field = (label: keyof typeof FIELD_WEIGHT, raw: string): Field => mkField(label, raw, raw, FIELD_WEIGHT[label]);

/** Build once per catalog (e.g. in useMemo); about 300 items, a few milliseconds. */
export function buildSearchIndex(catalog: CatalogItem[]): SearchIndex {
  const entries: Entry[] = catalog.map((item) => {
    const name = fold(item.label);
    const fields: Field[] = [];
    if (item.kind === 'muscle') {
      const info = muscleInfo(item.key);
      if (info.innervation) fields.push(field('Innervation', info.innervation));
      const seen = new Set<string>();
      for (const m of movementsOfMuscle(item.key)) {
        if (seen.has(m.name)) continue;
        seen.add(m.name);
        fields.push(mkField('Movement', m.name, `${m.name} (${ROLE_NAME[m.role]})`, FIELD_WEIGHT.Movement + ROLE_BONUS[m.role]));
      }
      if (info.action) fields.push(field('Action', info.action));
      if (info.origin) fields.push(field('Origin', info.origin));
      if (info.insertion) fields.push(field('Insertion', info.insertion));
    }
    if (KINDS[item.kind].library === 'joint') fields.push(mkField('Description', jointInfo(item).description, jointInfo(item).description, 120));
    fields.push(field('Region', item.region));
    return { item, name, nameWords: words(name), nameKey: words(name).join(' '), group: fold(item.group), fields };
  });

  const byKey = new Map<string, Entry>();
  const jointByKey = new Map<string, Entry>();
  for (const e of entries) {
    byKey.set(`${e.item.kind}:${e.item.key}`, e);
    if (KINDS[e.item.kind].library === 'joint') jointByKey.set(e.item.key, e);
  }
  const aliases: SearchIndex['aliases'] = [];
  for (const a of ALIASES) {
    const targets = [
      ...(a.muscles ?? []).map((k) => byKey.get(`muscle:${k}`)),
      ...(a.bones ?? []).map((k) => byKey.get(`bone:${k}`)),
      ...(a.joints ?? []).map((k) => jointByKey.get(k)),
    ].filter((e): e is Entry => !!e);
    if (!targets.length) continue;
    for (const term of a.terms) aliases.push({ term, key: words(fold(term)).join(' '), display: term, as: a.as, targets });
  }
  return { entries, aliases };
}

// ---------------------------------------------------------------------------------------------------------------
// scoring

const NAME_PREFIX = 750;
const NAME_WORD = 700;
const NAME_SUB = 500;
const GROUP_WORD = 300;
const GROUP_SUB = 250;
const SUB_PENALTY = 40;
const FUZZY_BASE = 80;
const BONUS_EXACT_NAME = 2000;
const BONUS_PREFIX_NAME = 1000;
/** The whole multi-word query appears as a phrase in a field ("radial nerve" in Innervation). */
const BONUS_PHRASE = 700;

type Hit = { at: number; wordStart: boolean } | null;

/** Where `tok` occurs in folded `text`: the first word-start occurrence, else any occurrence (3+ letters only). */
function find(text: string, tok: string, whole = false, strictShort = false): Hit {
  let any = -1;
  for (let i = text.indexOf(tok); i !== -1; i = text.indexOf(tok, i + 1)) {
    const start = i === 0 || !isAlnum(text[i - 1]);
    // With `strictShort`, very short tokens ("c5", "l4", "of") must be a whole word: they would otherwise hit anywhere.
    const end = i + tok.length >= text.length || !isAlnum(text[i + tok.length]);
    if (start && (end || (!whole && !(strictShort && tok.length <= 2)))) return { at: i, wordStart: true };
    if (any < 0 && tok.length >= 3 && !whole) any = i;
  }
  return any >= 0 ? { at: any, wordStart: false } : null;
}

/** Optimal-string-alignment distance (insert, delete, substitute, transpose), giving up above `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur[j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

const FUZZY_MIN_LEN = 4;
const fuzzyMax = (len: number) => (len <= 7 ? 1 : 2);

/** Typo-tolerant match of a query word against the words of a name; null when too far. Higher is closer. */
function fuzzyName(tok: string, e: Entry): number | null {
  if (tok.length < FUZZY_MIN_LEN) return null;
  const max = fuzzyMax(tok.length);
  let best = max + 1;
  for (const w of e.nameWords) {
    best = Math.min(best, editDistance(tok, w, max));
    // a word typed so far, with a slip in it ("gastrocnemu")
    if (tok.length >= 5 && w.length > tok.length) best = Math.min(best, editDistance(tok, w.slice(0, tok.length), max));
  }
  return best <= max ? FUZZY_BASE - best * 10 : null;
}

interface TokenHit { score: number; src: 'name' | 'group' | 'field' | 'fuzzy'; field?: Field; at?: number; tok?: string }

function scoreToken(e: Entry, tok: string, fuzzy: boolean): TokenHit | null {
  let best = null as TokenHit | null;
  const take = (h: TokenHit) => { if (!best || h.score > best.score) best = h; };
  for (const { t: v, whole } of variants(tok)) {
    const n = find(e.name, v, whole);
    if (n) take({ score: n.at === 0 ? NAME_PREFIX : n.wordStart ? NAME_WORD : NAME_SUB, src: 'name' });
    const g = find(e.group, v, whole);
    if (g) take({ score: g.wordStart ? GROUP_WORD : GROUP_SUB, src: 'group' });
    for (const f of e.fields) {
      const h = find(f.text, v, whole, true);
      if (h) take({ score: f.weight - (h.wordStart ? 0 : SUB_PENALTY), src: 'field', field: f, at: h.at, tok: v });
    }
  }
  if (!best && fuzzy) {
    for (const { t: v } of variants(tok)) {
      const s = fuzzyName(v, e);
      if (s !== null) take({ score: s, src: 'fuzzy' });
    }
  }
  return best;
}

const SNIPPET = 64;

/** A short excerpt of `raw` around index `at`, trimmed at word edges, with ellipses where cut. */
function excerpt(raw: string, at: number, len: number): string {
  if (raw.length <= SNIPPET + 12) return raw;
  let from = Math.max(0, at - 18);
  let to = Math.min(raw.length, from + SNIPPET);
  from = Math.max(0, Math.min(from, to - SNIPPET));
  if (from > 0) { const sp = raw.indexOf(' ', from); if (sp !== -1 && sp < at) from = sp + 1; }
  if (to < raw.length) { const sp = raw.lastIndexOf(' ', to); if (sp > at + len) to = sp; }
  return `${from > 0 ? '…' : ''}${raw.slice(from, to).trim()}${to < raw.length ? '…' : ''}`;
}

interface Scored { score: number; reason?: MatchReason }

function scoreEntry(e: Entry, tokens: string[], qKey: string, fuzzy: boolean): Scored | null {
  let total = 0;
  const hits: TokenHit[] = [];
  for (const t of tokens) {
    const h = scoreToken(e, t, fuzzy);
    if (!h) return null;
    total += h.score;
    hits.push(h);
  }
  if (e.nameKey === qKey) total += BONUS_EXACT_NAME;
  else if (e.nameKey.startsWith(qKey)) total += BONUS_PREFIX_NAME;

  let phrase: Field | null = null;
  if (tokens.length > 1) {
    for (const f of e.fields) if ((` ${f.key}`).includes(` ${qKey}`) && (!phrase || f.weight > phrase.weight)) phrase = f;
    if (phrase) total += BONUS_PHRASE;
  }
  if (phrase) {
    const at = find(phrase.text, tokens[0], false, true)?.at ?? 0;
    return { score: total, reason: { label: phrase.label, text: phrase.label === 'Movement' ? phrase.raw : excerpt(phrase.raw, at, tokens[0].length) } };
  }

  // Explain the match only when a word was found outside the name and group.
  const outside = hits.filter((h) => h.src === 'field');
  if (!outside.length) return { score: total };
  // The field that explains the most words wins, then the most informative one.
  const tally = new Map<Field, { n: number; first: TokenHit }>();
  for (const h of outside) {
    const t = tally.get(h.field!) ?? { n: 0, first: h };
    t.n++;
    tally.set(h.field!, t);
  }
  let pick: [Field, { n: number; first: TokenHit }] | null = null;
  for (const entry of tally) if (!pick || entry[1].n > pick[1].n || (entry[1].n === pick[1].n && entry[0].weight > pick[0].weight)) pick = entry;
  const [f, { first }] = pick!;
  const text = f.label === 'Movement' ? f.raw : excerpt(f.raw, first.at ?? 0, first.tok?.length ?? 0);
  return { score: total, reason: { label: f.label, text } };
}

function aliasScores(index: SearchIndex, qKey: string, fuzzy: boolean): Map<Entry, Scored> {
  const out = new Map<Entry, Scored>();
  const qs = qKey.endsWith('s') && qKey.length > 3 ? qKey.slice(0, -1) : null;
  for (const a of index.aliases) {
    let score = 0;
    if (a.key === qKey || (qs && a.key === qs)) score = EXACT_ALIAS;
    else if (qKey.length >= ALIAS_PREFIX_MIN && a.key.startsWith(qKey)) score = PREFIX_ALIAS;
    else if (fuzzy && qKey.length >= FUZZY_MIN_LEN) {
      const d = editDistance(qKey, a.key, fuzzyMax(qKey.length));
      if (d <= fuzzyMax(qKey.length)) score = FUZZY_BASE - 5 - d * 10;
    }
    if (!score) continue;
    const reason: MatchReason = a.as ? { label: 'Part of', text: a.as } : { label: 'Also called', text: a.display };
    for (const e of a.targets) {
      const cur = out.get(e);
      // no explanation needed when the item's own name already contains the alias ('sternum' -> Body of Sternum)
      if (!cur || score > cur.score) out.set(e, { score, reason: (' ' + e.nameKey + ' ').includes(' ' + a.key + ' ') ? undefined : reason });
    }
  }
  return out;
}

/** A joint surface is named after its bone ("Articular Cartilage of Femoral Head"): on equal scores the bone or muscle comes first. */
const isJoint = (r: SearchResult) => (KINDS[r.item.kind].library === 'joint' ? 1 : 0);
const byRank = (a: SearchResult, b: SearchResult) =>
  b.score - a.score || isJoint(a) - isJoint(b) || a.item.label.localeCompare(b.item.label, undefined, { numeric: true });

/**
 * Ranked results for `query`, best first. An empty query returns the first `limit` catalog items.
 * Typo tolerance is a fallback: it only runs when nothing matched exactly, so it can never outrank an exact match.
 */
export function search(index: SearchIndex, query: string, limit = 40): SearchResult[] {
  const tokens = tokenize(query);
  if (!tokens.length) return index.entries.slice(0, limit).map((e) => ({ item: e.item, score: 0 }));
  const qKey = tokens.join(' ');

  const run = (fuzzy: boolean): SearchResult[] => {
    const res: SearchResult[] = [];
    const alias = aliasScores(index, qKey, fuzzy);
    for (const e of index.entries) {
      const direct = scoreEntry(e, tokens, qKey, fuzzy);
      const viaAlias = alias.get(e);
      if (viaAlias && (!direct || viaAlias.score > direct.score)) res.push({ item: e.item, ...viaAlias });
      else if (direct) res.push({ item: e.item, ...direct });
    }
    return res.sort(byRank);
  };

  let res = run(false);
  if (!res.length && tokens.some((t) => t.length >= FUZZY_MIN_LEN)) res = run(true);
  return res.slice(0, limit);
}

const cache = new WeakMap<CatalogItem[], SearchIndex>();

/** The index for a catalog array, built on first use and kept for as long as that array lives. */
export function getSearchIndex(catalog: CatalogItem[]): SearchIndex {
  let idx = cache.get(catalog);
  if (!idx) { idx = buildSearchIndex(catalog); cache.set(catalog, idx); }
  return idx;
}
