import { baseLang, toGoogleLang } from '../core/langs';
import {
  findSentenceId,
  hasHangul,
  libraryKey,
  looseText,
  parseQuery,
  sentenceOf,
  type LibraryEpisode,
  type LibraryMeaningRequest,
  type LibraryMeaningResult,
  type Match,
  type MeaningStatus,
} from '../core/library';
import {
  EMBED_BATCH,
  EMBED_DIMS,
  EMBED_MODEL,
  EMBED_PORT,
  fromBase64,
  mostSimilar,
  textsHash,
  vectorNorms,
  type EmbedEvent,
  type VectorSet,
} from '../core/meaning';
import { loadSettings } from '../core/settings';
import { translateLines } from './google-translate';
import { getIndex, rankFound } from './library';
import { libDelete, libGetAll, libPut, type EpisodeVectors } from './library-db';
import { openReader } from './offscreen';

/**
 * Same-meaning search in the background: each saved episode's sentences go once through the sentence model in the
 * offscreen page, and their vectors are kept with the library. A search turns the query (or the line) into a vector too
 * and takes the lines most like it.
 */

/** The model was trained on English sentences. */
const MEANING_LANGS = new Set(['en']);
/** Same-meaning lines shown at most. */
const MEANING_MAX = 40;
/** A search waits this long for episodes not read yet (just saved, say), then searches the ones that are. */
const WAIT_FOR_READING_MS = 20_000;
const DISCONNECTED = 'The meaning model stopped.';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------- the model, through the offscreen page

let port: chrome.runtime.Port | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (v: Int8Array) => void; reject: (e: Error) => void }>();
/** Share of the model downloaded while it loads. */
let progress: number | null = null;

async function connect(): Promise<chrome.runtime.Port> {
  if (port) return port;
  await openReader();
  const p = chrome.runtime.connect({ name: EMBED_PORT });
  p.onMessage.addListener((e: EmbedEvent) => {
    if (e.type === 'loading') {
      progress = e.progress;
      return;
    }
    const w = waiting.get(e.id);
    if (!w) return;
    waiting.delete(e.id);
    progress = null;
    if (e.type === 'vectors') w.resolve(new Int8Array(fromBase64(e.data).buffer));
    else w.reject(new Error(e.message));
  });
  p.onDisconnect.addListener(() => {
    void chrome.runtime.lastError; // read, so Chrome doesn't log it as unchecked
    if (port === p) port = null;
    for (const w of waiting.values()) w.reject(new Error(DISCONNECTED));
    waiting.clear();
  });
  port = p;
  return p;
}

