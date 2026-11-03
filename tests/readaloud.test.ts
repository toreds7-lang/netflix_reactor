import { describe, expect, it } from 'vitest';
import { buildReadingScript, encodeWav, splitSentences, usesKokoro } from '../src/core/readaloud';
import type { EpisodeSummary } from '../src/core/types';

describe('usesKokoro', () => {
  it('reads English with Kokoro and leaves other languages to the browser voice', () => {
    expect(usesKokoro('en')).toBe(true);
    expect(usesKokoro('en-GB')).toBe(true);
    expect(usesKokoro('ja')).toBe(false);
    expect(usesKokoro('')).toBe(false);
  });
});

describe('splitSentences', () => {
  it('splits into sentences that join back into the original text', () => {
    const text = 'Anna loses her job. She goes home! Will she tell Tom?';
    const parts = splitSentences(text, 'en');
    expect(parts.map((p) => p.trim())).toEqual(['Anna loses her job.', 'She goes home!', 'Will she tell Tom?']);
    expect(parts.join('')).toBe(text);
  });

  it('keeps titles like "Mr." with the name that follows', () => {
    const parts = splitSentences('Mr. Smith calls Dr. Lee. She agrees.', 'en');
    expect(parts.map((p) => p.trim())).toEqual(['Mr. Smith calls Dr. Lee.', 'She agrees.']);
  });

  it('cuts very long sentences at a comma so Kokoro does not truncate them', () => {
    const long = `${'word '.repeat(40).trim()}, ${'more '.repeat(40).trim()}, ${'end '.repeat(20).trim()}.`;
    const parts = splitSentences(long, 'en');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.trim().length <= 280)).toBe(true);
    expect(parts.join('')).toBe(long);
  });

  it('segments non-English text too', () => {
    expect(splitSentences('アンナは仕事を失う。家に帰る。', 'ja')).toEqual(['アンナは仕事を失う。', '家に帰る。']);
  });
});

describe('buildReadingScript', () => {
  const summary: EpisodeSummary = {
    overview: 'Anna loses her job. She hides it from Tom.',
    characters: [
      { name: 'Anna', role: 'a nurse' },
      { name: 'Tom', role: 'her husband.' },
    ],
    scenes: [
      { title: 'Bad news', summary: 'Anna is fired. She cries.', start: 0, end: 9, evidence: [] },
      { title: 'At home?', summary: 'Tom cooks dinner.', start: 10, end: 20, evidence: [] },
    ],
  };

  it('reads the overview, who is who, then each scene title and summary', () => {
    const { items, ranges } = buildReadingScript(summary, 'en');
    expect(items.map((it) => [it.key, it.speech])).toEqual([
      ['overview', 'Anna loses her job.'],
      ['overview', 'She hides it from Tom.'],
      ['cast:0', 'Anna: a nurse.'],
      ['cast:1', 'Tom: her husband.'],
      ['title:0', 'Bad news.'],
      ['scene:0', 'Anna is fired.'],
      ['scene:0', 'She cries.'],
      ['title:1', 'At home?'],
      ['scene:1', 'Tom cooks dinner.'],
    ]);
    expect(ranges).toEqual({ overview: [0, 1], cast: [2, 3], scenes: [[4, 6], [7, 8]] });
  });

  it("keeps each block's displayed text so the sentences rebuild its paragraph", () => {
    const { items } = buildReadingScript(summary, 'en');
    const text = (key: string) => items.filter((it) => it.key === key).map((it) => it.text).join('');
    expect(text('overview')).toBe(summary.overview);
    expect(text('scene:0')).toBe(summary.scenes[0].summary);
  });

  it('leaves out empty parts', () => {
    const { items, ranges } = buildReadingScript({ overview: '', characters: [], scenes: [] }, 'en');
    expect(items).toEqual([]);
    expect(ranges).toEqual({ overview: undefined, cast: undefined, scenes: [] });
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit mono PCM header and clamps samples', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 24000);
    const v = new DataView(wav);
    const ascii = (at: number, n: number) => String.fromCharCode(...new Uint8Array(wav, at, n));
    expect(wav.byteLength).toBe(44 + 8);
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767]);
  });
});
