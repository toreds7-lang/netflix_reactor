/**
 * Runs in the page's MAIN world at document_start, before Netflix's player loads.
 * - Hooks JSON.stringify to ask for text subtitle profiles and all languages.
 * - Hooks JSON.parse to capture subtitle track lists and title metadata.
 * - Exposes Netflix's internal player (seek/play/pause) to the isolated content script.
 */
import {
  postToIsolated,
  readBridgeMessage,
  type BridgeArgs,
  type NativeTrackState,
  type PlayerState,
  type ShowSubtitlesResult,
} from '../../core/bridge';
import { sameLanguage } from '../../core/langs';
import type { TrackInfo, VideoMeta } from '../../core/types';
import { extractMetadata, extractTracks, mergeTracks, patchManifestRequest } from './manifest';

/* eslint-disable @typescript-eslint/no-explicit-any */

const tracksByVideo = new Map<string, TrackInfo[]>();
const meta: Record<string, VideoMeta> = {};
let lastVideoId: string | null = null;

function inspectParsed(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const v = value as any;
  const found = extractTracks(v);
  if (found) {
    if (found.tracks.length) {
      const videoId = found.videoId ?? currentWatchId() ?? 'unknown';
      const merged = mergeTracks(tracksByVideo.get(videoId) ?? [], found.tracks);
      tracksByVideo.set(videoId, merged);
      lastVideoId = videoId;
      postToIsolated({ type: 'tracks', videoId, tracks: merged });
    }
    return;
  }
  if (v.video && typeof v.video.title === 'string') {
    const entries = extractMetadata(v);
    if (entries) {
      Object.assign(meta, entries);
      postToIsolated({ type: 'meta', entries });
    }
  }
}

function currentWatchId(): string | null {
  return /^\/watch\/(\d+)/.exec(location.pathname)?.[1] ?? null;
}

function getPlayer(): any | null {
  try {
    const api = (window as any).netflix?.appContext?.state?.playerApp?.getAPI?.();
    const vp = api?.videoPlayer;
    if (!vp) return null;
    const ids: string[] = vp.getAllPlayerSessionIds?.() ?? [];
    const id = ids.find((s) => s.startsWith('watch')) ?? ids[0];
    return id ? vp.getVideoPlayerBySessionId(id) : null;
  } catch {
    return null;
  }
}

function nativeTrack(player: any): NativeTrackState | null {
  try {
    const t = player?.getTimedTextTrack?.();
    if (!t) return null;
    return {
      id: t.trackId != null ? String(t.trackId) : t.id != null ? String(t.id) : undefined,
      lang: t.bcp47 ?? t.language,
      label: t.displayName ?? t.languageDescription,
      isNone: !!(t.isNoneTrack ?? t.isNone),
      forced: !!t.isForcedNarrative,
    };
  } catch {
    return null;
  }
}

/**
 * Choose a language in Netflix's own subtitle menu, as Language Reactor does. Netflix sends a track's download link
 * only once it's chosen there (or with the title's first manifest), and the new manifest is caught by inspectParsed.
 */
function showSubtitles(player: any, lang: string): ShowSubtitlesResult {
  const list: any[] = player.getTimedTextTrackList?.() ?? [];
  if (!list.length) throw new Error('Netflix player not ready');
  const full = list.filter((t) => t && !t.isForcedNarrative && !t.isNoneTrack && t.bcp47 && sameLanguage(t.bcp47, lang));
  const subtitles = full.filter((t) => t.rawTrackType !== 'closedcaptions');
  const pick = subtitles.find((t) => t.bcp47 === lang) ?? subtitles[0] ?? full[0];
  if (!pick) return 'missing';
  if (player.getTimedTextTrack?.()?.trackId === pick.trackId) return 'active';
  player.setTimedTextTrack(pick);
  return 'switched';
}

function handleCall(method: string, args?: BridgeArgs): unknown {
  const player = getPlayer();
  switch (method) {
    case 'seek':
      if (!player) throw new Error('Netflix player not ready');
      player.seek(Math.max(0, Math.round(args?.ms ?? 0)));
      return true;
    case 'play':
      if (player) player.play();
      else document.querySelector('video')?.play();
      return true;
    case 'pause':
      if (player) player.pause();
      else document.querySelector('video')?.pause();
      return true;
    case 'showSubtitles':
      if (!player) throw new Error('Netflix player not ready');
      return showSubtitles(player, args?.lang ?? '');
    case 'getState': {
      const state: PlayerState = {
        timeMs: player?.getCurrentTime?.() ?? null,
        paused: player?.isPaused?.() ?? null,
        track: nativeTrack(player),
      };
      return state;
    }
    default:
      throw new Error(`Unknown method ${method}`);
  }
}

export function installNetflixHooks(): void {
  const w = window as any;
  if (w.__polyglotHooked) return;
  w.__polyglotHooked = true;

  const origStringify = JSON.stringify;
  const origParse = JSON.parse;

  JSON.stringify = function (this: unknown, value: any, ...rest: any[]) {
    try {
      patchManifestRequest(value);
    } catch {
      /* never break Netflix */
    }
    return (origStringify as any).call(this, value, ...rest);
  } as typeof JSON.stringify;

  JSON.parse = function (this: unknown, text: string, reviver?: any) {
    const result = origParse.call(this, text, reviver);
    try {
      inspectParsed(result);
    } catch {
      /* never break Netflix */
    }
    return result;
  } as typeof JSON.parse;

  // Some Netflix endpoints (e.g. /metadata) are read with Response.json(), which bypasses JSON.parse.
  const origJson = Response.prototype.json;
  Response.prototype.json = function (this: Response) {
    return origJson.call(this).then((result: unknown) => {
      try {
        inspectParsed(result);
      } catch {
        /* never break Netflix */
      }
      return result;
    });
  };

  window.addEventListener('message', (event) => {
    const msg = readBridgeMessage(event, 'i2m');
    if (!msg) return;
    if (msg.type === 'hello') {
      for (const [videoId, tracks] of tracksByVideo) postToIsolated({ type: 'tracks', videoId, tracks });
      if (lastVideoId && tracksByVideo.has(lastVideoId)) {
        postToIsolated({ type: 'tracks', videoId: lastVideoId, tracks: tracksByVideo.get(lastVideoId)! });
      }
      if (Object.keys(meta).length) postToIsolated({ type: 'meta', entries: { ...meta } });
      return;
    }
    if (msg.type === 'call') {
      try {
        postToIsolated({ type: 'reply', id: msg.id, result: handleCall(msg.method, msg.args) });
      } catch (e) {
        postToIsolated({ type: 'reply', id: msg.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  });
}
