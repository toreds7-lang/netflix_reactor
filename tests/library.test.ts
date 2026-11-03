import { describe, expect, it } from 'vitest';
import { buildUnits } from '../src/core/keylines';
import {
  addRanges,
  buildIndex,
  findChunks,
  findSentenceId,
  isFreshRun,
  isWatched,
  libraryKey,
  librarySentences,
  linesInEpisode,
  parseLibraryFile,
  parseQuery,
  rankMatches,
  runItem,
  runOrder,
  textMatches,
  toLibraryFile,
  translationMatches,
  watchedShare,
  wordLine,
  wordsOf,
  FIND_RUN_TTL_MS,
  type HitFilters,
  type LibraryEpisode,
  type LibraryIndex,
  type Match,
  type RankContext,
} from '../src/core/library';
import type { Cue } from '../src/core/types';
import { formsOf, spokenAlternatives } from '../src/core/wordforms';

/** An English episode whose sentences start at 10 s, 20 s, 30 s… and last 2 s. */
function ep(videoId: string, texts: string[], patch: Partial<LibraryEpisode> & { tr?: (string | undefined)[] } = {}): LibraryEpisode {
  const { tr, ...rest } = patch;
  const sentences = texts.map((text, i) => ({
    start: (i + 1) * 10_000,
    end: (i + 1) * 10_000 + 2000,
    text,
    from: { timeMs: (i + 1) * 10_000, text },
    ...(tr?.[i] ? { tr: tr[i] } : {}),
  }));
  return {
    key: libraryKey(videoId, 'en'),
    videoId,
    lang: 'en',
    show: `Show ${videoId}`,
    episode: 'S1:E1',
    sentences,
    words: sentences.map((s) => wordLine(s.text, 'en')),
    savedAt: 1,
    updatedAt: 1,
    ...rest,
  };
}

const textsOf = (idx: LibraryIndex, ms: Match[]) =>
  ms.map((m) => idx.episodes[idx.epOf[m.id]].sentences[idx.atOf[m.id]].text).sort();
const byTier = (idx: LibraryIndex, ms: Match[], tier: Match['tier']) => textsOf(idx, ms.filter((m) => m.tier === tier));

const ALL: HitFilters = { here: null, scope: 'all', length: 'any', watchedOnly: false, keyOnly: false };
const ctx = (patch: Partial<RankContext> = {}): RankContext => ({ lang: 'en', watched: () => true, ...patch });

describe('words', () => {
  it('splits a line into lower-case words, keeping apostrophes inside words and on clipped words', () => {
    expect(wordsOf("I’m gonna say 'cause Don't, okay?", 'en').map((t) => t.word)).toEqual(["i'm", 'gonna', 'say', "'cause", "don't", 'okay']);
    expect(wordsOf("'Hello,' kids' toys", 'en').map((t) => t.word)).toEqual(['hello', 'kids', 'toys']);
    const t = wordsOf('Oh, really?', 'en');
    expect(t.map((x) => [x.index, x.length])).toEqual([
      [0, 2],
      [4, 6],
    ]);
  });

  it('splits languages without spaces with the word segmenter', () => {
    expect(wordsOf('我喜欢你', 'zh').length).toBeGreaterThan(1);
  });
});

describe('word forms', () => {
  const vocab = new Set(
    'go goes went gone going make makes made making stop stops stopped stopping city cities evening even use uses used using us leave leaves left leaf watch watches watched watching'.split(' '),
  );
  const has = (w: string) => vocab.has(w);

  it('finds irregular forms in both directions', () => {
    expect(formsOf('go', has).sort()).toEqual(['go', 'goes', 'going', 'gone', 'went']);
    expect(formsOf('went', has).sort()).toEqual(['go', 'goes', 'going', 'gone', 'went']);
    expect(formsOf('made', has)[0]).toBe('made');
  });

  it('finds regular forms, with doubled letters and -ies', () => {
    expect(formsOf('stop', has).sort()).toEqual(['stop', 'stopped', 'stopping', 'stops']);
    expect(formsOf('stopped', has).sort()).toEqual(['stop', 'stopped', 'stopping', 'stops']);
    expect(formsOf('cities', has).sort()).toEqual(['cities', 'city']);
    expect(formsOf('watches', has).sort()).toEqual(['watch', 'watched', 'watches', 'watching']);
  });

  it("doesn't take one word for a form of another just because the letters fit", () => {
    expect(formsOf('evening', has)).toEqual(['evening']);
    expect(formsOf('even', has)).toEqual(['even']);
    expect(formsOf('using', has).sort()).toEqual(['use', 'used', 'uses', 'using']);
  });

  it('only returns forms that are in your episodes', () => {
    expect(formsOf('jump', (w) => w === 'jumped')).toEqual(['jump', 'jumped']);
  });
});

