import type { TimeRange } from './keylines';
import type { Cue } from './types';

export interface PlayerControls {
  /** Current media time in ms, or null when no video is available. */
  now(): number | null;
  isPaused(): boolean;
  seek(ms: number): void;
  play(): void;
  pause(): void;
}

/** Pause this many ms before the cue ends so the next line doesn't flash on screen. */
export const AUTO_PAUSE_LEAD_MS = 80;
/** A time jump larger than this is treated as a user seek. */
const JUMP_MS = 1500;
/** Skip mode only seeks when the next key range is further away than this. */
const MIN_SKIP_MS = 1500;
/** If a skip seek hasn't landed after this much playback, allow another try. */
const SKIP_RETRY_MS = 2000;
/** The speaking gap after a loop pass is at least this long. */
const MIN_GAP_MS = 1000;
/** A pause later than this past its point is skipped (playback stalled, e.g. in a background tab). */
const LATE_PAUSE_MS = 400;
/** Longest extra ending a line can be given. */
export const MAX_TAIL_MS = 5000;
/** Longest a line can be started before its subtitle. */
export const MAX_HEAD_MS = 3000;
/** Playing on after a stop that went this far past where the next line starts goes back to that start. */
const REWIND_MIN_MS = 150;
/** A seek to a line has landed once playback is between 100 ms before and this long after the target. */
const LAND_MS = 400;

/** Lines [from, to] (cue indices) being looped. */
export interface LoopStatus {
  from: number;
  to: number;
  /** The pass being played, from 1. */
  pass: number;
  /** Paused after a pass so the learner can say it back. */
  gap: boolean;
  /** Passes this loop plays instead of the loop setting (a practice drill). */
  passes?: number;
  /** Pause to say it back after every pass, the last one too, whatever the gap setting (🔎 Shadow all). */
  speakGap?: boolean;
}

export interface LoopConfig {
  /** Passes to play before normal playback goes on; 0 loops until stopped. */
  count: number;
  /** After each pass, pause as long as the pass took. */
  gap: boolean;
}

/** Why a loop ended: its passes were played, it was stopped, or the user went somewhere else. */
export type LoopEnd = 'done' | 'stopped' | 'seek';

export interface PlaybackHooks {
  onLoop?: (loop: LoopStatus | null, why?: LoopEnd) => void;
  /** Wall-clock ms, for the speaking gap. */
  clock?: () => number;
}

/** Index of the latest-starting cue that contains t, or -1. Cues must be sorted by start. */
export function findActiveIndex(cues: Cue[], t: number): number {
  const i = findLastStartedIndex(cues, t);
  for (let k = i; k >= 0 && k > i - 4; k--) {
    if (cues[k].start <= t && t < cues[k].end) return k;
  }
  return -1;
}

