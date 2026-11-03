import { describe, expect, it } from 'vitest';
import {
  findActiveIndex,
  findLastStartedIndex,
  PlaybackController,
  type LoopConfig,
  type LoopEnd,
  type LoopStatus,
  type PlayerControls,
} from '../src/core/playback';
import { DEFAULT_SHORTCUTS } from '../src/core/settings';
import { matchShortcut } from '../src/core/shortcuts';
import type { Cue } from '../src/core/types';

const cues: Cue[] = [
  { start: 1000, end: 2000, text: 'one' },
  { start: 3000, end: 4000, text: 'two' },
  { start: 4000, end: 6000, text: 'three' },
];

class FakePlayer implements PlayerControls {
  t = 0;
  isPausedFlag = false;
  seeks: number[] = [];
  now() {
    return this.t;
  }
  isPaused() {
    return this.isPausedFlag;
  }
  seek(ms: number) {
    this.t = ms;
    this.seeks.push(ms);
  }
  play() {
    this.isPausedFlag = false;
  }
  pause() {
    this.isPausedFlag = true;
  }
}

describe('cue lookup', () => {
  it('finds active and last-started cues', () => {
    expect(findActiveIndex(cues, 500)).toBe(-1);
    expect(findActiveIndex(cues, 1500)).toBe(0);
    expect(findActiveIndex(cues, 2500)).toBe(-1);
    expect(findLastStartedIndex(cues, 2500)).toBe(0);
    expect(findActiveIndex(cues, 4000)).toBe(2);
    expect(findLastStartedIndex(cues, 99_999)).toBe(2);
  });
});

describe('PlaybackController', () => {
  function setup() {
    const player = new FakePlayer();
    const changes: [number, number][] = [];
    const pc = new PlaybackController(player, (a, c) => changes.push([a, c]));
    pc.setCues(cues);
    return { player, pc, changes };
  }

  it('reports cue changes', () => {
    const { player, pc, changes } = setup();
    player.t = 1200;
    pc.tick();
    player.t = 2500;
    pc.tick();
    expect(changes.slice(-2)).toEqual([
      [0, 0],
      [-1, 0],
    ]);
  });

  it('auto-pauses once at the end of each line', () => {
    const { player, pc } = setup();
    pc.autoPause = true;
    for (let t = 1000; t <= 1950; t += 50) {
      player.t = t;
      pc.tick();
    }
    expect(player.isPausedFlag).toBe(true);
    // Resume: must not pause again on the same cue.
    player.play();
    player.t = 1960;
    pc.tick();
    expect(player.isPausedFlag).toBe(false);
    player.t = 2100;
    pc.tick();
    expect(player.isPausedFlag).toBe(false);
    // Next cue pauses again.
    for (let t = 3000; t <= 3950; t += 50) {
      player.t = t;
      pc.tick();
    }
    expect(player.isPausedFlag).toBe(true);
  });

  it('does not pause after a user seek jumps past the line end', () => {
    const { player, pc } = setup();
    pc.autoPause = true;
    player.t = 1500;
    pc.tick();
    player.t = 30_000;
    pc.tick();
    expect(player.isPausedFlag).toBe(false);
  });

  it('repeat pauses again at the end of the same line', () => {
    const { player, pc } = setup();
    pc.autoPause = true;
    for (let t = 3000; t <= 3950; t += 50) {
      player.t = t;
      pc.tick();
    }
    expect(player.isPausedFlag).toBe(true);
    pc.repeat();
    expect(player.seeks.at(-1)).toBe(3001);
    expect(player.isPausedFlag).toBe(false);
    for (let t = 3001; t <= 3951; t += 50) {
      player.t = t;
      pc.tick();
    }
    expect(player.isPausedFlag).toBe(true);
  });

  it('navigates prev / next from the current or last line', () => {
    const { player, pc } = setup();
    player.t = 3500;
    pc.tick();
    pc.next();
    expect(player.seeks.at(-1)).toBe(4001);
    pc.tick();
    pc.prev();
    expect(player.seeks.at(-1)).toBe(3001);
    player.t = 2500; // in the gap after line 0
    pc.tick();
    pc.next();
    expect(player.seeks.at(-1)).toBe(3001);
  });

  it('with pauseOnly, auto-pauses only at the listed lines', () => {
    const { player, pc } = setup();
    pc.autoPause = true;
    pc.pauseOnly = new Set([1]);
    for (let t = 1000; t <= 1950; t += 50) {
      player.t = t;
      pc.tick();
    }
    expect(player.isPausedFlag).toBe(false);
    for (let t = 3000; t <= 3950; t += 50) {
      player.t = t;
      pc.tick();
    }
    expect(player.isPausedFlag).toBe(true);
  });
});