describe('spoken forms', () => {
  it('swaps a spoken form for what it stands for, and back', () => {
    expect(spokenAlternatives(['gonna'])).toEqual([['going', 'to']]);
    expect(spokenAlternatives(['going', 'to'])).toEqual([['gonna']]);
    expect(spokenAlternatives(["you're", 'gonna', 'have', 'to'])).toEqual([
      ["you're", 'going', 'to', 'have', 'to'],
      ["you're", 'gonna', 'hafta'],
    ]);
    expect(spokenAlternatives(['because'])).toContainEqual(["'cause"]);
    expect(spokenAlternatives(['hello'])).toEqual([]);
  });
});

describe('the episode for the library', () => {
  it('keeps each sentence with its first and last line and, when all its lines have one, its translation', () => {
    const raw: Cue[] = [
      { start: 1000, end: 2000, text: 'Where are you' },
      { start: 2100, end: 3000, text: 'going?' },
      { start: 5000, end: 6000, text: 'Home.' },
    ];
    const s = librarySentences(buildUnits(raw), raw, ['어디', '가니?', null]);
    expect(s).toEqual([
      { start: 1000, end: 3000, text: 'Where are you going?', tr: '어디 가니?', from: { timeMs: 1000, text: 'Where are you' }, to: { timeMs: 2100, text: 'going?' } },
      { start: 5000, end: 6000, text: 'Home.', from: { timeMs: 5000, text: 'Home.' } },
    ]);
    expect(librarySentences(buildUnits(raw), raw, [])[0].tr).toBeUndefined();
  });
});

describe('watched parts', () => {
  it('joins ranges that overlap or nearly touch, and finds lines inside them', () => {
    const r = addRanges([[10_000, 12_000]], [
      [12_500, 14_000],
      [30_000, 31_000],
      [5000, 6000],
    ]);
    expect(r).toEqual([
      [5000, 6000],
      [10_000, 14_000],
      [30_000, 31_000],
    ]);
    expect(isWatched(r, 11_000)).toBe(true);
    expect(isWatched(r, 9800)).toBe(true); // starts just before
    expect(isWatched(r, 20_000)).toBe(false);
    expect(isWatched(undefined, 1)).toBe(false);
    expect(watchedShare(ep('a', ['One.', 'Two.', 'Three.']), [[10_000, 22_000]])).toBeCloseTo(2 / 3);
  });
});

describe('text search', () => {
  const idx = buildIndex([
    ep('a', ["I'm going to go home.", 'She went home early.', "We're gonna be late.", 'He has gone.', 'Going to the store.', 'I go to school.']),
  ]);

  it('finds the same word first, then its other forms', () => {
    const { matches, forms } = textMatches(idx, parseQuery('go', 'en'), 'en');
    expect(byTier(idx, matches, 'exact')).toEqual(['I go to school.', "I'm going to go home."]);
    expect(byTier(idx, matches, 'forms')).toEqual(['Going to the store.', 'He has gone.', 'She went home early.']);
    expect(forms).toEqual(['going', 'gone', 'went']);
  });

  it('finds a phrase only with its words next to each other, and its spoken form', () => {
    const { matches } = textMatches(idx, parseQuery('going to', 'en'), 'en');
    expect(byTier(idx, matches, 'exact')).toEqual(['Going to the store.', "I'm going to go home."]);
    expect(byTier(idx, matches, 'spoken')).toEqual(["We're gonna be late."]);
    expect(byTier(idx, matches, 'forms')).toEqual(['I go to school.']);
    const back = textMatches(idx, parseQuery('gonna', 'en'), 'en').matches;
    expect(byTier(idx, back, 'spoken')).toEqual(['Going to the store.', "I'm going to go home."]);
  });

  it('marks the words that matched', () => {
    const { matches } = textMatches(idx, parseQuery('to go', 'en'), 'en');
    const m = matches.find((x) => x.tier === 'exact')!;
    expect(m.marks).toEqual([2, 3]); // i'm going [to go] home
  });

  it('with *, finds a pattern with up to 3 words in the gap', () => {
    const p = buildIndex([ep('p', ['I can not believe it.', "I can't believe you.", 'I really really really really believe.', 'Believe me.'])]);
    expect(parseQuery("I can't * believe", 'en')).toEqual(['i', "can't", null, 'believe']);
    const { matches } = textMatches(p, parseQuery('I * believe', 'en'), 'en');
    expect(byTier(p, matches, 'pattern')).toEqual(['I can not believe it.', "I can't believe you."]);
    expect(parseQuery('* hello * ', 'en')).toEqual(['hello']);
    expect(parseQuery('I ___ you', 'en')).toEqual(['i', null, 'you']);
  });

  it('finds nothing for an empty query', () => {
    expect(textMatches(idx, parseQuery('  * ', 'en'), 'en').matches).toEqual([]);
  });
});

