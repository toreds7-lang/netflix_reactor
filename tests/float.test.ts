import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app/controller';
import { setController } from '../src/app/instance';
import {
  activeIndex,
  currentIndex,
  floatWin,
  mainTrack,
  playClock,
  popup,
  rawCues,
  revealedLine,
  revealHeld,
  settings,
  sidebarOnPage,
  toast,
  translations,
  videoId,
} from '../src/app/state';
import type { Envelope } from '../src/core/messages';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import type { Cue } from '../src/core/types';
import type { SiteAdapter } from '../src/sites/adapter';
import { App } from '../src/ui/App';
import { FloatApp } from '../src/ui/Float';

/** Messages to the background, and what it answers to floatExists. */
const sent: Envelope[] = [];
let windowStillOpen = false;

vi.stubGlobal('chrome', {
  storage: {
    local: { get: async () => ({}), set: async () => undefined },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
  runtime: {
    id: 'test',
    sendMessage: async (msg: Envelope) => {
      sent.push(msg);
      return { ok: true, data: msg.type === 'floatExists' ? windowStillOpen : undefined };
    },
  },
});

const lines: Cue[] = [
  { start: 1000, end: 2000, text: 'Hello there.' },
  { start: 3000, end: 4000, text: 'General Kenobi.' },
  { start: 5000, end: 6000, text: 'You are a bold one.' },
];

/** Stands in for the popup window: its own document, events and close(). */
function fakePopup() {
  const target = new EventTarget();
  const win = Object.assign(target, {
    document: document.implementation.createHTMLDocument('popup'),
    innerWidth: 1600,
    innerHeight: 900,
    closed: false,
    navigator,
    close() {
      if (win.closed) return;
      win.closed = true;
      target.dispatchEvent(new Event('pagehide'));
    },
  });
  return win;
}

let pip: ReturnType<typeof fakePopup>;
let open: ReturnType<typeof vi.spyOn>;
let adapter: Record<string, ReturnType<typeof vi.fn>>;
let c: AppController;

function makeController() {
  adapter = {
    nowMs: vi.fn(() => 5000),
    isPaused: vi.fn(() => true),
    play: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    seek: vi.fn(async () => undefined),
  };
  c = new AppController(adapter as unknown as SiteAdapter);
  setController(c);
  c.setFloatUi({ css: '.x{}', render: (r) => render(h(FloatApp, null), r), unmount: (r) => render(null, r) });
  return c;
}

const flush = () => act(async () => await new Promise((r) => setTimeout(r, 0)));
const floatRoot = () => pip.document.querySelector<HTMLElement>('.plg-root.float')!;
const key = (code: string, init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { code, cancelable: true, ...init });
type Handlers = { onKeyDown(e: KeyboardEvent): void; onFloatKeyDown(e: KeyboardEvent): void };
const handlers = () => c as unknown as Handlers;
const types = () => sent.map((m) => m.type);

async function openFloat() {
  c.openFloat();
  await flush();
}

beforeEach(() => {
  settings.value = DEFAULT_SETTINGS;
  mainTrack.value = { id: 't', lang: 'en', label: 'English', kind: 'subtitles', sources: [] };
  rawCues.value = lines;
  videoId.value = 'v1';
  translations.value = ['안녕하세요.', '케노비 장군.', '대담하군.'];
  activeIndex.value = 0;
  currentIndex.value = 0;
  revealedLine.value = -1;
  popup.value = null;
  floatWin.value = null;
  playClock.value = { now: 0, duration: 0 };
  sent.length = 0;
  windowStillOpen = false;
  pip = fakePopup();
  open = vi.spyOn(window, 'open').mockImplementation(() => pip as unknown as Window);
  makeController();
});

afterEach(() => {
  floatWin.peek()?.close();
  floatWin.value = null;
  open.mockRestore();
});

describe('floating sidebar window', () => {
  it('opens a popup named for the tab and asks the background to fill the other monitor with it', async () => {
    await openFloat();
    expect(open).toHaveBeenCalledTimes(1);
    const [url, name, features] = open.mock.calls[0];
    expect(url).toBe('');
    expect(name).toMatch(/^polyglot-float-/);
    expect(features).toContain('popup');
    expect(sent.find((m) => m.type === 'floatPlace')?.payload).toEqual({ fullscreen: true, netflixFullscreen: false });
    expect(settings.value.floating).toBe(true);
    expect(floatWin.value).toBe(pip);
    expect(sidebarOnPage.value).toBe(false);
    expect(pip.document.head.querySelector('style')!.textContent).toContain('.x{}');
  });

  it('says so when the popup blocker stops it', async () => {
    open.mockImplementation(() => null);
    await openFloat();
    expect(floatWin.value).toBeNull();
    expect(settings.value.floating).toBe(false);
    expect(toast.value).toContain('blocked');
    expect(types()).not.toContain('floatPlace');
  });

  it('shows the big line with the lines around it, a seek bar and play controls next to the sidebar panel', async () => {
    const host = document.createElement('div');
    act(() => render(h(App, null), host));
    expect(host.querySelector('.sidebar')).not.toBeNull();

    await openFloat();
    const root = floatRoot();
    expect(root.querySelector('.sidebar.floating')).not.toBeNull();
    const stage = root.querySelector('.fl-stage')!;
    expect(stage.querySelector('.bl-main')!.textContent).toBe('Hello there.');
    expect(stage.querySelector('.bl-trans')!.textContent).toBe('안녕하세요.');
    const ctx = stage.querySelectorAll('.bl-ctx');
    expect(ctx).toHaveLength(2);
    expect(ctx[0].textContent).toBe(''); // nothing before the first line
    expect(ctx[1].textContent).toBe('General Kenobi.');
    expect(stage.querySelector('.playbar')).not.toBeNull();
    // Speed moves to the play bar; the panel's menu bar keeps only the subtitle size.
    expect(stage.querySelectorAll('.playbar .stepper')).toHaveLength(1);
    const panel = root.querySelector('.fl-panel')!;
    expect(panel.querySelectorAll('.controls .stepper')).toHaveLength(1);
    expect(panel.querySelector('.tabs')).not.toBeNull();

    // The page loses its sidebar, and needs no tab while the window is open.
    act(() => render(h(App, null), host));
    expect(host.querySelector('.sidebar')).toBeNull();
    expect(host.querySelector('.sb-handle')).toBeNull();
    act(() => render(null, host));
  });

  it('follows the line being played, dims it between lines, and plays a neighbouring line on click', async () => {
    await openFloat();
    act(() => {
      activeIndex.value = 1;
      currentIndex.value = 1;
    });
    const ctx = floatRoot().querySelectorAll<HTMLButtonElement>('.bl-ctx');
    expect([...ctx].map((b) => b.textContent)).toEqual(['Hello there.', 'You are a bold one.']);
    act(() => {
      activeIndex.value = -1;
    });
    expect(floatRoot().querySelector('.big-line')!.classList.contains('idle')).toBe(true);
    const goTo = vi.spyOn(c.playback, 'goTo').mockImplementation(() => undefined);
    act(() => floatRoot().querySelectorAll<HTMLButtonElement>('.bl-ctx')[1].click());
    expect(goTo).toHaveBeenCalledWith(2);
  });

  it('has a seek bar that jumps where you click and marks the loop', async () => {
    await openFloat();
    expect(floatRoot().querySelector('.seekbar')).toBeNull(); // no length known yet
    act(() => {
      playClock.value = { now: 600_000, duration: 2_400_000 };
    });
    const track = floatRoot().querySelector<HTMLElement>('.sk-track')!;
    expect(floatRoot().querySelector<HTMLElement>('.sk-fill')!.style.width).toBe('25%');
    expect([...floatRoot().querySelectorAll('.sk-time')].map((t) => t.textContent)).toEqual(['10:00', '−30:00']);
    track.getBoundingClientRect = () => new DOMRect(100, 0, 400, 18);
    act(() => {
      track.dispatchEvent(new MouseEvent('click', { clientX: 400, bubbles: true }));
    });
    expect(adapter.seek).toHaveBeenCalledWith(1_800_000);
  });

  it('scales its text and switches between fullscreen and maximized', async () => {
    await openFloat();
    const sidebar = () => floatRoot().querySelector<HTMLElement>('.sidebar.floating')!;
    const stepper = () => floatRoot().querySelectorAll<HTMLButtonElement>('.text-size button');
    act(() => stepper()[1].click());
    act(() => stepper()[1].click());
    expect(settings.value.floatTextScale).toBe(1.2);
    expect(sidebar().style.getPropertyValue('--fl-scale')).toBe('1.2');
    act(() => floatRoot().querySelector<HTMLButtonElement>('button[title^="Leave fullscreen"]')!.click());
    await flush();
    expect(settings.value.floatFullscreen).toBe(false);
    expect(sent.at(-1)).toEqual({ type: 'floatState', payload: { fullscreen: false } });
  });

  it('swaps its columns with ⇄ or the swap key, and says so when the window does not show two columns', async () => {
    await openFloat();
    toast.value = null;
    const body = () => floatRoot().querySelector<HTMLElement>('.fl-body')!;
    const swap = () => floatRoot().querySelector<HTMLButtonElement>('.sb-head .fl-swap')!;
    expect(body().classList.contains('panel-left')).toBe(false);
    expect(swap().title).toBe('Move the list to the left (O)');
    act(() => swap().click());
    expect(settings.value.floatPanelLeft).toBe(true);
    expect(body().classList.contains('panel-left')).toBe(true);
    expect(swap().title).toBe('Move the list back to the right (O)');
    expect(toast.value).toBeNull(); // the window shows it

    const o = key('KeyO');
    act(() => handlers().onFloatKeyDown(o));
    expect(o.defaultPrevented).toBe(true);
    expect(settings.value.floatPanelLeft).toBe(false);
    expect(body().classList.contains('panel-left')).toBe(false);

    // In one column, or from the page with the window closed, nothing visible changes.
    pip.innerWidth = 800;
    act(() => handlers().onFloatKeyDown(key('KeyO')));
    expect(toast.value).toContain('list on the left');
    act(() => pip.close());
    await flush();
    act(() => handlers().onKeyDown(key('KeyO')));
    expect(settings.value.floatPanelLeft).toBe(false);
    expect(toast.value).toContain('list on the right');
  });

  it('resizes the list column by dragging the line between the columns, on either side', async () => {
    await openFloat();
    const body = () => floatRoot().querySelector<HTMLElement>('.fl-body')!;
    const divider = () => floatRoot().querySelector<HTMLElement>('.fl-divider')!;
    const panelWidth = (w: number) => {
      body().getBoundingClientRect = () => new DOMRect(0, 40, 1600, 860);
      floatRoot().querySelector<HTMLElement>('.fl-panel')!.getBoundingClientRect = () => new DOMRect(0, 40, w, 860);
    };
    const pointer = (type: string, clientX: number) =>
      act(() => {
        divider().dispatchEvent(new PointerEvent(type, { clientX, button: 0, pointerId: 1, bubbles: true }));
      });
    expect(body().style.getPropertyValue('--fl-panel-w')).toBe(''); // automatic

    // A click alone keeps the automatic width.
    panelWidth(480);
    pointer('pointerdown', 1118);
    pointer('pointerup', 1118);
    expect(settings.value.floatPanelShare).toBe(0);
    expect(body().style.getPropertyValue('--fl-panel-w')).toBe('');

    // List on the right: it grows by as much as the pointer moves left.
    pointer('pointerdown', 1118);
    pointer('pointermove', 1038);
    expect(body().classList.contains('dragging')).toBe(true);
    expect(body().style.getPropertyValue('--fl-panel-w')).toBe('35%');
    expect(settings.value.floatPanelShare).toBe(0); // saved on release
    pointer('pointerup', 958);
    expect(settings.value.floatPanelShare).toBe(0.4);
    expect(body().classList.contains('dragging')).toBe(false);
    expect(body().style.getPropertyValue('--fl-panel-w')).toBe('40%');

    // List on the left: it grows as the pointer moves right. Neither column gets too narrow.
    act(() => c.runAction('swapColumns'));
    panelWidth(640);
    pointer('pointerdown', 644);
    pointer('pointerup', 100);
    expect(settings.value.floatPanelShare).toBe(+(260 / 1600).toFixed(3));
    panelWidth(260);
    pointer('pointerdown', 264);
    pointer('pointerup', 1590);
    expect(settings.value.floatPanelShare).toBe(+((1600 - 360) / 1600).toFixed(3));

    // Double-click: back to the automatic width.
    act(() => {
      divider().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(settings.value.floatPanelShare).toBe(0);
    expect(body().style.getPropertyValue('--fl-panel-w')).toBe('');
  });

  it('docks back: the window closes and the sidebar returns to the page', async () => {
    await openFloat();
    act(() => floatRoot().querySelector<HTMLButtonElement>('.sb-head button[title^="Put the sidebar back"]')!.click());
    await flush();
    expect(pip.closed).toBe(true);
    expect(floatWin.value).toBeNull();
    expect(settings.value).toMatchObject({ floating: false, sidebarOpen: true });
    expect(sidebarOnPage.value).toBe(true);
  });

  it('closing the window yourself puts the sidebar back on the page', async () => {
    await openFloat();
    act(() => pip.close());
    await flush();
    expect(settings.value.floating).toBe(false);
    expect(sidebarOnPage.value).toBe(true);
  });

  it('survives a reload: the old page leaves a note, the new page takes the window back without a click', async () => {
    await openFloat();
    window.dispatchEvent(new Event('pagehide'));
    expect(floatRoot().textContent).toContain('Netflix is reloading');

    // The reloaded page: a new controller, still floating, and the background says the window is open.
    floatWin.value = null;
    windowStillOpen = true;
    sent.length = 0;
    open.mockClear();
    makeController();
    await flush();
    expect(types()).toEqual(['floatExists']); // taken back, not placed again
    expect(open).toHaveBeenCalledTimes(1);
    expect(floatWin.value).toBe(pip);
    expect(pip.document.querySelectorAll('.plg-root')).toHaveLength(1);
    expect(floatRoot().querySelector('.big-line')).not.toBeNull();
  });

  it('after a reload with the window closed, the first key press opens it again (F excepted)', async () => {
    settings.value = { ...DEFAULT_SETTINGS, floating: true };
    makeController();
    await flush();
    expect(open).not.toHaveBeenCalled(); // nothing to take back: no blocked popup
    expect(sidebarOnPage.value).toBe(false);
    const host = document.createElement('div');
    act(() => render(h(App, null), host));
    expect(host.querySelector('.sb-handle.float-handle')).not.toBeNull();
    act(() => render(null, host));

    handlers().onKeyDown(key('KeyF'));
    expect(open).not.toHaveBeenCalled();
    handlers().onKeyDown(key('KeyA'));
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
    expect(floatWin.value).toBe(pip);
  });

  it('the float key opens and closes it; E while floating docks', async () => {
    handlers().onKeyDown(key('KeyP'));
    await flush();
    expect(floatWin.value).toBe(pip);
    handlers().onFloatKeyDown(key('KeyP'));
    await flush();
    expect(floatWin.value).toBeNull();
    expect(settings.value.floating).toBe(false);

    pip = fakePopup();
    await openFloat();
    c.runAction('toggleSidebar');
    await flush();
    expect(floatWin.value).toBeNull();
    expect(settings.value).toMatchObject({ floating: false, sidebarOpen: true });
  });

  it("passes Netflix's Space, F and arrow keys on to the player from the window", async () => {
    await openFloat();
    const space = key('Space');
    handlers().onFloatKeyDown(space);
    expect(space.defaultPrevented).toBe(true);
    expect(adapter.play).toHaveBeenCalledTimes(1);
    adapter.isPaused.mockReturnValue(false);
    handlers().onFloatKeyDown(key('Space'));
    expect(adapter.pause).toHaveBeenCalledTimes(1);
    handlers().onFloatKeyDown(key('ArrowRight'));
    expect(adapter.seek).toHaveBeenLastCalledWith(15_000);
    handlers().onFloatKeyDown(key('ArrowLeft'));
    expect(adapter.seek).toHaveBeenLastCalledWith(0);
    // F: the page can't go fullscreen without a click on it, so the background makes its browser window fullscreen.
    handlers().onFloatKeyDown(key('KeyF'));
    await flush();
    expect(types()).toContain('toggleTabFullscreen');
    // Shortcuts work there too: D goes to the next line, not to Netflix.
    const d = key('KeyD');
    handlers().onFloatKeyDown(d);
    expect(d.defaultPrevented).toBe(true);
    expect(adapter.play).toHaveBeenCalledTimes(1);
  });

  it('opens a word popup in the window the word was clicked in', async () => {
    await openFloat();
    const page = document.createElement('div');
    act(() => render(h(App, null), page));
    act(() => c.openPopup('Hello', 0, new DOMRect(10, 100, 40, 20), 'float'));
    expect(floatRoot().querySelector('.popup')).not.toBeNull();
    expect(page.querySelector('.popup')).toBeNull();
    // Closing the window takes its popup with it.
    act(() => pip.close());
    await flush();
    expect(popup.value).toBeNull();
    act(() => render(null, page));
  });

  it('Blur video blurs the big line but not the lines around it or the list; holding V shows it', async () => {
    settings.value = { ...DEFAULT_SETTINGS, blurVideo: true, controlsFolded: false };
    await openFloat();
    const root = floatRoot();
    const blurred = (sel: string) => [...root.querySelectorAll(sel)].map((e) => e.classList.contains('blur'));
    expect(blurred('.bl-main, .bl-trans')).toEqual([true, true]);
    expect(blurred('.bl-ctx')).toEqual([false, false]);
    expect(blurred('.list .row-main, .list .row-trans')).not.toContain(true);
    // The translation blur alone still blurs only the translation.
    act(() => {
      settings.value = { ...settings.value, blurVideo: false, blurTranslation: true };
    });
    expect(blurred('.bl-main, .bl-trans')).toEqual([false, true]);

    const bigLine = () => root.querySelector('.big-line')!.classList;
    act(() => handlers().onFloatKeyDown(key('KeyV')));
    expect(bigLine().contains('reveal')).toBe(true);
    // The window losing the focus counts as letting go: the keyup would go elsewhere.
    act(() => {
      pip.dispatchEvent(new Event('blur'));
    });
    expect(bigLine().contains('reveal')).toBe(false);
    expect(revealHeld.value).toBe(false);
  });

  it('U in the window shows the big line and the line on the video although blurred, until the next line', async () => {
    settings.value = { ...DEFAULT_SETTINGS, blurVideo: true };
    const page = document.createElement('div');
    act(() => render(h(App, null), page));
    await openFloat();
    const bigLine = () => floatRoot().querySelector('.big-line')!.classList;
    const onVideo = () => page.querySelector('.ov-block')!.classList;
    act(() => handlers().onFloatKeyDown(key('KeyU')));
    expect(bigLine().contains('reveal')).toBe(true);
    expect(onVideo().contains('reveal')).toBe(true);
    act(() => {
      activeIndex.value = 1;
      currentIndex.value = 1;
    });
    expect(bigLine().contains('reveal')).toBe(false);
    expect(onVideo().contains('reveal')).toBe(false);
    act(() => render(null, page));
  });

  it('can keep the video clean while the window shows the subtitles', async () => {
    const page = document.createElement('div');
    act(() => render(h(App, null), page));
    expect(page.querySelector('.overlay')).not.toBeNull();
    await openFloat();
    const chip = [...floatRoot().querySelectorAll<HTMLButtonElement>('.big-line .chip')].find((b) => b.textContent === 'Subtitles on video')!;
    act(() => chip.click());
    expect(settings.value.floatHideVideoSubs).toBe(true);
    act(() => render(h(App, null), page));
    expect(page.querySelector('.overlay')).toBeNull();
    // Only while floating.
    act(() => pip.close());
    await flush();
    act(() => render(h(App, null), page));
    expect(page.querySelector('.overlay')).not.toBeNull();
    act(() => render(null, page));
  });
});
