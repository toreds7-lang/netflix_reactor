import { describe, expect, it } from 'vitest';
import { PlaybackController } from '../src/core/playback';
import {
  AGAIN_MS,
  backLabel,
  drillSteps,
  dueSentences,
  isFreshSession,
  mergeSentences,
  newSrs,
  nextLabel,
  practiceOrder,
  practiceQueue,
  PRACTICE_TTL_MS,
  reviewLabel,
  savedLineMap,
  schedule,
  sentenceRange,
  speechText,
  startOfDay,
  type Grade,
} from '../src/core/sentences';
import type { Cue, SavedSentence, SrsState } from '../src/core/types';

const DAY = 86_400_000;
// 2026-10-11 14:00 local time.
const NOW = new Date(2026, 9, 11, 14, 0, 0).getTime();

function sentence(id: string, patch: Partial<SavedSentence> = {}): SavedSentence {
  const timeMs = patch.from?.timeMs ?? 1000;
  return {
    id,
    lang: 'en',
    text: `Sentence ${id}.`,
    videoId: 'v1',
    from: { timeMs, text: `Sentence ${id}.`, lang: 'en' },
    to: { timeMs, text: `Sentence ${id}.`, lang: 'en' },
    startMs: timeMs,
    endMs: timeMs + 1000,
    srs: newSrs(NOW - 1000),
    practiced: 0,
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    ...patch,
  };
}

/** Rate the same sentence again and again, each time on the day it is due. */
function rateRun(grades: Grade[]): SrsState[] {
  let srs = newSrs(NOW);
  let now = NOW;
  const out: SrsState[] = [];
  for (const g of grades) {
    srs = schedule(srs, g, now);
    out.push(srs);
    now = srs.due + 10 * 3600_000; // practised at 10:00 on the day it came back
  }
  return out;
}

describe('schedule', () => {
  it('"Good" brings a sentence back after 1, 3, 7, 16, 37 days', () => {
    expect(rateRun(['good', 'good', 'good', 'good', 'good']).map((s) => s.interval)).toEqual([1, 3, 7, 16, 37]);
  });

  it('is due from the start of the day it comes back', () => {
    const srs = schedule(newSrs(NOW), 'good', NOW);
    expect(srs.due).toBe(startOfDay(NOW + DAY));
    expect(srs).toMatchObject({ reps: 1, lapses: 0, last: NOW });
  });

  it('"Again" brings it back in 10 minutes and starts over; a forgotten one counts as a lapse', () => {
    const fresh = schedule(newSrs(NOW), 'again', NOW);
    expect(fresh).toMatchObject({ due: NOW + AGAIN_MS, interval: 0, reps: 0, lapses: 0 });
    expect(fresh.ease).toBeCloseTo(2.1);
    const [, , forgot] = rateRun(['good', 'good', 'again']);
    expect(forgot).toMatchObject({ interval: 0, reps: 0, lapses: 1 });
    // And then it climbs again from a day.
    expect(rateRun(['good', 'good', 'again', 'good'])[3].interval).toBe(1);
  });

  it('"Hard" grows the interval slowly and lowers the ease; "Easy" grows it faster', () => {
    expect(rateRun(['hard']).map((s) => s.interval)).toEqual([1]);
    expect(rateRun(['good', 'good', 'hard'])[2].interval).toBe(4); // 3 × 1.2, at least +1
    expect(rateRun(['hard'])[0].ease).toBeCloseTo(2.15);
    expect(rateRun(['easy', 'easy']).map((s) => s.interval)).toEqual([3, 4]);
    expect(rateRun(['easy'])[0].ease).toBeCloseTo(2.45);
  });

  it('never lets the ease drop below 1.3', () => {
    const many = rateRun(Array<Grade>(12).fill('again'));
    expect(many[11].ease).toBe(1.3);
  });

  it('labels what each rating would do', () => {
    const srs = newSrs(NOW);
    expect((['again', 'hard', 'good', 'easy'] as Grade[]).map((g) => nextLabel(srs, g, NOW))).toEqual(['10m', '1d', '1d', '3d']);
    // After 37 days, "Good" means 85 days.
    const later = rateRun(['good', 'good', 'good', 'good', 'good'])[4];
    expect(nextLabel(later, 'good', NOW)).toBe('3mo');
    expect([0, 1, 7, 90, 400].map(backLabel)).toEqual(['in 10 minutes', 'tomorrow', 'in 7 days', 'in 3 months', 'in 1.1 years']);
  });
});