describe('chunks', () => {
  const idx = buildIndex([
    ep('a', ["I don't think so.", "You're gonna have to wait.", 'Of the people.']),
    ep('b', ["I don't think that's true.", "You're gonna have to run.", 'Some of the time.']),
    ep('c', ['Well, I really think it matters.', 'We have to try.', 'Out of the blue.']),
  ]);

  it('finds the runs of words other episodes have too, the longest when it is nearly as common', () => {
    const chunks = findChunks(idx, wordLine("You're gonna have to wait.", 'en').split(' '));
    const texts = chunks.map((c) => c.text);
    expect(texts).toContain("you're gonna have to");
    // In the same two episodes as the longer chunk: left out.
    expect(texts).not.toContain('gonna have to');
    // In a third episode too: kept.
    expect(texts).toContain('have to');
    expect(chunks.find((c) => c.text === 'have to')).toMatchObject({ episodes: 3, lines: 3 });
  });

  it('leaves out chunks of filler words, and ones ending in "the"', () => {
    const texts = findChunks(idx, wordLine('Out of the people.', 'en').split(' ')).map((c) => c.text);
    expect(texts).not.toContain('of the');
    expect(texts).not.toContain('out of the');
  });

  it('writes I as I', () => {
    expect(findChunks(idx, wordLine("I don't think so.", 'en').split(' ')).map((c) => c.text)).toContain("I don't think");
  });
});

describe('Korean search', () => {
  const idx = buildIndex([
    ep('k', ['I knew it.', 'I knew it would happen.', "Let's go."], { tr: ['그럴 줄 알았어.', '그렇게 될 줄 알았다.', '가자.'] }),
  ]);

  it('matches the translation line by letter pairs, so word endings and spacing may differ', () => {
    const ms = translationMatches(idx, '줄 알았어').sort((a, b) => b.score! - a.score!);
    expect(textsOf(idx, ms.slice(0, 1))).toEqual(['I knew it.']);
    expect(textsOf(idx, ms)).toEqual(['I knew it would happen.', 'I knew it.']);
    expect(translationMatches(idx, '그럴줄알았어').length).toBe(1);
    expect(translationMatches(idx, '고양이')).toEqual([]);
  });
});

describe('ranking', () => {
  it('puts the same words first, then lines you watched, then easy-to-shadow ones', () => {
    const idx = buildIndex([
      ep('a', [
        'Wait for me at the station near the big old clock tower tonight, okay, my dear friend.',
        'Wait for me here, please, okay.',
        'Wait for me.',
        'He waited.',
      ]),
    ]);
    const { matches } = textMatches(idx, parseQuery('wait', 'en'), 'en');
    const { hits } = rankMatches(idx, matches, ALL, ctx({ watched: (_, start) => start !== 20_000 }));
    expect(hits.map((h) => h.text)).toEqual([
      'Wait for me.',
      'Wait for me at the station near the big old clock tower tonight, okay, my dear friend.',
      'Wait for me here, please, okay.',
      'He waited.',
    ]);
    expect(hits.map((h) => h.watched)).toEqual([true, true, false, true]);
  });

  it('filters by episode, length, watched parts, show and key lines', () => {
    const idx = buildIndex([ep('a', ['Run.', 'Run as fast as you can, now.']), ep('b', ['Run home now please.'], { show: 'Other' })]);
    const { matches } = textMatches(idx, parseQuery('run', 'en'), 'en');
    const texts = (f: Partial<HitFilters>, c: Partial<RankContext> = {}) =>
      rankMatches(idx, matches, { ...ALL, here: 'a', ...f }, ctx(c)).hits.map((h) => h.text).sort();
    expect(texts({ scope: 'here' })).toEqual(['Run as fast as you can, now.', 'Run.']);
    expect(texts({ scope: 'others' })).toEqual(['Run home now please.']);
    expect(texts({ length: 'short' })).toEqual(['Run home now please.', 'Run.']);
    expect(texts({ length: 'medium' })).toEqual(['Run as fast as you can, now.']);
    expect(texts({ watchedOnly: true }, { watched: (e) => e.videoId === 'b' })).toEqual(['Run home now please.']);
    expect(texts({ show: 'Other' })).toEqual(['Run home now please.']);
    expect(texts({ keyOnly: true }, { isKey: (_, t) => t === 'Run.' })).toEqual(['Run.']);
    expect(rankMatches(idx, matches, ALL, ctx()).shows).toEqual(['Other', 'Show a']);
  });

  it('shows the same line once, with how often it was said', () => {
    const idx = buildIndex([ep('a', ['Thank you.']), ep('b', ['Thank you!']), ep('c', ['thank you'])]);
    const { matches } = textMatches(idx, parseQuery('thank', 'en'), 'en');
    const { hits, total } = rankMatches(idx, matches, { ...ALL, here: 'b' }, ctx());
    expect(total).toBe(1);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ dup: 3, videoId: 'b' }); // the episode open now plays at once
  });

  it('lets at most two lines of one episode come first, so you hear different people', () => {
    const idx = buildIndex([
      ep('a', ['Look at this one.', 'Look at that one.', 'Look at these ones.', 'Look over there.'], { updatedAt: 2 }),
      ep('b', ['Look out below.', 'Look at me now.']),
    ]);
    const { matches } = textMatches(idx, parseQuery('look', 'en'), 'en');
    const { hits } = rankMatches(idx, matches, ALL, ctx());
    expect(hits.map((h) => h.videoId)).toEqual(['a', 'a', 'b', 'b', 'a', 'a']);
  });

  it('shapes a hit with its lines, context and where it is', () => {
    const idx = buildIndex([ep('a', ['First.', 'Second line.', 'Third.'])]);
    const { matches } = textMatches(idx, parseQuery('second', 'en'), 'en');
    expect(rankMatches(idx, matches, ALL, ctx()).hits[0]).toMatchObject({
      id: 'a|en|20000',
      videoId: 'a',
      lang: 'en',
      show: 'Show a',
      start: 20_000,
      end: 22_000,
      from: { timeMs: 20_000, text: 'Second line.', lang: 'en' },
      to: { timeMs: 20_000, text: 'Second line.', lang: 'en' },
      before: 'First.',
      after: 'Third.',
      marks: [0],
      tier: 'exact',
      dup: 1,
    });
    expect(findSentenceId(idx, 'a|en', 30_000)).toBe(2);
    expect(findSentenceId(idx, 'x|en', 30_000)).toBe(-1);
  });
});

