import { useState } from 'preact/hooks';
import { ctl } from '../app/instance';
import {
  clock,
  drill,
  dueList,
  hereSentences,
  loop,
  practice,
  sentences,
  settings,
  updateSettings,
  videoId,
} from '../app/state';
import { send } from '../core/messages';
import { drillStepInfo, GRADES, isDue, isFreshSession, nextLabel, reviewLabel, type DrillStep } from '../core/sentences';
import { describeKey } from '../core/shortcuts';
import type { SavedSentence } from '../core/types';
import { formatTime } from '../words/export';
import { Chip } from './Chip';

/** ☆ on a line: save its sentence to practise later; ★ when it is saved (click removes it). */
export function StarButton({ index, saved, cls = 'icon' }: { index: number; saved: boolean; cls?: string }) {
  const key = describeKey(settings.value.shortcuts.saveSentence);
  return (
    <button
      class={`${cls} star${saved ? ' saved' : ''}`}
      title={saved ? 'Saved in ⭐ Sentences · click to remove it' : `Save this sentence to practise it later${key !== '—' ? ` (${key})` : ''}`}
      // No focus (Space would press it) and no click through to the row or Netflix.
      onMouseDown={(e) => (e.preventDefault(), e.stopPropagation())}
      onClick={(e) => (e.stopPropagation(), ctl().toggleSentence(index))}
    >
      {saved ? '★' : '☆'}
    </button>
  );
}

/** The passes of the drill playing, the current one marked, and what to do in it. */
function DrillPasses({ steps, pass }: { steps: DrillStep[]; pass: number }) {
  const cur = drillStepInfo(steps[pass - 1] ?? 'text');
  return (
    <div class="pb-steps">
      <div class="pb-dots">
        {steps.map((st, i) => (
          <span key={i} class={`pb-dot${i + 1 === pass ? ' now' : i + 1 < pass ? ' done' : ''}`} title={drillStepInfo(st).label}>
            {drillStepInfo(st).icon}
          </span>
        ))}
      </div>
      <div class="pb-hint">
        <b>{cur.label}</b> · {cur.hint}
      </div>
    </div>
  );
}

/** Again / Hard / Good / Easy, each with when the sentence would come back. */
function Grades({ s }: { s: SavedSentence }) {
  const now = clock.value;
  return (
    <div class="pb-grades">
      {GRADES.map((g) => (
        <button key={g.id} class={`grade ${g.id}`} title={`${g.title} (${g.key})`} onClick={() => ctl().grade(g.id)}>
          <span>
            <kbd>{g.key}</kbd> {g.label}
          </span>
          <span class="muted small">{nextLabel(s.srs, g.id, now)}</span>
        </button>
      ))}
      <button class="icon" title="Practise it once more before rating" onClick={() => ctl().startDrill(s)}>
        ↺
      </button>
    </div>
  );
}

/**
 * A saved sentence being practised: the drill's passes, then the rating. In a practice session, how far along it is
 * and, between sentences, the next one (in another episode, a button opens it).
 */
export function PracticeBar() {
  const d = drill.value;
  const p = practice.value;
  const all = sentences.value;
  const session = isFreshSession(p, clock.value) ? p : null;
  if (!d && !session) return null;
  const s = d ? all[d.id] : session ? all[session.ids[session.index]] : undefined;
  const l = loop.value;
  const st = settings.value;
  const count = session ? ` · ${Math.min(session.index + 1, session.ids.length)} of ${session.ids.length}` : '';
  const here = !!s && s.videoId === videoId.value;
  return (
    <div class={`practicebar${d?.phase === 'rate' ? ' rate' : ''}`}>
      <div class="lb-head">
        <span class="lb-text">⭐ Practice{count}</span>
        {d?.phase === 'playing' && l?.gap && (
          <span class="lb-pass gap" title="Say it back. Space starts the next pass now.">
            🗣 Your turn
          </span>
        )}
        <button class="icon" title="Stop practising" onClick={() => ctl().stopPractice()}>
          ✕
        </button>
      </div>
      {d?.phase === 'playing' && (
        <>
          <DrillPasses steps={d.steps} pass={l?.pass ?? 1} />
          <div class="chips">
            <Chip
              on={st.loopGap}
              label="🗣 Gap"
              title="After each pass, pause as long as it took, so you can say it back. Space skips the gap."
              onClick={() => updateSettings({ loopGap: !st.loopGap })}
            />
          </div>
        </>
      )}
      {d?.phase === 'rate' && s && (
        <>
          <div class="pb-hint">How well could you say it?</div>
          <Grades s={s} />
        </>
      )}
      {!d && s && (
        <div class="lb-head">
          <span class="lb-text muted small">{here ? 'Paused' : `Next: ${s.title ?? 'another episode'}`}</span>
          <button class="accent" onClick={() => ctl().resumePractice()}>
            {here ? '▶ Continue' : 'Open ›'}
          </button>
        </div>
      )}
    </div>
  );
}

