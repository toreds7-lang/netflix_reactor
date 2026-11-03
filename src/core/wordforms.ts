/**
 * English word forms for 🔎 Find: "go" also finds "goes, going, went, gone", and "gonna" also finds "going to".
 * Forms are only ever looked up in the words of your saved episodes, so a wrong guess like "goed" finds nothing.
 */

/**
 * Irregular verbs and nouns: base form, then its other forms. "be" and the modal verbs are left out on purpose: their
 * other forms (is, are, would…) are in nearly every line, so they would only bury the lines you asked for.
 */
const IRREGULAR_LIST: string[] = [
  'have has had having',
  'do does did done doing',
  'go goes went gone going',
  'get gets got gotten getting',
  'make makes made making',
  'say says said saying',
  'know knows knew known knowing',
  'think thinks thought thinking',
  'take takes took taken taking',
  'see sees saw seen seeing',
  'come comes came coming',
  'give gives gave given giving',
  'find finds found finding',
  'tell tells told telling',
  'become becomes became becoming',
  'leave leaves left leaving',
  'feel feels felt feeling',
  'bring brings brought bringing',
  'begin begins began begun beginning',
  'keep keeps kept keeping',
  'hold holds held holding',
  'write writes wrote written writing',
  'stand stands stood standing',
  'understand understands understood understanding',
  'hear hears heard hearing',
  'let lets letting',
  'mean means meant meaning',
  'set sets setting',
  'meet meets met meeting',
  'run runs ran running',
  'pay pays paid paying',
  'sit sits sat sitting',
  'speak speaks spoke spoken speaking',
  'lie lies lay lain lying lied',
  'lay lays laid laying',
  'lead leads led leading',
  'read reads reading',
  'grow grows grew grown growing',
  'lose loses lost losing',
  'fall falls fell fallen falling',
  'send sends sent sending',
  'build builds built building',
  'spend spends spent spending',
  'cut cuts cutting',
  'rise rises rose risen rising',
  'drive drives drove driven driving',
  'buy buys bought buying',
  'wear wears wore worn wearing',
  'choose chooses chose chosen choosing',
  'seek seeks sought seeking',
  'throw throws threw thrown throwing',
  'catch catches caught catching',
  'deal deals dealt dealing',
  'win wins won winning',
  'forget forgets forgot forgotten forgetting',
  'forgive forgives forgave forgiven forgiving',
  'sell sells sold selling',
  'fight fights fought fighting',
  'teach teaches taught teaching',
  'eat eats ate eaten eating',
  'drink drinks drank drunk drinking',
  'sing sings sang sung singing',
  'ring rings rang rung ringing',
  'swim swims swam swum swimming',
  'sleep sleeps slept sleeping',
  'ride rides rode ridden riding',
  'hide hides hid hidden hiding',
  'fly flies flew flown flying',
  'steal steals stole stolen stealing',
  'shoot shoots shot shooting',
  'shake shakes shook shaken shaking',
  'wake wakes woke woken waking',
  'bite bites bit bitten biting',
  'blow blows blew blown blowing',
  'break breaks broke broken breaking',
  'freeze freezes froze frozen freezing',
  'hang hangs hung hanging',
  'hurt hurts hurting',
  'put puts putting',
  'quit quits quitting',
  'shut shuts shutting',
  'hit hits hitting',
  'cost costs costing',
  'bet bets betting',
  'sink sinks sank sunk sinking',
  'stick sticks stuck sticking',
  'strike strikes struck striking',
  'swear swears swore sworn swearing',
  'tear tears tore torn tearing',
  'bend bends bent bending',
  'bleed bleeds bled bleeding',
  'feed feeds fed feeding',
  'lend lends lent lending',
  'light lights lit lighting',
  'shine shines shone shining',
  'beat beats beaten beating',
  'bear bears bore born borne bearing',
  'draw draws drew drawn drawing',
  'dig digs dug digging',
  'show shows showed shown showing',
  'spin spins spun spinning',
  'spit spits spat spitting',
  'split splits splitting',
  'spread spreads spreading',
  'sweep sweeps swept sweeping',
  'swing swings swung swinging',
  'weep weeps wept weeping',
  'wind winds wound winding',
  'flee flees fled fleeing',
  'mistake mistakes mistook mistaken mistaking',
  'overcome overcomes overcame overcoming',
  'undo undoes undid undone undoing',
  'upset upsets upsetting',
  'man men',
  'woman women',
  'child children',
  'person people',
  'foot feet',
  'tooth teeth',
  'mouse mice',
  'life lives',
  'wife wives',
  'knife knives',
  'half halves',
  'leaf leaves',
  'wolf wolves',
  'shelf shelves',
  'thief thieves',
];

/** Base form → its other forms. */
const IRREGULAR = new Map<string, string[]>();
/** Any form → the base forms it belongs to ("leaves" is both "leave" and "leaf"). */
const BASE_OF = new Map<string, string[]>();
for (const line of IRREGULAR_LIST) {
  const [base, ...forms] = line.split(' ');
  IRREGULAR.set(base, [...new Set([...(IRREGULAR.get(base) ?? []), ...forms])]);
  for (const f of [base, ...forms]) {
    const list = BASE_OF.get(f) ?? [];
    if (!list.includes(base)) list.push(base);
    BASE_OF.set(f, list);
  }
}

/**
 * Words the simple rules get wrong ("evening" is not "even" + "-ing", "news" is not "new" + "-s"): they never get
 * other forms, and are never one.
 */
