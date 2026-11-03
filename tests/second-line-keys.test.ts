import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app/controller';
import { cues, keyLines, loop, mainTrack, rawCues, settings, toast, translationMode, videoId } from '../src/app/state';
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, mergeSettings } from '../src/core/settings';
import type { Cue } from '../src/core/types';
import type { SiteAdapter } from '../src/sites/adapter';

// Line timings and settings are saved in extension storage.
vi.stubGlobal('chrome', {
  storage: {
    local: { get: async () => ({}), set: async () => undefined },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
});

const lines: Cue[] = [
  { start: 1000, end: 2000, text: 'one' },
  { start: 3000, end: 4000, text: 'two' },
  { start: 6000, end: 7000, text: 'three' },
];

beforeEach(() => {
  settings.value = DEFAULT_SETTINGS;
  mainTrack.value = { id: 't', lang: 'en', label: 'English', kind: 'subtitles', sources: [] };
  rawCues.value = lines;
  videoId.value = 'v1';
  translationMode.value = 'none';
  keyLines.value = { status: 'idle' };
  loop.value = null;
  toast.value = null;
});

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
  const press = (code: string, init: KeyboardEventInit = {}) => {
    (c as unknown as { onKeyDown(e: KeyboardEvent): void }).onKeyDown(new KeyboardEvent('keydown', { code, cancelable: true, ...init }));
    c.playback.tick(); // the seek lands
  };
  return { c, adapter, press };
}

describe('N and M, second keys for Z and X', () => {
  it('N starts the line earlier like Z, and Shift+N starts it later again', () => {
    const { c, adapter, press } = setup(3500);
    c.playback.tick();
    press('KeyN');
    expect(adapter.seek).toHaveBeenLastCalledWith(2301);
    expect(c.playback.heads[1]).toBe(700);
    expect(toast.value).toContain('Line starts 0.7 s early, saved');
    press('KeyN', { shiftKey: true });
    expect(adapter.seek).toHaveBeenLastCalledWith(3001);
    expect(c.playback.heads[1]).toBe(0);
  });

  it('M plays a bit more of a line stopped at its end like X, and Shift+M takes it off again', () => {
    const { c, adapter, press } = setup(3000);
    c.playback.autoPause = true;
    for (; !adapter.paused && adapter.t < 5000; adapter.t += 50) c.playback.tick();
    expect(adapter.paused).toBe(true);
    c.playback.tick();
    press('KeyM');
    expect(c.playback.tails[1]).toBe(700);
    expect(adapter.paused).toBe(false);
    expect(toast.value).toContain('Line ending +0.7 s, saved');
    press('KeyM', { shiftKey: true });
    expect(c.playback.tails[1]).toBe(0);
    expect(adapter.seek).toHaveBeenLastCalledWith(3001);
  });

  it('shortcuts saved with the removed move keys give N and M to the second keys', () => {
    const saved = { ...DEFAULT_SHORTCUTS, moveEarlier: 'KeyN', moveLater: 'KeyM' } as Partial<typeof DEFAULT_SHORTCUTS>;
    delete saved.extendLine2;
    delete saved.startEarlier2;
    const { shortcuts } = mergeSettings({ shortcuts: saved as typeof DEFAULT_SHORTCUTS });
    expect(shortcuts).toMatchObject({ startEarlier2: 'KeyN', extendLine2: 'KeyM' });
    expect(shortcuts).not.toHaveProperty('moveEarlier');
  });
});
