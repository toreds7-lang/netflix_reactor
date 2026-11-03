import { flatten, stripSoundDescriptions } from './subtitles';
import type { Cue } from './types';

/** A sentence built from one or more consecutive cues. */
export interface KeyUnit {
  start: number;
  end: number;
  text: string;
}

export interface TimeRange {
  start: number;
  end: number;
}

/** 1 = 10%, 2 = 20%, 3 = 30% of all sentences. */
export type KeyLevel = 1 | 2 | 3;

/** The learner's CEFR level in the language being learned; tunes the shadowing picks. */
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

/**
 * Bump when the prompt or sentence building changes. Older results still show, marked as made with other settings,
 * until the episode is analyzed again, so keep the stored shape (`KeyLines`) readable.
 */
export const PROMPT_VERSION = 2;

const MERGE_GAP_MS = 1200;
const MAX_CUES_PER_UNIT = 4;
const MAX_UNIT_CHARS = 220;
const TERMINAL = /[.?!…。？！」』"”]$/;
const LYRICS = /^[\s-]*[♪♫]/;

/** Does `next` continue the sentence that `prev` left open? */
function continues(prev: string, next: string): boolean {
  if (/^[-‐–—]/.test(next)) return false; // a new speaker
  if (/^(\.\.\.|…)/.test(next)) return true; // "I was..." / "...thinking"
  return !TERMINAL.test(prev);
}

/**
 * Join cue fragments into sentences. Sound descriptions, speaker labels and song lyrics are
 * dropped, so the result does not depend on the [SDH] display setting.
 */
export function buildUnits(raw: Cue[]): KeyUnit[] {
  const units: KeyUnit[] = [];
  let cur: (KeyUnit & { count: number }) | null = null;
  for (const cue of raw) {
    if (LYRICS.test(cue.text)) {
      cur = null;
      continue;
    }
    const text = flatten(stripSoundDescriptions(cue.text));
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    if (
      cur &&
      cur.count < MAX_CUES_PER_UNIT &&
      cur.text.length + text.length < MAX_UNIT_CHARS &&
      cue.start - cur.end < MERGE_GAP_MS &&
      continues(cur.text, text)
    ) {
      cur.text += ` ${text}`;
      cur.end = Math.max(cur.end, cue.end);
      cur.count++;
      continue;
    }
    cur = { start: cue.start, end: cue.end, text, count: 1 };
    units.push(cur);
  }
  return units.map(({ start, end, text }) => ({ start, end, text }));
}

/** Sentences per tier: 10% of the transcript. */
export function targetCount(n: number): number {
  return Math.max(1, Math.round(n * 0.1));
}

const SYSTEM = `You select sentences from the transcript of one TV episode or film for a language learner.
Input: the language, the learner's CEFR level, N (number of sentences), K, and numbered sentences "i|text".
Return two selections of sentence numbers.

shadow: the best sentences for this learner to practise by shadowing (listening and repeating aloud).
- Natural, high-frequency spoken language the learner can reuse in daily life: common chunks, idioms, phrasal verbs, typical reactions and requests.
- Pitched just above the learner's level: mostly words and grammar they already know, plus a useful new chunk or two.
- Length to suit the level: A1-A2 short and simple (about 3-8 words), B1-B2 everyday sentences (about 5-14 words), C1-C2 longer sentences, idioms and fast colloquial speech (up to about 20 words).
- Complete, self-contained sentences with a clear rhythm.
- Avoid lines that are mostly names, jargon, shouting, fragments or profanity.

story: the sentences a viewer needs to follow the plot: key facts, goals, conflicts, decisions, reveals, twists, relationships and how things end.
- Cover the whole transcript from beginning to end, not just the opening.

Each selection has three tiers ordered by importance: t1 (most important), t2 (next), t3 (next). Each tier holds exactly K different sentence numbers.
A number appears at most once per selection; the same sentence may appear in both selections.
Output sentence numbers only.`;

/** Static instructions first (a stable prefix), then the episode. Timestamps are left out to save tokens. */
export function buildPrompt(texts: string[], language: string, level: CefrLevel): { system: string; user: string } {
  const lines = texts.map((t, i) => `${i}|${t}`).join('\n');
  return {
    system: SYSTEM,
    user: `Language: ${language}\nLearner level: ${level} (CEFR)\nN: ${texts.length}\nK: ${targetCount(texts.length)}\n\n${lines}`,
  };
}

const intList = { type: 'array', items: { type: 'integer' } };
const tiersSchema = {
  type: 'object',
  properties: { t1: intList, t2: intList, t3: intList },
  required: ['t1', 't2', 't3'],
  additionalProperties: false,
};

/** Strict JSON schema for structured outputs (OpenAI and Claude Code). */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: { shadow: tiersSchema, story: tiersSchema },
  required: ['shadow', 'story'],
  additionalProperties: false,
};

/**
 * Clean one selection from the model: drop invalid and repeated numbers and cap each tier at k.
 * A tier's overflow moves down to the next tier, keeping the model's order.
 */
export function normalizeTiers(raw: unknown, n: number, k: number): number[][] {
  const src = (raw ?? {}) as { t1?: unknown; t2?: unknown; t3?: unknown };
  const out: number[][] = [[], [], []];
  const seen = new Set<number>();
  [src.t1, src.t2, src.t3].forEach((tier, s) => {
    if (!Array.isArray(tier)) return;
    for (const v of tier) {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= n || seen.has(v)) continue;
      let t = s;
      while (t < 3 && out[t].length >= k) t++;
      if (t >= 3) return;
      out[t].push(v);
      seen.add(v);
    }
  });
  return out;
}

/** Move tiers to changed subtitles: `map[i]` is sentence i's new index, or -1 when it is gone. */
export function remapTiers(tiers: number[][], map: number[]): number[][] {
  return tiers.map((tier) => tier.map((i) => map[i] ?? -1).filter((j) => j >= 0));
}

/** Sentence indices selected at a level (the union of the first `level` tiers). */
export function pickLevel(tiers: number[][], level: KeyLevel): Set<number> {
  return new Set(tiers.slice(0, level).flat());
}

/** For each displayed cue, the index of the sentence it belongs to, or -1. Both lists are sorted by start. */
export function cueUnitIndex(cues: Cue[], units: KeyUnit[]): number[] {
  const out = new Array<number>(cues.length).fill(-1);
  let u = 0;
  cues.forEach((c, i) => {
    while (u < units.length && units[u].end <= c.start) u++;
    if (u < units.length && units[u].start <= c.start) out[i] = u;
  });
  return out;
}

/**
 * Where to go from line `cur` among the sorted line indices `lines` (the key lines): the first one after it, or the
 * last one before it. -1 when there is none. Every line of a key sentence counts, as each has its own mark in the list.
 */
export function stepAmong(lines: number[], cur: number, dir: 1 | -1): number {
  if (dir > 0) return lines.find((i) => i > cur) ?? -1;
  for (let k = lines.length - 1; k >= 0; k--) if (lines[k] < cur) return lines[k];
  return -1;
}

/** Pad, sort and join time ranges so skip mode doesn't seek for short gaps. */
export function mergeRanges(ranges: TimeRange[], padBefore = 300, padAfter = 400, joinGap = 2500): TimeRange[] {
  const sorted = ranges
    .map((r) => ({ start: Math.max(0, r.start - padBefore), end: r.end + padAfter }))
    .sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start - last.end <= joinGap) last.end = Math.max(last.end, r.end);
    else out.push(r);
  }
  return out;
}
