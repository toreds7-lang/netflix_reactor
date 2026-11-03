import type { CefrLevel, KeyLevel } from './keylines';
import type { KokoroDevice, KokoroVoice } from './readaloud';
import { ALT_ACTIONS } from './shortcuts';

export type ShortcutAction =
  | 'prevLine'
  | 'repeatLine'
  | 'nextLine'
  | 'prevKeyLine'
  | 'repeatLine2'
  | 'nextKeyLine'
  | 'toggleAutoPause'
  | 'toggleBlur'
  | 'toggleBlurVideo'
  | 'holdReveal'
  | 'revealLine'
  | 'toggleSidebar'
  | 'toggleControls'
  | 'toggleSubtitles'
  | 'slower'
  | 'faster'
  | 'resetSpeed'
  | 'help'
  | 'toggleExtension'
  | 'bookmark'
  | 'loop'
  | 'extendLine'
  | 'startEarlier'
  | 'extendLine2'
  | 'startEarlier2'
  | 'toggleFloat'
  | 'swapColumns'
  | 'saveSentence'
  | 'findLine'
  | 'openChat';

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  prevLine: 'Previous subtitle',
  repeatLine: 'Repeat current subtitle',
  nextLine: 'Next subtitle',
  prevKeyLine: 'Previous 🎤/📖 key line (the list chosen in the Key lines bar)',
  repeatLine2: 'Repeat current subtitle (a second key, between the key-line keys)',
  nextKeyLine: 'Next 🎤/📖 key line',
  extendLine: 'Line cut off: play a bit more and remember it (with Shift: less)',
  startEarlier: 'Line starts too late: start it earlier, replay and remember it (with Shift: later)',
  extendLine2: 'Line cut off: play a bit more, as the extend key does (a second key; with Shift: less)',
  startEarlier2: 'Line starts too late: start it earlier, as the start key does (a second key; with Shift: later)',
  loop: 'Loop lines: press on the first and the last line, again to stop',
  bookmark: 'Bookmark current line',
  saveSentence: 'Save the sentence you are on to ⭐ Sentences, to practise it later',
  findLine: '🔎 Find lines like the one you are on in your shows: its chunks, and lines with the same meaning',
  openChat: '💬 Chat about this episode: open the chat and type a question',
  toggleAutoPause: 'Toggle auto-pause',
  toggleBlur: 'Toggle translation blur',
  toggleBlurVideo: "Blur every line on the video and the floating window's big line (the list stays readable)",
  holdReveal: 'Hold: show the blurred lines on the video and the big line while the key is down',
  revealLine: 'Show the blurred line you are on, on the video and the big line (again: blur it). The next line is blurred again',
  toggleSidebar: 'Toggle sidebar',
  toggleControls: 'Fold / unfold the sidebar menu',
  toggleFloat: 'Move the sidebar to its own window on your other monitor / put it back',
  swapColumns: 'Floating window: swap the big line and the list (left / right)',
  toggleSubtitles: 'Show / hide subtitles',
  slower: 'Slower',
  faster: 'Faster',
  resetSpeed: 'Normal speed',
  help: 'Show shortcuts',
  toggleExtension: 'Turn the whole extension on / off (with Alt)',
};

export type ClaudeModel = 'claude-opus-5-5' | 'claude-opus-5' | 'claude-sonnet-5' | 'claude-haiku-4-5';

export const CLAUDE_MODELS: { id: ClaudeModel; label: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality)' },
  { id: 'claude-opus-5', label: 'Claude Opus 5' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (balanced)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fastest, cheapest)' },
];

/** Who picks key lines: Claude Code on your Claude subscription (through the native helper), or OpenAI. */
export type KeyLinesProvider = 'claude-code' | 'openai';

export type ClaudeCodeModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-4-5';

export const CLAUDE_CODE_MODELS: { id: ClaudeCodeModel; label: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (uses less of your plan)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fastest)' },
];

export const CEFR_LEVELS: { id: CefrLevel; label: string }[] = [
  { id: 'A1', label: 'A1 · Beginner' },
  { id: 'A2', label: 'A2 · Elementary' },
  { id: 'B1', label: 'B1 · Intermediate' },
  { id: 'B2', label: 'B2 · Upper intermediate' },
  { id: 'C1', label: 'C1 · Advanced' },
  { id: 'C2', label: 'C2 · Proficient' },
];

export type TranslationSource = 'auto' | 'human' | 'machine';

/** 🔎 Find: which episodes to search, and how long the lines may be. */
export type FindScope = 'all' | 'here' | 'others';
export type FindLength = 'any' | 'short' | 'medium' | 'long';

/** Which key-line list the badges, overlay marker and "Key only" filter use. */
export type KeyView = 'both' | 'shadow' | 'story';

