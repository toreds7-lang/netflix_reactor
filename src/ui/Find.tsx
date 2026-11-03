import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ctl } from '../app/instance';
import { findPlaying, findRun, findState, loop, mainLang, settings, updateSettings, videoId } from '../app/state';
import { isFreshRun, linesInEpisode, TIER_ORDER, wordsOf, type HitTier, type LibraryHit, type MeaningStatus } from '../core/library';
import { send } from '../core/messages';
import type { FindLength, FindScope } from '../core/settings';
import { describeKey } from '../core/shortcuts';
import { formatTime } from '../words/export';
import { Chip } from './Chip';

/**
 * 🔎 Find in my shows: search the episodes you watched for a word (all its forms), a phrase, a pattern or a Korean line,
 * or start from a line for its chunks and the lines that mean the same. Found lines play with the real voice, one by
 * one or shadowed, and can be saved to ⭐ Sentences.
 */

const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const lines = (n: number) => (n === 1 ? '1 line' : `${n} lines`);
// Typing in the search box must not reach Netflix's own keys.
const keep = (e: Event) => e.stopPropagation();

const TIER_LABEL: Record<HitTier, string> = {
  exact: 'Same words',
  spoken: 'Spoken form (gonna = going to…)',
  forms: 'Other forms',
  pattern: 'Pattern',
  korean: 'Korean line',
  meaning: 'Same meaning, other words',
};

