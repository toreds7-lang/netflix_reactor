import { useMemo, useState } from 'preact/hooks';
import { languageName } from '../../core/langs';
import { send } from '../../core/messages';
import { drillSteps, drillStepInfo, dueSentences, isDue, isNew, reviewLabel } from '../../core/sentences';
import type { Settings } from '../../core/settings';
import { describeKey } from '../../core/shortcuts';
import type { SavedSentence } from '../../core/types';
import { deleteSentences, updateSentence } from '../../sentences/store';
import { formatTime, netflixLink, sentencesToCsv } from '../../words/export';
import { download, openPracticePage, useBackupStatus, useSentences } from '../hooks';
import { Range, Toggle } from './SettingsPanel';

interface Props {
  s: Settings;
  update: (patch: Partial<Settings>) => void;
}

/** How many passes of each kind a drill plays, and the warm-up offer on Netflix. */
function PracticeCard({ s, update }: Props) {
  const steps = drillSteps(s);
  return (
    <div class="card">
      <h3 style={{ marginTop: 0 }}>Practice drill</h3>
      <p class="muted small">
        Practising a sentence plays it several times, on Netflix with the original voice or on the practice page with
        text-to-speech: first you listen with the text hidden, then you shadow it (speak along with the voice) reading the text,
        then you shadow it from memory. Then rate how well you could say it, and the sentence comes back sooner or later: “Good”
        brings it back after 1, 3, 7, 16, 37… days, “Again” in 10 minutes.
      </p>
      <Range label="👂 Listen (text hidden)" value={s.drillListen} min={0} max={4} step={1} unit="×" onInput={(v) => update({ drillListen: v })} />
      <Range label="📖 Shadow with the text" value={s.drillWithText} min={0} max={4} step={1} unit="×" onInput={(v) => update({ drillWithText: v })} />
      <Range label="🙈 Shadow from memory" value={s.drillBlind} min={0} max={4} step={1} unit="×" onInput={(v) => update({ drillBlind: v })} />
      <p class="muted small">
        Each drill: {steps.map((st) => drillStepInfo(st).icon).join(' ')} ({steps.length} {steps.length === 1 ? 'pass' : 'passes'}).
        Turn on 🗣 Gap in the practice bar to get a pause after each pass, as long as the sentence, to say it back.
      </p>
      <Toggle
        s={s}
        update={update}
        k="warmup"
        label="Offer a warm-up on Netflix"
        hint="When you open an episode and saved sentences are due, a banner offers to practise them first."
      />
    </div>
  );
}