describe('playing what was found', () => {
  it('plays the episode open now first, then the others, each in video order', () => {
    const lines = [
      { videoId: 'b', start: 50 },
      { videoId: 'a', start: 90 },
      { videoId: 'b', start: 10 },
      { videoId: 'c', start: 5 },
      { videoId: 'a', start: 20 },
    ];
    expect(runOrder(lines, 'a')).toEqual([
      { videoId: 'a', start: 20 },
      { videoId: 'a', start: 90 },
      { videoId: 'b', start: 10 },
      { videoId: 'b', start: 50 },
      { videoId: 'c', start: 5 },
    ]);
    expect(runOrder(lines, 'z')[0]).toEqual({ videoId: 'b', start: 10 });
  });

  it('counts the lines left in the same episode, and drops an old or finished run', () => {
    const idx = buildIndex([ep('a', ['One.', 'Two.']), ep('b', ['Three.'])]);
    const { matches } = textMatches(idx, parseQuery('one', 'en'), 'en');
    const item = runItem(rankMatches(idx, matches, ALL, ctx()).hits[0]);
    expect(item).toMatchObject({ videoId: 'a', title: 'Show a · S1:E1', start: 10_000, text: 'One.' });
    const items = [item, item, { ...item, videoId: 'b' }];
    expect(linesInEpisode(items, 0)).toBe(2);
    expect(linesInEpisode(items, 2)).toBe(1);
    const run = { mode: 'play' as const, passes: 1, label: '', items, index: 0, at: 1000 };
    expect(isFreshRun(run, 2000)).toBe(true);
    expect(isFreshRun(run, 1000 + FIND_RUN_TTL_MS)).toBe(false);
    expect(isFreshRun({ ...run, index: 3 }, 2000)).toBe(false);
  });
});

describe('the library file', () => {
  it('writes episodes without their word lists, and reads them back checked', () => {
    const e = ep('a', ['Hello there.'], { tr: ['안녕.'] });
    const json = toLibraryFile([e], [{ key: e.key, ranges: [[1, 2]], updatedAt: 3 }]);
    expect(JSON.parse(json).episodes[0].words).toBeUndefined();
    const back = parseLibraryFile(json);
    expect(back.episodes).toEqual([{ ...e, words: undefined }].map(({ words, ...rest }) => (void words, rest)));
    expect(back.watched).toEqual([{ key: e.key, ranges: [[1, 2]], updatedAt: 3 }]);
  });

  it('refuses other files and skips broken episodes', () => {
    expect(() => parseLibraryFile('{"app":"polyglot-player","version":3,"words":[]}')).toThrow('Not a Polyglot Player library file.');
    const bad = { app: 'polyglot-player', kind: 'library', version: 1, episodes: [{ key: 'x', videoId: 'x', lang: 'en' }], watched: [] };
    expect(parseLibraryFile(JSON.stringify(bad)).episodes).toEqual([]);
  });
});
