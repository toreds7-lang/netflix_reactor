import { describe, expect, it } from 'vitest';
import { alignLines, analysisKey, kindOfKey, matchShare, parseRecord, type AnalysisRecord } from '../src/core/analyses';
import { remapTiers } from '../src/core/keylines';
import { remapSummary } from '../src/core/summary';

describe('alignLines', () => {
  it('maps identical lists one to one', () => {
    expect(alignLines(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([0, 1, 2]);
  });

  it('ignores case, spacing and punctuation', () => {
    expect(alignLines(['Hello, world!', 'Bye.'], ['hello world', 'Bye…'])).toEqual([0, 1]);
  });

  it('follows inserted and removed lines in order', () => {
    const from = ['one', 'two', 'three', 'four'];
    const to = ['zero', 'one', 'three', 'new', 'four'];
    expect(alignLines(from, to)).toEqual([1, -1, 2, 4]);
  });

  it("doesn't let a common line jump far ahead, but unique lines re-anchor", () => {
    const filler = Array.from({ length: 60 }, (_, i) => `filler ${i}`);
    // "Yes." is early in `from` but only far ahead (twice) in `to`; "The end." is unique in both.
    const from = ['Yes.', 'The end.'];
    const to = [...filler, 'Yes.', 'The end.', 'Yes.'];
    expect(alignLines(from, to)).toEqual([-1, 61]);
  });

  it('measures how much was found', () => {
    expect(matchShare([0, -1, 2, -1])).toBe(0.5);
    expect(matchShare([])).toBe(0);
  });
});

describe('remapping results', () => {
  it('moves key-line tiers and drops lines that are gone', () => {
    expect(remapTiers([[0, 2], [1], []], [5, -1, 7])).toEqual([[5, 7], [], []]);
  });

  it('moves summary scenes and evidence, merging a scene whose lines are all gone', () => {
    const summary = {
      overview: 'O',
      characters: [{ name: 'A', role: 'r' }],
      scenes: [
        { title: 'S1', summary: 's1', start: 0, end: 1, evidence: [1] },
        { title: 'S2', summary: 's2', start: 2, end: 2, evidence: [2] },
        { title: 'S3', summary: 's3', start: 3, end: 4, evidence: [4] },
      ],
    };
    // Old sentence 2 is gone; one new sentence was inserted at the start.
    const map = [1, 2, -1, 3, 4];
    const out = remapSummary(summary, map, 5);
    expect(out.overview).toBe('O');
    expect(out.scenes.map((s) => [s.title, s.start, s.end, s.evidence])).toEqual([
      ['S1', 0, 2, [2]],
      ['S3', 3, 4, [4]],
    ]);
  });
});

describe('records', () => {
  const record: AnalysisRecord = {
    kind: 'summary',
    videoId: '81234567',
    lang: 'es',
    title: 'Show · Ep',
    model: 'claude-opus-5-5',
    level: 'B1',
    version: 1,
    lines: ['Hola.'],
    createdAt: 1,
    result: { overview: '', characters: [], scenes: [], model: 'm', inputTokens: 0, outputTokens: 0 },
  };

  it('keys by episode first, then kind', () => {
    const key = analysisKey(record);
    expect(key).toBe('81234567|summary|es|claude-opus-5-5|B1');
    expect(kindOfKey(key)).toBe('summary');
    expect(kindOfKey('x|other|es')).toBeUndefined();
  });

  it('accepts valid records from a backup and rejects others', () => {
    expect(parseRecord(record)).toEqual(record);
    expect(parseRecord(null)).toBeNull();
    expect(parseRecord({ ...record, kind: 'other' })).toBeNull();
    expect(parseRecord({ ...record, videoId: 'a|b' })).toBeNull();
    expect(parseRecord({ ...record, lines: [1] })).toBeNull();
    expect(parseRecord({ ...record, kind: 'keylines' })).toBeNull(); // a summary's shape
    expect(parseRecord({ ...record, kind: 'keylines', result: { shadow: [], story: [] } })).not.toBeNull();
  });
});
