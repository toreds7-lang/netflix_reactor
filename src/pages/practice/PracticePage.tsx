import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { readWithBrowserVoice, readWithKokoro, type ReaderEvents } from '../../app/reader';
import { baseLang, languageName } from '../../core/langs';
import { usesKokoro } from '../../core/readaloud';
import {
  drillStepInfo,
  drillSteps,
  GRADES,
  isDue,
  nextLabel,
  practiceQueue,
  reviewLabel,
  schedule,
  speechText,
  type Grade,
  type QueueMode,
} from '../../core/sentences';
import type { Settings } from '../../core/settings';
import type { PracticeSession, SavedSentence } from '../../core/types';
import { setPractice, updateSentence } from '../../sentences/store';
import { WATCH_PATH } from '../../sites/netflix/selectors';
import { formatTime, netflixLink } from '../../words/export';
import { useSentences, useSettings } from '../hooks';

/** Speeds offered for the voice. */
const RATES = [0.7, 0.85, 1, 1.15];
/** Between passes without the speaking gap. */
const PASS_PAUSE_MS = 700;
/** The speaking gap is at least this long. */
const MIN_GAP_MS = 1000;
/** After a rating, the next sentence starts by itself after this pause. */
const NEXT_DELAY_MS = 600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Speaking {
  /** Resolves with how long the speech played (ms), or -1 when stopped. */
  done: Promise<number>;
  stop(): void;
}

/** Say `text` once: Kokoro for English (as summaries are read), the browser's voice for other languages. */
async function speakOnce(
  text: string,
  lang: string,
  s: Settings,
  onLoading: (progress: number | null | undefined) => void,
): Promise<Speaking> {
  let finish!: (ms: number) => void;
  let fail!: (e: Error) => void;
  const done = new Promise<number>((res, rej) => {
    finish = res;
    fail = rej;
  });
  let started = 0;
  const events: ReaderEvents = {
    onItem: () => {
      started = performance.now();
      onLoading(undefined);
    },
    onLoading,
    onDone: () => finish(started ? performance.now() - started : 0),
    onError: (message) => fail(new Error(message)),
  };
  const reader = usesKokoro(lang)
    ? await readWithKokoro([text], { voice: s.readAloudVoice, rate: s.practiceRate, device: s.kokoroDevice }, events)
    : await readWithBrowserVoice([text], lang, s.practiceRate, events);
  return {
    done,
    stop: () => {
      reader.stop();
      finish(-1);
    },
  };
}

