import { describe, expect, it } from 'vitest';
import { buildSummaryPrompt, normalizeSummary, sceneAt, sceneCount } from '../src/core/summary';

const scene = (start: number, evidence: unknown[] = [], title = `Scene at ${start}`) => ({
  start,
  title,
  summary: `What happens from ${start}.`,
  evidence,
});

describe('sceneCount', () => {
  it('asks for about one scene per 50 sentences, between 3 and 12', () => {
    expect(sceneCount(20)).toBe(3);
    expect(sceneCount(300)).toBe(6);
    expect(sceneCount(600)).toBe(12);
    expect(sceneCount(2000)).toBe(12);
  });
});

describe('buildSummaryPrompt', () => {
  it('numbers sentences and states the language, level, N and S', () => {
    const texts = Array.from({ length: 300 }, (_, i) => `Line ${i}.`);
    const { system, user } = buildSummaryPrompt(texts, 'English', 'A2');
    expect(system).toContain('Use only what the transcript says');
    expect(user).toContain('Language: English');
    expect(user).toContain('Learner level: A2 (CEFR)');
    expect(user).toContain('N: 300');
    expect(user).toContain('S: 6');
    expect(user).toContain('\n0|Line 0.\n1|Line 1.');
    expect(user.endsWith('299|Line 299.')).toBe(true);
  });
});

describe('normalizeSummary', () => {
  it('turns scene starts into consecutive ranges that cover every sentence', () => {
    const out = normalizeSummary({ overview: ' A day. ', characters: [], scenes: [scene(0), scene(40), scene(75)] }, 100);
    expect(out.overview).toBe('A day.');
    expect(out.scenes.map((s) => [s.start, s.end])).toEqual([
      [0, 39],
      [40, 74],
      [75, 99],
    ]);
  });

  it('sorts scenes, keeps one per start and drops invalid ones', () => {
    const out = normalizeSummary(
      {
        scenes: [
          scene(50, [], 'Later'),
          scene(10, [], 'Earlier'),
          scene(50, [], 'Duplicate start'),
          scene(-1),
          scene(100), // past the last sentence
          scene(2.5),
          { start: 30, title: '', summary: '', evidence: [] }, // no text
        ],
      },
      100,
    );
    expect(out.scenes.map((s) => s.title)).toEqual(['Earlier', 'Later']);
    // The first scene always starts at the first sentence.
    expect(out.scenes.map((s) => [s.start, s.end])).toEqual([
      [0, 49],
      [50, 99],
    ]);
  });

  it('keeps only evidence inside its own scene, without repeats, at most 3', () => {
    const out = normalizeSummary(
      { scenes: [scene(0, [5, 5, 60, 'x', 7]), scene(50, [55, 56, 57, 58, 10])] },
      100,
    );
    expect(out.scenes[0].evidence).toEqual([5, 7]);
    expect(out.scenes[1].evidence).toEqual([55, 56, 57]);
  });

  it('cleans the character list', () => {
    const out = normalizeSummary(
      { characters: [{ name: ' Jonas ', role: 'a teenager' }, { name: '', role: 'nobody' }, { role: 'no name' }] },
      10,
    );
    expect(out.characters).toEqual([{ name: 'Jonas', role: 'a teenager' }]);
  });

  it('survives a missing or malformed reply', () => {
    expect(normalizeSummary(null, 10)).toEqual({ overview: '', characters: [], scenes: [] });
    expect(normalizeSummary({ overview: 3, characters: 'x', scenes: {} }, 10)).toEqual({
      overview: '',
      characters: [],
      scenes: [],
    });
  });
});

describe('sceneAt', () => {
  it('finds the scene that contains a sentence', () => {
    const { scenes } = normalizeSummary({ scenes: [scene(0), scene(40)] }, 100);
    expect(sceneAt(scenes, 0)).toBe(0);
    expect(sceneAt(scenes, 39)).toBe(0);
    expect(sceneAt(scenes, 40)).toBe(1);
    expect(sceneAt(scenes, 99)).toBe(1);
    expect(sceneAt(scenes, -1)).toBe(-1);
  });
});
