import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useSettings } from '../../src/pages/hooks';
import { AnkiPanel } from '../../src/pages/options/AnkiPanel';
import { ClaudePanel } from '../../src/pages/options/ClaudePanel';
import { KeyLinesPanel } from '../../src/pages/options/KeyLinesPanel';
import { LibraryPanel } from '../../src/pages/options/LibraryPanel';
import { SentencesPanel } from '../../src/pages/options/SentencesPanel';
import { SettingsPanel } from '../../src/pages/options/SettingsPanel';
import { ShortcutsPanel } from '../../src/pages/options/ShortcutsPanel';
import { WordsPanel } from '../../src/pages/options/WordsPanel';
import '../../src/pages/pages.css';

const TABS = {
  words: 'Saved words',
  sentences: '⭐ Sentences',
  library: '🔎 Library',
  settings: 'Settings',
  shortcuts: 'Shortcuts',
  keylines: 'Key lines',
  claude: 'Claude',
  anki: 'Anki',
  help: 'How to use',
} as const;
type Tab = keyof typeof TABS;

function initialTab(): Tab {
  const h = location.hash.slice(1);
  return h in TABS ? (h as Tab) : 'words';
}

function Help() {
  return (
    <div class="stack">
      <h2>How to use</h2>
      <div class="card">
        <ol>
          <li>Open any title on Netflix. (If Netflix was already open when you installed this, reload the tab.)</li>
          <li>
            Choose the language you're learning in <b>Netflix's own subtitle menu</b>. That becomes the main line.
          </li>
          <li>
            Pick your language under <b>Translate to</b> in the sidebar. Netflix's human subtitles are used as the second line when
            they exist; otherwise the lines are machine-translated.
          </li>
          <li>Click a word for its meaning, drag across words (or Shift+click) for a phrase, and save it as Learning or Known.</li>
          <li>Use A / S / D to go back, repeat or skip lines, and Q to pause automatically after each line.</li>
          <li>
            Press <b>G</b> on a sentence you like to save it. Saved sentences come back for shadowing practice in the sidebar's ⭐
            Sentences tab (with the original voice) and on the practice page (with text-to-speech).
          </li>
          <li>
            Every episode you open is saved to your library. In the sidebar's <b>🔎 Find</b> tab, find a word (in all its forms), a
            phrase or a Korean line in all the shows you watched, then play the lines one by one or shadow them. Press <b>I</b> on a
            line for lines like it.
          </li>
          <li>Review saved words here, export them to CSV or send them to Anki.</li>
        </ol>
      </div>
      <p class="muted small">
        Polyglot Player is an independent study tool. It isn't affiliated with Netflix or Language Reactor.
      </p>
    </div>
  );
}

function Options() {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [s, update, loaded] = useSettings();

  useEffect(() => {
    history.replaceState(null, '', `#${tab}`);
  }, [tab]);

  return (
    <div class="options-page">
      <nav>
        <div class="brand">
          Polyglot <span>Player</span>
        </div>
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <button key={t} class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {TABS[t]}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'words' && <WordsPanel />}
        {loaded && tab === 'sentences' && <SentencesPanel s={s} update={update} />}
        {loaded && tab === 'library' && <LibraryPanel s={s} update={update} />}
        {loaded && tab === 'settings' && <SettingsPanel s={s} update={update} />}
        {loaded && tab === 'shortcuts' && <ShortcutsPanel s={s} update={update} />}
        {loaded && tab === 'keylines' && <KeyLinesPanel s={s} update={update} />}
        {loaded && tab === 'claude' && <ClaudePanel s={s} update={update} />}
        {loaded && tab === 'anki' && <AnkiPanel s={s} update={update} />}
        {tab === 'help' && <Help />}
      </main>
    </div>
  );
}

render(<Options />, document.getElementById('app')!);
