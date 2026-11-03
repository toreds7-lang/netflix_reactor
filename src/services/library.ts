import type { AnalysisRecord } from '../core/analyses';
import { baseLang } from '../core/langs';
import {
  addRanges,
  buildIndex,
  findChunks,
  findSentenceId,
  hasHangul,
  isWatched,
  libraryKey,
  looseText,
  parseLibraryFile,
  parseQuery,
  rankMatches,
  textMatches,
  toLibraryFile,
  translationMatches,
  watchedShare,
  wordLine,
  wordsOf,
  type HitFilters,
  type LibraryEpisode,
  type LibraryIndex,
  type LibraryListItem,
  type LibrarySaveRequest,
  type LibrarySearchRequest,
  type LibrarySearchResult,
  type LibraryWatched,
  type Match,
  type RankContext,
  type Ranked,
} from '../core/library';
import { loadSettings } from '../core/settings';
import type { BackupStatus, KeyLines } from '../core/types';
import { cacheValues } from './cache';
import { libClear, libDelete, libGet, libGetAll, libKeys, libPut, libPutMany } from './library-db';
import { nativeRequest } from './native-host';

/**
 * The 🔎 library in the background: episodes saved as you watch them, the parts you watched, and the search over them.
 * The word index is built in memory on the first search and again after a change.
 */

let version = 0;
let built: { version: number; index: Promise<LibraryIndex> } | null = null;
let watchedMap: Promise<Map<string, [number, number][]>> | null = null;
const changeListeners = new Set<(keys: string[], deleted: boolean) => void>();