export interface Settings {
  enabled: boolean;
  /** Language translations are shown in (Google code). */
  nativeLang: string;
  /** Last subtitle language used as the main line; picked when Netflix's own subtitles are off. */
  learningLang: string;
  /** auto =Netflix human subtitles when available, otherwise machine translation. */
  translationSource: TranslationSource;
  subtitlesVisible: boolean;
  showTranslation: boolean;
  blurTranslation: boolean;
  /**
   * Blur every subtitle line on the video and the floating window's big line (main, romanization, translation) until
   * hovered. Hovering the translation shows the line above it too. The list stays clear.
   */
  blurVideo: boolean;
  showRomanization: boolean;
  showFurigana: boolean;
  hideSoundDescriptions: boolean;
  hideNativeSubs: boolean;
  autoPause: boolean;
  /** Auto-pause this many ms later for every line (subtitles that end before the speaker does). */
  pauseDelay: number;
  /** How far one press of the extend or start key moves a line's end or start, in ms. */
  extendStep: number;
  /** Going to a line (repeat, previous/next, click, loops) starts this many ms before its subtitle. */
  startEarly: number;
  pauseOnHover: boolean;
  /** A ↺ button right of the line on the video: click replays the line (like the repeat key), Shift+click loops it. */
  overlayRepeat: boolean;
  highlightSaved: boolean;
  sidebarOpen: boolean;
  /** The sidebar's width on the page, in px. Drag its left edge to set it; a narrow window may show it narrower. */
  sidebarWidth: number;
  /** Sidebar menu (subtitle track, translation, chips, key lines) folded to one bar, leaving room for the list. */
  controlsFolded: boolean;
  /**
   * The sidebar lives in its own window, filling another monitor, instead of on the page. The window outlives a
   * reload and the page takes it back.
   */
  floating: boolean;
  /** While the floating window is open, show the subtitles only there and not on the video. */
  floatHideVideoSubs: boolean;
  /** The floating window is fullscreen on its monitor; otherwise maximized. */
  floatFullscreen: boolean;
  /** Text size in the floating window (1 = normal). */
  floatTextScale: number;
  /** In two columns, the floating window has the panel (menu, tabs, list) on the left and the big line on the right. */
  floatPanelLeft: boolean;
  /** Width of the floating window's panel column as a share of the window (0.3 = 30%); 0 is automatic. */
  floatPanelShare: number;
  /** Subtitle font size in vh units. */
  fontSize: number;
  /** Distance of the subtitle block from the bottom, in % of the player height. */
  bottomOffset: number;
  playbackRate: number;
  claudeApiKey: string;
  claudeModel: ClaudeModel;
  keyLinesProvider: KeyLinesProvider;
  claudeCodeModel: ClaudeCodeModel;
  /** Your level in the language you're learning; the shadowing picks are pitched to it. */
  learnerLevel: CefrLevel;
  /** Key lines: 1/2/3 = 10/20/30% of the sentences in each list. */
  keyLevel: KeyLevel;
  keyView: KeyView;
  /** Show only key lines in the sidebar. */
  keyOnly: boolean;
  /** Auto-pause only after shadowing sentences. */
  shadowMode: boolean;
  /** Skip playback over everything except story sentences. */
  skipMode: boolean;
  /** Passes a loop plays before normal playback goes on; 0 loops until stopped. */
  loopCount: number;
  /** After each pass of a loop, pause as long as the pass took, so you can say it back. */
  loopGap: boolean;
  /** Blur the subtitles from the second pass of a loop on (hover to peek). */
  loopHideText: boolean;
  /** Practice drill for a saved sentence: passes listening with the text hidden. */
  drillListen: number;
  /** Passes shadowing with the text shown. */
  drillWithText: number;
  /** Passes shadowing with the text hidden. */
  drillBlind: number;
  /** Speed of the voice on the practice page (text-to-speech). */
  practiceRate: number;
  /** When an episode opens and saved sentences are due, offer to practise them first. */
  warmup: boolean;
  /** Write a backup file through the native helper whenever saved sentences or words change. */
  autoBackup: boolean;
  /** Folder for the backup files (a full path); empty is "Polyglot Player" in your Documents folder. */
  backupDir: string;
  /** 🔎 Save every episode you open to the library, so its lines can be found later. */
  librarySave: boolean;
  /** 🔎 Find only lines from the parts of episodes you already played (no spoilers, and you know the scene). */
  findWatchedOnly: boolean;
  findScope: FindScope;
  findLength: FindLength;
  /** 🔎 Find only 🎤 key lines (episodes with key lines found). */
  findKeyOnly: boolean;
  /** 🔎 Lines with the same meaning, from a small sentence model on your computer (English episodes). */
  findMeaning: boolean;
  /** 🔎 Shadow all: passes of each line, with a pause after each to say it back. */
  findShadowPasses: number;
  /** Kokoro voice that reads English summaries aloud (American English, female). */
  readAloudVoice: KokoroVoice;
  /** Read-aloud speed; 1 is Kokoro's natural pace. */
  readAloudRate: number;
  kokoroDevice: KokoroDevice;
  ankiUrl: string;
  ankiDeck: string;
  ankiModel: string;
  shortcuts: Record<ShortcutAction, string>;
}

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  prevLine: 'KeyA',
  repeatLine: 'KeyS',
  nextLine: 'KeyD',
  prevKeyLine: 'KeyJ',
  repeatLine2: 'KeyK',
  nextKeyLine: 'KeyL',
  toggleAutoPause: 'KeyQ',
  toggleBlur: 'KeyW',
  toggleBlurVideo: 'KeyH',
  holdReveal: 'KeyV',
  revealLine: 'KeyU',
  toggleSidebar: 'KeyE',
  toggleControls: 'KeyC',
  toggleSubtitles: 'KeyT',
  slower: 'BracketLeft',
  faster: 'BracketRight',
  resetSpeed: 'Backslash',
  help: 'Slash',
  toggleExtension: 'KeyL',
  bookmark: 'KeyB',
  loop: 'KeyR',
  extendLine: 'KeyX',
  startEarlier: 'KeyZ',
  extendLine2: 'KeyM',
  startEarlier2: 'KeyN',
  toggleFloat: 'KeyP',
  swapColumns: 'KeyO',
  saveSentence: 'KeyG',
  findLine: 'KeyI',
  openChat: 'KeyY',
};

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  nativeLang: 'ko',
  learningLang: 'en',
  translationSource: 'auto',
  subtitlesVisible: true,
  showTranslation: true,
  blurTranslation: false,
  blurVideo: false,
  showRomanization: true,
  showFurigana: true,
  hideSoundDescriptions: false,
  hideNativeSubs: true,
  autoPause: false,
  pauseDelay: 0,
  extendStep: 700,
  startEarly: 0,
  pauseOnHover: true,
  overlayRepeat: true,
  highlightSaved: true,
  sidebarOpen: true,
  sidebarWidth: 380,
  controlsFolded: true,
  floating: false,
  floatHideVideoSubs: false,
  floatFullscreen: true,
  floatTextScale: 1,
  floatPanelLeft: false,
  floatPanelShare: 0,
  fontSize: 3.6,
  bottomOffset: 9,
  playbackRate: 1,
  claudeApiKey: '',
  claudeModel: 'claude-opus-5-5',
  keyLinesProvider: 'claude-code',
  claudeCodeModel: 'claude-opus-5-5',
  learnerLevel: 'B1',
  keyLevel: 1,
  keyView: 'both',
  keyOnly: false,
  shadowMode: false,
  skipMode: false,
  loopCount: 0,
  loopGap: false,
  loopHideText: false,
  drillListen: 2,
  drillWithText: 2,
  drillBlind: 2,
  practiceRate: 1,
  warmup: true,
  autoBackup: true,
  backupDir: '',
  librarySave: true,
  findWatchedOnly: true,
  findScope: 'all',
  findLength: 'any',
  findKeyOnly: false,
  findMeaning: true,
  findShadowPasses: 2,
  readAloudVoice: 'af_heart',
  readAloudRate: 1,
  kokoroDevice: 'auto',
  ankiUrl: 'http://127.0.0.1:8765',
  ankiDeck: 'Polyglot Player',
  ankiModel: 'Basic',
  shortcuts: DEFAULT_SHORTCUTS,
};

