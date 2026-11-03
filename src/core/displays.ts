/** Choosing the monitor for the floating sidebar window. */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The parts of chrome.system.display.DisplayUnitInfo used here. */
export interface DisplayArea {
  id: string;
  bounds: Rect;
  /** The display minus the taskbar. */
  workArea: Rect;
}

const contains = (r: Rect, x: number, y: number) => x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height;

/** The display a window is on: the one holding its centre. */
export function displayOf(displays: DisplayArea[], win: Partial<Rect>): DisplayArea | null {
  const x = (win.left ?? 0) + (win.width ?? 0) / 2;
  const y = (win.top ?? 0) + (win.height ?? 0) / 2;
  return displays.find((d) => contains(d.bounds, x, y)) ?? null;
}

/**
 * Where the floating window goes: the monitor the user last moved it to if it is still connected, otherwise a monitor
 * without the Netflix window, otherwise Netflix's own.
 */
export function pickDisplay(displays: DisplayArea[], netflixWindow: Partial<Rect>, savedId?: string): DisplayArea | null {
  if (!displays.length) return null;
  const saved = savedId ? displays.find((d) => d.id === savedId) : undefined;
  if (saved) return saved;
  const home = displayOf(displays, netflixWindow);
  return displays.find((d) => d !== home) ?? home ?? displays[0];
}
