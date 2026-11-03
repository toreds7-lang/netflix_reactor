import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app/controller';
import { readWithBrowserVoice, readWithKokoro, type ReaderEvents } from '../src/app/reader';
import { chat, chatReading, CHAT_READING_IDLE, mainTrack, reading, READING_IDLE, settings, summary, toast } from '../src/app/state';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import type { SiteAdapter } from '../src/sites/adapter';

vi.mock('../src/app/reader', () => ({ readWithKokoro: vi.fn(), readWithBrowserVoice: vi.fn() }));

const kokoro = vi.mocked(readWithKokoro);
const browserVoice = vi.mocked(readWithBrowserVoice);

function setup(lang: string, videoPaused = false) {
  const adapter = { isPaused: () => videoPaused, pause: vi.fn(async () => undefined) };
  const c = new AppController(adapter as unknown as SiteAdapter);
  mainTrack.value = { id: 't', lang, label: lang, kind: 'subtitles', sources: [] };
  settings.value = { ...DEFAULT_SETTINGS, readAloudVoice: 'af_bella', readAloudRate: 0.9, kokoroDevice: 'wasm' };
  summary.value = {
    status: 'ready',
    data: {
      overview: 'One. Two.',
      characters: [],
      scenes: [{ title: 'Three', summary: 'Four.', start: 0, end: 0, evidence: [] }],
      model: 'm',
      inputTokens: 0,
      outputTokens: 0,
      cached: true,
      level: 'B1',
      createdAt: 0,
      current: true,
      adapted: false,
    },
  };
  return { c, adapter };
}

const reader = () => ({ stop: vi.fn() });
let lastEvents: ReaderEvents;

beforeEach(() => {
  reading.value = READING_IDLE;
  kokoro.mockImplementation(async (_texts, _opts, ev) => ((lastEvents = ev), reader()));
  browserVoice.mockImplementation(async (_texts, _lang, _rate, ev) => ((lastEvents = ev), reader()));
});
afterEach(() => vi.clearAllMocks());

describe('AppController.readAloud', () => {
  it('reads English with Kokoro, pauses Netflix and follows the items being read', async () => {
    const { c, adapter } = setup('en');
    await c.readAloud(1, 3);
    expect(kokoro).toHaveBeenCalledWith(['Two.', 'Three.', 'Four.'], { voice: 'af_bella', rate: 0.9, device: 'wasm' }, expect.anything());
    expect(browserVoice).not.toHaveBeenCalled();
    expect(adapter.pause).toHaveBeenCalledOnce();
    expect(reading.value).toMatchObject({ status: 'loading', from: 1, to: 3, item: -1 });

    lastEvents.onLoading(0.5);
    expect(reading.value).toMatchObject({ status: 'loading', progress: 0.5 });
    lastEvents.onItem(1);
    expect(reading.value).toEqual({ status: 'playing', from: 1, to: 3, item: 2 });
    lastEvents.onDone();
    expect(reading.value).toEqual(READING_IDLE);
  });

  it("reads other languages with the browser's voice and leaves a paused video alone", async () => {
    const { c, adapter } = setup('ja', true);
    await c.readAloud(0, 0);
    expect(browserVoice).toHaveBeenCalledWith(['One.'], 'ja', 0.9, expect.anything());
    expect(kokoro).not.toHaveBeenCalled();
    expect(adapter.pause).not.toHaveBeenCalled();
  });

  it('shows errors and goes back to idle', async () => {
    const { c } = setup('en');
    await c.readAloud(0, 3);
    lastEvents.onError('Kokoro: out of memory');
    expect(reading.value).toEqual(READING_IDLE);
    expect(toast.value).toBe('Kokoro: out of memory');
  });

  it('stops the previous reader, and ignores its late events', async () => {
    const { c } = setup('en');
    await c.readAloud(0, 3);
    const first = await kokoro.mock.results[0].value;
    const firstEvents = lastEvents;
    await c.readAloud(3, 3);
    expect(first.stop).toHaveBeenCalled();
    firstEvents.onItem(0);
    firstEvents.onDone();
    expect(reading.value).toMatchObject({ status: 'loading', from: 3, to: 3 });

    c.stopReading();
    expect((await kokoro.mock.results[1].value).stop).toHaveBeenCalled();
    expect(reading.value).toEqual(READING_IDLE);
  });

  it('stops a reader that only finished starting after Stop was pressed', async () => {
    const { c } = setup('en');
    let release!: () => void;
    const late = reader();
    kokoro.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(late))));
    const started = c.readAloud(0, 3);
    c.stopReading();
    release();
    await started;
    expect(late.stop).toHaveBeenCalled();
    expect(reading.value).toEqual(READING_IDLE);
  });
});

describe('AppController.readChat (🔊 on a 💬 answer)', () => {
  const answer = (text: string) => {
    chat.value = { videoId: 'v', messages: [{ id: 'a', role: 'assistant', text, time: 0 }], streaming: null };
  };
  afterEach(() => {
    chat.value = { videoId: null, messages: [], streaming: null };
    chatReading.value = CHAT_READING_IDLE;
  });

  it('reads an English answer with Kokoro, sentence by sentence, without its line numbers', async () => {
    const { c, adapter } = setup('en');
    answer('**"I\'m starving."** [12] means very hungry. People say it a lot.\n\n- *grab a bite* [13]: eat');
    await c.readChat('a');
    expect(kokoro).toHaveBeenCalledWith(
      ['"I\'m starving." means very hungry. ', 'People say it a lot.', 'grab a bite: eat'],
      { voice: 'af_bella', rate: 0.9, device: 'wasm' },
      expect.anything(),
    );
    expect(adapter.pause).toHaveBeenCalledOnce();
    expect(chatReading.value).toEqual({ status: 'loading', id: 'a', progress: null });
    lastEvents.onItem(0);
    expect(chatReading.value).toEqual({ status: 'playing', id: 'a' });
    // The summary's own 🔊 buttons stay as they were.
    expect(reading.value).toEqual(READING_IDLE);
    lastEvents.onDone();
    expect(chatReading.value).toEqual(CHAT_READING_IDLE);
  });

  it("reads a Korean answer with the browser's Korean voice", async () => {
    const { c } = setup('en');
    settings.value = { ...settings.value, nativeLang: 'ko' };
    answer('"Grab a bite" [3]는 간단히 먹는다는 뜻이에요.');
    await c.readChat('a');
    expect(browserVoice).toHaveBeenCalledWith(['"Grab a bite" 는 간단히 먹는다는 뜻이에요.'], 'ko', 0.9, expect.anything());
    expect(kokoro).not.toHaveBeenCalled();
  });

  it('stops reading the summary first, and Stop ends the answer being read', async () => {
    const { c } = setup('en');
    await c.readAloud(0, 1);
    const summaryReader = await kokoro.mock.results[0].value;
    answer('Short answer.');
    await c.readChat('a');
    expect(summaryReader.stop).toHaveBeenCalled();
    expect(reading.value).toEqual(READING_IDLE);
    c.stopReading();
    expect(chatReading.value).toEqual(CHAT_READING_IDLE);
  });
});