function SentenceItem({ s, here }: { s: SavedSentence; here: boolean }) {
  const st = settings.value;
  const now = clock.value;
  const current = drill.value?.id === s.id;
  return (
    <div
      class={`sent-item${current ? ' current' : ''}${isDue(s, now) ? ' due' : ''}`}
      title={here ? 'Practise this sentence' : `Open ${s.title ?? 'its episode'} and practise this sentence`}
      onClick={() => ctl().practiseSentence(s)}
    >
      <div class="loop-main">
        <div class="loop-time">
          {formatTime(s.startMs)} · <span class="sent-review">{reviewLabel(s, now)}</span>
          {!here && s.title ? ` · ${s.title}` : ''}
        </div>
        <div lang={s.lang}>{s.text}</div>
        {st.showTranslation && s.translation ? (
          <div class={`muted sent-trans${st.blurTranslation ? ' blur' : ''}`} lang={st.nativeLang}>
            {s.translation}
          </div>
        ) : null}
        {s.note ? <div class="small sent-note">✎ {s.note}</div> : null}
      </div>
      <div class="row-actions visible">
        <button
          class="icon"
          title={here ? 'Play it once' : `Open ${s.title ?? 'its episode'} on Netflix`}
          onClick={(e) => (e.stopPropagation(), ctl().playSentence(s))}
        >
          ▶
        </button>
        <button class="icon" title="Delete" onClick={(e) => (e.stopPropagation(), ctl().deleteSentence(s.id))}>
          🗑
        </button>
      </div>
    </div>
  );
}

type Scope = 'here' | 'due' | 'all';

/** Saved sentences: this episode's, the ones due, or all. Click one to practise it. */
export function SentencesTab() {
  const [scope, setScope] = useState<Scope>('here');
  const here = hereSentences.value;
  const due = dueList.value;
  const all = Object.values(sentences.value);
  const vid = videoId.value;
  const key = describeKey(settings.value.shortcuts.saveSentence);
  const list = scope === 'here' ? here : scope === 'due' ? due : all.sort((a, b) => b.createdAt - a.createdAt);
  const empty =
    scope === 'here'
      ? `No saved sentences in this episode yet. Press ${key} on a line you like, or click ☆ on it.`
      : scope === 'due'
        ? 'Nothing due. Sentences come back here when it is time to practise them again.'
        : `No saved sentences yet. Press ${key} on a line you like, or click ☆ on it.`;
  return (
    <div class="list sentences">
      <div class="sent-head">
        {due.length ? (
          <button
            class="accent"
            title="Practise every sentence due, with the original voice: this episode's first, then the others"
            onClick={() => ctl().startDuePractice()}
          >
            ▶ Practise {due.length} due
          </button>
        ) : (
          <span class="muted small">Nothing due ✓</span>
        )}
        <span class="spacer" />
        <button
          class="ghost small"
          title="Open the practice page: practise with text-to-speech, without Netflix"
          onClick={() => void send('openPractice', {})}
        >
          Practice page ↗
        </button>
      </div>
      <div class="words-scope">
        <Chip on={scope === 'here'} label={`This episode (${here.length})`} onClick={() => setScope('here')} />
        <Chip on={scope === 'due'} label={`Due (${due.length})`} onClick={() => setScope('due')} />
        <Chip on={scope === 'all'} label={`All (${all.length})`} onClick={() => setScope('all')} />
      </div>
      {!list.length && <div class="list-empty">{empty}</div>}
      {list.map((s) => (
        <SentenceItem key={s.id} s={s} here={s.videoId === vid} />
      ))}
    </div>
  );
}
