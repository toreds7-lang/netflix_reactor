import { findLoopRange } from './bookmarks';
import { baseLang } from './langs';
import type { Cue, PracticeSession, SavedSentence, SrsState } from './types';

/**
 * Saved sentences and when they come back for practice. Scheduling is a small SM-2 variant: "Good" goes
 * 1 → 3 → 7 → 16 → 37 days, "Again" brings a sentence back in 10 minutes and starts it over.
 */

const DAY_MS = 86_400_000;
/** "Again" brings the sentence back this soon. */
export const AGAIN_MS = 10 * 60_000;
export const START_EASE = 2.3;
const MIN_EASE = 1.3;
const MAX_INTERVAL_DAYS = 365;
/** A practice session on Netflix untouched for this long is over. */
export const PRACTICE_TTL_MS = 30 * 60_000;

export type Grade = 'again' | 'hard' | 'good' | 'easy';

export const GRADES: { id: Grade; label: string; key: string; title: string }[] = [
  { id: 'again', label: 'Again', key: '1', title: "Couldn't say it: practise it again in 10 minutes" },
  { id: 'hard', label: 'Hard', key: '2', title: 'Said it, with trouble' },
  { id: 'good', label: 'Good', key: '3', title: 'Said it well' },
  { id: 'easy', label: 'Easy', key: '4', title: 'Too easy: wait longer before the next time' },
];

/** A new sentence is due at once, so it can be practised right after the episode. */
export function newSrs(now: number): SrsState {
  return { due: now, interval: 0, ease: START_EASE, reps: 0, lapses: 0 };
}

/** Local midnight at the start of the day `ms` falls on. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The next review after rating a practice. A review due in N days is due from the start of that day. */
export function schedule(srs: SrsState, grade: Grade, now: number): SrsState {
  const { interval, reps, lapses } = srs;
  let ease = srs.ease;
  if (grade === 'again') {
    return {
      due: now + AGAIN_MS,
      interval: 0,
      ease: Math.max(MIN_EASE, ease - 0.2),
      reps: 0,
      lapses: lapses + (reps > 0 ? 1 : 0),
      last: now,
    };
  }
  const good = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(interval + 1, Math.round(interval * ease));
  let days: number;
  if (grade === 'hard') {
    days = reps === 0 ? 1 : Math.max(interval + 1, Math.round(interval * 1.2));
    ease = Math.max(MIN_EASE, ease - 0.15);
  } else if (grade === 'good') {
    days = good;
  } else {
    days = reps === 0 ? 3 : Math.max(good + 1, Math.round(good * 1.3));
    ease += 0.15;
  }
  days = Math.min(MAX_INTERVAL_DAYS, days);
  return { due: startOfDay(now + days * DAY_MS), interval: days, ease: +ease.toFixed(2), reps: reps + 1, lapses, last: now };
}

/** How long until the next review after rating `grade`, short: "10m", "1d", "3d", "2mo", "1y". */
export function nextLabel(srs: SrsState, grade: Grade, now: number): string {
  return daysLabel(schedule(srs, grade, now).interval);
}

