import { describe, expect, it } from 'vitest';
import { fromBase64, mostSimilar, quantize, textsHash, toBase64, vectorNorms } from '../src/core/meaning';
import { buildPatternPrompt, frameQuery, validFrames } from '../src/core/patterns';

const DIMS = 3;

/** Unit vectors as the model gives them, end to end. */
const set = (key: string, vectors: number[][]) => {
  const data = quantize(vectors.flat(), DIMS);
  return { key, data, norms: vectorNorms(data, DIMS) };
};

describe('vectors', () => {
  it('keeps each vector as 8-bit numbers, its largest one at ±127', () => {
    expect([...quantize([0.5, -0.25, 0, 0.1, 0.2, -0.4], DIMS)]).toEqual([127, -63, 0, 32, 64, -127]);
    expect([...quantize([0, 0, 0], DIMS)]).toEqual([0, 0, 0]);
  });

  it('survives the trip through base64', () => {
    const bytes = new Uint8Array(new Int8Array([127, -128, 0, 5]).buffer);
    expect([...new Int8Array(fromBase64(toBase64(bytes)).buffer)]).toEqual([127, -128, 0, 5]);
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(fromBase64(toBase64(big))).toEqual(big);
  });

  it('finds the most alike vectors across episodes, best first, above the minimum', () => {
    const q = quantize([1, 0, 0], DIMS);
    const a = set('a', [
      [0.9, 0.1, 0],
      [0, 1, 0],
    ]);
    const b = set('b', [
      [1, 0.05, 0],
      [0.6, 0.6, 0],
      [-1, 0, 0],
    ]);
    const top = mostSimilar(q, [a, b], DIMS, 5, 0.5);
    expect(top.map((t) => [t.key, t.index])).toEqual([
      ['b', 0],
      ['a', 0],
      ['b', 1],
    ]);
    expect(top[0].score).toBeGreaterThan(0.99);
    expect(mostSimilar(q, [a, b], DIMS, 1, 0.5).map((t) => t.key)).toEqual(['b']);
    expect(mostSimilar(quantize([0, 0, 0], DIMS), [a], DIMS, 5)).toEqual([]);
  });

  it('notices when an episode’s sentences change', () => {
    expect(textsHash(['a', 'b'])).toBe(textsHash(['a', 'b']));
    expect(textsHash(['a', 'b'])).not.toBe(textsHash(['ab']));
    expect(textsHash(['a', 'b'])).not.toBe(textsHash(['a', 'c']));
  });
});

describe('✨ Pattern', () => {
  const line = "I can't believe you did that again.";

  it('keeps only frames made of words from the line, three at most, each once', () => {
    const raw = {
      frames: [
        "I can't believe ___",
        'I can’t believe ___', // the same, with a curly apostrophe
        '___ did that again',
        'You never ___', // "never" is not in the line
        'I ____ you ___',
        '___', // no fixed word
        42,
      ],
    };
    expect(validFrames(raw, line, 'en')).toEqual(["I can't believe ___", '___ did that again', 'I ___ you ___']);
    expect(validFrames(null, line, 'en')).toEqual([]);
    expect(validFrames({ frames: 'nope' }, line, 'en')).toEqual([]);
  });

  it('searches a frame with each ___ as a gap', () => {
    expect(frameQuery("I can't believe ___")).toBe("I can't believe *");
    expect(frameQuery('___ did that ___ again')).toBe('* did that * again');
  });

  it('asks in the language learned, at your level, with the lines around it', () => {
    const p = buildPatternPrompt({ sentence: line, before: 'Look.', lang: 'en' }, 'English', 'B1');
    expect(p.system).toContain('B1 learner of English');
    expect(p.user).toBe(`Line before: Look.\nLine: ${line}`);
  });
});
