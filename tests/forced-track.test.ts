import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app/controller';
import { mainTrack, rawCues, settings, status, tracks, videoId } from '../src/app/state';
import type { NativeTrackState, ShowSubtitlesResult } from '../src/core/bridge';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import type { Cue, TrackInfo } from '../src/core/types';
import type { SiteAdapter } from '../src/sites/adapter';
import { extractTracks, mergeTracks } from '../src/sites/netflix/manifest';
import { installNetflixHooks } from '../src/sites/netflix/main-world';

vi.mock('../src/core/messages', () => ({ send: vi.fn() }));

const EN_ID = 'T:1:0;1;en;0;0;0;';
const FORCED_ID = 'T:1:1;1;en;1;0;0;';
const KO_ID = 'T:1:0;1;ko;0;0;0;';
const make = (id: string, lang: string, kind: TrackInfo['kind'], label: string, url = `https://x.nflxvideo.net/${id}`) =>
  ({ id, lang, label, kind, sources: [{ profile: 'webvtt-lssdh-ios8', url }] }) satisfies TrackInfo;
const EN = make(EN_ID, 'en', 'subtitles', 'English');
const FORCED = make(FORCED_ID, 'en', 'forced', 'English (forced)');
const KO = make(KO_ID, 'ko', 'subtitles', 'Korean');
const NATIVE_EN: NativeTrackState = { id: EN_ID, lang: 'en', label: 'English', isNone: false };
// What Netflix plays while its subtitle menu says Off.
const NATIVE_OFF: NativeTrackState = { id: FORCED_ID, lang: 'en', label: 'English', isNone: false, forced: true };

/** Manifest track as Netflix sends it; without a URL it wasn't "hydrated" in that manifest. */
const raw = (id: string, language: string, opts: { forced?: boolean; url?: string } = {}) => ({
  new_track_id: id,
  language,
  languageDescription: language === 'en' ? 'English' : 'Korean',
  rawTrackType: 'subtitles',
  isNoneTrack: false,
  isForcedNarrative: !!opts.forced,
  hydrated: !!opts.url,
  ttDownloadables: opts.url ? { 'webvtt-lssdh-ios8': { downloadUrls: { '1': opts.url } } } : {},
});

describe('Netflix manifests', () => {
  it('reads the newer format (textTracks, downloadables, id)', () => {
    const r = extractTracks({
      result: {
        movieId: 81664825,
        textTracks: [
          {
            id: EN_ID,
            language: 'en',
            languageDescription: 'English',
            rawTrackType: 'subtitles',
            downloadables: { 'webvtt-lssdh-ios8': { urls: [{ url: 'https://x.nflxvideo.net/en.vtt', cdn_id: 1 }] } },
          },
        ],
      },
    })!;
    expect(r.videoId).toBe('81664825');
    expect(r.tracks).toEqual([{ ...EN, sources: [{ profile: 'webvtt-lssdh-ios8', url: 'https://x.nflxvideo.net/en.vtt' }] }]);
  });

  it('keeps tracks a later manifest lacks, in their order, with the newest links', () => {
    const newEn = make(EN_ID, 'en', 'subtitles', 'English', 'https://x.nflxvideo.net/new');
    expect(mergeTracks([EN, KO], [FORCED, newEn])).toEqual([newEn, KO, FORCED]);
  });

  it('the page hook keeps the English track when the next manifest only has the forced one', () => {
    installNetflixHooks();
    const posted = vi.spyOn(window, 'postMessage');
    const manifest = (tracks: unknown[]) => JSON.stringify({ result: { movieId: 81664825, timedtexttracks: tracks } });
    JSON.parse(manifest([raw(EN_ID, 'en', { url: 'https://x.nflxvideo.net/en' }), raw(FORCED_ID, 'en', { forced: true })]));
    JSON.parse(manifest([raw(EN_ID, 'en'), raw(FORCED_ID, 'en', { forced: true, url: 'https://x.nflxvideo.net/f' })]));
    const last = posted.mock.calls.at(-1)![0] as { type: string; videoId: string; tracks: TrackInfo[] };
    expect(last.type).toBe('tracks');
    expect(last.videoId).toBe('81664825');
    expect(last.tracks.map((t) => [t.id, t.kind])).toEqual([
      [EN_ID, 'subtitles'],
      [FORCED_ID, 'forced'],
    ]);
  });
});

