import { computed, effect, untracked } from '@preact/signals';
import { findLoopRange } from '../core/bookmarks';
import {
  addRanges,
  hitTitle,
  isFreshRun,
  librarySentences,
  runItem,
  runOrder,
  type FindRun,
  type FindRunItem,
  type LibraryHit,
  type LibrarySaveRequest,
  type LibrarySearchRequest,
  type LikeLine,
} from '../core/library';
import { send } from '../core/messages';
import { frameQuery } from '../core/patterns';
import type { LoopEnd } from '../core/playback';
import { newSrs, sentenceId } from '../core/sentences';
import type { Settings } from '../core/settings';
import { flatten, stripSoundDescriptions } from '../core/subtitles';
import type { Cue, SavedSentence } from '../core/types';
import { getFindRun, onFindRunChanged, setFindRun } from '../library/store';
import { addSentence } from '../sentences/store';
import { netflixLink } from '../words/export';
import type { AppController } from './controller';
import {
  activeIndex,
  cues,
  cueUnits,
  FIND_IDLE,
  findPlaying,
  findRun,
  findState,
  floatWin,
  keyUnits,
  mainLang,
  meta,
  paused,
  sentences,
  settings,
  showToast,
  sidebarTab,
  translationMode,
  translations,
  updateSettings,
  videoId,
  type FindState,
} from './state';

/** An episode is saved this long after its subtitles or translations last changed (they come in bursts). */
const SAVE_DELAY_MS = 5000;
/** The parts played are sent at most this often. */
const WATCHED_FLUSH_MS = 10_000;
/** Play all: the pause between two lines. */
const BETWEEN_LINES_MS = 900;
/** Lines a Play all / Shadow all run takes from the results. */
const RUN_MAX = 40;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const short = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const isPattern = (q: string) => /\*|_{2,}/.test(q);

/**
 * 🔎 Find in my shows, on the Netflix page: saves the episode open now to the library (its sentences, translation line
 * and the parts played), searches the library, and plays what is found, one line after another, also in other episodes.
 */
