import { useState } from 'preact/hooks';
import { send } from '../../core/messages';
import { CLAUDE_MODELS, type ClaudeModel, type Settings } from '../../core/settings';
import type { ExplainResult } from '../../core/types';

interface Props {
  s: Settings;
  update: (patch: Partial<Settings>) => void;
}

export function ClaudePanel({ s, update }: Props) {
  const [key, setKey] = useState(s.claudeApiKey);
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<{ loading?: boolean; result?: ExplainResult; error?: string } | null>(null);
  const dirty = key !== s.claudeApiKey;

  const save = async () => {
    // Asked from a click so Chrome shows the permission prompt.
    try {
      await chrome.permissions.request({ origins: ['https://api.anthropic.com/*'] });
    } catch {
      /* the API also allows browser CORS, so a declined prompt is not fatal */
    }
    update({ claudeApiKey: key.trim() });
  };

  const runTest = () => {
    setTest({ loading: true });
    send('explainWord', {
      text: 'break a leg',
      sentence: "Big night tonight. Break a leg!",
      from: 'en',
      to: s.nativeLang,
    })
      .then((result) => setTest({ result }))
      .catch((e: Error) => setTest({ error: e.message }));
  };

  return (
    <div class="stack">
      <h2>Claude explanations</h2>
      <p class="muted">
        Optional. With your own Claude API key, the word popup gets an <b>✨ Explain</b> button that tells you what a word means in
        <i> this exact line</i> (lemma, reading, grammar, idioms, examples), and each sidebar line can be broken down. Google Translate
        still handles line translations.
      </p>

      <div class="card">
        <label class="setting">
          <span>API key</span>
          <div class="row">
            <input
              type={show ? 'text' : 'password'}
              value={key}
              placeholder="sk-ant-…"
              onInput={(e) => setKey((e.target as HTMLInputElement).value)}
              style={{ flex: 1, minWidth: '280px' }}
              autocomplete="off"
            />
            <button onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
            <button class="primary" onClick={() => void save()} disabled={!dirty}>
              Save
            </button>
          </div>
        </label>
        <label class="setting">
          <span>Model</span>
          <select value={s.claudeModel} onChange={(e) => update({ claudeModel: (e.target as HTMLSelectElement).value as ClaudeModel })}>
            {CLAUDE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <p class="muted small">
          Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.
          The key is stored only in this browser's local extension storage (not synced) and is sent only to api.anthropic.com. Each
          explanation is a small paid API request, billed to your account; results are cached so repeat lookups are free. With Opus 5.5 or Opus 5,
          refused requests are automatically retried on a fallback model.
        </p>
        <div class="row">
          <button onClick={runTest} disabled={!s.claudeApiKey || test?.loading}>
            {test?.loading ? 'Testing…' : 'Test with “break a leg”'}
          </button>
          {test?.error && <span class="error">{test.error}</span>}
        </div>
        {test?.result && (
          <div class="card" style={{ marginTop: '10px' }}>
            <b>{test.result.lemma}</b> <span class="muted">{test.result.partOfSpeech}</span>
            <p>{test.result.meaningInContext}</p>
            {test.result.grammarNote && <p class="muted">{test.result.grammarNote}</p>}
            <div class="muted small">{test.result.model}</div>
          </div>
        )}
      </div>
    </div>
  );
}
