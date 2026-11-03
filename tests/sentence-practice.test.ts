import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app/controller';
import { setController } from '../src/app/instance';
import {
  activeIndex,
  cues,
  drill,
  loop,
  loopTextHidden,
  mainTrack,
  meta,
  practice,
  rawCues,
  savedLines,
  sentences,
  settings,
  sidebarTab,
  toast,
  translationMode,
  translations,
  videoId,
  warmupOffer,
} from '../src/app/state';
import { send } from '../src/core/messages';
import { newSrs } from '../src/core/sentences';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import type { Cue, PracticeSession, SavedSentence } from '../src/core/types';
import { addSentence, deleteSentences, getPractice, setPractice, updateSentence } from '../src/sentences/store';
import type { SiteAdapter } from '../src/sites/adapter';
import { App } from '../src/ui/App';
import { Overlay } from '../src/ui/Overlay';
import { Sidebar } from '../src/ui/Sidebar';

vi.mock('../src/sentences/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/sentences/store')>()),
  addSentence: vi.fn(async () => ({})),
  updateSentence: vi.fn(async () => ({})),
  deleteSentences: vi.fn(async () => ({})),
  setPractice: vi.fn(async () => undefined),
  getPractice: vi.fn(async () => null),
}));
vi.mock('../src/core/messages', () => ({ send: vi.fn(async () => ({ translations: ['어디 가는 거야?'] })) }));

