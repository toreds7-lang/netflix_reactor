import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app/controller';
import { setController } from '../src/app/instance';
import {
  activeIndex,
  currentIndex,
  mainTrack,
  rawCues,
  revealedLine,
  revealHeld,
  romanizations,
  settings,
  sidebarTab,
  toast,
  translations,
  videoId,
} from '../src/app/state';
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, mergeSettings } from '../src/core/settings';
import type { Cue } from '../src/core/types';
import type { SiteAdapter } from '../src/sites/adapter';
import { Overlay } from '../src/ui/Overlay';
import { menuSummary, Sidebar } from '../src/ui/Sidebar';

// Settings writes go to extension storage.
vi.stubGlobal('chrome', {
  storage: {
    local: { get: async () => ({}), set: async () => undefined },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
});

const lines: Cue[] = [
  { start: 1000, end: 2000, text: 'こんにちは' },
  { start: 3000, end: 4000, text: 'さようなら' },
];

const fake = { runAction: vi.fn(), adapter: { nowMs: () => 0 }, onSubtitlesEnter: () => undefined, onSubtitlesLeave: () => undefined };
let root: HTMLElement;

beforeEach(() => {
  setController(fake as unknown as AppController);
  settings.value = DEFAULT_SETTINGS;
  mainTrack.value = { id: 't', lang: 'ja', label: 'Japanese', kind: 'subtitles', sources: [] };
  rawCues.value = lines;
  videoId.value = 'v1';
  translations.value = ['안녕하세요', '안녕히 가세요'];
  romanizations.value = ['konnichiwa', 'sayōnara'];
  activeIndex.value = 0;
  revealedLine.value = -1;
  sidebarTab.value = 'subs';
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const show = (node: typeof Sidebar | typeof Overlay) => act(() => render(h(node, null), root));
const blurred = (sel: string) => [...root.querySelectorAll(sel)].map((e) => e.classList.contains('blur'));

describe('Blur video', () => {
  it('blurs every line on the video', () => {
    settings.value = { ...DEFAULT_SETTINGS, blurVideo: true };
    show(Overlay);
    expect(blurred('.ov-main, .ov-roman, .ov-trans')).toEqual([true, true, true]);
  });

  it('leaves the sidebar readable', () => {
    settings.value = { ...DEFAULT_SETTINGS, blurVideo: true, controlsFolded: false };
    show(Sidebar);
    expect(blurred('.list .row-trans')).toEqual([false, false]);
    expect(blurred('.list .row-main, .list .row-roman')).not.toContain(true);
  });

  it('the translation blur alone still blurs only the translation on the video', () => {
    settings.value = { ...DEFAULT_SETTINGS, blurTranslation: true };
    show(Overlay);
    expect(blurred('.ov-main, .ov-roman, .ov-trans')).toEqual([false, false, true]);
  });

  it('the chip and H toggle it, with a toast and a mention in the folded menu', () => {
    settings.value = { ...DEFAULT_SETTINGS, controlsFolded: false };
    show(Sidebar);
    const chip = [...root.querySelectorAll<HTMLButtonElement>('.chips .chip')].find((b) => b.textContent === 'Blur video')!;
    chip.click();
    expect(fake.runAction).toHaveBeenCalledWith('toggleBlurVideo');

    const c = new AppController({ nowMs: () => 0, isPaused: () => true } as unknown as SiteAdapter);
    c.runAction('toggleBlurVideo');
    expect(settings.value.blurVideo).toBe(true);
    expect(toast.value).toBe('Video blur on');
    expect(menuSummary()).toContain('Blur video');
    c.runAction('toggleBlurVideo');
    expect(settings.value.blurVideo).toBe(false);
    expect(toast.value).toBe('Video blur off');
  });

  it('shows every line on the video while the reveal key (V) is held', () => {
    settings.value = { ...DEFAULT_SETTINGS, blurVideo: true };
    revealHeld.value = false;
    const c = new AppController({ nowMs: () => 0, isPaused: () => true } as unknown as SiteAdapter);
    const keys = c as unknown as { onKeyDown(e: KeyboardEvent): void; onKeyUp(e: KeyboardEvent): void };
    const ev = (type: string, init: KeyboardEventInit) => new KeyboardEvent(type, { code: 'KeyV', cancelable: true, ...init });
    show(Overlay);
    const block = () => root.querySelector('.ov-block')!.classList;
    expect(block().contains('reveal')).toBe(false);

    const down = ev('keydown', {});
    act(() => keys.onKeyDown(down));
    expect(down.defaultPrevented).toBe(true);
    expect(block().contains('reveal')).toBe(true);
    // Auto-repeat while held changes nothing; the lines stay blurred underneath, only shown.
    act(() => keys.onKeyDown(ev('keydown', { repeat: true })));
    expect(block().contains('reveal')).toBe(true);
    expect(blurred('.ov-main, .ov-roman, .ov-trans')).toEqual([true, true, true]);
    // Letting go hides them again, even with Shift or Alt pressed meanwhile.
    act(() => keys.onKeyUp(ev('keyup', { shiftKey: true, altKey: true })));
    expect(block().contains('reveal')).toBe(false);
    expect(revealHeld.value).toBe(false);
  });

  describe('U shows the line you are on', () => {
    const controller = () => {
      const c = new AppController({ nowMs: () => 0, isPaused: () => true } as unknown as SiteAdapter);
      const keys = c as unknown as { onKeyDown(e: KeyboardEvent): void };
      return (code: string) => {
        const e = new KeyboardEvent('keydown', { code, cancelable: true });
        act(() => keys.onKeyDown(e));
        return e;
      };
    };
    const shown = () => root.querySelector('.ov-block')!.classList.contains('reveal');

    it('with its translation, until the video plays on to the next line', () => {
      settings.value = { ...DEFAULT_SETTINGS, blurVideo: true };
      const press = controller();
      show(Overlay);
      expect(shown()).toBe(false);
      expect(press('KeyU').defaultPrevented).toBe(true);
      expect(shown()).toBe(true);
      // The lines stay blurred underneath, only shown, so the next one is blurred at once.
      expect(blurred('.ov-main, .ov-roman, .ov-trans')).toEqual([true, true, true]);
      act(() => {
        activeIndex.value = 1;
      });
      expect(shown()).toBe(false);
      // U there shows that line instead, and U again blurs it.
      press('KeyU');
      expect(shown()).toBe(true);
      press('KeyU');
      expect(shown()).toBe(false);
    });

    it('stays while S repeats the line; A, D, J and L blur it again', () => {
      settings.value = { ...DEFAULT_SETTINGS, blurVideo: true };
      const press = controller();
      show(Overlay);
      press('KeyU');
      press('KeyS');
      expect(shown()).toBe(true);
      press('KeyA');
      expect(shown()).toBe(false);
      for (const code of ['KeyD', 'KeyJ', 'KeyL']) {
        press('KeyU');
        expect(shown()).toBe(true);
        press(code);
        expect(shown()).toBe(false);
      }
    });

    it('between lines, the last line shown; turning Blur video off and on blurs it again', () => {
      settings.value = { ...DEFAULT_SETTINGS, blurVideo: true };
      const press = controller();
      activeIndex.value = -1;
      currentIndex.value = 1;
      press('KeyU');
      expect(revealedLine.value).toBe(1);
      press('KeyH');
      press('KeyH');
      expect(settings.value.blurVideo).toBe(true);
      expect(revealedLine.value).toBe(-1);
    });

    it('says so when nothing is blurred', () => {
      const press = controller();
      press('KeyU');
      expect(revealedLine.value).toBe(-1);
      expect(toast.value).toBe('Nothing is blurred · H blurs the video');
    });

    it("doesn't take U from shortcuts saved before it existed", () => {
      const { revealLine: _, ...before } = DEFAULT_SHORTCUTS;
      expect(mergeSettings({ shortcuts: { ...before } as typeof DEFAULT_SHORTCUTS }).shortcuts.revealLine).toBe('KeyU');
      const rebound = { ...before, bookmark: 'KeyU' } as typeof DEFAULT_SHORTCUTS;
      expect(mergeSettings({ shortcuts: rebound }).shortcuts).toMatchObject({ revealLine: '', bookmark: 'KeyU' });
    });
  });

  it("the reveal key doesn't take V from shortcuts saved before it existed", () => {
    const { holdReveal: _, ...before } = DEFAULT_SHORTCUTS;
    expect(mergeSettings({ shortcuts: { ...before } as typeof DEFAULT_SHORTCUTS }).shortcuts.holdReveal).toBe('KeyV');
    const rebound = { ...before, toggleSidebar: 'KeyV' } as typeof DEFAULT_SHORTCUTS;
    expect(mergeSettings({ shortcuts: rebound }).shortcuts).toMatchObject({ holdReveal: '', toggleSidebar: 'KeyV' });
    // Once saved, the user's own choice stays.
    expect(mergeSettings({ shortcuts: { ...rebound, holdReveal: 'KeyG' } }).shortcuts.holdReveal).toBe('KeyG');
  });
});