export class FindController {
  private pendingSave: LibrarySaveRequest | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** What was last sent, so the same episode isn't written again for nothing. */
  private lastSave = '';
  private watched: [number, number][] = [];
  private watchedFor: { videoId: string; lang: string } | null = null;
  private watchedTimer: ReturnType<typeof setTimeout> | undefined;
  /** The line playing before, in the cue list it was in. */
  private lastActive: { list: Cue[]; index: number } | null = null;
  private searchGen = 0;
  /** Play all: the wait before the next line. */
  private nextTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly app: AppController) {}

  init(): void {
    void getFindRun()
      .then((r) => {
        if (!findRun.peek()) findRun.value = r;
      })
      .catch(() => undefined);
    onFindRunChanged((r) => {
      // An event for an older write of this page, arriving after a newer one was made here.
      const mine = findRun.peek();
      if (r && mine && r.at < mine.at) return;
      findRun.value = r;
    });
    const saveOn = computed(() => settings.value.librarySave);
    effect(() => {
      videoId.value;
      keyUnits.value;
      cues.value;
      translations.value;
      translationMode.value;
      meta.value;
      if (saveOn.value) untracked(() => this.scheduleSave());
    });
    effect(() => {
      const i = activeIndex.value;
      if (i >= 0) untracked(() => this.noteWatched(i));
    });
    window.addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => document.hidden && this.flush());
  }

  // ---------------------------------------------------------------- saving the episode

  private saveRequest(): LibrarySaveRequest | null {
    const id = videoId.peek();
    const lang = mainLang.peek();
    const units = keyUnits.peek();
    const list = cues.peek();
    if (!id || !lang || !units.length || !list.length) return null;
    const mode = translationMode.peek();
    const translated = mode === 'human' || mode === 'machine';
    const m = meta.peek();
    return {
      videoId: id,
      lang,
      show: m?.title,
      episode: m?.episodeTitle,
      trLang: translated ? settings.peek().nativeLang : undefined,
      trKind: translated ? mode : undefined,
      sentences: librarySentences(units, list, translated ? translations.peek() : []),
    };
  }

  private scheduleSave(): void {
    const req = this.saveRequest();
    if (!req) return;
    const p = this.pendingSave;
    // Another episode or language: the one before is saved now, not dropped.
    if (p && (p.videoId !== req.videoId || p.lang !== req.lang)) void this.flushSave();
    this.pendingSave = req;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flushSave(), SAVE_DELAY_MS);
  }

  private async flushSave(): Promise<void> {
    clearTimeout(this.saveTimer);
    const req = this.pendingSave;
    this.pendingSave = null;
    if (!req) return;
    const sig = [req.videoId, req.lang, req.show, req.episode, req.trKind, req.sentences.length, req.sentences.filter((s) => s.tr).length].join('|');
    if (sig === this.lastSave) return;
    this.lastSave = sig;
    try {
      await send('librarySave', req);
    } catch {
      this.lastSave = ''; // tried again on the next change
    }
  }

  /**
   * A line just became the one playing. While the video plays, it counts as watched, and so does the line before it,
   * which played to its end (it may have been gone to while paused, say with a click in the list).
   */
  private noteWatched(i: number): void {
    const list = cues.peek();
    const prev = this.lastActive?.list === list ? this.lastActive.index : -1;
    this.lastActive = { list, index: i };
    if (!settings.peek().librarySave || paused.peek()) return;
    const id = videoId.peek();
    const lang = mainLang.peek();
    const seen = [list[i], prev !== i ? list[prev] : undefined].filter((c): c is Cue => !!c);
    if (!seen.length || !id || !lang) return;
    const w = this.watchedFor;
    if (w && (w.videoId !== id || w.lang !== lang)) this.flushWatched();
    this.watchedFor = { videoId: id, lang };
    this.watched = addRanges(this.watched, seen.map((c): [number, number] => [c.start, c.end]));
    this.watchedTimer ??= setTimeout(() => this.flushWatched(), WATCHED_FLUSH_MS);
  }

  private flushWatched(): void {
    clearTimeout(this.watchedTimer);
    this.watchedTimer = undefined;
    const w = this.watchedFor;
    const ranges = this.watched;
    this.watched = [];
    if (w && ranges.length) send('libraryWatched', { ...w, ranges }).catch(() => undefined);
  }

  private flush(): void {
    void this.flushSave();
    this.flushWatched();
  }

  // ---------------------------------------------------------------- searching

  /** Show the 🔎 tab, with the sidebar if it was hidden. */
  private showTab(): void {
    sidebarTab.value = 'find';
    const s = settings.peek();
    if (!s.sidebarOpen && !s.floating && !floatWin.peek()) updateSettings({ sidebarOpen: true });
  }

  /** Search the library for words, a phrase, a pattern (`*`) or a Korean line, in the 🔎 tab. */
  search(query: string, back: LikeLine | null = null): void {
    const q = query.trim().replace(/\s+/g, ' ');
    this.showTab();
    findState.value = { ...FIND_IDLE, query: q, back, status: q ? 'loading' : 'idle' };
    if (q) void this.run();
  }

  /** "Find lines like this": the line's chunks found in other episodes, and lines with the same meaning. */
  async findLike(index: number): Promise<void> {
    const cue = cues.peek()[index];
    const id = videoId.peek();
    const lang = mainLang.peek();
    if (!cue || !id || !lang) {
      showToast('No subtitle line here yet');
      return;
    }
    const unit = keyUnits.peek()[cueUnits.peek()[index]];
    const like: LikeLine = {
      videoId: id,
      lang,
      start: unit?.start ?? cue.start,
      text: unit?.text ?? (flatten(stripSoundDescriptions(cue.text)) || flatten(cue.text)),
    };
    this.app.closePopup();
    this.showTab();
    findState.value = { ...FIND_IDLE, like, status: 'loading' };
    // The line's own episode counts too, so it is saved first.
    if (settings.peek().librarySave) {
      this.scheduleSave();
      await this.flushSave();
    }
    void this.run();
  }

  /** Back from a chunk or pattern search to the line it came from. */
  backToLine(): void {
    const back = findState.peek().back;
    if (!back) return;
    findState.value = { ...FIND_IDLE, like: back, status: 'loading' };
    void this.run();
  }

  /** A filter chip: saved with the settings, and the search made again. */
  setFilter(patch: Partial<Settings>): void {
    updateSettings(patch);
    this.again();
  }

  setShow(show: string): void {
    findState.value = { ...findState.peek(), show };
    this.again();
  }

  private again(): void {
    const st = findState.peek();
    if (st.query || st.like) void this.run();
  }

  private request(): LibrarySearchRequest {
    const s = settings.peek();
    const st = findState.peek();
    return {
      query: st.query,
      like: st.like ?? undefined,
      lang: mainLang.peek() || s.learningLang,
      here: videoId.peek(),
      scope: s.findScope,
      length: s.findLength,
      watchedOnly: s.findWatchedOnly,
      keyOnly: s.findKeyOnly,
      show: st.show || undefined,
    };
  }

  private patch(gen: number, p: Partial<FindState>): void {
    if (gen === this.searchGen) findState.value = { ...findState.peek(), ...p };
  }

  private async run(): Promise<void> {
    const gen = ++this.searchGen;
    const req = this.request();
    const st = findState.peek();
    const meaning = settings.peek().findMeaning && (!!st.like || (!!st.query && !isPattern(st.query)));
    this.patch(gen, { status: 'loading', error: undefined, meaning: { status: meaning ? 'loading' : 'off', hits: [] } });
    if (meaning) void this.runMeaning(req, gen);
    try {
      const r = await send('librarySearch', req);
      this.patch(gen, {
        status: 'ready',
        hits: r.hits,
        total: r.total,
        forms: r.forms,
        chunks: r.chunks,
        shows: r.shows,
        korean: r.korean,
        episodes: r.episodes,
        sentences: r.sentences,
      });
    } catch (e) {
      this.patch(gen, { status: 'error', error: errMsg(e) });
    }
  }

  private async runMeaning(req: LibrarySearchRequest, gen: number): Promise<void> {
    // While the model loads (the first time it downloads), show how far it is.
    const poll = setInterval(() => {
      send('libraryMeaningStatus', {})
        .then((info) => {
          const m = findState.peek().meaning;
          if (m.status === 'loading') this.patch(gen, { meaning: { ...m, info } });
        })
        .catch(() => undefined);
    }, 1500);
    try {
      const r = await send('libraryMeaning', req);
      this.patch(gen, { meaning: { status: 'ready', hits: r.hits, info: r.status, translated: r.translated } });
    } catch (e) {
      this.patch(gen, { meaning: { status: 'error', hits: [], error: errMsg(e) } });
    } finally {
      clearInterval(poll);
    }
  }

  /** ✨ Pattern: ask the key-lines provider for the reusable frames in the line searched from. */
  async findPatterns(): Promise<void> {
    const like = findState.peek().like;
    if (!like) return;
    const gen = this.searchGen;
    this.patch(gen, { frames: { status: 'loading', list: [] } });
    // The lines around it, when it is in this episode.
    const units = keyUnits.peek();
    const at = like.videoId === videoId.peek() ? units.findIndex((u) => u.start === like.start) : -1;
    try {
      const { frames } = await send('libraryPattern', {
        sentence: like.text,
        lang: like.lang,
        before: at > 0 ? units[at - 1].text : undefined,
        after: at >= 0 ? units[at + 1]?.text : undefined,
      });
      this.patch(gen, { frames: { status: 'ready', list: frames } });
    } catch (e) {
      this.patch(gen, { frames: { status: 'error', list: [], error: errMsg(e) } });
    }
  }

  /** A pattern from ✨ Pattern, searched with ___ as a gap. */
  searchFrame(frame: string): void {
    this.search(frameQuery(frame), findState.peek().like);
  }

  // ---------------------------------------------------------------- playing what was found

  /** Every line shown, in the order shown: the word matches, then the same-meaning ones. */
  shownHits(): LibraryHit[] {
    const st = findState.peek();
    const seen = new Set(st.hits.map((h) => h.id));
    return [...st.hits, ...st.meaning.hits.filter((h) => !seen.has(h.id))];
  }

  /** ▶ Play all / 🗣 Shadow all: the lines found, this episode's first, then the others, opening their episodes. */
  startRun(mode: FindRun['mode']): void {
    const items = runOrder(this.shownHits().slice(0, RUN_MAX).map(runItem), videoId.peek());
    if (!items.length) {
      showToast('🔎 No lines to play');
      return;
    }
    const st = findState.peek();
    const label = st.query ? `“${short(st.query)}”` : st.like ? `like “${short(st.like.text)}”` : '';
    this.setRun({ mode, passes: this.passes(mode), label, items, index: 0, at: Date.now() });
    this.playCurrent(true);
  }

  /** ▶ or 🗣 on one line. ▶ on a line of this episode just plays it; otherwise its episode opens first. */
  playHit(h: LibraryHit, mode: FindRun['mode']): void {
    const item = runItem(h);
    if (mode === 'play' && h.videoId === videoId.peek()) {
      const r = this.rangeOf(item);
      if (!r) {
        showToast('No subtitles loaded yet');
        return;
      }
      this.interrupt();
      this.app.clearForFound();
      this.app.playback.stopLoop();
      this.app.playback.playRange(r[0], r[1]);
      return;
    }
    this.setRun({ mode, passes: this.passes(mode), label: `“${short(h.text)}”`, items: [item], index: 0, at: Date.now() });
    this.playCurrent(true);
  }

  private passes(mode: FindRun['mode']): number {
    return mode === 'shadow' ? Math.max(1, settings.peek().findShadowPasses) : 1;
  }

  private rangeOf(item: FindRunItem): [number, number] | null {
    return findLoopRange(cues.peek(), item);
  }

  private setRun(r: FindRun | null): void {
    findRun.value = r;
    setFindRun(r).catch(() => undefined);
  }

  /** Play the run's current line here; in another episode, open it (`navigate`) or let the bar offer it. */
  private playCurrent(navigate: boolean): void {
    const r = findRun.peek();
    if (!isFreshRun(r, Date.now())) {
      this.setRun(null);
      findPlaying.value = false;
      return;
    }
    const item = r.items[r.index];
    if (item.videoId !== videoId.peek()) {
      findPlaying.value = false;
      if (navigate) this.app.navigate(netflixLink(item.videoId, item.start));
      return;
    }
    const range = this.rangeOf(item);
    if (!range) {
      findPlaying.value = false;
      showToast('No subtitles loaded yet');
      return;
    }
    this.app.clearForFound();
    clearTimeout(this.nextTimer);
    findPlaying.value = true;
    const shadow = r.mode === 'shadow';
    this.app.playback.startLoop(range[0], range[1], true, shadow ? r.passes : 1, shadow);
  }

  /** The loop of a line ended. Returns false when it wasn't the run's. */
  loopEnded(why: LoopEnd | undefined): boolean {
    if (!findPlaying.peek()) return false;
    if (why !== 'done') {
      findPlaying.value = false;
      this.touch();
      showToast('🔎 Paused · ▶ Continue in the bar');
      return true;
    }
    const r = findRun.peek();
    // Shadow all paused after the last pass already; Play all stops here a moment between lines.
    const wait = r?.mode === 'play' ? BETWEEN_LINES_MS : 0;
    if (wait) void this.app.adapter.pause().catch(() => undefined);
    clearTimeout(this.nextTimer);
    this.nextTimer = setTimeout(() => {
      this.nextTimer = undefined;
      if (findPlaying.peek()) this.advance();
    }, wait);
    return true;
  }

  private advance(): void {
    const r = findRun.peek();
    if (!r) return;
    const next: FindRun = { ...r, index: r.index + 1, at: Date.now() };
    if (next.index >= r.items.length) {
      findPlaying.value = false;
      this.setRun(null);
      showToast(`🔎 Done · ${r.items.length === 1 ? '1 line' : `${r.items.length} lines`}`, 3000);
      return;
    }
    this.setRun(next);
    // A line in another episode waits for Open › in the bar.
    this.playCurrent(false);
  }

  /** Something else takes over playback (a loop or drill of your own, Esc): the run pauses. */
  interrupt(say = false): void {
    clearTimeout(this.nextTimer);
    this.nextTimer = undefined;
    if (!findPlaying.peek()) return;
    findPlaying.value = false;
    this.touch();
    if (say) showToast('🔎 Paused · ▶ Continue in the bar');
  }

  /** The bar's ▶ Continue / Open ›: the run's current line, opening its episode if need be. */
  resume(): void {
    this.touch();
    this.playCurrent(true);
  }

  /** The bar's ⏭: on to the next line. */
  skip(): void {
    this.interrupt();
    if (this.app.playback.loopStatus) this.app.playback.stopLoop();
    this.advance();
  }

  /** The bar's ✕: end the run. */
  stopRun(): void {
    const playing = findPlaying.peek();
    this.interrupt();
    this.setRun(null);
    if (playing) this.app.playback.stopLoop();
  }

  private touch(): void {
    const r = findRun.peek();
    if (r) this.setRun({ ...r, at: Date.now() });
  }

  /** The episode opened for the run's current line: play it once the player is ready. */
  async continueHere(id: string): Promise<boolean> {
    const r = findRun.peek() ?? (await getFindRun().catch(() => null));
    if (!isFreshRun(r, Date.now()) || r.items[r.index].videoId !== id) return false;
    findRun.value = r;
    await this.app.whenPlayerReady();
    if (videoId.peek() === id) this.playCurrent(false);
    return true;
  }

  // ---------------------------------------------------------------- ⭐

  isSaved(h: LibraryHit): boolean {
    return !!sentences.value[sentenceId(h.videoId, h.lang, h.from.timeMs)];
  }

  /** ☆ on a found line: save it to ⭐ Sentences (★ removes it). */
  toggleSaved(h: LibraryHit): void {
    const id = sentenceId(h.videoId, h.lang, h.from.timeMs);
    if (sentences.peek()[id]) {
      this.app.deleteSentence(id);
      return;
    }
    if (h.videoId === videoId.peek()) {
      const r = this.rangeOf(runItem(h));
      if (r && sentenceId(h.videoId, h.lang, cues.peek()[r[0]].start) === id) {
        this.app.saveLines(r[0], r[1]);
        return;
      }
    }
    const now = Date.now();
    const s: SavedSentence = {
      id,
      lang: h.lang,
      text: h.text,
      translation: h.tr,
      videoId: h.videoId,
      title: hitTitle(h),
      from: h.from,
      to: h.to,
      startMs: h.start,
      endMs: h.end,
      before: h.before,
      after: h.after,
      srs: newSrs(now),
      practiced: 0,
      createdAt: now,
      updatedAt: now,
    };
    sentences.value = { ...sentences.peek(), [id]: s };
    addSentence(s).catch((e) => showToast(errMsg(e)));
    showToast('⭐ Saved · practise it in the ⭐ Sentences tab');
  }
}
