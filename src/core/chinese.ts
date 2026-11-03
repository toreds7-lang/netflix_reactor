import { pinyin } from 'pinyin-pro';
import type { RubySegment } from './types';

/** Per-character pinyin ruby for a Chinese line. */
export function pinyinRuby(text: string): RubySegment[] {
  const out: RubySegment[] = [];
  for (const item of pinyin(text, { type: 'all' })) {
    if (item.isZh && item.pinyin) out.push({ base: item.origin, ruby: item.pinyin });
    else {
      const prev = out[out.length - 1];
      if (prev && !prev.ruby) prev.base += item.origin;
      else out.push({ base: item.origin });
    }
  }
  return out;
}

/** A readable pinyin line: syllables separated by spaces, punctuation kept. */
export function pinyinLine(text: string): string {
  let line = '';
  for (const item of pinyin(text.replace(/\n/g, ' '), { type: 'all' })) {
    if (item.isZh && item.pinyin) line += (line && !line.endsWith(' ') ? ' ' : '') + item.pinyin;
    else line += item.origin;
  }
  return line.replace(/\s+/g, ' ').trim();
}
