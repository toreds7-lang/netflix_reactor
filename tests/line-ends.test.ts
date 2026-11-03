import { describe, expect, it } from 'vitest';
import { lineKey, msFor } from '../src/lineends/store';
import { PlaybackController, type PlayerControls } from '../src/core/playback';
import { DEFAULT_SHORTCUTS } from '../src/core/settings';
import { matchShortcut } from '../src/core/shortcuts';
import type { Cue } from '../src/core/types';

// Line 1 is followed directly by line 2, so an extra ending of line 1 runs into line 2's time.
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

function setup(autoPause = true) {
  const player = new FakePlayer();
  const pc = new PlaybackController(player);
  pc.setCues(cues);
  pc.autoPause = autoPause;
  /** Play from `from` to `to` in 50 ms frames, stopping early if the player pauses. */
  const run = (from: number, to: number) => {
    for (let t = from; t <= to; t += 50) {
      player.t = t;
      pc.tick();
      if (player.isPausedFlag) return t;
    }
    return null;
  };
  return { player, pc, run };
}

describe('line endings', () => {
  it('pauses later with a pause delay and keeps the line current past its end', () => {
    const { player, pc, run } = setup();
    pc.pauseDelay = 500;
    expect(run(1000, 2300)).toBeNull();
    expect(pc.activeIndex).toBe(0); // the subtitle ended at 2000
    expect(run(2350, 3000)).toBe(2450); // 2000 - 80 + 500 = 2420
    pc.tick();
    expect(pc.activeIndex).toBe(0);
    expect(player.isPausedFlag).toBe(true);
  });

  it('extend after an auto-pause plays more of the same line and pauses again', () => {
    const { player, pc, run } = setup();
    expect(run(3000, 4000)).toBe(3950);
    expect(pc.extend(700)).toBe(1);
    expect(pc.tails[1]).toBe(700);
    expect(player.isPausedFlag).toBe(false);
    expect(player.seeks).toEqual([]); // no replay: it carries on from where it stopped
    expect(run(4000, 4600)).toBeNull();
    expect(pc.activeIndex).toBe(1); // held over line 2, which started at 4000
    expect(run(4650, 5000)).toBe(4650); // 4000 - 80 + 700 = 4620
    pc.tick();
    expect(pc.activeIndex).toBe(1);
    // The extra ending ran into line 2, so playing on goes back to its start, and it pauses at its own end.
    player.play();
    player.t = 4700;
    pc.tick();
    expect(player.seeks).toEqual([4001]);
    pc.tick();
    expect(pc.activeIndex).toBe(2);
    expect(run(4051, 6000)).toBe(5951);
  });

  it('playing on after a stop that ended before the next line goes straight on', () => {
    const { player, pc, run } = setup();
    expect(run(1000, 2500)).toBe(1950);
    pc.tick();
    player.play();
    player.t = 1960;
    pc.tick();
    expect(player.seeks).toEqual([]);
  });

  it('pressing extend again adds more', () => {
    const { pc, run } = setup();
    run(3000, 4000);
    pc.extend(500);
    expect(run(4000, 5000)).toBe(4450);
    expect(pc.extend(500)).toBe(1);
    expect(pc.tails[1]).toBe(1000);
    expect(run(4500, 5500)).toBe(4950);
  });

  it('extend elsewhere replays the line and stops at its end, even with auto-pause off', () => {
    const { player, pc, run } = setup(false);
    player.t = 3500;
    pc.tick();
    expect(pc.extend(700)).toBe(-1);
    expect(player.seeks).toEqual([3001]);
    expect(pc.tails[1] ?? 0).toBe(0);
    expect(run(3001, 4500)).toBe(3951);
    // Only once: playing on doesn't pause at the next line.
    player.play();
    expect(run(4000, 6500)).toBeNull();
  });

  it('a saved ending applies when the line is repeated', () => {
    const { player, pc, run } = setup();
    pc.tails = [0, 700, 0];
    player.t = 3500;
    pc.tick();
    pc.repeat();
    expect(run(3001, 5000)).toBe(4651);
  });

  it('shorten takes time off the line and replays it', () => {
    const { player, pc, run } = setup(false);
    pc.tails = [0, 1400, 0];
    player.t = 3500;
    pc.tick();
    expect(pc.shorten(700)).toBe(1);
    expect(pc.tails[1]).toBe(700);
    expect(player.seeks).toEqual([3001]);
    expect(run(3001, 5000)).toBe(4651);
    expect(pc.shorten(1000)).toBe(1);
    expect(pc.tails[1]).toBe(0);
  });

  it('caps the extra ending', () => {
    const { pc, run } = setup();
    run(3000, 4000);
    pc.extend(60_000);
    expect(pc.tails[1]).toBe(5000);
  });

  it('extend during a loop lengthens its last line', () => {
    const { player, pc, run } = setup(false);
    pc.startLoop(0, 1, true);
    expect(player.seeks).toEqual([1001]);
    expect(pc.extend(500)).toBe(1);
    expect(pc.tails[1]).toBe(500);
    run(1001, 4400);
    expect(player.seeks).toEqual([1001]);
    expect(pc.activeIndex).toBe(1);
    player.t = 4450;
    pc.tick();
    expect(player.seeks).toEqual([1001, 1001]); // 4000 - 80 + 500 = 4420
  });

  it('maps saved timings to cues by language and start time', () => {
    const ends = { [lineKey('en', cues[1])]: 700 };
    expect(msFor(cues, 'en', ends)).toEqual([0, 700, 0]);
    expect(msFor(cues, 'es', ends)).toEqual([0, 0, 0]);
  });

  it('X extends and Z starts earlier by default', () => {
    const key = (code: string) => ({ code, ctrlKey: false, metaKey: false, altKey: false });
    expect(matchShortcut(key('KeyX'), DEFAULT_SHORTCUTS)).toBe('extendLine');
    expect(matchShortcut(key('KeyZ'), DEFAULT_SHORTCUTS)).toBe('startEarlier');
  });
});

