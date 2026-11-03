import { computed, signal } from '@preact/signals';
import type { BookmarkMap } from '../bookmarks/store';
import type { ChatMessage } from '../core/chat';
import { findMarkIndex, type ResumeChoice } from '../core/bookmarks';
import { buildUnits, cueUnitIndex, pickLevel } from '../core/keylines';
import type { FindRun, LibraryChunk, LibraryHit, LikeLine, MeaningStatus } from '../core/library';
import type { LoopStatus } from '../core/playback';
import { buildReadingScript } from '../core/readaloud';
import { dueSentences, episodeSentences, savedLineMap, type DrillStep } from '../core/sentences';
import { DEFAULT_SETTINGS, fitSidebarWidth, saveSettings, type KeyView, type Settings } from '../core/settings';
import { prepareCues } from '../core/subtitles';
import type { Cue, KeyLinesResult, PracticeSession, RubySegment, SummaryResult, TrackInfo, VideoMeta } from '../core/types';
import type { SentenceMap } from '../sentences/store';
import type { WordMap } from '../words/store';

export const settings = signal<Settings>(DEFAULT_SETTINGS);
export const words = signal<WordMap>({});

export const videoId = signal<string | null>(null);
export const meta = signal<VideoMeta | null>(null);
export const tracks = signal<TrackInfo[]>([]);
export const mainTrack = signal<TrackInfo | null>(null);
/** True when the user picked the main track in our sidebar instead of following Netflix's menu. */
export const mainTrackPinned = signal(false);

export const rawCues = signal<Cue[]>([]);
// Separate computed so unrelated settings writes don't rebuild the cue list (and restart translation).
const hideSdh = computed(() => settings.value.hideSoundDescriptions);
export const cues = computed(() => prepareCues(rawCues.value, hideSdh.value));
export const mainLang = computed(() => mainTrack.value?.lang ?? '');

export type TranslationMode = 'none' | 'human' | 'machine' | 'same-language';
export const translations = signal<(string | null)[]>([]);
export const translationMode = signal<TranslationMode>('none');
export const humanTrack = signal<TrackInfo | null>(null);
export const romanizations = signal<(string | null)[]>([]);
/** Generated ruby (pinyin) for Chinese; subtitle-provided ruby lives on the cue itself. */
export const generatedRuby = signal<(RubySegment[] | undefined)[]>([]);

/** Sentences sent for key-line analysis. Built from raw cues so the [SDH] toggle doesn't change them. */
export const keyUnits = computed(() => buildUnits(rawCues.value));
/** For each displayed cue, the index of its sentence in `keyUnits`, or -1. */
export const cueUnits = computed(() => cueUnitIndex(cues.value, keyUnits.value));

export interface KeyLinesState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Kept while a new result is made, and when that fails. */
  data?: KeyLinesResult;
  error?: string;
}
export const keyLines = signal<KeyLinesState>({ status: 'idle' });

const keyLevel = computed(() => settings.value.keyLevel);
/** Selected sentence indices at the current 10/20/30% level, or null before analysis. */
export const keySelection = computed(() => {
  const k = keyLines.value;
  if (!k.data) return null;
  return { shadow: pickLevel(k.data.shadow, keyLevel.value), story: pickLevel(k.data.story, keyLevel.value) };
});
/** Per displayed cue: 's' shadowing, 'u' story (understanding), 'su' both, or ''. */
export const cueKeys = computed<string[]>(() => {
  const sel = keySelection.value;
  if (!sel) return [];
  return cueUnits.value.map((u) => (u < 0 ? '' : (sel.shadow.has(u) ? 's' : '') + (sel.story.has(u) ? 'u' : '')));
});

export interface SummaryState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data?: SummaryResult;
  error?: string;
}
/** Scene-by-scene summary of the episode; its sentence indices refer to `keyUnits`. */
export const summary = signal<SummaryState>({ status: 'idle' });

/** The summary as it is read aloud: sentences in order, each with the block it highlights. */
export const readingScript = computed(() => {
  const data = summary.value.data;
  return data ? buildReadingScript(data, mainLang.value) : null;
});

export interface ReadingState {
  status: 'idle' | 'loading' | 'playing';
  /** Items [from, to] of `readingScript` being read. */
  from: number;
  to: number;
  /** The item being read, or -1 before the first one starts. */
  item: number;
  /** Share of the voice model downloaded (0-1) while it loads, or null. */
  progress?: number | null;
}
export const READING_IDLE: ReadingState = { status: 'idle', from: -1, to: -1, item: -1 };
export const reading = signal<ReadingState>(READING_IDLE);

