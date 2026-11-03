import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app/controller';
import { mainTrack, rawCues, settings, tracks, videoId } from '../src/app/state';
import { send } from '../src/core/messages';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import type { Cue, TrackInfo } from '../src/core/types';
import type { SiteAdapter } from '../src/sites/adapter';
import { NetflixAdapter } from '../src/sites/netflix/adapter';

vi.mock('../src/core/messages', () => ({ send: vi.fn() }));

// Netflix gives the same English track the same ID in every title.
const EN_ID = 'T:1:0;1;en;0;0;0;';
const track = (videoId: string): TrackInfo => ({
  id: EN_ID,
  lang: 'en',
  label: 'English',
  kind: 'subtitles',
  sources: [{ profile: 'webvtt-lssdh-ios8', url: `https://x.nflxvideo.net/${videoId}.vtt` }],
});
const vtt = (text: string) => `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${text}\n`;

describe('NetflixAdapter.loadTrack', () => {
  it("doesn't give the next title the previous title's subtitles", async () => {
    const fetchText = vi.mocked(send).mockImplementation((async (_type: string, payload: { url: string }) =>
      vtt(payload.url.includes('friends') ? "There's nothing to tell." : 'I hope.')) as never);
    const adapter = new NetflixAdapter();
    expect((await adapter.loadTrack(track('friends')))[0].text).toBe("There's nothing to tell.");
    expect((await adapter.loadTrack(track('shawshank')))[0].text).toBe('I hope.');
    // The same track again comes from the cache.
    await adapter.loadTrack(track('shawshank'));
    expect(fetchText).toHaveBeenCalledTimes(2);
  });
});

describe('opening another title while the track is being picked', () => {
  beforeEach(() => {
    videoId.value = null;
    tracks.value = [];
    mainTrack.value = null;
    rawCues.value = [];
    settings.value = { ...DEFAULT_SETTINGS, learningLang: 'en' };
  });

  it("uses the next title's own track list, although its track IDs are the same", async () => {
    let current = 'friends';
    const loadTrack = vi.fn(async (t: TrackInfo): Promise<Cue[]> => [{ start: 0, end: 1000, text: t.sources[0].url }]);
    const adapter = {
      currentVideoId: () => current,
      getMeta: () => null,
      getTracks: (id: string) => [track(id)],
      getNativeTrack: async () => ({ id: EN_ID, lang: 'en', label: 'English', isNone: false }),
      loadTrack,
    };
    const c = new AppController(adapter as unknown as SiteAdapter) as unknown as { refresh(): Promise<void> };
    await c.refresh();
    current = 'shawshank';
    await c.refresh();
    expect(tracks.value[0].sources[0].url).toBe('https://x.nflxvideo.net/shawshank.vtt');
    expect(rawCues.value[0].text).toBe('https://x.nflxvideo.net/shawshank.vtt');
  });

  it("loads the new title's track, not the old one's", async () => {
    let current = 'friends';
    const answers: ((v: unknown) => void)[] = [];
    const loadTrack = vi.fn(async (t: TrackInfo): Promise<Cue[]> => [{ start: 0, end: 1000, text: t.sources[0].url }]);
    const adapter = {
      currentVideoId: () => current,
      getMeta: () => null,
      getTracks: (id: string) => [track(id)],
      getNativeTrack: () => new Promise((resolve) => answers.push(resolve)),
      loadTrack,
    };
    const c = new AppController(adapter as unknown as SiteAdapter) as unknown as { refresh(): Promise<void> };
    const native = { id: EN_ID, lang: 'en', label: 'English', isNone: false };

    const first = c.refresh(); // Friends: waiting for Netflix's answer
    current = 'shawshank';
    await c.refresh(); // Shawshank: its pick is skipped while Friends' runs
    answers[0](native); // the answer arrives after the switch
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    answers[1](native);
    await first;

    expect(loadTrack.mock.calls.map(([t]) => t.sources[0].url)).toEqual(['https://x.nflxvideo.net/shawshank.vtt']);
    expect(videoId.value).toBe('shawshank');
    expect(rawCues.value[0].text).toBe('https://x.nflxvideo.net/shawshank.vtt');
  });
});
