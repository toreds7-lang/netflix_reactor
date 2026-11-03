import { cueUnitIndex, type KeyUnit } from './keylines';
import { baseLang } from './langs';
import type { FindLength, FindScope } from './settings';
import { flatten } from './subtitles';
import type { Cue, LineMark } from './types';
import { CLIPPED, formsOf, spokenAlternatives } from './wordforms';

/**
 * 🔎 Find in my shows: every episode you open is saved as sentences (with their translation line and the parts you
 * watched), so a word, a phrase, a pattern or a Korean line can be looked up across all of them. The functions here
 * are plain; the background keeps the saved episodes (src/services/library.ts) and the page plays what is found.
 */

// ---------------------------------------------------------------- saved episodes

/** A displayed subtitle line, found again by text and time like a bookmark (the language is the episode's). */
export interface LibLine {
  timeMs: number;
  text: string;
}

/** One sentence of a saved episode, built like the key-line sentences (one or more subtitle lines). */
export interface LibSentence {
  /** Start of its first line and end of its last line (ms, Netflix content time). */
  start: number;
  end: number;
  text: string;
  /** The translation line, when every line of the sentence had one. */
  tr?: string;
  /** Its first displayed line; `to` only when the sentence has more than one. */
  from: LibLine;
  to?: LibLine;
}

export interface LibraryEpisode {
  /** `libraryKey(videoId, lang)` */
  key: string;
  videoId: string;
  /** Language of the subtitles. */
  lang: string;
  /** The show (or film), and "S1:E3 “Title”" for an episode of a series. */
  show?: string;
  episode?: string;
  /** Language of the translation lines and where they came from. */
  trLang?: string;
  trKind?: 'human' | 'machine';
  sentences: LibSentence[];
  /** The words of each sentence (`wordsOf`), joined by spaces, in the same order: what the index is built from. */
  words: string[];
  savedAt: number;
  updatedAt: number;
}

/** The parts of an episode you played, as sorted, non-overlapping [start, end] ranges in ms. */
export interface LibraryWatched {
  key: string;
  ranges: [number, number][];
  updatedAt: number;
}

export function libraryKey(videoId: string, lang: string): string {
  return `${videoId}|${lang}`;
}

/** What the page sends when an episode's subtitles (or more of its translations) are in. */
export interface LibrarySaveRequest {
  videoId: string;
  lang: string;
  show?: string;
  episode?: string;
  trLang?: string;
  trKind?: 'human' | 'machine';
  sentences: LibSentence[];
}

/**
 * The episode's sentences for the library: the key-line sentences (`units`, built from the raw lines), each with its
 * first and last displayed line and, when all its lines have one, the translation line.
 */
export function librarySentences(units: KeyUnit[], cues: Cue[], translations: (string | null)[]): LibSentence[] {
  const unitOf = cueUnitIndex(cues, units);
  const first = new Array<number>(units.length).fill(-1);
  const last = new Array<number>(units.length).fill(-1);
  unitOf.forEach((u, i) => {
    if (u < 0) return;
    if (first[u] < 0) first[u] = i;
    last[u] = i;
  });
  return units.map((u, k) => {
    const a = first[k];
    const b = last[k];
    if (a < 0) return { start: u.start, end: u.end, text: u.text, from: { timeMs: u.start, text: u.text } };
    const s: LibSentence = { start: u.start, end: u.end, text: u.text, from: { timeMs: cues[a].start, text: flatten(cues[a].text) } };
    if (b !== a) s.to = { timeMs: cues[b].start, text: flatten(cues[b].text) };
    const tr = translations.slice(a, b + 1);
    if (tr.length === b - a + 1 && tr.every((t) => t != null)) {
      const joined = tr.filter(Boolean).join(' ').trim();
      if (joined) s.tr = joined;
    }
    return s;
  });
}

// ---------------------------------------------------------------- words

export interface WordToken {
  /** Lower case, curly apostrophes made straight: what is indexed and compared. */
  word: string;
  /** Where it is in the text, to highlight it. */
  index: number;
  length: number;
}

