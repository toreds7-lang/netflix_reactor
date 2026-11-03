import { useState } from 'preact/hooks';
import { send } from '../../core/messages';
import type { CefrLevel } from '../../core/keylines';
import { CEFR_LEVELS, CLAUDE_CODE_MODELS, type ClaudeCodeModel, type KeyLinesProvider, type Settings } from '../../core/settings';
import type { ClaudeCodeStatus } from '../../core/types';
import { SavedResults } from './SavedResults';

interface Props {
  s: Settings;
  update: (patch: Partial<Settings>) => void;
}

export function KeyLinesPanel({ s, update }: Props) {
  const [test, setTest] = useState<{ loading?: boolean; status?: ClaudeCodeStatus; error?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const install = `npm run claude:install -- ${chrome.runtime.id}`;

  const copy = () => {
    void navigator.clipboard.writeText(install).then(() => setCopied(true));
  };

  const runTest = () => {
    setTest({ loading: true });
    send('claudeCodeStatus', {})
      .then((status) => setTest({ status }))
      .catch((e: Error) => setTest({ error: e.message }));
  };

  const st = test?.status;
  return (
    <div class="stack">
      <h2>Key lines</h2>
      <p class="muted">
        <b>✨ Find key lines</b> in the sidebar sends an episode's sentences once and marks the best ones for <b>🎤 shadowing</b>{' '}
        and the ones you need to follow the <b>📖 story</b>. Results are saved per episode, model and level, so reopening an
        episode is free. After you change the model or level, an episode shows its earlier result until you click{' '}
        <b>✨ Update</b>; <b>↻</b> makes a result again.
      </p>
      <p class="muted">
        <b>✨ Summarize episode</b> in the sidebar's Summary tab uses the same level and provider. It writes a scene-by-scene
        summary in the language you're learning, and each scene links to the lines it is based on.
      </p>
      <p class="muted">
        The sidebar's <b>💬 Chat</b> tab uses them too. Each question sends the whole episode with the chat so far, and the
        answer comes in the language you wrote in.
      </p>

      <div class="card">
        <label class="setting">
          <span>Your level</span>
          <select value={s.learnerLevel} onChange={(e) => update({ learnerLevel: (e.target as HTMLSelectElement).value as CefrLevel })}>
            {CEFR_LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <p class="muted small">
          In the language you're learning. 🎤 picks are pitched just above it: short, simple sentences at A1–A2, longer and more
          idiomatic ones at C1–C2. Results are saved per level; after changing it, click ✨ Update in the sidebar.
        </p>
        <label class="setting">
          <span>Provider</span>
          <select
            value={s.keyLinesProvider}
            onChange={(e) => update({ keyLinesProvider: (e.target as HTMLSelectElement).value as KeyLinesProvider })}
          >
            <option value="claude-code">Claude Code (your Claude subscription)</option>
            <option value="openai">OpenAI (API key from .env)</option>
          </select>
        </label>

        {s.keyLinesProvider === 'claude-code' ? (
          <>
            <label class="setting">
              <span>Model</span>
              <select
                value={s.claudeCodeModel}
                onChange={(e) => update({ claudeCodeModel: (e.target as HTMLSelectElement).value as ClaudeCodeModel })}
              >
                {CLAUDE_CODE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <h3>Setup (once)</h3>
            <ol>
              <li>
                Install Claude Code, run <code>claude</code> in a terminal and sign in with <code>/login</code> using your Claude
                account.
              </li>
              <li>
                In this project's folder, run:
                <div class="row" style={{ marginTop: '6px' }}>
                  <code>{install}</code>
                  <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
                </div>
                This registers a small helper with Chrome. Chrome starts it when you click Find key lines, so no terminal has to
                stay open.
              </li>
              <li>Click Test.</li>
            </ol>
            <div class="row">
              <button class="primary" onClick={runTest} disabled={test?.loading}>
                {test?.loading ? 'Testing…' : 'Test'}
              </button>
              {test?.error && <span class="error">{test.error}</span>}
              {st && st.loggedIn && (
                <span class="ok">
                  Claude Code {st.version.replace(/\s*\(Claude Code\)/, '')} is signed in
                  {st.authMethod === 'claude.ai' ? ` with your Claude subscription${st.subscription ? ` (${st.subscription})` : ''}` : ` (${st.authMethod})`}.
                </span>
              )}
              {st && !st.loggedIn && (
                <span class="error">Claude Code {st.version} is installed but not signed in. Run claude, then /login.</span>
              )}
            </div>
            <p class="muted small">
              Each analysis counts toward your Claude plan's usage limits; it isn't billed per token. The helper ignores any
              ANTHROPIC_API_KEY in your environment and runs Claude Code with no tools, so it can only read the subtitle text it is
              sent. A full episode takes about 10 seconds with Opus 5.5.
            </p>
          </>
        ) : (
          <p class="muted small">
            Put <code>OPENAI_API_KEY=…</code> and optionally <code>LLM_MODEL=gpt-4o-mini</code> in <code>.env</code>, then run{' '}
            <code>npm run build</code>. The key is baked into the build, so don't share <code>.output/</code> or a zip built with it.
          </p>
        )}
      </div>

      <SavedResults />
    </div>
  );
}