describe('picking the main track', () => {
  type Ctl = { refresh(): Promise<void>; followNativeTrack(): Promise<void> };
  let list: TrackInfo[];
  let native: NativeTrackState | null;
  let answer: ShowSubtitlesResult;
  let loadTrack: ReturnType<typeof vi.fn>;
  let showSubtitles: ReturnType<typeof vi.fn>;
  let c: Ctl;

  beforeEach(() => {
    videoId.value = null;
    tracks.value = [];
    mainTrack.value = null;
    rawCues.value = [];
    settings.value = { ...DEFAULT_SETTINGS, learningLang: 'en' };
    loadTrack = vi.fn(async (t: TrackInfo): Promise<Cue[]> => [{ start: 0, end: 1000, text: t.label }]);
    showSubtitles = vi.fn(async () => answer);
    const adapter = {
      currentVideoId: () => '81664825',
      getMeta: () => null,
      getTracks: () => list,
      getNativeTrack: async () => native,
      showSubtitles,
      loadTrack,
    };
    c = new AppController(adapter as unknown as SiteAdapter) as unknown as Ctl;
  });

  afterEach(() => vi.restoreAllMocks());

  it("doesn't switch to the forced track when Netflix's English track is missing from the list", async () => {
    list = [EN, FORCED];
    native = NATIVE_EN;
    await c.refresh();
    expect(mainTrack.value?.id).toBe(EN_ID);
    list = [FORCED];
    await c.refresh();
    await c.followNativeTrack();
    expect(mainTrack.value?.id).toBe(EN_ID);
    expect(loadTrack.mock.calls.map(([t]) => t.id)).toEqual([EN_ID]);
  });

  it('with Netflix Off, turns English on in Netflix and loads it when it comes', async () => {
    list = [FORCED, KO];
    native = NATIVE_OFF;
    answer = 'switched';
    await c.refresh();
    expect(showSubtitles).toHaveBeenCalledWith('en');
    expect(loadTrack).not.toHaveBeenCalled();
    expect(status.value).toEqual({ kind: 'loading', message: 'Turning on English subtitles in Netflix…' });

    // Netflix sends the English track (its manifest updates the list) and now plays it.
    list = [FORCED, KO, EN];
    native = NATIVE_EN;
    await c.refresh();
    expect(mainTrack.value?.id).toBe(EN_ID);
    expect(rawCues.value[0].text).toBe('English');
    expect(showSubtitles).toHaveBeenCalledTimes(1);
  });

  it("with Netflix Off, uses the full English track without asking when it's there", async () => {
    list = [FORCED, EN];
    native = NATIVE_OFF;
    await c.refresh();
    expect(mainTrack.value?.id).toBe(EN_ID);
    expect(showSubtitles).not.toHaveBeenCalled();
  });

  it('asks for a reload when Netflix never sends the track, rather than showing the forced one', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    list = [FORCED];
    native = NATIVE_OFF;
    answer = 'switched';
    await c.refresh();
    now.mockReturnValue(1_000_000 + 8000);
    await c.followNativeTrack();
    expect(loadTrack).not.toHaveBeenCalled();
    expect(status.value).toEqual({
      kind: 'error',
      message: "Netflix didn't send the full English subtitles. Reload the page (Ctrl+R).",
    });
    expect(showSubtitles).toHaveBeenCalledTimes(1);
  });

  it('falls back to another full track when Netflix has no subtitles in the learning language', async () => {
    list = [FORCED, KO];
    native = NATIVE_OFF;
    answer = 'missing';
    await c.refresh();
    expect(mainTrack.value?.id).toBe(KO_ID);
  });

  it('asks again when the player was not ready', async () => {
    list = [FORCED];
    native = NATIVE_OFF;
    showSubtitles.mockRejectedValueOnce(new Error('Netflix player not ready'));
    answer = 'switched';
    await c.refresh();
    expect(loadTrack).not.toHaveBeenCalled();
    await c.followNativeTrack();
    expect(showSubtitles).toHaveBeenCalledTimes(2);
    expect(status.value).toEqual({ kind: 'loading', message: 'Turning on English subtitles in Netflix…' });
  });
});
