import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibrarySaveRequest, LibrarySearchRequest } from '../src/core/library';

// An in-memory stand-in for the library's IndexedDB stores.
const stores = new Map<string, Map<string, { key: string }>>();
const store = (name: string) => {
  if (!stores.has(name)) stores.set(name, new Map());
  return stores.get(name)!;
};
const puts: string[] = [];
let analyses: unknown[] = [];
const local = new Map<string, unknown>();

vi.mock('../src/services/library-db', () => ({
  libGet: async (s: string, k: string) => store(s).get(k),
  libGetAll: async (s: string) => [...store(s).values()],
  libKeys: async (s: string) => [...store(s).keys()],
  libPut: async (s: string, v: { key: string }) => void (puts.push(`${s}:${v.key}`), store(s).set(v.key, v)),
  libPutMany: async (s: string, vs: { key: string }[]) => vs.forEach((v) => store(s).set(v.key, v)),
  libDelete: async (s: string, keys: string[]) => keys.forEach((k) => store(s).delete(k)),
  libClear: async (s: string) => store(s).clear(),
}));
vi.mock('../src/services/cache', () => ({ cacheValues: async () => analyses }));
vi.mock('../src/services/native-host', () => ({ nativeRequest: vi.fn(async () => ({ ok: true, path: 'C:\\Backups\\polyglot-library.json' })) }));
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (k: string) => (local.has(k) ? { [k]: local.get(k) } : {}),
      set: async (o: Record<string, unknown>) => Object.entries(o).forEach(([k, v]) => local.set(k, v)),
      remove: async () => undefined,
    },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
});

const lib = await import('../src/services/library');
const { nativeRequest } = await import('../src/services/native-host');

/** An episode as the page sends it: sentences at 10 s, 20 s… */
function save(videoId: string, texts: string[], tr?: (string | undefined)[], patch: Partial<LibrarySaveRequest> = {}): LibrarySaveRequest {
  return {
    videoId,
    lang: 'en',
    show: `Show ${videoId}`,
    episode: 'S1:E1',
    trLang: tr ? 'ko' : undefined,
    trKind: tr ? 'human' : undefined,
    sentences: texts.map((text, i) => ({
      start: (i + 1) * 10_000,
      end: (i + 1) * 10_000 + 2000,
      text,
      from: { timeMs: (i + 1) * 10_000, text },
      ...(tr?.[i] ? { tr: tr[i] } : {}),
    })),
    ...patch,
  };
}

const search = (query: string, patch: Partial<LibrarySearchRequest> = {}) =>
  lib.searchLibrary({ query, lang: 'en', here: null, scope: 'all', length: 'any', watchedOnly: false, keyOnly: false, ...patch });

beforeEach(async () => {
  await lib.deleteLibrary({ all: true });
  stores.clear();
  puts.length = 0;
  analyses = [];
  local.clear();
  vi.clearAllMocks();
});

describe('saving episodes', () => {
  it('saves the sentences with their words, and says which episode changed', async () => {
    const changed: string[][] = [];
    const off = lib.onLibraryChanged((keys) => changed.push(keys));
    await lib.saveEpisode(save('v1', ["I'm gonna go."]));
    off();
    const ep = store('episodes').get('v1|en') as unknown as { words: string[]; show: string };
    expect(ep.words).toEqual(["i'm gonna go"]);
    expect(ep.show).toBe('Show v1');
    expect(changed).toEqual([['v1|en']]);
  });

  it('keeps a translation line saved before when this save has none yet, and skips a save that changes nothing', async () => {
    await lib.saveEpisode(save('v1', ['Hi.', 'Bye.'], ['안녕.', '잘 가.']));
    await lib.saveEpisode(save('v1', ['Hi.', 'Bye.'], [undefined, undefined]));
    const ep = store('episodes').get('v1|en') as unknown as { sentences: { tr?: string }[] };
    expect(ep.sentences.map((s) => s.tr)).toEqual(['안녕.', '잘 가.']);
    expect(puts).toEqual(['episodes:v1|en']);
    // Another translation language: the old lines don't apply.
    await lib.saveEpisode(save('v1', ['Hi.', 'Bye.'], ['Salut.', undefined], { trLang: 'fr' }));
    const fr = store('episodes').get('v1|en') as unknown as { sentences: { tr?: string }[] };
    expect(fr.sentences.map((s) => s.tr)).toEqual(['Salut.', undefined]);
  });

  it('adds the parts played, and finds only those with Watched only', async () => {
    await lib.saveEpisode(save('v1', ['Look at that.', 'Look out!']));
    await lib.recordWatched({ videoId: 'v1', lang: 'en', ranges: [[10_000, 12_000]] });
    await lib.recordWatched({ videoId: 'v1', lang: 'en', ranges: [[12_500, 13_000]] });
    expect((store('watched').get('v1|en') as unknown as { ranges: number[][] }).ranges).toEqual([[10_000, 13_000]]);
    expect((await search('look')).hits.map((h) => h.text)).toEqual(['Look at that.', 'Look out!']);
    expect((await search('look', { watchedOnly: true })).hits.map((h) => h.text)).toEqual(['Look at that.']);
  });
});

