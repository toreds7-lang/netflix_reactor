import type { CefrLevel } from './keylines';

/** A piece of subtitle text with optional furigana/ruby annotation. */
export interface RubySegment {
  base: string;
  ruby?: string;
}

export interface Cue {
  /** Start time in milliseconds. */
  start: number;
  /** End time in milliseconds. */
  end: number;
  /** Plain text; visual line breaks are kept as '\n'. */
  text: string;
  /** Present only when the source had ruby markup (mostly Japanese). */
  ruby?: RubySegment[];
}

export type TrackKind = 'subtitles' | 'closedcaptions' | 'forced';

export interface TrackSource {
  profile: string;
  url: string;
}

export interface TrackInfo {
  id: string;
  /** BCP-47 code exactly as Netflix reports it, e.g. 'en', 'pt-BR', 'zh-Hant'. */
  lang: string;
  label: string;
  kind: TrackKind;
  /** Download candidates, best profile first. */
  sources: TrackSource[];
}

export interface VideoMeta {
  title: string;
  episodeTitle?: string;
}

export type WordLevel = 'learning' | 'known';

export interface SavedWord {
  /** `${baseLang}:${normalizedWord}` */
  key: string;
  lang: string;
  word: string;
  lemma?: string;
  reading?: string;
  level: WordLevel;
  translation?: string;
  sentence?: string;
  sentenceTranslation?: string;
  videoId?: string;
  title?: string;
  timeMs?: number;
  ankiNoteId?: number;
  createdAt: number;
  updatedAt: number;
}

/** A subtitle line to continue from. */
export interface LineMark {
  /** Start of the line in Netflix content time (ms). */
  timeMs: number;
  /** The line's text. Cue indices change with the track and the [SDH] toggle, so the line is found again by text and time. */
  text: string;
  lang: string;
}

/** Lines saved to loop again later; the first and last line are found again like a bookmark. */
export interface SavedLoop {
  from: LineMark;
  to: LineMark;
  createdAt: number;
}

/** When a saved sentence comes back for practice (spaced repetition, src/core/sentences.ts). */
export interface SrsState {
  /** When it is next due (ms since the epoch). */
  due: number;
  /** Days from the last review to `due`; 0 before the first successful review and after "Again". */
  interval: number;
  /** How fast the interval grows after "Good". */
  ease: number;
  /** Successful reviews in a row. */
  reps: number;
  /** Times it was forgotten ("Again") after a successful review. */
  lapses: number;
  /** Last review (ms since the epoch). */
  last?: number;
}

/** A sentence saved to practise by shadowing, from one or more consecutive subtitle lines. */
export interface SavedSentence {
  /** `${videoId}:${lang}:${from.timeMs}` */
  id: string;
  lang: string;
  text: string;
  translation?: string;
  note?: string;
  videoId: string;
  /** "Show · Episode" */
  title?: string;
  /** First and last subtitle line, found again by text and time like a saved loop. */
  from: LineMark;
  to: LineMark;
  /** Start of the first line and end of the last line (ms, Netflix content time). */
  startMs: number;
  endMs: number;
  /** The lines just before and after, for context. */
  before?: string;
  after?: string;
  srs: SrsState;
  /** Practice drills finished and rated. */
  practiced: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Sentences being practised on Netflix one after another. Kept in storage, so it carries on after the page opens
 * another episode.
 */
export interface PracticeSession {
  ids: string[];
  /** The sentence being practised. */
  index: number;
  /** Rated so far. */
  done: number;
  /** Last activity; an old session is dropped. */
  at: number;
}

/** The last automatic or manual backup to a file through the native helper. */
export interface BackupStatus {
  ok: boolean;
  at: number;
  /** The file written (the latest copy). */
  path?: string;
  error?: string;
}

/** Where to continue one episode, and its saved loops. */
export interface VideoBookmarks {
  videoId: string;
  /** "Show · Episode" */
  title?: string;
  /** Set by the user (B or 🔖); one per episode. */
  bookmark?: LineMark;
  /** The last line played, saved automatically as a fallback. Cleared when the episode is finished. */
  last?: LineMark;
  /** In video order. */
  loops?: SavedLoop[];
  updatedAt: number;
}

/** Google dictionary result for a word or phrase. */
export interface DictEntry {
  translation: string;
  romanization?: string;
  sourceLang?: string;
  /** Alternative translations grouped by part of speech (dt=bd). */
  groups: { pos: string; terms: string[] }[];
  /** Monolingual definitions in the source language (dt=md). */
  definitions: { pos: string; defs: string[] }[];
}

export interface ExplainRequest {
  text: string;
  sentence: string;
  prevLine?: string;
  nextLine?: string;
  from: string;
  to: string;
  title?: string;
}

export interface ExplainResult {
  lemma: string;
  reading: string;
  partOfSpeech: string;
  meaningInContext: string;
  grammarNote: string;
  examples: { sentence: string; translation: string }[];
  model: string;
}

export interface LineExplainRequest {
  sentence: string;
  prevLine?: string;
  nextLine?: string;
  from: string;
  to: string;
}

export interface LineExplainResult {
  translation: string;
  breakdown: { chunk: string; meaning: string }[];
  grammarNotes: string[];
  model: string;
}

export interface KeyLinesRequest {
  /** Netflix video ID; results are kept per episode. */
  videoId: string;
  /** "Show · Episode", for the list of saved results in Options. */
  title?: string;
  /** The episode's sentences in order; results refer to their indices. */
  lines: string[];
  lang: string;
  /** Only return a cached result (free); never call the API. Falls back to one made with other settings. */
  cacheOnly?: boolean;
  /** Make a new result even when one for the current settings is cached, and replace it. */
  refresh?: boolean;
}

/** What the Claude Code helper reports about the local install. */
export interface ClaudeCodeStatus {
  version: string;
  loggedIn: boolean;
  /** "claude.ai" for a subscription login. */
  authMethod: string;
  /** e.g. "pro" or "max". */
  subscription: string;
}

/** The model that answered (as the provider names it) and the tokens it used. */
export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Where a key-lines or summary result came from. */
export interface ResultSource {
  /** Read from the cache rather than made now. */
  cached: boolean;
  /** The learner level it was made for. */
  level: CefrLevel;
  createdAt: number;
  /** Made with the current model, level and prompt. False for an earlier result, shown until a new one is made. */
  current: boolean;
  /** Made from slightly different subtitle text and matched to these sentences by text. */
  adapted: boolean;
}

/** Key lines as cached. */
export interface KeyLines extends ModelUsage {
  /** Three tiers of sentence indices, each ~10% of the sentences, most important first. */
  shadow: number[][];
  story: number[][];
}

export interface KeyLinesResult extends KeyLines, ResultSource {}

/** Same input as key lines: the episode's sentences, so scenes and evidence refer to the same indices. */
export type SummaryRequest = KeyLinesRequest;

/** One stretch of the episode, as consecutive sentence indices [start, end]. */
export interface SummaryScene {
  title: string;
  summary: string;
  /** First sentence of the scene. */
  start: number;
  /** Last sentence of the scene (the one before the next scene starts). */
  end: number;
  /** Sentences inside the scene that the summary is based on, so the reader can check it. */
  evidence: number[];
}

/** Written in the language being learned, at the learner's CEFR level. */
export interface EpisodeSummary {
  overview: string;
  characters: { name: string; role: string }[];
  scenes: SummaryScene[];
}

/** A summary as cached. */
export interface Summary extends EpisodeSummary, ModelUsage {}

export interface SummaryResult extends Summary, ResultSource {}
