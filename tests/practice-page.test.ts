import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readWithBrowserVoice, readWithKokoro, type ReaderEvents } from '../src/app/reader';
import { newSrs } from '../src/core/sentences';
import type { SavedSentence } from '../src/core/types';
import { PracticePage } from '../src/pages/practice/PracticePage';

/** Each utterance "plays" for a second. */
const SPEECH_MS = 1000;
const fakeReader = async (_texts: string[], _opts: unknown, ev: ReaderEvents) => {
  queueMicrotask(() => {
    ev.onItem(0);
    setTimeout(() => ev.onDone(), SPEECH_MS);
  });
  return { stop: vi.fn() };
};
vi.mock('../src/app/reader', () => ({
  readWithKokoro: vi.fn((t: string[], o: unknown, ev: ReaderEvents) => fakeReader(t, o, ev)),
  readWithBrowserVoice: vi.fn((t: string[], _l: string, o: unknown, ev: ReaderEvents) => fakeReader(t, o, ev)),
}));

const DAY = 86_400_000;
let store: Record<string, unknown>;
const listeners: ((changes: Record<string, { newValue: unknown }>, area: string) => void)[] = [];

function sentence(id: string, text: string, lang: string, dueAgo: number, patch: Partial<SavedSentence> = {}): SavedSentence {
  const mark = { timeMs: 1000, text, lang };
  return {
    id,
    lang,
    text,
    translation: `(${text})`,
    videoId: 'v1',
    title: 'Show · Ep 1',
    from: mark,
    to: mark,
    startMs: 1000,
    endMs: 2000,
    srs: { ...newSrs(0), due: Date.now() - dueAgo },
    practiced: 0,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  store = {
    sentences: {
      a: sentence('a', '- Could you give me a hand?', 'en', DAY, { srs: { ...newSrs(0), due: Date.now() - DAY, last: 1, reps: 1, interval: 1 } }),
      b: sentence('b', '¿Dónde está?', 'es', 1000),
      later: sentence('later', 'Not yet.', 'en', -5 * DAY),
    },
  };
  listeners.length = 0;
  vi.stubGlobal('chrome', {
    runtime: { id: 'x', getURL: (p: string) => p },
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
          const changes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }]));
          listeners.forEach((l) => l(changes, 'local'));
        },
        remove: async () => undefined,
      },
      onChanged: { addListener: (l: (typeof listeners)[number]) => listeners.push(l), removeListener: () => undefined },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('practice page', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
  });
  afterEach(() => {
    render(null, root);
    root.remove();
  });

  const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
  const text = () => root.querySelector('.pr-text');
  const key = (code: string) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { code })));

  it('plays the drill with text-to-speech, hides the text on listen and from-memory passes, then rates and goes on', async () => {
    act(() => render(h(PracticePage, null), root));
    await tick(200);
    // The most overdue first; the one not due yet isn't in the queue.
    expect(text()!.textContent).toBe('- Could you give me a hand?');
    expect(root.querySelector('.pr-head')!.textContent).toContain('2 left · 0 done');
    expect(text()!.classList.contains('hidden')).toBe(true);

    key('Space');
    await tick(10);
    // English: Kokoro, without the speaker dash.
    expect(readWithKokoro).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readWithKokoro).mock.calls[0][0]).toEqual(['Could you give me a hand?']);
    expect(vi.mocked(readWithKokoro).mock.calls[0][1]).toMatchObject({ rate: 1 });

    // Two listen passes (each 1 s of speech and a short pause), then the text shows for shadowing.
    await tick(2 * (SPEECH_MS + 700));
    expect(root.querySelector('.pr-step-label')!.textContent).toContain('Shadow with text (3/6)');
    expect(text()!.classList.contains('hidden')).toBe(false);
    await tick(2 * (SPEECH_MS + 700));
    expect(root.querySelector('.pr-step-label')!.textContent).toContain('Shadow from memory (5/6)');
    expect(text()!.classList.contains('hidden')).toBe(true);
    await tick(2 * (SPEECH_MS + 700));
    expect(readWithKokoro).toHaveBeenCalledTimes(6);
    const grades = [...root.querySelectorAll('.pr-grades .grade')].map((b) => b.textContent);
    expect(grades).toEqual(['1 Again10m', '2 Hard2d', '3 Good3d', '4 Easy4d']);

    key('Digit3');
    await tick(10);
    const a = (store.sentences as Record<string, SavedSentence>).a;
    expect(a.srs).toMatchObject({ interval: 3, reps: 2 });
    expect(a.practiced).toBe(1);
    expect(root.querySelector('.pr-head')!.textContent).toContain('1 left · 1 done');
    // The next one starts by itself, in Spanish with the browser's voice.
    expect(text()!.textContent).toBe('¿Dónde está?');
    await tick(700);
    expect(readWithBrowserVoice).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readWithBrowserVoice).mock.calls[0][1]).toBe('es');
  });

  it('"Again" brings the sentence back once at the end; afterwards it offers to practise more', async () => {
    act(() => render(h(PracticePage, null), root));
    await tick(200);
    // → skips to the next pass; past the last one it goes to the rating.
    for (let i = 0; i < 6; i++) key('ArrowRight');
    await tick(10);
    expect(root.querySelector('.pr-grades')).toBeTruthy();
    key('Digit1');
    await tick(10);
    expect(root.querySelector('.pr-head')!.textContent).toContain('2 left · 1 done');
    expect(text()!.textContent).toBe('¿Dónde está?');
  });

  it('says when nothing is due and offers to practise ahead or at random', async () => {
    store.sentences = { later: sentence('later', 'Not yet.', 'en', -5 * DAY) };
    act(() => render(h(PracticePage, null), root));
    await tick(200);
    expect(root.querySelector('.pr-empty h2')!.textContent).toBe('Nothing due right now ✓');
    act(() => [...root.querySelectorAll<HTMLButtonElement>('.pr-empty button')].find((b) => b.textContent === 'Practise the next ones ahead')!.click());
    expect(text()!.textContent).toBe('Not yet.');
  });

  it('moves on when the sentence was rated on Netflix meanwhile', async () => {
    act(() => render(h(PracticePage, null), root));
    await tick(200);
    expect(text()!.textContent).toBe('- Could you give me a hand?');
    const all = store.sentences as Record<string, SavedSentence>;
    await act(async () => {
      await (chrome.storage.local.set as (i: object) => Promise<void>)({
        sentences: { ...all, a: { ...all.a, srs: { ...all.a.srs, last: Date.now() + 1000, due: Date.now() + 3 * DAY } } },
      });
    });
    await tick(10);
    expect(text()!.textContent).toBe('¿Dónde está?');
  });
});
