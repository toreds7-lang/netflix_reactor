import { useState } from 'preact/hooks';
import { send } from '../../core/messages';
import type { Settings } from '../../core/settings';

interface Props {
  s: Settings;
  update: (patch: Partial<Settings>) => void;
}

export function AnkiPanel({ s, update }: Props) {
  const [info, setInfo] = useState<{ version: number; decks: string[]; models: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = `chrome-extension://${chrome.runtime.id}`;

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = new URL(s.ankiUrl);
      const granted = await chrome.permissions.request({ origins: [`${url.protocol}//${url.hostname}:${url.port || 80}/*`] });
      if (!granted) throw new Error('Permission to talk to Anki was not granted.');
      setInfo(await send('ankiTest', {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="stack">
      <h2>Anki</h2>
      <p class="muted">
        Send saved words straight to Anki as flashcards (word, reading, the subtitle line with the word in bold, translation and a
        link back to the scene).
      </p>
      <div class="card">
        <h3 style={{ marginTop: 0 }}>Setup</h3>
        <ol>
          <li>
            In Anki, install the <b>AnkiConnect</b> add-on (Tools → Add-ons → Get Add-ons → code <code>2055492159</code>) and
            restart Anki.
          </li>
          <li>Keep Anki open, then click Connect below. Anki may ask whether to allow this extension; accept.</li>
          <li>
            If it still fails: in Anki open Tools → Add-ons → AnkiConnect → Config, add <code>{origin}</code> to{' '}
            <code>webCorsOriginList</code>, save and restart Anki.
          </li>
        </ol>
        <label class="setting">
          <span>AnkiConnect URL</span>
          <div class="row">
            <input type="url" value={s.ankiUrl} onChange={(e) => update({ ankiUrl: (e.target as HTMLInputElement).value })} />
            <button class="primary" onClick={() => void connect()} disabled={busy}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </label>
        <p class="muted small">Only port 8765 on 127.0.0.1 or localhost is allowed.</p>
        {error && <p class="error">{error}</p>}
        {info && <p class="ok">Connected to AnkiConnect v{info.version}.</p>}
      </div>

      <div class="card">
        <h3 style={{ marginTop: 0 }}>Cards</h3>
        <label class="setting">
          <span>Deck</span>
          {info ? (
            <select value={s.ankiDeck} onChange={(e) => update({ ankiDeck: (e.target as HTMLSelectElement).value })}>
              {[...new Set([s.ankiDeck, ...info.decks])].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          ) : (
            <input type="text" value={s.ankiDeck} onChange={(e) => update({ ankiDeck: (e.target as HTMLInputElement).value })} />
          )}
        </label>
        <label class="setting">
          <span>Note type</span>
          {info ? (
            <select value={s.ankiModel} onChange={(e) => update({ ankiModel: (e.target as HTMLSelectElement).value })}>
              {[...new Set([s.ankiModel, ...info.models])].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input type="text" value={s.ankiModel} onChange={(e) => update({ ankiModel: (e.target as HTMLInputElement).value })} />
          )}
        </label>
        <p class="muted small">
          The first field of the note type gets the front (word + sentence), the second field the back (meaning + translation + link).
          The deck is created if it doesn't exist. Send words from the Words page.
        </p>
      </div>
    </div>
  );
}
