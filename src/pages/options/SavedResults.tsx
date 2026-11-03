import { useEffect, useState } from 'preact/hooks';
import type { SavedAnalyses, SavedAnalysis } from '../../core/analyses';
import { languageName } from '../../core/langs';
import { send } from '../../core/messages';
import { netflixLink } from '../../words/export';

const KIND_LABEL = { keylines: '🎤 Key lines', summary: '📖 Summary' } as const;

const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Saved key lines and summaries, one table row each and grouped by episode, newest first. */
export function SavedResults() {
  const [data, setData] = useState<SavedAnalyses | null>(null);
  const [error, setError] = useState('');

  const run = (p: Promise<unknown>) =>
    p
      .then(() => send('listAnalyses', {}))
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => void run(Promise.resolve()), []);

  if (!data) return error ? <div class="error">{error}</div> : null;

  const episodes = new Map<string, SavedAnalysis[]>();
  for (const r of [...data.items].sort((a, b) => b.createdAt - a.createdAt)) {
    const list = episodes.get(r.videoId);
    if (list) list.push(r);
    else episodes.set(r.videoId, [r]);
  }
  const total = data.items.reduce((sum, r) => sum + r.bytes, 0);
  const deleteAll = () => {
    const n = data.items.length + data.unlinked;
    if (confirm(`Delete all ${n} saved key lines and summaries? Making them again uses your Claude plan or OpenAI credits.`)) {
      void run(send('deleteAnalyses', { all: true }));
    }
  };

  return (
    <>
      <div class="row">
        <h3>Saved results</h3>
        <span class="muted small">
          {data.items.length} for {episodes.size} episodes · {fmtBytes(total)}
        </span>
        <span class="spacer" />
        <button disabled={!data.items.length && !data.unlinked} onClick={deleteAll}>
          Delete all
        </button>
      </div>
      {error && <div class="error">{error}</div>}
      {data.items.length ? (
        <table class="words">
          <thead>
            <tr>
              <th>Episode</th>
              <th>Result</th>
              <th>Language</th>
              <th>Model · level</th>
              <th>Made</th>
              <th>Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...episodes.values()].flatMap((rows) =>
              rows.map((r, i) => (
                <tr key={r.key}>
                  {i === 0 && (
                    <td rowSpan={rows.length}>
                      <a href={netflixLink(r.videoId)} target="_blank" rel="noreferrer">
                        {rows.find((x) => x.title)?.title ?? `Netflix ${r.videoId}`}
                      </a>
                    </td>
                  )}
                  <td>{KIND_LABEL[r.kind]}</td>
                  <td>{languageName(r.lang)}</td>
                  <td>
                    {r.model} · {r.level}
                  </td>
                  <td title={new Date(r.createdAt).toLocaleString()}>{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td title={`${r.sentences} sentences`}>{fmtBytes(r.bytes)}</td>
                  <td>
                    <button title="Delete" onClick={() => void run(send('deleteAnalyses', { keys: [r.key] }))}>
                      ✕
                    </button>
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      ) : (
        <div class="card muted">No saved key lines or summaries yet.</div>
      )}
      {data.unlinked > 0 && (
        <p class="muted small">
          Plus {data.unlinked} saved before results were kept per episode. Each one is listed here once you open its episode with
          the same model and level.
        </p>
      )}
    </>
  );
}
