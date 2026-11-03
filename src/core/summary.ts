import type { CefrLevel } from './keylines';
import type { EpisodeSummary, SummaryScene } from './types';

/**
 * Bump when the prompt or the normalization changes. Older summaries still show, marked as made with other settings,
 * until the episode is summarized again, so keep the stored shape (`EpisodeSummary`) readable.
 */
export const SUMMARY_VERSION = 1;

const MAX_SCENES = 15;
const MAX_CHARACTERS = 12;
const MAX_EVIDENCE = 3;

/** About one scene per 50 sentences (roughly 4 minutes of dialogue), between 3 and 12. */
export function sceneCount(n: number): number {
  return Math.min(12, Math.max(3, Math.round(n / 50)));
}

const SYSTEM = `You summarize one TV episode or film from its subtitle transcript for a language learner.
Input: the language, the learner's CEFR level, N (number of sentences), S (about how many scenes) and numbered sentences "i|text".

Write every text field in the given language, with vocabulary and grammar the learner can read at their level:
short, simple sentences at A1-A2, clear everyday sentences at B1-B2, natural native-like prose at C1-C2.
Keep names as they appear in the transcript.

Use only what the transcript says. Subtitles have no speaker names or pictures, so when it is unclear who speaks or what happens, say that briefly instead of guessing.

overview: 2-3 sentences: the main situation, the central conflict and how the episode ends.
characters: the important people (at most 10), each with a short role: who they are and how they relate to the others. Leave out people who are only mentioned in passing.
scenes: about S scenes in story order that together cover the whole transcript.
- start: the number of the scene's first sentence. The first scene starts at 0; each scene lasts until the next one starts.
- title: a few words.
- summary: 1-3 sentences on what happens and why it matters.
- evidence: 1-3 sentence numbers from this scene that best support the summary.`;

/** Static instructions first (a stable prefix), then the episode. Same numbered format as key lines. */
export function buildSummaryPrompt(texts: string[], language: string, level: CefrLevel): { system: string; user: string } {
  const lines = texts.map((t, i) => `${i}|${t}`).join('\n');
  return {
    system: SYSTEM,
    user: `Language: ${language}\nLearner level: ${level} (CEFR)\nN: ${texts.length}\nS: ${sceneCount(texts.length)}\n\n${lines}`,
  };
}

/** Strict JSON schema for structured outputs (OpenAI and Claude Code). */
export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, role: { type: 'string' } },
        required: ['name', 'role'],
        additionalProperties: false,
      },
    },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'integer' },
          title: { type: 'string' },
          summary: { type: 'string' },
          evidence: { type: 'array', items: { type: 'integer' } },
        },
        required: ['start', 'title', 'summary', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['overview', 'characters', 'scenes'],
  additionalProperties: false,
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const isIndex = (v: unknown, n: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n;

/**
 * Clean the model's summary for `n` sentences:
 * - scenes with an invalid start or no text are dropped, the rest are sorted by start (one scene per start);
 * - the scenes are made to cover every sentence: the first starts at 0 and each ends where the next begins;
 * - evidence keeps only numbers inside its own scene, without repeats, at most 3.
 */
export function normalizeSummary(raw: unknown, n: number): EpisodeSummary {
  const src = (raw ?? {}) as { overview?: unknown; characters?: unknown; scenes?: unknown };

  const characters = (Array.isArray(src.characters) ? src.characters : [])
    .map((c) => ({ name: str(c?.name), role: str(c?.role) }))
    .filter((c) => c.name)
    .slice(0, MAX_CHARACTERS);

  const picked = (Array.isArray(src.scenes) ? src.scenes : [])
    .map((s) => ({ start: s?.start as unknown, title: str(s?.title), summary: str(s?.summary), evidence: s?.evidence as unknown }))
    .filter((s): s is typeof s & { start: number } => isIndex(s.start, n) && !!(s.title || s.summary))
    .sort((a, b) => a.start - b.start)
    .filter((s, i, list) => i === 0 || s.start !== list[i - 1].start)
    .slice(0, MAX_SCENES);

  const scenes = picked.map((s, i): SummaryScene => {
    const start = i === 0 ? 0 : s.start;
    const end = i + 1 < picked.length ? picked[i + 1].start - 1 : n - 1;
    const evidence = [...new Set(Array.isArray(s.evidence) ? s.evidence : [])]
      .filter((v): v is number => isIndex(v, n) && v >= start && v <= end)
      .slice(0, MAX_EVIDENCE);
    return { title: s.title, summary: s.summary, start, end, evidence };
  });

  return { overview: str(src.overview), characters, scenes };
}

/**
 * Move a summary to changed subtitles with `n` sentences: `map[i]` is sentence i's new index, or -1 when it is gone.
 * A scene starts at its first sentence that is still there; a scene with none left is dropped and the one before it
 * grows to cover the gap.
 */
export function remapSummary(summary: EpisodeSummary, map: number[], n: number): EpisodeSummary {
  const firstKept = (sc: SummaryScene) => {
    for (let i = sc.start; i <= sc.end; i++) if ((map[i] ?? -1) >= 0) return map[i];
    return -1;
  };
  return normalizeSummary(
    {
      overview: summary.overview,
      characters: summary.characters,
      scenes: summary.scenes.map((sc) => ({ ...sc, start: firstKept(sc), evidence: sc.evidence.map((e) => map[e] ?? -1) })),
    },
    n,
  );
}

/** Index of the scene that contains sentence `unit`, or -1. */
export function sceneAt(scenes: SummaryScene[], unit: number): number {
  if (unit < 0) return -1;
  return scenes.findIndex((s) => unit >= s.start && unit <= s.end);
}