/** Hear the sentence with its original voice: the Netflix tab (or a new one) opens the episode and practises it. */
async function openOnNetflix(s: SavedSentence): Promise<void> {
  const session: PracticeSession = { ids: [s.id], index: 0, done: 0, at: Date.now() };
  await setPractice(session);
  const url = netflixLink(s.videoId, s.startMs);
  const [tab] = await chrome.tabs.query({ url: 'https://www.netflix.com/*' });
  if (tab?.id == null) {
    await chrome.tabs.create({ url });
    return;
  }
  // A tab already on this episode picks the session up without a reload.
  const there = !!tab.url && WATCH_PATH.exec(new URL(tab.url).pathname)?.[1] === s.videoId;
  await chrome.tabs.update(tab.id, there ? { active: true } : { url, active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

type Phase = 'ready' | 'playing' | 'rate';

export function PracticePage() {
  const [s, update, settingsLoaded] = useSettings();
  const [all, loaded] = useSentences();
  const [mode, setMode] = useState<QueueMode>('due');
  const [lang, setLang] = useState('all');
  const [queue, setQueue] = useState<string[] | null>(null);
  const [done, setDone] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [pass, setPass] = useState(0);
  const [gap, setGap] = useState(false);
  const [voice, setVoice] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showTrans, setShowTrans] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const gen = useRef(0);
  const speaking = useRef<Speaking | null>(null);
  /** Sentences already brought back once after "Again" in this session. */
  const requeued = useRef(new Set<string>());
  /** When the current sentence came up; a rating made on Netflix after that moves on. */
  const cardSince = useRef(Date.now());
  const settingsRef = useRef(s);
  settingsRef.current = s;

  const langs = useMemo(() => [...new Set(Object.values(all).map((x) => baseLang(x.lang)))].sort(), [all]);
  const steps = drillSteps(s);
  const current = queue?.length ? all[queue[0]] : undefined;
  const now = Date.now();

  // The queue is made once the sentences are read, and again when the language or the mode changes.
  const build = (m: QueueMode, l: string) => {
    stop();
    requeued.current.clear();
    setQueue(practiceQueue(all, m, l, Date.now()));
    setMode(m);
    setPass(0);
    setPhase('ready');
    cardSince.current = Date.now();
  };
  useEffect(() => {
    if (loaded && queue === null) build('due', lang);
  }, [loaded]);

  // Sentences deleted meanwhile drop out of the queue.
  useEffect(() => {
    if (queue && queue.some((id) => !all[id])) setQueue(queue.filter((id) => all[id]));
  }, [all]);

  function stop() {
    gen.current++;
    speaking.current?.stop();
    speaking.current = null;
    setGap(false);
    setVoice(undefined);
  }
  useEffect(() => () => stop(), []);

  /** Play the drill's passes from `from` on, then wait for a rating. */
  async function run(from: number) {
    const sentence = current;
    if (!sentence) return;
    stop();
    const my = gen.current;
    setError(null);
    for (let i = from; i < steps.length; i++) {
      setPass(i);
      setPhase('playing');
      setGap(false);
      let ms: number;
      try {
        const sp = await speakOnce(speechText(sentence.text), sentence.lang, settingsRef.current, (p) => my === gen.current && setVoice(p));
        if (my !== gen.current) {
          sp.stop();
          return;
        }
        speaking.current = sp;
        ms = await sp.done;
      } catch (e) {
        if (my !== gen.current) return;
        setError(errMsg(e));
        setPhase('ready');
        return;
      }
      if (my !== gen.current || ms < 0) return;
      speaking.current = null;
      const withGap = settingsRef.current.loopGap;
      if (withGap || i < steps.length - 1) {
        setGap(withGap);
        await sleep(withGap ? Math.max(MIN_GAP_MS, ms) : PASS_PAUSE_MS);
        if (my !== gen.current) return;
        setGap(false);
      }
    }
    setPhase('rate');
  }

  /** Move on from the current sentence; after "Again" it comes back once at the end. */
  function advance(id: string, again: boolean) {
    stop();
    const reAdd = again && !requeued.current.has(id);
    if (reAdd) requeued.current.add(id);
    setQueue((q) => (q ? [...q.slice(1), ...(reAdd ? [id] : [])] : q));
    setDone((d) => d + 1);
    setPass(0);
    setPhase('ready');
    cardSince.current = Date.now();
  }

  async function rate(g: Grade) {
    const sentence = current;
    if (!sentence) return;
    const srs = schedule(sentence.srs, g, Date.now());
    advance(sentence.id, g === 'again');
    setAutoStart(true);
    try {
      await updateSentence(sentence.id, { srs, practiced: (sentence.practiced ?? 0) + 1 });
    } catch (e) {
      setError(errMsg(e));
    }
  }

  // After a rating, the next sentence starts by itself (unless the queue is done or you started it already).
  useEffect(() => {
    if (!autoStart) return;
    if (!current || phase !== 'ready') {
      setAutoStart(false);
      return;
    }
    const t = setTimeout(() => {
      setAutoStart(false);
      void run(0);
    }, NEXT_DELAY_MS);
    return () => clearTimeout(t);
  }, [autoStart, current?.id]);

  // Rated on Netflix ("Original on Netflix"): move on here too.
  useEffect(() => {
    if (current?.srs.last && current.srs.last > cardSince.current) advance(current.id, false);
  }, [current?.srs.last]);

  // Space: start / stop · R: this pass again · →: next pass · 1-4: rate · T: translation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
      if (!current) return;
      const grade = GRADES.find((g) => e.code === `Digit${g.key}` || e.code === `Numpad${g.key}`);
      if (grade && phase === 'rate') void rate(grade.id);
      else if (e.code === 'Space') {
        if (phase === 'playing') {
          stop();
          setPhase('ready');
        } else void run(phase === 'rate' ? 0 : pass);
      } else if (e.code === 'KeyR') void run(Math.min(pass, steps.length - 1));
      else if (e.code === 'ArrowRight') {
        if (pass + 1 < steps.length) void run(pass + 1);
        else {
          stop();
          setPhase('rate');
        }
      } else if (e.code === 'KeyT') setShowTrans((v) => !v);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!loaded || !settingsLoaded) return <div class="practice-page" />;
  const total = Object.keys(all).length;
  const step = steps[Math.min(pass, steps.length - 1)];
  const hidden = phase !== 'rate' && step !== 'text';
  const left = queue?.length ?? 0;
  const dueCount = Object.values(all).filter((x) => (lang === 'all' || baseLang(x.lang) === lang) && isDue(x, now)).length;

  return (
    <div class="practice-page">
      <header class="pr-head">
        <div class="brand">
          Polyglot <span>Player</span> · ⭐ Practice
        </div>
        <span class="spacer" />
        {langs.length > 1 && (
          <select value={lang} onChange={(e) => (setLang((e.target as HTMLSelectElement).value), build(mode, (e.target as HTMLSelectElement).value))}>
            <option value="all">All languages</option>
            {langs.map((l) => (
              <option key={l} value={l}>
                {languageName(l)}
              </option>
            ))}
          </select>
        )}
        <span class="muted small">
          {left} left · {done} done
        </span>
        <a class="small" href={chrome.runtime.getURL('/options.html#sentences')} target="_blank" rel="noreferrer">
          All sentences
        </a>
      </header>

      {!total ? (
        <div class="card pr-empty">
          <h2>No saved sentences yet</h2>
          <p class="muted">
            On Netflix, press <b>G</b> (or click ☆ next to a line) to save a sentence you like. It shows up here to practise by
            shadowing.
          </p>
        </div>
      ) : !current ? (
        <div class="card pr-empty">
          <h2>{done ? `🎉 Done · ${done} practised` : mode === 'due' ? 'Nothing due right now ✓' : 'Nothing to practise here'}</h2>
          <p class="muted">
            {dueCount
              ? `${dueCount} ${dueCount === 1 ? 'sentence is' : 'sentences are'} due.`
              : 'Each sentence comes back when it is time to practise it again. You can still practise more now:'}
          </p>
          <div class="row">
            {dueCount > 0 && (
              <button class="primary" onClick={() => build('due', lang)}>
                Practise {dueCount} due
              </button>
            )}
            <button onClick={() => build('ahead', lang)}>Practise the next ones ahead</button>
            <button onClick={() => build('random', lang)}>10 at random</button>
          </div>
        </div>
      ) : (
        <div class="card pr-card">
          <div class="pr-meta small muted">
            <span>
              {current.title ?? 'Netflix'} · {formatTime(current.startMs)} · {reviewLabel(current, now)}
              {current.practiced ? ` · practised ${current.practiced}×` : ''}
            </span>
            <span class="spacer" />
            <button class="link" title="Hear it with the original voice: opens the episode on Netflix and practises it there" onClick={() => (stop(), void openOnNetflix(current))}>
              ▶ Original on Netflix
            </button>
          </div>

          <div class="pr-steps">
            {steps.map((st, i) => (
              <span
                key={i}
                class={`pr-dot${phase !== 'rate' && i === pass ? ' now' : i < pass || phase === 'rate' ? ' done' : ''}`}
                title={drillStepInfo(st).label}
              >
                {drillStepInfo(st).icon}
              </span>
            ))}
            <span class="pr-step-label">
              {phase === 'rate' ? (
                <b>Rate it</b>
              ) : (
                <>
                  <b>
                    {drillStepInfo(step).label} ({pass + 1}/{steps.length})
                  </b>{' '}
                  · {gap ? '🗣 your turn: say it back' : drillStepInfo(step).hint}
                </>
              )}
            </span>
          </div>

          {current.before && (
            <div class="pr-context" lang={current.lang}>
              {current.before}
            </div>
          )}
          <div class={`pr-text${hidden ? ' hidden' : ''}`} lang={current.lang} title={hidden ? 'Hover to peek' : undefined}>
            {current.text}
          </div>
          {current.translation && (
            <div class={`pr-trans${showTrans || phase === 'rate' ? '' : ' hidden'}`} lang={s.nativeLang} title="Hover to peek (T shows it)">
              {current.translation}
            </div>
          )}
          {current.after && (
            <div class="pr-context" lang={current.lang}>
              {current.after}
            </div>
          )}
          {current.note && <div class="pr-note small">✎ {current.note}</div>}

          {voice !== undefined && (
            <div class="muted small">{voice != null && voice < 1 ? `Loading the voice… ${Math.round(voice * 100)}%` : 'Preparing the voice…'}</div>
          )}
          {error && <div class="error small">{error}</div>}

          {phase === 'rate' ? (
            <div class="pr-grades">
              {GRADES.map((g) => (
                <button key={g.id} class={`grade ${g.id}`} title={g.title} onClick={() => void rate(g.id)}>
                  <span>
                    <kbd>{g.key}</kbd> {g.label}
                  </span>
                  <span class="small muted">{nextLabel(current.srs, g.id, now)}</span>
                </button>
              ))}
              <button title="Practise it once more before rating (Space)" onClick={() => void run(0)}>
                ↺ Again
              </button>
            </div>
          ) : (
            <div class="pr-controls">
              {phase === 'playing' ? (
                <button class="primary" onClick={() => (stop(), setPhase('ready'))}>
                  ■ Stop <kbd>Space</kbd>
                </button>
              ) : (
                <button class="primary" onClick={() => void run(pass)}>
                  ▶ {pass ? 'Continue' : 'Start'} <kbd>Space</kbd>
                </button>
              )}
              <button title="This pass again (R)" onClick={() => void run(Math.min(pass, steps.length - 1))}>
                ↺
              </button>
              <button
                title="Next pass (→)"
                onClick={() => (pass + 1 < steps.length ? void run(pass + 1) : (stop(), setPhase('rate')))}
              >
                ⏭
              </button>
              <span class="spacer" />
              <span class="pr-rates" title="Speed of the voice">
                {RATES.map((r) => (
                  <button key={r} class={s.practiceRate === r ? 'on' : ''} onClick={() => update({ practiceRate: r })}>
                    {r}×
                  </button>
                ))}
              </span>
              <button
                class={s.loopGap ? 'on' : ''}
                title="After each pass, pause as long as it took, so you can say it back"
                onClick={() => update({ loopGap: !s.loopGap })}
              >
                🗣 Gap
              </button>
            </div>
          )}
        </div>
      )}

      <p class="muted small pr-help">
        Each sentence plays {steps.length} times: {steps.map((st) => drillStepInfo(st).icon).join(' ')} — listen with the text hidden,
        shadow it (speak along with the voice) reading the text, then shadow it from memory. Hover the text to peek. Keys: Space
        start / stop · R this pass again · → next pass · 1–4 rate · T translation. English uses the Kokoro voice from Options →
        Settings; other languages use your browser's voice. Change the passes in Options → ⭐ Sentences.
      </p>
    </div>
  );
}
