import { describe, expect, it } from 'vitest';
import {
  addLoop,
  bookmarksToPrune,
  findLoopRange,
  findMarkIndex,
  findSavedLoop,
  resumeChoice,
  sameLoop,
} from '../src/core/bookmarks';
import { DEFAULT_SHORTCUTS } from '../src/core/settings';
import { matchShortcut } from '../src/core/shortcuts';
import type { Cue, LineMark, SavedLoop, VideoBookmarks } from '../src/core/types';

const cues: Cue[] = [
  { start: 1000, end: 2000, text: 'Hello.' },
  { start: 3000, end: 4000, text: 'How are\nyou?' },
  { start: 6000, end: 7000, text: 'Hello.' },
  { start: 9000, end: 10000, text: 'Bye.' },
];

const mark = (timeMs: number, text: string): LineMark => ({ timeMs, text, lang: 'en' });

describe('findMarkIndex', () => {
  it('finds the line by text near the saved time', () => {
    expect(findMarkIndex(cues, mark(3000, 'How are you?'))).toBe(1);
    // Same text twice: the one closest to the saved time wins.
    expect(findMarkIndex(cues, mark(6000, 'Hello.'))).toBe(2);
    expect(findMarkIndex(cues, mark(1000, 'Hello.'))).toBe(0);
  });

  it('survives shifted timing (another subtitle profile)', () => {
    expect(findMarkIndex(cues, mark(3400, 'How are you?'))).toBe(1);
  });

  it('falls back to time when the text differs (another language or [SDH] removed)', () => {
    expect(findMarkIndex(cues, mark(3000, '¿Cómo estás?'))).toBe(1);
    // In a gap: the next line to start.
    expect(findMarkIndex(cues, mark(5000, 'gone'))).toBe(2);
    expect(findMarkIndex(cues, mark(500, 'gone'))).toBe(0);
    expect(findMarkIndex(cues, mark(20000, 'gone'))).toBe(3);
  });

  it('returns -1 without cues', () => {
    expect(findMarkIndex([], mark(1000, 'Hello.'))).toBe(-1);
  });
});

describe('resumeChoice', () => {
  const v = (patch: Partial<VideoBookmarks>): VideoBookmarks => ({ videoId: '1', updatedAt: 0, ...patch });

  it('prefers the bookmark and offers the last line when it is elsewhere', () => {
    const b = mark(60_000, 'b');
    const far = mark(600_000, 'far');
    expect(resumeChoice(v({ bookmark: b, last: far }))).toEqual({ primary: b, isBookmark: true, alsoLast: far });
    expect(resumeChoice(v({ bookmark: b, last: mark(70_000, 'near') }))?.alsoLast).toBeUndefined();
  });

  it('falls back to the last line played', () => {
    const last = mark(5000, 'x');
    expect(resumeChoice(v({ last }))).toEqual({ primary: last, isBookmark: false });
    expect(resumeChoice(v({}))).toBeNull();
    expect(resumeChoice(undefined)).toBeNull();
  });
});

describe('bookmarksToPrune', () => {
  it('drops automatic positions before bookmarks, oldest first', () => {
    const all: Record<string, VideoBookmarks> = {
      a: { videoId: 'a', updatedAt: 1, bookmark: mark(0, 'a') },
      b: { videoId: 'b', updatedAt: 2, last: mark(0, 'b') },
      c: { videoId: 'c', updatedAt: 3, last: mark(0, 'c') },
      d: { videoId: 'd', updatedAt: 4, bookmark: mark(0, 'd') },
    };
    expect(bookmarksToPrune(all, 4)).toEqual([]);
    expect(bookmarksToPrune(all, 2)).toEqual(['b', 'c']);
    expect(bookmarksToPrune(all, 1)).toEqual(['b', 'c', 'a']);
  });

  it('keeps episodes with saved loops as long as bookmarked ones', () => {
    const loop: SavedLoop = { from: mark(0, 'x'), to: mark(0, 'x'), createdAt: 0 };
    const all: Record<string, VideoBookmarks> = {
      a: { videoId: 'a', updatedAt: 1, loops: [loop] },
      b: { videoId: 'b', updatedAt: 2, last: mark(0, 'b') },
      c: { videoId: 'c', updatedAt: 3, loops: [] },
    };
    expect(bookmarksToPrune(all, 1)).toEqual(['b', 'c']);
  });
});

describe('saved loops', () => {
  const loop = (from: number, to: number, createdAt = 0): SavedLoop => ({
    from: mark(cues[from].start, cues[from].text.replace('\n', ' ')),
    to: mark(cues[to].start, cues[to].text.replace('\n', ' ')),
    createdAt,
  });

  it('keeps loops in video order without duplicates', () => {
    let list = addLoop(undefined, loop(2, 3, 1));
    list = addLoop(list, loop(0, 1, 2));
    list = addLoop(list, loop(0, 2, 3));
    list = addLoop(list, loop(0, 1, 4)); // again: kept once, as the newest
    expect(list.map((l) => [l.from.timeMs, l.to.timeMs, l.createdAt])).toEqual([
      [1000, 3000, 4],
      [1000, 6000, 3],
      [6000, 9000, 1],
    ]);
    expect(sameLoop(loop(0, 1), loop(0, 1, 99))).toBe(true);
    expect(sameLoop(loop(0, 1), loop(0, 2))).toBe(false);
  });

  it('drops the oldest past the limit', () => {
    let list = addLoop(undefined, loop(3, 3, 1), 2);
    list = addLoop(list, loop(0, 0, 2), 2);
    list = addLoop(list, loop(1, 1, 3), 2);
    expect(list.map((l) => l.createdAt)).toEqual([2, 3]);
  });

  it('finds the lines again, even with shifted timing', () => {
    const shifted: SavedLoop = { from: mark(1300, 'Hello.'), to: mark(3300, 'How are you?'), createdAt: 0 };
    expect(findLoopRange(cues, shifted)).toEqual([0, 1]);
    expect(findLoopRange([], shifted)).toBeNull();
    expect(findSavedLoop(cues, [loop(2, 3), shifted], 0, 1)).toBe(shifted);
    expect(findSavedLoop(cues, [loop(2, 3)], 0, 1)).toBeUndefined();
    expect(findSavedLoop(cues, undefined, 0, 1)).toBeUndefined();
  });
});

describe('loop shortcut', () => {
  it('R loops lines by default', () => {
    expect(matchShortcut({ code: 'KeyR', ctrlKey: false, metaKey: false, altKey: false }, DEFAULT_SHORTCUTS)).toBe('loop');
  });
});

describe('bookmark shortcut', () => {
  it('B bookmarks the current line by default', () => {
    expect(matchShortcut({ code: 'KeyB', ctrlKey: false, metaKey: false, altKey: false }, DEFAULT_SHORTCUTS)).toBe('bookmark');
  });
});
