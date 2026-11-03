import type { NativeTrackState, ShowSubtitlesResult } from '../core/bridge';
import type { Cue, TrackInfo, VideoMeta } from '../core/types';

/**
 * Everything site-specific the app needs. Netflix implements it today;
 * a YouTube adapter would implement the same surface.
 */
export interface SiteAdapter {
  readonly id: string;
  start(): void;
  currentVideoId(): string | null;
  /** Fires when the watched video changes (SPA navigation) or when its tracks/metadata arrive. */
  onUpdate(cb: () => void): () => void;
  getTracks(videoId: string): TrackInfo[];
  getMeta(videoId: string): VideoMeta | null;
  loadTrack(track: TrackInfo): Promise<Cue[]>;
  getVideo(): HTMLVideoElement | null;
  nowMs(): number | null;
  seek(ms: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  isPaused(): boolean;
  /** The subtitle track currently selected in the site's own menu. */
  getNativeTrack(): Promise<NativeTrackState | null>;
  /** Choose a subtitle language in the site's own menu (Netflix sends a track's link only once it's chosen). */
  showSubtitles?(lang: string): Promise<ShowSubtitlesResult>;
  /** Element our UI host must live in (changes with fullscreen). */
  getMountPoint(): HTMLElement;
  setLayout(opts: { hideNativeSubs: boolean; sidebarWidth: number | null }): void;
}
