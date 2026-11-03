import {
  alignLines,
  analysisKey,
  episodePrefix,
  kindOfKey,
  matchShare,
  MIN_MATCH,
  parseRecord,
  type AnalysisKind,
  type AnalysisRecord,
  type SavedAnalyses,
  type SavedAnalysis,
} from '../core/analyses';
import type { CefrLevel } from '../core/keylines';
import type { KeyLinesRequest, ModelUsage, ResultSource } from '../core/types';
import { cacheClear, cacheCount, cacheDelete, cacheGet, cacheKeys, cachePut, cacheSet, cacheValues, hashKey } from './cache';

/** The settings a result is made with. */
export interface AnalysisConfig {
  model: string;
  level: CefrLevel;
  version: number;
}

interface Analysis<T extends ModelUsage> {
  kind: AnalysisKind;
  req: KeyLinesRequest;
  config: AnalysisConfig;
  /** Move a result to changed subtitles with `n` sentences: `map[i]` is sentence i's new index, or -1. */
  adapt: (result: T, map: number[], n: number) => T;
  /** Ask the provider. */
  run: () => Promise<T>;
}

const inflight = new Map<string, Promise<unknown>>();

/**
 * Key lines or a summary for an episode, cached permanently per episode, language, model and level.
 * - A result for the current settings is returned from the cache.
 * - Without one, a cache-only lookup (opening the episode) returns the newest result made with other settings,
 *   marked `current: false`, so it shows until a new one is made.
 * - A result made from slightly different subtitle text is matched to the request's sentences by text.
 * - Otherwise, or with `refresh`, the provider runs once and its result replaces the cached one for these settings.
 */
export async function cachedAnalysis<T extends ModelUsage>(a: Analysis<T>): Promise<(T & ResultSource) | null> {
  const { req, config } = a;
  const key = analysisKey({ ...req, kind: a.kind, model: config.model, level: config.level });
  if (req.cacheOnly) return req.refresh ? null : findCached(a, key);
  // Two tabs or a double click share one request, from the cache lookup on.
  let pending = inflight.get(key) as Promise<T & ResultSource> | undefined;
  if (!pending) {
    pending = (async () => (!req.refresh && (await findCached(a, key))) || generate(a, key))().finally(() =>
      inflight.delete(key),
    );
    inflight.set(key, pending);
  }
  return pending;
}

async function findCached<T extends ModelUsage>(a: Analysis<T>, key: string): Promise<(T & ResultSource) | null> {
  const { req, config } = a;
  let records: AnalysisRecord<T>[] = [];
  try {
    records = (await cacheValues<AnalysisRecord<T>>('analyses', episodePrefix(req.videoId))).filter(
      (r) => r.kind === a.kind && r.lang === req.lang,
    );
  } catch {
    /* the cache is best-effort here */
  }
  if (!records.some((r) => analysisKey(r) === key)) {
    const old = await adoptLegacy(a, key);
    if (old) records.push(old);
  }
  const isCurrent = (r: AnalysisRecord) => r.model === config.model && r.level === config.level && r.version === config.version;
  const usable = records
    .filter((r) => req.cacheOnly || isCurrent(r))
    .sort((x, y) => Number(isCurrent(y)) - Number(isCurrent(x)) || y.createdAt - x.createdAt);
  for (const r of usable) {
    const shown = present(r, req.lines, a.adapt, isCurrent(r));
    if (shown) return shown;
  }
  return null;
}

/** A cached result for these sentences, or null when too few of its sentences are still there. */
function present<T extends ModelUsage>(
  r: AnalysisRecord<T>,
  lines: string[],
  adapt: Analysis<T>['adapt'],
  current: boolean,
): (T & ResultSource) | null {
  const same = r.lines.length === lines.length && r.lines.every((l, i) => l === lines[i]);
  let result = r.result;
  if (!same) {
    const map = alignLines(r.lines, lines);
    if (matchShare(map) < MIN_MATCH) return null;
    result = adapt(r.result, map, lines.length);
  }
  return { ...result, cached: true, level: r.level, createdAt: r.createdAt, current, adapted: !same };
}

