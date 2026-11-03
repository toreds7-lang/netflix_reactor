/**
 * Every Netflix DOM selector lives here. When Netflix ships a redesign,
 * this is the first file to check.
 */
export const SELECTORS = {
  /** Root of the watch page player. */
  playerRoot: '.watch-video',
  /** The element that holds the video and Netflix's controls; narrowed when our sidebar is open. */
  playerView: '.watch-video--player-view',
  /** Netflix's own subtitle renderer. */
  nativeSubtitles: '.player-timedtext',
  video: '.watch-video video, video',
  /** Title shown in the player controls (fallback when metadata wasn't captured). */
  videoTitle: '[data-uia="video-title"]',
};

export const WATCH_PATH = /^\/watch\/(\d+)/;
