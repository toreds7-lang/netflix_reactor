import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app/controller';
import { setController } from '../src/app/instance';
import { activeIndex, cues, keyLines, loop, mainTrack, paused, rawCues, settings, toast, translationMode, videoId } from '../src/app/state';
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, mergeSettings } from '../src/core/settings';
import type { Cue, KeyLinesResult } from '../src/core/types';
import type { SiteAdapter } from '../src/sites/adapter';
import { Overlay } from '../src/ui/Overlay';
import { Sidebar } from '../src/ui/Sidebar';

// Settings writes go to extension storage.
vi.stubGlobal('chrome', {
  storage: {
    local: { get: async () => ({}), set: async () => undefined },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
});

// Sentences: 0 = lines 0-1, 1 = line 2, 2 = lines 3-4, 3 = line 5, 4 = line 6.
const lines: Cue[] = [
  { start: 1000, end: 2000, text: 'So, I know this is a big ask,\nbut is there any way' },
  { start: 2100, end: 3000, text: 'I could stay at your place\njust for the night?' },
  { start: 5000, end: 6000, text: 'Bye.' },
  { start: 8000, end: 9000, text: "He's been getting $1,000 a month" },
  { start: 9100, end: 10_000, text: 'for the last five years\nfrom this company called REH Holdings.' },
  { start: 14_000, end: 15_000, text: 'The payments started the month\nthat Burroughs arrived at Briggs.' },
  { start: 17_000, end: 18_000, text: 'Home.' },
];

/** 🎤 sentences 0 and 4 (lines 0, 1 and 6), 📖 sentences 2 and 3 (lines 3, 4 and 5). */
const data = {
  shadow: [[0, 4], [], []],
  story: [[2, 3], [], []],
  model: 'claude-opus-5-5',
  level: 'B1',
  cached: true,
  current: true,
  adapted: false,
  createdAt: 0,
} as unknown as KeyLinesResult;

beforeEach(() => {
  settings.value = DEFAULT_SETTINGS;
  mainTrack.value = { id: 't', lang: 'en', label: 'English', kind: 'subtitles', sources: [] };
  rawCues.value = lines;
  videoId.value = 'v1';
  translationMode.value = 'none';
  keyLines.value = { status: 'ready', data };
  loop.value = null;
  activeIndex.value = 1;
  paused.value = false;
  toast.value = null;
});
afterEach(() => vi.clearAllMocks());

describe('J / L', () => {
  function setup(t: number) {
    const adapter = {
      t,
      paused: false,
      nowMs: () => adapter.t,
      isPaused: () => adapter.paused,
      seek: vi.fn(async (ms: number) => void (adapter.t = ms)),
      play: vi.fn(async () => void (adapter.paused = false)),
      pause: vi.fn(async () => void (adapter.paused = true)),
    };
    const c = new AppController(adapter as unknown as SiteAdapter);
    c.playback.setCues(cues.value);
    return { c, adapter };
  }

  it('L stops at every marked line, the second line of a two-line sentence too', () => {
    const { c, adapter } = setup(8000);
    c.playback.autoPause = true;
    // Auto-pause stops at the end of "He's been getting $1,000 a month".
    for (; !adapter.paused && adapter.t < 9100; adapter.t += 50) c.playback.tick();
    expect(adapter.paused).toBe(true);
    c.runAction('nextKeyLine');
    expect(adapter.seek).toHaveBeenLastCalledWith(9101);
    expect(adapter.play).toHaveBeenCalled();
  });

  it('follows the Both / 🎤 / 📖 chips', () => {
    settings.value = { ...DEFAULT_SETTINGS, keyView: 'shadow' };
    const { c, adapter } = setup(2500);
    c.runAction('nextKeyLine');
    expect(adapter.seek).toHaveBeenLastCalledWith(17_001);
    settings.value = { ...DEFAULT_SETTINGS, keyView: 'story' };
    c.playback.tick(); // the seek lands
    adapter.t = 2500;
    c.playback.tick();
    c.runAction('nextKeyLine');
    expect(adapter.seek).toHaveBeenLastCalledWith(8001);
  });

  it('J goes to the previous marked line', () => {
    const { c, adapter } = setup(14_500);
    c.runAction('prevKeyLine');
    expect(adapter.seek).toHaveBeenLastCalledWith(9101);
    c.playback.tick(); // the seek lands
    adapter.t = 2500;
    c.playback.tick();
    c.runAction('prevKeyLine');
    expect(adapter.seek).toHaveBeenLastCalledWith(1001);
    c.playback.tick();
    c.runAction('prevKeyLine');
    expect(adapter.seek).toHaveBeenCalledTimes(2);
    expect(toast.value).toBe('No previous key line');
  });

  it('says when there is no next one in the chosen list', () => {
    settings.value = { ...DEFAULT_SETTINGS, keyView: 'story' };
    const { c, adapter } = setup(14_500);
    c.runAction('nextKeyLine');
    expect(adapter.seek).not.toHaveBeenCalled();
    expect(toast.value).toBe('No next 📖 line');
  });

  it('pressed again, goes on to the one after', () => {
    const { c, adapter } = setup(500);
    for (let k = 0; k < 4; k++) {
      c.runAction('nextKeyLine');
      c.playback.tick(); // the seek lands
    }
    expect(adapter.seek.mock.calls.map(([ms]) => ms)).toEqual([1001, 2101, 8001, 9101]);
  });

  it('without key lines, says how to get them', () => {
    keyLines.value = { status: 'idle' };
    const { c, adapter } = setup(1500);
    c.runAction('nextKeyLine');
    expect(adapter.seek).not.toHaveBeenCalled();
    expect(toast.value).toContain('Find key lines');
  });

  it('keys: J / L step key lines and keep going while held, K repeats like S, and A / D go line by line even with Shift', () => {
    const { c, adapter } = setup(500);
    const press = (code: string, init: KeyboardEventInit = {}) => {
      (c as unknown as { onKeyDown(e: KeyboardEvent): void }).onKeyDown(new KeyboardEvent('keydown', { code, cancelable: true, ...init }));
      c.playback.tick(); // the seek lands
    };
    press('KeyL');
    press('KeyL', { repeat: true });
    press('KeyL', { repeat: true });
    expect(adapter.seek.mock.calls.map(([ms]) => ms)).toEqual([1001, 2101, 8001]);
    press('KeyJ', { repeat: true });
    expect(adapter.seek).toHaveBeenLastCalledWith(2101);
    press('KeyK');
    expect(adapter.seek).toHaveBeenLastCalledWith(2101);
    press('KeyD', { shiftKey: true });
    expect(adapter.seek).toHaveBeenLastCalledWith(5001);
    press('KeyA', { shiftKey: true });
    expect(adapter.seek).toHaveBeenLastCalledWith(2101);
    expect(adapter.seek).toHaveBeenCalledTimes(7);
  });

  it('shortcuts saved before J / K / L existed get them, though Alt+L is the on / off switch', () => {
    const { prevKeyLine: _p, repeatLine2: _r, nextKeyLine: _n, ...before } = DEFAULT_SHORTCUTS;
    expect(mergeSettings({ shortcuts: before as typeof DEFAULT_SHORTCUTS }).shortcuts).toMatchObject({
      prevKeyLine: 'KeyJ',
      repeatLine2: 'KeyK',
      nextKeyLine: 'KeyL',
      toggleExtension: 'KeyL',
    });
    // A plain key you already use for something else stays yours.
    const rebound = { ...before, bookmark: 'KeyK' } as typeof DEFAULT_SHORTCUTS;
    expect(mergeSettings({ shortcuts: rebound }).shortcuts).toMatchObject({ repeatLine2: '', bookmark: 'KeyK' });
  });
});

describe('‹ › buttons', () => {
  const fake = {
    stepKeyLine: vi.fn(),
    repeatShown: vi.fn(),
    adapter: { nowMs: () => 0 },
    onSubtitlesEnter: () => undefined,
    onSubtitlesLeave: () => undefined,
  };
  let root: HTMLElement;

  beforeEach(() => {
    setController(fake as unknown as AppController);
    root = document.createElement('div');
    document.body.append(root);
  });
  afterEach(() => {
    render(null, root);
    root.remove();
  });

  const steps = () => [...root.querySelectorAll<HTMLButtonElement>('.ov-step')];

  it('on the video: ‹ left of the line, › right of the ↺ and ☆, showing the chosen list', () => {
    act(() => render(h(Overlay, null), root));
    const [prev, next] = steps();
    expect(prev.classList.contains('prev')).toBe(true);
    expect(prev.nextElementSibling!.classList.contains('ov-main')).toBe(true);
    expect(next.previousElementSibling!.classList.contains('ov-star')).toBe(true);
    expect(next.previousElementSibling!.previousElementSibling!.classList.contains('ov-repeat')).toBe(true);
    expect(prev.textContent).toBe('‹ 🎤📖');
    expect(next.textContent).toBe('🎤📖 ›');
    expect(next.title).toBe('Next 🎤📖 line (L)');
    act(() => void (settings.value = { ...DEFAULT_SETTINGS, keyView: 'shadow' }));
    expect(steps()[0].textContent).toBe('‹ 🎤');
  });

  it("on the video: click steps without taking focus or reaching Netflix", () => {
    act(() => render(h(Overlay, null), root));
    const outside = vi.fn();
    root.addEventListener('mousedown', outside);
    root.addEventListener('click', outside);
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    steps()[1].dispatchEvent(down);
    steps()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    steps()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(down.defaultPrevented).toBe(true);
    expect(outside).not.toHaveBeenCalled();
    expect(fake.stepKeyLine.mock.calls).toEqual([[1], [-1]]);
  });

  it('on the video: only with key lines, and the ↺ on video setting hides them too', () => {
    keyLines.value = { status: 'idle' };
    act(() => render(h(Overlay, null), root));
    expect(steps()).toHaveLength(0);
    expect(root.querySelector('.ov-repeat')).not.toBeNull();
    act(() => void (keyLines.value = { status: 'ready', data }));
    expect(steps()).toHaveLength(2);
    act(() => void (settings.value = { ...DEFAULT_SETTINGS, overlayRepeat: false }));
    expect(steps()).toHaveLength(0);
  });

  it('in the Key lines bar, next to the sentence counts', () => {
    settings.value = { ...DEFAULT_SETTINGS, controlsFolded: false };
    act(() => render(h(Sidebar, null), root));
    const bar = root.querySelector('.kl-count')!;
    expect(bar.textContent).toContain('🎤 2 · 📖 2 of 5 sentences');
    const [prev, next] = bar.querySelectorAll<HTMLButtonElement>('.keystep button');
    act(() => next.click());
    act(() => prev.click());
    expect(fake.stepKeyLine.mock.calls).toEqual([[1], [-1]]);
  });
});