/**
 * Results cached before they were kept per episode are keyed by a hash of the settings and the sentences.
 * Move this episode's one over when it is opened with the same settings.
 */
async function adoptLegacy<T extends ModelUsage>(a: Analysis<T>, key: string): Promise<AnalysisRecord<T> | null> {
  const { req, config } = a;
  const oldKey = await hashKey([a.kind, String(config.version), config.model, config.level, req.lang, ...req.lines]);
  const result = await cacheGet<T>(a.kind, oldKey);
  if (!result) return null;
  const record = newRecord(a, result);
  try {
    await cachePut('analyses', key, record);
    await cacheDelete(a.kind, [oldKey]);
  } catch {
    /* shown now anyway; moved on a later visit */
  }
  return record;
}

function newRecord<T>(a: Pick<Analysis<ModelUsage>, 'kind' | 'req' | 'config'>, result: T): AnalysisRecord<T> {
  const { req, config } = a;
  return {
    kind: a.kind,
    videoId: req.videoId,
    lang: req.lang,
    title: req.title,
    model: config.model,
    level: config.level,
    version: config.version,
    lines: req.lines,
    createdAt: Date.now(),
    result,
  };
}

async function generate<T extends ModelUsage>(a: Analysis<T>, key: string): Promise<T & ResultSource> {
  const result = await a.run();
  const record = newRecord(a, result);
  await cacheSet('analyses', key, record);
  return { ...result, cached: false, level: record.level, createdAt: record.createdAt, current: true, adapted: false };
}

// ---------------------------------------------------------------- saved results (Options, popup, backup)

export async function listAnalyses(): Promise<SavedAnalyses> {
  const records = await cacheValues<AnalysisRecord<ModelUsage>>('analyses');
  const encoder = new TextEncoder();
  const items = records.map(
    (r): SavedAnalysis => ({
      key: analysisKey(r),
      kind: r.kind,
      videoId: r.videoId,
      lang: r.lang,
      title: r.title,
      model: r.result?.model || r.model,
      level: r.level,
      createdAt: r.createdAt,
      sentences: r.lines.length,
      bytes: encoder.encode(JSON.stringify(r)).length,
    }),
  );
  const unlinked = (await cacheCount('keylines')) + (await cacheCount('summary'));
  return { items, unlinked };
}

/** Delete saved results by key, or all of them (including unlinked ones). */
export async function deleteAnalyses({ keys, all }: { keys?: string[]; all?: boolean }): Promise<void> {
  if (all) {
    await Promise.all([cacheClear('analyses'), cacheClear('keylines'), cacheClear('summary')]);
    return;
  }
  if (keys?.length) await cacheDelete('analyses', keys);
}

/** Every saved result, for the backup file. */
export function exportAnalyses(): Promise<AnalysisRecord[]> {
  return cacheValues<AnalysisRecord>('analyses');
}

/** Store results from a backup file; a newer saved result for the same settings is kept. Returns how many were stored. */
export async function importAnalyses(raw: unknown[]): Promise<number> {
  let stored = 0;
  for (const r of raw.map(parseRecord)) {
    if (!r) continue;
    const key = analysisKey(r);
    const have = await cacheGet<AnalysisRecord>('analyses', key);
    if (have && have.createdAt >= r.createdAt) continue;
    await cachePut('analyses', key, r);
    stored++;
  }
  return stored;
}

/** Which kinds of results are saved for each of these episodes (episodes without any are left out). */
export async function savedKinds(videoIds: string[]): Promise<Record<string, AnalysisKind[]>> {
  const out: Record<string, AnalysisKind[]> = {};
  const keys = await Promise.all(videoIds.map((id) => cacheKeys('analyses', episodePrefix(id))));
  videoIds.forEach((id, i) => {
    const kinds = [...new Set(keys[i].map(kindOfKey))].filter((k): k is AnalysisKind => !!k);
    if (kinds.length) out[id] = kinds;
  });
  return out;
}
