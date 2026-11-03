import type { ChatUsage } from '../core/chat';
import type { ClaudeCodeStatus } from '../core/types';
import type { ModelReply } from './keylines';
import { nativeRequest, nativeStream } from './native-host';

export interface ClaudeCodeRequest {
  model: string;
  effort?: 'low' | 'medium' | 'high';
  system: string;
  user: string;
  schema: object;
}

/** Claude Code's version and sign-in state; also proves the helper is installed. */
export function claudeCodeStatus(): Promise<ClaudeCodeStatus> {
  return nativeRequest<ClaudeCodeStatus>({ type: 'ping' });
}

/** Run `claude -p` with structured output on the user's Claude subscription. */
export function runClaudeCode(req: ClaudeCodeRequest): Promise<ModelReply> {
  return nativeRequest<ModelReply>({ type: 'run', ...req });
}

/** 💬 A plain-text answer from `claude -p`, streamed to `onDelta` as it is written. */
export function streamClaudeCode(
  req: Omit<ClaudeCodeRequest, 'schema'>,
  onDelta: (text: string) => void,
): { done: Promise<ChatUsage>; stop(): void } {
  const run = nativeStream<ChatUsage>({ type: 'chat', ...req }, onDelta);
  return { done: run.done.then(({ model, inputTokens, outputTokens }) => ({ model, inputTokens, outputTokens })), stop: run.stop };
}
