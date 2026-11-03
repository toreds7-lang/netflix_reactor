import type { DictEntry } from '../core/types';
import { cacheGet, cacheGetMany, cacheSet, cacheSetMany } from './cache';
import {
  buildGoogleUrl,
  chunkLines,
  parseDictionary,
  parseTranslation,
  splitBatch,
  type ParsedTranslation,
} from './google-parse';

const GAP_MS = 120;
let queue: Promise<unknown> = Promise.resolve();

/** All Google requests go through one serial queue to stay under rate limits. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, GAP_MS)));
  return run;
}

async function fetchGoogle(q: string, sl: string, tl: string, dt: string[]): Promise<unknown> {
  return enqueue(async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(buildGoogleUrl(q, sl, tl, dt));
      if (res.ok) return res.json();
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw new Error(`Google Translate error ${res.status}`);
    }
  });
}

async function translateOne(q: string, sl: string, tl: string, dt: string[]): Promise<ParsedTranslation> {
  return parseTranslation(await fetchGoogle(q, sl, tl, dt));
}

/**
 * Translate (or romanize) many lines with batching, per-line caching and a
 * per-line fallback when a batch result can't be split back reliably.
 */
async function batchLines(
  lines: string[],
  sl: string,
  tl: string,
  mode: 'translate' | 'romanize',
  maxFallbackLines: number,
): Promise<(string | null)[]> {
  const store = mode === 'translate' ? 'mt' : 'rom';
  const keyOf = (l: string) => `${sl}|${mode === 'translate' ? tl : ''}|${l}`;
  const result: (string | null)[] = lines.map((l) => (l.trim() ? null : ''));
  const cached = await cacheGetMany<string>(store, lines.map(keyOf));
  const missing: number[] = [];
  lines.forEach((l, i) => {
    if (!l.trim()) return;
    if (cached[i] !== undefined) result[i] = cached[i]!;
    else missing.push(i);
  });
  if (!missing.length) return result;

  const dt = mode === 'translate' ? ['t'] : ['rm'];
  const pick = (p: ParsedTranslation) => (mode === 'translate' ? p.text : (p.sourceTranslit ?? ''));
  const toStore: [string, string][] = [];
  const missingLines = missing.map((i) => lines[i]);

  for (const chunk of chunkLines(missingLines)) {
    const chunkLinesText = chunk.map((k) => missingLines[k]);
    let parts: string[] | null = null;
    try {
      const parsed = await translateOne(chunkLinesText.join('\n'), sl, tl, dt);
      parts = chunk.length === 1 ? [pick(parsed).trim()] : splitBatch(pick(parsed), chunk.length);
    } catch (e) {
      if (chunk.length === 1) throw e;
    }
    if (!parts && chunk.length <= maxFallbackLines) {
      parts = [];
      for (const line of chunkLinesText) parts.push(pick(await translateOne(line, sl, tl, dt)).trim());
    }
    if (!parts) continue;
    chunk.forEach((k, n) => {
      const i = missing[k];
      result[i] = parts![n];
      toStore.push([keyOf(lines[i]), parts![n]]);
    });
  }
  await cacheSetMany(store, toStore);
  return result;
}

export function translateLines(lines: string[], from: string, to: string): Promise<(string | null)[]> {
  return batchLines(lines, from, to, 'translate', 60);
}

export function romanizeLines(lines: string[], from: string): Promise<(string | null)[]> {
  // Romanization needs a target different from the source; English works for all.
  return batchLines(lines, from, from === 'en' ? 'fr' : 'en', 'romanize', 12);
}

export async function lookup(text: string, from: string, to: string): Promise<DictEntry> {
  const key = `${from}|${to}|${text}`;
  const hit = await cacheGet<DictEntry>('dict', key);
  if (hit) return hit;
  const entry = parseDictionary(await fetchGoogle(text, from, to, ['t', 'bd', 'md', 'rm']));
  await cacheSet('dict', key, entry);
  return entry;
}
