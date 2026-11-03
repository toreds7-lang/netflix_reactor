import { baseLang } from './langs';
import type { CefrLevel } from './keylines';

/** Name of the runtime port a page opens to the background for one streamed 💬 chat answer. */
export const CHAT_PORT = 'chat';

/** A sentence of the episode as it was when a message pointed to it, so it is found again after a track switch. */
export interface ChatRef {
  /** Start of the sentence, in ms. */
  start: number;
  text: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  /** The question as sent to the model, or the answer as written, with sentence numbers like [12]. */
  text: string;
  /** A quick-question button: its label is shown instead of `text`. */
  label?: string;
  /** Question: the sentence the learner was at. */
  at?: ChatRef & { n: number };
  /** Answer: the sentences it cites, by number. */
  refs?: Record<number, ChatRef>;
  model?: string;
  /** Answer: why it ended before it was finished. */
  error?: string;
  /** Answer: stopped with ■. */
  stopped?: boolean;
  time: number;
}

/** One message of the chat as the model sees it. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Sent with a quick-question button rather than typed. */
  quick?: boolean;
  /** The sentence number the learner was at, or -1. */
  at?: number;
}

export interface ChatRequest {
  title?: string;
  /** The subtitles' language. */
  lang: string;
  /** The episode's sentences (key-line sentence building); answers cite them by index. */
  lines: string[];
  /** The chat so far, oldest first; the last one is the new question. */
  turns: ChatTurn[];
}

export interface ChatUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Page -> background over a `CHAT_PORT` port. Closing the port stops the answer. */
export type ChatCommand = { type: 'ask'; req: ChatRequest };
/** Background -> page: the answer in pieces, then done or error. */
export type ChatEvent = { type: 'delta'; text: string } | ({ type: 'done' } & ChatUsage) | { type: 'error'; message: string };

export interface QuickQuestion {
  id: string;
  label: string;
  /** What is sent. */
  text: string;
  /** Only makes sense at a line. */
  needsLine?: boolean;
}

/** Buttons for the questions learners ask most, above the box. */
export const QUICK_QUESTIONS: QuickQuestion[] = [
  {
    id: 'line',
    label: '💡 Explain this line',
    text: 'Explain the line I am at: what it means here, and any grammar, slang or idioms in it.',
    needsLine: true,
  },
  { id: 'happened', label: '🎬 What just happened?', text: 'What just happened in the last few lines? Keep it simple.' },
  {
    id: 'phrases',
    label: '🗣 Useful phrases',
    text: 'Pick 3 useful phrases from around here that I can reuse in daily life. For each: the line, what it means, and one new example.',
  },
  {
    id: 'words',
    label: '📖 Hard words',
    text: 'Which words or expressions around here might be hard at my level? Explain each one briefly.',
  },
  {
    id: 'quiz',
    label: '❓ Quiz me',
    text: 'Quiz me: ask me one short question about what is happening around here, to check that I understood. Wait for my answer, then tell me if I was right.',
  },
  { id: 'cast', label: "👥 Who's who", text: 'Who are the main people in this episode so far, and how are they related?' },
];

const rules = (language: string, native: string, level: CefrLevel) => `You are a friendly language tutor. You chat with a learner about one TV episode or film they are watching, to help them follow it and learn its language, ${language}. The learner's own language is ${native}; their level in ${language} is ${level} (CEFR).
Below are the episode's subtitles as numbered sentences "i|text".

Which language to answer in:
- Answer in the language of the learner's latest typed message.
- A message that starts with [button] came from a quick-question button, not typing: answer it in the language of the learner's last typed message, or in ${native} if they have not typed one yet.
- In ${language}, write at the learner's level: short, simple sentences at A1-A2, clear everyday sentences at B1-B2, natural speech at C1-C2.
- Quote lines in ${language}, as they are in the subtitles.

What to say:
- What happens and who says what: use only the subtitles. They have no speaker names or pictures, so when it is unclear who speaks or what happens, say so briefly instead of guessing.
- Meaning in context, grammar, slang, idioms, tone and pronunciation: explain them as a good teacher would.
- Each message from the learner says the sentence they are at, like (at [57]). "This line", "here" and "now" mean that point.
- When you mention or quote a line, put its number in square brackets right after it, like: "I'm starving." [12]. Use only numbers from the subtitles.

How to write:
- Short and clear: a few sentences or a short list, unless the learner asks for more.
- You may use **bold** and lists with "- ". No headings, tables or code blocks.`;

/**
 * The instructions, then the whole episode. It stays the same from one question to the next, so the provider can
 * cache it; where the learner is goes with each question instead.
 */
