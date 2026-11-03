import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  buildUnits,
  cueUnitIndex,
  mergeRanges,
  normalizeTiers,
  pickLevel,
  stepAmong,
  targetCount,
} from '../src/core/keylines';
import type { Cue } from '../src/core/types';

const cue = (start: number, end: number, text: string): Cue => ({ start, end, text });

describe('buildUnits', () => {
  it('joins fragments of one sentence and splits at terminal punctuation', () => {
    const units = buildUnits([
      cue(0, 1000, 'I was thinking that'),
      cue(1100, 2000, 'we could leave early.'),
      cue(2100, 3000, 'Sounds good.'),
    ]);
    expect(units).toEqual([
      { start: 0, end: 2000, text: 'I was thinking that we could leave early.' },
      { start: 2100, end: 3000, text: 'Sounds good.' },
    ]);
  });

  it('does not join across a long gap or a new speaker', () => {
    const units = buildUnits([
      cue(0, 1000, 'Wait'),
      cue(5000, 6000, 'what happened'),
      cue(6100, 7000, '- Nothing.'),
    ]);
    expect(units.map((u) => u.text)).toEqual(['Wait', 'what happened', '- Nothing.']);
  });

  it('joins a continuation that starts with an ellipsis', () => {
    const units = buildUnits([cue(0, 1000, 'If only...'), cue(1100, 2000, '...we had more time.')]);
    expect(units).toHaveLength(1);
  });

  it('caps a unit at four cues', () => {
    const units = buildUnits([0, 1, 2, 3, 4].map((i) => cue(i * 1000, i * 1000 + 900, `part ${i}`)));
    expect(units).toHaveLength(2);
  });

  it('drops sound descriptions, speaker labels and song lyrics', () => {
    const units = buildUnits([
      cue(0, 1000, '[door slams]'),
      cue(1000, 2000, '♪ la la la ♪'),
      cue(3000, 4000, 'JOHN: Come in.'),
    ]);
    expect(units).toEqual([{ start: 3000, end: 4000, text: 'Come in.' }]);
  });
});

describe('prompt', () => {
  it('numbers sentences and states N and K', () => {
    const texts = Array.from({ length: 25 }, (_, i) => `Line ${i}.`);
    const { system, user } = buildPrompt(texts, 'English', 'B1');
    expect(targetCount(25)).toBe(3);
    expect(user).toContain('Learner level: B1 (CEFR)\nN: 25\nK: 3');
    expect(user).toContain('0|Line 0.\n1|Line 1.');
    expect(system).toContain('shadow');
    expect(system).toContain('story');
  });

  it('asks for at least one sentence per tier', () => {
    expect(targetCount(3)).toBe(1);
  });
});

describe('normalizeTiers', () => {
  it('drops invalid and repeated numbers', () => {
    expect(normalizeTiers({ t1: [1, 1, -1, 9, 2.5, '3'], t2: [2, 1], t3: [] }, 5, 3)).toEqual([[1], [2], []]);
  });

  it('moves a tier overflow down, keeping order', () => {
    expect(normalizeTiers({ t1: [0, 1, 2], t2: [3], t3: [4, 5] }, 10, 2)).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it('survives a missing selection', () => {
    expect(normalizeTiers(undefined, 5, 2)).toEqual([[], [], []]);
  });
});

describe('levels and mapping', () => {
  it('picks the union of the first tiers', () => {
    const tiers = [[4], [2], [7]];
    expect([...pickLevel(tiers, 1)]).toEqual([4]);
    expect([...pickLevel(tiers, 3)].sort()).toEqual([2, 4, 7]);
  });

  it('maps displayed cues to sentences by time', () => {
    const units = [
      { start: 0, end: 2000, text: 'a b' },
      { start: 3000, end: 4000, text: 'c' },
    ];
    const cues = [cue(0, 1000, 'a'), cue(1000, 2000, 'b'), cue(2200, 2800, '[music]'), cue(3000, 4000, 'c')];
    expect(cueUnitIndex(cues, units)).toEqual([0, 0, -1, 1]);
  });

  it('pads, sorts and joins nearby ranges', () => {
    expect(
      mergeRanges([
        { start: 20_000, end: 21_000 },
        { start: 1000, end: 2000 },
        { start: 3000, end: 4000 },
      ]),
    ).toEqual([
      { start: 700, end: 4400 },
      { start: 19_700, end: 21_400 },
    ]);
  });
});

describe('stepping between key lines', () => {
  // Lines 0-1 are one key sentence, 4 another.
  const lines = [0, 1, 4];

  it('goes to the next marked line, the second line of a key sentence included', () => {
    expect(stepAmong(lines, -1, 1)).toBe(0);
    expect(stepAmong(lines, 0, 1)).toBe(1);
    expect(stepAmong(lines, 1, 1)).toBe(4);
    expect(stepAmong(lines, 2, 1)).toBe(4);
    expect(stepAmong(lines, 4, 1)).toBe(-1);
  });

  it('goes to the previous marked line', () => {
    expect(stepAmong(lines, 6, -1)).toBe(4);
    expect(stepAmong(lines, 4, -1)).toBe(1);
    expect(stepAmong(lines, 1, -1)).toBe(0);
    expect(stepAmong(lines, 0, -1)).toBe(-1);
    expect(stepAmong(lines, -1, -1)).toBe(-1);
  });
});
