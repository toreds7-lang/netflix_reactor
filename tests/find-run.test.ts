import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app/controller';
import { setController } from '../src/app/instance';
import {
  activeIndex,
  cues,
  drill,
  FIND_IDLE,
  findPlaying,
  findRun,
  findState,
  loop,
  mainTrack,
  meta,
  paused,
  rawCues,
  sentences,
  settings,
  toast,
  translationMode,
  translations,
  videoId,
} from '../src/app/state';
import type { LibraryHit } from '../src/core/library';
import { PlaybackController, type LoopEnd, type LoopStatus, type PlayerControls } from '../src/core/playback';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import type { Cue } from '../src/core/types';
import { send } from '../src/core/messages';
import { setFindRun } from '../src/library/store';
import { addSentence } from '../src/sentences/store';
import type { SiteAdapter } from '../src/sites/adapter';

vi.mock('../src/library/store', () => ({
  getFindRun: vi.fn(async () => null),
  setFindRun: vi.fn(async () => undefined),
  onFindRunChanged: vi.fn(() => () => undefined),
}));
vi.mock('../src/sentences/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/sentences/store')>()),
  addSentence: vi.fn(async () => ({})),
  updateSentence: vi.fn(async () => ({})),
  deleteSentences: vi.fn(async () => ({})),
  setPractice: vi.fn(async () => undefined),
  getPractice: vi.fn(async () => null),
}));
vi.mock('../src/core/messages', () => ({ send: vi.fn(async () => ({ translations: [] })) }));
vi.stubGlobal('chrome', {
  storage: {
    local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
});

// ---------------------------------------------------------------- the loop: a speaking gap after every pass

class FakePlayer implements PlayerControls {
  t = 0;
  paused = false;
  seeks: number[] = [];
  now = () => this.t;
  isPaused = () => this.paused;
  seek = (ms: number) => void (this.t = ms, this.seeks.push(ms));
  play = () => void (this.paused = false);
  pause = () => void (this.paused = true);
}

describe('a loop with its own speaking gap (🔎 Shadow all)', () => {
  const lines: Cue[] = [
    { start: 1000, end: 2000, text: 'one' },
    { start: 3000, end: 4000, text: 'two' },
  ];
  function setup(gapSetting = false) {
    const player = new FakePlayer();
    let now = 0;
    const ends: (LoopEnd | undefined)[] = [];
    const statuses: (LoopStatus | null)[] = [];
    const pc = new PlaybackController(player, () => {}, {
      onLoop: (l, why) => (statuses.push(l), !l && ends.push(why)),
      clock: () => now,
    });
    pc.setCues(lines);
    pc.loopConfig = { count: 0, gap: gapSetting };
    const frames = (n: number) => {
      for (let k = 0; k < n; k++) {
        if (!player.isPaused()) player.t += 50;
        now += 50;
        pc.tick();
      }
    };
    return { player, pc, ends, statuses, frames };
  }

  it('pauses after each pass, the last one too, and ends when that gap is over', () => {
    const { player, pc, ends, frames } = setup();
    pc.startLoop(1, 1, true, 2, true);
    expect(pc.loopStatus).toEqual({ from: 1, to: 1, pass: 1, gap: false, passes: 2, speakGap: true });
    frames(19); // 3951: the end of the pass
    expect(pc.loopStatus).toMatchObject({ pass: 1, gap: true });
    expect(player.paused).toBe(true);
    frames(20); // a 1 s gap for a 1 s line
    expect(pc.loopStatus).toMatchObject({ pass: 2, gap: false });
    frames(19);
    expect(pc.loopStatus).toMatchObject({ pass: 2, gap: true });
    expect(ends).toEqual([]);
    frames(20);
    expect(pc.loopStatus).toBeNull();
    expect(ends).toEqual(['done']);
    expect(player.seeks).toEqual([3001, 3001]);
  });

  it('without its own gap, a counted loop ends right after its last pass, even with the gap setting on', () => {
    const { pc, ends, frames } = setup(true);
    pc.startLoop(1, 1, true, 1);
    frames(19);
    expect(pc.loopStatus).toBeNull();
    expect(ends).toEqual(['done']);
  });
});

// ---------------------------------------------------------------- 🔎 Play all / Shadow all on the page

const here: Cue[] = [
  { start: 1000, end: 2000, text: 'You gotta be kidding.' },
  { start: 5000, end: 6000, text: 'No way.' },
  { start: 8000, end: 9000, text: 'You gotta try it.' },
];

function hit(videoId: string, start: number, text: string, patch: Partial<LibraryHit> = {}): LibraryHit {
  const mark = { timeMs: start, text, lang: 'en' };
  return {
    id: `${videoId}|en|${start}`,
    videoId,
    lang: 'en',
    show: 'Show',
    episode: videoId === 'v1' ? 'S1:E1' : 'S1:E2',
    start,
    end: start + 1000,
    text,
    from: mark,
    to: mark,
    marks: [1],
    tier: 'exact',
    watched: true,
    dup: 1,
    ...patch,
  };
}

beforeEach(() => {
  settings.value = { ...DEFAULT_SETTINGS, findShadowPasses: 2 };
  mainTrack.value = { id: 't', lang: 'en', label: 'English', kind: 'subtitles', sources: [] };
  rawCues.value = here;
  videoId.value = 'v1';
  meta.value = { title: 'Show', episodeTitle: 'S1:E1' };
  translationMode.value = 'none';
  translations.value = [];
  sentences.value = {};
  drill.value = null;
  loop.value = null;
  toast.value = null;
  findRun.value = null;
  findPlaying.value = false;
  findState.value = {
    ...FIND_IDLE,
    query: 'gotta',
    status: 'ready',
    hits: [hit('v2', 4000, 'I gotta go.'), hit('v1', 8000, 'You gotta try it.'), hit('v1', 1000, 'You gotta be kidding.')],
    total: 3,
  };
});
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

function setup() {
  const adapter = {
    t: 500,
    paused: false,
    nowMs: () => adapter.t,
    isPaused: () => adapter.paused,
    seek: vi.fn(async (ms: number) => void (adapter.t = ms)),
    play: vi.fn(async () => void (adapter.paused = false)),
    pause: vi.fn(async () => void (adapter.paused = true)),
    getVideo: () => ({ readyState: 4, seeking: false }),
  };
  const c = new AppController(adapter as unknown as SiteAdapter);
  setController(c);
  c.navigate = vi.fn();
  c.playback.setCues(cues.value);
  const at = (ms: number) => {
    adapter.t = ms;
    c.playback.tick();
  };
  return { c, adapter, at };
}

describe('🔎 Play all', () => {
  it("plays this episode's lines in video order, pausing between them, then offers the other episode", async () => {
    vi.useFakeTimers();
    const { c, adapter, at } = setup();
    c.find.startRun('play');
    expect(findRun.value).toMatchObject({ mode: 'play', passes: 1, label: '“gotta”', index: 0 });
    expect(findRun.value!.items.map((i) => [i.videoId, i.start])).toEqual([
      ['v1', 1000],
      ['v1', 8000],
      ['v2', 4000],
    ]);
    expect(setFindRun).toHaveBeenCalled();
    expect(findPlaying.value).toBe(true);
    expect(adapter.t).toBe(1001); // went to the first line
    at(1500);
    at(1950); // its end
    expect(loop.value).toBeNull();
    expect(adapter.paused).toBe(true);
    expect(findRun.value!.index).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(findRun.value!.index).toBe(1);
    expect(adapter.t).toBe(8001);
    at(8500);
    at(8950);
    await vi.advanceTimersByTimeAsync(1000);
    // The next line is in another episode: the bar offers to open it, nothing opens by itself.
    expect(findRun.value!.index).toBe(2);
    expect(findPlaying.value).toBe(false);
    expect(c.navigate).not.toHaveBeenCalled();
    c.find.resume();
    expect(c.navigate).toHaveBeenCalledWith('https://www.netflix.com/watch/v2?t=4');
  });

  it('carries on in the episode opened for it', async () => {
    const { c, adapter } = setup();
    findRun.value = {
      mode: 'shadow',
      passes: 2,
      label: '“gotta”',
      items: [{ videoId: 'v1', lang: 'en', start: 8000, end: 9000, text: 'You gotta try it.', from: hit('v1', 8000, 'x').from, to: { timeMs: 8000, text: 'You gotta try it.', lang: 'en' } }],
      index: 0,
      at: Date.now(),
    };
    expect(await c.find.continueHere('v2')).toBe(false);
    expect(await c.find.continueHere('v1')).toBe(true);
    expect(loop.value).toMatchObject({ from: 2, to: 2, passes: 2, speakGap: true });
    expect(adapter.t).toBe(8001);
  });

  it('Esc pauses the run, and ▶ Continue plays the same line again', () => {
    const { c, adapter } = setup();
    c.find.startRun('play');
    (c as unknown as { onKeyDown(e: KeyboardEvent): void }).onKeyDown(new KeyboardEvent('keydown', { code: 'Escape', cancelable: true }));
    expect(loop.value).toBeNull();
    expect(findPlaying.value).toBe(false);
    expect(findRun.value!.index).toBe(0);
    expect(toast.value).toContain('Paused');
    adapter.t = 500;
    c.find.resume();
    expect(adapter.t).toBe(1001);
    expect(findPlaying.value).toBe(true);
  });

  it('a loop of your own pauses the run, and its end does not move the run on', () => {
    const { c, at } = setup();
    c.find.startRun('play');
    c.startLoop(1, 1, true);
    expect(findPlaying.value).toBe(false);
    settings.value = { ...settings.value, loopCount: 1 };
    c.playback.loopConfig = { count: 1, gap: false };
    at(5500);
    at(5950);
    expect(findRun.value!.index).toBe(0);
  });

  it('✕ ends the run and the line playing', () => {
    const { c } = setup();
    c.find.startRun('play');
    c.find.stopRun();
    expect(findRun.value).toBeNull();
    expect(loop.value).toBeNull();
    expect(findPlaying.value).toBe(false);
  });
});

describe('🔎 Shadow all', () => {
  it('loops each line with the passes chosen and a gap after each, then goes on', async () => {
    vi.useFakeTimers();
    const { c, adapter, at } = setup();
    c.find.startRun('shadow');
    expect(loop.value).toMatchObject({ from: 0, to: 0, pass: 1, passes: 2, speakGap: true });
    at(1500);
    at(1950);
    expect(loop.value).toMatchObject({ pass: 1, gap: true });
    expect(adapter.paused).toBe(true);
  });
});

describe('found lines', () => {
  it('▶ on a line of this episode just plays it, without a run', () => {
    const { c, adapter } = setup();
    c.find.playHit(hit('v1', 8000, 'You gotta try it.'), 'play');
    expect(findRun.value).toBeNull();
    expect(adapter.t).toBe(8001);
  });

  it('▶ on a line of another episode opens it, with a run of that one line', () => {
    const { c } = setup();
    c.find.playHit(hit('v2', 4000, 'I gotta go.'), 'shadow');
    expect(findRun.value).toMatchObject({ mode: 'shadow', passes: 2, items: [{ videoId: 'v2', start: 4000 }] });
    expect(c.navigate).toHaveBeenCalledWith('https://www.netflix.com/watch/v2?t=4');
  });

  it('☆ saves a line of another episode to ⭐ Sentences, with its translation and context', () => {
    const { c } = setup();
    const h = hit('v2', 4000, 'I gotta go.', { tr: '가야 해.', before: 'Bye.', after: 'See you.' });
    c.find.toggleSaved(h);
    expect(vi.mocked(addSentence).mock.calls[0][0]).toMatchObject({
      id: 'v2:en:4000',
      text: 'I gotta go.',
      translation: '가야 해.',
      videoId: 'v2',
      title: 'Show · S1:E2',
      startMs: 4000,
      before: 'Bye.',
      after: 'See you.',
    });
    expect(c.find.isSaved(h)).toBe(true);
  });

  it('☆ on a line of this episode saves it like G does', () => {
    const { c } = setup();
    c.find.toggleSaved(hit('v1', 5000, 'No way.'));
    expect(vi.mocked(addSentence).mock.calls[0][0]).toMatchObject({ id: 'v1:en:5000', text: 'No way.', title: 'Show · S1:E1' });
  });
});

// Last in this file: init() leaves its effects running.
describe('the episode open now, in the library', () => {
  const saves = () => vi.mocked(send).mock.calls.filter(([type]) => type === 'librarySave');

  it('is saved a moment after its lines come in, again with its translations, and not again for nothing', async () => {
    vi.useFakeTimers();
    const { c } = setup();
    c.find.init();
    await vi.advanceTimersByTimeAsync(5000);
    expect(saves()).toHaveLength(1);
    expect(saves()[0][1]).toMatchObject({
      videoId: 'v1',
      lang: 'en',
      show: 'Show',
      episode: 'S1:E1',
      sentences: [
        { start: 1000, end: 2000, text: 'You gotta be kidding.', from: { timeMs: 1000, text: 'You gotta be kidding.' } },
        { start: 5000, text: 'No way.' },
        { start: 8000, text: 'You gotta try it.' },
      ],
    });
    translationMode.value = 'human';
    translations.value = ['농담하지 마.', '말도 안 돼.', '해 봐.'];
    await vi.advanceTimersByTimeAsync(5000);
    expect(saves()).toHaveLength(2);
    expect(saves()[1][1]).toMatchObject({ trLang: 'ko', trKind: 'human', sentences: [{ tr: '농담하지 마.' }, { tr: '말도 안 돼.' }, { tr: '해 봐.' }] });
    meta.value = { ...meta.value! };
    await vi.advanceTimersByTimeAsync(5000);
    expect(saves()).toHaveLength(2);
  });

  it('notes the lines played, and the one before when playback moves on', async () => {
    vi.useFakeTimers();
    const { c } = setup();
    c.find.init();
    paused.value = true;
    activeIndex.value = 0; // gone to while paused: not yet
    paused.value = false;
    activeIndex.value = 2; // played on: both
    await vi.advanceTimersByTimeAsync(10_000);
    const watched = vi.mocked(send).mock.calls.filter(([type]) => type === 'libraryWatched');
    expect(watched.at(-1)?.[1]).toEqual({
      videoId: 'v1',
      lang: 'en',
      ranges: [
        [1000, 2000],
        [8000, 9000],
      ],
    });
  });
});