describe('due sentences', () => {
  const rated = (id: string, dueIn: number) =>
    sentence(id, { srs: { ...newSrs(NOW), due: NOW + dueIn, last: NOW - DAY, reps: 1, interval: 1 } });

  it('lists the ones due, most overdue first', () => {
    const all = { a: rated('a', -DAY), b: rated('b', DAY), c: rated('c', -2 * DAY), d: sentence('d') };
    expect(dueSentences(all, NOW).map((s) => s.id)).toEqual(['c', 'a', 'd']);
  });

  it('says when each comes back', () => {
    expect(reviewLabel(sentence('n'), NOW)).toBe('new');
    expect(reviewLabel(rated('a', -1), NOW)).toBe('due');
    expect(reviewLabel(rated('a', AGAIN_MS), NOW)).toBe('later today');
    expect(reviewLabel(rated('a', DAY), NOW)).toBe('tomorrow');
    expect(reviewLabel(rated('a', 5 * DAY), NOW)).toBe('in 5 days');
  });

  it('practises this episode first, in video order, then the most overdue episode', () => {
    const at = (id: string, videoId: string, timeMs: number, dueIn: number) =>
      sentence(id, { videoId, from: { timeMs, text: id, lang: 'en' }, srs: { ...newSrs(NOW), due: NOW + dueIn } });
    const due = [
      at('x2', 'other', 9000, -5 * DAY),
      at('h2', 'here', 8000, -1),
      at('y1', 'third', 1000, -9 * DAY),
      at('h1', 'here', 2000, -DAY),
      at('x1', 'other', 3000, -1),
    ];
    expect(practiceOrder(due, 'here')).toEqual(['h1', 'h2', 'y1', 'x1', 'x2']);
    expect(practiceOrder(due, null)).toEqual(['y1', 'x1', 'x2', 'h1', 'h2']);
  });

  it('makes the practice page queue: due, ahead, random, by language', () => {
    const fr = sentence('fr', { lang: 'fr-CA' });
    const all = { a: rated('a', -DAY), b: rated('b', 3 * DAY), c: rated('c', DAY), fr };
    expect(practiceQueue(all, 'due', 'all', NOW)).toEqual(['a', 'fr']);
    expect(practiceQueue(all, 'due', 'fr', NOW)).toEqual(['fr']);
    expect(practiceQueue(all, 'ahead', 'all', NOW)).toEqual(['c', 'b']);
    const random = practiceQueue(all, 'random', 'en', NOW, () => 0);
    expect(random.sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps a Netflix practice session for 30 minutes after the last activity', () => {
    const p = { ids: ['a', 'b'], index: 1, done: 1, at: NOW };
    expect(isFreshSession(p, NOW + PRACTICE_TTL_MS - 1)).toBe(true);
    expect(isFreshSession(p, NOW + PRACTICE_TTL_MS)).toBe(false);
    expect(isFreshSession({ ...p, index: 2 }, NOW)).toBe(false);
    expect(isFreshSession(null, NOW)).toBe(false);
  });
});

describe('lines and drills', () => {
  it('takes every line of the sentence a line belongs to', () => {
    const units = [-1, 0, 0, 1, 2, 2, 2];
    expect(sentenceRange(units, 0)).toEqual([0, 0]);
    expect(sentenceRange(units, 2)).toEqual([1, 2]);
    expect(sentenceRange(units, 3)).toEqual([3, 3]);
    expect(sentenceRange(units, 5)).toEqual([4, 6]);
  });

  it('marks the lines of saved sentences, found again by text and time', () => {
    const cues: Cue[] = [
      { start: 1000, end: 2000, text: 'Where are you' },
      { start: 2100, end: 3000, text: 'going?' },
      { start: 5000, end: 6000, text: 'Home.' },
    ];
    const s = sentence('s', {
      from: { timeMs: 1000, text: 'Where are you', lang: 'en' },
      to: { timeMs: 2100, text: 'going?', lang: 'en' },
    });
    expect([...savedLineMap(cues, [s]).entries()]).toEqual([
      [0, 's'],
      [1, 's'],
    ]);
  });

  it('plays the passes chosen in Options, at least one', () => {
    expect(drillSteps({ drillListen: 2, drillWithText: 2, drillBlind: 2 })).toEqual(['listen', 'listen', 'text', 'text', 'blind', 'blind']);
    expect(drillSteps({ drillListen: 0, drillWithText: 1, drillBlind: 0 })).toEqual(['text']);
    expect(drillSteps({ drillListen: 0, drillWithText: 0, drillBlind: 0 })).toEqual(['text']);
  });

  it('speaks a dialogue without its dashes', () => {
    expect(speechText('- Hi. - Hello there.')).toBe('Hi. Hello there.');
    expect(speechText('A well-known spot.')).toBe('A well-known spot.');
  });

  it('plays a range of lines once and pauses at the end of the last one, with auto-pause off', () => {
    let t = 0;
    let paused = false;
    const cues: Cue[] = [
      { start: 1000, end: 2000, text: 'Where are you' },
      { start: 2100, end: 3000, text: 'going?' },
      { start: 5000, end: 6000, text: 'Home.' },
    ];
    const pb = new PlaybackController({
      now: () => t,
      isPaused: () => paused,
      seek: (ms) => void (t = ms),
      play: () => void (paused = false),
      pause: () => void (paused = true),
    });
    pb.setCues(cues);
    t = 5500;
    pb.tick();
    pb.playRange(0, 1);
    expect(t).toBe(1001);
    for (const at of [1001, 1500, 1950, 2500]) {
      t = at;
      pb.tick();
    }
    expect(paused).toBe(false); // not at the end of the first line
    t = 2930;
    pb.tick();
    expect(paused).toBe(true);
  });
});

describe('mergeSentences', () => {
  it('takes new sentences and newer versions, and skips broken ones', () => {
    const all: Record<string, SavedSentence> = { a: sentence('a', { updatedAt: 10 }), b: sentence('b', { updatedAt: 10 }) };
    const taken = mergeSentences(all, [
      sentence('a', { updatedAt: 20, note: 'newer' }),
      sentence('b', { updatedAt: 5, note: 'older' }),
      sentence('c'),
      { id: 'broken' },
      null,
    ]);
    expect(taken).toBe(2);
    expect(all.a.note).toBe('newer');
    expect(all.b.note).toBeUndefined();
    expect(Object.keys(all).sort()).toEqual(['a', 'b', 'c']);
  });
});