export function buildChatSystem(
  lines: string[],
  o: { language: string; native: string; level: CefrLevel; title?: string },
): string {
  const head = `${o.title ? `Title: ${o.title}\n` : ''}Language: ${o.language}\nSentences: ${lines.length}`;
  return `${rules(o.language, o.native, o.level)}\n\n${head}\n\n${lines.map((t, i) => `${i}|${t}`).join('\n')}`;
}

/** A learner's message as the model sees it: "[button] (at [57]) Explain…". */
export function userTurnText(t: ChatTurn): string {
  return `${t.quick ? '[button] ' : ''}${t.at != null && t.at >= 0 ? `(at [${t.at}]) ` : ''}${t.text}`;
}

/** The chat as one prompt, for providers that take a single message (Claude Code). */
export function chatPrompt(turns: ChatTurn[]): string {
  const question = turns[turns.length - 1];
  const earlier = turns.slice(0, -1);
  if (!earlier.length) return userTurnText(question);
  const said = earlier.map((t) => (t.role === 'user' ? `Learner: ${userTurnText(t)}` : `You: ${t.text}`)).join('\n\n');
  return `The chat so far:\n\n${said}\n\nThe learner's new message:\n\n${userTurnText(question)}`;
}

const MAX_TURNS = 20;
const MAX_CHARS = 12_000;

/**
 * What the model gets of the chat: `question` after the newest earlier messages, up to 20 messages and about 12,000
 * characters. Answers that failed before any text are left out, and the oldest kept message is a question.
 */
export function chatTurns(earlier: ChatMessage[], question: ChatMessage): ChatTurn[] {
  const turn = (m: ChatMessage): ChatTurn =>
    m.role === 'user' ? { role: 'user', text: m.text, quick: !!m.label, at: m.at?.n ?? -1 } : { role: 'assistant', text: m.text };
  const kept: ChatTurn[] = [];
  let chars = question.text.length;
  for (let i = earlier.length - 1; i >= 0 && kept.length < MAX_TURNS - 1; i--) {
    const m = earlier[i];
    if (m.role === 'assistant' && !m.text.trim()) continue;
    chars += m.text.length;
    if (chars > MAX_CHARS) break;
    kept.unshift(turn(m));
  }
  while (kept[0]?.role === 'assistant') kept.shift();
  return [...kept, turn(question)];
}

/**
 * Where a sentence a message pointed to is in `units` now: the one with the same text nearest its time, else the one
 * nearest its time (another subtitle track has other text), else -1.
 */
export function findChatRef(units: { start: number; text: string }[], ref: ChatRef): number {
  let best = -1;
  let bestSame = false;
  let bestGap = Infinity;
  units.forEach((u, i) => {
    const same = u.text === ref.text;
    const gap = Math.abs(u.start - ref.start);
    if ((same && !bestSame) || (same === bestSame && gap < bestGap)) {
      best = i;
      bestSame = same;
      bestGap = gap;
    }
  });
  return best;
}

// ---------------------------------------------------------------- answers

/** A piece of a line of the answer: text, or a cited sentence number. */
export type ChatInline = { t: 'text'; text: string; bold?: boolean; italic?: boolean } | { t: 'ref'; n: number };
/** A paragraph or a list of the answer. */
export type ChatBlock = { t: 'p'; parts: ChatInline[] } | { t: 'ul' | 'ol'; items: ChatInline[][] };

