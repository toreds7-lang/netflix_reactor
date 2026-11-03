import { describe, expect, it } from 'vitest';
import { displayOf, pickDisplay, type DisplayArea } from '../src/core/displays';

const display = (id: string, left: number, width = 1920, height = 1080): DisplayArea => ({
  id,
  bounds: { left, top: 0, width, height },
  workArea: { left, top: 0, width, height: height - 40 },
});
const left = display('L', 0);
const right = display('R', 1920);

describe('floating window monitor', () => {
  it('finds the monitor a window is on by its centre', () => {
    expect(displayOf([left, right], { left: 1800, top: 100, width: 800, height: 600 })).toBe(right);
    expect(displayOf([left, right], { left: 100, top: 100, width: 800, height: 600 })).toBe(left);
    expect(displayOf([left, right], { left: 5000, top: 0, width: 10, height: 10 })).toBeNull();
  });

  it('picks a monitor without Netflix', () => {
    expect(pickDisplay([left, right], { left: 0, top: 0, width: 1920, height: 1040 })).toBe(right);
    expect(pickDisplay([left, right], { left: 1920, top: 0, width: 1920, height: 1040 })).toBe(left);
  });

  it('prefers the monitor the window was last moved to, while it is connected', () => {
    const netflix = { left: 0, top: 0, width: 1920, height: 1040 };
    expect(pickDisplay([left, right], netflix, 'L')).toBe(left);
    expect(pickDisplay([left, right], netflix, 'gone')).toBe(right);
  });

  it('uses the only monitor there is, and nothing without monitor info', () => {
    expect(pickDisplay([left], { left: 0, top: 0, width: 800, height: 600 })).toBe(left);
    expect(pickDisplay([], { left: 0, top: 0, width: 800, height: 600 })).toBeNull();
  });
});