// Settings and bookmarks live in extension storage.
vi.stubGlobal('chrome', {
  storage: {
    local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
});

const lines: Cue[] = [
  { start: 1000, end: 2000, text: 'Where are you' },
  { start: 2100, end: 3000, text: 'going?' },
  { start: 5000, end: 6000, text: 'Home.' },
  { start: 8000, end: 9000, text: 'See you.' },
];

/** A due sentence saved from lines [from, to] of `lines` (or of another episode). */
function saved(id: string, from: number, to: number, patch: Partial<SavedSentence> = {}): SavedSentence {
  const mark = (c: Cue) => ({ timeMs: c.start, text: c.text, lang: 'en' });
  return {
    id,
    lang: 'en',
    text: lines.slice(from, to + 1).map((c) => c.text).join(' '),
    videoId: 'v1',
    title: 'Show · Ep 1',
    from: mark(lines[from]),
    to: mark(lines[to]),
    startMs: lines[from].start,
    endMs: lines[to].end,
    srs: newSrs(Date.now() - 60_000),
    practiced: 0,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

beforeEach(() => {
  settings.value = DEFAULT_SETTINGS;
  mainTrack.value = { id: 't', lang: 'en', label: 'English', kind: 'subtitles', sources: [] };
  rawCues.value = lines;
  videoId.value = 'v1';
  meta.value = { title: 'Show', episodeTitle: 'Ep 1' };
  translationMode.value = 'human';
  translations.value = ['어디', '가니?', '집.', '또 봐.'];
  sentences.value = {};
  drill.value = null;
  practice.value = null;
  warmupOffer.value = null;
  loop.value = null;
  activeIndex.value = -1;
  toast.value = null;
  sidebarTab.value = 'subs';
});
afterEach(() => vi.clearAllMocks());

function setup(t = 500) {
  const adapter = {
    t,
    paused: false,
    nowMs: () => adapter.t,
    isPaused: () => adapter.paused,
    seek: vi.fn(async (ms: number) => void (adapter.t = ms)),
    play: vi.fn(async () => void (adapter.paused = false)),
    pause: vi.fn(async () => void (adapter.paused = true)),
    getVideo: () => ({ readyState: 4, seeking: false }),
  };
  const c = new AppController(adapter as unknown as SiteAdapter);
  c.navigate = vi.fn();
  c.playback.setCues(cues.value);
  const at = (ms: number) => {
    adapter.t = ms;
    c.playback.tick();
  };
  at(t);
  const press = (code: string) => {
    (c as unknown as { onKeyDown(e: KeyboardEvent): void }).onKeyDown(new KeyboardEvent('keydown', { code, cancelable: true }));
  };
  /** Play one pass of lines 0-1 to its end. */
  const passOf01 = () => (at(1500), at(2950));
  /** Play one pass of line 2 to its end. */
  const passOf2 = () => (at(5500), at(5950));
  return { c, adapter, at, press, passOf01, passOf2 };
}

describe('saving sentences', () => {
  it('G saves the whole sentence the line belongs to, with its translation', () => {
    const { at, press } = setup();
    at(2500);
    press('KeyG');
    expect(addSentence).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addSentence).mock.calls[0][0]).toMatchObject({
      id: 'v1:en:1000',
      lang: 'en',
      text: 'Where are you going?',
      translation: '어디 가니?',
      videoId: 'v1',
      title: 'Show · Ep 1',
      from: { timeMs: 1000, text: 'Where are you' },
      to: { timeMs: 2100, text: 'going?' },
      startMs: 1000,
      endMs: 3000,
      after: 'Home.',
      practiced: 0,
    });
    expect([...savedLines.value.keys()]).toEqual([0, 1]);
    expect(toast.value).toContain('Saved (2 lines)');
    expect(send).not.toHaveBeenCalled();

    press('KeyG');
    expect(addSentence).toHaveBeenCalledTimes(1);
    expect(toast.value).toContain('Already saved');
  });

  it('translates the whole sentence when one of its lines has no translation yet', async () => {
    translationMode.value = 'machine';
    translations.value = ['어디', null, null, null];
    const { c } = setup();
    c.saveSentenceAt(0);
    expect(vi.mocked(addSentence).mock.calls[0][0].translation).toBeUndefined();
    expect(send).toHaveBeenCalledWith('translateLines', { lines: ['Where are you going?'], from: 'en', to: 'ko' });
    await vi.waitFor(() => expect(updateSentence).toHaveBeenCalledWith('v1:en:1000', { translation: '어디 가는 거야?' }));
  });

  it('☆ on a line saves its sentence; ★ removes it again', () => {
    const { c } = setup();
    c.toggleSentence(2);
    expect(savedLines.value.get(2)).toBe('v1:en:5000');
    c.toggleSentence(2);
    expect(deleteSentences).toHaveBeenCalledWith(['v1:en:5000']);
    expect(savedLines.value.has(2)).toBe(false);
    expect(toast.value).toContain('Removed');
  });

  it('☆ in the loop bar saves the looped lines as one sentence, or extends the one saved from the first line', () => {
    const { c } = setup();
    c.startLoop(2, 3, true);
    c.saveLoopAsSentence();
    expect(vi.mocked(addSentence).mock.calls[0][0]).toMatchObject({ id: 'v1:en:5000', text: 'Home. See you.', endMs: 9000 });

    sentences.value = { 'v1:en:5000': saved('v1:en:5000', 2, 2, { srs: { ...newSrs(1), reps: 2, interval: 3 } }) };
    c.saveLoopAsSentence();
    expect(updateSentence).toHaveBeenCalledWith('v1:en:5000', expect.objectContaining({ text: 'Home. See you.', to: expect.objectContaining({ timeMs: 8000 }) }));
    // It keeps its practice history.
    expect(sentences.value['v1:en:5000']).toMatchObject({ text: 'Home. See you.', srs: { reps: 2, interval: 3 } });
    expect(toast.value).toContain('changed to these 2 lines');
  });
});

describe('practice drill', () => {
  it('listens with the text hidden, shadows with the text, then from memory, and waits for a rating', () => {
    const { c, adapter, passOf01 } = setup();
    const s = saved('a', 0, 1);
    sentences.value = { a: s };
    c.startDrill(s);
    expect(loop.value).toMatchObject({ from: 0, to: 1, pass: 1, passes: 6 });
    expect(adapter.seek).toHaveBeenLastCalledWith(1001);
    expect(toast.value).toContain('6 passes, then rate it');

    const hidden: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      hidden.push(loopTextHidden.value);
      passOf01();
    }
    expect(hidden).toEqual([true, true, false, false, true, true]);
    expect(loop.value).toBeNull();
    expect(drill.value).toMatchObject({ id: 'a', phase: 'rate' });
    expect(adapter.pause).toHaveBeenCalled();
    expect(toast.value).toContain('1 Again · 2 Hard · 3 Good · 4 Easy');
  });

  it('rates with 1-4: the sentence comes back later and the drill ends', () => {
    const { c, press } = setup();
    const s = saved('a', 0, 1);
    sentences.value = { a: s };
    drill.value = { id: 'a', steps: ['text'], phase: 'rate' };
    press('Digit3');
    expect(updateSentence).toHaveBeenCalledWith('a', { srs: expect.objectContaining({ interval: 1, reps: 1 }), practiced: 1 });
    expect(drill.value).toBeNull();
    expect(toast.value).toBe('⭐ Good · back tomorrow');
    void c;
  });

  it('Esc stops the passes, or leaves a finished drill unrated', () => {
    const { c, press } = setup();
    const s = saved('a', 0, 1);
    sentences.value = { a: s };
    c.startDrill(s);
    press('Escape');
    expect(loop.value).toBeNull();
    expect(drill.value).toBeNull();
    expect(toast.value).toBe('Practice stopped');

    drill.value = { id: 'a', steps: ['text'], phase: 'rate' };
    press('Escape');
    expect(drill.value).toBeNull();
    expect(updateSentence).not.toHaveBeenCalled();
  });

  it('a loop of your own replaces the drill', () => {
    const { c } = setup();
    const s = saved('a', 0, 1);
    sentences.value = { a: s };
    c.startDrill(s);
    c.startLoop(2, 3, true);
    expect(drill.value).toBeNull();
    // It plays as many passes as the loop setting says.
    expect(loop.value).toEqual({ from: 2, to: 3, pass: 1, gap: false });
  });
});

