import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppController } from '../src/app/controller';
import { setController } from '../src/app/instance';
import {
  FIND_IDLE,
  findPlaying,
  findRun,
  findState,
  loop,
  mainTrack,
  rawCues,
  settings,
  sidebarTab,
  videoId,
  type FindState,
} from '../src/app/state';
import type { LibraryHit } from '../src/core/library';
import { send } from '../src/core/messages';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import { FindInShows } from '../src/ui/Find';
import { Sidebar } from '../src/ui/Sidebar';

vi.mock('../src/core/messages', () => ({ send: vi.fn(async () => ({ episodes: 4, sentences: 1200, total: 23, hits: [] })) }));

const find = {
  search: vi.fn(),
  findLike: vi.fn(),
  playHit: vi.fn(),
  toggleSaved: vi.fn(),
  isSaved: vi.fn((hit: LibraryHit) => hit.start === 4000),
  startRun: vi.fn(),
  setFilter: vi.fn(),
  setShow: vi.fn(),
  backToLine: vi.fn(),
  findPatterns: vi.fn(),
  searchFrame: vi.fn(),
  resume: vi.fn(),
  skip: vi.fn(),
  stopRun: vi.fn(),
};
const fake = { find, closePopup: vi.fn(), playback: { goTo: vi.fn() } };

function hit(videoId: string, start: number, text: string, patch: Partial<LibraryHit> = {}): LibraryHit {
  const mark = { timeMs: start, text, lang: 'en' };
  return {
    id: `${videoId}|en|${start}`,
    videoId,
    lang: 'en',
    show: 'Show',
    episode: 'S1:E2',
    start,
    end: start + 1000,
    text,
    from: mark,
    to: mark,
    marks: [],
    tier: 'exact',
    watched: true,
    dup: 1,
    ...patch,
  };
}

let root: HTMLElement;
const show = (st: Partial<FindState>) =>
  act(() => {
    findState.value = { ...FIND_IDLE, ...st };
  });
const buttons = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.includes(label));

beforeEach(() => {
  setController(fake as unknown as AppController);
  settings.value = DEFAULT_SETTINGS;
  rawCues.value = [{ start: 1000, end: 2000, text: 'Hello.' }];
  mainTrack.value = { id: 't', lang: 'en', label: 'English', kind: 'subtitles', sources: [] };
  videoId.value = 'v1';
  sidebarTab.value = 'find';
  findState.value = FIND_IDLE;
  findRun.value = null;
  findPlaying.value = false;
  loop.value = null;
  root = document.createElement('div');
  document.body.append(root);
  act(() => render(h(Sidebar, null), root));
});
afterEach(() => {
  render(null, root);
  root.remove();
  vi.clearAllMocks();
});

