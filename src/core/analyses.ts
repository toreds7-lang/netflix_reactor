import type { CefrLevel } from './keylines';

/** The per-episode results made by the key-lines provider (Claude Code or OpenAI). */
export type AnalysisKind = 'keylines' | 'summary';

export const ANALYSIS_KINDS: AnalysisKind[] = ['keylines', 'summary'];

/** One cached key-lines or summary result. There is one per episode, kind, language, model and level. */
export interface AnalysisRecord<T = unknown> {
  kind: AnalysisKind;
  /** Netflix video ID of the episode. */
  videoId: string;
  /** Language of the subtitles (and of a summary). */
  lang: string;
  /** "Show · Episode", for the list in Options. */
  title?: string;
  /** The model setting (Claude Code model ID or the OpenAI model). The reply's exact model is `result.model`. */
  model: string;
  level: CefrLevel;
  /** PROMPT_VERSION or SUMMARY_VERSION when it was made. */
  version: number;
  /** The sentences that were sent; the result's sentence indices refer to these. */
  lines: string[];
  createdAt: number;
  result: T;
}

/** IndexedDB key; starts with the video ID so one episode's results can be read by prefix. */
export function analysisKey(r: Pick<AnalysisRecord, 'videoId' | 'kind' | 'lang' | 'model' | 'level'>): string {
  return `${r.videoId}|${r.kind}|${r.lang}|${r.model}|${r.level}`;
}

export function episodePrefix(videoId: string): string {
  return `${videoId}|`;
}

/** The kind part of a key from `analysisKey`. */
export function kindOfKey(key: string): AnalysisKind | undefined {
  const kind = key.split('|')[1];
  return ANALYSIS_KINDS.find((k) => k === kind);
}

/** One saved result as listed in Options. */
export interface SavedAnalysis {
  key: string;
  kind: AnalysisKind;
  videoId: string;
  lang: string;
  title?: string;
  /** The model that answered. */
  model: string;
  level: CefrLevel;
  createdAt: number;
  sentences: number;
  bytes: number;
}

export interface SavedAnalyses {
  items: SavedAnalysis[];
  /** Results cached before they were kept per episode; they are linked when their episode is opened. */
  unlinked: number;
}

/** Share of the stored sentences that must be found again before a result is shown for changed subtitles. */
export const MIN_MATCH = 0.5;

/** How far past the previous match a repeated line (like "Yes.") may be matched. */
const MATCH_WINDOW = 40;

/** Text compared loosely, so changes in case, spacing and punctuation still match. */
const loose = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * For each sentence in `from`, the index of the same sentence in `to`, or -1. Matches keep their order.
 * A match may be at most MATCH_WINDOW sentences after the previous one unless its text occurs once in each list,
 * so a common line can't pull the alignment far ahead, while unique lines bring it back after a larger change.
 */
export function alignLines(from: string[], to: string[]): number[] {
  const positions = new Map<string, number[]>();
  to.forEach((t, j) => {
    const k = loose(t);
    if (!k) return;
    const list = positions.get(k);
    if (list) list.push(j);
    else positions.set(k, [j]);
  });
  const fromCount = new Map<string, number>();
  for (const f of from) fromCount.set(loose(f), (fromCount.get(loose(f)) ?? 0) + 1);

  let last = -1;
  return from.map((f) => {
    const k = loose(f);
    const list = positions.get(k);
    const j = list?.find((p) => p > last);
    if (j === undefined) return -1;
    const unique = list!.length === 1 && fromCount.get(k) === 1;
    if (j - last > MATCH_WINDOW && !unique) return -1;
    last = j;
    return j;
  });
}

/** Share of the entries in `map` that found a sentence. */
export function matchShare(map: number[]): number {
  return map.length ? map.filter((j) => j >= 0).length / map.length : 0;
}

/** A record from a backup file, checked before it is stored; null when it isn't one. */
export function parseRecord(v: unknown): AnalysisRecord | null {
  const r = v as Partial<AnalysisRecord> | null;
  if (!r || typeof r !== 'object') return null;
  // Parts of the IndexedDB key, which uses '|' as the separator.
  const id = (x: unknown) => typeof x === 'string' && x.length > 0 && x.length < 200 && !x.includes('|');
  const ok =
    ANALYSIS_KINDS.includes(r.kind as AnalysisKind) &&
    id(r.videoId) &&
    id(r.lang) &&
    id(r.model) &&
    id(r.level) &&
    typeof r.version === 'number' &&
    typeof r.createdAt === 'number' &&
    Array.isArray(r.lines) &&
    r.lines.every((l) => typeof l === 'string') &&
    !!r.result &&
    typeof r.result === 'object' &&
    (r.title === undefined || typeof r.title === 'string');
  if (!ok) return null;
  const res = r.result as Record<string, unknown>;
  const shapeOk = r.kind === 'keylines' ? Array.isArray(res.shadow) && Array.isArray(res.story) : Array.isArray(res.scenes);
  return shapeOk ? (r as AnalysisRecord) : null;
}
