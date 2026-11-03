import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app/controller';
import { setController } from '../src/app/instance';
import { keyLines, mainTrack, rawCues, settings, translationMode, videoId } from '../src/app/state';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import type { Cue } from '../src/core/types';
import type { SiteAdapter } from '../src/sites/adapter';
import { menuSummary, Sidebar } from '../src/ui/Sidebar';

// Settings writes go to extension storage.
vi.stubGlobal('chrome', {
  storage: {
    local: { get: async () => ({}), set: async () => undefined },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
});

const lines: Cue[] = [
  { start: 1000, end: 2000, text: 'One.' },
  { start: 3000, end: 4000, text: 'Two.' },
];

beforeEach(() => {
  settings.value = DEFAULT_SETTINGS;
  mainTrack.value = { id: 't', lang: 'en', label: 'English', kind: 'subtitles', sources: [] };
  rawCues.value = lines;
  videoId.value = 'v1';
  translationMode.value = 'none';
  keyLines.value = { status: 'idle' };
});

function mount() {
  const host = document.createElement('div');
  act(() => render(h(Sidebar, null), host));
  return host;
}

describe('sidebar menu fold', () => {
  it('starts folded: one bar with what is on, no selects, chips or key lines', () => {
    const host = mount();
    const fold = host.querySelector<HTMLButtonElement>('.fold')!;
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(fold.textContent).toContain('Hover pause');
    expect(host.querySelector('.controls select')).toBeNull();
    expect(host.querySelector('.controls .chips')).toBeNull();
    expect(host.querySelector('.keylines')).toBeNull();
    // Speed and size stay in the bar.
    expect(host.querySelectorAll('.controls .stepper')).toHaveLength(2);
  });

  it('unfolds on click and remembers it', () => {
    const host = mount();
    act(() => host.querySelector<HTMLButtonElement>('.fold')!.click());
    expect(settings.value.controlsFolded).toBe(false);
    expect(host.querySelector('.fold')!.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelectorAll('.controls select')).toHaveLength(3);
    expect(host.querySelector('.controls .chips')).not.toBeNull();
    expect(host.querySelector('.keylines')).not.toBeNull();
  });

  it('summarizes the toggles that are on and where translations come from', () => {
    settings.value = { ...DEFAULT_SETTINGS, autoPause: true, blurTranslation: true, pauseOnHover: false };
    translationMode.value = 'human';
    expect(menuSummary()).toBe('Auto-pause · Blur · Korean (Netflix)');
    settings.value = { ...settings.value, showTranslation: false };
    expect(menuSummary()).toBe('Auto-pause · No translation');
  });

  it('the shortcut folds and unfolds, and opens a hidden sidebar unfolded', () => {
    const c = new AppController({ nowMs: () => 0, isPaused: () => true } as unknown as SiteAdapter);
    setController(c);
    c.runAction('toggleControls');
    expect(settings.value.controlsFolded).toBe(false);
    c.runAction('toggleControls');
    expect(settings.value.controlsFolded).toBe(true);
    settings.value = { ...settings.value, sidebarOpen: false };
    c.runAction('toggleControls');
    expect(settings.value).toMatchObject({ sidebarOpen: true, controlsFolded: false });
  });
});