/** Key flags limited to the list chosen in the sidebar (🎤, 📖 or both). */
export function visibleKeys(flags: string | undefined, view: KeyView): string {
  if (!flags) return '';
  if (view === 'shadow') return flags.includes('s') ? 's' : '';
  if (view === 'story') return flags.includes('u') ? 'u' : '';
  return flags;
}

/** The list chosen in the sidebar, as shown on the previous / next key line buttons. */
export function keyViewIcon(view: KeyView): string {
  return view === 'shadow' ? '🎤' : view === 'story' ? '📖' : '🎤📖';
}

const keyView = computed(() => settings.value.keyView);
/** Lines marked in the list chosen in the sidebar, in order: where J / L stop. */
export const keyMarkedLines = computed(() => {
  const view = keyView.value;
  return cueKeys.value.flatMap((k, i) => (visibleKeys(k, view) ? [i] : []));
});

export const bookmarks = signal<BookmarkMap>({});
/** This episode's bookmark and last line played. */
export const videoBookmarks = computed(() => (videoId.value ? bookmarks.value[videoId.value] : undefined));
/** Index of the bookmarked line in the displayed cues, or -1. */
export const bookmarkIndex = computed(() => {
  const mark = videoBookmarks.value?.bookmark;
  return mark ? findMarkIndex(cues.value, mark) : -1;
});
/** The Continue banner shown when an episode with a saved position opens. */
export const resumeOffer = signal<ResumeChoice | null>(null);

/** Lines being looped, the pass and whether it is the speaking gap; null when not looping. */
export const loop = signal<LoopStatus | null>(null);
/** First line of a loop being picked (loop key or 🔁 pressed once), waiting for the last line. */
export const loopStart = signal<number | null>(null);

/** ⭐ Saved sentences, from every episode. */
export const sentences = signal<SentenceMap>({});
/** The time, updated every minute, for what is due. */
export const clock = signal(Date.now());
/** Sentences due for practice, most overdue first. */
export const dueList = computed(() => dueSentences(sentences.value, clock.value));
/** This episode's sentences in the subtitle language shown, in video order. */
export const hereSentences = computed(() => episodeSentences(sentences.value, videoId.value, mainLang.value));
/** For each displayed line inside a saved sentence, that sentence's id. */
export const savedLines = computed(() => savedLineMap(cues.value, hereSentences.value));

/** A saved sentence being practised: its passes play as a loop, then it waits for a rating. */
export interface DrillState {
  id: string;
  steps: DrillStep[];
  phase: 'playing' | 'rate';
}
export const drill = signal<DrillState | null>(null);
/** Due sentences being practised one after another (mirrors storage, so it carries on in another episode). */
export const practice = signal<PracticeSession | null>(null);
/** Offered when an episode opens and sentences are due. */
export const warmupOffer = signal<{ due: number; here: number } | null>(null);

/**
 * The looped lines are blurred: in a practice drill on its listen and from-memory passes, otherwise with
 * "Hide text on repeats" from the second pass on.
 */
export const loopTextHidden = computed(() => {
  const l = loop.value;
  if (!l) return false;
  const d = drill.value;
  if (d?.phase === 'playing') return (d.steps[l.pass - 1] ?? 'text') !== 'text';
  return l.pass > 1 && settings.value.loopHideText;
});

/** The hold-reveal key is down: the blurred lines on the video and the floating window's big line show. */
export const revealHeld = signal(false);

/**
 * U: this line shows on the video and the big line although blurred (-1: none). Every other line stays blurred, so
 * the next one is blurred again, whether it plays on by itself or A / D / J / L goes there.
 */
export const revealedLine = signal(-1);

/** Playing time and episode length in ms, for the floating window's seek bar (updated only while it is open). */
export const playClock = signal({ now: 0, duration: 0 });

export const activeIndex = signal(-1);
export const currentIndex = signal(-1);
export const paused = signal(true);
export const hasVideo = signal(false);

export type Status =
  | { kind: 'idle' }
  | { kind: 'waiting' }
  | { kind: 'loading'; message: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };
export const status = signal<Status>({ kind: 'idle' });

/** Which window a word popup opens in: the Netflix page or the floating sidebar window. */
export type UiWindow = 'page' | 'float';