async function embedBatch(texts: string[], retry = true): Promise<Int8Array> {
  const p = await connect();
  try {
    return await new Promise<Int8Array>((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      try {
        p.postMessage({ type: 'embed', id, texts });
      } catch (e) {
        waiting.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  } catch (e) {
    // The page had closed itself after idling, or wasn't listening yet: open it again, once.
    if (!retry || !(e instanceof Error) || !(e.message === DISCONNECTED || /disconnect/i.test(e.message))) throw e;
    if (port === p) port = null;
    await new Promise((r) => setTimeout(r, 300));
    return embedBatch(texts, false);
  }
}

/** Vectors of these texts, EMBED_DIMS 8-bit numbers each, end to end. */
export async function embedTexts(texts: string[]): Promise<Int8Array> {
  const out = new Int8Array(texts.length * EMBED_DIMS);
  for (let i = 0; i < texts.length; i += EMBED_BATCH) out.set(await embedBatch(texts.slice(i, i + EMBED_BATCH)), i * EMBED_DIMS);
  return out;
}

// ---------------------------------------------------------------- vectors per episode

type Loaded = VectorSet<string> & { hash: string; model: string };
let loaded: Promise<Map<string, Loaded>> | null = null;

function vectorSets(): Promise<Map<string, Loaded>> {
  loaded ??= libGetAll<EpisodeVectors>('vectors').then(
    (list) => new Map(list.map((v) => [v.key, { key: v.key, data: v.data, norms: vectorNorms(v.data, v.dims), hash: v.hash, model: v.model }])),
  );
  loaded.catch(() => (loaded = null));
  return loaded;
}

/** Episodes deleted from the library: their vectors (already gone from the database) go from memory too. */
export function forgetVectors(keys: string[]): void {
  void loaded?.then((sets) => keys.forEach((k) => sets.delete(k))).catch(() => undefined);
}

const usable = (ep: LibraryEpisode) => MEANING_LANGS.has(baseLang(ep.lang));
const hashOf = (ep: LibraryEpisode) => textsHash(ep.sentences.map((s) => s.text));
/** Vectors made from these very sentences: otherwise their order no longer matches the sentences. */
const current = (ep: LibraryEpisode, v: Loaded | undefined): v is Loaded => !!v && v.model === EMBED_MODEL && v.hash === hashOf(ep);

let status: MeaningStatus = { state: 'idle', indexed: 0, total: 0 };
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Read new and changed episodes a little later (saves come in bursts while an episode's translations load). */
export function scheduleIndexing(delayMs = 20_000): void {
  clearTimeout(timer);
  timer = setTimeout(() => void indexLibrary().catch(() => undefined), delayMs);
}

/** Make the vectors of every episode that lacks current ones. One run at a time; a call during a run runs it again. */
export function indexLibrary(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await indexOnce();
    } while (again);
  })().finally(() => (running = null));
  return running;
}

async function indexOnce(): Promise<void> {
  if (!(await loadSettings()).findMeaning) {
    status = { state: 'off', indexed: 0, total: 0 };
    return;
  }
  const idx = await getIndex();
  const sets = await vectorSets();
  const keep = new Set(idx.episodes.map((e) => e.key));
  const gone = [...sets.keys()].filter((k) => !keep.has(k));
  if (gone.length) {
    await libDelete('vectors', gone);
    for (const k of gone) sets.delete(k);
  }
  const eps = idx.episodes.filter(usable);
  const todo = eps.filter((e) => !current(e, sets.get(e.key)));
  status = { state: todo.length ? 'working' : 'idle', indexed: eps.length - todo.length, total: eps.length };
  for (const ep of todo) {
    try {
      const texts = ep.sentences.map((s) => s.text);
      const data = await embedTexts(texts);
      const rec: EpisodeVectors = { key: ep.key, model: EMBED_MODEL, dims: EMBED_DIMS, hash: textsHash(texts), data };
      await libPut('vectors', rec);
      sets.set(ep.key, { key: ep.key, data, norms: vectorNorms(data, EMBED_DIMS), hash: rec.hash, model: rec.model });
      status = { ...status, indexed: status.indexed + 1 };
    } catch (e) {
      status = { ...status, state: 'error', error: errMsg(e) };
      return;
    }
  }
  status = { state: 'idle', indexed: status.indexed, total: status.total };
}

export async function meaningStatus(): Promise<MeaningStatus> {
  if (!(await loadSettings()).findMeaning) return { state: 'off', indexed: 0, total: 0 };
  if (status.state === 'working') return { ...status, progress };
  const [idx, sets] = await Promise.all([getIndex(), vectorSets()]);
  const eps = idx.episodes.filter(usable);
  return { ...status, indexed: eps.filter((e) => current(e, sets.get(e.key))).length, total: eps.length, progress };
}

// ---------------------------------------------------------------- search

/**
 * Lines that mean nearly the same as the query or the line, in English episodes. A Korean query is translated into
 * English first. Patterns (`*`) have no meaning to compare, so they find nothing here.
 */
export async function meaningSearch(req: LibraryMeaningRequest): Promise<LibraryMeaningResult> {
  if (!(await loadSettings()).findMeaning) return { hits: [], status: { state: 'off', indexed: 0, total: 0 } };
  if (!MEANING_LANGS.has(baseLang(req.lang))) {
    return { hits: [], status: { state: 'off', indexed: 0, total: 0, error: 'Same-meaning search works in English episodes only.' } };
  }
  // Episodes saved since the last run are read first, so they can be found too (a long backlog only for a while).
  const [idx, sets] = await Promise.all([getIndex(), vectorSets()]);
  if (idx.episodes.some((e) => usable(e) && !current(e, sets.get(e.key)))) {
    await Promise.race([indexLibrary().catch(() => undefined), new Promise((r) => setTimeout(r, WAIT_FOR_READING_MS))]);
  }
  const exclude = new Set<number>();
  let query: Int8Array;
  let translated: string | undefined;
  if (req.like) {
    const key = libraryKey(req.like.videoId, req.like.lang);
    const id = findSentenceId(idx, key, req.like.start);
    const ep = idx.episodes.find((e) => e.key === key);
    const v = sets.get(key);
    // The line itself and the same words elsewhere (a recap, say) are not "other words".
    const same = looseText(req.like.text);
    idx.words.forEach((_, i) => looseText(sentenceOf(idx, i).s.text) === same && exclude.add(i));
    query =
      id >= 0 && ep && current(ep, v)
        ? v.data.slice(idx.atOf[id] * EMBED_DIMS, (idx.atOf[id] + 1) * EMBED_DIMS)
        : await embedTexts([req.like.text]);
  } else {
    let text = req.query.trim();
    if (!text || parseQuery(text, req.lang).includes(null)) return { hits: [], status: await meaningStatus() };
    if (hasHangul(text)) {
      const [t] = await translateLines([text], 'ko', toGoogleLang(req.lang));
      if (!t) return { hits: [], status: await meaningStatus() };
      translated = text = t;
    }
    query = await embedTexts([text]);
  }
  const pos = new Map(idx.episodes.map((e, i) => [e.key, i]));
  const ready = idx.episodes.filter((e) => usable(e) && current(e, sets.get(e.key))).map((e) => sets.get(e.key)!);
  const matches: Match[] = mostSimilar(query, ready, EMBED_DIMS, MEANING_MAX * 4).map((t) => ({
    id: idx.firstOf[pos.get(t.key)!] + t.index,
    tier: 'meaning',
    marks: [],
    score: t.score,
  }));
  const ranked = await rankFound(matches, { ...req, limit: req.limit ?? MEANING_MAX }, exclude);
  return { hits: ranked.hits, status: await meaningStatus(), translated };
}
