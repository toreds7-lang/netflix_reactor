import { describe, expect, it } from 'vitest';
import { buildGoogleUrl, chunkLines, parseDictionary, parseTranslation, splitBatch } from '../src/services/google-parse';

// Shapes captured from translate_a/single responses.
const TRANSLATION = [
  [
    ['Hello.\n', 'こんにちは。\n', null, null, 10],
    ['Where are you going?', 'どこに行くの？', null, null, 10],
    [null, null, null, "Kon'nichiwa.\nDoko ni iku no?"],
  ],
  null,
  'ja',
];

const DICTIONARY = [
  [['house', 'casa', null, null, 1], [null, null, null, null]],
  [
    ['noun', ['house', 'home', 'household'], [['house', ['casa', 'vivienda'], null, 0.8]], 'casa', 1],
    ['verb', ['marry'], [], 'casar', 2],
  ],
  'es',
  null, null, null, null, null, null, null, null, null,
  [['noun', [['Edificio para habitar.', 'm_es_1', 'Una casa de campo.'], ['Familia.', 'm_es_2']], 'casa']],
];

describe('parseTranslation', () => {
  it('joins translated segments and reads the source transliteration', () => {
    const r = parseTranslation(TRANSLATION);
    expect(r.text).toBe('Hello.\nWhere are you going?');
    expect(r.sourceTranslit).toBe("Kon'nichiwa.\nDoko ni iku no?");
    expect(r.sourceLang).toBe('ja');
  });

  it('tolerates garbage', () => {
    expect(parseTranslation(null)).toEqual({ text: '', sourceTranslit: undefined, sourceLang: undefined });
  });
});

describe('parseDictionary', () => {
  it('extracts translation, groups and definitions', () => {
    const d = parseDictionary(DICTIONARY);
    expect(d.translation).toBe('house');
    expect(d.groups).toEqual([
      { pos: 'noun', terms: ['house', 'home', 'household'] },
      { pos: 'verb', terms: ['marry'] },
    ]);
    expect(d.definitions).toEqual([{ pos: 'noun', defs: ['Edificio para habitar.', 'Familia.'] }]);
  });
});

describe('batching helpers', () => {
  it('chunks lines by encoded size', () => {
    const lines = Array.from({ length: 10 }, () => 'x'.repeat(500));
    const chunks = chunkLines(lines, 1800);
    expect(chunks.flat()).toEqual(lines.map((_, i) => i));
    expect(chunks.every((c) => c.length <= 3)).toBe(true);
    // CJK is 9 encoded bytes per character.
    expect(chunkLines(['漢'.repeat(150), '字'.repeat(150)], 1800)).toEqual([[0], [1]]);
  });

  it('splits batch results only when the count matches', () => {
    expect(splitBatch('a\n b \nc\n', 3)).toEqual(['a', 'b', 'c']);
    expect(splitBatch('a b c', 3)).toBeNull();
  });

  it('builds a GET url with repeated dt params', () => {
    const url = new URL(buildGoogleUrl('hola\nadiós', 'es', 'en', ['t', 'rm']));
    expect(url.searchParams.getAll('dt')).toEqual(['t', 'rm']);
    expect(url.searchParams.get('q')).toBe('hola\nadiós');
    expect(url.searchParams.get('client')).toBe('gtx');
  });
});