/** Index of the last cue whose start <= t, or -1. */
export function findLastStartedIndex(cues: Cue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export class PlaybackController {
  private cues: Cue[] = [];
  private armed = -1;
  private pausedAt = -1;
  private floor = -1;
  private lastT: number | null = null;
  private active = -1;
  private current = -1;
  private skip: TimeRange[] | null = null;
  /** After a user seek, skip mode waits until playback reaches a key range. */
  private skipHold = false;
  private skipTarget: number | null = null;
  private skipFrom = 0;
  private loop: LoopStatus | null = null;
  /** Where our seek back to the loop start goes, until it lands. */
  private loopSeek: number | null = null;
  private loopSeekAt = 0;
  private gapUntil = 0;
  /** The player was seen paused during this gap, so playing again means the user pressed play. */
  private gapPaused = false;
  private readonly clock: () => number;
  private readonly onLoop: (loop: LoopStatus | null, why?: LoopEnd) => void;
  /** Line kept as the current one past its subtitle end: while its extra ending plays, and while paused there. */
  private hold = -1;
  /** The player was seen paused at pausedAt's stop, so playing again lets go of the line. */
  private stopSeen = false;
  /** Pause at the end of this line once, even with auto-pause off (the extend key). */
  private once = -1;
  /** Line just gone to; from the moment the seek lands until its subtitle starts, it is the current line. */
  private target = -1;
  private targetLanded = false;
  private targetAt = 0;
  autoPause = false;
  /** Auto-pause this many ms later for every line. */
  pauseDelay = 0;
  /** Extra ms of each line (by cue index) to play after its subtitle ends before auto-pausing. */
  tails: number[] = [];
  /** Going to a line starts this many ms before its subtitle, for every line. */
  startEarly = 0;
  /** Extra ms of each line (by cue index) to play before its subtitle starts when going to it. */
  heads: number[] = [];
  /** When set, auto-pause only at the end of these cue indices. */
  pauseOnly: Set<number> | null = null;
  loopConfig: LoopConfig = { count: 0, gap: false };
  /** Playback speed, so the speaking gap matches the time the pass took. */
  rate = 1;
  /** Keep waiting in the speaking gap (e.g. while a word popup is open). */
  holdGap = false;

  constructor(
    private readonly player: PlayerControls,
    private readonly onChange: (active: number, current: number) => void = () => {},
    hooks: PlaybackHooks = {},
  ) {
    this.clock = hooks.clock ?? (() => performance.now());
    this.onLoop = hooks.onLoop ?? (() => {});
  }

  setCues(cues: Cue[]): void {
    // Cue indices change with the cue list, so a loop can't carry over.
    this.stopLoop();
    this.cues = cues;
    this.armed = this.pausedAt = this.floor = this.hold = this.once = this.target = -1;
    this.active = this.current = -1;
    this.lastT = null;
    this.skipTarget = null;
    this.skipHold = false;
    this.tick();
  }

  /** Play only inside these sorted, non-overlapping ranges (ms); null turns skipping off. */
  setSkipRanges(ranges: TimeRange[] | null): void {
    this.skip = ranges?.length ? ranges : null;
    this.skipTarget = null;
    this.skipHold = false;
  }

  get activeIndex(): number {
    return this.active;
  }

  get currentIndex(): number {
    return this.current;
  }

  /** Call every animation frame. */
  tick(): void {
    const t = this.player.now();
    if (t == null) return;
    const jumped = this.lastT != null && Math.abs(t - this.lastT) > JUMP_MS;
    this.lastT = t;
    if (jumped) {
      this.armed = -1;
      this.pausedAt = -1;
      // Our own skip landing is not a user seek.
      if (this.skipTarget == null || Math.abs(t - this.skipTarget) >= JUMP_MS) this.skipHold = true;
      this.skipTarget = null;
      const ownLoopSeek = this.loopSeek != null && Math.abs(t - this.loopSeek) < JUMP_MS;
      if (this.loop && !ownLoopSeek && !this.inLoop(t)) this.stopLoop('seek');
    }
    this.trackTarget(t);
    // The replay of the extend key or of playRange lands at its first line; any other jump drops the pause.
    if (jumped && this.once >= 0 && !(this.targetLanded && this.target >= 0 && this.target <= this.once)) this.once = -1;

    if (this.pausedAt >= 0) {
      if (this.player.isPaused()) this.stopSeen = true;
      else if (this.stopSeen && !this.loop && this.rewindToNext(t)) return;
    }
    this.hold = this.heldLine(t);
    let active = findActiveIndex(this.cues, t);
    let current = active >= 0 ? active : findLastStartedIndex(this.cues, t);
    if (this.hold >= 0) active = current = this.hold;
    if (active !== this.active || current !== this.current) {
      this.active = active;
      this.current = current;
      this.onChange(active, current);
    }

    if (this.floor >= 0 && current >= this.floor) this.floor = -1;
    if (this.once >= 0 && current > this.once) this.once = -1;
    if (this.pausedAt >= 0 && current !== this.pausedAt) this.pausedAt = -1;

    // A loop replaces skip mode and auto-pause; its speaking gap does the pausing.
    if (this.loop) {
      this.tickLoop(t);
      return;
    }

    // Not while a line's extra ending plays past its subtitle (and maybe past its key range).
    if (this.skip && this.hold < 0 && !this.player.isPaused()) this.skipAhead(t);

    if (this.player.isPaused()) return;
    if (
      active >= 0 &&
      active !== this.pausedAt &&
      (this.floor < 0 || active >= this.floor) &&
      this.pausesAfter(active)
    ) {
      this.armed = active;
    }
    if (this.armed >= 0) {
      if (!this.cues[this.armed] || !this.pausesAfter(this.armed)) {
        this.armed = -1;
      } else if (t >= this.pauseAt(this.armed)) {
        if (t < this.pauseAt(this.armed) + LATE_PAUSE_MS) this.player.pause();
        if (this.armed === this.once) this.once = -1;
        this.pausedAt = this.armed;
        this.stopSeen = false;
        this.armed = -1;
      }
    }
  }

  private pausesAfter(i: number): boolean {
    return i === this.once || (this.autoPause && (!this.pauseOnly || this.pauseOnly.has(i)));
  }

  /** When auto-pause stops line i: just before its subtitle ends, plus the pause delay and its own extra ending. */
  private pauseAt(i: number): number {
    return this.cues[i].end - AUTO_PAUSE_LEAD_MS + this.pauseDelay + (this.tails[i] ?? 0);
  }

  /** Where going to line i starts: at its subtitle, minus the start setting and its own lead-in. */
  private startAt(i: number): number {
    return Math.max(0, this.cues[i].start + 1 - this.startEarly - (this.heads[i] ?? 0));
  }

  /** Make line i the one being gone to and return where it starts; the caller seeks there. */
  private aim(i: number): number {
    this.target = i;
    this.targetLanded = false;
    this.targetAt = this.clock();
    return this.startAt(i);
  }

  /** Follow the seek to the target line: first it lands, then playback reaches the line's subtitle. */
  private trackTarget(t: number): void {
    const g = this.target;
    if (g < 0) return;
    const cue = this.cues[g];
    if (!cue) {
      this.target = -1;
      return;
    }
    const from = this.startAt(g);
    if (!this.targetLanded) {
      if (t >= from - 100 && t <= from + LAND_MS) this.targetLanded = true;
      else if (this.clock() - this.targetAt > SKIP_RETRY_MS) this.target = -1;
    } else if (t >= cue.start || t < from - 100) {
      this.target = -1;
    }
  }

  /**
   * Playing on after a stop that ran into the next line (an extra ending, the pause delay or the next line's own
   * early start): go back to where that line starts, so it isn't heard from a few words in.
   */
  private rewindToNext(t: number): boolean {
    const j = this.pausedAt + 1;
    if (!this.cues[j] || t - this.startAt(j) <= REWIND_MIN_MS) return false;
    const skipHold = this.skipHold;
    this.goTo(j);
    // Not a line the user picked: skip mode carries on as before.
    this.skipHold = skipHold;
    return true;
  }

  /**
   * The line that counts as current although the time says otherwise: one started before its subtitle, and one
   * whose extra ending plays (or is paused) after its subtitle. It stays on screen and is the line S repeats.
   */
  private heldLine(t: number): number {
    const g = this.target;
    if (g >= 0 && this.targetLanded && t < this.cues[g].start) return g;
    const loop = this.loop;
    if (loop) {
      const last = this.cues[loop.to];
      if (!last) return -1;
      if (loop.gap) return loop.to;
      const tail = t >= last.end - AUTO_PAUSE_LEAD_MS;
      return tail && (t < this.pauseAt(loop.to) + LATE_PAUSE_MS || this.loopSeek != null) ? loop.to : -1;
    }
    const a = this.armed;
    if (
      a >= 0 &&
      this.cues[a] &&
      this.pausesAfter(a) &&
      t >= this.cues[a].end - AUTO_PAUSE_LEAD_MS &&
      t < this.pauseAt(a) + LATE_PAUSE_MS
    ) {
      return a;
    }
    const p = this.pausedAt;
    if (p >= 0 && this.cues[p] && t >= this.cues[p].start) {
      const paused = this.player.isPaused();
      // Until the pause lands, and then for as long as it lasts.
      if ((paused || !this.stopSeen) && t < this.pauseAt(p) + (paused ? JUMP_MS : LATE_PAUSE_MS)) return p;
    }
    return -1;
  }

  private skipAhead(t: number): void {
    const ranges = this.skip!;
    if (ranges.some((r) => r.start <= t && t < r.end)) {
      this.skipHold = false;
      this.skipTarget = null;
      return;
    }
    if (this.skipHold) return;
    if (this.skipTarget != null) {
      if (t - this.skipFrom < SKIP_RETRY_MS) return;
      this.skipTarget = null;
    }
    const next = ranges.find((r) => r.start > t);
    if (!next || next.start - t <= MIN_SKIP_MS) return;
    this.skipTarget = next.start;
    this.skipFrom = t;
    this.player.seek(next.start);
    this.player.play();
  }

  get loopStatus(): LoopStatus | null {
    return this.loop;
  }

  /**
   * Loop lines [from, to] (either order). With `fromStart` playback jumps to the first line; otherwise the line
   * playing now finishes first, which is what you want after pressing the loop key on the last line. `passes`
   * overrides the loop setting's count for this loop. `speakGap` pauses after every pass, the last one included.
   */
  startLoop(from: number, to: number, fromStart: boolean, passes?: number, speakGap?: boolean): void {
    if (!this.cues.length) return;
    const clamp = (i: number) => Math.max(0, Math.min(this.cues.length - 1, i));
    this.loop = {
      from: clamp(Math.min(from, to)),
      to: clamp(Math.max(from, to)),
      pass: 1,
      gap: false,
      ...(passes ? { passes } : {}),
      ...(speakGap ? { speakGap } : {}),
    };
    this.loopSeek = null;
    this.armed = -1;
    this.pausedAt = -1;
    if (fromStart) {
      this.seekLoopStart();
      this.player.play();
    }
    this.onLoop(this.loop);
  }

  stopLoop(why: LoopEnd = 'stopped'): void {
    if (!this.loop) return;
    this.loop = null;
    this.loopSeek = null;
    // Skip mode picks up from wherever the loop left off.
    this.skipHold = true;
    this.onLoop(null, why);
  }

  /** Inside the looped lines, give or take a moment (a seek lands slightly off). */
  private inLoop(t: number): boolean {
    const first = this.cues[this.loop!.from];
    const last = this.cues[this.loop!.to];
    return (
      !!first &&
      !!last &&
      t >= this.startAt(this.loop!.from) - JUMP_MS &&
      t <= this.pauseAt(this.loop!.to) + JUMP_MS
    );
  }

  private tickLoop(t: number): void {
    const loop = this.loop!;
    const first = this.cues[loop.from];
    const last = this.cues[loop.to];
    if (!first || !last) {
      this.stopLoop();
      return;
    }
    if (loop.gap) {
      const isPaused = this.player.isPaused();
      if (isPaused) this.gapPaused = true;
      // Play pressed during the gap starts the next pass at once.
      const pressedPlay = this.gapPaused && !isPaused;
      if (pressedPlay || (!this.holdGap && this.clock() >= this.gapUntil)) {
        // Only a loop with its own speaking gap pauses after the last pass; it ends when that gap is over.
        if (this.lastPass(loop)) this.stopLoop('done');
        else this.nextPass();
      }
      return;
    }
    const endAt = Math.max(this.pauseAt(loop.to), first.start + 200);
    if (this.loopSeek != null) {
      // Netflix seeks asynchronously: wait for the jump back to land before watching for the end again.
      if (t < endAt) this.loopSeek = null;
      else if (this.clock() - this.loopSeekAt > SKIP_RETRY_MS) this.seekLoopStart();
      return;
    }
    if (this.player.isPaused() || t < endAt) return;
    if (this.lastPass(loop) && !loop.speakGap) {
      this.stopLoop('done');
      return;
    }
    if (loop.speakGap || this.loopConfig.gap) {
      this.player.pause();
      // The pass runs from the first line's (early) start to the last line's end, with its extra ending and the
      // pause delay.
      const passMs = (this.pauseAt(loop.to) + AUTO_PAUSE_LEAD_MS - this.startAt(loop.from)) / (this.rate || 1);
      this.gapUntil = this.clock() + Math.max(MIN_GAP_MS, passMs);
      this.gapPaused = false;
      this.setLoop({ ...loop, gap: true });
      return;
    }
    this.nextPass();
  }

  /** The loop has played all its passes once this one ends (never for a loop that runs until stopped). */
  private lastPass(loop: LoopStatus): boolean {
    const count = loop.passes ?? this.loopConfig.count;
    return count > 0 && loop.pass >= count;
  }

  private nextPass(): void {
    const loop = this.loop!;
    this.setLoop({ ...loop, pass: loop.pass + 1, gap: false });
    this.seekLoopStart();
    this.player.play();
  }

  private seekLoopStart(): void {
    const loop = this.loop!;
    const at = this.aim(loop.from);
    this.loopSeek = at;
    this.loopSeekAt = this.clock();
    this.armed = -1;
    this.pausedAt = -1;
    this.floor = loop.from;
    this.player.seek(at);
  }

  private setLoop(loop: LoopStatus): void {
    this.loop = loop;
    this.onLoop(loop);
  }

  goTo(index: number): void {
    if (!this.cues.length) return;
    const i = Math.max(0, Math.min(this.cues.length - 1, index));
    const at = this.aim(i);
    const loop = this.loop;
    if (loop && (i < loop.from || i > loop.to)) this.stopLoop('seek');
    else if (loop) {
      // A line picked inside the loop plays at once, even in the speaking gap. Until the seek lands, the old
      // position may still be past the loop's end, which must not count as a finished pass.
      this.loopSeek = at;
      this.loopSeekAt = this.clock();
      if (loop.gap) this.setLoop({ ...loop, gap: false });
    }
    this.armed = -1;
    this.pausedAt = -1;
    this.hold = -1;
    this.once = -1;
    this.floor = i;
    // The user picked this line: let it play even in skip mode.
    this.skipHold = true;
    this.skipTarget = null;
    this.player.seek(at);
    this.player.play();
  }

  /** Play lines [from, to] once and pause at the end of the last one, even with auto-pause off (a saved sentence). */
  playRange(from: number, to: number): void {
    if (!this.cues.length) return;
    this.goTo(from);
    this.once = Math.max(from, Math.min(this.cues.length - 1, to));
  }

  /** The line the previous / repeat / next keys move from. */
  get anchorIndex(): number {
    return this.anchor();
  }

  private anchor(): number {
    if (this.hold >= 0) return this.hold;
    const t = this.player.now();
    if (t == null) return this.current;
    const active = findActiveIndex(this.cues, t);
    return active >= 0 ? active : findLastStartedIndex(this.cues, t);
  }

  prev(): void {
    this.goTo(Math.max(0, this.anchor() - 1));
  }

  repeat(): void {
    this.goTo(Math.max(0, this.anchor()));
  }

  next(): void {
    this.goTo(this.anchor() + 1);
  }

  /**
   * The extend key, for a line cut off before its last words. Stopped at a line's end (or while its extra ending
   * plays), play `ms` more of it and pause again; in a loop, lengthen its last line. Returns that line, whose new
   * extra ending is in `tails`. Anywhere else, replay the current line and pause at its end, even with auto-pause
   * off, and return -1.
   */
  extend(ms: number): number {
    if (!this.cues.length) return -1;
    if (this.loop) return this.addTail(this.loop.to, ms);
    const i = this.hold;
    if (i < 0) {
      const a = Math.max(0, this.anchor());
      this.goTo(a);
      this.once = a;
      return -1;
    }
    this.addTail(i, ms);
    this.pausedAt = -1;
    this.armed = this.once = i;
    this.player.play();
    return i;
  }

  /** Take `ms` off the extra ending of the line at hand, then replay it to check (in a loop, its last line). */
  shorten(ms: number): number {
    if (!this.cues.length) return -1;
    if (this.loop) return this.addTail(this.loop.to, -ms);
    const i = Math.max(0, this.anchor());
    this.addTail(i, -ms);
    this.goTo(i);
    this.once = i;
    return i;
  }

  /**
   * The start key, for a line whose subtitle appears after the speaker has begun: start it `ms` earlier (negative:
   * later), replay it and pause at its end; in a loop, change its first line. Returns that line, whose lead-in is
   * in `heads`.
   */
  moveStart(ms: number): number {
    if (!this.cues.length) return -1;
    if (this.loop) return this.addHead(this.loop.from, ms);
    const i = Math.max(0, this.anchor());
    this.addHead(i, ms);
    this.goTo(i);
    this.once = i;
    return i;
  }

  private addTail(i: number, ms: number): number {
    this.tails = withAdded(this.tails, i, ms, MAX_TAIL_MS);
    return i;
  }

  private addHead(i: number, ms: number): number {
    this.heads = withAdded(this.heads, i, ms, MAX_HEAD_MS);
    return i;
  }
}

/** A copy of `list` with `ms` added at i, kept between 0 and max. */
function withAdded(list: number[], i: number, ms: number, max: number): number[] {
  const out = list.slice();
  out[i] = Math.max(0, Math.min(max, (out[i] ?? 0) + ms));
  return out;
}
