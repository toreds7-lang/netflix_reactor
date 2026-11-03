import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppController } from '../src/app/controller';
import { setController } from '../src/app/instance';
import { chat, chatReading, CHAT_READING_IDLE, currentIndex, mainTrack, rawCues, settings, sidebarTab } from '../src/app/state';
import type { ChatMessage } from '../src/core/chat';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import { Sidebar } from '../src/ui/Sidebar';

const fake = {
  chat: { ask: vi.fn(() => true), stop: vi.fn(), retry: vi.fn(), clear: vi.fn(), goTo: vi.fn() },
  readChat: vi.fn(),
  stopReading: vi.fn(),
};

const question: ChatMessage = { id: 'q', role: 'user', text: 'Why is she hungry?', at: { n: 1, start: 2000, text: "I'm starving." }, time: 0 };
const reply: ChatMessage = {
  id: 'a',
  role: 'assistant',
  text: 'She says **"I\'m starving."** [1] and then:\n\n- "Let\'s grab a bite." [2]\n- something [42]',
  model: 'claude-opus-5-5-20260601',
  refs: { 1: { start: 2000, text: "I'm starving." }, 2: { start: 65_000, text: "Let's grab a bite." } },
  time: 0,
};

describe('💬 Chat tab', () => {
  let root: HTMLElement;
  const box = () => root.querySelector<HTMLTextAreaElement>('textarea.chat-box')!;
  const type = (text: string) => {
    box().value = text;
    act(() => void box().dispatchEvent(new Event('input', { bubbles: true })));
  };
  const key = (init: KeyboardEventInit & { isComposing?: boolean; keyCode?: number }) => {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    if (init.keyCode) Object.defineProperty(e, 'keyCode', { value: init.keyCode });
    act(() => void box().dispatchEvent(e));
    return e;
  };

  beforeEach(() => {
    setController(fake as unknown as AppController);
    settings.value = { ...DEFAULT_SETTINGS, nativeLang: 'ko', learnerLevel: 'B1' };
    rawCues.value = [
      { start: 0, end: 1000, text: 'Hi, Anna.' },
      { start: 2000, end: 3000, text: "I'm starving." },
      { start: 5000, end: 6000, text: "Let's grab a bite." },
    ];
    mainTrack.value = { id: 't', lang: 'en', label: 'English', kind: 'subtitles', sources: [] };
    currentIndex.value = 1;
    chat.value = { videoId: 'v1', messages: [], streaming: null };
    chatReading.value = CHAT_READING_IDLE;
    sidebarTab.value = 'chat';
    root = document.createElement('div');
    document.body.append(root);
    act(() => render(h(Sidebar, null), root));
  });
  afterEach(() => {
    render(null, root);
    root.remove();
    vi.clearAllMocks();
  });

  it('starts with what you can ask, quick questions and the line you are at', () => {
    expect(root.querySelector('.tabs button.on')?.textContent).toBe('💬 Chat');
    expect(root.querySelector('.chat-intro')?.textContent).toContain(
      'Write in Korean or English: the answer comes in the same language, in easy English at your level (B1).',
    );
    const quick = [...root.querySelectorAll<HTMLButtonElement>('.chat-quick button')];
    expect(quick.map((b) => b.textContent)).toEqual([
      '💡 Explain this line',
      '🎬 What just happened?',
      '🗣 Useful phrases',
      '📖 Hard words',
      '❓ Quiz me',
      "👥 Who's who",
    ]);
    expect(root.querySelector('.chat-here')?.textContent).toBe('at 0:02 · “I\'m starving.”');
    expect(root.textContent).toContain('reads all 3 sentences of this episode');

    quick[0].click();
    expect(fake.chat.ask).toHaveBeenCalledWith(expect.stringContaining('Explain the line I am at'), expect.objectContaining({ id: 'line' }));
  });

  it('turns off "Explain this line" before the first line', () => {
    act(() => void (currentIndex.value = -1));
    const first = root.querySelector<HTMLButtonElement>('.chat-quick button')!;
    expect(first.disabled).toBe(true);
    expect(first.title).toBe('Play the video to a line first');
    expect(root.querySelector('.chat-here')).toBeNull();
  });

  it('sends with Enter, not with Shift+Enter or while a Korean word is being typed', () => {
    const send = root.querySelector<HTMLButtonElement>('.chat-send')!;
    expect(send.disabled).toBe(true);
    type('무슨 뜻이야?');
    expect(root.querySelector<HTMLButtonElement>('.chat-send')!.disabled).toBe(false);

    key({ key: 'Enter', shiftKey: true });
    key({ key: 'Enter', isComposing: true });
    key({ key: 'Enter', keyCode: 229 });
    expect(fake.chat.ask).not.toHaveBeenCalled();

    const e = key({ key: 'Enter' });
    expect(e.defaultPrevented).toBe(true);
    expect(fake.chat.ask).toHaveBeenCalledWith('무슨 뜻이야?');
    expect(box().value).toBe('');
  });

  it('keeps typed keys from Netflix and the shortcuts', () => {
    const outside = vi.fn();
    root.addEventListener('keydown', outside);
    type('a');
    key({ key: 'a', code: 'KeyA' });
    expect(outside).not.toHaveBeenCalled();
  });

  it('shows the question with its line and the answer with ▶ buttons for the lines it cites', () => {
    act(() => void (chat.value = { videoId: 'v1', messages: [question, reply], streaming: null }));
    const user = root.querySelector('.chat-msg.user')!;
    expect(user.querySelector('.bubble')?.textContent).toBe('Why is she hungry?');
    expect(user.querySelector('.chat-at')?.textContent).toBe('at 0:02 · “I\'m starving.”');

    const bot = root.querySelector('.chat-msg.bot')!;
    expect(bot.querySelector('b')?.textContent).toBe('"I\'m starving."');
    expect([...bot.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['"Let\'s grab a bite." ▶ 1:05', 'something [42]']);
    const refs = [...bot.querySelectorAll<HTMLButtonElement>('.chat-ref')];
    expect(refs.map((b) => b.textContent)).toEqual(['▶ 0:02', '▶ 1:05']);
    refs[1].click();
    expect(fake.chat.goTo).toHaveBeenCalledWith(2, reply.refs![2]);
    expect(bot.querySelector('.chat-actions')?.textContent).toContain('Claude Opus 5.5');
    expect(root.querySelector('.chat-provider')?.textContent).toBe('Claude Opus 5.5 · Claude Code');

    bot.querySelector<HTMLButtonElement>('button[title="Ask this question again"]')!.click();
    expect(fake.chat.retry).toHaveBeenCalledOnce();
  });

  it('shows dots until the first words, then a caret, and ■ stops the answer', () => {
    const writing: ChatMessage = { id: 'a', role: 'assistant', text: '', time: 0 };
    act(() => void (chat.value = { videoId: 'v1', messages: [question, writing], streaming: 'a' }));
    expect(root.querySelector('.chat-typing')).not.toBeNull();
    expect(root.querySelector('.chat-actions')).toBeNull();
    expect([...root.querySelectorAll<HTMLButtonElement>('.chat-quick button')].every((b) => b.disabled)).toBe(true);

    act(() => void (chat.value = { ...chat.value, messages: [question, { ...writing, text: 'It means' }] }));
    expect(root.querySelector('.chat-typing')).toBeNull();
    expect(root.querySelector('.chat-msg.bot p .chat-caret')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('.chat-send.stop')!.click();
    expect(fake.chat.stop).toHaveBeenCalledOnce();
  });

  it('reads an answer aloud, and shows the voice loading and ■ to stop', () => {
    act(() => void (chat.value = { videoId: 'v1', messages: [question, reply], streaming: null }));
    const speak = () => root.querySelector<HTMLButtonElement>('.chat-actions button.speak')!;
    speak().click();
    expect(fake.readChat).toHaveBeenCalledWith('a');

    act(() => void (chatReading.value = { status: 'loading', id: 'a', progress: 0.3 }));
    expect(speak().title).toBe('Loading voice… 30%');
    act(() => void (chatReading.value = { status: 'playing', id: 'a' }));
    expect(speak().textContent).toBe('■');
    speak().click();
    expect(fake.stopReading).toHaveBeenCalledOnce();
  });

  it('asks before New chat forgets the chat', () => {
    act(() => void (chat.value = { videoId: 'v1', messages: [question, reply], streaming: null }));
    const clear = () => root.querySelector<HTMLButtonElement>('.chat-head button')!;
    expect(clear().textContent).toBe('✚ New chat');
    act(() => clear().click());
    expect(clear().textContent).toBe('Clear the chat?');
    expect(fake.chat.clear).not.toHaveBeenCalled();
    act(() => clear().click());
    expect(fake.chat.clear).toHaveBeenCalledOnce();
  });

  it('waits for subtitles', () => {
    act(() => void (rawCues.value = []));
    expect(root.textContent).toContain('Waiting for subtitles… Start playing the video.');
    expect(root.querySelector('textarea')).toBeNull();
  });
});
