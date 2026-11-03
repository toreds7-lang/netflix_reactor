import { displayOf, pickDisplay, type DisplayArea } from '../core/displays';

/**
 * The floating sidebar window, seen from the background. The content script opens it with window.open(), so that it
 * can draw into it. A page can't put a window on another monitor or make it fullscreen, but chrome.windows can.
 */

/** The monitor the user last had the window on (local storage, kept across sessions). */
const PLACEMENT_KEY = 'floatPlacement';
/** Floating windows by window id, with the Netflix tab that opened each (session storage outlives the worker). */
const WINDOWS_KEY = 'floatWindows';
/** A window's state before the extension made it fullscreen, by window id. */
const RESTORE_KEY = 'fullscreenRestore';

type WindowMap = Record<string, number>;
type RestoreMap = Record<string, 'normal' | 'maximized'>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sessionGet<T extends object>(key: string): Promise<T> {
  return ((await chrome.storage.session.get(key))[key] as T | undefined) ?? ({} as T);
}

async function getDisplays(): Promise<DisplayArea[]> {
  try {
    return await chrome.system.display.getInfo();
  } catch {
    return [];
  }
}

function tabOf(sender: chrome.runtime.MessageSender): chrome.tabs.Tab & { id: number } {
  if (sender.tab?.id == null) throw new Error('Only a Netflix tab has a floating window');
  return sender.tab as chrome.tabs.Tab & { id: number };
}

/** The popup window a Netflix tab opened, if it is still open. */
async function findFloatWindow(openerTabId: number): Promise<number | null> {
  const tabs = await chrome.tabs.query({ windowType: 'popup' });
  return tabs.find((t) => t.openerTabId === openerTabId)?.windowId ?? null;
}

/** window.open() returns at once, but the browser lists the new window a moment later. */
async function waitForFloatWindow(openerTabId: number): Promise<number | null> {
  for (let i = 0; i < 20; i++) {
    const id = await findFloatWindow(openerTabId);
    if (id != null) return id;
    await sleep(100);
  }
  return null;
}

async function setFullscreen(windowId: number, on: boolean): Promise<void> {
  const w = await chrome.windows.get(windowId);
  const restore = await sessionGet<RestoreMap>(RESTORE_KEY);
  if (on && w.state !== 'fullscreen') {
    restore[windowId] = w.state === 'maximized' ? 'maximized' : 'normal';
    await chrome.storage.session.set({ [RESTORE_KEY]: restore });
    await chrome.windows.update(windowId, { state: 'fullscreen' });
  } else if (!on && w.state === 'fullscreen') {
    await chrome.windows.update(windowId, { state: restore[windowId] ?? 'maximized' });
  }
}

/**
 * Put the window a Netflix tab just opened on a monitor and fill it: the monitor the user last moved it to, otherwise
 * one without Netflix.
 */
export async function placeFloatWindow(
  sender: chrome.runtime.MessageSender,
  opts: { fullscreen: boolean; netflixFullscreen: boolean },
): Promise<void> {
  const tab = tabOf(sender);
  const id = await waitForFloatWindow(tab.id);
  if (id == null) throw new Error('The floating window was not found');
  const [displays, netflix, saved] = await Promise.all([
    getDisplays(),
    chrome.windows.get(tab.windowId),
    chrome.storage.local.get(PLACEMENT_KEY),
  ]);
  const display = pickDisplay(displays, netflix, (saved[PLACEMENT_KEY] as { displayId?: string } | undefined)?.displayId);
  // Registered only now, so that the window's first position (next to Netflix) isn't taken for the user's choice.
  const windows = await sessionGet<WindowMap>(WINDOWS_KEY);
  windows[id] = tab.id;
  await chrome.storage.session.set({ [WINDOWS_KEY]: windows });
  if (display) {
    const a = display.workArea;
    await chrome.windows.update(id, { state: 'normal', left: a.left, top: a.top, width: a.width, height: a.height });
  }
  // Opening a window took Netflix out of fullscreen. A fullscreen browser window looks the same, since the player
  // fills the page.
  if (opts.netflixFullscreen) await setFullscreen(tab.windowId, true);
  await chrome.windows.update(id, { state: opts.fullscreen ? 'fullscreen' : 'maximized', focused: true });
}

/** After a reload: is the tab's floating window still open, so the page can take it back? */
export async function floatExists(sender: chrome.runtime.MessageSender): Promise<boolean> {
  return (await findFloatWindow(tabOf(sender).id)) != null;
}

export async function setFloatState(sender: chrome.runtime.MessageSender, fullscreen: boolean): Promise<void> {
  const id = await findFloatWindow(tabOf(sender).id);
  if (id == null) throw new Error('The floating window is closed');
  await chrome.windows.update(id, { state: fullscreen ? 'fullscreen' : 'maximized' });
}

/** Fullscreen on or off for the Netflix tab's browser window; true when it is now fullscreen. */
export async function toggleTabFullscreen(sender: chrome.runtime.MessageSender): Promise<boolean> {
  const { windowId } = tabOf(sender);
  const on = (await chrome.windows.get(windowId)).state !== 'fullscreen';
  await setFullscreen(windowId, on);
  return on;
}

export function watchFloatWindows(): void {
  // Remember the monitor the user moves the window to.
  chrome.windows.onBoundsChanged.addListener(async (w) => {
    if (w.id == null || (await sessionGet<WindowMap>(WINDOWS_KEY))[w.id] == null) return;
    const display = displayOf(await getDisplays(), w);
    if (display) await chrome.storage.local.set({ [PLACEMENT_KEY]: { displayId: display.id } });
  });
  // The Netflix tab was closed: its floating window has nothing left to show.
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    const windows = await sessionGet<WindowMap>(WINDOWS_KEY);
    for (const [id, opener] of Object.entries(windows)) {
      if (opener === tabId) await chrome.windows.remove(Number(id)).catch(() => undefined);
    }
  });
  chrome.windows.onRemoved.addListener(async (id) => {
    const [windows, restore] = await Promise.all([sessionGet<WindowMap>(WINDOWS_KEY), sessionGet<RestoreMap>(RESTORE_KEY)]);
    if (windows[id] == null && restore[id] == null) return;
    delete windows[id];
    delete restore[id];
    await chrome.storage.session.set({ [WINDOWS_KEY]: windows, [RESTORE_KEY]: restore });
  });
}
