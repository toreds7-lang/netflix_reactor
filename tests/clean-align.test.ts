import { describe, expect, it } from 'vitest';
import { alignTranslation, mergeCues, prepareCues, stripSoundDescriptions } from '../src/core/subtitles';
import type { Cue } from '../src/core/types';

describe('mergeCues', () => {
  it('sorts and merges cues with identical timing, dropping exact duplicates', () => {
    const merged = mergeCues([
      { start: 2000, end: 3000, text: 'second' },
      { start: 1000, end: 2000, text: '-Hi.' },
      { start: 1000, end: 2000, text: '-Hello.' },
      { start: 1000, end: 2000, text: '-Hello.' },
    ]);
    expect(merged).toEqual([
      { start: 1000, end: 2000, text: '-Hi.\n-Hello.' },
      { start: 2000, end: 3000, text: 'second' },
    ]);
  });

  it('keeps ruby consistent when merging', () => {
    const [m] = mergeCues([
      { start: 0, end: 1, text: '雨', ruby: [{ base: '雨', ruby: 'あめ' }] },
      { start: 0, end: 1, text: 'だ' },
    ]);
    expect(m.text).toBe('雨\nだ');
    expect(m.ruby).toEqual([{ base: '雨', ruby: 'あめ' }, { base: '\n' }, { base: 'だ' }]);
  });
});

describe('stripSoundDescriptions', () => {
  it('removes SDH annotations and speaker labels', () => {
    expect(stripSoundDescriptions('[door slams]\nJOHN: Get out!')).toBe('Get out!');
    expect(stripSoundDescriptions('♪ la la ♪')).toBe('la la');
    expect(stripSoundDescriptions('(laughs) Okay.')).toBe('Okay.');
    expect(stripSoundDescriptions('（ドアの音）行くぞ')).toBe('行くぞ');
    expect(stripSoundDescriptions('- MARY: Wait.\n- Why?')).toBe('- Wait.\n- Why?');
  });

  it('prepareCues drops cues that become empty', () => {
    const cues: Cue[] = [
      { start: 0, end: 1, text: '[music]' },
      { start: 1, end: 2, text: 'Hello' },
    ];
    expect(prepareCues(cues, true)).toEqual([{ start: 1, end: 2, text: 'Hello' }]);
    expect(prepareCues(cues, false)).toBe(cues);
  });
});

describe('alignTranslation', () => {
  const main: Cue[] = [
    { start: 0, end: 2000, text: 'Hola.' },
    { start: 2000, end: 5000, text: '¿Qué tal?\nBien.' },
    { start: 6000, end: 7000, text: 'Adiós.' },
    { start: 9000, end: 9500, text: 'Sin pareja.' },
  ];
  const other: Cue[] = [
    { start: 100, end: 1900, text: 'Hello.' },
    { start: 2100, end: 3500, text: 'How are you?' },
    { start: 3500, end: 4900, text: 'Fine.' },
    { start: 5800, end: 7200, text: 'Goodbye.' },
  ];

  it('assigns each translation cue to the main cue it overlaps most', () => {
    expect(alignTranslation(main, other)).toEqual(['Hello.', 'How are you? Fine.', 'Goodbye.', null]);
  });

  it('falls back to the best overlapping cue when a main cue got nothing', () => {
    const wide: Cue[] = [{ start: 0, end: 5000, text: 'Hello, how are you?' }];
    expect(alignTranslation(main.slice(0, 2), wide)).toEqual(['Hello, how are you?', 'Hello, how are you?']);
  });
});
