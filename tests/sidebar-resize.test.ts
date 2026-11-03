import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app/controller';
import { setController } from '../src/app/instance';
import { activeIndex, mainTrack, rawCues, settings, sidebarDragWidth, sidebarWidthPx, videoId, windowWidth } from '../src/app/state';
import { DEFAULT_SETTINGS, fitSidebarWidth } from '../src/core/settings';
import type { Cue } from '../src/core/types';
import type { SiteAdapter } from '../src/sites/adapter';
import { Overlay } from '../src/ui/Overlay';
import { Sidebar } from '../src/ui/Sidebar';

vi.mock('../src/core/messages', () => ({ send: vi.fn(async () => null) }));

// Settings writes go to extension storage.
vi.stubGlobal('chrome', {
  storage: {
    local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
  runtime: { id: 'test' },
});

const lines: Cue[] = [
  { start: 1000, end: 2000, text: 'One.' },
  { start: 3000, end: 4000, text: 'Two.' },
];

let adapter: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  settings.value = DEFAULT_SETTINGS;
  mainTrack.value = { id: 't', lang: 'en', label: 'English', kind: 'subtitles', sources: [] };
  rawCues.value = lines;
  videoId.value = 'v1';
  windowWidth.value = 1920;
  sidebarDragWidth.value = null;
  activeIndex.value = -1;
  adapter = {
    setLayout: vi.fn(),
    nowMs: vi.fn(() => 1500),
    isPaused: vi.fn(() => true),
    getVideo: vi.fn(() => null),
  };
  setController(new AppController(adapter as unknown as SiteAdapter));
});

/** The sidebar on the page, inside a parent that stands in for Netflix's player around the UI in fullscreen. */
function mount() {
  const page = document.createElement('div');
  const host = document.createElement('div');
  page.append(host);
  act(() => render(h('div', null, h(Sidebar, null), h(Overlay, null)), host));
  const aside = () => host.querySelector<HTMLElement>('aside.sidebar')!;
  const edge = () => host.querySelector<HTMLElement>('.sb-edge')!;
  const pointer = (type: string, clientX: number) =>
    act(() => {
      edge().dispatchEvent(new PointerEvent(type, { clientX, button: 0, pointerId: 1, bubbles: true }));
    });
  return { page, host, aside, edge, pointer };
}

describe('resizing the sidebar on the page', () => {
  it('drags the left edge: the sidebar grows as the pointer moves left, saved when you let go', () => {
    const { aside, pointer } = mount();
    expect(aside().style.width).toBe('380px');

    pointer('pointerdown', 1540);
    pointer('pointermove', 1440);
    expect(aside().classList.contains('resizing')).toBe(true);
    expect(aside().style.width).toBe('480px');
    expect(settings.value.sidebarWidth).toBe(380); // not saved yet
    pointer('pointermove', 1640);
    expect(aside().style.width).toBe('280px'); // never below the minimum

    pointer('pointerup', 1300);
    expect(settings.value.sidebarWidth).toBe(620);
    expect(aside().classList.contains('resizing')).toBe(false);
    expect(aside().style.width).toBe('620px');
  });

  it('keeps the video at least 480 px wide, and a narrow window fits the saved width without changing it', () => {
    const { aside, pointer } = mount();
    pointer('pointerdown', 1540);
    pointer('pointerup', 0);
    expect(settings.value.sidebarWidth).toBe(1920 - 480);

    act(() => void (windowWidth.value = 1200));
    expect(aside().style.width).toBe('720px');
    expect(settings.value.sidebarWidth).toBe(1440);
    act(() => void (windowWidth.value = 600));
    expect(aside().style.width).toBe('280px'); // the minimum wins in a tiny window
    act(() => void (windowWidth.value = 2560));
    expect(aside().style.width).toBe('1440px');
  });

  it('a click leaves the width alone; a double-click goes back to the default', () => {
    settings.value = { ...DEFAULT_SETTINGS, sidebarWidth: 520 };
    const { aside, edge, pointer } = mount();
    pointer('pointerdown', 1400);
    pointer('pointerup', 1400);
    expect(settings.value.sidebarWidth).toBe(520);
    expect(aside().classList.contains('resizing')).toBe(false);

    act(() => {
      edge().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(settings.value.sidebarWidth).toBe(DEFAULT_SETTINGS.sidebarWidth);
    expect(aside().style.width).toBe('380px');
  });

  it('a cancelled drag drops the width it was showing', () => {
    const { aside, pointer } = mount();
    pointer('pointerdown', 1540);
    pointer('pointermove', 1340);
    expect(aside().style.width).toBe('580px');
    pointer('pointercancel', 1340);
    expect(aside().style.width).toBe('380px');
    expect(settings.value.sidebarWidth).toBe(380);
  });

  it("keeps presses on the edge from reaching Netflix's player", () => {
    const { page, edge } = mount();
    const reached: string[] = [];
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick']) page.addEventListener(type, () => reached.push(type));
    act(() => {
      edge().dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, button: 0, pointerId: 1, bubbles: true }));
      edge().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      edge().dispatchEvent(new PointerEvent('pointerup', { clientX: 10, button: 0, pointerId: 1, bubbles: true }));
      edge().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      edge().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(reached).toEqual([]);
  });

  it('moves the subtitles on the video with the edge as you drag', () => {
    activeIndex.value = 0;
    const { host, pointer } = mount();
    const overlay = () => host.querySelector<HTMLElement>('.overlay');
    expect(overlay()!.textContent).toContain('One.');
    expect(overlay()!.style.right).toBe('380px');
    pointer('pointerdown', 1540);
    pointer('pointermove', 1440);
    expect(overlay()!.style.right).toBe('480px');
  });

  it('the Netflix player makes room for the sidebar live while you drag', () => {
    const c = new AppController(adapter as unknown as SiteAdapter);
    setController(c);
    (c as unknown as { installEffects(): void }).installEffects();
    expect(adapter.setLayout).toHaveBeenLastCalledWith({ hideNativeSubs: true, sidebarWidth: 380 });
    const { pointer } = mount();
    pointer('pointerdown', 1540);
    pointer('pointermove', 1500);
    expect(adapter.setLayout).toHaveBeenLastCalledWith({ hideNativeSubs: true, sidebarWidth: 420 });
    pointer('pointerup', 1500);
    expect(adapter.setLayout).toHaveBeenLastCalledWith({ hideNativeSubs: true, sidebarWidth: 420 });
    act(() => void (settings.value = { ...settings.value, sidebarOpen: false }));
    expect(adapter.setLayout).toHaveBeenLastCalledWith({ hideNativeSubs: true, sidebarWidth: null });
  });
});

describe('fitSidebarWidth', () => {
  it('keeps the minimum width and leaves the video its room', () => {
    expect(fitSidebarWidth(380, 1920)).toBe(380);
    expect(fitSidebarWidth(100, 1920)).toBe(280);
    expect(fitSidebarWidth(1800, 1920)).toBe(1440);
    expect(fitSidebarWidth(500, 700)).toBe(280);
    expect(fitSidebarWidth(500.4, Infinity)).toBe(500);
  });

  it('is what the page uses, from the saved or dragged width', () => {
    settings.value = { ...DEFAULT_SETTINGS, sidebarWidth: 2000 };
    expect(sidebarWidthPx.value).toBe(1440);
    sidebarDragWidth.value = 300;
    expect(sidebarWidthPx.value).toBe(300);
  });
});
