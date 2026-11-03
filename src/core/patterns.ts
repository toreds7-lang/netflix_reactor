import type { CefrLevel } from './keylines';
import { parseQuery, wordsOf } from './library';

/**
 * ✨ Pattern in 🔎 Find: the key-lines provider (Claude Code or OpenAI) names the reusable frames in a line, such as
 * "I can't believe ___". Chunk counting only finds runs of words without a gap, so this catches the frames it misses.
 * Each frame is then searched as a pattern, ___ standing for a few words.
 */

/** Bump when the prompt changes, so cached answers are made again. */
export const PATTERN_VERSION = 1;

const MAX_FRAMES = 3;

export const PATTERN_SCHEMA = {
  type: 'object',
  properties: { frames: { type: 'array', items: { type: 'string' } } },
  required: ['frames'],
  additionalProperties: false,
} as const;

export interface PatternRequest {
  sentence: string;
  before?: string;
  after?: string;
  lang: string;
}

export function buildPatternPrompt(req: PatternRequest, language: string, level: CefrLevel): { system: string; user: string } {
  const system = [
    `You help a ${level} learner of ${language} speak more naturally by reusing what people say in TV shows.`,
    'Given a line, name the reusable patterns in it: fixed words a speaker reuses with other words in a slot.',
    'Write each slot as ___, for example "I can\'t believe ___", "It\'s not like ___", "What if ___?", "The thing is, ___".',
    'Give 1 to 3 patterns, the most useful for speaking first, each with 2 to 6 fixed words.',
    "Use only words from the line, in the line's order. If the line has no reusable pattern, return an empty list.",
  ].join(' ');
  const user = [
    req.before ? `Line before: ${req.before}` : '',
    `Line: ${req.sentence}`,
    req.after ? `Line after: ${req.after}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { system, user };
}

/**
 * The frames worth searching: each a string with at least one fixed word, all of them in the line (the model may not
 * make words up), at most MAX_FRAMES and none twice.
 */
export function validFrames(raw: unknown, sentence: string, lang: string): string[] {
  const list = (raw as { frames?: unknown } | null)?.frames;
  if (!Array.isArray(list)) return [];
  const inLine = new Set(wordsOf(sentence, lang).map((t) => t.word));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of list) {
    if (typeof f !== 'string' || f.length > 80) continue;
    const frame = f.trim().replace(/_{2,}/g, '___');
    const fixed = parseQuery(frame, lang).filter((p): p is string => p !== null);
    if (!fixed.length || !fixed.every((w) => inLine.has(w))) continue;
    const key = parseQuery(frame, lang).map((p) => p ?? '*').join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(frame);
    if (out.length >= MAX_FRAMES) break;
  }
  return out;
}

/** A frame as a 🔎 search: each ___ becomes *. */
export function frameQuery(frame: string): string {
  return frame.replace(/_{2,}/g, ' * ').replace(/\s+/g, ' ').trim();
}
