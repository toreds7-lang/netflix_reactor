import { describe, expect, it } from 'vitest';
import type { SavedWord } from '../src/core/types';
import { ankiCard, csvCell, formatTime, netflixLink, parseBackup, toBackup, toCsv } from '../src/words/export';

const word: SavedWord = {
  key: 'es:casa',
  lang: 'es',
  word: 'casa',
  level: 'learning',
  translation: 'house, "home"',
  sentence: 'Vamos a <casa>.',
  videoId: '81234567',
  title: 'La Casa de Papel',
  timeMs: 3_723_004,
  createdAt: 0,
  updatedAt: 0,
};

describe('csv', () => {
  it('quotes and escapes cells', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(undefined)).toBe('');
  });

  it('neutralizes spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
  });

  it('writes a BOM, header and rows', () => {
    const csv = toCsv([word]);
    expect(csv.startsWith('﻿word,lemma,reading,translation')).toBe(true);
    expect(csv).toContain('"house, ""home"""');
    expect(csv).toContain('https://www.netflix.com/watch/81234567?t=3723');
  });
});

describe('helpers', () => {
  it('formats times and links', () => {
    expect(formatTime(3_723_004)).toBe('1:02:03');
    expect(formatTime(65_000)).toBe('1:05');
    expect(netflixLink('1', 1999)).toBe('https://www.netflix.com/watch/1?t=1');
    expect(netflixLink(undefined, 1)).toBe('');
  });

  it('builds escaped Anki cards with the word in bold', () => {
    const { front, back } = ankiCard(word);
    expect(front).toContain('Vamos a &lt;<b>casa</b>&gt;.');
    expect(back).toContain('house, &quot;home&quot;');
    expect(back).toContain('https://www.netflix.com/watch/81234567?t=3723');
  });

  it('round-trips backups', () => {
    expect(parseBackup(toBackup([word]))).toEqual({ words: [word], analyses: [], sentences: [] });
    const saved = { kind: 'summary', videoId: '1' };
    expect(parseBackup(toBackup([word], [saved as never])).analyses).toEqual([saved]);
    // Version 3 adds saved sentences.
    const sentence = { id: 'v:en:1', text: 'Hi.' };
    expect(parseBackup(toBackup([word], [], [sentence as never])).sentences).toEqual([sentence]);
    // Version 1 files and bare word lists still load.
    expect(parseBackup(JSON.stringify({ app: 'polyglot-player', version: 1, words: [word] }))).toEqual({
      words: [word],
      analyses: [],
      sentences: [],
    });
    expect(parseBackup(JSON.stringify([word])).words).toEqual([word]);
    expect(() => parseBackup('{"nope":1}')).toThrow();
  });
});
