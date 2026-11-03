import { baseLang } from './langs';

export interface Token {
  text: string;
  isWord: boolean;
  /** Offset into the source string. */
  index: number;
}

const segmenters = new Map<string, Intl.Segmenter>();

function segmenter(lang: string): Intl.Segmenter {
  let s = segmenters.get(lang);
  if (!s) {
    try {
      s = new Intl.Segmenter(lang, { granularity: 'word' });
    } catch {
      s = new Intl.Segmenter(undefined, { granularity: 'word' });
    }
    segmenters.set(lang, s);
  }
  return s;
}

/** Split text into word / non-word tokens. Works for spaceless scripts (ja, zh, th) too. */
export function tokenize(text: string, lang: string): Token[] {
  const out: Token[] = [];
  for (const seg of segmenter(lang).segment(text)) {
    out.push({ text: seg.segment, isWord: !!seg.isWordLike, index: seg.index });
  }
  return out;
}

/** Canonical form used as the saved-word key. */
export function normalizeWord(word: string, lang: string): string {
  let locale: string | undefined = lang;
  try {
    'a'.toLocaleLowerCase(lang);
  } catch {
    locale = undefined;
  }
  return word
    .normalize('NFC')
    .toLocaleLowerCase(locale)
    .replace(/[’`]/g, "'")
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '');
}

export function wordKey(word: string, lang: string): string {
  return `${baseLang(lang)}:${normalizeWord(word, lang)}`;
}