describe('PlaybackController skip mode', () => {
  const ranges = [
    { start: 3000, end: 4000 },
    { start: 20_000, end: 22_000 },
  ];
  function setup() {
    const player = new FakePlayer();
    const pc = new PlaybackController(player);
    pc.setCues(cues);
    pc.setSkipRanges(ranges);
    return { player, pc };
  }

  it('seeks from one key range to the next', () => {
    const { player, pc } = setup();
    pc.tick(); // t = 0
    expect(player.seeks).toEqual([3000]);
    pc.tick(); // landed inside the range: our own seek, not a user one
    player.t = 4500;
    pc.tick();
    expect(player.seeks).toEqual([3000, 20_000]);
  });

  it('does not seek for a short gap or while paused', () => {
    const { player, pc } = setup();
    player.t = 1600;
    pc.tick();
    expect(player.seeks).toEqual([]);
    player.pause();
    player.t = 4500;
    pc.tick();
    expect(player.seeks).toEqual([]);
  });

  it('lets a line the user picked play, then resumes skipping', () => {
    const { player, pc } = setup();
    pc.goTo(0);
    expect(player.seeks).toEqual([1001]);
    pc.tick();
    player.t = 1500;
    pc.tick();
    expect(player.seeks).toEqual([1001]);
    player.t = 3500;
    pc.tick();
    player.t = 4500;
    pc.tick();
    expect(player.seeks).toEqual([1001, 20_000]);
  });

  it('respects a user seek into a non-key part', () => {
    const { player, pc } = setup();
    player.t = 3500;
    pc.tick();
    player.t = 10_000;
    pc.tick();
    player.t = 10_100;
    pc.tick();
    expect(player.seeks).toEqual([]);
  });
});

/** Netflix seeks asynchronously: the time only changes when `land()` is called. */
class SlowSeekPlayer extends FakePlayer {
  override seek(ms: number) {
    this.seeks.push(ms);
  }
  land() {
    this.t = this.seeks.at(-1)!;
  }
}

