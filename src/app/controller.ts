import { batch, computed, effect, signal, untracked } from '@preact/signals';
import {
  deleteLoop,
  getAllBookmarks,
  onBookmarksChanged,
  onResumeRequested,
  saveLoop,
  setBookmark,
  setLastLine,
  takeResumeRequest,
} from '../bookmarks/store';
import { FINISHED_LINES, findLoopRange, findMarkIndex, findSavedLoop, resumeChoice } from '../core/bookmarks';
import type { NativeTrackState, ShowSubtitlesResult } from '../core/bridge';
import { pinyinLine, pinyinRuby } from '../core/chinese';
import { isChinese, languageName, needsRomanization, sameLanguage, toGoogleLang } from '../core/langs';
import { send } from '../core/messages';
import { PlaybackController, type LoopEnd } from '../core/playback';
import { answerLang, speechBlocks } from '../core/chat';
import { splitSentences, usesKokoro } from '../core/readaloud';
import {
  backLabel,
  drillStepInfo,
  drillSteps,
  GRADES,
  isFreshSession,
  newSrs,
  practiceOrder,
  schedule,
  sentenceId,
  sentenceRange,
  type Grade,
} from '../core/sentences';
import { loadSettings, onSettingsChanged, PLAYBACK_RATES, type ShortcutAction } from '../core/settings';
import { mergeRanges, stepAmong } from '../core/keylines';
import { describeKey, isTypingTarget, matchShortcut } from '../core/shortcuts';
import { alignTranslation, flatten, prepareCues, stripSoundDescriptions } from '../core/subtitles';
import { wordKey } from '../core/tokenize';
import type {
  Cue,
  DictEntry,
  ExplainResult,
  KeyLinesRequest,
  LineMark,
  PracticeSession,
  SavedLoop,
  SavedSentence,
  TrackInfo,
  WordLevel,
} from '../core/types';
import {
  getLineTimings,
  lineKey,
  msFor,
  setLineTiming,
  type LineEdge,
  type LineTimings,
} from '../lineends/store';
import {
  addSentence,
  deleteSentences,
  getAllSentences,
  getPractice,
  onPracticeChanged,
  onSentencesChanged,
  setPractice,
  updateSentence,
} from '../sentences/store';
import type { SiteAdapter } from '../sites/adapter';
import { formatTime, netflixLink } from '../words/export';
import { deleteWords, getAllWords, onWordsChanged, saveWord } from '../words/store';
import {
  activeIndex,
  bookmarkIndex,
  bookmarks,
  clock,
  cueKeys,
  cues,
  cueUnits,
  currentIndex,
  drill,
  dueList,
  findPlaying,
  floatAvailable,
  floatWin,
  generatedRuby,
  playClock,
  hasVideo,
  helpOpen,
  humanTrack,
  keyLines,
  keySelection,
  keyMarkedLines,
  keyUnits,
  keyViewIcon,
  loop,
  loopStart,
  loopTextHidden,
  mainLang,
  mainTrack,
  mainTrackPinned,
  meta,
  paused,
  popup,
  practice,
  rawCues,
  reading,
  READING_IDLE,
  readingScript,
  chat,
  chatReading,
  CHAT_READING_IDLE,
  resumeOffer,
  revealHeld,
  revealedLine,
  romanizations,
  savedLines,
  selection,
  sentences,
  settings,
  showToast,
  sidebarOnPage,
  sidebarWidthPx,
  status,
  summary,
  tracks,
  translationMode,
  translations,
  updateSettings,
  videoBookmarks,
  videoId,
  warmupOffer,
  words,
  type UiWindow,
} from './state';
import { ChatController } from './chat';
import { FindController } from './find';
import { openFloatWindow, showReloadNote, type FloatHandle, type FloatUi, type FloatWindowOptions } from './float';
import { readWithBrowserVoice, readWithKokoro, type Reader, type ReaderEvents } from './reader';

const MACHINE_GROUP = 40;
const ROMAN_WINDOW_BEFORE = 2;
const ROMAN_WINDOW_AFTER = 10;
const SUBS_NOT_FOUND_MS = 12_000;
/** How long to wait for subtitles turned on in Netflix's menu before suggesting a reload. */
const ASK_NETFLIX_MS = 8000;
/** The last line played is written to storage at most this often. */
const LAST_LINE_SAVE_MS = 5000;
/** The Continue banner closes by itself after this many lines played elsewhere. */
const RESUME_OFFER_LINES = 10;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const enabledSig = computed(() => settings.value.enabled);
const nativeLangSig = computed(() => settings.value.nativeLang);
const translationSourceSig = computed(() => settings.value.translationSource);
const showRomanSig = computed(() => settings.value.showRomanization);
const showRubySig = computed(() => settings.value.showFurigana);
const autoPauseSig = computed(() => settings.value.autoPause);
const shadowModeSig = computed(() => settings.value.shadowMode);
const skipModeSig = computed(() => settings.value.skipMode);
const rateSig = computed(() => settings.value.playbackRate);
/** Settings that decide which cached key-line result (and summary) applies. */
const keyConfigSig = computed(() => {
  const s = settings.value;
  return `${s.keyLinesProvider}|${s.claudeCodeModel}|${s.learnerLevel}`;
});
const layoutSig = computed(() => {
  const s = settings.value;
  const onWatch = !!videoId.value;
  return {
    hideNative: s.enabled && onWatch && s.hideNativeSubs && rawCues.value.length > 0,
    sidebar: s.enabled && onWatch && sidebarOnPage.value ? sidebarWidthPx.value : null,
  };
});
const floatWantedSig = computed(() => settings.value.floating);

/** Rating a practice drill: 1-4 on the number row or the keypad. */
const GRADE_KEYS: Record<string, Grade> = Object.fromEntries(
  GRADES.flatMap((g) => [
    [`Digit${g.key}`, g.id],
    [`Numpad${g.key}`, g.id],
  ]),
);

/** Keys that should keep firing while held. */
const REPEATABLE: ShortcutAction[] = ['prevLine', 'nextLine', 'prevKeyLine', 'nextKeyLine', 'slower', 'faster'];

/** Netflix's own keys, which don't reach the player while the floating window has the focus. */
const FLOAT_PLAYER_KEYS = ['Space', 'KeyF', 'ArrowLeft', 'ArrowRight'];
const ARROW_SEEK_MS = 10_000;
/** From this width on, the floating window shows two columns (the media query on `.fl-body` in theme.css). */
const FLOAT_COLUMNS_MIN_WIDTH = 900;
/**
 * Keys that don't reopen the floating window after a reload: F would leave the fullscreen it is asking for,
 * and modifiers alone are part of a browser shortcut.
 */
