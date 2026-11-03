import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app/controller';
import { bookmarks, floatWin, helpOpen, rawCues, resumeOffer, settings, toast, translations, videoId } from '../src/app/state';
import { send } from '../src/core/messages';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import type { Cue, TrackInfo } from '../src/core/types';
import type { SiteAdapter } from '../src/sites/adapter';
import { FloatApp } from '../src/ui/Float';

vi.mock('../src/core/messages', () => ({ send: vi.fn() }));

vi.stubGlobal('chrome', {
  storage: {
    local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
  runtime: { id: 'test' },
});

const EN: TrackInfo = { id: 'en', lang: 'en', label: 'English', kind: 'subtitles', sources: [] };
const lines: Cue[] = [
  { start: 1000, end: 2000, text: 'Hello there.' },
  { start: 3000, end: 4000, text: 'General Kenobi.' },
];

/** Stands in for the floating window: its own document, events and close(). */
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

type Internals = { refresh(): Promise<void>; installEffects(): void; wantsReopen(): boolean; videoEl: HTMLVideoElement | null };

let video: { playbackRate: number };
let adapter: Record<string, ReturnType<typeof vi.fn>>;
let c: AppController;
let open: ReturnType<typeof vi.spyOn>;
const internals = () => c as unknown as Internals;
const flush = () => act(async () => await new Promise((r) => setTimeout(r, 0)));
const switchTo = (enabled: boolean) => act(() => void (settings.value = { ...settings.value, enabled }));

beforeEach(async () => {
  settings.value = { ...DEFAULT_SETTINGS, nativeLang: 'ko', playbackRate: 0.8 };
  videoId.value = null;
  rawCues.value = [];
  bookmarks.value = {};
  floatWin.value = null;
  helpOpen.value = false;
  vi.mocked(send).mockReset();
  vi.mocked(send).mockImplementation((async (type: string, payload: { lines: string[] }) => {
    if (type === 'translateLines') return { translations: payload.lines.map((l) => `ko:${l}`) };
    if (type === 'floatExists') return false;
    return null;
  }) as never);
  video = { playbackRate: 1 };
  adapter = {
    currentVideoId: vi.fn(() => 'v1'),
    getMeta: vi.fn(() => null),
    getTracks: vi.fn(() => [EN]),
    getNativeTrack: vi.fn(async () => ({ id: 'en', lang: 'en', label: 'English', isNone: false })),
    loadTrack: vi.fn(async () => lines),
    setLayout: vi.fn(),
    getVideo: vi.fn(() => video),
    nowMs: vi.fn(() => 1500),
    isPaused: vi.fn(() => true),
    play: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    seek: vi.fn(async () => undefined),
  };
  open = vi.spyOn(window, 'open').mockImplementation(() => fakePopup() as unknown as Window);
  c = new AppController(adapter as unknown as SiteAdapter);
  internals().videoEl = video as HTMLVideoElement;
  internals().installEffects();
});

afterEach(() => {
  floatWin.peek()?.close();
  open.mockRestore();
});

async function load() {
  await internals().refresh();
  await vi.waitFor(() => expect(translations.value).toEqual(['ko:Hello there.', 'ko:General Kenobi.']));
}

describe('switching the whole extension off and on', () => {
  it('unloads the episode and gives Netflix back its subtitles, layout and speed', async () => {
    await load();
    expect(video.playbackRate).toBe(0.8);
    act(() => void (helpOpen.value = true));

    await switchTo(false);
    await flush();
    expect(videoId.value).toBeNull();
    expect(rawCues.value).toEqual([]);
    expect(helpOpen.value).toBe(false);
    expect(adapter.setLayout).toHaveBeenLastCalledWith({ hideNativeSubs: false, sidebarWidth: null });
    expect(video.playbackRate).toBe(1);
  });

  it('downloads and translates nothing while off', async () => {
    await load();
    await switchTo(false);
    await flush();
    adapter.loadTrack.mockClear();
    vi.mocked(send).mockClear();

    act(() => void (settings.value = { ...settings.value, nativeLang: 'ja' }));
    await internals().refresh(); // Netflix sends its manifest again
    await flush();
    expect(adapter.loadTrack).not.toHaveBeenCalled();
    expect(vi.mocked(send).mock.calls.map(([type]) => type)).not.toContain('translateLines');
  });

  it('picks the episode up again when switched on, without a reload', async () => {
    await load();
    await switchTo(false);
    await flush();

    await switchTo(true);
    await vi.waitFor(() => expect(translations.value).toEqual(['ko:Hello there.', 'ko:General Kenobi.']));
    expect(videoId.value).toBe('v1');
    expect(rawCues.value).toHaveLength(2);
    expect(video.playbackRate).toBe(0.8);
  });

  it("doesn't offer to continue the episode again after switching off and on", async () => {
    bookmarks.value = { v1: { videoId: 'v1', last: { timeMs: 3000, text: 'General Kenobi.', lang: 'en' }, updatedAt: 1 } };
    await load();
    await vi.waitFor(() => expect(resumeOffer.value).not.toBeNull());
    act(() => void (resumeOffer.value = null)); // dismissed

    await switchTo(false);
    await flush();
    await switchTo(true);
    await vi.waitFor(() => expect(rawCues.value).toHaveLength(2));
    await flush();
    expect(resumeOffer.value).toBeNull();
  });

  it('closes the floating window but stays floating, so a click brings it back once on', async () => {
    c.setFloatUi({ css: '', render: (r) => render(h(FloatApp, null), r), unmount: (r) => render(null, r) });
    await load();
    c.openFloat();
    await flush();
    expect(floatWin.value).not.toBeNull();

    await switchTo(false);
    await flush();
    expect(floatWin.value).toBeNull();
    expect(settings.value.floating).toBe(true);
    expect(internals().wantsReopen()).toBe(false);

    await switchTo(true);
    await vi.waitFor(() => expect(rawCues.value).toHaveLength(2));
    expect(internals().wantsReopen()).toBe(true);
    expect(toast.value).toContain('bring back the floating sidebar');
  });
});
