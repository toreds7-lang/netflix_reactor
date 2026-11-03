import { languageName } from '../core/langs';
import { buildPatternPrompt, PATTERN_SCHEMA, PATTERN_VERSION, validFrames, type PatternRequest } from '../core/patterns';
import { loadSettings } from '../core/settings';
import { cacheGet, cacheSet, hashKey } from './cache';
import { runClaudeCode } from './claude-code';
import { askOpenAI, OPENAI_MODEL } from './openai';

/**
 * ✨ Pattern: the reusable frames in a line, from the key-lines provider (Claude Code on your subscription, or OpenAI).
 * One short request per line; the answer is cached, so asking again is free.
 */
export async function findPatterns(req: PatternRequest): Promise<{ frames: string[] }> {
  const { keyLinesProvider, claudeCodeModel, learnerLevel } = await loadSettings();
  const model = keyLinesProvider === 'openai' ? OPENAI_MODEL : claudeCodeModel;
  const key = await hashKey(['pattern', String(PATTERN_VERSION), model, learnerLevel, req.lang, req.sentence]);
  const hit = await cacheGet<string[]>('explain', key);
  if (hit) return { frames: hit };
  const { system, user } = buildPatternPrompt(req, languageName(req.lang), learnerLevel);
  const reply =
    keyLinesProvider === 'openai'
      ? await askOpenAI({ system, user, name: 'patterns', schema: PATTERN_SCHEMA, outputCap: 200 })
      : await runClaudeCode({
          model: claudeCodeModel,
          // Haiku 4.5 does not accept the effort parameter.
          effort: claudeCodeModel === 'claude-haiku-4-5' ? undefined : 'low',
          system,
          user,
          schema: PATTERN_SCHEMA,
        });
  const frames = validFrames(reply.output, req.sentence, req.lang);
  await cacheSet('explain', key, frames);
  return { frames };
}
