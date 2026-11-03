import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatController } from '../src/app/chat';
import type { AppController } from '../src/app/controller';
import {
  chat,
  chatFocusAt,
  currentIndex,
  mainTrack,
  rawCues,
  settings,
  sidebarTab,
  toast,
  videoId,
} from '../src/app/state';
import type { ChatCommand, ChatEvent, ChatMessage } from '../src/core/chat';
import { DEFAULT_SETTINGS } from '../src/core/settings';

class FakePort {
  private onMsg: ((e: ChatEvent) => void)[] = [];
  private onGone: (() => void)[] = [];
  posted: ChatCommand[] = [];
  disconnected = false;
  onMessage = { addListener: (f: (e: ChatEvent) => void) => this.onMsg.push(f) };
  onDisconnect = { addListener: (f: () => void) => this.onGone.push(f) };
  postMessage = (m: ChatCommand) => this.posted.push(m);
  disconnect = () => void (this.disconnected = true);
  emit(e: ChatEvent) {
    this.onMsg.forEach((f) => f(e));
  }
  drop() {
    this.onGone.forEach((f) => f());
  }
}

let ports: FakePort[] = [];
let store: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  runtime: {
    id: 'ext',
    connect: vi.fn(() => {
      const p = new FakePort();
      ports.push(p);
      return p;
    }),
  },
  storage: {
    local: {
      get: async (k: string) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
      set: async (o: Record<string, unknown>) => void Object.assign(store, structuredClone(o)),
      remove: async (k: string) => void delete store[k],
    },
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const app = { titleOf: () => 'Show · Ep 1', goToSentence: vi.fn(), stopReading: vi.fn() };
const answer = () => chat.value.messages.at(-1)!;

let c: ChatController;
let dispose: () => void;

beforeEach(() => {
  ports = [];
  store = {};
  settings.value = DEFAULT_SETTINGS;
  chat.value = { videoId: null, messages: [], streaming: null };
  rawCues.value = [
    { start: 0, end: 1000, text: 'Hi, Anna.' },
    { start: 2000, end: 3000, text: "I'm starving." },
    { start: 5000, end: 6000, text: "Let's grab a bite." },
  ];
  mainTrack.value = { id: 't', lang: 'en', label: 'English', kind: 'subtitles', sources: [] };
  currentIndex.value = 1;
  videoId.value = 'v1';
  c = new ChatController(app as unknown as AppController);
  dispose = c.init();
});
afterEach(() => {
  dispose();
  videoId.value = null;
  vi.clearAllMocks();
});

describe('ChatController', () => {
  it('sends the whole episode with the question and where you are, and streams the answer in', async () => {
    expect(c.ask('  What does "starving" mean?  ')).toBe(true);
    const [port] = ports;
    expect(port.posted).toEqual([
      {
        type: 'ask',
        req: {
          title: 'Show · Ep 1',
          lang: 'en',
          lines: ['Hi, Anna.', "I'm starving.", "Let's grab a bite."],
          turns: [{ role: 'user', text: 'What does "starving" mean?', quick: false, at: 1 }],
        },
      },
    ]);
    expect(chat.value.messages[0]).toMatchObject({ role: 'user', at: { n: 1, start: 2000, text: "I'm starving." } });
    expect(chat.value.streaming).toBe(answer().id);
    // A second question waits for the answer.
    expect(c.ask('another')).toBe(false);

    port.emit({ type: 'delta', text: '"I\'m starving." [1] means ' });
    port.emit({ type: 'delta', text: 'very hungry. See [2] and [9].' });
    expect(answer().text).toBe('"I\'m starving." [1] means very hungry. See [2] and [9].');
    port.emit({ type: 'done', model: 'claude-opus-5-5', inputTokens: 900, outputTokens: 40 });

    expect(port.disconnected).toBe(true);
    expect(chat.value.streaming).toBeNull();
    // The cited lines are kept with the answer, so they are found again after a track switch. [9] isn't a line.
    expect(answer()).toMatchObject({
      model: 'claude-opus-5-5',
      refs: { 1: { start: 2000, text: "I'm starving." }, 2: { start: 5000, text: "Let's grab a bite." } },
    });
    await tick();
    const saved = store['chat:v1'] as { messages: ChatMessage[]; title: string };
    expect(saved.title).toBe('Show · Ep 1');
    expect(saved.messages.map((m) => m.text)).toEqual(['What does "starving" mean?', answer().text]);
  });

  it('sends the chat so far with the next question', () => {
    c.ask('Q1');
    ports[0].emit({ type: 'delta', text: 'A1' });
    ports[0].emit({ type: 'done', model: 'm', inputTokens: 0, outputTokens: 0 });
    currentIndex.value = 2;
    c.ask('Explain the line I am at.', { id: 'line', label: '💡 Explain this line', text: '', needsLine: true });
    expect(ports[1].posted[0].req.turns).toEqual([
      { role: 'user', text: 'Q1', quick: false, at: 1 },
      { role: 'assistant', text: 'A1' },
      { role: 'user', text: 'Explain the line I am at.', quick: true, at: 2 },
    ]);
    expect(chat.value.messages.at(-2)?.label).toBe('💡 Explain this line');
  });

  it('stops an answer and keeps what came so far', () => {
    c.ask('Q');
    ports[0].emit({ type: 'delta', text: 'Half an ans' });
    c.stop();
    expect(ports[0].disconnected).toBe(true);
    expect(answer()).toMatchObject({ text: 'Half an ans', stopped: true });
    expect(chat.value.streaming).toBeNull();
    // Late pieces of the stopped answer are ignored.
    ports[0].emit({ type: 'delta', text: 'wer' });
    expect(answer().text).toBe('Half an ans');
  });

  it('shows errors, and ↻ asks the same question again from the same line', () => {
    c.ask('Q');
    ports[0].emit({ type: 'error', message: 'Claude Code is not signed in.' });
    expect(answer()).toMatchObject({ text: '', error: 'Claude Code is not signed in.' });

    currentIndex.value = 2;
    c.retry();
    expect(chat.value.messages).toHaveLength(2);
    expect(ports[1].posted[0].req.turns).toEqual([{ role: 'user', text: 'Q', quick: false, at: 1 }]);

    ports[1].drop();
    expect(answer().error).toBe('The extension stopped before the answer was finished. Try again.');
  });

  it('needs subtitles, and a line for "Explain this line"', () => {
    currentIndex.value = -1;
    expect(c.ask('x', { id: 'line', label: 'L', text: 'x', needsLine: true })).toBe(false);
    expect(toast.value).toBe('Play the video to a line first');
    rawCues.value = [];
    expect(c.ask('x')).toBe(false);
    expect(toast.value).toBe('Waiting for subtitles… Start playing the video.');
    expect(ports).toHaveLength(0);
  });

  it('keeps a chat per episode, and New chat forgets it', async () => {
    c.ask('Q');
    ports[0].emit({ type: 'done', model: 'm', inputTokens: 0, outputTokens: 0 });
    videoId.value = 'v2';
    await tick();
    expect(chat.value).toEqual({ videoId: 'v2', messages: [], streaming: null });

    videoId.value = 'v1';
    await tick();
    expect(chat.value.messages.map((m) => m.role)).toEqual(['user', 'assistant']);

    c.clear();
    await tick();
    expect(chat.value.messages).toEqual([]);
    expect(store['chat:v1']).toBeUndefined();
  });

  it('plays a cited line, found again by its text and time', () => {
    c.goTo(1, { start: 4900, text: "Let's grab a bite." });
    expect(app.goToSentence).toHaveBeenLastCalledWith(2);
    c.goTo(0);
    expect(app.goToSentence).toHaveBeenLastCalledWith(0);
    c.goTo(7);
    expect(app.goToSentence).toHaveBeenCalledTimes(2);
  });

  it('the chat key opens the tab with the sidebar and asks for the cursor', () => {
    settings.value = { ...DEFAULT_SETTINGS, sidebarOpen: false };
    sidebarTab.value = 'subs';
    c.open();
    expect(sidebarTab.value).toBe('chat');
    expect(settings.value.sidebarOpen).toBe(true);
    expect(Date.now() - chatFocusAt.value).toBeLessThan(1000);
  });
});
