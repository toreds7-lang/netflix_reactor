import { buildPrompt, normalizeTiers, PROMPT_VERSION, remapTiers, RESPONSE_SCHEMA, targetCount, type CefrLevel } from '../core/keylines';
import { languageName } from '../core/langs';
import { loadSettings, type ClaudeCodeModel, type KeyLinesProvider } from '../core/settings';
import type { KeyLines, KeyLinesRequest, KeyLinesResult } from '../core/types';
import { cachedAnalysis } from './analyses';
import { runClaudeCode } from './claude-code';
import { askOpenAI, OPENAI_MODEL } from './openai';

/** A provider's raw answer: the parsed JSON plus usage. */
export interface ModelReply {
  output: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Pick shadowing and story sentences for a whole episode in one request, cached permanently per episode. */
export async function findKeyLines(req: KeyLinesRequest): Promise<KeyLinesResult | null> {
  const { keyLinesProvider, claudeCodeModel, learnerLevel } = await loadSettings();
  return cachedAnalysis<KeyLines>({
    kind: 'keylines',
    req,
    config: {
      model: keyLinesProvider === 'openai' ? OPENAI_MODEL : claudeCodeModel,
      level: learnerLevel,
      version: PROMPT_VERSION,
    },
    adapt: (r, map) => ({ ...r, shadow: remapTiers(r.shadow, map), story: remapTiers(r.story, map) }),
    run: () => analyze(req, keyLinesProvider, claudeCodeModel, learnerLevel),
  });
}

async function analyze(
  req: KeyLinesRequest,
  provider: KeyLinesProvider,
  claudeCodeModel: ClaudeCodeModel,
  level: CefrLevel,
): Promise<KeyLines> {
  const n = req.lines.length;
  if (!n) throw new Error('This track has no sentences to analyze.');
  const k = targetCount(n);
  const { system, user } = buildPrompt(req.lines, languageName(req.lang), level);
  const reply =
    provider === 'openai'
      ? await askOpenAI({
          system,
          user,
          name: 'key_lines',
          schema: RESPONSE_SCHEMA,
          // 6 tiers of k numbers at up to ~3 tokens each plus JSON overhead.
          outputCap: 18 * k + 200,
        })
      : await runClaudeCode({
          model: claudeCodeModel,
          // Picking lines needs little deliberation. Haiku 4.5 does not accept the effort parameter.
          effort: claudeCodeModel === 'claude-haiku-4-5' ? undefined : 'low',
          system,
          user,
          schema: RESPONSE_SCHEMA,
        });
  const parsed = (reply.output ?? {}) as { shadow?: unknown; story?: unknown };
  return {
    shadow: normalizeTiers(parsed.shadow, n, k),
    story: normalizeTiers(parsed.story, n, k),
    model: reply.model,
    inputTokens: reply.inputTokens,
    outputTokens: reply.outputTokens,
  };
}
