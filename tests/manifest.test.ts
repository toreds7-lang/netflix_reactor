import { describe, expect, it } from 'vitest';
import { extractMetadata, extractTracks, patchManifestRequest } from '../src/sites/netflix/manifest';

const MANIFEST = {
  result: {
    movieId: 81234567,
    timedtexttracks: [
      {
        new_track_id: 'T:1:0;1;en;0;0;0;',
        language: 'en',
        languageDescription: 'English',
        rawTrackType: 'subtitles',
        isNoneTrack: false,
        isForcedNarrative: false,
        ttDownloadables: {
          'webvtt-lssdh-ios8': { downloadUrls: { '1': 'https://ipv4-c001.1.nflxvideo.net/?o=1&v=en' } },
          'dfxp-ls-sdh': { urls: [{ url: 'https://ipv4-c001.1.nflxvideo.net/?o=1&d=en', cdn_id: 1 }] },
        },
      },
      {
        new_track_id: 'T:2:0;1;en;1;0;0;',
        language: 'en',
        languageDescription: 'English',
        rawTrackType: 'closedcaptions',
        ttDownloadables: { 'webvtt-lssdh-ios8': { downloadUrls: { '1': 'https://x.nflxvideo.net/cc' } } },
      },
      {
        new_track_id: 'T:3',
        language: 'ja',
        languageDescription: 'Japanese',
        rawTrackType: 'subtitles',
        ttDownloadables: {
          'webvtt-lssdh-ios8': { downloadUrls: { '1': 'https://x.nflxvideo.net/ja.vtt' } },
          'imsc1.1': { downloadUrls: { '1': 'https://x.nflxvideo.net/ja.xml' } },
        },
      },
      { new_track_id: 'none', isNoneTrack: true, language: null, ttDownloadables: {} },
      {
        new_track_id: 'T:4',
        language: 'ko',
        languageDescription: 'Korean',
        rawTrackType: 'subtitles',
        ttDownloadables: { 'nflx-cmisc': { isImage: true, downloadUrls: { '1': 'https://x/img.zip' } } },
      },
    ],
  },
};

describe('extractTracks', () => {
  it('extracts text tracks with preferred profile order', () => {
    const r = extractTracks(MANIFEST)!;
    expect(r.videoId).toBe('81234567');
    expect(r.tracks.map((t) => [t.lang, t.kind, t.label])).toEqual([
      ['en', 'subtitles', 'English'],
      ['en', 'closedcaptions', 'English [CC]'],
      ['ja', 'subtitles', 'Japanese'],
    ]);
    expect(r.tracks[0].sources).toEqual([
      { profile: 'webvtt-lssdh-ios8', url: 'https://ipv4-c001.1.nflxvideo.net/?o=1&v=en' },
      { profile: 'dfxp-ls-sdh', url: 'https://ipv4-c001.1.nflxvideo.net/?o=1&d=en' },
    ]);
  });

  it('prefers IMSC for Japanese (ruby support)', () => {
    const ja = extractTracks(MANIFEST)!.tracks[2];
    expect(ja.sources[0].profile).toBe('imsc1.1');
  });

  it('accepts the unwrapped shape and ignores non-manifests', () => {
    expect(extractTracks(MANIFEST.result)?.tracks).toHaveLength(3);
    expect(extractTracks({ foo: 1 })).toBeNull();
  });
});

describe('patchManifestRequest', () => {
  it('adds text profiles and all languages to manifest requests', () => {
    const req = { url: 'manifest', params: { viewableId: 1, profiles: ['playready-h264mpl30-dash'] } };
    expect(patchManifestRequest(req)).toBe(true);
    expect(req.params.profiles).toContain('webvtt-lssdh-ios8');
    expect(req.params.profiles).toContain('imsc1.1');
    expect((req.params as Record<string, unknown>).showAllSubDubTracks).toBe(true);
  });

  it('leaves other objects alone', () => {
    const other = { params: { profiles: ['a'] } };
    expect(patchManifestRequest(other)).toBe(false);
    expect(other.params.profiles).toEqual(['a']);
    expect(patchManifestRequest('string')).toBe(false);
  });
});

describe('extractMetadata', () => {
  it('maps episode ids to show and episode titles', () => {
    const entries = extractMetadata({
      video: {
        id: 100,
        title: 'Dark',
        type: 'show',
        seasons: [{ seq: 1, episodes: [{ id: 101, seq: 1, title: 'Secrets' }] }],
      },
    })!;
    expect(entries['101']).toEqual({ title: 'Dark', episodeTitle: 'S1:E1 “Secrets”' });
    expect(entries['100']).toEqual({ title: 'Dark' });
  });

  it('handles movies', () => {
    expect(extractMetadata({ video: { id: 5, title: 'Roma', type: 'movie' } })).toEqual({ '5': { title: 'Roma' } });
  });
});
