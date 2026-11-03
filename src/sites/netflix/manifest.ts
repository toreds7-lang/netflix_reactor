import type { TrackInfo, TrackKind, TrackSource, VideoMeta } from '../../core/types';
import { isJapanese } from '../../core/langs';

/** Subtitle profiles we ask Netflix for, in general preference order. */
export const TEXT_PROFILES = ['webvtt-lssdh-ios8', 'imsc1.1', 'dfxp-ls-sdh', 'simplesdh'];

function profileOrder(lang: string): string[] {
  // IMSC carries ruby (furigana) for Japanese, so prefer it there.
  return isJapanese(lang) ? ['imsc1.1', 'webvtt-lssdh-ios8', 'dfxp-ls-sdh', 'simplesdh'] : TEXT_PROFILES;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function urlsOf(downloadable: any): string[] {
  if (!downloadable || typeof downloadable !== 'object') return [];
  const out: string[] = [];
  if (Array.isArray(downloadable.urls)) {
    for (const u of downloadable.urls) {
      if (typeof u === 'string') out.push(u);
      else if (u && typeof u.url === 'string') out.push(u.url);
    }
  }
  if (downloadable.downloadUrls && typeof downloadable.downloadUrls === 'object') {
    for (const u of Object.values(downloadable.downloadUrls)) if (typeof u === 'string') out.push(u);
  }
  return out;
}

function kindOf(t: any): TrackKind {
  if (t.isForcedNarrative) return 'forced';
  return t.rawTrackType === 'closedcaptions' ? 'closedcaptions' : 'subtitles';
}

/** Locate the timed text track list in a parsed manifest response (several shapes exist). */
function findManifest(obj: any): { tracks: any[]; videoId: string | null } | null {
  const candidates = [obj?.result, obj, obj?.result?.result];
  for (const c of candidates) {
    // Newer manifests call the list textTracks (and each track's downloads `downloadables`).
    const list = Array.isArray(c?.timedtexttracks) ? c.timedtexttracks : Array.isArray(c?.textTracks) ? c.textTracks : null;
    if (list) {
      const id = c.movieId ?? c.viewableId ?? c.movie_id ?? null;
      return { tracks: list, videoId: id != null ? String(id) : null };
    }
  }
  return null;
}

export function isManifest(obj: unknown): boolean {
  return findManifest(obj) !== null;
}

export function extractTracks(obj: unknown): { videoId: string | null; tracks: TrackInfo[] } | null {
  const found = findManifest(obj);
  if (!found) return null;
  const tracks: TrackInfo[] = [];
  const seen = new Set<string>();
  for (const t of found.tracks) {
    if (!t || t.isNoneTrack || !t.language) continue;
    const dl = t.ttDownloadables ?? t.downloadables ?? {};
    const sources: TrackSource[] = [];
    for (const profile of profileOrder(t.language)) {
      const d = dl[profile];
      if (!d || d.isImage) continue;
      for (const url of urlsOf(d)) sources.push({ profile, url });
    }
    if (!sources.length) continue;
    const kind = kindOf(t);
    const id = String(t.new_track_id ?? t.trackId ?? t.id ?? `${t.language}-${kind}`);
    const dedupe = `${t.language}|${kind}|${id}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    let label: string = t.languageDescription || t.language;
    if (kind === 'closedcaptions' && !/\bCC\b/.test(label)) label += ' [CC]';
    if (kind === 'forced' && !/forced/i.test(label)) label += ' (forced)';
    tracks.push({ id, lang: t.language, label, kind, sources });
  }
  return { videoId: found.videoId, tracks };
}

/**
 * Netflix sends several manifests per title, each with download links for only some tracks ("partial hydration"):
 * the ones playing or chosen in its menu. A later manifest can lack the English track an earlier one had, so tracks
 * are kept from every manifest, in their first order, with the newest links.
 */
export function mergeTracks(previous: TrackInfo[], next: TrackInfo[]): TrackInfo[] {
  const fresh = new Map(next.map((t) => [t.id, t]));
  const known = new Set(previous.map((t) => t.id));
  return [...previous.map((t) => fresh.get(t.id) ?? t), ...next.filter((t) => !known.has(t.id))];
}

/** Extract titles from Netflix's /metadata response, keyed by the id used in /watch/{id}. */
export function extractMetadata(obj: unknown): Record<string, VideoMeta> | null {
  const video = (obj as any)?.video;
  if (!video || typeof video !== 'object' || typeof video.title !== 'string' || video.id == null) return null;
  const entries: Record<string, VideoMeta> = {};
  if (video.type === 'show' && Array.isArray(video.seasons)) {
    for (const season of video.seasons) {
      for (const ep of season?.episodes ?? []) {
        const id = ep?.id ?? ep?.episodeId;
        if (id == null) continue;
        const s = season.seq ?? season.shortName ?? '';
        const e = ep.seq ?? '';
        entries[String(id)] = {
          title: video.title,
          episodeTitle: `S${s}:E${e}${ep.title ? ` “${ep.title}”` : ''}`,
        };
      }
    }
  }
  entries[String(video.id)] = { title: video.title };
  return entries;
}

/**
 * Mutate an outgoing manifest request so Netflix returns text subtitle profiles
 * and every available language. Returns true when the object was patched.
 */
export function patchManifestRequest(value: unknown): boolean {
  const v = value as any;
  const params = v?.params;
  if (!params || typeof params !== 'object' || !Array.isArray(params.profiles)) return false;
  const looksLikeManifest =
    'viewableId' in params || 'viewableIds' in params || /manifest/i.test(String(v.url ?? ''));
  if (!looksLikeManifest) return false;
  for (const p of TEXT_PROFILES) if (!params.profiles.includes(p)) params.profiles.push(p);
  params.showAllSubDubTracks = true;
  return true;
}
