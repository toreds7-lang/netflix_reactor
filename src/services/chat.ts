import {
  buildChatSystem,
  CHAT_PORT,
  chatPrompt,
  userTurnText,
  type ChatCommand,
  type ChatEvent,
  type ChatRequest,
  type ChatUsage,
} from '../core/chat';
import { languageName } from '../core/langs';
import { loadSettings } from '../core/settings';
import { streamClaudeCode } from './claude-code';
import { streamOpenAI } from './openai';

/** About 900 words: answers are asked to be short, but a long list should still fit. */
const OUTPUT_CAP = 1500;

/**
 * 💬 Chat about the episode: a page opens a `CHAT_PORT` port and sends one question; the answer streams back over it.
 * Closing the port (■, or the tab going away) stops the answer.
 */
export function watchChat(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== CHAT_PORT || port.sender?.id !== chrome.runtime.id) return;
    let open = true;
    let stop: (() => void) | null = null;
    const post = (e: ChatEvent) => open && port.postMessage(e);
    port.onDisconnect.addListener(() => {
      open = false;
      stop?.();
    });
    port.onMessage.addListener((cmd: ChatCommand) => {
      if (cmd?.type !== 'ask' || stop) return;
      const run = answer(cmd.req, (text) => post({ type: 'delta', text }));
      stop = run.stop;
      run.done.then(
        (usage) => post({ type: 'done', ...usage }),
        (e: unknown) => post({ type: 'error', message: e instanceof Error ? e.message : String(e) }),
      );
    });
  });
}

/** One answer with the key-lines provider (Claude Code or OpenAI, as for summaries), streamed to `onDelta`. */
function answer(req: ChatRequest, onDelta: (text: string) => void): { done: Promise<ChatUsage>; stop(): void } {
  const abort = new AbortController();
  let stopHelper: (() => void) | null = null;
  const done = (async () => {
    if (!req.lines.length) throw new Error('This track has no sentences to chat about yet.');
    const s = await loadSettings();
    const system = buildChatSystem(req.lines, {
      language: languageName(req.lang),
      native: languageName(s.nativeLang),
      level: s.learnerLevel,
      title: req.title,
    });
    if (abort.signal.aborted) throw new Error('Stopped.');
    if (s.keyLinesProvider === 'openai') {
      const messages = req.turns.map((t) => ({ role: t.role, content: t.role === 'user' ? userTurnText(t) : t.text }));
      return streamOpenAI(
        { messages: [{ role: 'system', content: system }, ...messages], outputCap: OUTPUT_CAP, signal: abort.signal },
        onDelta,
      );
    }
    const run = streamClaudeCode(
      {
        model: s.claudeCodeModel,
        // A chat reply should start quickly. Haiku 4.5 does not accept the effort parameter.
        effort: s.claudeCodeModel === 'claude-haiku-4-5' ? undefined : 'low',
        system,
        user: chatPrompt(req.turns),
      },
      onDelta,
    );
    stopHelper = run.stop;
    return run.done;
  })();
  return {
    done,
    stop: () => {
      abort.abort();
      stopHelper?.();
    },
  };
}