/** Called with the keys of episodes whose sentences changed: saved or imported, or deleted. */
export function onLibraryChanged(cb: (keys: string[], deleted: boolean) => void): () => void {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

function changed(keys: string[], deleted = false): void {
  version++;
  for (const cb of changeListeners) cb(keys, deleted);
}

export function getIndex(): Promise<LibraryIndex> {
  if (built?.version !== version) {
    const index = libGetAll<LibraryEpisode>('episodes').then(buildIndex);
    built = { version, index };
    index.catch(() => {
      if (built?.index === index) built = null;
    });
  }
  return built.index;
}

export function getWatched(): Promise<Map<string, [number, number][]>> {
  watchedMap ??= libGetAll<LibraryWatched>('watched').then((list) => new Map(list.map((w) => [w.key, w.ranges])));
  watchedMap.catch(() => (watchedMap = null));
  return watchedMap;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Save an episode's sentences. A sentence that has no translation line this time (they were still loading) keeps the
 * one saved before, unless the translation language changed.
 */
export async function saveEpisode(req: LibrarySaveRequest): Promise<void> {
  if (!req.videoId || !req.lang || !req.sentences.length) return;
  const key = libraryKey(req.videoId, req.lang);
  const old = await libGet<LibraryEpisode>('episodes', key);
  const keep = old && (!req.trLang || !old.trLang || old.trLang === req.trLang) ? new Map(old.sentences.map((s) => [`${s.start}|${s.text}`, s.tr])) : null;
  const sentences = req.sentences.map((s) => {
    const tr = s.tr ?? keep?.get(`${s.start}|${s.text}`);
    return tr ? { ...s, tr } : s;
  });
  const now = Date.now();
  const ep: LibraryEpisode = {
    key,
    videoId: req.videoId,
    lang: req.lang,
    show: req.show ?? old?.show,
    episode: req.episode ?? old?.episode,
    trLang: req.trLang ?? old?.trLang,
    trKind: req.trKind ?? old?.trKind,
    sentences,
    words: sentences.map((s) => wordLine(s.text, req.lang)),
    savedAt: old?.savedAt ?? now,
    updatedAt: now,
  };
  if (old && old.show === ep.show && old.episode === ep.episode && old.trKind === ep.trKind && sameJson(old.sentences, ep.sentences)) {
    return;
  }
  await libPut('episodes', ep);
  changed([key]);
}

/** Add the parts of an episode just played. */
export async function recordWatched({ videoId, lang, ranges }: { videoId: string; lang: string; ranges: [number, number][] }): Promise<void> {
  if (!ranges.length) return;
  const key = libraryKey(videoId, lang);
  const old = await libGet<LibraryWatched>('watched', key);
  const next = addRanges(old?.ranges ?? [], ranges);
  await libPut('watched', { key, ranges: next, updatedAt: Date.now() } satisfies LibraryWatched);
  (await getWatched().catch(() => null))?.set(key, next);
}

// ---------------------------------------------------------------- 🎤 key lines

/** Each episode's 🎤 shadowing picks (all three tiers), as loose texts, read again after a minute. */
let keySets: { at: number; map: Promise<Map<string, Set<string>>> } | null = null;
const KEY_SETS_TTL_MS = 60_000;

function keyLineSets(): Promise<Map<string, Set<string>>> {
  if (!keySets || Date.now() - keySets.at > KEY_SETS_TTL_MS) {
    const map = cacheValues<AnalysisRecord<KeyLines>>('analyses')
      .then((records) => {
        const newest = new Map<string, AnalysisRecord<KeyLines>>();
        for (const r of records) {
          if (r.kind !== 'keylines' || !Array.isArray(r.result?.shadow)) continue;
          const k = libraryKey(r.videoId, r.lang);
          const have = newest.get(k);
          if (!have || have.createdAt < r.createdAt) newest.set(k, r);
        }
        const out = new Map<string, Set<string>>();
        for (const [k, r] of newest) out.set(k, new Set(r.result.shadow.flat().map((i) => looseText(r.lines[i] ?? ''))));
        return out;
      })
      .catch(() => new Map<string, Set<string>>());
    keySets = { at: Date.now(), map };
  }
  return keySets.map;
}

// ---------------------------------------------------------------- search

async function rankContext(lang: string, exclude?: Set<number>): Promise<RankContext> {
  const [watched, keys] = await Promise.all([getWatched(), keyLineSets()]);
  return {
    lang,
    watched: (ep, start) => isWatched(watched.get(ep.key), start),
    isKey: (ep, text) => !!keys.get(ep.key)?.has(looseText(text)),
    exclude,
  };
}

/** Rank matches found elsewhere (the meaning model) with the same filters as a search. */
export async function rankFound(matches: Match[], req: HitFilters & { lang: string; limit?: number }, exclude?: Set<number>): Promise<Ranked> {
  const idx = await getIndex();
  return rankMatches(idx, matches, req, await rankContext(baseLang(req.lang), exclude), req.limit ?? 150);
}

/**
 * Lines with a word, a phrase or a pattern (`*`), or whose Korean line is like a Korean query. For a line ("find lines
 * like this"), the chunks of it found in other episodes; the same-meaning lines come from the meaning model.
 */
export async function searchLibrary(req: LibrarySearchRequest): Promise<LibrarySearchResult> {
  const idx = await getIndex();
  const lang = baseLang(req.lang);
  const mine = idx.episodes.filter((e) => baseLang(e.lang) === lang);
  const base: LibrarySearchResult = {
    hits: [],
    total: 0,
    forms: [],
    chunks: [],
    shows: [],
    korean: false,
    episodes: mine.length,
    sentences: mine.reduce((n, e) => n + e.sentences.length, 0),
  };
  if (req.like) {
    const id = findSentenceId(idx, libraryKey(req.like.videoId, req.like.lang), req.like.start);
    const words = id >= 0 ? idx.words[id] : wordsOf(req.like.text, req.like.lang).map((t) => t.word);
    return { ...base, chunks: findChunks(idx, words) };
  }
  const q = req.query.trim();
  if (!q) return base;
  const korean = hasHangul(q) && lang !== 'ko';
  let matches: Match[];
  let forms: string[] = [];
  if (korean) matches = translationMatches(idx, q);
  else ({ matches, forms } = textMatches(idx, parseQuery(q, req.lang), req.lang));
  const ranked = rankMatches(idx, matches, req, await rankContext(lang), req.limit ?? 150);
  return { ...base, ...ranked, forms, korean };
}

// ---------------------------------------------------------------- Options

export async function listLibrary(): Promise<LibraryListItem[]> {
  const [episodes, watched, vectorKeys] = await Promise.all([libGetAll<LibraryEpisode>('episodes'), getWatched(), libKeys('vectors')]);
  const withVectors = new Set(vectorKeys);
  return episodes
    .map((e) => ({
      key: e.key,
      videoId: e.videoId,
      lang: e.lang,
      show: e.show,
      episode: e.episode,
      trLang: e.trLang,
      trKind: e.trKind,
      sentences: e.sentences.length,
      watched: watchedShare(e, watched.get(e.key)),
      meaning: withVectors.has(e.key),
      savedAt: e.savedAt,
      updatedAt: e.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteLibrary({ keys, all }: { keys?: string[]; all?: boolean }): Promise<void> {
  if (all) {
    const gone = await libKeys('episodes');
    await Promise.all([libClear('episodes'), libClear('watched'), libClear('vectors')]);
    watchedMap = null;
    changed(gone, true);
    return;
  }
  if (!keys?.length) return;
  await Promise.all([libDelete('episodes', keys), libDelete('watched', keys), libDelete('vectors', keys)]);
  watchedMap = null;
  changed(keys, true);
}

export async function exportLibrary(): Promise<string> {
  const [episodes, watched] = await Promise.all([libGetAll<LibraryEpisode>('episodes'), libGetAll<LibraryWatched>('watched')]);
  return toLibraryFile(episodes, watched);
}

/** Episodes from a library file: new ones and newer versions are kept, watched parts are added. Returns how many episodes were stored. */
export async function importLibrary(json: string): Promise<number> {
  const file = parseLibraryFile(json);
  const have = new Map((await libGetAll<LibraryEpisode>('episodes')).map((e) => [e.key, e]));
  const take = file.episodes
    .filter((e) => (have.get(e.key)?.updatedAt ?? -1) < e.updatedAt)
    .map((e): LibraryEpisode => ({ ...e, words: e.sentences.map((s) => wordLine(s.text, e.lang)) }));
  await libPutMany('episodes', take);
  for (const w of file.watched) {
    const [videoId, lang] = w.key.split('|');
    if (videoId && lang) await recordWatched({ videoId, lang, ranges: w.ranges });
  }
  if (take.length) changed(take.map((e) => e.key));
  return take.length;
}

// ---------------------------------------------------------------- backup file

const STATUS_KEY = 'libraryBackupStatus';

export async function getLibraryBackupStatus(): Promise<BackupStatus | null> {
  return ((await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY] as BackupStatus | undefined) ?? null;
}

/** The library as polyglot-library.json, next to the other backup files (the native helper writes it). */
export async function runLibraryBackup(): Promise<BackupStatus> {
  let status: BackupStatus;
  try {
    const s = await loadSettings();
    const json = await exportLibrary();
    const reply = await nativeRequest<{ path: string }>({ type: 'backupLibrary', json, dir: s.backupDir.trim() || undefined });
    status = { ok: true, at: Date.now(), path: reply.path };
  } catch (e) {
    status = { ok: false, at: Date.now(), error: e instanceof Error ? e.message : String(e) };
  }
  await chrome.storage.local.set({ [STATUS_KEY]: status });
  return status;
}

const BACKUP_ALARM = 'library-backup';
const DAILY_ALARM = 'library-backup-daily';
/** Saves come in bursts while an episode's translations load: back up once, this long after the last one. */
const BACKUP_DELAY_MIN = 3;
const DAILY_PERIOD_MIN = 24 * 60;

/** Call once when the service worker starts: back up the library after changes and once a day. */
export function watchLibrary(): void {
  // Created only once: creating it again on every service worker start would keep delaying it.
  void (async () => {
    if (!(await chrome.alarms.get(DAILY_ALARM))) {
      await chrome.alarms.create(DAILY_ALARM, { periodInMinutes: DAILY_PERIOD_MIN, delayInMinutes: DAILY_PERIOD_MIN });
    }
  })();
  onLibraryChanged(() => void chrome.alarms.create(BACKUP_ALARM, { delayInMinutes: BACKUP_DELAY_MIN }));
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== BACKUP_ALARM && alarm.name !== DAILY_ALARM) return;
    void (async () => {
      const s = await loadSettings();
      if (s.autoBackup && (await libKeys('episodes')).length) await runLibraryBackup();
    })().catch(() => undefined);
  });
}
