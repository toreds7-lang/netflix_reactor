import { useEffect, useRef, useState } from 'preact/hooks';
import type { LibraryListItem, MeaningStatus } from '../../core/library';
import { languageName } from '../../core/langs';
import { send } from '../../core/messages';
import type { BackupStatus } from '../../core/types';
import type { Settings } from '../../core/settings';
import { describeKey } from '../../core/shortcuts';
import { netflixLink } from '../../words/export';
import { download } from '../hooks';
import { Toggle } from './SettingsPanel';

interface Props {
  s: Settings;
  update: (patch: Partial<Settings>) => void;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The sentence model for same-meaning search: how far it has read the library, and a button to read the rest now. */
function MeaningCard({ s, update }: Props) {
  const [status, setStatus] = useState<MeaningStatus | null>(null);
  const [error, setError] = useState('');
  const load = (build = false) =>
    send('libraryMeaningStatus', { build })
      .then((st) => {
        setStatus(st);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => void load(), [s.findMeaning]);
  // While it works, show its progress.
  useEffect(() => {
    if (status?.state !== 'working') return;
    const t = setTimeout(() => void load(), 2000);
    return () => clearTimeout(t);
  }, [status]);
  const left = status ? status.total - status.indexed : 0;
  return (
    <div class="card">
      <h3 style={{ marginTop: 0 }}>Same meaning, other words</h3>
      <p class="muted small">
        A small sentence model (all-MiniLM-L6-v2, about 23 MB, downloaded once from Hugging Face) reads each saved English episode
        once on your computer, so 🔎 can also find lines that mean the same in other words: “I'm starving” finds “I'm so hungry”, and
        a Korean search finds the English lines with that meaning. It costs nothing and sends no sentences anywhere.
      </p>
      <Toggle s={s} update={update} k="findMeaning" label="Find lines with the same meaning" />
      {error && <div class="error small">{error}</div>}
      {status && status.state !== 'off' && (
        <div class="row">
          <span class="small">
            {status.state === 'working'
              ? status.progress != null && status.progress < 1
                ? `Downloading the model… ${pct(status.progress)}`
                : `Reading episodes… ${status.indexed} of ${status.total}`
              : `${status.indexed} of ${status.total} English episodes ready`}
          </span>
          {status.state !== 'working' && left > 0 && (
            <button onClick={() => void load(true).then(() => setTimeout(() => void load(), 1000))}>Read the other {left} now</button>
          )}
          {status.state === 'error' && <span class="error small">{status.error}</span>}
        </div>
      )}
    </div>
  );
}

/** Writing polyglot-library.json through the native helper. */
function BackupCard({ s }: Props) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void chrome.storage.local.get('libraryBackupStatus').then((got) => setStatus((got.libraryBackupStatus as BackupStatus | undefined) ?? null));
  }, []);
  const run = async () => {
    setBusy(true);
    try {
      setStatus(await send('libraryBackupNow', {}));
    } catch {
      // Shown by the status line.
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="card">
      <h3 style={{ marginTop: 0 }}>Backup file</h3>
      <p class="muted small">
        Netflix may not serve an old episode's subtitles again, so the library is backed up too: with the Claude Code helper
        installed (<code>npm run claude:install</code>), <code>polyglot-library.json</code> is written to your backup folder (
        {s.backupDir.trim() || 'Polyglot Player in your Documents folder'}, set in ⭐ Sentences) a few minutes after new episodes are saved and
        once a day, plus one file per day, of which the last 3 are kept. {s.autoBackup ? '' : 'Automatic backups are off (⭐ Sentences).'} To
        restore it, use <b>Import</b> below.
      </p>
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

/** 🔎 The library: every episode you opened, saved for Find. */
export function LibraryPanel({ s, update }: Props) {
  const [items, setItems] = useState<LibraryListItem[] | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = (p: Promise<unknown> = Promise.resolve()) =>
    p
      .then(() => send('libraryList', {}))
      .then((list) => {
        setItems(list);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => void refresh(), []);

  const sentences = items?.reduce((n, x) => n + x.sentences, 0) ?? 0;
  const deleteAll = () => {
    if (confirm(`Delete all ${items?.length ?? 0} saved episodes from the library? Episodes you open again are saved again.`)) {
      void refresh(send('libraryDelete', { all: true }));
    }
  };
  const exportFile = async () => {
    try {
      download(`polyglot-library-${new Date().toISOString().slice(0, 10)}.json`, await send('libraryExport', {}), 'application/json');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const importFile = (file: File | undefined) => {
    if (!file) return;
    void file
      .text()
      .then((json) => send('libraryImport', { json }))
      .then((n) => {
        setNote(`Imported ${n} ${n === 1 ? 'episode' : 'episodes'}.`);
        return refresh();
      })
      .catch((e: Error) => setError(e.message));
  };

  return (
    <div class="stack">
      <div class="row">
        <h2>🔎 Library</h2>
        {items && (
          <span class="muted">
            {items.length} {items.length === 1 ? 'episode' : 'episodes'} · {sentences} sentences
          </span>
        )}
        <span class="spacer" />
        <button onClick={() => void exportFile()} disabled={!items?.length}>
          Export
        </button>
        <button title="Add the episodes of a library file (polyglot-library.json)" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            importFile((e.target as HTMLInputElement).files?.[0]);
            (e.target as HTMLInputElement).value = '';
          }}
        />
        <button onClick={deleteAll} disabled={!items?.length}>
          Delete all
        </button>
      </div>
      <p class="muted small">
        Every episode you open on Netflix is saved here: its sentences, their translation line and the parts you played. In the
        sidebar's <b>🔎 Find</b> tab you can then look up a word (in all its forms), a phrase, a pattern like <i>I can't * believe</i>{' '}
        or a Korean line across all of them, and hear what you find with the real voice. Click a word and choose <b>🔎 In my shows</b>,
        or press <b>{describeKey(s.shortcuts.findLine)}</b> for lines like the one you are on. Only you can see the library; it stays
        in this browser.
      </p>
      <div class="card">
        <Toggle
          s={s}
          update={update}
          k="librarySave"
          label="Save the episodes I open"
          hint="Off: nothing new is saved, and the parts you play aren't noted. What is saved stays searchable."
        />
      </div>
      <MeaningCard s={s} update={update} />
      <BackupCard s={s} update={update} />
      {error && <div class="error">{error}</div>}
      {note && <div class="ok small">{note}</div>}
      {items && items.length > 0 && (
        <table class="words">
          <thead>
            <tr>
              <th>Show</th>
              <th>Episode</th>
              <th>Language</th>
              <th>Sentences</th>
              <th>Watched</th>
              <th>Translation</th>
              <th>Same meaning</th>
              <th>Saved</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.key}>
                <td>
                  <a href={netflixLink(x.videoId)} target="_blank" rel="noreferrer">
                    {x.show ?? `Netflix ${x.videoId}`}
                  </a>
                </td>
                <td>{x.episode ?? ''}</td>
                <td>{languageName(x.lang)}</td>
                <td>{x.sentences}</td>
                <td>{pct(x.watched)}</td>
                <td>{x.trLang ? `${languageName(x.trLang)} (${x.trKind === 'human' ? 'Netflix' : 'machine'})` : '—'}</td>
                <td>{x.meaning ? '✓' : '—'}</td>
                <td title={new Date(x.updatedAt).toLocaleString()}>{new Date(x.savedAt).toLocaleDateString()}</td>
                <td>
                  <button title="Delete this episode from the library" onClick={() => void refresh(send('libraryDelete', { keys: [x.key] }))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {items && !items.length && <div class="card muted">No episodes saved yet. Open one on Netflix and play it a little.</div>}
    </div>
  );
}
