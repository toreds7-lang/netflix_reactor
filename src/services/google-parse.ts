/** Pure helpers for the unofficial Google Translate `translate_a/single` endpoint. */
import type { DictEntry } from '../core/types';

export const GOOGLE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
/** Keep GET URLs comfortably under server limits. */
export const MAX_ENCODED_CHARS = 1800;

export function buildGoogleUrl(q: string, sl: string, tl: string, dt: string[]): string {
  const params = new URLSearchParams({ client: 'gtx', sl, tl, hl: tl, ie: 'UTF-8', oe: 'UTF-8' });
  for (const d of dt) params.append('dt', d);
  params.append('q', q);
  return `${GOOGLE_ENDPOINT}?${params.toString()}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ParsedTranslation {
  text: string;
  /** Transliteration of the source text (dt=rm). */
  sourceTranslit?: string;
  sourceLang?: string;
}

export function parseTranslation(data: any): ParsedTranslation {
  const rows: any[] = Array.isArray(data?.[0]) ? data[0] : [];
  let text = '';
  const translit: string[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    if (typeof row[0] === 'string') text += row[0];
    else if (row[0] == null && typeof row[3] === 'string') translit.push(row[3]);
  }
  return {
    text,
    sourceTranslit: translit.length ? translit.join(' ') : undefined,
    sourceLang: typeof data?.[2] === 'string' ? data[2] : undefined,
  };
}

export function parseDictionary(data: any): DictEntry {
  const base = parseTranslation(data);
  const groups: DictEntry['groups'] = [];
  if (Array.isArray(data?.[1])) {
    for (const g of data[1]) {
      if (!Array.isArray(g) || !Array.isArray(g[1])) continue;
      groups.push({ pos: String(g[0] ?? ''), terms: g[1].filter((t: unknown) => typeof t === 'string').slice(0, 8) });
    }
  }
  const definitions: DictEntry['definitions'] = [];
  if (Array.isArray(data?.[12])) {
    for (const d of data[12]) {
      if (!Array.isArray(d) || !Array.isArray(d[1])) continue;
      const defs = d[1]
        .map((x: any) => (Array.isArray(x) ? x[0] : null))
        .filter((x: unknown): x is string => typeof x === 'string')
        .slice(0, 4);
      if (defs.length) definitions.push({ pos: String(d[0] ?? ''), defs });
    }
  }
  return {
    translation: base.text.trim(),
    romanization: base.sourceTranslit,
    sourceLang: base.sourceLang,
    groups,
    definitions,
  };
}

/** Group line indexes so each group's joined text fits in one GET request. */
export function chunkLines(lines: string[], maxEncoded = MAX_ENCODED_CHARS): number[][] {
  const chunks: number[][] = [];
  let cur: number[] = [];
  let size = 0;
  for (let i = 0; i < lines.length; i++) {
    const len = encodeURIComponent(lines[i]).length + 3; // + encoded '\n'
    if (cur.length && size + len > maxEncoded) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(i);
    size += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** Split a batch result back into lines; null when the line count doesn't match. */
export function splitBatch(text: string, expected: number): string[] | null {
  const parts = text.replace(/\r\n?/g, '\n').split('\n').map((s) => s.trim());
  while (parts.length > expected && parts[parts.length - 1] === '') parts.pop();
  return parts.length === expected ? parts : null;
}
