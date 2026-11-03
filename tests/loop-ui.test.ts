import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteLoop, saveLoop } from '../src/bookmarks/store';
import { AppController } from '../src/app/controller';
import { setController } from '../src/app/instance';
import {
  activeIndex,
  bookmarks,
  cues,
  loop,
  loopStart,
  mainTrack,
  paused,
  rawCues,
  settings,
  sidebarTab,
  toast,
  videoId,
} from '../src/app/state';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import type { Cue, LineMark, SavedLoop } from '../src/core/types';
import type { SiteAdapter } from '../src/sites/adapter';
import { Overlay } from '../src/ui/Overlay';
import { Sidebar } from '../src/ui/Sidebar';

vi.mock('../src/bookmarks/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/bookmarks/store')>()),
  saveLoop: vi.fn(async () => ({})),
  deleteLoop: vi.fn(async () => ({})),
}));

// Settings writes go to extension storage.
vi.stubGlobal('chrome', {
  storage: {
    local: { get: async () => ({}), set: async () => undefined },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
});

const lines: Cue[] = [
  { start: 1000, end: 2000, text: 'one' },
  { start: 3000, end: 4000, text: 'two' },
  { start: 4000, end: 6000, text: 'three' },
];
const mark = (timeMs: number, text: string): LineMark => ({ timeMs, text, lang: 'en' });
const savedLoop = (from: number, to: number, createdAt = 1): SavedLoop => ({
  from: mark(lines[from].start, lines[from].text),
  to: mark(lines[to].start, lines[to].text),
  createdAt,
});

beforeEach(() => {
  settings.value = DEFAULT_SETTINGS;
  mainTrack.value = { id: 't', lang: 'en', label: 'English', kind: 'subtitles', sources: [] };
  rawCues.value = lines;
  videoId.value = 'v1';
  bookmarks.value = {};
  loop.value = null;
  loopStart.value = null;
  activeIndex.value = -1;
  paused.value = true;
  sidebarTab.value = 'subs';
});
afterEach(() => vi.clearAllMocks());

describe('AppController loops', () => {
  function setup() {
    const adapter = {
      t: 0,
      paused: false,
      nowMs: () => adapter.t,
      isPaused: () => adapter.paused,
      seek: vi.fn(async (ms: number) => void (adapter.t = ms)),
      play: vi.fn(async () => void (adapter.paused = false)),
      pause: vi.fn(async () => void (adapter.paused = true)),
    };
    const c = new AppController(adapter as unknown as SiteAdapter);
    c.playback.setCues(cues.value);
    const at = (t: number) => {
      adapter.t = t;
      c.playback.tick();
    };
    return { c, adapter, at };
  }

  it('R marks the first line, R on the last line loops it (letting that line finish), R again stops', () => {
    const { c, adapter, at } = setup();
    at(1500);
    c.runAction('loop');
    expect(loopStart.value).toBe(0);
    expect(toast.value).toContain('press R on the last line');
    at(3500);
    c.runAction('loop');
    expect(loop.value).toEqual({ from: 0, to: 1, pass: 1, gap: false });
    expect(loopStart.value).toBeNull();
    expect(adapter.seek).not.toHaveBeenCalled();
    expect(toast.value).toContain('Looping 2 lines');
    c.runAction('loop');
    expect(loop.value).toBeNull();
    expect(toast.value).toBe('Loop off');
  });

  it('from the sidebar, starts at the first line: 🔁 twice, or Shift+click from the line playing now', () => {
    const { c, adapter, at } = setup();
    at(1500);
    c.pickLoopLine(2, false);
    expect(loopStart.value).toBe(2);
    c.pickLoopLine(1, false);
    expect(loop.value).toMatchObject({ from: 1, to: 2 });
    expect(adapter.seek).toHaveBeenLastCalledWith(3001);

    c.stopLoop();
    at(1500);
    c.loopTo(2);
    expect(loop.value).toMatchObject({ from: 0, to: 2 });
    expect(adapter.seek).toHaveBeenLastCalledWith(1001);
    // While looping, Shift+click moves the last line.
    c.loopTo(1);
    expect(loop.value).toMatchObject({ from: 0, to: 1 });
  });

  it('Esc stops the loop, or the loop being picked', () => {
    const { c, at } = setup();
    const esc = () => (c as unknown as { onKeyDown(e: KeyboardEvent): void }).onKeyDown(new KeyboardEvent('keydown', { code: 'Escape' }));
    c.startLoop(0, 1, true);
    esc();
    expect(loop.value).toBeNull();
    at(1500);
    c.runAction('loop');
    esc();
    expect(loopStart.value).toBeNull();
  });

  it('says when the passes are done', () => {
    const { c, at } = setup();
    c.playback.loopConfig = { count: 1, gap: false };
    c.startLoop(0, 0, true);
    at(1100);
    at(1950);
    expect(loop.value).toBeNull();
    expect(toast.value).toBe('🔁 Done · 1 pass');
  });

  it('saves the loop once', () => {
    const { c } = setup();
    c.startLoop(0, 1, true);
    c.saveCurrentLoop();
    expect(saveLoop).toHaveBeenCalledWith('v1', { ...savedLoop(0, 1), createdAt: expect.any(Number) }, undefined);
    bookmarks.value = { v1: { videoId: 'v1', updatedAt: 0, loops: [savedLoop(0, 1)] } };
    c.saveCurrentLoop();
    expect(saveLoop).toHaveBeenCalledOnce();
    expect(toast.value).toBe('This loop is already saved');
  });

  it('plays and deletes saved loops', () => {
    const { c, adapter } = setup();
    c.playSavedLoop(savedLoop(1, 2));
    expect(loop.value).toMatchObject({ from: 1, to: 2, pass: 1 });
    expect(adapter.seek).toHaveBeenLastCalledWith(3001);
    c.deleteSavedLoop(savedLoop(1, 2));
    expect(deleteLoop).toHaveBeenCalledWith('v1', savedLoop(1, 2));
  });
});

describe('loop UI', () => {
  const fake = {
    loopTo: vi.fn(),
    pickLoopLine: vi.fn(),
    stopLoop: vi.fn(),
    saveCurrentLoop: vi.fn(),
    playSavedLoop: vi.fn(),
    deleteSavedLoop: vi.fn(),
    runAction: vi.fn(),
    playback: { goTo: vi.fn() },
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

  const show = (node: typeof Sidebar | typeof Overlay) => act(() => render(h(node, null), root));
  const set = (fn: () => void) => act(fn);
  const rows = () => [...root.querySelectorAll<HTMLElement>('.list .row')];
  const chip = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('.loopbar .chip')].find((b) => b.textContent === label)!;

  it('marks the first line of a loop being picked, then the looped lines', () => {
    loopStart.value = 0;
    show(Sidebar);
    expect(rows().map((r) => r.classList.contains('loop-start'))).toEqual([true, false, false]);
    expect(root.querySelector('.loopbar .lb-text')?.textContent).toContain('From 0:01');

    set(() => {
      loopStart.value = null;
      loop.value = { from: 1, to: 2, pass: 1, gap: false };
    });
    expect(rows().map((r) => r.classList.contains('in-loop'))).toEqual([false, true, true]);
  });

  it('shows the lines, the pass and the speaking gap, and changes the loop settings', () => {
    settings.value = { ...DEFAULT_SETTINGS, loopCount: 3 };
    loop.value = { from: 0, to: 1, pass: 2, gap: false };
    show(Sidebar);
    expect(root.querySelector('.lb-text')?.textContent).toBe('🔁 0:01–0:04 · 2 lines');
    expect(root.querySelector('.lb-pass')?.textContent).toBe('Pass 2/3');
    set(() => void (loop.value = { from: 0, to: 1, pass: 2, gap: true }));
    expect(root.querySelector('.lb-pass')?.textContent).toBe('🗣 Your turn');

    act(() => chip('∞').click());
    expect(settings.value.loopCount).toBe(0);
    act(() => chip('🗣 Gap').click());
    act(() => chip('🙈 Hide text').click());
    expect(settings.value).toMatchObject({ loopGap: true, loopHideText: true });
  });

  it('Shift+click on a line (or a word in it) loops to it, a click plays it, and 🔁 picks a loop line', () => {
    show(Sidebar);
    rows()[2].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(fake.loopTo).toHaveBeenCalledWith(2);
    rows()[1].querySelector<HTMLElement>('.w')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true }));
    expect(fake.loopTo).toHaveBeenLastCalledWith(1);
    rows()[1].click();
    expect(fake.playback.goTo).toHaveBeenCalledWith(1);
    rows()[0].querySelector<HTMLButtonElement>('.loop-btn')!.click();
    expect(fake.pickLoopLine).toHaveBeenCalledWith(0, false);
    expect(fake.playback.goTo).toHaveBeenCalledOnce();
  });

  it('blurs the looped lines from the second pass when Hide text is on', () => {
    settings.value = { ...DEFAULT_SETTINGS, loopHideText: true };
    loop.value = { from: 1, to: 2, pass: 1, gap: false };
    show(Sidebar);
    expect(root.querySelectorAll('.row.peek')).toHaveLength(0);
    set(() => void (loop.value = { from: 1, to: 2, pass: 2, gap: false }));
    expect(rows().map((r) => r.classList.contains('peek'))).toEqual([false, true, true]);
  });

  it('shows when the loop is already saved', () => {
    loop.value = { from: 0, to: 1, pass: 1, gap: false };
    show(Sidebar);
    const save = () => root.querySelector<HTMLButtonElement>('.loopbar .lb-head button')!;
    expect(save().textContent).toBe('💾');
    save().click();
    expect(fake.saveCurrentLoop).toHaveBeenCalledOnce();
    set(() => void (bookmarks.value = { v1: { videoId: 'v1', updatedAt: 0, loops: [savedLoop(0, 1)] } }));
    expect(save().textContent).toBe('✓');
    expect(save().disabled).toBe(true);
  });

  it('lists saved loops in the Loops tab; a click loops one, 🗑 deletes it', () => {
    sidebarTab.value = 'loops';
    show(Sidebar);
    expect(root.querySelector('.list-empty')?.textContent).toContain('No saved loops yet');

    const a = savedLoop(0, 1, 1);
    const b = savedLoop(2, 2, 2);
    set(() => void (bookmarks.value = { v1: { videoId: 'v1', updatedAt: 0, loops: [a, b] } }));
    expect([...root.querySelectorAll('.tabs button')].map((t) => t.textContent)).toContain('Loops (2)');
    const items = [...root.querySelectorAll<HTMLElement>('.loop-item')];
    expect(items.map((i) => i.querySelector('.loop-time')?.textContent)).toEqual(['🔁 0:01–0:04 · 2 lines', '🔁 0:04–0:06 · 1 line']);
    expect(items[0].textContent).toContain('… two');

    items[0].click();
    expect(fake.playSavedLoop).toHaveBeenCalledWith(a);
    items[1].querySelector('button')!.click();
    expect(fake.deleteSavedLoop).toHaveBeenCalledWith(b);
    expect(fake.playSavedLoop).toHaveBeenCalledOnce();

    set(() => void (loop.value = { from: 2, to: 2, pass: 1, gap: false }));
    expect([...root.querySelectorAll('.loop-item')].map((i) => i.classList.contains('current'))).toEqual([false, true]);
  });

  it('on the video: the pass, the speaking gap, blurred text on repeats, and the badge between lines', () => {
    settings.value = { ...DEFAULT_SETTINGS, loopCount: 3, loopHideText: true };
    loop.value = { from: 0, to: 1, pass: 2, gap: false };
    activeIndex.value = 1;
    show(Overlay);
    expect(root.querySelector('.ov-loop')?.textContent).toBe('🔁 2/3 · listen');
    expect(root.querySelector('.ov-main')?.classList.contains('peek')).toBe(true);

    set(() => void (loop.value = { from: 0, to: 1, pass: 2, gap: true }));
    expect(root.querySelector('.ov-loop')?.textContent).toBe('🗣 Your turn');

    // Playing, between two lines (paused, the last line would stay on screen).
    set(() => {
      loop.value = { from: 0, to: 1, pass: 1, gap: false };
      activeIndex.value = -1;
      paused.value = false;
    });
    expect(root.querySelector('.ov-main')).toBeNull();
    expect(root.querySelector('.ov-loop')?.textContent).toBe('🔁 1/3');

    set(() => {
      loop.value = null;
      loopStart.value = 0;
    });
    expect(root.querySelector('.ov-loop')?.textContent).toBe('🔁 From 0:01 · R on the last line');
  });
});