/** Narrowest the sidebar on the page gets, and the least width it leaves the video when you widen it, in px. */
export const SIDEBAR_MIN_PX = 280;
export const MIN_VIDEO_PX = 480;

/** The sidebar's width in a window this wide: as asked, but at least the minimum and leaving the video its room. */
export function fitSidebarWidth(px: number, windowWidth: number): number {
  return Math.round(Math.max(SIDEBAR_MIN_PX, Math.min(px, windowWidth - MIN_VIDEO_PX)));
}

/** Loop pass counts offered in the sidebar; 0 is until stopped (∞). */
export const LOOP_COUNTS = [0, 2, 3, 5];

export const PLAYBACK_RATES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];

const KEY = 'settings';

export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  // Actions removed in an update are dropped, so they don't keep their keys from the actions that replace them.
  const saved: Partial<Record<ShortcutAction, string>> = Object.fromEntries(
    Object.entries(stored?.shortcuts ?? {}).filter(([a]) => a in DEFAULT_SHORTCUTS),
  );
  const shortcuts = { ...DEFAULT_SHORTCUTS, ...saved };
  // A shortcut added in an update starts unbound if its key already does something else for you.
  // (Alt actions use a different modifier, so their keys stay free: Alt+L doesn't take L.)
  const taken = new Set((Object.entries(saved) as [ShortcutAction, string][]).flatMap(([a, c]) => (ALT_ACTIONS.includes(a) ? [] : [c])));
  for (const a of Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]) {
    if (!(a in saved) && taken.has(DEFAULT_SHORTCUTS[a])) shortcuts[a] = '';
  }
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}), shortcuts };
}

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(KEY);
  return mergeSettings(got[KEY] as Partial<Settings> | undefined);
}

let writeChain: Promise<unknown> = Promise.resolve();

/** Apply a partial update. Writes are serialized so rapid toggles don't clobber each other. */
export function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = writeChain.then(async () => {
    const current = await loadSettings();
    const merged = mergeSettings({ ...current, ...patch });
    await chrome.storage.local.set({ [KEY]: merged });
    return merged;
  });
  writeChain = next.catch(() => undefined);
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[KEY]) cb(mergeSettings(changes[KEY].newValue as Partial<Settings>));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
