import { tokenize, type Token } from './tokenize';
import type { RubySegment } from './types';

export interface Piece {
  text: string;
  ruby?: string;
}

export interface RenderToken extends Token {
  pieces: Piece[];
}

/**
 * Tokenize a line for display. When ruby annotations are present, tokens are merged
 * so no annotated segment is split across two clickable words.
 */
export function buildRenderTokens(text: string, lang: string, ruby?: RubySegment[]): RenderToken[] {
  const hasRuby = !!ruby && ruby.some((r) => r.ruby);
  const src = hasRuby ? ruby!.map((r) => r.base).join('') : text;
  const tokens = tokenize(src, lang);
  if (!hasRuby) return tokens.map((t) => ({ ...t, pieces: [{ text: t.text }] }));

  const spans: { start: number; end: number; ruby: string }[] = [];
  let off = 0;
  for (const r of ruby!) {
    if (r.ruby) spans.push({ start: off, end: off + r.base.length, ruby: r.ruby });
    off += r.base.length;
  }

  const merged: Token[] = [];
  for (const t of tokens) {
    const prev = merged[merged.length - 1];
    const crosses = spans.some((s) => s.start < t.index && s.end > t.index);
    if (prev && crosses) {
      prev.text += t.text;
      prev.isWord = prev.isWord || t.isWord;
    } else merged.push({ ...t });
  }

  return merged.map((t) => {
    const pieces: Piece[] = [];
    const end = t.index + t.text.length;
    let cur = t.index;
    for (const s of spans) {
      if (s.end <= t.index || s.start >= end) continue;
      if (s.start > cur) pieces.push({ text: src.slice(cur, s.start) });
      pieces.push({ text: src.slice(s.start, s.end), ruby: s.ruby });
      cur = s.end;
    }
    if (cur < end) pieces.push({ text: src.slice(cur, end) });
    return { ...t, pieces };
  });
}

/** The display text a cue's tokens are built from (ruby base text when present). */
export function displayText(text: string, ruby?: RubySegment[]): string {
  return ruby && ruby.some((r) => r.ruby) ? ruby.map((r) => r.base).join('') : text;
}
