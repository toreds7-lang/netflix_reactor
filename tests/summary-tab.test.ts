import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setController } from '../src/app/instance';
import { mainTrack, rawCues, reading, READING_IDLE, sidebarTab, summary } from '../src/app/state';
import type { AppController } from '../src/app/controller';
import { Sidebar } from '../src/ui/Sidebar';

const fake = { readAloud: vi.fn(), stopReading: vi.fn(), goToSentence: vi.fn(), summarize: vi.fn() };

describe('Summary tab read-aloud', () => {
  let root: HTMLElement;

  beforeEach(() => {
    setController(fake as unknown as AppController);
    root = document.createElement('div');
    document.body.append(root);
    rawCues.value = Array.from({ length: 30 }, (_, i) => ({ start: i * 2000, end: i * 2000 + 1500, text: `Line number ${i}.` }));
    mainTrack.value = { id: 't', lang: 'en', label: 'English', kind: 'subtitles', sources: [] };
    sidebarTab.value = 'summary';
    summary.value = {
      status: 'ready',
      data: {
        overview: 'Anna loses her job. She hides it from Tom.',
        characters: [
          { name: 'Anna', role: 'a nurse' },
          { name: 'Tom', role: 'her husband' },
        ],
        scenes: [
          { title: 'Bad news', summary: 'Anna is fired. She cries.', start: 0, end: 9, evidence: [3] },
          { title: 'At home', summary: 'Tom cooks dinner.', start: 10, end: 29, evidence: [] },
        ],
        model: 'test-model',
        inputTokens: 1,
        outputTokens: 1,
        cached: true,
        level: 'B1',
        createdAt: 0,
        current: true,
        adapted: false,
      },
    };
    reading.value = READING_IDLE;
    act(() => render(h(Sidebar, null), root));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.clearAllMocks();
  });

  const speakButtons = () => [...root.querySelectorAll<HTMLButtonElement>('button.speak')];
  const highlighted = () => [...root.querySelectorAll('.reading')].map((el) => el.textContent?.trim());

  it('offers Read all, the overview, who is who and each scene', () => {
    expect(speakButtons().map((b) => b.title)).toEqual([
      'Read the whole summary aloud',
      'Read the overview aloud',
      "Read who's who aloud",
      'Read this scene aloud',
      'Read this scene aloud',
    ]);
    // The overview is still shown as one paragraph, built from its sentences.
    expect(root.querySelector('section p')?.textContent).toBe('Anna loses her job. She hides it from Tom.');
  });

  it('reads the range of the button that was clicked', () => {
    const [all, overview, cast, scene1, scene2] = speakButtons();
    all.click();
    overview.click();
    cast.click();
    scene1.click();
    scene2.click();
    expect(fake.readAloud.mock.calls).toEqual([
      [0, 8],
      [0, 1],
      [2, 3],
      [4, 6],
      [7, 8],
    ]);
    expect(fake.goToSentence).not.toHaveBeenCalled();
  });

  it('highlights the sentence, character or title being read and turns its button into Stop', () => {
    act(() => void (reading.value = { status: 'playing', from: 0, to: 8, item: 1 }));
    expect(highlighted()).toEqual(['She hides it from Tom.']);
    expect(speakButtons()[0].title).toBe('Stop reading');
    expect(speakButtons()[0].textContent).toBe('■');

    act(() => void (reading.value = { status: 'playing', from: 0, to: 8, item: 3 }));
    expect(highlighted()).toEqual(['Tom — her husband']);

    act(() => void (reading.value = { status: 'playing', from: 4, to: 6, item: 4 }));
    expect(highlighted()).toEqual(['1. Bad news']);
    expect(speakButtons()[0].title).toBe('Read the whole summary aloud');
    expect(speakButtons()[3].title).toBe('Stop reading');

    speakButtons()[3].click();
    expect(fake.stopReading).toHaveBeenCalledOnce();
  });

  it('shows the model download while the voice loads', () => {
    act(() => void (reading.value = { status: 'loading', from: 0, to: 8, item: -1, progress: 0.42 }));
    expect(root.textContent).toContain('Loading voice… 42%');
    act(() => void (reading.value = { status: 'loading', from: 0, to: 8, item: -1, progress: null }));
    expect(root.textContent).toContain('Preparing voice…');
  });

  it('makes a cached summary again with ↻ and keeps it shown meanwhile', () => {
    const head = root.querySelector('.result-info')!;
    expect(head.textContent).toContain('test-model · B1 · cached');
    const redo = head.querySelector('button')!;
    expect(redo.textContent).toBe('↻');
    redo.click();
    expect(fake.summarize).toHaveBeenCalledWith(true);

    act(() => void (summary.value = { ...summary.value, status: 'loading' }));
    expect(root.querySelector('.result-info button')?.textContent).toBe('Updating…');
    expect(root.textContent).toContain('Bad news');
    act(() => void (summary.value = { ...summary.value, status: 'error', error: 'Claude Code is busy' }));
    expect(root.querySelector('.summary .error')?.textContent).toBe('Claude Code is busy');
    expect(root.textContent).toContain('Bad news');
  });

  it('offers ✨ Update for a summary made with other settings', () => {
    act(() => void (summary.value = { status: 'ready', data: { ...summary.value.data!, current: false, level: 'A2' } }));
    const update = root.querySelector<HTMLButtonElement>('.result-info button')!;
    expect(update.textContent).toBe('✨ Update');
    expect(root.textContent).toContain('From an earlier run (test-model, A2)');
    update.click();
    expect(fake.summarize).toHaveBeenCalledWith(true);
  });
});