describe('searching', () => {
  it('finds words across episodes, with the counts of the language searched', async () => {
    await lib.saveEpisode(save('v1', ['You gotta be kidding.', 'No way.']));
    await lib.saveEpisode(save('v2', ['I got to go.']));
    await lib.saveEpisode({ ...save('v3', ['Tienes que ir.']), lang: 'es' });
    const r = await search('gotta');
    expect(r).toMatchObject({ episodes: 2, sentences: 3, korean: false, total: 2 });
    expect(r.hits.map((h) => [h.text, h.tier])).toEqual([
      ['You gotta be kidding.', 'exact'],
      ['I got to go.', 'spoken'],
    ]);
    expect((await search('gotta', { limit: 0 })).hits).toEqual([]);
    expect((await search('gotta', { limit: 0 })).total).toBe(2);
  });

  it('matches a Korean query against the translation lines', async () => {
    await lib.saveEpisode(save('v1', ['I knew it.', "Let's go."], ['그럴 줄 알았어.', '가자.']));
    const r = await search('그럴 줄 알았어');
    expect(r.korean).toBe(true);
    expect(r.hits.map((h) => [h.text, h.tier])).toEqual([['I knew it.', 'korean']]);
  });

  it("finds a line's chunks in the other episodes", async () => {
    await lib.saveEpisode(save('v1', ["You're gonna have to wait."]));
    await lib.saveEpisode(save('v2', ["You're gonna have to run."]));
    const r = await search('', { like: { videoId: 'v1', lang: 'en', start: 10_000, text: "You're gonna have to wait." } });
    expect(r.chunks.map((c) => c.text)).toEqual(["you're gonna have to"]);
    expect(r.hits).toEqual([]);
  });

  it('marks 🎤 key lines, and finds only those with 🎤 only', async () => {
    await lib.saveEpisode(save('v1', ['Wait here.', 'Wait there.']));
    analyses = [
      { kind: 'keylines', videoId: 'v1', lang: 'en', createdAt: 5, lines: ['Wait here.', 'Wait there.'], result: { shadow: [[1], [], []], story: [] } },
    ];
    // The key lines are read again after a minute.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
    const r = await search('wait', { keyOnly: true });
    vi.restoreAllMocks();
    expect(r.hits.map((h) => [h.text, h.key])).toEqual([['Wait there.', true]]);
  });
});

describe('Options', () => {
  it('lists, exports, imports and deletes episodes', async () => {
    await lib.saveEpisode(save('v1', ['One.', 'Two.'], ['하나.', '둘.']));
    await lib.recordWatched({ videoId: 'v1', lang: 'en', ranges: [[10_000, 12_000]] });
    const list = await lib.listLibrary();
    expect(list).toMatchObject([{ key: 'v1|en', show: 'Show v1', sentences: 2, watched: 0.5, meaning: false, trLang: 'ko', trKind: 'human' }]);
    const json = await lib.exportLibrary();
    await lib.deleteLibrary({ keys: ['v1|en'] });
    expect(await lib.listLibrary()).toEqual([]);
    expect(await lib.importLibrary(json)).toBe(1);
    expect(await lib.listLibrary()).toMatchObject([{ key: 'v1|en', sentences: 2, watched: 0.5 }]);
    expect((await search('two')).hits.map((h) => h.tr)).toEqual(['둘.']);
    // The same file again: nothing newer in it.
    expect(await lib.importLibrary(json)).toBe(0);
  });

  it('writes the backup file through the native helper and keeps its status', async () => {
    await lib.saveEpisode(save('v1', ['One.']));
    const status = await lib.runLibraryBackup();
    expect(status).toMatchObject({ ok: true, path: 'C:\\Backups\\polyglot-library.json' });
    const msg = vi.mocked(nativeRequest).mock.calls[0][0] as { type: string; json: string; dir?: string };
    expect(msg.type).toBe('backupLibrary');
    expect(JSON.parse(msg.json)).toMatchObject({ app: 'polyglot-player', kind: 'library', episodes: [{ key: 'v1|en' }] });
    expect(msg.dir).toBeUndefined();
    expect(await lib.getLibraryBackupStatus()).toMatchObject({ ok: true });
  });
});