describe('PlaybackController loops', () => {
  // Lines: 0 = 1000-2000, 1 = 3000-4000, 2 = 4000-6000.
  function setup(config: Partial<LoopConfig> = {}, player = new FakePlayer()) {
    let now = 0;
    const statuses: (LoopStatus | null)[] = [];
    const ends: (LoopEnd | undefined)[] = [];
    const pc = new PlaybackController(player, () => {}, {
      onLoop: (l, why) => {
        statuses.push(l);
        if (!l) ends.push(why);
      },
      clock: () => now,
    });
    pc.setCues(cues);
    pc.loopConfig = { count: 0, gap: false, ...config };
    /** Run 50 ms frames; media time moves only while playing, the wall clock always. */
    const frames = (n: number) => {
      for (let k = 0; k < n; k++) {
        if (!player.isPaused()) player.t += 50;
        now += 50;
        pc.tick();
      }
    };
    return { player, pc, statuses, ends, frames };
  }

  it('starts at the first line and jumps back after the last one, pass after pass', () => {
    const { player, pc, frames } = setup();
    pc.startLoop(1, 0, true); // either order
    expect(pc.loopStatus).toEqual({ from: 0, to: 1, pass: 1, gap: false });
    expect(player.seeks).toEqual([1001]);
    frames(60); // 1001 → 3951, just before line 1 ends
    expect(player.seeks).toEqual([1001, 1001]);
    expect(pc.loopStatus?.pass).toBe(2);
    frames(60);
    expect(player.seeks).toEqual([1001, 1001, 1001]);
    expect(pc.loopStatus?.pass).toBe(3);
  });

  it('after the set number of passes, ends and plays on', () => {
    const { player, pc, ends, frames } = setup({ count: 2 });
    pc.startLoop(0, 1, true);
    frames(60);
    expect(pc.loopStatus?.pass).toBe(2);
    frames(60);
    expect(pc.loopStatus).toBeNull();
    expect(ends).toEqual(['done']);
    expect(player.seeks).toEqual([1001, 1001]);
    frames(5);
    expect(player.isPausedFlag).toBe(false);
    expect(player.t).toBeGreaterThan(4000);
  });

  it('with the loop key pressed on the last line, lets that line finish first', () => {
    const { player, pc, frames } = setup();
    player.t = 3500;
    pc.tick();
    pc.startLoop(0, 1, false);
    expect(player.seeks).toEqual([]);
    frames(9); // 3950
    expect(player.seeks).toEqual([1001]);
    expect(pc.loopStatus?.pass).toBe(2);
  });

  it('pauses for a speaking gap as long as the pass took, then plays the next pass', () => {
    const { player, pc, frames } = setup({ gap: true });
    pc.rate = 0.5;
    pc.startLoop(1, 1, true); // 3000-4000: 1 s of video, 2 s at half speed
    frames(19); // 3951
    expect(player.isPausedFlag).toBe(true);
    expect(pc.loopStatus).toEqual({ from: 1, to: 1, pass: 1, gap: true });
    frames(39);
    expect(pc.loopStatus?.gap).toBe(true);
    expect(player.seeks).toEqual([3001]);
    frames(1); // 2000 ms
    expect(pc.loopStatus).toEqual({ from: 1, to: 1, pass: 2, gap: false });
    expect(player.seeks).toEqual([3001, 3001]);
    expect(player.isPausedFlag).toBe(false);
  });

  it('with lines started earlier, each pass starts early, the lead-in counts as the first line, and the gap includes it', () => {
    const { player, pc, frames, ends } = setup({ gap: true });
    pc.startEarly = 2000;
    pc.startLoop(1, 1, true); // line 1 is 3000-4000: start at 1001, inside line 0's time
    expect(player.seeks).toEqual([1001]);
    frames(1);
    expect(pc.currentIndex).toBe(1);
    frames(58); // 3951
    expect(pc.loopStatus?.gap).toBe(true);
    frames(59); // 2950 ms of a 2999 ms pass
    expect(pc.loopStatus?.gap).toBe(true);
    frames(1);
    expect(pc.loopStatus).toMatchObject({ pass: 2, gap: false });
    expect(player.seeks).toEqual([1001, 1001]);
    frames(1); // the jump back lands
    expect(pc.loopStatus).not.toBeNull();
    expect(pc.currentIndex).toBe(1);
    expect(ends).toEqual([]);
  });

  it('the speaking gap includes an extra ending given to the last line', () => {
    const { player, pc, frames } = setup({ gap: true });
    pc.tails = [0, 500];
    pc.startLoop(1, 1, true); // 3000-4000 plus 500 ms
    frames(29); // 4451
    expect(pc.loopStatus?.gap).toBe(true);
    frames(29);
    expect(pc.loopStatus?.gap).toBe(true);
    frames(1); // 1500 ms
    expect(pc.loopStatus).toMatchObject({ pass: 2, gap: false });
    expect(player.seeks).toEqual([3001, 3001]);
  });

  it('play pressed during the gap starts the next pass at once, but a pause still landing does not', () => {
    const { player, pc, frames } = setup({ gap: true });
    pc.startLoop(1, 1, true);
    frames(19);
    expect(pc.loopStatus?.gap).toBe(true);
    // Netflix hasn't paused yet: not a user action.
    player.isPausedFlag = false;
    pc.tick();
    expect(pc.loopStatus?.gap).toBe(true);
    player.pause();
    pc.tick();
    player.play();
    pc.tick();
    expect(pc.loopStatus).toMatchObject({ pass: 2, gap: false });
  });

  it('holds the gap while asked to (a word popup is open)', () => {
    const { pc, frames } = setup({ gap: true });
    pc.startLoop(1, 1, true);
    frames(19);
    pc.holdGap = true;
    frames(40);
    expect(pc.loopStatus?.gap).toBe(true);
    pc.holdGap = false;
    frames(1);
    expect(pc.loopStatus).toMatchObject({ pass: 2, gap: false });
  });

  it('waits for a slow seek back to land instead of counting extra passes, and retries a lost one', () => {
    const player = new SlowSeekPlayer();
    const { pc, frames, ends } = setup({}, player);
    player.t = 3500;
    pc.tick();
    pc.startLoop(0, 1, false);
    frames(9); // 3950: the pass ends, the seek back is pending
    expect(player.seeks).toEqual([1001]);
    frames(10); // still at the old position, past the end
    expect(player.seeks).toEqual([1001]);
    expect(pc.loopStatus?.pass).toBe(2);
    frames(31); // 2 s without landing: try again
    expect(player.seeks).toEqual([1001, 1001]);
    player.land();
    frames(1);
    expect(pc.loopStatus).toMatchObject({ pass: 2, gap: false });
    expect(ends).toEqual([]);
  });

  it('a seek away ends the loop; a seek inside it does not', () => {
    const { player, pc, ends, frames } = setup();
    pc.startLoop(0, 1, true);
    frames(5);
    player.t = 3500; // Netflix scrubber, inside the loop
    pc.tick();
    expect(pc.loopStatus).not.toBeNull();
    player.t = 30_000;
    pc.tick();
    expect(pc.loopStatus).toBeNull();
    expect(ends).toEqual(['seek']);
  });

  it('previous / next / repeat work inside the loop, and leaving it ends the loop', () => {
    const { player, pc, ends, frames } = setup();
    pc.startLoop(0, 1, true);
    frames(2);
    pc.next(); // line 1, inside
    expect(pc.loopStatus).not.toBeNull();
    frames(2);
    pc.repeat();
    expect(player.seeks.at(-1)).toBe(3001);
    expect(pc.loopStatus).not.toBeNull();
    frames(2);
    pc.next(); // line 2, outside
    expect(pc.loopStatus).toBeNull();
    expect(ends).toEqual(['seek']);
  });

  it('repeat in the speaking gap replays the line without counting a pass, even before the seek lands', () => {
    const player = new SlowSeekPlayer();
    const { pc, frames } = setup({ gap: true }, player);
    pc.startLoop(0, 1, true);
    player.land();
    frames(59); // 3951
    expect(pc.loopStatus?.gap).toBe(true);
    pc.repeat(); // S on line 1
    expect(player.seeks).toEqual([1001, 3001]);
    expect(pc.loopStatus).toMatchObject({ pass: 1, gap: false });
    frames(3); // old position, past the end: not a finished pass
    expect(player.seeks).toEqual([1001, 3001]);
    expect(pc.loopStatus?.pass).toBe(1);
  });

  it('auto-pause waits while looping', () => {
    const { player, pc, frames } = setup();
    pc.autoPause = true;
    pc.startLoop(0, 1, true);
    frames(60);
    expect(player.isPausedFlag).toBe(false);
    expect(pc.loopStatus?.pass).toBe(2);
  });

  it('a new cue list ends the loop', () => {
    const { pc, ends } = setup();
    pc.startLoop(0, 1, true);
    pc.setCues(cues.slice(1));
    expect(pc.loopStatus).toBeNull();
    expect(ends).toEqual(['stopped']);
  });
});

