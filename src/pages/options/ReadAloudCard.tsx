import { useEffect, useRef, useState } from 'preact/hooks';
import { readWithKokoro, type Reader } from '../../app/reader';
import { KOKORO_VOICES, READ_RATES, type KokoroDevice, type KokoroVoice } from '../../core/readaloud';
import type { Settings } from '../../core/settings';

interface Props {
  s: Settings;
  update: (patch: Partial<Settings>) => void;
}

const SAMPLE = 'Hi! I will read your episode summaries aloud. Each sentence is highlighted while I read it.';

/** Voice, speed and engine for reading summaries aloud, with a sample that also downloads the model ahead of time. */
export function ReadAloudCard({ s, update }: Props) {
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'playing'; progress?: number | null; error?: string }>({
    status: 'idle',
  });
  const reader = useRef<Reader | null>(null);
  useEffect(() => () => reader.current?.stop(), []);

  const stop = () => {
    reader.current?.stop();
    reader.current = null;
    setState({ status: 'idle' });
  };

  const tryVoice = async () => {
    stop();
    setState({ status: 'loading', progress: null });
    try {
      reader.current = await readWithKokoro(
        [SAMPLE],
        { voice: s.readAloudVoice, rate: s.readAloudRate, device: s.kokoroDevice },
        {
          onItem: () => setState({ status: 'playing' }),
          onLoading: (progress) => setState({ status: 'loading', progress }),
          onDone: () => setState({ status: 'idle' }),
          onError: (error) => setState({ status: 'idle', error }),
        },
      );
    } catch (e) {
      setState({ status: 'idle', error: e instanceof Error ? e.message : String(e) });
    }
  };

  const pct = state.progress == null ? '' : ` ${Math.round(state.progress * 100)}%`;
  return (
    <div class="card">
      <h3 style={{ marginTop: 0 }}>Read summaries aloud</h3>
      <p class="muted small">
        🔊 in the sidebar's Summary tab reads the summary and highlights each sentence. English summaries use{' '}
        <b>Kokoro</b>, a neural voice that runs on your computer. The model (326 MB) downloads once from Hugging Face, and
        each sentence's audio is cached, so replaying it is instant. Summaries in other languages use your browser's voice for
        that language.
      </p>
      <label class="setting">
        <span>Voice (American English, female)</span>
        <select value={s.readAloudVoice} onChange={(e) => update({ readAloudVoice: (e.target as HTMLSelectElement).value as KokoroVoice })}>
          {KOKORO_VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <label class="setting">
        <span>Speed</span>
        <select value={String(s.readAloudRate)} onChange={(e) => update({ readAloudRate: parseFloat((e.target as HTMLSelectElement).value) })}>
          {READ_RATES.map((r) => (
            <option key={r} value={String(r)}>
              {r}×
            </option>
          ))}
        </select>
      </label>
      <label class="setting">
        <span>Run Kokoro on</span>
        <select value={s.kokoroDevice} onChange={(e) => update({ kokoroDevice: (e.target as HTMLSelectElement).value as KokoroDevice })}>
          <option value="auto">Automatic (graphics card when available)</option>
          <option value="webgpu">Graphics card (WebGPU)</option>
          <option value="wasm">Processor (WebAssembly)</option>
        </select>
      </label>
      <div class="row">
        {state.status === 'idle' ? (
          <button onClick={() => void tryVoice()}>▶ Try this voice</button>
        ) : (
          <button onClick={stop}>■ Stop</button>
        )}
        {state.status === 'loading' && <span class="muted small">Loading the voice model…{pct}</span>}
        {state.error && <span class="error small">{state.error}</span>}
      </div>
    </div>
  );
}
