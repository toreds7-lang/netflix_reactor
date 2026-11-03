import type { Cue } from '../core/types';

const KEY = 'lineEnds';
/** Keep saved line timings for this many episodes (the least recently changed go first). */
const MAX_VIDEOS = 300;

/** Extra ms by line key (see lineKey). */
export type LineMs = Record<string, number>;

/** What the extend and start keys saved for an episode. */
export interface LineTimings {
  /** Played after the line's subtitle ends. */
  ends: LineMs;
  /** Played before the line's subtitle starts when going to it. */
  starts: LineMs;
}

export type LineEdge = keyof LineTimings;

interface VideoLineTimings {
  ends: LineMs;
  /** Missing in data saved before line starts could be moved. */
  starts?: LineMs;
  updatedAt: number;
}

type LineTimingMap = Record<string, VideoLineTimings>;

/**
 * Lines are found again by subtitle language and start time: indices change when sound descriptions are hidden,
 * and each subtitle track has its own timing.
 */
export function lineKey(lang: string, cue: Cue): string {
  return `${lang}@${Math.round(cue.start)}`;
}

/** The saved ms of each cue, by cue index (0 when none). */
export function msFor(cues: Cue[], lang: string, saved: LineMs): number[] {
  return cues.map((c) => saved[lineKey(lang, c)] ?? 0);
}

async function getAll(): Promise<LineTimingMap> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as LineTimingMap | undefined) ?? {};
}

export async function getLineTimings(videoId: string): Promise<LineTimings> {
  const v = (await getAll())[videoId];
  return { ends: v?.ends ?? {}, starts: v?.starts ?? {} };
}

/** Number of episodes with saved line timings. */
export async function countLineTimingVideos(): Promise<number> {
  return Object.keys(await getAll()).length;
}

let chain: Promise<unknown> = Promise.resolve();

function mutate(fn: (all: LineTimingMap) => void): Promise<void> {
  const next = chain.then(async () => {
    const all = await getAll();
    fn(all);
    const ids = Object.keys(all);
    if (ids.length > MAX_VIDEOS) {
      ids.sort((a, b) => all[a].updatedAt - all[b].updatedAt);
      for (const id of ids.slice(0, ids.length - MAX_VIDEOS)) delete all[id];
    }
    await chrome.storage.local.set({ [KEY]: all });
  });
  chain = next.catch(() => undefined);
  return next;
}

/** Save how much earlier a line starts or later it ends; 0 forgets it. */
export function setLineTiming(videoId: string, edge: LineEdge, key: string, ms: number): Promise<void> {
  return mutate((all) => {
    const prev = all[videoId];
    const timings: LineTimings = { ends: { ...prev?.ends }, starts: { ...prev?.starts } };
    if (ms > 0) timings[edge][key] = Math.round(ms);
    else delete timings[edge][key];
    if (Object.keys(timings.ends).length || Object.keys(timings.starts).length) {
      all[videoId] = { ...timings, updatedAt: Date.now() };
    } else delete all[videoId];
  });
}

export function clearLineTimings(): Promise<void> {
  return mutate((all) => {
    for (const id of Object.keys(all)) delete all[id];
  });
}