describe('matchShortcut', () => {
  const ev = (code: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
    code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
  });
  it('maps physical keys and ignores modifier combos', () => {
    expect(matchShortcut(ev('KeyA'), DEFAULT_SHORTCUTS)).toBe('prevLine');
    expect(matchShortcut(ev('KeyQ'), DEFAULT_SHORTCUTS)).toBe('toggleAutoPause');
    expect(matchShortcut(ev('KeyA', { ctrlKey: true }), DEFAULT_SHORTCUTS)).toBeNull();
    expect(matchShortcut(ev('KeyG'), DEFAULT_SHORTCUTS)).toBe('saveSentence');
    expect(matchShortcut(ev('KeyY'), DEFAULT_SHORTCUTS)).toBe('openChat');
    expect(matchShortcut(ev('KeyF'), DEFAULT_SHORTCUTS)).toBeNull();
  });
  it('J / K / L are plain keys; Alt+L is the on / off switch', () => {
    expect(matchShortcut(ev('KeyJ'), DEFAULT_SHORTCUTS)).toBe('prevKeyLine');
    expect(matchShortcut(ev('KeyK'), DEFAULT_SHORTCUTS)).toBe('repeatLine2');
    expect(matchShortcut(ev('KeyL'), DEFAULT_SHORTCUTS)).toBe('nextKeyLine');
    expect(matchShortcut(ev('KeyL', { altKey: true }), DEFAULT_SHORTCUTS)).toBe('toggleExtension');
  });
});