/** Languages written without spaces between words: split with the browser's word segmenter instead. */
const SPACELESS = /^(ja|zh|th|lo|km|my)\b/i;
const WORD_RE = /['’‘]?[\p{L}\p{N}\p{M}]+(?:['’‘][\p{L}\p{N}\p{M}]+)*['’]?/gu;
const segmenters = new Map<string, Intl.Segmenter>();

export function normWord(raw: string): string {
  const w = raw.normalize('NFC').toLowerCase().replace(/[’‘`]/g, "'");
  const bare = w.replace(/^'+|'+$/g, '');
  return w.startsWith("'") && CLIPPED.has(`'${bare}`) ? `'${bare}` : bare;
}

/** The words of a line, in order, for the index and for highlighting what matched. */
export function wordsOf(text: string, lang: string): WordToken[] {
  const out: WordToken[] = [];
  if (SPACELESS.test(lang)) {
    let seg = segmenters.get(lang);
    if (!seg) {
      seg = new Intl.Segmenter(lang, { granularity: 'word' });
      segmenters.set(lang, seg);
    }
    for (const s of seg.segment(text)) {
      const word = s.isWordLike ? normWord(s.segment) : '';
      if (word) out.push({ word, index: s.index, length: s.segment.length });
    }
    return out;
  }
  for (const m of text.matchAll(WORD_RE)) {
    const word = normWord(m[0]);
    if (word) out.push({ word, index: m.index, length: m[0].length });
  }
  return out;
}

/** The words of a line joined by spaces, as stored with the episode. */
export function wordLine(text: string, lang: string): string {
  return wordsOf(text, lang)
    .map((t) => t.word)
    .join(' ');
}

/** "i'm gonna" → "I'm gonna": words as shown on a chunk chip. */
export function showWords(words: string[]): string {
  return words.map((w) => (w === 'i' || w.startsWith("i'") ? `I${w.slice(1)}` : w)).join(' ');
}

// ---------------------------------------------------------------- watched parts

/** A line counts as watched when it starts this close before a watched range. */
const WATCHED_SLACK_MS = 300;
/** Watched ranges closer than this are joined. */
const JOIN_GAP_MS = 1500;

/** `ranges` with `more` added: sorted, overlapping or nearly touching ranges joined. */
export function addRanges(ranges: [number, number][], more: [number, number][]): [number, number][] {
  const all = [...ranges, ...more].filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of all) {
    const prev = out[out.length - 1];
    if (prev && a - prev[1] <= JOIN_GAP_MS) prev[1] = Math.max(prev[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Whether a line starting at `start` is inside the watched ranges (sorted, as `addRanges` keeps them). */
export function isWatched(ranges: [number, number][] | undefined, start: number): boolean {
  if (!ranges?.length) return false;
  let lo = 0;
  let hi = ranges.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid][0] <= start + WATCHED_SLACK_MS) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 && start <= ranges[found][1];
}

/** Share of an episode's sentences you watched, 0–1. */
export function watchedShare(ep: Pick<LibraryEpisode, 'sentences'>, ranges: [number, number][] | undefined): number {
  if (!ep.sentences.length) return 0;
  return ep.sentences.filter((s) => isWatched(ranges, s.start)).length / ep.sentences.length;
}

// ---------------------------------------------------------------- the index

export interface LibraryIndex {
  episodes: LibraryEpisode[];
  /** For each sentence (by its id, a running number): its episode in `episodes` and its place there. */
  epOf: number[];
  atOf: number[];
  /** Each episode's first sentence id: its sentence i has id firstOf[e] + i. */
  firstOf: number[];
  words: string[][];
  /** Word → ids of the sentences that have it, ascending. */
  postings: Map<string, number[]>;
  /** The translation lines squeezed (no spaces or punctuation), made on the first Korean search. */
  squeezed?: (string | undefined)[];
}

export function buildIndex(episodes: LibraryEpisode[]): LibraryIndex {
  const idx: LibraryIndex = { episodes, epOf: [], atOf: [], firstOf: [], words: [], postings: new Map() };
  episodes.forEach((ep, e) => {
    idx.firstOf.push(idx.words.length);
    ep.sentences.forEach((_, i) => {
      const id = idx.words.length;
      const words = (ep.words[i] ?? '').split(' ').filter(Boolean);
      idx.epOf.push(e);
      idx.atOf.push(i);
      idx.words.push(words);
      for (const w of new Set(words)) {
        const list = idx.postings.get(w);
        if (list) list.push(id);
        else idx.postings.set(w, [id]);
      }
    });
  });
  return idx;
}

export function sentenceOf(idx: LibraryIndex, id: number): { ep: LibraryEpisode; s: LibSentence; at: number } {
  const ep = idx.episodes[idx.epOf[id]];
  const at = idx.atOf[id];
  return { ep, s: ep.sentences[at], at };
}

/** The id of the sentence of episode `key` starting at `start`, or -1. */
export function findSentenceId(idx: LibraryIndex, key: string, start: number): number {
  const e = idx.episodes.findIndex((ep) => ep.key === key);
  const at = e < 0 ? -1 : idx.episodes[e].sentences.findIndex((s) => s.start === start);
  return at < 0 ? -1 : idx.firstOf[e] + at;
}

// ---------------------------------------------------------------- matching

/** How a line was found, best first. */
export type HitTier = 'exact' | 'spoken' | 'forms' | 'pattern' | 'korean' | 'meaning';

export const TIER_ORDER: Record<HitTier, number> = { exact: 0, spoken: 1, forms: 2, pattern: 3, korean: 4, meaning: 5 };

export interface Match {
  id: number;
  tier: HitTier;
  /** Positions in the sentence's words that matched, to highlight. */
  marks: number[];
  /** Similarity, for Korean and same-meaning matches. */
  score?: number;
}

/** A query word, or null for `*` (up to MAX_GAP other words). */
export type QueryPart = string | null;

/** Words `*` may stand for in a pattern. */
export const MAX_GAP = 3;

const GAP = /(\*+|_{2,})/;

/** A query as words, `*` and `___` as gaps; gaps at either end are dropped. */
export function parseQuery(q: string, lang: string): QueryPart[] {
  const parts: QueryPart[] = [];
  for (const piece of q.split(GAP)) {
    if (GAP.test(piece)) {
      if (parts.length && parts[parts.length - 1] !== null) parts.push(null);
      continue;
    }
    for (const t of wordsOf(piece, lang)) parts.push(t.word);
  }
  while (parts.length && parts[parts.length - 1] === null) parts.pop();
  return parts;
}

type Element = Set<string> | null;

function matchFrom(words: string[], els: Element[], k: number, s: number, marks: number[]): boolean {
  if (k === els.length) return true;
  const el = els[k];
  if (!el) {
    for (let g = 0; g <= MAX_GAP && s + g <= words.length; g++) if (matchFrom(words, els, k + 1, s + g, marks)) return true;
    return false;
  }
  if (s >= words.length || !el.has(words[s])) return false;
  marks.push(s);
  if (matchFrom(words, els, k + 1, s + 1, marks)) return true;
  marks.pop();
  return false;
}

/** Where the elements first match in `words`, as the positions of the matched words, or null. */
export function matchWords(words: string[], els: Element[]): number[] | null {
  for (let s = 0; s < words.length; s++) {
    const marks: number[] = [];
    if (matchFrom(words, els, 0, s, marks)) return marks;
  }
  return null;
}

/** Ids of the sentences with any of these words, ascending. */
function linesWithAny(idx: LibraryIndex, alts: Set<string>): number[] {
  const lists = [...alts].map((w) => idx.postings.get(w) ?? []);
  if (lists.length === 1) return lists[0];
  return [...new Set(lists.flat())].sort((a, b) => a - b);
}

/** The element whose words are in the fewest lines: only its lines need checking. */
function rarest(idx: LibraryIndex, els: Element[]): Set<string> | null {
  let best: Set<string> | null = null;
  let size = Infinity;
  for (const el of els) {
    if (!el) continue;
    const n = [...el].reduce((sum, w) => sum + (idx.postings.get(w)?.length ?? 0), 0);
    if (n < size) {
      size = n;
      best = el;
    }
  }
  return best;
}

export interface TextMatches {
  matches: Match[];
  /** The other forms of the query's words that were found ("went", "gone"). */
  forms: string[];
}

/**
 * Lines with the query's words in this order: the same words first, then spoken forms ("gonna" for "going to"), then
 * other forms of the words ("went" for "go", English only). With `*`, a pattern: the words in order with up to
 * MAX_GAP others in each gap.
 */
export function textMatches(idx: LibraryIndex, parts: QueryPart[], lang: string): TextMatches {
  const words = parts.filter((p): p is string => p !== null);
  if (!words.length) return { matches: [], forms: [] };
  const english = baseLang(lang) === 'en';
  const pattern = parts.includes(null);
  const has = (w: string) => idx.postings.has(w);
  const best = new Map<number, Match>();
  const forms = new Set<string>();
  const add = (m: Match) => {
    const have = best.get(m.id);
    if (!have || TIER_ORDER[m.tier] < TIER_ORDER[have.tier]) best.set(m.id, m);
  };
  const run = (ps: QueryPart[], exactTier: HitTier, formsTier: HitTier | null) => {
    const exact: Element[] = ps.map((p) => (p === null ? null : new Set([p])));
    const loose: Element[] | null = formsTier && english ? ps.map((p) => (p === null ? null : new Set(formsOf(p, has)))) : null;
    const pick = rarest(idx, loose ?? exact);
    if (!pick) return;
    for (const id of linesWithAny(idx, pick)) {
      const w = idx.words[id];
      const marks = matchWords(w, exact);
      if (marks) {
        add({ id, tier: exactTier, marks });
        continue;
      }
      const other = loose && matchWords(w, loose);
      if (!other) continue;
      add({ id, tier: formsTier!, marks: other });
      for (const k of other) if (!words.includes(w[k])) forms.add(w[k]);
    }
  };
  run(parts, pattern ? 'pattern' : 'exact', pattern ? 'pattern' : 'forms');
  if (!pattern) for (const alt of spokenAlternatives(words)) run(alt, 'spoken', null);
  return { matches: [...best.values()], forms: [...forms].sort() };
}

// ---------------------------------------------------------------- chunks

/** Words that alone make no chunk worth practising ("of the", "it is"). */
const FILLER = new Set(
  (
    "a an the of to in on at and or but is it that this for with as be was are were i you he she we they me him her us " +
    "them my your so just oh uh um yeah okay ok hey well like it's i'm that's what's there's"
  ).split(' '),
);
/** A chunk doesn't end in these: "have to go to the" is not a piece you can reuse. */
const BAD_END = new Set(['a', 'an', 'the', 'my', 'your', 'his', 'her', 'our', 'their', 'its']);
const BAD_START = new Set(['and', 'but', 'or']);

export interface LibraryChunk {
  words: string[];
  /** As shown: "I don't think". */
  text: string;
  /** In how many episodes, and in how many lines. */
  episodes: number;
  lines: number;
}

const CHUNK_MIN_WORDS = 2;
const CHUNK_MAX_WORDS = 5;
/** A longer chunk in at least this share of a shorter one's episodes makes the shorter one say nothing new. */
const NEARLY_AS_OFTEN = 0.8;

function goodChunk(seq: string[]): boolean {
  if (seq.every((w) => FILLER.has(w))) return false;
  if (BAD_END.has(seq[seq.length - 1]) || BAD_START.has(seq[0])) return false;
  return !seq.some((w) => /^\d+$/.test(w));
}

function contains(big: string[], small: string[]): boolean {
  for (let i = 0; i + small.length <= big.length; i++) if (small.every((w, k) => big[i + k] === w)) return true;
  return false;
}

/**
 * The runs of 2–5 words in a line that other episodes have too: what you can reuse when you speak. A shorter chunk is
 * left out when a longer one holding it is found nearly as often. Most episodes first, longer ones a little ahead.
 */
export function findChunks(
  idx: LibraryIndex,
  words: string[],
  { minEpisodes = 2, max = 6 }: { minEpisodes?: number; max?: number } = {},
): LibraryChunk[] {
  const found: LibraryChunk[] = [];
  const seen = new Set<string>();
  for (let len = CHUNK_MAX_WORDS; len >= CHUNK_MIN_WORDS; len--) {
    for (let s = 0; s + len <= words.length; s++) {
      const seq = words.slice(s, s + len);
      const key = seq.join(' ');
      if (seen.has(key) || !goodChunk(seq)) continue;
      seen.add(key);
      const els = seq.map((w) => new Set([w]));
      const episodes = new Set<number>();
      let lines = 0;
      for (const id of linesWithAny(idx, rarest(idx, els)!)) {
        if (!matchWords(idx.words[id], els)) continue;
        episodes.add(idx.epOf[id]);
        lines++;
      }
      if (episodes.size >= minEpisodes) found.push({ words: seq, text: showWords(seq), episodes: episodes.size, lines });
    }
  }
  const kept: LibraryChunk[] = [];
  for (const c of found) {
    if (kept.some((k) => contains(k.words, c.words) && k.episodes >= c.episodes * NEARLY_AS_OFTEN)) continue;
    kept.push(c);
  }
  const score = (c: LibraryChunk) => c.episodes * (1 + 0.3 * (c.words.length - 2));
  return kept.sort((a, b) => score(b) - score(a)).slice(0, max);
}

// ---------------------------------------------------------------- Korean (the translation line)

const HANGUL = /\p{Script=Hangul}/u;

export function hasHangul(s: string): boolean {
  return HANGUL.test(s);
}

/** Letters and digits only: Korean spacing varies, so it is ignored. */
export function squeeze(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Pairs of letters: 알았어 and 알았다 share 알았, so a changed word ending still matches. */
export function letterPairs(s: string): string[] {
  const c = squeeze(s);
  if (c.length < 2) return c ? [c] : [];
  const out = new Set<string>();
  for (let i = 0; i + 2 <= c.length; i++) out.add(c.slice(i, i + 2));
  return [...out];
}

/**
 * Lines whose translation line is like the query, by shared letter pairs: at least 60% of the query's pairs (all of
 * them for a query of one or two pairs). Having the whole query counts extra.
 */
export function translationMatches(idx: LibraryIndex, query: string): Match[] {
  const pairs = letterPairs(query);
  if (!pairs.length) return [];
  const need = pairs.length <= 2 ? pairs.length : Math.ceil(pairs.length * 0.6);
  const whole = squeeze(query);
  idx.squeezed ??= idx.words.map((_, id) => {
    const tr = sentenceOf(idx, id).s.tr;
    return tr ? squeeze(tr) : undefined;
  });
  const out: Match[] = [];
  idx.squeezed.forEach((tr, id) => {
    if (!tr) return;
    let n = 0;
    for (const p of pairs) if (tr.includes(p)) n++;
    if (n >= need) out.push({ id, tier: 'korean', marks: [], score: n / pairs.length + (tr.includes(whole) ? 0.5 : 0) });
  });
  return out;
}

// ---------------------------------------------------------------- results

export interface HitFilters {
  /** The episode open now. */
  here: string | null;
  scope: FindScope;
  length: FindLength;
  /** Only lines from parts you already played. */
  watchedOnly: boolean;
  /** Only this show. */
  show?: string;
  /** Only 🎤 key lines (shadowing picks). */
  keyOnly: boolean;
}

/** A line found, ready to show and play. */
export interface LibraryHit {
  /** `${videoId}|${lang}|${start}` */
  id: string;
  videoId: string;
  lang: string;
  show?: string;
  episode?: string;
  start: number;
  end: number;
  text: string;
  tr?: string;
  from: LineMark;
  to: LineMark;
  /** The sentences before and after it, for context. */
  before?: string;
  after?: string;
  /** Positions in `wordsOf(text)` that matched, to highlight. */
  marks: number[];
  tier: HitTier;
  watched: boolean;
  /** Lines with the same text, shown once. */
  dup: number;
  score?: number;
  /** A 🎤 key line of its episode. */
  key?: boolean;
}

/** Short lines are easy to shadow. */
export function lengthOf(words: number): Exclude<FindLength, 'any'> {
  return words <= 6 ? 'short' : words <= 14 ? 'medium' : 'long';
}

/** 5–12 words is best for shadowing; the further from that, the later a line comes. */
function lengthPenalty(words: number): number {
  return words < 5 ? 5 - words : words > 12 ? words - 12 : 0;
}

/** Text compared loosely, so lines that differ only in case or punctuation are the same line. */
export const looseText = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export interface RankContext {
  /** Learning language (base code): only episodes in it are searched. */
  lang: string;
  watched: (ep: LibraryEpisode, start: number) => boolean;
  isKey?: (ep: LibraryEpisode, text: string) => boolean;
  /** Sentence ids to leave out (the line you search from). */
  exclude?: Set<number>;
}

export interface Ranked {
  hits: LibraryHit[];
  /** All lines found (each text once), before the limit. */
  total: number;
  /** Shows among the lines found, for the show filter. */
  shows: string[];
}

/** At most this many lines of one episode come before the rest, so you hear different people. */
const PER_EPISODE_FIRST = 2;

/**
 * Filter, sort and shape the lines found. Best match first, then lines you already watched, then ones that are easy to
 * shadow. The same text is shown once with a count, and at most two lines per episode come first in each kind of match.
 */
export function rankMatches(idx: LibraryIndex, matches: Match[], f: HitFilters, ctx: RankContext, limit = 150): Ranked {
  type Cand = { m: Match; ep: LibraryEpisode; s: LibSentence; at: number; n: number; watched: boolean; key: boolean };
  const cands: Cand[] = [];
  const shows = new Set<string>();
  for (const m of matches) {
    if (ctx.exclude?.has(m.id)) continue;
    const { ep, s, at } = sentenceOf(idx, m.id);
    if (baseLang(ep.lang) !== ctx.lang) continue;
    if (f.scope === 'here' && ep.videoId !== f.here) continue;
    if (f.scope === 'others' && ep.videoId === f.here) continue;
    const n = idx.words[m.id].length;
    if (f.length !== 'any' && lengthOf(n) !== f.length) continue;
    const watched = ctx.watched(ep, s.start);
    if (f.watchedOnly && !watched) continue;
    const key = !!ctx.isKey?.(ep, s.text);
    if (f.keyOnly && !key) continue;
    if (ep.show) shows.add(ep.show);
    if (f.show && ep.show !== f.show) continue;
    cands.push({ m, ep, s, at, n, watched, key });
  }
  const better = (a: Cand, b: Cand) =>
    TIER_ORDER[a.m.tier] - TIER_ORDER[b.m.tier] ||
    Number(b.watched) - Number(a.watched) ||
    (b.m.score ?? 0) - (a.m.score ?? 0) ||
    lengthPenalty(a.n) - lengthPenalty(b.n) ||
    Number(b.ep.videoId === f.here) - Number(a.ep.videoId === f.here) ||
    b.ep.updatedAt - a.ep.updatedAt ||
    a.s.start - b.s.start;
  const groups = new Map<string, { best: Cand; count: number }>();
  for (const c of cands) {
    const k = looseText(c.s.text) || `#${c.m.id}`;
    const g = groups.get(k);
    if (!g) groups.set(k, { best: c, count: 1 });
    else {
      g.count++;
      if (better(c, g.best) < 0) g.best = c;
    }
  }
  const sorted = [...groups.values()].sort((a, b) => better(a.best, b.best));
  // Within each kind of match: up to two lines per episode first, then the rest in order.
  const ordered: typeof sorted = [];
  for (let i = 0; i < sorted.length; ) {
    const tier = sorted[i].best.m.tier;
    let j = i;
    while (j < sorted.length && sorted[j].best.m.tier === tier) j++;
    const perEp = new Map<string, number>();
    const rest: typeof sorted = [];
    for (const g of sorted.slice(i, j)) {
      const n = perEp.get(g.best.ep.key) ?? 0;
      if (n < PER_EPISODE_FIRST) {
        perEp.set(g.best.ep.key, n + 1);
        ordered.push(g);
      } else rest.push(g);
    }
    ordered.push(...rest);
    i = j;
  }
  const hits = ordered.slice(0, limit).map(({ best: c, count }) => {
    const prev = c.ep.sentences[c.at - 1];
    const next = c.ep.sentences[c.at + 1];
    const from: LineMark = { ...c.s.from, lang: c.ep.lang };
    const hit: LibraryHit = {
      id: `${c.ep.videoId}|${c.ep.lang}|${c.s.start}`,
      videoId: c.ep.videoId,
      lang: c.ep.lang,
      show: c.ep.show,
      episode: c.ep.episode,
      start: c.s.start,
      end: c.s.end,
      text: c.s.text,
      tr: c.s.tr,
      from,
      to: c.s.to ? { ...c.s.to, lang: c.ep.lang } : from,
      before: prev?.text,
      after: next?.text,
      marks: c.m.marks,
      tier: c.m.tier,
      watched: c.watched,
      dup: count,
    };
    if (c.m.score != null) hit.score = +c.m.score.toFixed(3);
    if (c.key) hit.key = true;
    return hit;
  });
  return { hits, total: ordered.length, shows: [...shows].sort() };
}

// ---------------------------------------------------------------- requests

/** The line a "find lines like this" search starts from. */
export interface LikeLine {
  videoId: string;
  lang: string;
  start: number;
  text: string;
}

export interface LibrarySearchRequest extends HitFilters {
  /** Words, a phrase, a pattern with `*`, or a Korean line. Empty with `like`. */
  query: string;
  like?: LikeLine;
  /** The language you are learning (the subtitles shown). */
  lang: string;
  limit?: number;
}

export interface LibrarySearchResult {
  hits: LibraryHit[];
  total: number;
  forms: string[];
  /** For `like`: the line's chunks found in other episodes. */
  chunks: LibraryChunk[];
  shows: string[];
  /** The query was Korean: matched against the translation lines. */
  korean: boolean;
  /** Episodes and sentences saved in this language. */
  episodes: number;
  sentences: number;
}

/** The meaning model: how much of the library it has read. */
export interface MeaningStatus {
  state: 'off' | 'idle' | 'working' | 'error';
  /** Episodes ready for same-meaning search, of all saved. */
  indexed: number;
  total: number;
  /** Share of the model downloaded while it loads, or null. */
  progress?: number | null;
  error?: string;
}

export type LibraryMeaningRequest = LibrarySearchRequest;

export interface LibraryMeaningResult {
  hits: LibraryHit[];
  status: MeaningStatus;
  /** A Korean query, translated into the learning language to find its meaning. */
  translated?: string;
}

/** One saved episode, as listed in Options. */
export interface LibraryListItem {
  key: string;
  videoId: string;
  lang: string;
  show?: string;
  episode?: string;
  trLang?: string;
  trKind?: 'human' | 'machine';
  sentences: number;
  /** Share of its sentences you watched, 0–1. */
  watched: number;
  /** Ready for same-meaning search. */
  meaning: boolean;
  savedAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------- playing what was found

/** A line in a 🔎 Play all / Shadow all run. */
export interface FindRunItem {
  videoId: string;
  lang: string;
  /** "Show · S1:E3 …" */
  title?: string;
  start: number;
  end: number;
  text: string;
  from: LineMark;
  to: LineMark;
}

/** Lines found, played one after another. Kept in storage, so it carries on after another episode opens. */
export interface FindRun {
  mode: 'play' | 'shadow';
  /** Passes of each line in shadow mode. */
  passes: number;
  /** What was searched, for the bar. */
  label: string;
  items: FindRunItem[];
  index: number;
  /** Last activity; an old run is dropped. */
  at: number;
}

/** A run untouched for this long is over. */
export const FIND_RUN_TTL_MS = 30 * 60_000;

export function isFreshRun(r: FindRun | null | undefined, now: number): r is FindRun {
  return !!r && r.index < r.items.length && now - r.at < FIND_RUN_TTL_MS;
}

export function hitTitle(h: Pick<LibraryHit, 'show' | 'episode'>): string | undefined {
  return [h.show, h.episode].filter(Boolean).join(' · ') || undefined;
}

export function runItem(h: LibraryHit): FindRunItem {
  return { videoId: h.videoId, lang: h.lang, title: hitTitle(h), start: h.start, end: h.end, text: h.text, from: h.from, to: h.to };
}

/**
 * The order to play lines in: the episode open now first (no page load), then the other episodes in the order their
 * best line was found, each episode's lines in video order (no jumping back and forth).
 */
export function runOrder<T extends { videoId: string; start: number }>(lines: T[], here: string | null): T[] {
  const groups = new Map<string, T[]>();
  if (here && lines.some((l) => l.videoId === here)) groups.set(here, []);
  for (const l of lines) {
    const g = groups.get(l.videoId);
    if (g) g.push(l);
    else groups.set(l.videoId, [l]);
  }
  return [...groups.values()].flatMap((g) => g.sort((a, b) => a.start - b.start));
}

/** Lines left in a run from `index` on: how many in the same episode as the one at `index`. */
export function linesInEpisode(items: FindRunItem[], index: number): number {
  const id = items[index]?.videoId;
  let n = 0;
  for (let i = index; i < items.length && items[i].videoId === id; i++) n++;
  return n;
}

// ---------------------------------------------------------------- the library file

export interface LibraryFile {
  app: 'polyglot-player';
  kind: 'library';
  version: 1;
  exportedAt: string;
  /** Without `words`, which are made again when the file is read. */
  episodes: Omit<LibraryEpisode, 'words'>[];
  watched: LibraryWatched[];
}

export function toLibraryFile(episodes: LibraryEpisode[], watched: LibraryWatched[]): string {
  const file: LibraryFile = {
    app: 'polyglot-player',
    kind: 'library',
    version: 1,
    exportedAt: new Date().toISOString(),
    episodes: episodes.map(({ words, ...rest }) => (void words, rest)),
    watched,
  };
  return JSON.stringify(file);
}

const isLine = (x: unknown): x is LibLine => !!x && typeof (x as LibLine).timeMs === 'number' && typeof (x as LibLine).text === 'string';

function isSentenceLike(x: unknown): x is LibSentence {
  const s = x as LibSentence;
  return (
    !!s &&
    typeof s.start === 'number' &&
    typeof s.end === 'number' &&
    typeof s.text === 'string' &&
    (s.tr === undefined || typeof s.tr === 'string') &&
    isLine(s.from) &&
    (s.to === undefined || isLine(s.to))
  );
}

/** Episodes and watched parts from a library file, checked; the episodes still need their `words`. */
export function parseLibraryFile(json: string): { episodes: Omit<LibraryEpisode, 'words'>[]; watched: LibraryWatched[] } {
  const data = JSON.parse(json) as Partial<LibraryFile>;
  if (data?.app !== 'polyglot-player' || data.kind !== 'library' || !Array.isArray(data.episodes)) {
    throw new Error('Not a Polyglot Player library file.');
  }
  const id = (x: unknown) => typeof x === 'string' && x.length > 0 && x.length < 200 && !x.includes('|');
  const episodes = data.episodes.filter(
    (e) =>
      !!e &&
      id(e.videoId) &&
      id(e.lang) &&
      e.key === libraryKey(e.videoId, e.lang) &&
      Array.isArray(e.sentences) &&
      e.sentences.every(isSentenceLike) &&
      typeof e.savedAt === 'number' &&
      typeof e.updatedAt === 'number',
  );
  const watched = (Array.isArray(data.watched) ? data.watched : []).filter(
    (w) => !!w && typeof w.key === 'string' && Array.isArray(w.ranges) && w.ranges.every((r) => Array.isArray(r) && r.length === 2),
  );
  return { episodes, watched };
}