/** [12], [12, 13] and [12-14] (the start of a range is cited). */
const REF = /\[(\d{1,5}(?:\s*[,–—-]\s*\d{1,5})*)\]/g;
const INLINE = /\*\*|(?<![*\p{L}\p{N}])\*(?=\S)([^*\n]*?\S)\*(?![*\p{L}\p{N}])|`([^`\n]+)`|\[(\d{1,5}(?:\s*[,–—-]\s*\d{1,5})*)\]/gu;

function refsIn(group: string): number[] {
  // A range cites its first sentence; a list cites each.
  return group.split(',').map((part) => Number(part.split(/[–—-]/)[0].trim()));
}

/** Sentence numbers an answer cites, in order, each once. */
export function citedNumbers(text: string): number[] {
  return [...new Set([...text.matchAll(REF)].flatMap((m) => refsIn(m[1])))];
}

/** **bold**, *italic*, `code` (shown as plain text) and sentence numbers. An open ** (still streaming) runs to the end. */
export function parseInline(s: string): ChatInline[] {
  const out: ChatInline[] = [];
  let bold = false;
  let at = 0;
  const text = (t: string, italic = false) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.t === 'text' && !!last.bold === bold && !last.italic && !italic) last.text += t;
    else out.push({ t: 'text', text: t, ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) });
  };
  for (const m of s.matchAll(INLINE)) {
    text(s.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[0] === '**') bold = !bold;
    else if (m[1] != null) text(m[1], true);
    else if (m[2] != null) text(m[2]);
    else for (const n of refsIn(m[3])) out.push({ t: 'ref', n });
  }
  text(s.slice(at));
  return out;
}

/** Add `parts` to `to`, joining plain text that meets. */
function append(to: ChatInline[], ...parts: ChatInline[]): void {
  for (const p of parts) {
    const last = to[to.length - 1];
    if (p.t === 'text' && !p.bold && !p.italic && last?.t === 'text' && !last.bold && !last.italic) last.text += p.text;
    else to.push(p);
  }
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

/**
 * The answer as paragraphs and lists, from the small Markdown the model is asked to use. Line breaks inside a
 * paragraph are kept; an indented line goes on with the list item above it; a heading becomes a bold line.
 */
export function parseAnswer(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let para = null as Extract<ChatBlock, { t: 'p' }> | null;
  let list = null as Extract<ChatBlock, { t: 'ul' | 'ol' }> | null;
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (!line.trim()) {
      para = list = null;
      continue;
    }
    const bullet = BULLET.exec(line);
    const item = bullet ?? NUMBERED.exec(line);
    if (item) {
      const kind = bullet ? 'ul' : 'ol';
      if (list?.t !== kind) blocks.push((list = { t: kind, items: [] }));
      list.items.push(parseInline(item[1]));
      para = null;
      continue;
    }
    if (list && /^\s+\S/.test(line)) {
      append(list.items[list.items.length - 1], { t: 'text', text: ' ' }, ...parseInline(line.trim()));
      continue;
    }
    list = null;
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ t: 'p', parts: parseInline(`**${heading[1].replace(/\*\*/g, '')}**`) });
      para = null;
      continue;
    }
    const parts = parseInline(line.trim());
    if (para) append(para.parts, { t: 'text', text: '\n' }, ...parts);
    else blocks.push((para = { t: 'p', parts }));
  }
  return blocks;
}

/**
 * The answer as plain text: no Markdown, and each sentence number replaced by `ref(n)` (dropped when that gives '').
 * For copying (with times) and reading aloud (without).
 */
export function plainAnswer(text: string, ref: (n: number) => string = () => ''): string {
  return parseAnswer(text)
    .map((b) => {
      const line = (parts: ChatInline[]) =>
        parts
          .map((p) => (p.t === 'text' ? p.text : ref(p.n)))
          .join('')
          .replace(/[ \t]+([.,!?;:])/g, '$1')
          .replace(/[ \t]{2,}/g, ' ')
          .trim();
      return b.t === 'p' ? line(b.parts) : b.items.map((it, i) => `${b.t === 'ol' ? `${i + 1}.` : '-'} ${line(it)}`).join('\n');
    })
    .join('\n\n');
}

/** Paragraphs and list items to read aloud, without list marks or sentence numbers. */
export function speechBlocks(text: string): string[] {
  const strip = (parts: ChatInline[]) =>
    parts
      .map((p) => (p.t === 'text' ? p.text : ''))
      .join('')
      .replace(/\s+([.,!?;:])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  return parseAnswer(text)
    .flatMap((b) => (b.t === 'p' ? [strip(b.parts)] : b.items.map(strip)))
    .filter(Boolean);
}

const SCRIPT_OF: Record<string, RegExp> = {
  ko: /\p{Script=Hangul}/gu,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu,
  zh: /\p{Script=Han}/gu,
  ru: /\p{Script=Cyrillic}/gu,
  uk: /\p{Script=Cyrillic}/gu,
  bg: /\p{Script=Cyrillic}/gu,
  sr: /\p{Script=Cyrillic}/gu,
  el: /\p{Script=Greek}/gu,
  ar: /\p{Script=Arabic}/gu,
  fa: /\p{Script=Arabic}/gu,
  he: /\p{Script=Hebrew}/gu,
  th: /\p{Script=Thai}/gu,
  hi: /\p{Script=Devanagari}/gu,
};
const LATIN = /\p{Script=Latin}/gu;

/**
 * Which of `langs` an answer is written in, by its letters: Korean letters mean Korean, and so on. Languages with the
 * same letters (English and Spanish) can't be told apart; the first one wins.
 */
export function answerLang(text: string, langs: string[]): string {
  let best = langs[0];
  let most = -1;
  for (const lang of langs) {
    const count = text.match(SCRIPT_OF[baseLang(lang)] ?? LATIN)?.length ?? 0;
    if (count > most) {
      best = lang;
      most = count;
    }
  }
  return best;
}
