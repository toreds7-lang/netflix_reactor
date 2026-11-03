import { describe, expect, it } from 'vitest';
import { parseSubtitles } from '../src/core/subtitles';
import { parseTtml, parseTtmlTime } from '../src/core/subtitles/ttml';

const DFXP = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"
    xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000" xml:lang="es">
  <head><styling><style xml:id="s1" tts:fontStyle="italic"/></styling></head>
  <body><div>
    <p begin="60300000t" end="81250000t" xml:id="subtitle0"><span style="s1">¿Adónde</span> vas?</p>
    <p begin="90000000t" end="110000000t"><span>A casa.</span><br/>Ahora mismo.</p>
    <p begin="120000000t" end="130000000t">   </p>
  </div></body>
</tt>`;

const IMSC = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:lang="ja">
  <body><div>
    <p begin="00:00:05.422" end="00:00:07.382"><span tts:ruby="container"><span tts:ruby="base">今日</span><span tts:ruby="text">きょう</span></span>は<span tts:ruby="container"><span tts:ruby="base">雨</span><span tts:ruby="text">あめ</span></span>だ</p>
  </div></body>
</tt>`;

describe('parseTtmlTime', () => {
  const base = { tickRate: 10_000_000, frameRate: 25 };
  it('supports ticks, clock times, offsets and frames', () => {
    expect(parseTtmlTime('60300000t', base)).toBe(6030);
    expect(parseTtmlTime('00:01:02.5', base)).toBe(62_500);
    expect(parseTtmlTime('1.5s', base)).toBe(1500);
    expect(parseTtmlTime('250ms', base)).toBe(250);
    expect(parseTtmlTime('00:00:01:05', base)).toBe(1200);
    expect(parseTtmlTime('nonsense', base)).toBeNaN();
  });
});

describe('parseTtml', () => {
  it('parses Netflix DFXP with tick timing and <br/>', () => {
    const cues = parseTtml(DFXP);
    expect(cues).toEqual([
      { start: 6030, end: 8125, text: '¿Adónde vas?' },
      { start: 9000, end: 11000, text: 'A casa.\nAhora mismo.' },
    ]);
  });

  it('parses IMSC ruby into segments', () => {
    const [cue] = parseTtml(IMSC);
    expect(cue.text).toBe('今日は雨だ');
    expect(cue.ruby).toEqual([
      { base: '今日', ruby: 'きょう' },
      { base: 'は' },
      { base: '雨', ruby: 'あめ' },
      { base: 'だ' },
    ]);
  });

  it('returns [] for malformed XML', () => {
    expect(parseTtml('<tt><p begin=')).toEqual([]);
  });
});

describe('parseSubtitles', () => {
  it('picks the parser from the profile or content', () => {
    expect(parseSubtitles(DFXP, 'dfxp-ls-sdh')).toHaveLength(2);
    expect(parseSubtitles('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n')).toHaveLength(1);
  });
});
