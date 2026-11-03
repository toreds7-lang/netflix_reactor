import {
  postToMain,
  readBridgeMessage,
  type BridgeArgs,
  type BridgeMethod,
  type NativeTrackState,
  type PlayerState,
  type ShowSubtitlesResult,
} from '../../core/bridge';
import { send } from '../../core/messages';
import { parseSubtitles } from '../../core/subtitles';
import type { Cue, TrackInfo, VideoMeta } from '../../core/types';
import type { SiteAdapter } from '../adapter';
import { SELECTORS, WATCH_PATH } from './selectors';

const PAGE_STYLE_ID = 'polyglot-player-page-style';

const PAGE_CSS = `
html.plg-hide-native ${SELECTORS.nativeSubtitles} { display: none !important; }
html.plg-sidebar ${SELECTORS.playerView} {
  width: calc(100% - var(--plg-sidebar-w, 380px)) !important;
  right: auto !important;
}
`;

export class NetflixAdapter implements SiteAdapter {
  readonly id = 'netflix';
  private tracks = new Map<string, TrackInfo[]>();
  private meta = new Map<string, VideoMeta>();
  private cueCache = new Map<string, Promise<Cue[]>>();
  private listeners = new Set<() => void>();
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private lastPath = '';
  private started = false;
  /** Netflix content time minus <video>.currentTime (non-zero e.g. when ads shift the media timeline). */
  private offsetMs = 0;

  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener('message', this.onMessage);
    postToMain({ type: 'hello' });
    this.lastPath = location.pathname;
    // Netflix is a single-page app; poll the URL since history hooks live in another world.
    setInterval(() => {
      if (location.pathname !== this.lastPath) {
        this.lastPath = location.pathname;
        this.offsetMs = 0;
        this.emit();
      }
    }, 500);
    setInterval(() => void this.syncOffset(), 1000);
    this.ensurePageStyle();
  }

  /** Compare the player's content time with the video element's time and remember the difference. */
  private async syncOffset(): Promise<void> {
    const v = this.getVideo();
    if (!v || v.seeking || !WATCH_PATH.test(location.pathname)) return;
    const before = v.currentTime * 1000;
    let state: PlayerState;
    try {
      state = await this.call<PlayerState>('getState');
    } catch {
      return;
    }
    const after = v.currentTime * 1000;
    if (state.timeMs == null || state.timeMs < 0 || v.seeking || Math.abs(after - before) > 250) return;
    // Guard against an API change (e.g. seconds instead of ms) poisoning the offset.
    if (before > 20_000 && state.timeMs < before / 50) return;
    const offset = state.timeMs - (before + after) / 2;
    if (Math.abs(offset) > 20 * 60_000) return;
    // Ignore jitter; only real timeline shifts matter.
    if (Math.abs(offset - this.offsetMs) > 300) this.offsetMs = Math.abs(offset) < 300 ? 0 : offset;
  }

  private onMessage = (event: MessageEvent) => {
    const msg = readBridgeMessage(event, 'm2i');
    if (!msg) return;
    switch (msg.type) {
      case 'tracks':
        this.tracks.set(msg.videoId, msg.tracks);
        this.emit();
        break;
      case 'meta':
        for (const [id, m] of Object.entries(msg.entries)) this.meta.set(id, m);
        this.emit();
        break;
      case 'reply': {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
        break;
      }
    }
  };

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  private call<T>(method: BridgeMethod, args?: BridgeArgs): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      postToMain({ type: 'call', id, method, args });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`Netflix player did not answer (${method})`));
      }, 3000);
    });
  }

  currentVideoId(): string | null {
    return WATCH_PATH.exec(location.pathname)?.[1] ?? null;
  }

  onUpdate(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getTracks(videoId: string): TrackInfo[] {
    return this.tracks.get(videoId) ?? [];
  }

  getMeta(videoId: string): VideoMeta | null {
    const m = this.meta.get(videoId);
    if (m) return m;
    const domTitle = document.querySelector(SELECTORS.videoTitle)?.textContent?.trim();
    return domTitle ? { title: domTitle } : null;
  }

  loadTrack(track: TrackInfo): Promise<Cue[]> {
    // Netflix track IDs repeat across titles (they encode kind and language, e.g. "T:1:0;1;en;0;0;0;"), so the
    // cache is keyed by the download URL. Keyed by ID, the next title in the same tab got the previous one's subtitles.
    const key = track.sources[0]?.url ?? track.id;
    let p = this.cueCache.get(key);
    if (!p) {
      p = this.download(track);
      this.cueCache.set(key, p);
      p.catch(() => this.cueCache.delete(key));
    }
    return p;
  }

  private async download(track: TrackInfo): Promise<Cue[]> {
    let lastError: unknown = null;
    for (const source of track.sources) {
      try {
        const text = await send('fetchText', { url: source.url });
        const cues = parseSubtitles(text, source.profile);
        if (cues.length) return cues;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Could not load subtitles for ${track.label}`);
  }

  getVideo(): HTMLVideoElement | null {
    return document.querySelector<HTMLVideoElement>(SELECTORS.video);
  }

  nowMs(): number | null {
    const v = this.getVideo();
    return v && Number.isFinite(v.currentTime) ? v.currentTime * 1000 + this.offsetMs : null;
  }

  isPaused(): boolean {
    return this.getVideo()?.paused ?? true;
  }

  async seek(ms: number): Promise<void> {
    await this.call('seek', { ms });
  }

  async play(): Promise<void> {
    await this.call('play');
  }

  async pause(): Promise<void> {
    await this.call('pause');
  }

  async getNativeTrack(): Promise<NativeTrackState | null> {
    try {
      const state = await this.call<PlayerState>('getState');
      return state.track;
    } catch {
      return null;
    }
  }

  showSubtitles(lang: string): Promise<ShowSubtitlesResult> {
    return this.call<ShowSubtitlesResult>('showSubtitles', { lang });
  }

  getMountPoint(): HTMLElement {
    const fs = document.fullscreenElement as HTMLElement | null;
    if (fs && fs !== document.documentElement) return fs;
    return document.body ?? document.documentElement;
  }

  private ensurePageStyle(): void {
    if (document.getElementById(PAGE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = PAGE_STYLE_ID;
    style.textContent = PAGE_CSS;
    (document.head ?? document.documentElement).appendChild(style);
  }

  setLayout(opts: { hideNativeSubs: boolean; sidebarWidth: number | null }): void {
    this.ensurePageStyle();
    const html = document.documentElement;
    html.classList.toggle('plg-hide-native', opts.hideNativeSubs);
    html.classList.toggle('plg-sidebar', opts.sidebarWidth != null);
    if (opts.sidebarWidth != null) html.style.setProperty('--plg-sidebar-w', `${opts.sidebarWidth}px`);
  }
}
