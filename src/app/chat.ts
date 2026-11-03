import { effect, untracked } from '@preact/signals';
import {
  CHAT_PORT,
  chatTurns,
  citedNumbers,
  findChatRef,
  type ChatCommand,
  type ChatEvent,
  type ChatMessage,
  type ChatRef,
  type ChatRequest,
  type QuickQuestion,
} from '../core/chat';
import { getChat, saveChat } from '../chat/store';
import type { AppController } from './controller';
import {
  chat,
  chatFocusAt,
  chatReading,
  cueUnits,
  currentIndex,
  floatWin,
  keyUnits,
  mainLang,
  settings,
  showToast,
  sidebarTab,
  updateSettings,
  videoId,
} from './state';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * 💬 Chat about the episode open now, on the Netflix page: questions go to the key-lines provider with the whole
 * episode, answers stream in, and each episode keeps its chat.
 */
export class ChatController {
  /** The port the answer being written comes over. */
  private port: chrome.runtime.Port | null = null;
  private loadGen = 0;

  constructor(private readonly app: AppController) {}

  /** Follow the episode open now; returns a function that stops following it. */
  init(): () => void {
    return effect(() => {
      const id = videoId.value;
      untracked(() => void this.load(id));
    });
  }

  /** Show the chat of episode `id`, saved earlier. */
  private async load(id: string | null): Promise<void> {
    if (chat.peek().videoId === id) return;
    this.stop();
    if (chatReading.peek().status !== 'idle') this.app.stopReading();
    const gen = ++this.loadGen;
    chat.value = { videoId: id, messages: [], streaming: null };
    if (!id) return;
    const saved = await getChat(id).catch(() => [] as ChatMessage[]);
    // Messages asked meanwhile go after the saved ones.
    if (gen === this.loadGen && saved.length) chat.value = { ...chat.peek(), messages: [...saved, ...chat.peek().messages] };
  }

  /** The chat key: show the 💬 tab, with the sidebar if it was hidden, and put the cursor in the box. */
  open(): void {
    sidebarTab.value = 'chat';
    const s = settings.peek();
    if (!s.sidebarOpen && !s.floating && !floatWin.peek()) updateSettings({ sidebarOpen: true });
    chatFocusAt.value = Date.now();
  }

  /** The sentence the learner is at, or undefined before the first line. */
  here(): (ChatRef & { n: number }) | undefined {
    const n = cueUnits.peek()[currentIndex.peek()] ?? -1;
    const u = keyUnits.peek()[n];
    return u ? { n, start: u.start, text: u.text } : undefined;
  }

  /** Ask a typed question, or a quick question (its button's label shows instead of its text). */
  ask(text: string, quick?: QuickQuestion): boolean {
    const q = text.trim();
    if (!q || !videoId.peek() || chat.peek().streaming) return false;
    if (!keyUnits.peek().length || !mainLang.peek()) {
      showToast('Waiting for subtitles… Start playing the video.');
      return false;
    }
    const at = this.here();
    if (quick?.needsLine && !at) {
      showToast('Play the video to a line first');
      return false;
    }
    const user: ChatMessage = { id: newId(), role: 'user', text: q, ...(quick ? { label: quick.label } : {}), at, time: Date.now() };
    this.run(chat.peek().messages, user);
    return true;
  }

  /** ↻ on the last answer: ask its question again, from where it was asked. */
  retry(): void {
    const { messages, streaming } = chat.peek();
    const n = messages.length;
    if (streaming || n < 2 || messages[n - 1].role !== 'assistant' || messages[n - 2].role !== 'user') return;
    this.run(messages.slice(0, n - 2), { ...messages[n - 2], time: Date.now() });
  }

  /** ■ Stop the answer being written; what came so far stays. */
  stop(): void {
    const id = chat.peek().streaming;
    if (!id) return;
    this.port?.disconnect();
    this.port = null;
    this.finish(id, { stopped: true });
  }

  /** New chat: forget this episode's messages. */
  clear(): void {
    this.stop();
    if (chatReading.peek().status !== 'idle') this.app.stopReading();
    chat.value = { ...chat.peek(), messages: [] };
    this.save();
  }

  /** Play sentence `n` an answer cites (found again by its text and time when the answer saved it). */
  goTo(n: number, ref?: ChatRef): void {
    const units = keyUnits.peek();
    const i = ref ? findChatRef(units, ref) : units[n] ? n : -1;
    if (i >= 0) this.app.goToSentence(i);
  }

  private run(earlier: ChatMessage[], user: ChatMessage): void {
    const answer: ChatMessage = { id: newId(), role: 'assistant', text: '', time: Date.now() };
    chat.value = { ...chat.peek(), messages: [...earlier, user, answer], streaming: answer.id };
    this.save();
    const req: ChatRequest = {
      title: this.app.titleOf(),
      lang: mainLang.peek(),
      lines: keyUnits.peek().map((u) => u.text),
      turns: chatTurns(earlier, user),
    };
    let port: chrome.runtime.Port;
    try {
      // A content script left behind by an extension reload has no runtime id.
      if (!globalThis.chrome?.runtime?.id) throw new Error('Polyglot Player was reloaded or updated. Refresh this page to reconnect.');
      port = chrome.runtime.connect({ name: CHAT_PORT });
    } catch (e) {
      this.finish(answer.id, { error: errMsg(e) });
      return;
    }
    this.port = port;
    port.onMessage.addListener((e: ChatEvent) => {
      if (this.port !== port) return;
      if (e.type === 'delta') {
        this.edit(answer.id, (m) => ({ ...m, text: m.text + e.text }));
        return;
      }
      this.port = null;
      port.disconnect();
      this.finish(answer.id, e.type === 'done' ? { model: e.model } : { error: e.message });
    });
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      this.port = null;
      this.finish(answer.id, { error: 'The extension stopped before the answer was finished. Try again.' });
    });
    port.postMessage({ type: 'ask', req } satisfies ChatCommand);
  }

  private edit(id: string, fn: (m: ChatMessage) => ChatMessage): void {
    const c = chat.peek();
    chat.value = { ...c, messages: c.messages.map((m) => (m.id === id ? fn(m) : m)) };
  }

  /** The answer is complete, stopped or failed: keep the sentences it cites, and save the chat. */
  private finish(id: string, patch: Partial<ChatMessage>): void {
    const units = keyUnits.peek();
    this.edit(id, (m) => {
      const refs: Record<number, ChatRef> = {};
      for (const n of citedNumbers(m.text)) if (units[n]) refs[n] = { start: units[n].start, text: units[n].text };
      return { ...m, ...patch, refs };
    });
    if (chat.peek().streaming === id) chat.value = { ...chat.peek(), streaming: null };
    this.save();
  }

  private save(): void {
    const { videoId: id, messages } = chat.peek();
    if (id) saveChat(id, messages, this.app.titleOf()).catch(() => undefined);
  }
}