describe('line starts', () => {
  it('starts lines earlier and counts the lead-in as that line', () => {
    const { player, pc, run } = setup();
    pc.startEarly = 500;
    player.t = 4500;
    pc.tick();
    pc.repeat();
    expect(player.seeks).toEqual([3501]);
    // 3501 is still inside line 1, but line 2 is the one playing: line 1 doesn't pause at its end (3920).
    expect(run(3501, 3951)).toBeNull();
    expect(pc.activeIndex).toBe(2);
    expect(run(4001, 6500)).toBe(5951);
  });

  it('the start key starts the line earlier, replays it and pauses at its end', () => {
    const { player, pc, run } = setup(false);
    player.t = 4500;
    pc.tick();
    expect(pc.moveStart(700)).toBe(2);
    expect(pc.heads[2]).toBe(700);
    expect(player.seeks).toEqual([3301]);
    expect(run(3301, 3901)).toBeNull();
    expect(pc.activeIndex).toBe(2);
    expect(run(3951, 6500)).toBe(5951);
    // Pressed again in the lead-in, it moves the same line.
    pc.goTo(2);
    pc.tick();
    expect(pc.moveStart(300)).toBe(2);
    expect(pc.heads[2]).toBe(1000);
    expect(player.seeks.at(-1)).toBe(3001);
  });

  it('with Shift (a negative step) it goes back to the subtitle start, not past it', () => {
    const { player, pc } = setup(false);
    pc.heads = [0, 0, 700];
    player.t = 4500;
    pc.tick();
    expect(pc.moveStart(-1000)).toBe(2);
    expect(pc.heads[2]).toBe(0);
    expect(player.seeks).toEqual([4001]);
  });

  it('caps the lead-in', () => {
    const { player, pc } = setup(false);
    player.t = 4500;
    pc.tick();
    pc.moveStart(60_000);
    expect(pc.heads[2]).toBe(3000);
  });

  it('loops start their first line early too', () => {
    const { player, pc } = setup(false);
    pc.heads = [300, 0, 0];
    pc.startLoop(0, 1, true);
    expect(player.seeks).toEqual([701]);
    expect(pc.moveStart(200)).toBe(0); // in a loop: no replay, the next pass uses it
    expect(pc.heads[0]).toBe(500);
    expect(player.seeks).toEqual([701]);
  });
});
