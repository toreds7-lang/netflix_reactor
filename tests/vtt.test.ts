import { describe, expect, it } from 'vitest';
import { parseVtt, parseVttTime } from '../src/core/subtitles/vtt';

const NETFLIX_VTT = `WEBVTT

NOTE Netflix
NOTE Profile: webvtt-lssdh-ios8

1
00:00:05.422 --> 00:00:07.382 position:50.00%,middle align:middle size:80.00% line:84.67%
<c.bg_transparent>&lrm;Where are you going?</c.bg_transparent>

2
00:00:07.465 --> 00:01:10.010 position:50.00%,middle align:middle size:80.00% line:79.33%
<c.bg_transparent>-Home.</c.bg_transparent>
<c.bg_transparent>-Tom &amp; Jerry&#39;s place.</c.bg_transparent>

3
01:02:03.004 --> 01:02:04.500
<c.japanese><ruby>漢字<rt>かんじ</rt></ruby>を<ruby>読<rt>よ</rt></ruby>む</c.japanese>
`;

describe('parseVttTime', () => {
  it('parses with and without hours', () => {
    expect(parseVttTime('00:00:05.422')).toBe(5422);
    expect(parseVttTime('01:02:03.004')).toBe(3_723_004);
    expect(parseVttTime('02:03.5')).toBe(123_500);
    expect(parseVttTime('00:00:01,250')).toBe(1250);
  });
});

describe('parseVtt', () => {
  const cues = parseVtt(NETFLIX_VTT);

  it('reads all cues with timings', () => {
    expect(cues).toHaveLength(3);
    expect(cues[0]).toMatchObject({ start: 5422, end: 7382, text: 'Where are you going?' });
    expect(cues[1].end).toBe(70_010);
  });

  it('strips tags, bidi marks and decodes entities, keeping line breaks', () => {
    expect(cues[1].text).toBe("-Home.\n-Tom & Jerry's place.");
  });

  it('extracts ruby segments', () => {
    expect(cues[2].text).toBe('漢字を読む');
    expect(cues[2].ruby).toEqual([
      { base: '漢字', ruby: 'かんじ' },
      { base: 'を' },
      { base: '読', ruby: 'よ' },
      { base: 'む' },
    ]);
  });

  it('handles CRLF and a BOM', () => {
    const crlf = '﻿WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nHello\r\n';
    expect(parseVtt(crlf)).toEqual([{ start: 1000, end: 2000, text: 'Hello' }]);
  });
});
