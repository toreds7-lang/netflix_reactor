import { useMemo, useRef, useState } from 'preact/hooks';
import { languageName } from '../../core/langs';
import { send } from '../../core/messages';
import type { SavedWord, WordLevel } from '../../core/types';
import { formatTime, netflixLink, parseBackup, toBackup, toCsv } from '../../words/export';
import { getAllSentences, importSentences } from '../../sentences/store';
import { deleteWords, importWords, updateWord } from '../../words/store';
import { download, useWords } from '../hooks';

export function WordsPanel() {
  const all = Object.values(useWords()) as SavedWord[];
  const [query, setQuery] = useState('');
  const [lang, setLang] = useState('all');
  const [level, setLevel] = useState<'all' | WordLevel>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const langs = useMemo(() => [...new Set(all.map((w) => w.key.split(':')[0]))].sort(), [all]);
  const q = query.trim().toLowerCase();
  const list = all
    .filter((w) => lang === 'all' || w.key.startsWith(`${lang}:`))
    .filter((w) => level === 'all' || w.level === level)
    .filter(
      (w) =>
        !q ||
        w.word.toLowerCase().includes(q) ||
        (w.translation ?? '').toLowerCase().includes(q) ||
        (w.sentence ?? '').toLowerCase().includes(q),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const chosen = list.filter((w) => selected.has(w.key));
  const target = chosen.length ? chosen : list;
  const allChecked = list.length > 0 && list.every((w) => selected.has(w.key));

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const stamp = new Date().toISOString().slice(0, 10);

  const sendToAnki = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { results, errors } = await send('ankiAdd', { words: target });
      let added = 0;
      for (let i = 0; i < target.length; i++) {
        if (results[i] != null) {
          added++;
          await updateWord(target[i].key, { ankiNoteId: results[i]! });
        }
      }
      const failed = errors.filter(Boolean);
      setMessage({
        ok: failed.length === 0,
        text: `Added ${added} of ${target.length} notes to Anki.${failed.length ? ` First error: ${failed[0]}` : ''}`,
      });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const onImport = async (file: File) => {
    try {
      const { words, analyses, sentences } = parseBackup(await file.text());
      await importWords(words);
      let text = `Imported ${words.length} words`;
      if (sentences.length) {
        const stored = await importSentences(sentences);
        text += `, ${stored} ⭐ sentences${stored < sentences.length ? ` (${sentences.length - stored} skipped: yours were newer or unreadable)` : ''}`;
      }
      if (analyses.length) {
        const stored = await send('importAnalyses', { records: analyses });
        const skipped = analyses.length - stored;
        text += ` and ${stored} saved key lines and summaries${skipped ? ` (${skipped} skipped: older than yours or unreadable)` : ''}`;
      }
      setMessage({ ok: true, text: `${text}.` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  /** Words, ⭐ sentences and every saved key-lines and summary result. */
  const backup = async () => {
    try {
      const analyses = await send('exportAnalyses', {});
      const sentences = Object.values(await getAllSentences());
      download(`polyglot-backup-${stamp}.json`, toBackup(all, analyses, sentences), 'application/json');
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div class="stack">
      <div class="row">
        <h2>Saved words</h2>
        <span class="muted">{all.length} total</span>
      </div>

      <div class="row">
        <input type="search" placeholder="Search words, translations, sentences" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} style={{ minWidth: '280px' }} />
        <select value={lang} onChange={(e) => setLang((e.target as HTMLSelectElement).value)}>
          <option value="all">All languages</option>
          {langs.map((l) => (
            <option key={l} value={l}>
              {languageName(l)}
            </option>
          ))}
        </select>
        <select value={level} onChange={(e) => setLevel((e.target as HTMLSelectElement).value as 'all' | WordLevel)}>
          <option value="all">All levels</option>
          <option value="learning">Learning</option>
          <option value="known">Known</option>
        </select>
      </div>

      <div class="row">
        <span class="muted small">{chosen.length ? `${chosen.length} selected` : `Actions apply to the ${list.length} shown`}</span>
        <span class="spacer" />
        <button onClick={() => download(`polyglot-words-${stamp}.csv`, toCsv(target), 'text/csv;charset=utf-8')} disabled={!target.length}>
          Export CSV
        </button>
        <button onClick={() => void backup()} title="All saved words, ⭐ sentences, key lines and episode summaries">
          Backup JSON
        </button>
        <button onClick={() => fileRef.current?.click()}>Import JSON</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) void onImport(f);
            (e.target as HTMLInputElement).value = '';
          }}
        />
        <button class="primary" onClick={() => void sendToAnki()} disabled={!target.length || busy}>
          {busy ? 'Sending…' : 'Send to Anki'}
        </button>
        <button
          disabled={!chosen.length}
          onClick={() => {
            if (confirm(`Delete ${chosen.length} words?`)) {
              void deleteWords(chosen.map((w) => w.key));
              setSelected(new Set());
            }
          }}
        >
          Delete
        </button>
      </div>

      {message && <div class={message.ok ? 'ok' : 'error'}>{message.text}</div>}

      {list.length ? (
        <table class="words">
          <thead>
            <tr>
              <th style={{ width: '28px' }}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() => setSelected(allChecked ? new Set() : new Set(list.map((w) => w.key)))}
                />
              </th>
              <th>Word</th>
              <th>Translation</th>
              <th>Context</th>
              <th>Level</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((w) => (
              <tr key={w.key}>
                <td>
                  <input type="checkbox" checked={selected.has(w.key)} onChange={() => toggle(w.key)} />
                </td>
                <td class="word">
                  <b lang={w.lang}>{w.word}</b>
                  {w.reading ? <div class="muted small">{w.reading}</div> : null}
                  {w.lemma && w.lemma !== w.word ? <div class="muted small">↳ {w.lemma}</div> : null}
                </td>
                <td>
                  <input
                    class="inline"
                    value={w.translation ?? ''}
                    onChange={(e) => void updateWord(w.key, { translation: (e.target as HTMLInputElement).value })}
                  />
                </td>
                <td>
                  <div class="sentence" lang={w.lang}>
                    {w.sentence}
                  </div>
                  {w.videoId ? (
                    <a class="small" href={netflixLink(w.videoId, w.timeMs)} target="_blank" rel="noreferrer">
                      {w.title ?? 'Netflix'} {formatTime(w.timeMs)}
                    </a>
                  ) : null}
                </td>
                <td>
                  <button
                    class={`level ${w.level}`}
                    title="Toggle level"
                    onClick={() => void updateWord(w.key, { level: w.level === 'learning' ? 'known' : 'learning' })}
                  >
                    {w.level}
                  </button>
                  {w.ankiNoteId ? <div class="small ok">in Anki</div> : null}
                </td>
                <td>
                  <button title="Delete" onClick={() => void deleteWords([w.key])}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div class="card muted">
          {all.length ? 'No words match the filters.' : 'No saved words yet. On Netflix, click any subtitle word and choose “Learning”.'}
        </div>
      )}
    </div>
  );
}