const NO_REOPEN_KEYS = new Set([
  'Escape',
  'KeyF',
  'Tab',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

export class AppController {
  readonly playback: PlaybackController;
  /** 🔎 Find in my shows: the library of watched episodes, its search and playing what is found. */
  readonly find: FindController;
  /** 💬 Chat about the episode. */
  readonly chat: ChatController;
  private mainGen = 0;
  private translationGen = 0;
  private romanGen = 0;
  private keyGen = 0;
  private summaryGen = 0;
  private romanInFlight = false;
  private picking = false;
  /** The learning language turned on in Netflix's menu, once per title: when, and Netflix's answer (null: not ready). */
  private askedNetflix: { videoId: string; at: number; answer: ShowSubtitlesResult | null } | null = null;
  private hoverPaused = false;
  private videoEl: HTMLVideoElement | null = null;
  private waitTimer: ReturnType<typeof setTimeout> | undefined;
  /** Video whose saved position was already looked at (once per visit). */
  private offeredFor: string | null = null;
  private offerLines = 0;
  private warmupLines = 0;
  /** Last line played, waiting to be written (null forgets the position). */
  private pendingLast: { videoId: string; mark: LineMark | null; title?: string } | null = null;
  private lastTimer: ReturnType<typeof setTimeout> | undefined;
  private reader: Reader | null = null;
  private readGen = 0;
  /** This episode's line endings saved with the extend key. */
  private readonly lineTimings = signal<LineTimings>({ ends: {}, starts: {} });
  private lineTimingsGen = 0;
  /** How the UI draws the sidebar into the floating window; set by mountUi. */
  private floatUi: FloatUi | null = null;
  private float: FloatHandle | null = null;
  /** Done looking for a floating window left open by the page before a reload. */
  private readonly floatChecked = signal(false);

  constructor(readonly adapter: SiteAdapter) {
    this.playback = new PlaybackController(
      {
        now: () => adapter.nowMs(),
        isPaused: () => adapter.isPaused(),
        seek: (ms) => void adapter.seek(ms).catch((e) => showToast(errMsg(e))),
        play: () => void adapter.play().catch(() => undefined),
        pause: () => void adapter.pause().catch(() => undefined),
      },
      (active, current) =>
        batch(() => {
          activeIndex.value = active;
          currentIndex.value = current;
        }),
      {
        onLoop: (status, why) => {
          const passes = loop.peek()?.pass ?? 0;
          loop.value = status;
          // A found line of a 🔎 run: the run goes on to the next one, or pauses.
          if (!status && this.find.loopEnded(why)) return;
          if (!status && drill.peek()?.phase === 'playing') this.drillEnded(why);
          else if (why === 'done') showToast(`🔁 Done · ${passes === 1 ? '1 pass' : `${passes} passes`}`);
          else if (why === 'seek') showToast('Loop off');
        },
      },
    );
    this.find = new FindController(this);
    this.chat = new ChatController(this);
  }

  async init(): Promise<void> {
    settings.value = await loadSettings();
    words.value = await getAllWords();
    bookmarks.value = await getAllBookmarks();
    sentences.value = await getAllSentences();
    practice.value = await getPractice();
    onSettingsChanged((s) => (settings.value = s));
    onWordsChanged((w) => (words.value = w));
    onBookmarksChanged((b) => (bookmarks.value = b));
    onSentencesChanged((all) => (sentences.value = all));
    onPracticeChanged((p) => this.practiceChanged(p));
    setInterval(() => (clock.value = Date.now()), 60_000);
    // Continue clicked in the toolbar popup while this video is already open.
    onResumeRequested((id) => {
      if (id === videoId.peek() && cues.peek().length) void this.resumeIfRequested(id);
    });
    window.addEventListener('pagehide', () => this.flushLastLine());
    document.addEventListener('visibilitychange', () => document.hidden && this.flushLastLine());

    this.adapter.onUpdate(() => void this.refresh());
    this.adapter.start();
    void this.refresh();
    this.installEffects();
    this.find.init();
    this.chat.init();
    requestAnimationFrame(this.loop);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    // The hold-reveal key's keyup goes elsewhere once the window loses the focus.
    window.addEventListener('blur', this.releaseReveal);
    setInterval(() => void this.followNativeTrack(), 2000);
  }

  // ---------------------------------------------------------------- video & tracks

  private async refresh(): Promise<void> {
    const watching = this.adapter.currentVideoId();
    // Switched off, the extension leaves the episode alone as if none were open: no subtitles, no translations.
    const id = settings.peek().enabled ? watching : null;
    if (id !== videoId.peek()) {
      this.mainGen++;
      clearTimeout(this.waitTimer);
      this.flushLastLine();
      // Switching off and on again during an episode doesn't offer to continue it again.
      if (watching !== this.offeredFor) this.offeredFor = null;
      batch(() => {
        videoId.value = id;
        // Track IDs repeat across titles, so the old list must not pass for the new title's below.
        tracks.value = [];
        mainTrack.value = null;
        mainTrackPinned.value = false;
        rawCues.value = [];
        humanTrack.value = null;
        popup.value = null;
        selection.value = null;
        resumeOffer.value = null;
        warmupOffer.value = null;
        drill.value = null;
        status.value = id ? { kind: 'waiting' } : { kind: 'idle' };
      });
      if (id) {
        this.waitTimer = setTimeout(() => {
          if (videoId.peek() === id && !tracks.peek().length) {
            status.value = {
              kind: 'error',
              message: 'No subtitles captured for this video. Reload the page (Ctrl+R) and try again.',
            };
          }
        }, SUBS_NOT_FOUND_MS);
      }
    }
    if (!id) {
      tracks.value = [];
      return;
    }
    meta.value = this.adapter.getMeta(id);
    const list = this.adapter.getTracks(id);
    // Netflix re-sends manifests; only publish a new list when the tracks actually differ.
    const prev = tracks.peek();
    const same = prev.length === list.length && prev.every((t, i) => t.id === list[i].id);
    if (!same) tracks.value = list;
    if (list.length && !mainTrack.peek()) await this.pickMainTrack();
  }

  private matchNative(native: NativeTrackState | null, list: TrackInfo[]): TrackInfo | null {
    // Netflix plays its forced track while its menu says Off: on-screen text and a few hard-to-hear lines, not the script.
    if (!native || native.isNone || native.forced || !native.lang) return null;
    const byId = native.id ? list.find((t) => t.id === native.id) : undefined;
    if (byId) return byId.kind === 'forced' ? null : byId;
    // Netflix hasn't sent the chosen track: another full one in that language will do, but never the forced one.
    const sameLang = list.filter((t) => t.lang === native.lang && t.kind !== 'forced');
    const byLabel = native.label ? sameLang.find((t) => t.label === native.label) : undefined;
    return byLabel ?? sameLang[0] ?? null;
  }

  private bestTrackFor(lang: string, list: TrackInfo[], exclude?: TrackInfo | null): TrackInfo | null {
    const candidates = list.filter((t) => sameLanguage(t.lang, lang) && t.id !== exclude?.id && t.kind !== 'forced');
    return candidates.find((t) => t.kind === 'subtitles') ?? candidates[0] ?? null;
  }

  private async pickMainTrack(): Promise<void> {
    if (this.picking) return;
    this.picking = true;
    const id = videoId.peek();
    try {
      const native = await this.adapter.getNativeTrack();
      // Unless another title was opened while Netflix answered: then its track list is the one to pick from.
      if (videoId.peek() === id) {
        const list = tracks.peek();
        const learning = settings.peek().learningLang;
        let track = this.matchNative(native, list) ?? (learning ? this.bestTrackFor(learning, list) : null);
        // No full track in the learning language yet: Netflix's menu says Off, or Netflix hasn't sent the chosen one.
        if (!track && !(learning && id && (await this.waitForNetflix(learning, id)))) {
          track = list.find((t) => t.kind === 'subtitles') ?? list.find((t) => t.kind !== 'forced') ?? list[0];
        }
        if (track && !mainTrack.peek() && videoId.peek() === id) await this.loadMain(track, false);
      }
    } finally {
      this.picking = false;
    }
    // The new title's own pick was skipped while this one ran.
    if (videoId.peek() !== id && tracks.peek().length && !mainTrack.peek()) await this.pickMainTrack();
  }

  /**
   * Netflix sends a track's download link with the title's first manifest, or once the track is chosen in its menu.
   * So turn the learning language on there (once per title, as Language Reactor does) and wait for it. True while
   * waiting, and also when Netflix has that language but never sent it: then a reload helps, and the forced track or
   * another language would be the wrong script. False when Netflix has no such subtitles.
   */
  private async waitForNetflix(lang: string, id: string): Promise<boolean> {
    if (!this.adapter.showSubtitles) return false;
    let asked = this.askedNetflix?.videoId === id ? this.askedNetflix : null;
    if (!asked?.answer) {
      const answer = await this.adapter.showSubtitles(lang).catch(() => null);
      asked = this.askedNetflix = { videoId: id, at: asked?.at ?? Date.now(), answer };
    }
    const waited = Date.now() - asked.at >= ASK_NETFLIX_MS;
    // The player may not be ready yet (followNativeTrack asks again), but don't wait forever if it never answers.
    if (!asked.answer) return !waited;
    if (asked.answer === 'missing') return false;
    if (videoId.peek() === id) {
      const name = languageName(lang);
      status.value = waited
        ? { kind: 'error', message: `Netflix didn't send the full ${name} subtitles. Reload the page (Ctrl+R).` }
        : asked.answer === 'switched'
          ? { kind: 'loading', message: `Turning on ${name} subtitles in Netflix…` }
          : { kind: 'loading', message: `Waiting for Netflix to send the ${name} subtitles…` };
    }
    return true;
  }

  /** Follow the subtitle language chosen in Netflix's own menu unless the user pinned one. */
  private async followNativeTrack(): Promise<void> {
    if (!videoId.peek() || mainTrackPinned.peek() || !tracks.peek().length || !settings.peek().enabled) return;
    // Still waiting for a track Netflix hadn't sent: its manifest may have come since.
    if (!mainTrack.peek()) return this.pickMainTrack();
    const native = await this.adapter.getNativeTrack();
    const match = this.matchNative(native, tracks.peek());
    if (match && match.id !== mainTrack.peek()?.id) await this.loadMain(match, false);
  }

  async loadMain(track: TrackInfo, pinned: boolean): Promise<void> {
    const gen = ++this.mainGen;
    batch(() => {
      mainTrack.value = track;
      mainTrackPinned.value = pinned;
      status.value = { kind: 'loading', message: `Loading ${track.label} subtitles…` };
    });
    try {
      const loaded = await this.adapter.loadTrack(track);
      if (gen !== this.mainGen) return;
      batch(() => {
        rawCues.value = loaded;
        status.value = { kind: 'ready' };
      });
      if (settings.peek().learningLang !== track.lang) updateSettings({ learningLang: track.lang });
    } catch (e) {
      if (gen === this.mainGen) status.value = { kind: 'error', message: errMsg(e) };
    }
  }

  selectMainTrack(id: string | 'auto'): void {
    if (id === 'auto') {
      mainTrackPinned.value = false;
      mainTrack.value = null;
      rawCues.value = [];
      void this.pickMainTrack();
      return;
    }
    const t = tracks.peek().find((x) => x.id === id);
    if (t) void this.loadMain(t, true);
  }

  // ---------------------------------------------------------------- effects

  private installEffects(): void {
    effect(() => {
      this.playback.setCues(cues.value);
      // Line indices change with the cue list: a loop being picked starts over, and the line shown with U blurs.
      loopStart.value = null;
      revealedLine.value = -1;
    });

    effect(() => {
      const s = settings.value;
      this.playback.loopConfig = { count: s.loopCount, gap: s.loopGap };
      this.playback.rate = s.playbackRate;
    });

    // Once per visit, when the subtitles are in: offer to continue from the bookmark or the last line played.
    effect(() => {
      const id = videoId.value;
      if (!id || !cues.value.length || this.offeredFor === id) return;
      this.offeredFor = id;
      void this.offerResume(id);
    });

    // Remember the last line played. Not while the Continue banner is up, so wherever Netflix happens to start
    // doesn't overwrite the saved position; the banner closes on reaching that line or after a few lines elsewhere.
    effect(() => {
      const active = activeIndex.value;
      if (active < 0) return;
      // The warm-up offer goes away once you watch on.
      if (warmupOffer.peek() && ++this.warmupLines >= RESUME_OFFER_LINES) warmupOffer.value = null;
      const offer = resumeOffer.peek();
      if (!offer) {
        this.noteLastLine(active);
        return;
      }
      const list = cues.peek();
      const there = [offer.primary, offer.alsoLast].some((m) => m && findMarkIndex(list, m) === active);
      if (there || ++this.offerLines >= RESUME_OFFER_LINES) resumeOffer.value = null;
    });

    // Line ends and starts saved with the extend and start keys for this episode, and the settings for every line.
    effect(() => {
      const id = videoId.value;
      const gen = ++this.lineTimingsGen;
      this.lineTimings.value = { ends: {}, starts: {} };
      if (!id) return;
      getLineTimings(id)
        .then((timings) => {
          if (gen === this.lineTimingsGen) this.lineTimings.value = timings;
        })
        .catch(() => undefined);
    });
    effect(() => {
      const s = settings.value;
      const list = cues.value;
      const lang = mainLang.value;
      const { ends, starts } = this.lineTimings.value;
      this.playback.pauseDelay = s.pauseDelay;
      this.playback.startEarly = s.startEarly;
      this.playback.tails = msFor(list, lang, ends);
      this.playback.heads = msFor(list, lang, starts);
    });

    // Shadow mode: pause only at the end of each 🎤 sentence (its last cue).
    effect(() => {
      const keys = cueKeys.value;
      const units = cueUnits.value;
      const shadow = shadowModeSig.value && keys.length > 0;
      this.playback.autoPause = autoPauseSig.value || shadow;
      this.playback.pauseOnly = shadow
        ? new Set(keys.flatMap((k, i) => (k.includes('s') && units[i + 1] !== units[i] ? [i] : [])))
        : null;
    });

    // Skip mode: play only 📖 story sentences.
    effect(() => {
      const sel = skipModeSig.value ? keySelection.value : null;
      const units = keyUnits.value;
      this.playback.setSkipRanges(sel ? mergeRanges([...sel.story].map((i) => units[i]).filter(Boolean)) : null);
    });

    // Show an earlier analysis of this episode from the cache (free), one made with other settings if need be.
    // The API is only called from the button.
    effect(() => {
      keyUnits.value;
      mainLang.value;
      videoId.value;
      keyConfigSig.value; // look again when the provider, model or level changes
      const gen = ++this.keyGen;
      keyLines.value = { status: 'idle' };
      const req = this.analysisRequest({ cacheOnly: true });
      if (!req) return;
      send('findKeyLines', req)
        .then((data) => {
          if (data && gen === this.keyGen) keyLines.value = { status: 'ready', data };
        })
        .catch(() => undefined);
    });

    // Same for the episode summary: show a cached one for free, generate only from the button.
    effect(() => {
      keyUnits.value;
      mainLang.value;
      videoId.value;
      keyConfigSig.value; // look again when the provider, model or level changes
      const gen = ++this.summaryGen;
      summary.value = { status: 'idle' };
      const req = this.analysisRequest({ cacheOnly: true });
      if (!req) return;
      send('summarize', req)
        .then((data) => {
          if (data && gen === this.summaryGen) summary.value = { status: 'ready', data };
        })
        .catch(() => undefined);
    });

    // Reading aloud and the video don't talk over each other: playing the video stops the reader.
    effect(() => {
      if (!paused.value) {
        untracked(() => (reading.peek().status !== 'idle' || chatReading.peek().status !== 'idle') && this.stopReading());
      }
    });
    // A different summary (episode, level or model) stops reading the old one; an answer being read goes on.
    effect(() => {
      readingScript.value;
      untracked(() => chatReading.peek().status === 'idle' && this.stopReading());
    });

    effect(() => {
      const c = cues.value;
      const native = nativeLangSig.value;
      const source = translationSourceSig.value;
      const main = mainTrack.value;
      const list = tracks.value;
      void this.runTranslations(c, native, source, main, list);
    });

    effect(() => {
      const c = cues.value;
      const lang = mainLang.value;
      const wantRoman = showRomanSig.value;
      const wantRuby = showRubySig.value;
      this.romanGen++;
      romanizations.value = new Array(c.length).fill(null);
      generatedRuby.value = [];
      if (!c.length || !lang) return;
      if (isChinese(lang) && (wantRoman || wantRuby)) void this.computePinyin(c, this.romanGen);
    });

    // Google romanization is fetched lazily around the current line.
    effect(() => {
      const cur = currentIndex.value;
      const lang = mainLang.value;
      void romanizations.value; // re-check the window when results land or the list resets
      if (!showRomanSig.value || !lang || isChinese(lang) || !needsRomanization(lang)) return;
      void this.fetchRomanWindow(cur, lang);
    });

    effect(() => {
      const { hideNative, sidebar } = layoutSig.value;
      this.adapter.setLayout({ hideNativeSubs: hideNative, sidebarWidth: sidebar });
    });

    // Floating switched off elsewhere (another tab, a dock): close the window here too.
    effect(() => {
      if (!floatWantedSig.value) untracked(() => floatWin.peek()?.close());
    });
    // Floating, but the window was closed during a reload: it waits for a click or key press (the popup blocker).
    // Say so once per episode.
    effect(() => {
      if (this.floatChecked.value && videoId.value && floatWantedSig.value && !floatWin.peek()) {
        untracked(() => showToast('Click the page or press a key to bring back the floating sidebar', 5000));
      }
    });

    effect(() => {
      // Switched off, Netflix plays at its normal speed.
      const rate = enabledSig.value ? rateSig.value : 1;
      const v = this.videoEl;
      if (v && Math.abs(v.playbackRate - rate) > 0.001) v.playbackRate = rate;
    });

    // The master switch: off unloads the episode (refresh) and closes everything; on loads it again, no reload needed.
    let wasEnabled = enabledSig.peek();
    effect(() => {
      const on = enabledSig.value;
      if (on === wasEnabled) return;
      wasEnabled = on;
      untracked(() => {
        if (!on) {
          this.stopLoop();
          this.stopReading();
          this.closePopup();
          helpOpen.value = false;
          // Floating stays on, so turning the extension on again brings the window back with a click.
          floatWin.peek()?.close();
        }
        void this.refresh();
      });
    });
  }

  private findHumanTrack(list: TrackInfo[], native: string, main: TrackInfo): TrackInfo | null {
    return this.bestTrackFor(native, list, main);
  }

  private async runTranslations(
    c: Cue[],
    native: string,
    source: string,
    main: TrackInfo | null,
    list: TrackInfo[],
  ): Promise<void> {
    const gen = ++this.translationGen;
    batch(() => {
      translations.value = new Array(c.length).fill(null);
      humanTrack.value = null;
    });
    if (!main || !c.length) {
      translationMode.value = 'none';
      return;
    }
    if (sameLanguage(main.lang, native)) {
      translationMode.value = 'same-language';
      return;
    }
    const human = source !== 'machine' ? this.findHumanTrack(list, native, main) : null;
    if (human) {
      try {
        const other = prepareCues(await this.adapter.loadTrack(human), settings.peek().hideSoundDescriptions);
        if (gen !== this.translationGen) return;
        batch(() => {
          translations.value = alignTranslation(c, other);
          translationMode.value = 'human';
          humanTrack.value = human;
        });
        return;
      } catch {
        /* fall back to machine translation */
      }
    }
    if (source === 'human') {
      translationMode.value = 'none';
      return;
    }
    translationMode.value = 'machine';
    await this.machineTranslate(c, main.lang, native, gen);
  }

  private async machineTranslate(c: Cue[], lang: string, native: string, gen: number): Promise<void> {
    const from = toGoogleLang(lang);
    const lines = c.map((x) => flatten(x.text));
    const groups: number[][] = [];
    for (let i = 0; i < lines.length; i += MACHINE_GROUP) {
      groups.push(Array.from({ length: Math.min(MACHINE_GROUP, lines.length - i) }, (_, k) => i + k));
    }
    const done = new Set<number>();
    let failures = 0;
    while (done.size < groups.length) {
      if (gen !== this.translationGen) return;
      // Always translate the untranslated group nearest to where the viewer is.
      const cur = Math.max(0, currentIndex.peek());
      let best = -1;
      let bestDist = Infinity;
      groups.forEach((g, gi) => {
        if (done.has(gi)) return;
        const first = g[0];
        const last = g[g.length - 1];
        const d = cur < first ? first - cur : cur > last ? cur - last : 0;
        if (d < bestDist) {
          bestDist = d;
          best = gi;
        }
      });
      const idx = groups[best];
      try {
        const { translations: out } = await send('translateLines', { lines: idx.map((i) => lines[i]), from, to: native });
        if (gen !== this.translationGen) return;
        const next = translations.peek().slice();
        idx.forEach((i, k) => (next[i] = out[k]));
        translations.value = next;
        done.add(best);
      } catch (e) {
        if (gen !== this.translationGen) return;
        if (++failures >= 3) {
          showToast(`Machine translation stopped: ${errMsg(e)}`, 5000);
          return;
        }
        await sleep(2500 * failures);
      }
    }
  }

  private async computePinyin(c: Cue[], gen: number): Promise<void> {
    const roman: (string | null)[] = new Array(c.length).fill(null);
    const ruby: ReturnType<typeof pinyinRuby>[] = new Array(c.length);
    for (let i = 0; i < c.length; i += 150) {
      if (gen !== this.romanGen) return;
      for (let k = i; k < Math.min(c.length, i + 150); k++) {
        roman[k] = pinyinLine(c[k].text);
        ruby[k] = pinyinRuby(c[k].text);
      }
      await sleep(0);
    }
    if (gen !== this.romanGen) return;
    batch(() => {
      romanizations.value = roman;
      generatedRuby.value = ruby;
    });
  }

  private async fetchRomanWindow(cur: number, lang: string): Promise<void> {
    if (this.romanInFlight) return;
    const c = cues.peek();
    const have = romanizations.peek();
    const from = Math.max(0, cur - ROMAN_WINDOW_BEFORE);
    const to = Math.min(c.length - 1, Math.max(cur, 0) + ROMAN_WINDOW_AFTER);
    const need: number[] = [];
    for (let i = from; i <= to; i++) if (have[i] == null) need.push(i);
    if (!need.length) return;
    const gen = this.romanGen;
    this.romanInFlight = true;
    let out: (string | null)[];
    try {
      ({ romanizations: out } = await send('romanizeLines', {
        lines: need.map((i) => flatten(c[i].text)),
        from: toGoogleLang(lang),
      }));
    } catch {
      this.romanInFlight = false; // romanization is optional
      return;
    }
    // Clear the flag before writing: the write re-runs the window effect synchronously.
    this.romanInFlight = false;
    if (gen !== this.romanGen) return;
    const next = romanizations.peek().slice();
    need.forEach((i, k) => (next[i] = out[k] ?? ''));
    romanizations.value = next;
  }

  // ---------------------------------------------------------------- frame loop

  private loop = (): void => {
    if (!this.videoEl?.isConnected) {
      const v = this.adapter.getVideo();
      if (v !== this.videoEl) {
        this.videoEl = v;
        hasVideo.value = !!v;
        if (v && enabledSig.peek() && Math.abs(v.playbackRate - rateSig.peek()) > 0.001) v.playbackRate = rateSig.peek();
      }
    }
    const v = this.videoEl;
    if (v && v.paused !== paused.peek()) paused.value = v.paused;
    if (floatWin.peek()) this.tickClock(v);
    // A loop's speaking gap waits while you look a word up.
    this.playback.holdGap = !!popup.peek() || helpOpen.peek();
    if (settings.peek().enabled && videoId.peek()) this.playback.tick();
    requestAnimationFrame(this.loop);
  };

  // ---------------------------------------------------------------- keyboard

  private onKeyDown = (e: KeyboardEvent): void => {
    const s = settings.peek();
    // The master switch works while the extension is off, so it is checked before the enabled guard.
    if (!isTypingTarget(e) && matchShortcut(e, s.shortcuts) === 'toggleExtension') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) this.runAction('toggleExtension');
      return;
    }
    if (!s.enabled || !videoId.peek() || isTypingTarget(e)) return;
    const action = matchShortcut(e, s.shortcuts);
    // After a reload, the first key press on the page reopens the floating window (the float key toggles it below).
    if (
      action !== 'toggleFloat' &&
      !NO_REOPEN_KEYS.has(e.code) &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      this.wantsReopen()
    ) {
      this.openFloat();
    }
    if (e.code === 'Escape' && (popup.peek() || helpOpen.peek())) {
      this.closePopup();
      helpOpen.value = false;
      e.stopImmediatePropagation();
      return;
    }
    if (e.code === 'Escape' && (loop.peek() || loopStart.peek() != null || findPlaying.peek())) {
      this.stopLoop();
      e.stopImmediatePropagation();
      return;
    }
    // After a practice drill: 1-4 rate it, Esc leaves it unrated.
    if (drill.peek()?.phase === 'rate' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const grade = e.code === 'Escape' ? null : GRADE_KEYS[e.code];
      if (e.code === 'Escape' || (grade && !action)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.repeat) return;
        if (grade) this.grade(grade);
        else this.endDrill();
        return;
      }
    }
    if (!action) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // Held, not pressed: the lines show until the key goes up.
    if (action === 'holdReveal') {
      revealHeld.value = true;
      return;
    }
    if (e.repeat && !REPEATABLE.includes(action)) return;
    this.runAction(action, e.shiftKey);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const s = settings.peek();
    // Whatever else is held or focused by now, letting go of the key hides the lines again.
    if (e.code === s.shortcuts.holdReveal) this.releaseReveal();
    if (isTypingTarget(e)) return;
    if (matchShortcut(e, s.shortcuts) === 'toggleExtension' || (s.enabled && videoId.peek() && matchShortcut(e, s.shortcuts))) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  /**
   * Keys in the floating window: the same shortcuts, plus Netflix's Space, F and ←/→, which can't reach the player
   * from there.
   */
  private onFloatKeyDown = (e: KeyboardEvent): void => {
    this.onKeyDown(e);
    const s = settings.peek();
    if (e.defaultPrevented || !s.enabled || !videoId.peek() || isTypingTarget(e)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || !FLOAT_PLAYER_KEYS.includes(e.code)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') this.seekBy(e.code === 'ArrowLeft' ? -ARROW_SEEK_MS : ARROW_SEEK_MS);
    else if (e.repeat) return;
    else if (e.code === 'Space') this.togglePlay();
    else this.toggleFullscreen();
  };

  private onFloatKeyUp = (e: KeyboardEvent): void => {
    this.onKeyUp(e);
    // Space on a focused button would also click it.
    if (FLOAT_PLAYER_KEYS.includes(e.code) && !isTypingTarget(e)) e.preventDefault();
  };

  private releaseReveal = (): void => {
    revealHeld.value = false;
  };

  runAction(action: ShortcutAction, shift = false): void {
    const s = settings.peek();
    switch (action) {
      case 'prevLine':
        this.closePopup();
        revealedLine.value = -1;
        this.playback.prev();
        break;
      case 'repeatLine':
      case 'repeatLine2':
        this.closePopup();
        if (!this.repeatShadowSentence()) this.playback.repeat();
        break;
      case 'nextLine':
        this.closePopup();
        revealedLine.value = -1;
        this.playback.next();
        break;
      case 'prevKeyLine':
      case 'nextKeyLine':
        this.stepKeyLine(action === 'nextKeyLine' ? 1 : -1);
        break;
      case 'extendLine':
      case 'extendLine2':
        this.closePopup();
        this.adjustLine('ends', shift);
        break;
      case 'startEarlier':
      case 'startEarlier2':
        this.closePopup();
        this.adjustLine('starts', shift);
        break;
      case 'bookmark':
        this.toggleBookmark(this.playback.currentIndex);
        break;
      case 'saveSentence':
        this.saveSentenceAt(this.playback.currentIndex);
        break;
      case 'findLine':
        void this.find.findLike(this.playback.currentIndex);
        break;
      case 'openChat':
        this.closePopup();
        this.chat.open();
        break;
      case 'loop':
        this.closePopup();
        if (loop.peek()) this.stopLoop();
        else this.pickLoopLine(this.playback.currentIndex, true);
        break;
      case 'toggleAutoPause':
        updateSettings({ autoPause: !s.autoPause });
        showToast(`Auto-pause ${!s.autoPause ? 'on' : 'off'}`);
        break;
      case 'toggleBlur':
        updateSettings({ blurTranslation: !s.blurTranslation, showTranslation: true });
        showToast(`Translation blur ${!s.blurTranslation ? 'on' : 'off'}`);
        break;
      case 'toggleBlurVideo':
        revealedLine.value = -1;
        updateSettings({ blurVideo: !s.blurVideo });
        showToast(`Video blur ${!s.blurVideo ? 'on' : 'off'}`);
        break;
      case 'revealLine':
        this.toggleRevealLine();
        break;
      case 'toggleSidebar':
        // While floating, bring the sidebar back to the page.
        if (s.floating || floatWin.peek()) this.dock();
        else updateSettings({ sidebarOpen: !s.sidebarOpen });
        break;
      case 'toggleControls':
        // With the sidebar hidden, show it with the menu open.
        updateSettings(
          s.sidebarOpen || floatWin.peek() ? { controlsFolded: !s.controlsFolded } : { sidebarOpen: true, controlsFolded: false },
        );
        break;
      case 'toggleFloat':
        this.toggleFloat();
        break;
      case 'swapColumns':
        updateSettings({ floatPanelLeft: !s.floatPanelLeft });
        // The window shows the swap at once; while it is closed or in one column, say what changed.
        if ((floatWin.peek()?.innerWidth ?? 0) < FLOAT_COLUMNS_MIN_WIDTH) {
          showToast(`Floating window: list on the ${s.floatPanelLeft ? 'right' : 'left'}`);
        }
        break;
      case 'toggleSubtitles':
        updateSettings({ subtitlesVisible: !s.subtitlesVisible });
        showToast(`Subtitles ${!s.subtitlesVisible ? 'shown' : 'hidden'}`);
        break;
      case 'slower':
      case 'faster':
        this.stepRate(action === 'faster' ? 1 : -1);
        break;
      case 'resetSpeed':
        this.setRate(1);
        break;
      case 'help':
        helpOpen.value = !helpOpen.peek();
        break;
      case 'toggleExtension':
        this.closePopup();
        helpOpen.value = false;
        updateSettings({ enabled: !s.enabled });
        showToast(`Extension ${!s.enabled ? 'on' : 'off'}`);
        break;
    }
  }

  /**
   * The ↺ right of the line on the video: replay line `index` as the repeat key does. With Shift, loop it until
   * stopped (Shift+click it again, or Esc).
   */
  repeatShown(index: number, loopIt: boolean): void {
    if (!cues.peek()[index]) return;
    // The click starts playback, so leaving the subtitles mustn't start it again after the line has auto-paused.
    this.hoverPaused = false;
    if (loopIt) {
      const l = loop.peek();
      if (l && l.from === index && l.to === index) this.stopLoop();
      else this.startLoop(index, index, true);
      return;
    }
    this.closePopup();
    if (!this.repeatShadowSentence(index)) this.playback.goTo(index);
  }

  /**
   * J / L and the ‹ › buttons: go to the previous or next line marked in the list chosen in the sidebar
   * (🎤, 📖 or both). Each line of a key sentence is a stop, as each has its own mark in the list.
   */
  stepKeyLine(dir: 1 | -1): void {
    this.closePopup();
    revealedLine.value = -1;
    // A button on the video starts playback, so leaving the subtitles mustn't start it again after an auto-pause.
    this.hoverPaused = false;
    if (!keySelection.peek()) {
      showToast('No key lines yet: ✨ Find key lines in the sidebar menu');
      return;
    }
    const i = stepAmong(keyMarkedLines.peek(), this.playback.anchorIndex, dir);
    if (i >= 0) this.playback.goTo(i);
    else {
      const view = settings.peek().keyView;
      showToast(`No ${dir > 0 ? 'next' : 'previous'} ${view === 'both' ? 'key' : keyViewIcon(view)} line`);
    }
  }

  /**
   * U: show the line on the video and the big line (the one playing, or the last one between lines) although
   * blurred; again blurs it. Only that line: the next one is blurred again.
   */
  private toggleRevealLine(): void {
    const s = settings.peek();
    if (!s.blurVideo && !s.blurTranslation && !loopTextHidden.peek()) {
      showToast(`Nothing is blurred · ${describeKey(s.shortcuts.toggleBlurVideo)} blurs the video`);
      return;
    }
    const act = activeIndex.peek();
    const i = act >= 0 ? act : currentIndex.peek();
    if (i < 0) return;
    revealedLine.value = revealedLine.peek() === i ? -1 : i;
  }

  /** In shadow mode, replay the whole 🎤 sentence the line (by default the current one) belongs to. */
  private repeatShadowSentence(cur = this.playback.currentIndex): boolean {
    const keys = cueKeys.peek();
    if (!settings.peek().shadowMode || cur < 0 || !keys[cur]?.includes('s')) return false;
    const units = cueUnits.peek();
    let first = cur;
    while (first > 0 && units[first - 1] === units[cur]) first--;
    this.playback.goTo(first);
    return true;
  }

  /**
   * X: a line cut off before its last words, so play a bit more of it (with Shift, less). Z: a line whose first words
   * are missing, so start it earlier (with Shift, later). Either way the change is saved for that line.
   */
  private adjustLine(edge: LineEdge, less: boolean): void {
    const s = settings.peek();
    const step = s.extendStep;
    const pb = this.playback;
    const i = edge === 'starts' ? pb.moveStart(less ? -step : step) : less ? pb.shorten(step) : pb.extend(step);
    if (i < 0) {
      showToast(`Replaying the line. If it stops too early, press ${describeKey(s.shortcuts.extendLine)}`);
      return;
    }
    const id = videoId.peek();
    const cue = cues.peek()[i];
    const lang = mainLang.peek();
    if (!id || !cue || !lang) return;
    const ms = (edge === 'starts' ? this.playback.heads[i] : this.playback.tails[i]) ?? 0;
    const key = lineKey(lang, cue);
    const prev = this.lineTimings.peek();
    const saved = { ...prev[edge] };
    if (ms > 0) saved[key] = ms;
    else delete saved[key];
    this.lineTimings.value = { ...prev, [edge]: saved };
    setLineTiming(id, edge, key, ms).catch((e) => showToast(errMsg(e)));
    const secs = (ms / 1000).toFixed(1);
    if (edge === 'starts') showToast(ms > 0 ? `Line starts ${secs} s early, saved` : 'Line start back to the subtitle timing');
    else showToast(ms > 0 ? `Line ending +${secs} s, saved` : 'Line ending back to the subtitle timing');
  }

  // ---------------------------------------------------------------- bookmarks

  titleOf(): string | undefined {
    const m = meta.peek();
    return m ? [m.title, m.episodeTitle].filter(Boolean).join(' · ') : undefined;
  }

  private markFor(cue: Cue): LineMark {
    return { timeMs: cue.start, text: flatten(cue.text), lang: mainLang.peek() };
  }

  /** Bookmark this line (one per episode), or remove the bookmark when it is already here. */
  toggleBookmark(index: number): void {
    const id = videoId.peek();
    const cue = cues.peek()[index];
    if (!id || !cue) {
      showToast('No subtitle line to bookmark yet');
      return;
    }
    resumeOffer.value = null;
    const removing = bookmarkIndex.peek() === index;
    setBookmark(id, removing ? null : this.markFor(cue), this.titleOf()).catch((e) => showToast(errMsg(e)));
    showToast(removing ? 'Bookmark removed' : `🔖 Bookmarked ${formatTime(cue.start)}`);
  }

  goToBookmark(): void {
    const mark = videoBookmarks.peek()?.bookmark;
    if (mark) this.continueFrom(mark);
  }

  continueFrom(mark: LineMark): void {
    resumeOffer.value = null;
    const i = findMarkIndex(cues.peek(), mark);
    if (i >= 0) this.playback.goTo(i);
    else
      void this.adapter
        .seek(mark.timeMs)
        .then(() => this.adapter.play())
        .catch((e) => showToast(errMsg(e)));
  }

  /**
   * Jump straight there when Continue was clicked in the toolbar popup, or practise the sentence a practice session
   * opened this episode for. Otherwise show the Continue banner, and offer to warm up with the sentences due.
   */
  private async offerResume(id: string): Promise<void> {
    if (await this.resumeIfRequested(id)) return;
    if (await this.practiceHere(id)) return;
    if (await this.find.continueHere(id)) return;
    if (videoId.peek() !== id) return;
    const choice = resumeChoice(bookmarks.peek()[id]);
    if (choice) {
      this.pendingLast = null; // what played before the banner shouldn't replace the saved position
      this.offerLines = 0;
      resumeOffer.value = choice;
    }
    this.offerWarmup(id);
  }

  private async resumeIfRequested(id: string): Promise<boolean> {
    if (!(await takeResumeRequest(id).catch(() => false))) return false;
    const choice = resumeChoice(bookmarks.peek()[id]);
    if (!choice) return true;
    await this.whenPlayerReady();
    if (videoId.peek() === id) this.continueFrom(choice.primary);
    return true;
  }

  /** On a fresh page load, Netflix's player API is only there once the video has data. */
  async whenPlayerReady(): Promise<void> {
    for (let i = 0; i < 30; i++) {
      const v = this.adapter.getVideo();
      if (v && v.readyState >= 2 && !v.seeking) return;
      await sleep(500);
    }
  }

  private noteLastLine(index: number): void {
    const id = videoId.peek();
    const list = cues.peek();
    const cue = list[index];
    if (!id || !cue) return;
    // Reaching the final lines finishes the episode: forget the position instead of offering to continue at the end.
    const finished = index >= list.length - FINISHED_LINES;
    this.pendingLast = { videoId: id, mark: finished ? null : this.markFor(cue), title: this.titleOf() };
    if (!this.lastTimer) this.lastTimer = setTimeout(() => this.flushLastLine(), LAST_LINE_SAVE_MS);
  }

  private flushLastLine(): void {
    clearTimeout(this.lastTimer);
    this.lastTimer = undefined;
    const p = this.pendingLast;
    this.pendingLast = null;
    if (p) setLastLine(p.videoId, p.mark, p.title).catch(() => undefined);
  }

  // ---------------------------------------------------------------- loops

  /**
   * Pick a loop line: the first call marks the first line, the second marks the last line and starts looping.
   * With the loop key, the line playing now finishes before the loop jumps back; from the sidebar it starts at once.
   */
  pickLoopLine(index: number, viaKey: boolean): void {
    const list = cues.peek();
    if (!list[index]) {
      showToast('No subtitle line here yet');
      return;
    }
    const start = loopStart.peek();
    if (start == null) {
      this.playback.stopLoop();
      loopStart.value = index;
      const how = viaKey ? `press ${describeKey(settings.peek().shortcuts.loop)} on the last line` : 'pick the last line';
      showToast(`🔁 Loop from ${formatTime(list[index].start)} · ${how}`, 4000);
      return;
    }
    this.startLoop(start, index, !viaKey);
  }

  /** Shift+click in the sidebar: loop from the loop's first line (or the line playing now) to this one. */
  loopTo(index: number): void {
    const anchor = loopStart.peek() ?? loop.peek()?.from ?? this.playback.currentIndex;
    if (anchor < 0) this.pickLoopLine(index, false);
    else this.startLoop(anchor, index, true);
  }

  startLoop(from: number, to: number, fromStart: boolean): void {
    loopStart.value = null;
    // A loop of your own replaces a practice drill, and pauses a 🔎 run.
    drill.value = null;
    this.find.interrupt();
    this.closePopup();
    this.stopReading();
    this.playback.startLoop(from, to, fromStart);
    const l = this.playback.loopStatus;
    if (!l) return;
    const n = l.to - l.from + 1;
    const key = describeKey(settings.peek().shortcuts.loop);
    showToast(`🔁 Looping ${n === 1 ? '1 line' : `${n} lines`} · ${key} or Esc stops`);
  }

  /** Stop looping, or stop picking a loop. A 🔎 run pauses. */
  stopLoop(): void {
    const was = !!loop.peek() || loopStart.peek() != null;
    // A practice drill and a 🔎 run say so themselves.
    const drilling = drill.peek()?.phase === 'playing';
    const finding = findPlaying.peek();
    loopStart.value = null;
    if (finding) this.find.interrupt(true);
    this.playback.stopLoop();
    if (was && !drilling && !finding) showToast('Loop off');
  }

  saveCurrentLoop(): void {
    const id = videoId.peek();
    const l = loop.peek();
    const list = cues.peek();
    if (!id || !l || !list[l.from] || !list[l.to]) return;
    if (findSavedLoop(list, videoBookmarks.peek()?.loops, l.from, l.to)) {
      showToast('This loop is already saved');
      return;
    }
    const saved: SavedLoop = { from: this.markFor(list[l.from]), to: this.markFor(list[l.to]), createdAt: Date.now() };
    saveLoop(id, saved, this.titleOf()).catch((e) => showToast(errMsg(e)));
    showToast('🔁 Loop saved · see the Loops tab');
  }

  playSavedLoop(saved: SavedLoop): void {
    const range = findLoopRange(cues.peek(), saved);
    if (range) this.startLoop(range[0], range[1], true);
    else showToast('No subtitles loaded yet');
  }

  deleteSavedLoop(saved: SavedLoop): void {
    const id = videoId.peek();
    if (id) deleteLoop(id, saved).catch((e) => showToast(errMsg(e)));
  }

  // ---------------------------------------------------------------- ⭐ sentences

  /** G: save the sentence line `index` belongs to, all its lines. */
  saveSentenceAt(index: number): void {
    if (!cues.peek()[index] || !videoId.peek()) {
      showToast('No subtitle line here yet');
      return;
    }
    if (savedLines.peek().has(index)) {
      showToast('⭐ Already saved · see the ⭐ Sentences tab');
      return;
    }
    const [from, to] = sentenceRange(cueUnits.peek(), index);
    this.saveLines(from, to);
  }

  /** ⭐ on a line: save its sentence, or remove the saved sentence it is in. */
  toggleSentence(index: number): void {
    const id = savedLines.peek().get(index);
    if (id) this.deleteSentence(id);
    else this.saveSentenceAt(index);
  }

  /** ⭐ in the loop bar: the looped lines as one sentence. */
  saveLoopAsSentence(): void {
    const l = loop.peek();
    if (l) this.saveLines(l.from, l.to);
  }

  /**
   * Save lines [from, to] as a sentence to practise. A sentence saved before from the same first line takes the new
   * last line and keeps its practice history.
   */
  saveLines(from: number, to: number): void {
    const vid = videoId.peek();
    const list = cues.peek();
    const lang = mainLang.peek();
    const first = list[from];
    const last = list[to];
    if (!vid || !first || !last || !lang) return;
    const lines = list.slice(from, to + 1);
    const text = lines.map((c) => flatten(stripSoundDescriptions(c.text)) || flatten(c.text)).join(' ');
    const trans = translations.peek().slice(from, to + 1);
    const translation = trans.length && trans.every(Boolean) ? trans.join(' ') : undefined;
    const id = sentenceId(vid, lang, first.start);
    const now = Date.now();
    const lineInfo = {
      text,
      translation,
      to: this.markFor(last),
      endMs: last.end,
      after: list[to + 1] ? flatten(list[to + 1].text) : undefined,
    };
    const prev = sentences.peek()[id];
    let saved: SavedSentence;
    if (prev) {
      if (prev.to.timeMs === last.start) {
        showToast('⭐ Already saved · see the ⭐ Sentences tab');
        return;
      }
      saved = { ...prev, ...lineInfo, updatedAt: now };
      updateSentence(id, lineInfo).catch((e) => showToast(errMsg(e)));
      showToast(`⭐ Sentence changed to these ${lines.length} lines`);
    } else {
      saved = {
        id,
        lang,
        ...lineInfo,
        videoId: vid,
        title: this.titleOf(),
        from: this.markFor(first),
        startMs: first.start,
        before: list[from - 1] ? flatten(list[from - 1].text) : undefined,
        srs: newSrs(now),
        practiced: 0,
        createdAt: now,
        updatedAt: now,
      };
      addSentence(saved).catch((e) => showToast(errMsg(e)));
      showToast(`⭐ Saved${lines.length > 1 ? ` (${lines.length} lines)` : ''} · practise it in the ⭐ Sentences tab`);
    }
    // Shown at once; storage confirms it.
    sentences.value = { ...sentences.peek(), [id]: saved };
    if (!translation && translationMode.peek() !== 'same-language') this.translateSentence(saved);
  }

  /** Translations still loading, or none for some of its lines: translate the whole sentence. */
  private translateSentence(s: SavedSentence): void {
    send('translateLines', { lines: [s.text], from: toGoogleLang(s.lang), to: settings.peek().nativeLang })
      .then(({ translations: [t] }) => (t ? updateSentence(s.id, { translation: t }) : undefined))
      .catch(() => undefined);
  }

  deleteSentence(id: string): void {
    if (drill.peek()?.id === id) this.endDrill();
    const rest = { ...sentences.peek() };
    delete rest[id];
    sentences.value = rest;
    deleteSentences([id]).catch((e) => showToast(errMsg(e)));
    showToast('⭐ Removed from your sentences');
  }

  /** ▶ on a saved sentence: play it once (its episode is opened first when it is another one). */
  playSentence(s: SavedSentence): void {
    if (s.videoId !== videoId.peek()) {
      this.openSentence(s);
      return;
    }
    const r = findLoopRange(cues.peek(), s);
    if (!r) {
      showToast('No subtitles loaded yet');
      return;
    }
    this.closePopup();
    this.endDrill();
    this.find.interrupt();
    this.playback.stopLoop();
    this.playback.playRange(r[0], r[1]);
  }

  /** A click on a saved sentence: practise it now (its episode is opened first when it is another one). */
  practiseSentence(s: SavedSentence): void {
    if (s.videoId === videoId.peek()) this.startDrill(s);
    else this.openSentence(s);
  }

  /**
   * Practise a saved sentence: its lines loop with the drill's passes (listen with the text hidden, shadow with the
   * text, shadow from memory), then playback pauses and waits for a rating.
   */
  startDrill(s: SavedSentence): void {
    const range = findLoopRange(cues.peek(), s);
    if (!range) {
      showToast('No subtitles loaded yet');
      return;
    }
    const steps = drillSteps(settings.peek());
    this.closePopup();
    this.stopReading();
    this.find.interrupt();
    batch(() => {
      loopStart.value = null;
      resumeOffer.value = null;
      warmupOffer.value = null;
      drill.value = { id: s.id, steps, phase: 'playing' };
    });
    // The drill's own passes; the speaking gap setting applies to it too.
    this.playback.startLoop(range[0], range[1], true, steps.length);
    const step = drillStepInfo(steps[0]);
    showToast(`⭐ ${step.icon} ${step.hint} · ${steps.length} ${steps.length === 1 ? 'pass' : 'passes'}, then rate it`, 4000);
  }

  /** The drill's loop ended: all passes played (rate it now), or it was stopped. */
  private drillEnded(why: LoopEnd | undefined): void {
    const d = drill.peek();
    if (!d) return;
    if (why === 'done') {
      void this.adapter.pause().catch(() => undefined);
      drill.value = { ...d, phase: 'rate' };
      showToast('⭐ How did it go? 1 Again · 2 Hard · 3 Good · 4 Easy', 6000);
    } else {
      drill.value = null;
      showToast('Practice stopped');
    }
  }

  /** Leave the drill without rating it. */
  endDrill(): void {
    const d = drill.peek();
    if (!d) return;
    drill.value = null;
    if (d.phase === 'playing') this.playback.stopLoop();
  }

  /** Rate the drill just played; the sentence comes back sooner or later. In a practice session, the next one follows. */
  grade(g: Grade): void {
    const d = drill.peek();
    const s = d && sentences.peek()[d.id];
    if (!d || !s) return;
    const now = Date.now();
    const srs = schedule(s.srs, g, now);
    const practiced = (s.practiced ?? 0) + 1;
    sentences.value = { ...sentences.peek(), [s.id]: { ...s, srs, practiced, updatedAt: now } };
    updateSentence(s.id, { srs, practiced }).catch((e) => showToast(errMsg(e)));
    drill.value = null;
    const label = GRADES.find((x) => x.id === g)!.label;
    showToast(`⭐ ${label} · back ${backLabel(srs.interval)}`);
    this.advancePractice(s.id, g);
  }

  /** Practise every sentence due: this episode's first, then the others, opening their episodes in turn. */
  startDuePractice(): void {
    const ids = practiceOrder(dueList.peek(), videoId.peek());
    warmupOffer.value = null;
    if (!ids.length) {
      showToast('⭐ Nothing due · all caught up');
      return;
    }
    this.setSession({ ids, index: 0, done: 0, at: Date.now() });
    this.practiceCurrent(true);
  }

  /** The practice bar's Continue / Open: the session's current sentence, opening its episode if need be. */
  resumePractice(): void {
    const p = practice.peek();
    if (!isFreshSession(p, Date.now())) return;
    this.setSession({ ...p, at: Date.now() });
    this.practiceCurrent(true);
  }

  /** ✕ in the practice bar: stop the drill and the session. */
  stopPractice(): void {
    this.endDrill();
    if (practice.peek()) this.setSession(null);
    showToast('Practice stopped');
  }

  private setSession(p: PracticeSession | null): void {
    practice.value = p;
    setPractice(p).catch(() => undefined);
  }

  /** Practise the session's current sentence here; in another episode, open it (`navigate`) or let the bar offer it. */
  private practiceCurrent(navigate: boolean): void {
    let p = practice.peek();
    // Skip sentences deleted since the session started.
    while (p && p.index < p.ids.length && !sentences.peek()[p.ids[p.index]]) p = { ...p, index: p.index + 1 };
    if (!p || p.index >= p.ids.length) {
      this.setSession(null);
      return;
    }
    if (p !== practice.peek()) this.setSession(p);
    const s = sentences.peek()[p.ids[p.index]];
    if (s.videoId === videoId.peek()) this.startDrill(s);
    else if (navigate) this.navigate(netflixLink(s.videoId, s.startMs));
  }

  /** After a rating in a practice session: on to the next sentence. "Again" brings the sentence back once at the end. */
  private advancePractice(id: string, g: Grade): void {
    const p = practice.peek();
    const now = Date.now();
    if (!isFreshSession(p, now) || p.ids[p.index] !== id) return;
    const again = g === 'again' && p.ids.filter((x) => x === id).length < 2;
    const ids = again ? [...p.ids, id] : p.ids;
    const next: PracticeSession = { ids, index: p.index + 1, done: p.done + 1, at: now };
    if (next.index >= ids.length) {
      this.setSession(null);
      showToast(`🎉 Practice done · ${next.done} ${next.done === 1 ? 'sentence' : 'sentences'}`, 4000);
      return;
    }
    this.setSession(next);
    this.practiceCurrent(false);
  }

  /**
   * The session changed in storage: by this page (ignored, it already acted), or by the practice page asking to hear a
   * sentence of this episode on Netflix.
   */
  private practiceChanged(p: PracticeSession | null): void {
    // An event for an older write of this page, arriving after a newer one was made here.
    const mine = practice.peek();
    if (p && mine && p.at < mine.at) return;
    practice.value = p;
    const id = videoId.peek();
    if (!id || !cues.peek().length || !isFreshSession(p, Date.now())) return;
    const s = sentences.peek()[p.ids[p.index]];
    if (s && s.videoId === id && drill.peek()?.id !== s.id) this.startDrill(s);
  }

  /** The episode opened for the session's current sentence: practise it once the player is ready. */
  private async practiceHere(id: string): Promise<boolean> {
    const p = practice.peek() ?? (await getPractice().catch(() => null));
    if (!isFreshSession(p, Date.now())) return false;
    const s = sentences.peek()[p.ids[p.index]];
    if (!s || s.videoId !== id) return false;
    await this.whenPlayerReady();
    if (videoId.peek() === id && drill.peek()?.id !== s.id) this.startDrill(s);
    return true;
  }

  private offerWarmup(id: string): void {
    const due = dueList.peek();
    if (!settings.peek().warmup || !due.length || isFreshSession(practice.peek(), Date.now())) return;
    this.warmupLines = 0;
    warmupOffer.value = { due: due.length, here: due.filter((s) => s.videoId === id).length };
  }

  /** A sentence of another episode: open that episode, which then practises it. */
  private openSentence(s: SavedSentence): void {
    const p: PracticeSession = { ids: [s.id], index: 0, done: 0, at: Date.now() };
    practice.value = p;
    setPractice(p)
      .then(() => this.navigate(netflixLink(s.videoId, s.startMs)))
      .catch((e) => showToast(errMsg(e)));
  }

  /** Before a 🔎 found line plays: no popup, reading, drill, loop being picked or banner in its way. */
  clearForFound(): void {
    this.closePopup();
    this.stopReading();
    batch(() => {
      loopStart.value = null;
      resumeOffer.value = null;
      warmupOffer.value = null;
      drill.value = null;
    });
  }

  /** Open another episode in this tab. */
  navigate(url: string): void {
    this.flushLastLine();
    window.location.assign(url);
  }

  // ---------------------------------------------------------------- key lines

  /** This episode's sentences for key lines or a summary, or null before they are known. */
  private analysisRequest(options: Pick<KeyLinesRequest, 'cacheOnly' | 'refresh'>): KeyLinesRequest | null {
    const units = keyUnits.peek();
    const lang = mainLang.peek();
    const id = videoId.peek();
    if (!units.length || !lang || !id) return null;
    return { videoId: id, title: this.titleOf(), lines: units.map((u) => u.text), lang, ...options };
  }

  /**
   * One request for the whole episode (Claude Code or OpenAI, see Options); later visits come from the cache.
   * `refresh` makes a new result for the current settings even when one is cached. The shown result stays until it arrives.
   */
  async analyzeKeyLines(refresh = false): Promise<void> {
    const req = this.analysisRequest({ refresh });
    const prev = keyLines.peek().data;
    if (!req || keyLines.peek().status === 'loading') return;
    const gen = this.keyGen;
    keyLines.value = { status: 'loading', data: prev };
    try {
      const data = await send('findKeyLines', req);
      if (gen !== this.keyGen) return;
      keyLines.value = data ? { status: 'ready', data } : { status: 'error', error: 'No result was returned.', data: prev };
    } catch (e) {
      if (gen === this.keyGen) keyLines.value = { status: 'error', error: errMsg(e), data: prev };
    }
  }

  // ---------------------------------------------------------------- summary

  /** One request for the whole episode with the key-lines provider; later visits come from the cache. Like `analyzeKeyLines`. */
  async summarize(refresh = false): Promise<void> {
    const req = this.analysisRequest({ refresh });
    const prev = summary.peek().data;
    if (!req || summary.peek().status === 'loading') return;
    const gen = this.summaryGen;
    summary.value = { status: 'loading', data: prev };
    try {
      const data = await send('summarize', req);
      if (gen !== this.summaryGen) return;
      summary.value = data ? { status: 'ready', data } : { status: 'error', error: 'No result was returned.', data: prev };
    } catch (e) {
      if (gen === this.summaryGen) summary.value = { status: 'error', error: errMsg(e), data: prev };
    }
  }

  // ---------------------------------------------------------------- read aloud

  /**
   * Read summary items [from, to] aloud and highlight each one, with Netflix paused. English summaries use Kokoro
   * (American English, female voice) in the offscreen page; other languages use the browser's voice.
   */
  async readAloud(from: number, to: number): Promise<void> {
    const script = readingScript.peek();
    const lang = mainLang.peek();
    if (!script || !lang || from > to) return;
    await this.read(
      script.items.slice(from, to + 1).map((it) => it.speech),
      lang,
      () => (reading.value = { status: 'loading', from, to, item: -1, progress: null }),
      {
        onItem: (i) => (reading.value = { status: 'playing', from, to, item: from + i }),
        onLoading: (progress) => (reading.value = { ...reading.peek(), status: 'loading', progress }),
      },
    );
  }

  /**
   * 💬 Read answer `id` aloud, like the summary: Kokoro when it is in English, otherwise the browser's voice for the
   * language its letters show (the learning language or your own).
   */
  async readChat(id: string): Promise<void> {
    const msg = chat.peek().messages.find((m) => m.id === id);
    const lang = mainLang.peek();
    if (!msg?.text.trim() || !lang) return;
    const spoken = answerLang(msg.text, [lang, settings.peek().nativeLang]);
    await this.read(
      speechBlocks(msg.text).flatMap((b) => splitSentences(b, spoken)),
      spoken,
      () => (chatReading.value = { status: 'loading', id, progress: null }),
      {
        onItem: () => (chatReading.value = { status: 'playing', id }),
        onLoading: (progress) => (chatReading.value = { status: 'loading', id, progress }),
      },
    );
  }

  /** Read `texts` aloud with Netflix paused; `show` the start, and `on` each item and the voice loading. */
  private async read(
    texts: string[],
    lang: string,
    show: () => void,
    on: Pick<ReaderEvents, 'onItem' | 'onLoading'>,
  ): Promise<void> {
    this.stopReading();
    // A loop would start the video again after its speaking gap, which stops the reading.
    this.playback.stopLoop();
    const gen = this.readGen;
    const live = () => gen === this.readGen;
    show();
    if (!this.adapter.isPaused()) void this.adapter.pause().catch(() => undefined);
    const events: ReaderEvents = {
      onItem: (i) => live() && on.onItem(i),
      onLoading: (progress) => live() && on.onLoading(progress),
      onDone: () => live() && this.stopReading(),
      onError: (message) => {
        if (!live()) return;
        this.stopReading();
        showToast(message, 5000);
      },
    };
    const s = settings.peek();
    try {
      const reader = usesKokoro(lang)
        ? await readWithKokoro(texts, { voice: s.readAloudVoice, rate: s.readAloudRate, device: s.kokoroDevice }, events)
        : await readWithBrowserVoice(texts, lang, s.readAloudRate, events);
      if (live()) this.reader = reader;
      else reader.stop();
    } catch (e) {
      events.onError(errMsg(e));
    }
  }

  stopReading(): void {
    this.readGen++;
    this.reader?.stop();
    this.reader = null;
    if (reading.peek().status !== 'idle') reading.value = READING_IDLE;
    if (chatReading.peek().status !== 'idle') chatReading.value = CHAT_READING_IDLE;
  }

  /** Play from the first displayed line of sentence `unit` (an index into `keyUnits`). */
  goToSentence(unit: number): void {
    const i = cueUnits.peek().indexOf(unit);
    if (i >= 0) this.playback.goTo(i);
    else {
      const u = keyUnits.peek()[unit];
      if (u) this.seekToWord(u.start);
    }
  }

  setRate(rate: number): void {
    updateSettings({ playbackRate: rate });
    showToast(`Speed ${rate.toFixed(2).replace(/0$/, '')}×`);
  }

  stepRate(dir: 1 | -1): void {
    const cur = settings.peek().playbackRate;
    let i = PLAYBACK_RATES.findIndex((r) => Math.abs(r - cur) < 0.001);
    if (i < 0) i = PLAYBACK_RATES.findIndex((r) => r > cur) - (dir > 0 ? 1 : 0);
    const next = PLAYBACK_RATES[Math.max(0, Math.min(PLAYBACK_RATES.length - 1, i + dir))];
    this.setRate(next);
  }

  // ---------------------------------------------------------------- floating window & player

  /** Called by the UI when it mounts: how to draw the sidebar into the floating window. */
  setFloatUi(ui: FloatUi): void {
    this.floatUi = ui;
    floatAvailable.value = true;
    // After a reload, the first click on the page reopens a closed floating window (keys: see onKeyDown).
    // A touch's pointerdown doesn't count as a gesture for Chrome, so only the mouse.
    window.addEventListener('pointerdown', (e) => e.pointerType === 'mouse' && this.wantsReopen() && this.openFloat(), true);
    // The window outlives a reload, but its UI dies with this page.
    window.addEventListener('pagehide', () => this.float && showReloadNote(this.float));
    if (settings.peek().floating) void this.reconnectFloat();
    else this.floatChecked.value = true;
  }

  /** After a reload the floating window is still open: take it back, without a click since nothing new opens. */
  private async reconnectFloat(): Promise<void> {
    let open = false;
    try {
      open = await send('floatExists', {});
    } catch {
      // No answer from the background: the window, if any, waits for a click on the page.
    }
    if (open && !floatWin.peek() && settings.peek().floating) {
      const h = openFloatWindow(this.floatOptions());
      if (h) this.attachFloat(h);
    }
    this.floatChecked.value = true;
  }

  /** Floating is on but the window is closed (it was closed during a reload): a click or key opens it again. */
  private wantsReopen(): boolean {
    const s = settings.peek();
    return (
      s.enabled &&
      s.floating &&
      !!videoId.peek() &&
      !floatWin.peek() &&
      this.floatChecked.peek() &&
      // Opening the window would end fullscreen; the ⧉ tab on the page opens it on purpose.
      !document.fullscreenElement &&
      !!this.floatUi
    );
  }

  toggleFloat(): void {
    if (floatWin.peek()) this.dock();
    else this.openFloat();
  }

  private floatOptions(): FloatWindowOptions {
    return {
      css: this.floatUi!.css,
      onKeyDown: this.onFloatKeyDown,
      onKeyUp: this.onFloatKeyUp,
      onClose: (root) => this.onFloatClosed(root),
    };
  }

  /**
   * Move the sidebar into its own window, on the other monitor and filling it. Works only while handling a click or
   * key press (the popup blocker).
   */
  openFloat(): void {
    if (floatWin.peek() || !this.floatUi) return;
    const s = settings.peek();
    const wasFullscreen = !!document.fullscreenElement;
    const h = openFloatWindow(this.floatOptions());
    if (!h) {
      showToast('Chrome blocked the floating window. Allow pop-ups for netflix.com, then try again.', 6000);
      return;
    }
    this.attachFloat(h);
    send('floatPlace', { fullscreen: s.floatFullscreen, netflixFullscreen: wasFullscreen }).catch((e) =>
      showToast(`Couldn't move the floating window: ${errMsg(e)}`),
    );
  }

  private attachFloat(h: FloatHandle): void {
    this.float = h;
    h.win.addEventListener('blur', this.releaseReveal);
    // Floating first, so the effect that closes the window when floating goes off doesn't see it open without.
    batch(() => {
      if (!settings.peek().floating) updateSettings({ floating: true });
      floatWin.value = h.win;
      // A word popup on the page belongs to the sidebar that just left.
      if (popup.peek()?.where === 'page') this.closePopup();
    });
    this.floatUi!.render(h.root);
  }

  /** Put the sidebar back on the page and close the floating window. */
  dock(): void {
    updateSettings({ floating: false, sidebarOpen: true });
    floatWin.peek()?.close();
  }

  /**
   * The window closed: by the user (the sidebar goes back on the page), by dock() or by switching the extension off
   * (it stays floating). A reload doesn't close it.
   */
  private onFloatClosed(root: HTMLElement): void {
    this.floatUi?.unmount(root);
    this.float = null;
    batch(() => {
      floatWin.value = null;
      if (popup.peek()?.where === 'float') this.closePopup();
    });
    const s = settings.peek();
    if (s.floating && s.enabled) updateSettings({ floating: false });
  }

  /** The floating window fills its monitor: fullscreen, or maximized with the title bar and taskbar. */
  setFloatFullscreen(on: boolean): void {
    updateSettings({ floatFullscreen: on });
    send('floatState', { fullscreen: on }).catch((e) => showToast(errMsg(e)));
  }

  togglePlay(): void {
    const a = this.adapter;
    void (a.isPaused() ? a.play() : a.pause()).catch(() => undefined);
  }

  seekTo(ms: number): void {
    void this.adapter.seek(Math.max(0, ms)).catch((e) => showToast(errMsg(e)));
  }

  seekBy(ms: number): void {
    const now = this.adapter.nowMs();
    if (now != null) this.seekTo(now + ms);
  }

  /**
   * Netflix fullscreen, from the floating window. The page can't ask for its own fullscreen without a click on it, so
   * the browser window goes fullscreen instead; the player fills the page, so it looks the same.
   */
  toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else send('toggleTabFullscreen', {}).catch((e) => showToast(errMsg(e)));
  }

  /** Playing time and length for the floating window's seek bar, a few times a second. */
  private tickClock(v: HTMLVideoElement | null): void {
    const now = this.adapter.nowMs();
    if (!v || now == null || !Number.isFinite(v.duration)) return;
    // In Netflix's content time, like nowMs().
    const duration = v.duration * 1000 + (now - v.currentTime * 1000);
    const c = playClock.peek();
    if (Math.abs(now - c.now) >= 250 || Math.abs(duration - c.duration) > 1000) playClock.value = { now, duration };
  }

  // ---------------------------------------------------------------- word popup & hover

  openPopup(text: string, cueIndex: number, rect: DOMRect, where: UiWindow = 'page'): void {
    if (!text.trim()) return;
    this.hoverPaused = false;
    popup.value = { text: text.trim(), cueIndex, where, x: rect.left + rect.width / 2, y: rect.top, bottom: rect.bottom };
    if (!this.adapter.isPaused()) void this.adapter.pause().catch(() => undefined);
  }

  closePopup(): void {
    if (popup.peek() || selection.peek()) {
      batch(() => {
        popup.value = null;
        selection.value = null;
      });
    }
  }

  onSubtitlesEnter = (): void => {
    if (!settings.peek().pauseOnHover || popup.peek() || this.adapter.isPaused()) return;
    this.hoverPaused = true;
    void this.adapter.pause().catch(() => undefined);
  };

  onSubtitlesLeave = (): void => {
    if (!this.hoverPaused || popup.peek()) return;
    this.hoverPaused = false;
    void this.adapter.play().catch(() => undefined);
  };

  speak(text: string, lang = mainLang.peek()): void {
    send('speak', { text, lang, rate: Math.min(1, settings.peek().playbackRate) }).catch((e) => showToast(errMsg(e)));
  }

  async saveWord(
    text: string,
    cueIndex: number,
    level: WordLevel,
    extra: { dict?: DictEntry | null; explain?: ExplainResult | null },
  ): Promise<void> {
    const lang = mainLang.peek();
    const cue = cues.peek()[cueIndex];
    const vid = videoId.peek() ?? undefined;
    await saveWord({
      key: wordKey(text, lang),
      lang,
      word: text,
      level,
      translation: extra.explain?.meaningInContext || extra.dict?.translation || undefined,
      reading: extra.explain?.reading || extra.dict?.romanization || undefined,
      lemma: extra.explain?.lemma || undefined,
      sentence: cue ? flatten(cue.text) : undefined,
      sentenceTranslation: translations.peek()[cueIndex] ?? undefined,
      videoId: vid,
      title: this.titleOf(),
      timeMs: cue?.start,
    });
    showToast(level === 'learning' ? `Saved “${text}”` : `Marked “${text}” as known`);
  }

  async removeWord(text: string): Promise<void> {
    await deleteWords([wordKey(text, mainLang.peek())]);
    showToast(`Removed “${text}”`);
  }

  seekToWord(timeMs: number): void {
    const i = cues.peek().findIndex((c) => c.start >= timeMs - 5);
    if (i >= 0) this.playback.goTo(i);
    else void this.adapter.seek(timeMs);
  }
}