export interface PopupState {
  text: string;
  cueIndex: number;
  /** x, y and bottom are in this window's viewport. */
  where: UiWindow;
  x: number;
  y: number;
  /** Bottom edge of the anchor, used when the popup opens downward. */
  bottom: number;
}
export const popup = signal<PopupState | null>(null);

export interface Selection {
  cueIndex: number;
  /** overlay: subtitles on the video; sidebar: a line in the list; big: the current line in the floating window. */
  scope: 'overlay' | 'sidebar' | 'big';
  from: number;
  to: number;
}
export const selection = signal<Selection | null>(null);

/** The UI has said how to draw into the floating sidebar window, so it can open. */
export const floatAvailable = signal(false);
/** The floating sidebar window (a popup window filling the other monitor) while it is open. */
export const floatWin = signal<Window | null>(null);
export const floatOpen = computed(() => !!floatWin.value);
/**
 * The sidebar is shown on the Netflix page. Not while it floats, nor while a floating window is being taken back
 * or waits to be reopened after a reload, so Netflix keeps its full width.
 */
export const sidebarOnPage = computed(() => settings.value.sidebarOpen && !settings.value.floating && !floatOpen.value);
/** Width of the Netflix window, which caps the sidebar's (unknown until the UI is on the page). */
export const windowWidth = signal(Infinity);
/** The sidebar's width while you drag its edge, saved when you let go. */
export const sidebarDragWidth = signal<number | null>(null);
/** The sidebar's width on the page in px: the one being dragged, else the saved one, fitted to the window. */
export const sidebarWidthPx = computed(() => fitSidebarWidth(sidebarDragWidth.value ?? settings.value.sidebarWidth, windowWidth.value));

/** 🔎 Find: what was searched and what was found. */
export interface FindState {
  /** Words, a phrase, a pattern or a Korean line; '' when searching from a line. */
  query: string;
  /** The line "find lines like this" started from. */
  like: LikeLine | null;
  /** The line a chunk or pattern search came from, to go back to it. */
  back: LikeLine | null;
  /** Only this show ('' for all); not saved. */
  show: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  hits: LibraryHit[];
  total: number;
  forms: string[];
  chunks: LibraryChunk[];
  shows: string[];
  korean: boolean;
  /** Episodes and sentences saved in this language. */
  episodes: number;
  sentences: number;
  meaning: {
    status: 'idle' | 'loading' | 'ready' | 'error' | 'off';
    hits: LibraryHit[];
    info?: MeaningStatus;
    translated?: string;
    error?: string;
  };
  /** ✨ Pattern for the line searched from. */
  frames?: { status: 'loading' | 'ready' | 'error'; list: string[]; error?: string };
}
export const FIND_IDLE: FindState = {
  query: '',
  like: null,
  back: null,
  show: '',
  status: 'idle',
  hits: [],
  total: 0,
  forms: [],
  chunks: [],
  shows: [],
  korean: false,
  episodes: 0,
  sentences: 0,
  meaning: { status: 'idle', hits: [] },
};
export const findState = signal<FindState>(FIND_IDLE);
/** Found lines being played one after another (mirrors storage, so it carries on in another episode). */
export const findRun = signal<FindRun | null>(null);
/** A found line is playing (or the run waits a moment before the next one): the loop is the run's. */
export const findPlaying = signal(false);

export const helpOpen = signal(false);
export const toast = signal<string | null>(null);
export const sidebarTab = signal<'subs' | 'words' | 'loops' | 'sentences' | 'summary' | 'find' | 'chat'>('subs');

export interface ChatState {
  /** The episode the messages belong to. */
  videoId: string | null;
  messages: ChatMessage[];
  /** The answer being written, while it streams in. */
  streaming: string | null;
}
/** 💬 This episode's chat. */
export const chat = signal<ChatState>({ videoId: null, messages: [], streaming: null });
/** When the chat key last asked for the cursor in the chat box (ms). */
export const chatFocusAt = signal(0);

export interface ChatReading {
  status: 'idle' | 'loading' | 'playing';
  /** The answer being read. */
  id: string | null;
  /** The voice model's download (0-1) while it loads on first use, or null. */
  progress?: number | null;
}
export const CHAT_READING_IDLE: ChatReading = { status: 'idle', id: null };
/** 💬 An answer read aloud (🔊 on the answer). */
export const chatReading = signal<ChatReading>(CHAT_READING_IDLE);

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(message: string, ms = 2500): void {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), ms);
}

/** Optimistic settings update: the UI reacts at once, storage follows. */
export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
  void saveSettings(patch);
}
