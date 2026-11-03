import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_SHORTCUTS, SHORTCUT_LABELS, type Settings, type ShortcutAction } from '../../core/settings';
import { ALT_ACTIONS, describeShortcut } from '../../core/shortcuts';

interface Props {
  s: Settings;
  update: (patch: Partial<Settings>) => void;
}

export function ShortcutsPanel({ s, update }: Props) {
  const [listening, setListening] = useState<ShortcutAction | null>(null);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code === 'Escape') {
        setListening(null);
        return;
      }
      const shortcuts = { ...s.shortcuts };
      // A key can only do one thing: unbind it elsewhere.
      // (Alt actions use a different modifier, so they never collide with plain keys.)
      for (const a of Object.keys(shortcuts) as ShortcutAction[]) {
        if (shortcuts[a] === e.code && ALT_ACTIONS.includes(a) === ALT_ACTIONS.includes(listening)) shortcuts[a] = '';
      }
      shortcuts[listening] = e.code;
      update({ shortcuts });
      setListening(null);
    };
    window.addEventListener('keydown', onKey, { once: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [listening, s.shortcuts]);

  return (
    <div class="stack">
      <h2>Keyboard shortcuts</h2>
      <p class="muted">
        Click a key, then press the new key (Esc cancels). Keys are matched by physical position, so they work with any keyboard
        layout. Avoid Space, F, M and the arrow keys, which Netflix uses.
      </p>
      <div class="card">
        {(Object.keys(SHORTCUT_LABELS) as ShortcutAction[]).map((a) => (
          <label class="setting" key={a}>
            <span>{SHORTCUT_LABELS[a]}</span>
            <div class="row">
              <button class={`keycap${listening === a ? ' listening' : ''}`} onClick={() => setListening(a)}>
                {listening === a ? 'Press a key…' : describeShortcut(a, s.shortcuts[a])}
              </button>
            </div>
          </label>
        ))}
      </div>
      <div class="row">
        <button onClick={() => update({ shortcuts: DEFAULT_SHORTCUTS })}>Reset to defaults</button>
      </div>
    </div>
  );
}
