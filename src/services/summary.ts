import type { CefrLevel } from '../core/keylines';
import { languageName } from '../core/langs';
import { loadSettings, type ClaudeCodeModel, type KeyLinesProvider } from '../core/settings';
import { buildSummaryPrompt, normalizeSummary, remapSummary, SUMMARY_SCHEMA, SUMMARY_VERSION } from '../core/summary';
import type { Summary, SummaryRequest, SummaryResult } from '../core/types';
import { cachedAnalysis } from './analyses';
import { runClaudeCode } from './claude-code';
import { askOpenAI, OPENAI_MODEL } from './openai';

/**
 * Summarize a whole episode scene by scene in one request, with the key-lines provider (Claude Code or OpenAI).
 * Cached permanently per episode, language, model and learner level.
 */
export async function summarizeEpisode(req: SummaryRequest): Promise<SummaryResult | null> {
  const { keyLinesProvider, claudeCodeModel, learnerLevel } = await loadSettings();
  return cachedAnalysis<Summary>({
    kind: 'summary',
    req,
    config: {
      model: keyLinesProvider === 'openai' ? OPENAI_MODEL : claudeCodeModel,
      level: learnerLevel,
      version: SUMMARY_VERSION,
    },
    adapt: (r, map, n) => ({ ...r, ...remapSummary(r, map, n) }),
    run: () => summarize(req, keyLinesProvider, claudeCodeModel, learnerLevel),
  });
}

async function summarize(
  req: SummaryRequest,
  provider: KeyLinesProvider,
  claudeCodeModel: ClaudeCodeModel,
  level: CefrLevel,
): Promise<Summary> {
  const n = req.lines.length;
  if (!n) throw new Error('This track has no sentences to summarize.');
  const { system, user } = buildSummaryPrompt(req.lines, languageName(req.lang), level);
  const reply =
    provider === 'openai'
      ? await askOpenAI({
          system,
          user,
          name: 'episode_summary',
          schema: SUMMARY_SCHEMA,
          // Up to ~12 scenes of 1-3 sentences, plus overview and characters; non-Latin scripts take more tokens.
          outputCap: 4000,
        })
      : await runClaudeCode({
          model: claudeCodeModel,
          // Splitting a whole episode into scenes benefits from some thought. Haiku 4.5 does not accept effort.
          effort: claudeCodeModel === 'claude-haiku-4-5' ? undefined : 'medium',
          system,
          user,
          schema: SUMMARY_SCHEMA,
        });
  return {
    ...normalizeSummary(reply.output, n),
    model: reply.model,
    inputTokens: reply.inputTokens,
    outputTokens: reply.outputTokens,
  };
}