describe('practice session', () => {
  const other = () => saved('c', 0, 0, { videoId: 'v2', title: 'Other · Ep 2', startMs: 3000, from: { timeMs: 3000, text: 'Hi.', lang: 'en' }, to: { timeMs: 3000, text: 'Hi.', lang: 'en' } });

  it("practises this episode's due sentences in turn, then offers the next episode", () => {
    const { c, passOf01, passOf2 } = setup();
    sentences.value = { a: saved('a', 0, 1), b: saved('b', 2, 2), c: other() };
    c.startDuePractice();
    expect(setPractice).toHaveBeenLastCalledWith(expect.objectContaining({ ids: ['a', 'b', 'c'], index: 0, done: 0 }));
    expect(drill.value?.id).toBe('a');

    for (let i = 0; i < 6; i++) passOf01();
    c.grade('good');
    expect(practice.value).toMatchObject({ index: 1, done: 1 });
    expect(drill.value).toMatchObject({ id: 'b', phase: 'playing' });

    for (let i = 0; i < 6; i++) passOf2();
    c.grade('good');
    expect(practice.value).toMatchObject({ index: 2, done: 2 });
    expect(drill.value).toBeNull();
    expect(c.navigate).not.toHaveBeenCalled();

    setController(c);
    const root = document.createElement('div');
    document.body.append(root);
    act(() => render(h(Sidebar, null), root));
    const bar = root.querySelector('.practicebar')!;
    expect(bar.textContent).toContain('3 of 3');
    expect(bar.textContent).toContain('Next: Other · Ep 2');
    act(() => [...bar.querySelectorAll('button')].find((b) => b.textContent === 'Open ›')!.click());
    expect(c.navigate).toHaveBeenCalledWith('https://www.netflix.com/watch/v2?t=3');
    render(null, root);
    root.remove();
  });

  it('"Again" brings a sentence back once, at the end of the session', () => {
    const { c } = setup();
    sentences.value = { a: saved('a', 0, 1), b: saved('b', 2, 2) };
    c.startDuePractice();
    drill.value = { ...drill.value!, phase: 'rate' };
    c.grade('again');
    expect(practice.value).toMatchObject({ ids: ['a', 'b', 'a'], index: 1 });
    expect(drill.value?.id).toBe('b');
  });

  it("practising another episode's sentence opens it, and that episode practises it once it loads", async () => {
    const { c } = setup();
    const s = other();
    sentences.value = { c: s };
    c.practiseSentence(s);
    expect(setPractice).toHaveBeenCalledWith(expect.objectContaining({ ids: ['c'], index: 0 }));
    await vi.waitFor(() => expect(c.navigate).toHaveBeenCalledWith('https://www.netflix.com/watch/v2?t=3'));

    // The other episode's page: same tab, new page.
    const session: PracticeSession = { ids: ['c'], index: 0, done: 0, at: Date.now() };
    practice.value = null;
    vi.mocked(getPractice).mockResolvedValueOnce(session);
    videoId.value = 'v2';
    rawCues.value = [{ start: 3000, end: 4000, text: 'Hi.' }];
    const page = setup();
    await (page.c as unknown as { offerResume(id: string): Promise<void> }).offerResume('v2');
    expect(drill.value).toMatchObject({ id: 'c', phase: 'playing' });
    expect(warmupOffer.value).toBeNull();
  });

  it('offers a warm-up when an episode opens and sentences are due', async () => {
    const { c } = setup();
    sentences.value = { a: saved('a', 0, 1), c: other(), later: saved('later', 2, 2, { srs: { ...newSrs(1), due: Date.now() + 86_400_000 } }) };
    await (c as unknown as { offerResume(id: string): Promise<void> }).offerResume('v1');
    expect(warmupOffer.value).toEqual({ due: 2, here: 1 });

    warmupOffer.value = null;
    settings.value = { ...DEFAULT_SETTINGS, warmup: false };
    await (c as unknown as { offerResume(id: string): Promise<void> }).offerResume('v1');
    expect(warmupOffer.value).toBeNull();
  });
});