describe('🔎 Find tab', () => {
  it('explains itself and counts the episodes saved before a search', async () => {
    await act(async () => undefined);
    expect(root.querySelector('.find-intro')?.textContent).toContain('4 episodes saved · 1200 sentences');
    expect(root.querySelector('.find-intro')?.textContent).toContain('press I');
  });

  it('searches what is typed', () => {
    const input = root.querySelector<HTMLInputElement>('.find-input')!;
    act(() => {
      input.value = 'gonna';
      input.dispatchEvent(new Event('input'));
    });
    act(() => {
      root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    });
    expect(find.search).toHaveBeenCalledWith('gonna');
  });

  it('shows the lines found by kind, with the matched words in bold and what to do with them', () => {
    show({
      query: 'go',
      status: 'ready',
      episodes: 4,
      total: 3,
      forms: ['gone', 'went'],
      hits: [
        hit('v1', 1000, 'I go home.', { marks: [1], dup: 3 }),
        hit('v2', 4000, 'She went home.', { tier: 'forms', marks: [1], watched: false }),
        hit('v2', 6000, "We're gonna go.", { tier: 'spoken', key: true }),
      ],
      meaning: { status: 'idle', hits: [] },
    });
    const heads = [...root.querySelectorAll('.find-group-head')].map((x) => x.textContent);
    expect(heads).toEqual(['Same words', 'Spoken form (gonna = going to…)', 'Other forms · gone · went']);
    expect([...root.querySelectorAll('.find-mark')].map((x) => x.textContent)).toEqual(['go', 'went']);
    const meta = [...root.querySelectorAll('.find-hit .loop-time')].map((x) => x.textContent);
    expect(meta).toEqual(['This episode · 0:01 · ×3', 'Show · S1:E2 · 0:06 · 🎤', 'Show · S1:E2 · 0:04 · not watched yet']);
    expect(root.querySelector('.find-head')?.textContent).toContain('3 lines in 4 episodes');
    // ☆ / ★, 🗣 and ▶ on each line.
    expect([...root.querySelectorAll('.find-hit button.star')].map((b) => b.textContent)).toEqual(['☆', '☆', '★']);
    root.querySelector<HTMLButtonElement>('.find-hit button[title^="Shadow it"]')!.click();
    expect(find.playHit).toHaveBeenCalledWith(expect.objectContaining({ start: 1000 }), 'shadow');
    (root.querySelector('.find-hit') as HTMLElement).click();
    expect(find.playHit).toHaveBeenLastCalledWith(expect.objectContaining({ start: 1000 }), 'play');
    buttons('▶ Play all')[0].click();
    buttons('🗣 Shadow all')[0].click();
    expect(find.startRun.mock.calls).toEqual([['play'], ['shadow']]);
  });

  it('says why nothing was found', () => {
    show({ query: 'zebra', status: 'ready', episodes: 4, hits: [], meaning: { status: 'off', hits: [] } });
    expect(root.querySelector('.list-empty')?.textContent).toContain('Turn off “Watched only”');
    show({ query: 'zebra', status: 'ready', episodes: 0, hits: [], meaning: { status: 'off', hits: [] } });
    expect(root.querySelector('.list-empty')?.textContent).toContain('No episodes saved yet');
  });

  it('shows the same-meaning lines after the others, and the model download while it loads', () => {
    show({
      query: '그럴 줄 알았어',
      status: 'ready',
      episodes: 4,
      hits: [],
      meaning: { status: 'loading', hits: [], info: { state: 'working', indexed: 0, total: 4, progress: 0.42 } },
    });
    expect(root.textContent).toContain('Downloading the meaning model (about 23 MB, once)… 42%');
    show({
      query: '그럴 줄 알았어',
      status: 'ready',
      episodes: 4,
      hits: [],
      meaning: {
        status: 'ready',
        hits: [hit('v2', 4000, 'I knew it.', { tier: 'meaning', score: 0.81 })],
        info: { state: 'idle', indexed: 3, total: 4 },
        translated: 'I knew it',
      },
    });
    expect(root.querySelector('.find-group-head')?.textContent).toBe('Same meaning, other words · “I knew it”');
    expect(root.querySelector('.find-hit .loop-time')?.textContent).toContain('81% alike');
    expect(root.textContent).toContain('has read 3 of your 4 episodes');
  });

  it('starting from a line, offers its chunks and ✨ Pattern', () => {
    const like = { videoId: 'v1', lang: 'en', start: 1000, text: "You're gonna have to wait." };
    show({ like, status: 'ready', episodes: 4, chunks: [{ words: ['have', 'to'], text: 'have to', episodes: 3, lines: 9 }] });
    expect(root.querySelector('.find-like-text')?.textContent).toBe(`“${like.text}”`);
    buttons('have to · 3')[0].click();
    expect(find.search).toHaveBeenCalledWith('have to', like);
    buttons('✨ Pattern')[0].click();
    expect(find.findPatterns).toHaveBeenCalled();
    show({ like, status: 'ready', episodes: 4, frames: { status: 'ready', list: ['___ gonna have to ___'] } });
    buttons('✨ ___ gonna have to ___')[0].click();
    expect(find.searchFrame).toHaveBeenCalledWith('___ gonna have to ___');
  });

  it('changes a filter, and runs the search again with it', () => {
    show({ query: 'go', status: 'ready', episodes: 4, hits: [hit('v1', 1000, 'Go.')] });
    buttons('Watched only')[0].click();
    expect(find.setFilter).toHaveBeenCalledWith({ findWatchedOnly: false });
    buttons('Short')[0].click();
    expect(find.setFilter).toHaveBeenCalledWith({ findLength: 'short' });
  });
});

describe('🔎 run bar', () => {
  const item = (videoId: string, start: number) => ({
    videoId,
    lang: 'en',
    title: 'Show · S1:E2',
    start,
    end: start + 1000,
    text: 'x',
    from: { timeMs: start, text: 'x', lang: 'en' },
    to: { timeMs: start, text: 'x', lang: 'en' },
  });

  it('between episodes, offers to open the next one', () => {
    act(() => {
      findRun.value = { mode: 'play', passes: 1, label: '“go”', items: [item('v1', 1), item('v2', 2), item('v2', 3)], index: 1, at: Date.now() };
    });
    const bar = root.querySelector('.findbar')!;
    expect(bar.textContent).toContain('🔎 Play all · 2 of 3 · “go”');
    expect(bar.textContent).toContain('Next: 2 lines in Show · S1:E2');
    buttons('Open ›')[0].click();
    expect(find.resume).toHaveBeenCalled();
  });

  it('while a line is shadowed, shows the pass and the speaking gap', () => {
    act(() => {
      findRun.value = { mode: 'shadow', passes: 2, label: '', items: [item('v1', 1)], index: 0, at: Date.now() };
      findPlaying.value = true;
      loop.value = { from: 0, to: 0, pass: 2, gap: true, passes: 2, speakGap: true };
    });
    expect(root.querySelector('.findbar .lb-pass')?.textContent).toBe('🗣 Your turn');
    // The run's own bar replaces the loop bar.
    expect(root.querySelector('.loopbar')).toBeNull();
  });
});

describe('🔎 In my shows, in the word popup', () => {
  it('shows how many lines have the word, and opens them', async () => {
    const box = document.createElement('div');
    document.body.append(box);
    await act(async () => render(h(FindInShows, { text: 'gonna' }), box));
    await act(async () => undefined); // the count arrives
    expect(vi.mocked(send)).toHaveBeenCalledWith('librarySearch', expect.objectContaining({ query: 'gonna', limit: 0, watchedOnly: true }));
    expect(box.textContent).toBe('🔎 In my shows (23)');
    box.querySelector('button')!.click();
    expect(fake.closePopup).toHaveBeenCalled();
    expect(find.search).toHaveBeenCalledWith('gonna');
    render(null, box);
    box.remove();
  });
});