function daysLabel(days: number): string {
  if (days <= 0) return '10m';
  if (days < 60) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${+(days / 365).toFixed(1)}y`;
}

/** When a sentence just rated comes back, from its new interval: "in 10 minutes", "tomorrow", "in 7 days". */
export function backLabel(days: number): string {
  if (days <= 0) return 'in 10 minutes';
  if (days === 1) return 'tomorrow';
  if (days < 60) return `in ${days} days`;
  if (days < 365) return `in ${Math.round(days / 30)} months`;
  return `in ${+(days / 365).toFixed(1)} years`;
}

export function isDue(s: SavedSentence, now: number): boolean {
  return s.srs.due <= now;
}

/** Never rated yet. */
export function isNew(s: SavedSentence): boolean {
  return !s.srs.last;
}

/** Sentences due now, most overdue first. */
export function dueSentences(all: Record<string, SavedSentence>, now: number): SavedSentence[] {
  return Object.values(all)
    .filter((s) => isDue(s, now))
    .sort((a, b) => a.srs.due - b.srs.due || a.createdAt - b.createdAt);
}

/** When the sentence comes back, for lists: "new", "due", "in 3 days", "in 2 months". */
export function reviewLabel(s: SavedSentence, now: number): string {
  if (isDue(s, now)) return isNew(s) ? 'new' : 'due';
  const days = Math.round((startOfDay(s.srs.due) - startOfDay(now)) / DAY_MS);
  if (days <= 0) return 'later today';
  if (days === 1) return 'tomorrow';
  if (days < 60) return `in ${days} days`;
  if (days < 365) return `in ${Math.round(days / 30)} months`;
  return `in ${+(days / 365).toFixed(1)} years`;
}

export function sentenceId(videoId: string, lang: string, timeMs: number): string {
  return `${videoId}:${lang}:${timeMs}`;
}

/**
 * The displayed lines that make up the sentence line `index` belongs to: consecutive lines of the same key-line
 * sentence (`cueUnits`, -1 for none), or the line alone.
 */
export function sentenceRange(cueUnits: number[], index: number): [number, number] {
  const u = cueUnits[index];
  if (u == null || u < 0) return [index, index];
  let first = index;
  let last = index;
  while (first > 0 && cueUnits[first - 1] === u) first--;
  while (last + 1 < cueUnits.length && cueUnits[last + 1] === u) last++;
  return [first, last];
}

/** This episode's sentences in this subtitle language, in video order. */
export function episodeSentences(all: Record<string, SavedSentence>, videoId: string | null, lang: string): SavedSentence[] {
  if (!videoId || !lang) return [];
  const base = baseLang(lang);
  return Object.values(all)
    .filter((s) => s.videoId === videoId && baseLang(s.lang) === base)
    .sort((a, b) => a.from.timeMs - b.from.timeMs);
}

/** For each displayed line inside a saved sentence, that sentence's id. */
export function savedLineMap(cues: Cue[], list: SavedSentence[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const s of list) {
    const r = findLoopRange(cues, s);
    if (!r) continue;
    for (let i = r[0]; i <= r[1]; i++) if (!map.has(i)) map.set(i, s.id);
  }
  return map;
}

/**
 * Order for practising on Netflix: this episode's sentences first (no page load), in video order; then the other
 * episodes, the one with the most overdue sentence first, each in video order.
 */
export function practiceOrder(due: SavedSentence[], videoId: string | null): string[] {
  const groups = new Map<string, SavedSentence[]>();
  for (const s of due) {
    const g = groups.get(s.videoId);
    if (g) g.push(s);
    else groups.set(s.videoId, [s]);
  }
  const ordered = [...groups.entries()].sort(([a, ga], [b, gb]) => {
    if (a === videoId) return -1;
    if (b === videoId) return 1;
    return Math.min(...ga.map((s) => s.srs.due)) - Math.min(...gb.map((s) => s.srs.due));
  });
  return ordered.flatMap(([, g]) => g.sort((x, y) => x.from.timeMs - y.from.timeMs).map((s) => s.id));
}

/** What the practice page goes through: the sentences due, the next ones to come due, or a random handful. */
export type QueueMode = 'due' | 'ahead' | 'random';
/** Sentences taken when practising ahead or at random. */
export const EXTRA_QUEUE = 10;

/** Sentence ids for the practice page, in the language chosen ('all' for every one). */
export function practiceQueue(
  all: Record<string, SavedSentence>,
  mode: QueueMode,
  lang: string,
  now: number,
  random: () => number = Math.random,
): string[] {
  let list = Object.values(all).filter((s) => lang === 'all' || baseLang(s.lang) === lang);
  if (mode === 'due') {
    list = list.filter((s) => isDue(s, now)).sort((a, b) => a.srs.due - b.srs.due || a.createdAt - b.createdAt);
  } else if (mode === 'ahead') {
    list = list
      .filter((s) => !isDue(s, now))
      .sort((a, b) => a.srs.due - b.srs.due)
      .slice(0, EXTRA_QUEUE);
  } else {
    // Fisher-Yates, then a handful.
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    list = list.slice(0, EXTRA_QUEUE);
  }
  return list.map((s) => s.id);
}

export function isFreshSession(p: PracticeSession | null | undefined, now: number): p is PracticeSession {
  return !!p && p.index < p.ids.length && now - p.at < PRACTICE_TTL_MS;
}

/** One pass of a practice drill: listen with the text hidden, shadow with the text, or shadow from memory. */
export type DrillStep = 'listen' | 'text' | 'blind';

export const DRILL_STEPS: { id: DrillStep; icon: string; label: string; hint: string }[] = [
  { id: 'listen', icon: '👂', label: 'Listen', hint: 'Just listen, text hidden' },
  { id: 'text', icon: '📖', label: 'Shadow with text', hint: 'Speak along with the voice, reading the text' },
  { id: 'blind', icon: '🙈', label: 'Shadow from memory', hint: 'Speak along with the voice, text hidden' },
];

export function drillStepInfo(step: DrillStep) {
  return DRILL_STEPS.find((d) => d.id === step)!;
}

export interface DrillPasses {
  drillListen: number;
  drillWithText: number;
  drillBlind: number;
}

/** The passes of one drill, in order; at least one. */
export function drillSteps(p: DrillPasses): DrillStep[] {
  const steps: DrillStep[] = [
    ...Array<DrillStep>(Math.max(0, p.drillListen)).fill('listen'),
    ...Array<DrillStep>(Math.max(0, p.drillWithText)).fill('text'),
    ...Array<DrillStep>(Math.max(0, p.drillBlind)).fill('blind'),
  ];
  return steps.length ? steps : ['text'];
}

/** What text-to-speech says: without the dashes that mark a new speaker. */
export function speechText(text: string): string {
  return text.replace(/(^|\s)[-‐–—]\s+/g, '$1').trim();
}

export function isSentence(x: unknown): x is SavedSentence {
  const s = x as SavedSentence;
  return (
    !!s &&
    typeof s.id === 'string' &&
    typeof s.text === 'string' &&
    typeof s.videoId === 'string' &&
    typeof s.from?.timeMs === 'number' &&
    typeof s.to?.timeMs === 'number' &&
    typeof s.srs?.due === 'number'
  );
}

/** Sentences from a backup added to `all`: new ones, and newer versions of ones you have. Returns how many were taken. */
export function mergeSentences(all: Record<string, SavedSentence>, incoming: unknown[]): number {
  let taken = 0;
  for (const s of incoming) {
    if (!isSentence(s)) continue;
    const have = all[s.id];
    if (have && (have.updatedAt ?? 0) >= (s.updatedAt ?? 0)) continue;
    all[s.id] = s;
    taken++;
  }
  return taken;
}
