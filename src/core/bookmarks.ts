import { findActiveIndex, findLastStartedIndex } from './playback';
import { flatten } from './subtitles';
import type { Cue, LineMark, SavedLoop, VideoBookmarks } from './types';

/** A line with the same text this close to the saved time is the bookmarked line. */
const SAME_LINE_WINDOW_MS = 5000;
/** The last line played is offered next to the bookmark only when it is at least this far away. */
const ELSEWHERE_MS = 30_000;
/** Reaching one of the final lines counts as finishing the episode. */
export const FINISHED_LINES = 3;

/**
 * Index of the marked line in `cues`, or -1 when there are no cues.
 * Prefers a line with the same text near the saved time (it survives a track switch or the [SDH] toggle);
 * otherwise the line playing at that time, or the next one to start.
 */
export function findMarkIndex(cues: Cue[], mark: LineMark): number {
  if (!cues.length) return -1;
  let best = -1;
  let bestDist = Infinity;
  for (
    let k = Math.max(0, findLastStartedIndex(cues, mark.timeMs - SAME_LINE_WINDOW_MS));
    k < cues.length && cues[k].start <= mark.timeMs + SAME_LINE_WINDOW_MS;
    k++
  ) {
    const d = Math.abs(cues[k].start - mark.timeMs);
    if (d < bestDist && flatten(cues[k].text) === mark.text) {
      best = k;
      bestDist = d;
    }
  }
  if (best >= 0) return best;
  const active = findActiveIndex(cues, mark.timeMs);
  if (active >= 0) return active;
  return Math.min(cues.length - 1, findLastStartedIndex(cues, mark.timeMs) + 1);
}

export interface ResumeChoice {
  /** Where Continue goes: the bookmark, else the last line played. */
  primary: LineMark;
  isBookmark: boolean;
  /** The last line played, when there is a bookmark and this is somewhere else. */
  alsoLast?: LineMark;
}

export function resumeChoice(v: VideoBookmarks | undefined): ResumeChoice | null {
  if (v?.bookmark) {
    const far = v.last && Math.abs(v.last.timeMs - v.bookmark.timeMs) > ELSEWHERE_MS;
    return { primary: v.bookmark, isBookmark: true, alsoLast: far ? v.last : undefined };
  }
  return v?.last ? { primary: v.last, isBookmark: false } : null;
}

/** Something the user saved on purpose (a bookmark or loops), which is kept longer than automatic positions. */
const hasUserMarks = (v: VideoBookmarks) => !!v.bookmark || !!v.loops?.length;

/** Video ids to drop so at most `max` remain: automatic positions go before bookmarks and loops, oldest first. */
export function bookmarksToPrune(all: Record<string, VideoBookmarks>, max: number): string[] {
  const list = Object.values(all);
  if (list.length <= max) return [];
  return list
    .sort((a, b) => Number(hasUserMarks(a)) - Number(hasUserMarks(b)) || a.updatedAt - b.updatedAt)
    .slice(0, list.length - max)
    .map((v) => v.videoId);
}

/** Saved loops kept per episode; the oldest is dropped past this. */
export const MAX_LOOPS = 50;

const sameMark = (a: LineMark, b: LineMark) => a.timeMs === b.timeMs && a.text === b.text;

export function sameLoop(a: SavedLoop, b: SavedLoop): boolean {
  return sameMark(a.from, b.from) && sameMark(a.to, b.to);
}

/** `loops` with `loop` added in video order, without duplicates, keeping the newest `max`. */
export function addLoop(loops: SavedLoop[] | undefined, loop: SavedLoop, max = MAX_LOOPS): SavedLoop[] {
  const list = (loops ?? []).filter((l) => !sameLoop(l, loop));
  list.push(loop);
  if (list.length > max) {
    list.sort((a, b) => a.createdAt - b.createdAt);
    list.splice(0, list.length - max);
  }
  return list.sort((a, b) => a.from.timeMs - b.from.timeMs || a.to.timeMs - b.to.timeMs);
}

/** The loop's (or a saved sentence's) first and last line in `cues`, or null when there are no cues. */
export function findLoopRange(cues: Cue[], loop: Pick<SavedLoop, 'from' | 'to'>): [number, number] | null {
  const from = findMarkIndex(cues, loop.from);
  const to = findMarkIndex(cues, loop.to);
  if (from < 0 || to < 0) return null;
  return [Math.min(from, to), Math.max(from, to)];
}

/** The saved loop covering exactly lines [from, to], if any. */
export function findSavedLoop(cues: Cue[], loops: SavedLoop[] | undefined, from: number, to: number): SavedLoop | undefined {
  return loops?.find((l) => {
    const r = findLoopRange(cues, l);
    return !!r && r[0] === from && r[1] === to;
  });
}
