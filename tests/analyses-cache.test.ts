import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyLines, KeyLinesRequest } from '../src/core/types';

// An in-memory stand-in for the IndexedDB stores.
const stores = new Map<string, Map<string, unknown>>();
const store = (name: string) => {
  if (!stores.has(name)) stores.set(name, new Map());
  return stores.get(name)!;
};
const sortedEntries = (name: string, prefix = '') =>
  [...store(name).entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1));

vi.mock('../src/services/cache', async (importActual) => ({
  hashKey: (await importActual<typeof import('../src/services/cache')>()).hashKey,
  cacheGet: async (s: string, k: string) => store(s).get(k),
  cacheSet: async (s: string, k: string, v: unknown) => void store(s).set(k, v),
  cachePut: async (s: string, k: string, v: unknown) => void store(s).set(k, v),
  cacheDelete: async (s: string, keys: string[]) => keys.forEach((k) => store(s).delete(k)),
  cacheClear: async (s: string) => store(s).clear(),
  cacheCount: async (s: string) => store(s).size,
  cacheKeys: async (s: string, prefix = '') => sortedEntries(s, prefix).map(([k]) => k),
  cacheValues: async (s: string, prefix = '') => sortedEntries(s, prefix).map(([, v]) => v),
}));

import type { AnalysisConfig } from '../src/services/analyses';

const { cachedAnalysis, deleteAnalyses, exportAnalyses, importAnalyses, listAnalyses, savedKinds } = await import(
  '../src/services/analyses'
);
const { hashKey } = await import('../src/services/cache');
const { remapTiers } = await import('../src/core/keylines');

const LINES = ['Hello there.', 'How are you?', 'Fine, thanks.', 'See you.'];

let calls = 0;
let clock = 1000;

function keyLines(over: Partial<KeyLinesRequest> = {}, config: AnalysisConfig = { model: 'opus', level: 'B1', version: 2 }) {
  return cachedAnalysis<KeyLines>({
    kind: 'keylines',
    req: { videoId: '100', title: 'Show · Ep 1', lines: LINES, lang: 'en', ...over },
    config,
    adapt: (r, map) => ({ ...r, shadow: remapTiers(r.shadow, map), story: remapTiers(r.story, map) }),
    run: async () => {
      calls++;
      return { shadow: [[1], [], []], story: [[3], [], []], model: `${config.model}-reply`, inputTokens: 10, outputTokens: 5 };
    },
  });
}

beforeEach(() => {
  stores.clear();
  calls = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000));
});

describe('cachedAnalysis', () => {
  it('makes a result once, then reads it from the cache', async () => {
    expect(await keyLines({ cacheOnly: true })).toBeNull();
    const first = await keyLines();
    expect(first).toMatchObject({ cached: false, current: true, adapted: false, level: 'B1', shadow: [[1], [], []] });
    const again = await keyLines({ cacheOnly: true });
    expect(again).toMatchObject({ cached: true, current: true, createdAt: first!.createdAt });
    expect(calls).toBe(1);
  });

  it('shares one request between two simultaneous calls', async () => {
    await Promise.all([keyLines(), keyLines()]);
    expect(calls).toBe(1);
  });

  it('shows a result made with other settings until a new one is made', async () => {
    await keyLines();
    const b2: AnalysisConfig = { model: 'opus', level: 'B2', version: 2 };
    // Opening the episode at B2 shows the B1 result, marked as not current.
    expect(await keyLines({ cacheOnly: true }, b2)).toMatchObject({ current: false, level: 'B1' });
    // The button makes a B2 one (the B1 one doesn't count as an answer).
    expect(await keyLines({}, b2)).toMatchObject({ cached: false, current: true, level: 'B2' });
    expect(calls).toBe(2);
    expect(await keyLines({ cacheOnly: true }, b2)).toMatchObject({ current: true, level: 'B2' });
    // Back at B1, its own result is current again.
    expect(await keyLines({ cacheOnly: true })).toMatchObject({ current: true, level: 'B1' });
  });

  it('treats an older prompt version as other settings', async () => {
    await keyLines({}, { model: 'opus', level: 'B1', version: 1 });
    expect(await keyLines({ cacheOnly: true })).toMatchObject({ current: false });
  });

  it('prefers the newest of several earlier results', async () => {
    await keyLines({}, { model: 'sonnet', level: 'A2', version: 2 });
    await keyLines({}, { model: 'haiku', level: 'C1', version: 2 });
    expect(await keyLines({ cacheOnly: true })).toMatchObject({ current: false, level: 'C1', model: 'haiku-reply' });
  });

  it("keeps episodes and languages apart", async () => {
    await keyLines();
    expect(await keyLines({ cacheOnly: true, videoId: '200' })).toBeNull();
    expect(await keyLines({ cacheOnly: true, lang: 'es' })).toBeNull();
  });

  it('matches a result to slightly changed subtitles', async () => {
    await keyLines();
    // A new first line, and "How are you?" was re-punctuated.
    const lines = ['Previously…', 'Hello there.', 'How are you', 'Fine, thanks.', 'See you.'];
    const got = await keyLines({ cacheOnly: true, lines });
    expect(got).toMatchObject({ current: true, adapted: true, shadow: [[2], [], []], story: [[4], [], []] });
  });

  it("doesn't show a result for mostly different subtitles", async () => {
    await keyLines();
    expect(await keyLines({ cacheOnly: true, lines: ['A.', 'B.', 'C.', 'See you.'] })).toBeNull();
  });

  it('makes a new result on refresh and replaces the cached one', async () => {
    const first = await keyLines();
    const second = await keyLines({ refresh: true });
    expect(calls).toBe(2);
    expect(second!.createdAt).toBeGreaterThan(first!.createdAt);
    expect((await listAnalyses()).items).toHaveLength(1);
  });

  it('moves a result cached before results were kept per episode', async () => {
    const oldKey = await hashKey(['keylines', '2', 'opus', 'B1', 'en', ...LINES]);
    store('keylines').set(oldKey, { shadow: [[0], [], []], story: [[], [], []], model: 'old', inputTokens: 1, outputTokens: 1 });
    expect((await listAnalyses()).unlinked).toBe(1);

    expect(await keyLines({ cacheOnly: true })).toMatchObject({ cached: true, current: true, model: 'old', shadow: [[0], [], []] });
    expect(calls).toBe(0);
    expect(store('keylines').size).toBe(0);
    const { items, unlinked } = await listAnalyses();
    expect(unlinked).toBe(0);
    expect(items).toMatchObject([{ key: '100|keylines|en|opus|B1', title: 'Show · Ep 1', model: 'old', sentences: 4 }]);
  });
});

describe('saved results', () => {
  it('lists, marks, exports, imports and deletes', async () => {
    await keyLines();
    await keyLines({ videoId: '200' }, { model: 'opus', level: 'A2', version: 2 });
    expect(await savedKinds(['100', '200', '300'])).toEqual({ '100': ['keylines'], '200': ['keylines'] });

    const backup = await exportAnalyses();
    expect(backup).toHaveLength(2);

    await deleteAnalyses({ keys: ['100|keylines|en|opus|B1'] });
    expect((await listAnalyses()).items.map((r) => r.videoId)).toEqual(['200']);

    // The deleted one comes back; the one still there is as new as the backup's, so it is kept.
    expect(await importAnalyses([...backup, { junk: true }])).toBe(1);
    expect((await listAnalyses()).items).toHaveLength(2);

    store('summary').set('old', {});
    await deleteAnalyses({ all: true });
    expect(await listAnalyses()).toEqual({ items: [], unlinked: 0 });
  });
});
