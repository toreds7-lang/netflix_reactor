import type { Cue, RubySegment } from '../types';
import { decodeEntities, tidyText } from './entities';

const TIME_RE = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

export function parseVttTime(s: string): number {
  const m = TIME_RE.exec(s.trim());
  if (!m) return NaN;
  const [, h, min, sec, frac] = m;
  return (
    (h ? parseInt(h, 10) : 0) * 3_600_000 +
    parseInt(min, 10) * 60_000 +
    parseInt(sec, 10) * 1000 +
    parseInt(frac.padEnd(3, '0'), 10)
  );
}

/** Extract ruby segments from a cue payload containing <ruby>…<rt>…</rt></ruby>. */
function parseRuby(payload: string): RubySegment[] {
  const segments: RubySegment[] = [];
  const re = /<ruby>([\s\S]*?)<\/ruby>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  const plain = (s: string) => decodeEntities(s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
  while ((m = re.exec(payload))) {
    if (m.index > last) segments.push({ base: plain(payload.slice(last, m.index)) });
    const inner = m[1];
    const rt = /<rt>([\s\S]*?)<\/rt>/i.exec(inner);
    const base = inner.replace(/<rt>[\s\S]*?<\/rt>/gi, '').replace(/<\/?rb>/gi, '');
    segments.push({ base: plain(base), ruby: rt ? plain(rt[1]) : undefined });
    last = m.index + m[0].length;
  }
  if (last < payload.length) segments.push({ base: plain(payload.slice(last)) });
  return segments.filter((s) => s.base.length > 0);
}

export function parseVtt(input: string): Cue[] {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx < 0) continue;
    const [startStr, rest] = lines[timingIdx].split('-->');
    const start = parseVttTime(startStr);
    const end = parseVttTime(rest.trim().split(/\s+/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const payload = lines.slice(timingIdx + 1).join('\n').replace(/\s+$/, '');
    if (!payload.trim()) continue;
    const hasRuby = /<ruby>/i.test(payload);
    const ruby = hasRuby ? parseRuby(payload) : undefined;
    const plain = hasRuby
      ? ruby!.map((r) => r.base).join('')
      : decodeEntities(payload.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
    const cleaned = tidyText(plain);
    if (!cleaned) continue;
    cues.push({ start, end, text: cleaned, ...(ruby ? { ruby } : {}) });
  }
  return cues;
}
