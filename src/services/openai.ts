import type { ChatUsage } from '../core/chat';
import type { ModelReply } from './keylines';

const API_URL = 'https://api.openai.com/v1/chat/completions';
// Inlined from .env at build time (wxt.config.ts). Only this background module references them.
const API_KEY = __OPENAI_API_KEY__;
export const OPENAI_MODEL = __LLM_MODEL__;

/** Reasoning models reject `temperature` and take `reasoning_effort` instead. */
const isReasoningModel = (m: string) => /^(od|gpt-5)/.test(m);

interface ChatResponse {
  model: string;
  choices: { finish_reason: string; message: { content: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export interface OpenAIRequest {
  system: string;
  user: string;
  /** Schema name reported to OpenAI, e.g. 'key_lines'. */
  name: string;
  schema: object;
  /** Expected size of the JSON answer in tokens; reasoning models get extra room on top. */
  outputCap: number;
}

/** Ask OpenAI for a JSON answer that follows `schema` (strict structured outputs). */
export async function askOpenAI({ system, user, name, schema, outputCap }: OpenAIRequest): Promise<ModelReply> {
  if (!API_KEY) throw new Error('No OpenAI API key. Set OPENAI_API_KEY in .env and rebuild the extension.');
  const data = await post({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name, strict: true, schema },
    },
    max_completion_tokens: outputCap + (isReasoningModel(OPENAI_MODEL) ? 8000 : 0),
    ...(isReasoningModel(OPENAI_MODEL) ? { reasoning_effort: 'low' } : { temperature: 0 }),
  });
  const choice = data.choices[0];
  if (choice?.message.refusal) throw new Error('OpenAI declined to analyze this episode.');
  if (choice?.finish_reason === 'length') throw new Error('OpenAI response was cut off. Try again.');
  let output: unknown;
  try {
    output = JSON.parse(choice?.message.content ?? '');
  } catch {
    throw new Error('OpenAI returned an unexpected format.');
  }
  return {
    output,
    model: data.model,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

export interface OpenAIStreamRequest {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  outputCap: number;
  signal: AbortSignal;
}

/** 💬 A plain-text answer, streamed to `onDelta` as it is written (server-sent events). */
export async function streamOpenAI(
  { messages, outputCap, signal }: OpenAIStreamRequest,
  onDelta: (text: string) => void,
): Promise<ChatUsage> {
  if (!API_KEY) throw new Error('No OpenAI API key. Set OPENAI_API_KEY in .env and rebuild the extension.');
  const res = await request(
    {
      model: OPENAI_MODEL,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: outputCap + (isReasoningModel(OPENAI_MODEL) ? 8000 : 0),
      ...(isReasoningModel(OPENAI_MODEL) ? { reasoning_effort: 'low' } : { temperature: 0.4 }),
    },
    signal,
  );
  const usage: ChatUsage = { model: OPENAI_MODEL, inputTokens: 0, outputTokens: 0 };
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  let finish = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let at: number;
    while ((at = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, at).trim();
      buf = buf.slice(at + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      const chunk = JSON.parse(data) as StreamChunk;
      if (chunk.model) usage.model = chunk.model;
      if (chunk.usage) {
        usage.inputTokens = chunk.usage.prompt_tokens;
        usage.outputTokens = chunk.usage.completion_tokens;
      }
      const choice = chunk.choices?.[0];
      if (choice?.delta?.refusal) throw new Error('OpenAI declined to answer.');
      if (choice?.delta?.content) onDelta(choice.delta.content);
      if (choice?.finish_reason) finish = choice.finish_reason;
    }
  }
  if (finish === 'length') throw new Error('The answer was cut off. Ask for a shorter one.');
  return usage;
}

interface StreamChunk {
  model?: string;
  choices?: { delta?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
}

async function post(body: unknown): Promise<ChatResponse> {
  return (await (await request(body)).json()) as ChatResponse;
}

/** POST to the API: the response once it is OK, after one retry of a transient error. */
async function request(body: unknown, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new Error('Could not reach the OpenAI API. Check your connection.');
    }
    if (res.ok) return res;
    const err = ((await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null)?.error;
    if (res.status === 401) throw new Error('OpenAI API key was rejected. Check OPENAI_API_KEY in .env and rebuild.');
    if (err?.code === 'insufficient_quota') throw new Error('Your OpenAI account has no credit left (insufficient_quota).');
    // One retry for transient errors; a failed request is not billed, a repeated one would be.
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 3000;
      await new Promise((r) => setTimeout(r, Math.min(wait, 20_000)));
      continue;
    }
    if (res.status === 429) throw new Error('OpenAI rate limit reached. Wait a moment and retry.');
    throw new Error(`OpenAI API error ${res.status}: ${err?.message ?? res.statusText}`);
  }
}