/** The text with the matched words in bold. */
function Marked({ text, lang, marks }: { text: string; lang: string; marks: number[] }) {
  if (!marks.length) return <>{text}</>;
  const set = new Set(marks);
  const out: (string | JSX.Element)[] = [];
  let at = 0;
  wordsOf(text, lang).forEach((t, k) => {
    if (!set.has(k)) return;
    if (t.index > at) out.push(text.slice(at, t.index));
    out.push(
      <b class="find-mark" key={k}>
        {text.slice(t.index, t.index + t.length)}
      </b>,
    );
    at = t.index + t.length;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

function HitRow({ h }: { h: LibraryHit }) {
  const s = settings.value;
  const here = h.videoId === videoId.value;
  const saved = ctl().find.isSaved(h);
  const run = findRun.value;
  const cur = run?.items[run.index];
  const current = !!cur && cur.videoId === h.videoId && cur.start === h.start;
  const where = here ? 'This episode' : [h.show, h.episode].filter(Boolean).join(' · ') || 'Another episode';
  const context = [h.before && `… ${h.before}`, h.text, h.after && `${h.after} …`].filter(Boolean).join('\n');
  const meta = [
    where,
    formatTime(h.start),
    h.dup > 1 && `×${h.dup}`,
    h.key && '🎤',
    h.tier === 'meaning' && h.score != null && `${Math.round(h.score * 100)}% alike`,
    !h.watched && 'not watched yet',
  ].filter(Boolean);
  return (
    <div
      class={`find-hit${current ? ' current' : ''}${here ? ' here' : ''}`}
      title={`${context}\n\n${here ? 'Click to play it' : `Click to open ${where} and play it`}`}
      onClick={() => ctl().find.playHit(h, 'play')}
    >
      <div class="loop-main">
        <div class="loop-time">{meta.join(' · ')}</div>
        <div lang={h.lang}>
          <Marked text={h.text} lang={h.lang} marks={h.marks} />
        </div>
        {s.showTranslation && h.tr ? (
          <div class={`muted sent-trans${s.blurTranslation ? ' blur' : ''}`} lang={s.nativeLang}>
            {h.tr}
          </div>
        ) : null}
      </div>
      <div class="row-actions visible">
        <button
          class="icon"
          title={here ? 'Play it once' : `Open ${where} and play it`}
          onClick={(e) => (e.stopPropagation(), ctl().find.playHit(h, 'play'))}
        >
          ▶
        </button>
        <button
          class="icon"
          title={`Shadow it: ${s.findShadowPasses} ${s.findShadowPasses === 1 ? 'pass' : 'passes'}, each followed by a pause to say it back`}
          onClick={(e) => (e.stopPropagation(), ctl().find.playHit(h, 'shadow'))}
        >
          🗣
        </button>
        <button
          class={`icon star${saved ? ' saved' : ''}`}
          title={saved ? 'Saved in ⭐ Sentences · click to remove it' : 'Save it to ⭐ Sentences, to practise it later'}
          onClick={(e) => (e.stopPropagation(), ctl().find.toggleSaved(h))}
        >
          {saved ? '★' : '☆'}
        </button>
      </div>
    </div>
  );
}

function Filters() {
  const s = settings.value;
  const st = findState.value;
  const f = ctl().find;
  const scopes: { id: FindScope; label: string }[] = [
    { id: 'all', label: 'All episodes' },
    { id: 'here', label: 'This episode' },
    { id: 'others', label: 'Others' },
  ];
  const lengths: { id: Exclude<FindLength, 'any'>; label: string; title: string }[] = [
    { id: 'short', label: 'Short', title: 'Up to 6 words' },
    { id: 'medium', label: 'Medium', title: '7 to 14 words' },
    { id: 'long', label: 'Long', title: '15 words or more' },
  ];
  return (
    <div class="find-filters">
      <div class="chips">
        <Chip
          on={s.findWatchedOnly}
          label="Watched only"
          title="Only lines from the parts of episodes you already played: no spoilers, and you remember the scene"
          onClick={() => f.setFilter({ findWatchedOnly: !s.findWatchedOnly })}
        />
        <Chip
          on={s.findKeyOnly}
          label="🎤 only"
          title="Only 🎤 key lines (the lines picked for shadowing), in episodes where you found key lines"
          onClick={() => f.setFilter({ findKeyOnly: !s.findKeyOnly })}
        />
        <Chip
          on={s.findMeaning}
          label="Same meaning"
          title="Also lines that mean the same in other words, from a small free model on your computer (English episodes; about 23 MB, downloaded once)"
          onClick={() => f.setFilter({ findMeaning: !s.findMeaning })}
        />
      </div>
      <div class="chips">
        {scopes.map((x) => (
          <Chip key={x.id} on={s.findScope === x.id} label={x.label} onClick={() => f.setFilter({ findScope: x.id })} />
        ))}
        <span class="kl-sep" />
        {lengths.map((x) => (
          <Chip
            key={x.id}
            on={s.findLength === x.id}
            label={x.label}
            title={`${x.title}. Click again for any length.`}
            onClick={() => f.setFilter({ findLength: s.findLength === x.id ? 'any' : x.id })}
          />
        ))}
      </div>
      {(st.shows.length > 1 || st.show) && (
        <select class="find-show" value={st.show} onChange={(e) => f.setShow((e.target as HTMLSelectElement).value)}>
          <option value="">All shows</option>
          {[...new Set([...st.shows, ...(st.show ? [st.show] : [])])].map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** The line a "lines like this" search started from: its chunks found elsewhere, and ✨ Pattern. */
function LikeHead() {
  const st = findState.value;
  const like = st.like!;
  const f = ctl().find;
  return (
    <div class="find-like">
      <div class="kl-title">Lines like this one</div>
      <div class="find-like-text" lang={like.lang}>
        “{like.text}”
      </div>
      <div class="muted small">
        {st.status === 'loading'
          ? 'Looking for its chunks in your other episodes…'
          : st.chunks.length
            ? 'Its chunks in your other episodes · click one to see its lines'
            : 'None of its chunks is in your other episodes yet.'}
      </div>
      {st.chunks.length > 0 && (
        <div class="chips">
          {st.chunks.map((c) => (
            <Chip
              key={c.text}
              on={false}
              label={`${c.text} · ${c.episodes}`}
              title={`In ${lines(c.lines)} of ${c.episodes} episodes. Click to see them.`}
              onClick={() => f.search(c.text, like)}
            />
          ))}
        </div>
      )}
      <div class="find-pattern">
        {!st.frames && (
          <button
            class="ghost small"
            title="Ask Claude (the Key lines provider, see Options) for the reusable patterns in this line, like “I can't believe ___”. One short request; the answer is kept."
            onClick={() => void f.findPatterns()}
          >
            ✨ Pattern
          </button>
        )}
        {st.frames?.status === 'loading' && <span class="muted small">Asking for its patterns…</span>}
        {st.frames?.status === 'error' && <span class="error small">{st.frames.error}</span>}
        {st.frames?.status === 'ready' &&
          (st.frames.list.length ? (
            <div class="chips">
              {st.frames.list.map((fr) => (
                <Chip
                  key={fr}
                  on={false}
                  label={`✨ ${fr}`}
                  title="Find lines with this pattern (___ stands for up to 3 words)"
                  onClick={() => f.searchFrame(fr)}
                />
              ))}
            </div>
          ) : (
            <span class="muted small">No reusable pattern in this line.</span>
          ))}
      </div>
    </div>
  );
}

function meaningNote(info: MeaningStatus | undefined): string {
  if (info?.progress != null && info.progress < 1) return `Downloading the meaning model (about 23 MB, once)… ${Math.round(info.progress * 100)}%`;
  if (info?.state === 'working') return `Reading your episodes… ${info.indexed} of ${info.total}`;
  return 'Finding lines with the same meaning…';
}

function MeaningSection({ extra }: { extra: LibraryHit[] }) {
  const m = findState.value.meaning;
  if (m.status === 'off' || m.status === 'idle') return null;
  const info = m.info;
  const partial = m.status === 'ready' && info && !info.error && info.indexed < info.total;
  return (
    <section class="find-group">
      <div class="find-group-head">
        <span class="kl-title">{TIER_LABEL.meaning}</span>
        {m.translated && <span class="muted small"> · “{m.translated}”</span>}
      </div>
      {m.status === 'loading' && <div class="muted small find-note">{meaningNote(info)}</div>}
      {m.status === 'error' && <div class="error small find-note">{m.error}</div>}
      {m.status === 'ready' && info?.error && <div class="muted small find-note">{info.error}</div>}
      {m.status === 'ready' && !info?.error && !extra.length && <div class="muted small find-note">None found.</div>}
      {partial && (
        <div class="muted small find-note">
          The meaning model has read {info.indexed} of your {info.total} episodes; the others follow in the background.
        </div>
      )}
      {extra.map((h) => (
        <HitRow key={h.id} h={h} />
      ))}
    </section>
  );
}

function Results() {
  const st = findState.value;
  const s = settings.value;
  if (st.status === 'error') return <div class="list-empty error">{st.error}</div>;
  if (st.status === 'ready' && !st.episodes) {
    return (
      <div class="list-empty">
        No episodes saved yet. Each episode you open is saved by itself, so watch a little and search again.
        {!s.librarySave && ' (Saving is turned off in Options → Library.)'}
      </div>
    );
  }
  const shown = new Set(st.hits.map((h) => h.id));
  const extra = st.meaning.hits.filter((h) => !shown.has(h.id));
  const n = st.hits.length + extra.length;
  const groups = new Map<HitTier, LibraryHit[]>();
  for (const h of st.hits) groups.set(h.tier, [...(groups.get(h.tier) ?? []), h]);
  const ordered = [...groups.entries()].sort(([a], [b]) => TIER_ORDER[a] - TIER_ORDER[b]);
  const summary =
    st.status === 'loading'
      ? 'Looking…'
      : st.query
        ? `${lines(st.total)} in ${st.episodes} ${st.episodes === 1 ? 'episode' : 'episodes'}${st.total > st.hits.length ? ` · first ${st.hits.length} shown` : ''}`
        : `${st.episodes} ${st.episodes === 1 ? 'episode' : 'episodes'} saved`;
  return (
    <>
      <div class="find-head">
        <span class="muted small">{summary}</span>
        <span class="spacer" />
        {n > 0 && (
          <>
            <button
              class="accent small"
              title="Play every line found, one after another, with the real voice: this episode's first, then the others"
              onClick={() => ctl().find.startRun('play')}
            >
              ▶ Play all
            </button>
            <button
              class="small"
              title={`Shadow every line found: ${s.findShadowPasses} ${s.findShadowPasses === 1 ? 'pass' : 'passes'} each, with a pause after each pass to say it back`}
              onClick={() => ctl().find.startRun('shadow')}
            >
              🗣 Shadow all
            </button>
          </>
        )}
      </div>
      {n > 0 && (
        <div class="chips find-run-opts">
          {[1, 2, 3].map((p) => (
            <Chip
              key={p}
              on={s.findShadowPasses === p}
              label={`🗣 ${p}×`}
              title={`Shadow: ${p} ${p === 1 ? 'pass' : 'passes'} of each line`}
              onClick={() => updateSettings({ findShadowPasses: p })}
            />
          ))}
          <Chip
            on={s.loopHideText}
            label="🙈 Hide text"
            title="Blur the line from its second pass on, to shadow it from memory. Hover to peek."
            onClick={() => updateSettings({ loopHideText: !s.loopHideText })}
          />
        </div>
      )}
      {st.status === 'ready' && st.query && !st.hits.length && (
        <div class="list-empty">
          {s.findWatchedOnly
            ? 'Not in the parts you watched yet. Turn off “Watched only” to search the whole episodes.'
            : `Not in your ${st.episodes} saved ${st.episodes === 1 ? 'episode' : 'episodes'} yet.`}
        </div>
      )}
      {ordered.map(([tier, list]) => (
        <section class="find-group" key={tier}>
          <div class="find-group-head">
            <span class="kl-title">{TIER_LABEL[tier]}</span>
            {tier === 'forms' && st.forms.length > 0 && <span class="muted small"> · {st.forms.join(' · ')}</span>}
          </div>
          {list.map((h) => (
            <HitRow key={h.id} h={h} />
          ))}
        </section>
      ))}
      <MeaningSection extra={extra} />
    </>
  );
}

function Intro() {
  const s = settings.value;
  const [count, setCount] = useState<{ episodes: number; sentences: number } | null>(null);
  useEffect(() => {
    send('librarySearch', {
      query: '',
      lang: mainLang.peek() || settings.peek().learningLang,
      here: videoId.peek(),
      scope: 'all',
      length: 'any',
      watchedOnly: false,
      keyOnly: false,
      limit: 0,
    })
      .then((r) => setCount({ episodes: r.episodes, sentences: r.sentences }))
      .catch(() => undefined);
  }, []);
  return (
    <div class="list-empty find-intro">
      <p>
        Find lines in the episodes you watched: a word (in all its forms), a phrase, a pattern like <b>I can't * believe</b>, or
        a Korean line, to hear how it was said.
      </p>
      <p class="small">
        Or click a word in the subtitles and choose <b>🔎 In my shows</b>, or press <kbd>{describeKey(s.shortcuts.findLine)}</kbd> (🔎 on a
        line in the list) for lines like the one you are on.
      </p>
      {count && (
        <p class="small muted">
          {count.episodes} {count.episodes === 1 ? 'episode' : 'episodes'} saved · {count.sentences} sentences
        </p>
      )}
    </div>
  );
}

export function FindTab() {
  const st = findState.value;
  const [draft, setDraft] = useState(st.query);
  useEffect(() => setDraft(st.query), [st.query]);
  return (
    <div class="list find">
      <form
        class="find-form"
        onSubmit={(e) => {
          e.preventDefault();
          ctl().find.search(draft);
        }}
      >
        <input
          class="find-input"
          type="search"
          value={draft}
          placeholder="A word, a phrase, I can't * believe, or 한국어"
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onKeyDown={keep}
          onKeyUp={keep}
          onKeyPress={keep}
        />
        <button class="accent" type="submit" title="Search your shows">
          🔎
        </button>
      </form>
      {st.back && (
        <button class="ghost small find-back" onClick={() => ctl().find.backToLine()}>
          ‹ Back to “{short(st.back.text)}”
        </button>
      )}
      {st.like && <LikeHead />}
      <Filters />
      {st.query || st.like ? <Results /> : <Intro />}
    </div>
  );
}

/** A 🔎 Play all / Shadow all run: where it is, and, between lines or episodes, how to go on. */
export function FindRunBar() {
  const r = findRun.value;
  if (!isFreshRun(r, Date.now())) return null;
  const playing = findPlaying.value;
  const l = loop.value;
  const item = r.items[r.index];
  const here = item.videoId === videoId.value;
  const n = linesInEpisode(r.items, r.index);
  return (
    <div class="practicebar findbar">
      <div class="lb-head">
        <span class="lb-text">
          🔎 {r.mode === 'shadow' ? 'Shadow all' : 'Play all'} · {r.index + 1} of {r.items.length}
          {r.label ? ` · ${r.label}` : ''}
        </span>
        {playing && l && (
          <span class={`lb-pass${l.gap ? ' gap' : ''}`} title={l.gap ? 'Say it back. Space plays the next pass now.' : undefined}>
            {l.gap ? '🗣 Your turn' : r.mode === 'shadow' ? `Pass ${l.pass}/${r.passes}` : '▶'}
          </span>
        )}
        <button class="icon" title="Next line" onClick={() => ctl().find.skip()}>
          ⏭&#xFE0E;
        </button>
        <button class="icon" title="Stop" onClick={() => ctl().find.stopRun()}>
          ✕
        </button>
      </div>
      {!playing && (
        <div class="lb-head">
          <span class="lb-text muted small">{here ? 'Paused' : `Next: ${lines(n)} in ${item.title ?? 'another episode'}`}</span>
          <button class="accent" onClick={() => ctl().find.resume()}>
            {here ? '▶ Continue' : 'Open ›'}
          </button>
        </div>
      )}
    </div>
  );
}

/** In the word popup: how many lines of your shows have this word or phrase; click to see them. */
export function FindInShows({ text }: { text: string }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    setCount(null);
    const s = settings.peek();
    send('librarySearch', {
      query: text,
      lang: mainLang.peek() || s.learningLang,
      here: videoId.peek(),
      scope: s.findScope,
      length: s.findLength,
      watchedOnly: s.findWatchedOnly,
      keyOnly: s.findKeyOnly,
      limit: 0,
    })
      .then((r) => alive && setCount(r.total))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [text]);
  return (
    <button
      title="Find this word or phrase (in all its forms) in the episodes you watched"
      onClick={() => {
        ctl().closePopup();
        ctl().find.search(text);
      }}
    >
      🔎 In my shows{count != null ? ` (${count})` : ''}
    </button>
  );
}