const NO_RULES = new Set([
  'even', 'evening', 'evenings', 'morn', 'morning', 'mornings', 'new', 'news', 'our', 'ours', 'your', 'yours', 'her', 'hers',
  'their', 'theirs', 'wed', 'wedding', 'weddings', 'ceil', 'ceiling', 'during', 'fee', 'being', 'will',
  'willing', 'interest', 'interesting', 'lens', 'pants', 'series', 'species',
]);

const VOWEL = /[aeiou]/;
const CONSONANT = /[b-df-hj-np-tv-z]/;

/** "stop" → "stopp": short consonant-vowel-consonant words double their last letter before -ed and -ing. */
function doubled(w: string): string | null {
  const n = w.length;
  if (n < 3 || n > 6) return null;
  const [a, b, c] = [w[n - 3], w[n - 2], w[n - 1]];
  return CONSONANT.test(a) && VOWEL.test(b) && CONSONANT.test(c) && !/[wxy]/.test(c) ? w + c : null;
}

/** Forms the regular rules make from a base form; most of them don't exist and are filtered out later. */
function regularForms(base: string): string[] {
  if (base.length < 3 || NO_RULES.has(base) || base.includes("'")) return [];
  const out = [`${base}s`, `${base}es`, `${base}ed`, `${base}ing`];
  if (base.endsWith('e')) out.push(`${base}d`, `${base.slice(0, -1)}ing`);
  if (/[^aeiou]y$/.test(base)) out.push(`${base.slice(0, -1)}ies`, `${base.slice(0, -1)}ied`);
  if (base.endsWith('ie')) out.push(`${base.slice(0, -2)}ying`);
  const d = doubled(base);
  if (d) out.push(`${d}ed`, `${d}ing`);
  return out;
}

/** Base forms a word could come from by the regular rules ("making" → "make", "cities" → "city"). */
function regularBases(w: string): string[] {
  if (w.length < 4 || NO_RULES.has(w) || w.includes("'")) return [];
  const out: string[] = [];
  const add = (b: string) => b.length >= 3 && !NO_RULES.has(b) && out.push(b);
  if (w.endsWith('ies')) add(`${w.slice(0, -3)}y`);
  else if (w.endsWith('es')) {
    add(w.slice(0, -2));
    add(w.slice(0, -1));
  } else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) add(w.slice(0, -1));
  if (w.endsWith('ied')) add(`${w.slice(0, -3)}y`);
  else if (w.endsWith('ed')) {
    const stem = w.slice(0, -2);
    add(stem);
    add(`${stem}e`);
    if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) add(stem.slice(0, -1));
  }
  if (w.endsWith('ing')) {
    const stem = w.slice(0, -3);
    add(stem);
    add(`${stem}e`);
    if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) add(stem.slice(0, -1));
  }
  return out;
}

/**
 * The word and its other forms that occur in your episodes (`has`), the word itself first. Irregular forms come from a
 * list; regular ones from the -s / -ed / -ing rules, in both directions.
 */
export function formsOf(word: string, has: (w: string) => boolean): string[] {
  const bases = new Set<string>();
  const irregular = BASE_OF.get(word);
  if (irregular) irregular.forEach((b) => bases.add(b));
  else {
    bases.add(word);
    for (const b of regularBases(word)) if (has(b) || IRREGULAR.has(b)) bases.add(b);
  }
  const out = new Set<string>([word]);
  for (const b of bases) {
    const forms = IRREGULAR.get(b) ?? regularForms(b);
    for (const f of [b, ...forms]) if (f !== word && has(f)) out.add(f);
  }
  return [...out];
}

/** Spoken forms and what they stand for: both ways round count as the same in 🔎 Find. */
const SPOKEN: [string[], string[]][] = [
  [['gonna'], ['going', 'to']],
  [['wanna'], ['want', 'to']],
  [['gotta'], ['got', 'to']],
  [['hafta'], ['have', 'to']],
  [['kinda'], ['kind', 'of']],
  [['sorta'], ['sort', 'of']],
  [['outta'], ['out', 'of']],
  [['lotta'], ['lot', 'of']],
  [['lemme'], ['let', 'me']],
  [['gimme'], ['give', 'me']],
  [['dunno'], ["don't", 'know']],
  [['gotcha'], ['got', 'you']],
  [["y'all"], ['you', 'all']],
  [["'cause"], ['because']],
  [['cuz'], ['because']],
  [['cos'], ['because']],
  [["'em"], ['them']],
  [["'til"], ['until']],
  [["'bout"], ['about']],
];

const sameSeq = (words: string[], at: number, seq: string[]) => seq.every((w, k) => words[at + k] === w);

/**
 * The query with one spoken form swapped for what it stands for, or the other way round: "you're gonna have to" →
 * "you're going to have to". One list per swap found.
 */
export function spokenAlternatives(words: string[]): string[][] {
  const out: string[][] = [];
  const seen = new Set<string>([words.join(' ')]);
  for (let i = 0; i < words.length; i++) {
    for (const [a, b] of SPOKEN) {
      for (const [from, to] of [
        [a, b],
        [b, a],
      ]) {
        if (!sameSeq(words, i, from)) continue;
        const alt = [...words.slice(0, i), ...to, ...words.slice(i + from.length)];
        const key = alt.join(' ');
        if (!seen.has(key)) {
          seen.add(key);
          out.push(alt);
        }
      }
    }
  }
  return out;
}

/** Shortened words whose leading apostrophe is part of the word ("'cause", "'em"), so it is kept. */
export const CLIPPED = new Set(SPOKEN.flatMap(([a]) => a).filter((w) => w.startsWith("'")));