describe('sentence UI', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
  });
  afterEach(() => {
    render(null, root);
    root.remove();
  });

  it("the ⭐ Sentences tab lists this episode's sentences, the due ones or all; a click practises one", () => {
    const { c } = setup();
    setController(c);
    sentences.value = {
      a: saved('a', 0, 1, { translation: '어디 가니?' }),
      b: saved('b', 2, 2, { srs: { ...newSrs(1), due: Date.now() + 3 * 86_400_000, last: 1, reps: 1, interval: 3 } }),
      x: saved('x', 3, 3, { videoId: 'v9', title: 'Elsewhere' }),
    };
    sidebarTab.value = 'sentences';
    act(() => render(h(Sidebar, null), root));
    const tab = [...root.querySelectorAll('.tabs button')].find((b) => b.textContent?.startsWith('⭐ Sentences'))!;
    expect(tab.textContent).toBe('⭐ Sentences (2)');
    const items = () => [...root.querySelectorAll('.sent-item')];
    expect(items().map((el) => el.querySelector('[lang="en"]')!.textContent)).toEqual(['Where are you going?', 'Home.']);
    expect(items()[0].textContent).toContain('new');
    expect(items()[1].textContent).toContain('in 3 days');
    expect(root.querySelector('.sent-head button')!.textContent).toBe('▶ Practise 2 due');

    act(() => void [...root.querySelectorAll('.chip')].find((b) => b.textContent?.startsWith('All'))!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(items()).toHaveLength(3);
    expect(items().find((el) => el.textContent?.includes('Elsewhere'))).toBeTruthy();

    act(() => void items().find((el) => el.textContent?.includes('Home.'))!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(drill.value).toMatchObject({ id: 'b', phase: 'playing' });
    expect(root.querySelector('.practicebar')).toBeTruthy();
    expect(root.querySelectorAll('.pb-dot')).toHaveLength(6);
  });

  it('a subtitle line gets ☆, and ★ once its sentence is saved', () => {
    const { c } = setup();
    setController(c);
    act(() => render(h(Sidebar, null), root));
    const star = () => root.querySelector<HTMLButtonElement>('.row[data-index="2"] button.star')!;
    expect(star().textContent).toBe('☆');
    act(() => star().click());
    expect(addSentence).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1:en:5000', text: 'Home.' }));
    expect(star().textContent).toBe('★');
    expect(root.querySelector('.row[data-index="2"]')!.classList.contains('saved')).toBe(true);
    expect(root.querySelector('.row[data-index="2"] .row-star')).toBeTruthy();
  });

  it('on the video, ☆ sits right of the ↺ and saves the line without reaching Netflix', () => {
    const { c } = setup();
    setController(c);
    activeIndex.value = 3;
    act(() => render(h(Overlay, null), root));
    const outside = vi.fn();
    root.addEventListener('click', outside);
    const star = root.querySelector<HTMLButtonElement>('.ov-star')!;
    expect(star.previousElementSibling!.classList.contains('ov-repeat')).toBe(true);
    act(() => void star.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(outside).not.toHaveBeenCalled();
    expect(root.querySelector('.ov-star')!.classList.contains('saved')).toBe(true);
  });

  it('after the passes, the practice bar offers the four ratings with when each brings it back', () => {
    const { c } = setup();
    setController(c);
    sentences.value = { a: saved('a', 0, 1) };
    drill.value = { id: 'a', steps: ['text'], phase: 'rate' };
    act(() => render(h(Sidebar, null), root));
    const grades = [...root.querySelectorAll<HTMLButtonElement>('.pb-grades .grade')];
    expect(grades.map((b) => b.textContent)).toEqual(['1 Again10m', '2 Hard1d', '3 Good1d', '4 Easy3d']);
    act(() => grades[3].click());
    expect(updateSentence).toHaveBeenCalledWith('a', expect.objectContaining({ srs: expect.objectContaining({ interval: 3 }) }));
  });

  it('the warm-up banner starts practising the sentences due', () => {
    const { c } = setup();
    setController(c);
    sentences.value = { a: saved('a', 0, 1) };
    warmupOffer.value = { due: 1, here: 1 };
    act(() => render(h(App, null), root));
    const box = root.querySelector('.resume-box.warmup')!;
    expect(box.textContent).toContain('1 saved sentence is due for practice · 1 from this episode');
    act(() => [...box.querySelectorAll('button')].find((b) => b.textContent === 'Practise')!.click());
    expect(drill.value?.id).toBe('a');
    expect(root.querySelector('.resume-box.warmup')).toBeNull();
  });
});