/** Backup files written through the native helper after every change. */
function BackupCard({ s, update }: Props) {
  const status = useBackupStatus();
  const [busy, setBusy] = useState(false);
  const [dir, setDir] = useState(s.backupDir);
  const run = async () => {
    setBusy(true);
    try {
      await send('backupNow', {});
    } catch {
      // The status line below shows what went wrong.
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="card">
      <h3 style={{ marginTop: 0 }}>Backup files</h3>
      <p class="muted small">
        Removing or reinstalling the extension deletes everything it saved. With the Claude Code helper installed (the one Key lines
        uses, <code>npm run claude:install</code>), your sentences, words and saved key lines and summaries are written to a file a
        minute after every change, and twice a day: <code>polyglot-backup-latest.json</code> plus one file per day, of which the last
        30 are kept. To restore one, use <b>Import JSON</b> in Saved words.
      </p>
      <Toggle s={s} update={update} k="autoBackup" label="Write backup files automatically" />
      <label class="setting">
        <span>Folder</span>
        <input
          type="text"
          placeholder="Polyglot Player in your Documents folder"
          value={dir}
          onInput={(e) => setDir((e.target as HTMLInputElement).value)}
          onChange={() => update({ backupDir: dir.trim() })}
        />
      </label>
      <p class="muted small">A full path. A folder that OneDrive, Google Drive or Dropbox syncs keeps a copy off this computer too.</p>
      <div class="row">
        <button onClick={() => void run()} disabled={busy}>
          {busy ? 'Backing up…' : 'Back up now'}
        </button>
        {status && (
          <span class={`small ${status.ok ? 'ok' : 'error'}`}>
            {status.ok
              ? `Last backup ${new Date(status.at).toLocaleString()}: ${status.path}`
              : `Backup failed ${new Date(status.at).toLocaleString()}: ${status.error}`}
          </span>
        )}
      </div>
    </div>
  );
}

type Filter = 'all' | 'due' | 'new';

export function SentencesPanel({ s, update }: Props) {
  const [all] = useSentences();
  const list0 = Object.values(all) as SavedSentence[];
  const [query, setQuery] = useState('');
  const [lang, setLang] = useState('all');
  const [filter, setFilter] = useState<Filter>('all');
  const now = Date.now();
  const due = dueSentences(all, now).length;
  const langs = useMemo(() => [...new Set(list0.map((x) => x.lang.split('-')[0].toLowerCase()))].sort(), [list0]);
  const q = query.trim().toLowerCase();
  const list = list0
    .filter((x) => lang === 'all' || x.lang.split('-')[0].toLowerCase() === lang)
    .filter((x) => (filter === 'due' ? isDue(x, now) : filter === 'new' ? isNew(x) : true))
    .filter(
      (x) =>
        !q ||
        x.text.toLowerCase().includes(q) ||
        (x.translation ?? '').toLowerCase().includes(q) ||
        (x.note ?? '').toLowerCase().includes(q) ||
        (x.title ?? '').toLowerCase().includes(q),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  const stamp = new Date().toISOString().slice(0, 10);
  const key = describeKey(s.shortcuts.saveSentence);

  return (
    <div class="stack">
      <div class="row">
        <h2>Saved sentences</h2>
        <span class="muted">
          {list0.length} total · {due} due
        </span>
        <span class="spacer" />
        <button class="primary" onClick={() => void openPracticePage()} title="Practise with text-to-speech, without Netflix">
          ▶ Practise{due ? ` (${due} due)` : ''}
        </button>
      </div>
      <p class="muted small">
        On Netflix, press <b>{key}</b> or click ☆ on a line to save the sentence you're on (a sentence split over two subtitle lines is
        saved whole; to save other lines, loop them and click ☆ in the loop bar). Practise them in the sidebar's ⭐ Sentences tab with
        the original voice, or on the practice page with text-to-speech.
      </p>

      <div class="row">
        <input
          type="search"
          placeholder="Search sentences, translations, notes, titles"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          style={{ minWidth: '280px' }}
        />
        <select value={lang} onChange={(e) => setLang((e.target as HTMLSelectElement).value)}>
          <option value="all">All languages</option>
          {langs.map((l) => (
            <option key={l} value={l}>
              {languageName(l)}
            </option>
          ))}
        </select>
        <select value={filter} onChange={(e) => setFilter((e.target as HTMLSelectElement).value as Filter)}>
          <option value="all">All</option>
          <option value="due">Due now</option>
          <option value="new">Never practised</option>
        </select>
        <span class="spacer" />
        <button
          disabled={!list.length}
          onClick={() => download(`polyglot-sentences-${stamp}.csv`, sentencesToCsv(list), 'text/csv;charset=utf-8')}
        >
          Export CSV
        </button>
      </div>

      {list.length ? (
        <table class="words">
          <thead>
            <tr>
              <th>Sentence</th>
              <th>Episode</th>
              <th>Next practice</th>
              <th>Practised</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((x) => (
              <tr key={x.id}>
                <td>
                  <div class="sentence-text" lang={x.lang}>
                    {x.text}
                  </div>
                  <input
                    class="inline"
                    placeholder="Translation"
                    value={x.translation ?? ''}
                    onChange={(e) => void updateSentence(x.id, { translation: (e.target as HTMLInputElement).value })}
                  />
                  <input
                    class="inline"
                    placeholder="Note (where you'd use it, what it means…)"
                    value={x.note ?? ''}
                    onChange={(e) => void updateSentence(x.id, { note: (e.target as HTMLInputElement).value.trim() || undefined })}
                  />
                </td>
                <td>
                  <a class="small" href={netflixLink(x.videoId, x.startMs)} target="_blank" rel="noreferrer">
                    {x.title ?? 'Netflix'} {formatTime(x.startMs)}
                  </a>
                </td>
                <td class={isDue(x, now) ? 'due' : ''}>{reviewLabel(x, now)}</td>
                <td>{x.practiced || ''}</td>
                <td>
                  <button
                    title="Delete"
                    onClick={() => {
                      if (x.practiced === 0 || confirm(`Delete “${x.text}” and its practice history?`)) void deleteSentences([x.id]);
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div class="card muted">
          {list0.length ? 'No sentences match the filters.' : `No saved sentences yet. On Netflix, press ${key} on a line you like.`}
        </div>
      )}

      <PracticeCard s={s} update={update} />
      <BackupCard s={s} update={update} />
    </div>
  );
}
