import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app/controller';
import { setController } from '../src/app/instance';
import { activeIndex, cues, keyLines, loop, loopStart, mainTrack, paused, rawCues, settings, toast, videoId } from '../src/app/state';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import type { Cue, KeyLinesResult } from '../src/core/types';
import type { SiteAdapter } from '../src/sites/adapter';
import { Overlay } from '../src/ui/Overlay';

// Settings writes go to extension storage.
vi.stubGlobal('chrome', {
  storage: {
    local: { get: async () => ({}), set: async () => undefined },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
});

const lines: Cue[] = [
  { start: 1000, end: 2000, text: 'I wanted to say' },
  { start: 2100, end: 3000, text: 'that I missed you.' },
  { start: 5000, end: 6000, text: 'Bye.' },
];

beforeEach(() => {
  settings.value = DEFAULT_SETTINGS;
  mainTrack.value = { id: 't', lang: 'en', label: 'English', kind: 'subtitles', sources: [] };
  rawCues.value = lines;
  videoId.value = 'v1';
  keyLines.value = { status: 'idle' };
  loop.value = null;
  loopStart.value = null;
  activeIndex.value = 1;
  paused.value = false;
});
afterEach(() => vi.clearAllMocks());

describe('AppController.repeatShown', () => {
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
    return { c, adapter };
  }

  it('replays the line shown, from its start', () => {
    const { c, adapter } = setup();
    adapter.t = 5500;
    c.repeatShown(1, false);
    expect(adapter.seek).toHaveBeenLastCalledWith(2101);
    expect(adapter.play).toHaveBeenCalled();
    expect(loop.value).toBeNull();
  });

  it('with Shift loops the line, and Shift again stops that loop', () => {
    const { c, adapter } = setup();
    c.repeatShown(1, true);
    expect(loop.value).toEqual({ from: 1, to: 1, pass: 1, gap: false });
    expect(adapter.seek).toHaveBeenLastCalledWith(2101);
    expect(toast.value).toContain('Looping 1 line');
    c.repeatShown(1, true);
    expect(loop.value).toBeNull();
    expect(toast.value).toBe('Loop off');
  });

  it('with Shift on a line inside a longer loop, loops just that line', () => {
    const { c } = setup();
    c.startLoop(0, 2, true);
    c.repeatShown(1, true);
    expect(loop.value).toMatchObject({ from: 1, to: 1 });
  });

  it("leaving the subtitles after the replay doesn't play on past the line's auto-pause", () => {
    const { c, adapter } = setup();
    c.onSubtitlesEnter();
    expect(adapter.pause).toHaveBeenCalled();
    c.repeatShown(1, false);
    adapter.paused = true; // auto-paused at the line's end
    adapter.play.mockClear();
    c.onSubtitlesLeave();
    expect(adapter.play).not.toHaveBeenCalled();
  });

  it('in shadow mode replays the whole 🎤 sentence, like the repeat key', () => {
    const { c, adapter } = setup();
    settings.value = { ...DEFAULT_SETTINGS, shadowMode: true };
    keyLines.value = { status: 'ready', data: { shadow: [[0]], story: [[]] } as unknown as KeyLinesResult };
    c.repeatShown(1, false);
    expect(adapter.seek).toHaveBeenLastCalledWith(1001);
  });
});

describe('↺ on the video', () => {
  const fake = { repeatShown: vi.fn(), adapter: { nowMs: () => 0 }, onSubtitlesEnter: () => undefined, onSubtitlesLeave: () => undefined };
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

  const show = () => act(() => render(h(Overlay, null), root));
  const button = () => root.querySelector<HTMLButtonElement>('.ov-repeat');
  const click = (shiftKey = false) => button()!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey }));

  it('sits right of the line, outside its box, so it is never blurred with the text', () => {
    settings.value = { ...DEFAULT_SETTINGS, blurVideo: true };
    show();
    expect(button()).not.toBeNull();
    expect(button()!.parentElement!.classList.contains('ov-line')).toBe(true);
    expect(button()!.closest('.blur')).toBeNull();
    expect(button()!.previousElementSibling!.classList.contains('ov-main')).toBe(true);
  });

  it('click replays the line shown; Shift+click loops it', () => {
    show();
    click();
    expect(fake.repeatShown).toHaveBeenLastCalledWith(1, false);
    click(true);
    expect(fake.repeatShown).toHaveBeenLastCalledWith(1, true);
  });

  it("doesn't take focus or let the click through to Netflix", () => {
    show();
    const outside = vi.fn();
    root.addEventListener('mousedown', outside);
    root.addEventListener('click', outside);
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    button()!.dispatchEvent(down);
    click();
    expect(down.defaultPrevented).toBe(true);
    expect(outside).not.toHaveBeenCalled();
  });

  it('shows when the line is looping, and says Shift+click stops it', () => {
    loop.value = { from: 1, to: 1, pass: 2, gap: false };
    show();
    expect(button()!.classList.contains('looping')).toBe(true);
    expect(button()!.title).toContain('stop looping');
    act(() => void (loop.value = { from: 0, to: 2, pass: 1, gap: false }));
    expect(button()!.classList.contains('looping')).toBe(false);
  });

  it('the setting hides it', () => {
    settings.value = { ...DEFAULT_SETTINGS, overlayRepeat: false };
    show();
    expect(button()).toBeNull();
    expect(root.querySelector('.ov-main')!.textContent).toContain('that I missed you.');
  });
});
