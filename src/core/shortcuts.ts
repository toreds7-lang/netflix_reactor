import type { ShortcutAction } from './settings';

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** Actions that need Alt held; every other action needs no modifier. */
export const ALT_ACTIONS: readonly ShortcutAction[] = ['toggleExtension'];

/** Physical key codes (KeyboardEvent.code) are used so shortcuts work on any keyboard layout. */
export function matchShortcut(e: KeyLike, map: Record<ShortcutAction, string>): ShortcutAction | null {
  if (e.ctrlKey || e.metaKey) return null;
  for (const [action, code] of Object.entries(map) as [ShortcutAction, string][]) {
    if (code && code === e.code && ALT_ACTIONS.includes(action) === e.altKey) return action;
  }
  return null;
}

/** Key label for the help list and Options: "Alt+L" for Alt actions, "Q" for the rest. */
export function describeShortcut(action: ShortcutAction, code: string): string {
  return ALT_ACTIONS.includes(action) && code ? `Alt+${describeKey(code)}` : describeKey(code);
}

export function describeKey(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = {
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Slash: '/ or ?',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
  };
  return names[code] ?? code;
}

/** True when the key event originates from a text field (including inside shadow roots). */
export function isTypingTarget(e: Event): boolean {
  const el = (e.composedPath?.()[0] ?? e.target) as HTMLElement | null;
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
