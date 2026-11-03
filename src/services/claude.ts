import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { languageName } from '../core/langs';
import { loadSettings } from '../core/settings';
import type {
  ExplainRequest,
  ExplainResult,
  LineExplainRequest,
  LineExplainResult,
} from '../core/types';
import { cacheGet, cacheSet, hashKey } from './cache';

const WordSchema = z.object({
  lemma: z.string().describe('Dictionary form of the word or phrase'),
  reading: z.string().describe('Pronunciation/romanization (pinyin, furigana+romaji, etc.); empty for Latin-script words'),
  partOfSpeech: z.string(),
  meaningInContext: z.string().describe('What it means in this exact sentence, in the learner language'),
  grammarNote: z.string().describe('Short note on conjugation, grammar, idiom or register; empty if nothing notable'),
  examples: z.array(z.object({ sentence: z.string(), translation: z.string() })),
});

const LineSchema = z.object({
  translation: z.string().describe('Natural translation of the line in the learner language'),
  breakdown: z.array(z.object({ chunk: z.string(), meaning: z.string() })),
  grammarNotes: z.array(z.string()),
});

const SYSTEM = `You are a concise language tutor helping someone learn a language by watching TV shows and films.
You receive a subtitle line with its neighbouring lines for context. Explanations are written in the learner's language.
Keep every field short (one or two sentences at most). Base the meaning on the actual context, not the most common dictionary sense.`;

/** Models that take the server-side refusal fallback. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5']);

async function callClaude<S extends z.ZodType>(schema: S, prompt: string): Promise<{ data: z.infer<S>; model: string }> {
  const settings = await loadSettings();
  if (!settings.claudeApiKey) throw new Error('Add a Claude API key in Options to use explanations.');
  const model = settings.claudeModel;
  const client = new Anthropic({ apiKey: settings.claudeApiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  try {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      output_config: {
        format: betaZodOutputFormat(schema),
        // Haiku 4.5 does not accept the effort parameter.
        ...(model === 'claude-haiku-4-5' ? {} : { effort: 'low' as const }),
      },
      // Opus 5.5 / Opus 5: let the API retry a refused request on a fallback model automatically.
      ...(FALLBACK_MODELS.has(model)
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {}),
    });
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to explain this line.');
    if (response.stop_reason === 'max_tokens') throw new Error('Claude response was cut off. Try again.');
    if (!response.parsed_output) throw new Error('Claude returned an unexpected format.');
    return { data: response.parsed_output as z.infer<S>, model: response.model };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Claude API key was rejected. Check it in Options.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('This Claude API key has no access to the selected model.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Claude rate limit reached. Wait a moment and retry.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the Claude API. Check your connection.');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude API error ${e.status ?? ''}: ${e.message}`);
    throw e;
  }
}

function context(req: { prevLine?: string; nextLine?: string }): string {
  return [
    req.prevLine ? `Previous line: ${req.prevLine}` : null,
    req.nextLine ? `Next line: ${req.nextLine}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function explainWord(req: ExplainRequest): Promise<ExplainResult> {
  const { claudeModel } = await loadSettings();
  const key = await hashKey(['word', claudeModel, req.from, req.to, req.text, req.sentence]);
  const hit = await cacheGet<ExplainResult>('explain', key);
  if (hit) return hit;
  const prompt = `Target language: ${languageName(req.from)} (${req.from})
Learner language: ${languageName(req.to)} (${req.to})
${req.title ? `Show: ${req.title}\n` : ''}${context(req)}
Line: ${req.sentence}

Explain the word or phrase "${req.text}" as it is used in this line. Give 2 short example sentences in the target language with translations.`;
  const { data, model } = await callClaude(WordSchema, prompt);
  const result: ExplainResult = { ...data, model };
  await cacheSet('explain', key, result);
  return result;
}

export async function explainLine(req: LineExplainRequest): Promise<LineExplainResult> {
  const { claudeModel } = await loadSettings();
  const key = await hashKey(['line', claudeModel, req.from, req.to, req.sentence]);
  const hit = await cacheGet<LineExplainResult>('explain', key);
  if (hit) return hit;
  const prompt = `Target language: ${languageName(req.from)} (${req.from})
Learner language: ${languageName(req.to)} (${req.to})
${context(req)}
Line: ${req.sentence}

Translate this line naturally, break it into meaningful chunks (words or short phrases, in order) with their meaning here, and list up to 3 grammar points worth learning.`;
  const { data, model } = await callClaude(LineSchema, prompt);
  const result: LineExplainResult = { ...data, model };
  await cacheSet('explain', key, result);
  return result;
}
