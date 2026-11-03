import type { TrackInfo, VideoMeta } from './types';

/**
 * Protocol between the MAIN-world script (which can touch Netflix's JS objects)
 * and the ISOLATED content script (which runs our UI). Both share `window`,
 * so messages travel over window.postMessage with a tag.
 */
export const BRIDGE_TAG = '__polyglot_player__';

export interface NativeTrackState {
  id?: string;
  lang?: string;
  label?: string;
  isNone?: boolean;
  /** Netflix plays its forced track (on-screen text and a few hard-to-hear lines) while its menu says Off. */
  forced?: boolean;
}

export type BridgeMethod = 'seek' | 'play' | 'pause' | 'getState' | 'showSubtitles';

export interface BridgeArgs {
  ms?: number;
  lang?: string;
}

/** Answer to showSubtitles: chosen in Netflix's menu now, already chosen there, or no such subtitles. */
export type ShowSubtitlesResult = 'switched' | 'active' | 'missing';

export interface PlayerState {
  timeMs: number | null;
  paused: boolean | null;
  track: NativeTrackState | null;
}

export type MainToIsolated =
  | { type: 'tracks'; videoId: string; tracks: TrackInfo[] }
  | { type: 'meta'; entries: Record<string, VideoMeta> }
  | { type: 'reply'; id: number; result?: unknown; error?: string };

export type IsolatedToMain =
  | { type: 'hello' }
  | { type: 'call'; id: number; method: BridgeMethod; args?: BridgeArgs };

type Tagged<T> = T & { [BRIDGE_TAG]: 'm2i' | 'i2m' };

export function postToIsolated(msg: MainToIsolated): void {
  window.postMessage({ ...msg, [BRIDGE_TAG]: 'm2i' } satisfies Tagged<MainToIsolated>, '*');
}

export function postToMain(msg: IsolatedToMain): void {
  window.postMessage({ ...msg, [BRIDGE_TAG]: 'i2m' } satisfies Tagged<IsolatedToMain>, '*');
}

export function readBridgeMessage<D extends 'm2i' | 'i2m'>(
  event: MessageEvent,
  direction: D,
): (D extends 'm2i' ? MainToIsolated : IsolatedToMain) | null {
  if (event.source !== window) return null;
  const data = event.data;
  if (!data || typeof data !== 'object' || data[BRIDGE_TAG] !== direction) return null;
  return data;
}
