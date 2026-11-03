import { describe, expect, it } from 'vitest';
import {
  answerLang,
  buildChatSystem,
  chatPrompt,
  chatTurns,
  citedNumbers,
  findChatRef,
  parseAnswer,
  parseInline,
  plainAnswer,
  speechBlocks,
  userTurnText,
  type ChatMessage,
} from '../src/core/chat';

const msg = (role: ChatMessage['role'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `${role}-${text}`,
  role,
  text,
  time: 0,
  ...extra,
});

describe('chat prompt', () => {
  it('puts the rules, the languages and the numbered episode in the system prompt', () => {
    const system = buildChatSystem(['Hi.', "I'm starving."], { language: 'English', native: 'Korean', level: 'B1', title: 'Show · Ep 1' });
    expect(system).toContain("The learner's own language is Korean; their level in English is B1 (CEFR).");
    expect(system).toContain('or in Korean if they have not typed one yet');
    expect(system.endsWith("Title: Show · Ep 1\nLanguage: English\nSentences: 2\n\n0|Hi.\n1|I'm starving.")).toBe(true);
  });

  it('marks quick questions and where the learner is', () => {
    expect(userTurnText({ role: 'user', text: 'Explain it.', quick: true, at: 57 })).toBe('[button] (at [57]) Explain it.');
    expect(userTurnText({ role: 'user', text: '무슨 뜻이야?', at: -1 })).toBe('무슨 뜻이야?');
  });

  it('sends a first question alone, later ones after the chat so far', () => {
    expect(chatPrompt([{ role: 'user', text: 'Hi', at: 3 }])).toBe('(at [3]) Hi');
    expect(
      chatPrompt([
        { role: 'user', text: 'Q1', at: 3 },
        { role: 'assistant', text: 'A1 [3]' },
        { role: 'user', text: 'Q2', quick: true, at: 9 },
      ]),
    ).toBe("The chat so far:\n\nLearner: (at [3]) Q1\n\nYou: A1 [3]\n\nThe learner's new message:\n\n[button] (at [9]) Q2");
  });

  it('keeps the newest messages, drops answers that failed empty, and starts with a question', () => {
    const at = { n: 4, start: 1000, text: 'x' };
    const earlier = [
      msg('user', 'old question'),
      msg('assistant', 'x'.repeat(11_990)),
      msg('user', 'failed question', { at }),
      msg('assistant', '', { error: 'boom' }),
      msg('user', 'quick', { label: '💡 Explain this line' }),
      msg('assistant', 'answer'),
    ];
    const turns = chatTurns(earlier, msg('user', 'new'));
    // The long answer doesn't fit, so the question before it goes too.
    expect(turns).toEqual([
      { role: 'user', text: 'failed question', quick: false, at: 4 },
      { role: 'user', text: 'quick', quick: true, at: -1 },
      { role: 'assistant', text: 'answer' },
      { role: 'user', text: 'new', quick: false, at: -1 },
    ]);
  });

  it('keeps at most 20 messages', () => {
    const many = Array.from({ length: 30 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', `m${i}`));
    const turns = chatTurns(many, msg('user', 'last'));
    expect(turns).toHaveLength(19);
    expect(turns[0]).toMatchObject({ role: 'user', text: 'm12' });
    expect(turns.at(-1)).toMatchObject({ text: 'last' });
  });
});

describe('answers', () => {
  it('finds the sentence numbers an answer cites, each once', () => {
    expect(citedNumbers('"Hi." [3] and [5, 7], again [3] and [10-12]; not #4 or (6).')).toEqual([3, 5, 7, 10]);
  });

  it('reads bold, italic, code and sentence numbers', () => {
    expect(parseInline('Say **grab a bite** [12] — *casual*, like `eat`.')).toEqual([
      { t: 'text', text: 'Say ' },
      { t: 'text', text: 'grab a bite', bold: true },
      { t: 'text', text: ' ' },
      { t: 'ref', n: 12 },
      { t: 'text', text: ' — ' },
      { t: 'text', text: 'casual', italic: true },
      { t: 'text', text: ', like eat.' },
    ]);
  });

  it('leaves a lone star and an unknown bracket as text, and bolds to the end while ** is still open', () => {
    expect(parseInline("I can't * believe [x]")).toEqual([{ t: 'text', text: "I can't * believe [x]" }]);
    expect(parseInline('so **important')).toEqual([
      { t: 'text', text: 'so ' },
      { t: 'text', text: 'important', bold: true },
    ]);
  });

  it('splits paragraphs and lists, keeps line breaks, and turns headings into bold lines', () => {
    const blocks = parseAnswer('## Meaning\nIt means eat.\nQuickly.\n\n- one [1]\n  more of one\n- two\n1. first\n2) second\nAfter.');
    expect(blocks).toEqual([
      { t: 'p', parts: [{ t: 'text', text: 'Meaning', bold: true }] },
      { t: 'p', parts: [{ t: 'text', text: 'It means eat.\nQuickly.' }] },
      {
        t: 'ul',
        items: [
          [{ t: 'text', text: 'one ' }, { t: 'ref', n: 1 }, { t: 'text', text: ' more of one' }],
          [{ t: 'text', text: 'two' }],
        ],
      },
      { t: 'ol', items: [[{ t: 'text', text: 'first' }], [{ t: 'text', text: 'second' }]] },
      { t: 'p', parts: [{ t: 'text', text: 'After.' }] },
    ]);
  });

  it('copies as plain text with times, and reads aloud without numbers or list marks', () => {
    const text = '**"I\'m starving."** [12] means very hungry.\n\n- *grab a bite* [13]: eat something quick';
    expect(plainAnswer(text, (n) => `(0:${n})`)).toBe('"I\'m starving." (0:12) means very hungry.\n\n- grab a bite (0:13): eat something quick');
    expect(speechBlocks(text)).toEqual(['"I\'m starving." means very hungry.', 'grab a bite: eat something quick']);
  });

  it('tells which language an answer is in by its letters', () => {
    expect(answerLang('"Grab a bite" [3]는 간단히 먹는다는 뜻이에요.', ['en', 'ko'])).toBe('ko');
    expect(answerLang('It means to eat something quickly.', ['en', 'ko'])).toBe('en');
    expect(answerLang('Significa comer algo.', ['en', 'es'])).toBe('en');
    expect(answerLang('これは「食べる」です。', ['en', 'ja'])).toBe('ja');
  });

  it('finds a cited sentence again by its text, then by its time', () => {
    const units = [
      { start: 0, text: 'Hi.' },
      { start: 5000, text: 'Bye.' },
      { start: 9000, text: 'Hi.' },
    ];
    expect(findChatRef(units, { start: 8000, text: 'Hi.' })).toBe(2);
    expect(findChatRef(units, { start: 4000, text: '안녕.' })).toBe(1);
    expect(findChatRef([], { start: 0, text: 'Hi.' })).toBe(-1);
  });
});
