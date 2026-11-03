/**
 * The floating sidebar window: an ordinary popup window opened with window.open(). Its about:blank document has
 * Netflix's origin, so the UI renders into it with the same signals and controller as the page and nothing has to be
 * synced. The background then moves it to the other monitor and makes it fullscreen (src/services/floatwin.ts),
 * which a page can't do.
 *
 * - Opening it needs a click or key press (the popup blocker), and takes the page out of fullscreen (Chrome's rule).
 * - The window outlives a reload of the Netflix tab. It is named after the tab (an id kept in sessionStorage), so the
 *   reloaded page takes it back with window.open('', name) without a click: the window exists, so nothing is opened.
 */

/** How the UI draws itself into the window; registered by mountUi. */
export interface FloatUi {
  css: string;
  render(root: HTMLElement): void;
  unmount(root: HTMLElement): void;
}

export interface FloatWindowOptions {
  css: string;
  onKeyDown(e: KeyboardEvent): void;
  onKeyUp(e: KeyboardEvent): void;
  /** The window was closed (by the user, or by dock()). */
  onClose(root: HTMLElement): void;
}

export interface FloatHandle {
  win: Window;
  root: HTMLElement;
}

const NAME_KEY = 'polyglot-float-id';
const BASE_CSS = 'html, body { margin: 0; height: 100%; overflow: hidden; background: #141418; color-scheme: dark; }\n';

/** The window's name: one per tab, the same after a reload. */
function windowName(): string {
  let id = 'tab';
  try {
    id = sessionStorage.getItem(NAME_KEY) ?? '';
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(NAME_KEY, id);
    }
  } catch {
    // Storage blocked: one shared name still works for a single Netflix tab.
  }
  return `polyglot-float-${id}`;
}

/**
 * Open the window, or take back the one this tab already has (after a reload). Opening a new one works only while
 * handling a click or key press; null when the popup blocker stopped it.
 */
export function openFloatWindow(o: FloatWindowOptions): FloatHandle | null {
  const width = Math.min(screen.availWidth, 520);
  const height = Math.min(screen.availHeight, 820);
  const win = window.open('', windowName(), `popup,width=${width},height=${height}`);
  if (!win) return null;
  // A window taken back still holds the old page's UI, whose code is gone with that page.
  const doc = win.document;
  doc.head.replaceChildren();
  doc.body.replaceChildren();
  doc.title = 'Polyglot Player';
  const style = doc.createElement('style');
  style.textContent = BASE_CSS + o.css;
  doc.head.append(style);
  const root = doc.createElement('div');
  root.className = 'plg-root float';
  doc.body.append(root);
  win.addEventListener('keydown', o.onKeyDown, true);
  win.addEventListener('keyup', o.onKeyUp, true);
  win.addEventListener('pagehide', () => o.onClose(root), { once: true });
  return { win, root };
}

/** While the page reloads, the window's UI stops working; say so until the new page takes the window back. */
export function showReloadNote(h: FloatHandle): void {
  const note = h.win.document.createElement('div');
  note.className = 'float-empty';
  note.textContent = 'Netflix is reloading. This window reconnects when the page is back (close it if you left Netflix).';
  h.root.replaceChildren(note);
}
