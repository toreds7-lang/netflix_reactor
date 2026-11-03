import type { ComponentChildren } from 'preact';
import { memo } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ctl } from '../app/instance';
import {
  activeIndex,
  bookmarkIndex,
  cueKeys,
  cues,
  cueUnits,
  currentIndex,
  drill,
  findPlaying,
  floatAvailable,
  floatOpen,
  helpOpen,
  hereSentences,
  humanTrack,
  keyLines,
  keySelection,
  keyUnits,
  keyViewIcon,
  loop,
  loopStart,
  loopTextHidden,
  mainLang,
  mainTrack,
  mainTrackPinned,
  meta,
  paused,
  playClock,
  popup,
  reading,
  readingScript,
  revealHeld,
  revealedLine,
  romanizations,
  savedLines,
  selection,
  sentences,
  settings,
  sidebarDragWidth,
  sidebarOnPage,
  sidebarTab,
  sidebarWidthPx,
  status,
  summary,
  tracks,
  translationMode,
  translations,
  showToast,
  updateSettings,
  videoBookmarks,
  videoId,
  visibleKeys,
  windowWidth,
  words,
} from '../app/state';
import { findLoopRange, findSavedLoop } from '../core/bookmarks';
import type { KeyLevel } from '../core/keylines';
import { isChinese, isJapanese, languageName, NATIVE_LANGUAGES, needsRomanization } from '../core/langs';
import { send } from '../core/messages';
import type { ReadItem } from '../core/readaloud';
import { DEFAULT_SETTINGS, fitSidebarWidth, LOOP_COUNTS, type KeyView, type TranslationSource } from '../core/settings';
import { describeKey } from '../core/shortcuts';
import { flatten } from '../core/subtitles';
import { sceneAt } from '../core/summary';
import type { Cue, LineExplainResult, ModelUsage, ResultSource, RubySegment, SavedWord } from '../core/types';
import { formatTime } from '../words/export';
import { deleteWords, updateWord, type WordMap } from '../words/store';
import { Chip } from './Chip';
import { ChatTab } from './Chat';
import { FindRunBar, FindTab } from './Find';
import { loopBadge, rubyFor } from './Overlay';
import { PracticeBar, SentencesTab, StarButton } from './Sentences';
import { TokenLine } from './TokenLine';

/** What the folded menu bar shows: the toggles that are on, then where translations come from. */
export function menuSummary(): string {
  const s = settings.value;
  const lang = mainLang.value;
  const mode = translationMode.value;
  const to = languageName(s.nativeLang);
  const keys = !!keySelection.value;
  const on = [
    s.autoPause && 'Auto-pause',
    !s.showTranslation && 'No translation',
    s.showTranslation && s.blurTranslation && 'Blur',
    s.blurVideo && 'Blur video',
    needsRomanization(lang) && s.showRomanization && 'Romanize',
    !!lang && (isJapanese(lang) || isChinese(lang)) && s.showFurigana && (isChinese(lang) ? 'Pinyin' : 'Furigana'),
    s.hideSoundDescriptions && 'Hide [SDH]',
    s.pauseOnHover && 'Hover pause',
    keys && s.keyOnly && 'Key only',
    keys && s.shadowMode && 'Shadow mode',
    keys && s.skipMode && 'Skip mode',
    s.showTranslation && mode === 'human' && `${to} (Netflix)`,
    s.showTranslation && mode === 'machine' && `${to} (machine)`,
  ];
  return on.filter(Boolean).join(' · ');
}

function SpeedStepper() {
  const s = settings.value;
  return (
    <div class="stepper" title="Playback speed ([ and ])">
      <button onClick={() => ctl().stepRate(-1)}>−</button>
      <span>{s.playbackRate.toFixed(2).replace(/0$/, '')}×</span>
      <button onClick={() => ctl().stepRate(1)}>+</button>
    </div>
  );
}

/** Speed sits in the play bar in the floating window, so the menu bar leaves it out there. */
function Controls({ floating = false }: { floating?: boolean }) {
  const s = settings.value;
  const folded = s.controlsFolded;
  const summary = menuSummary();
  return (
    <div class={`controls${folded ? ' folded' : ''}`}>
      <div class="toolbar">
        <button
          class="fold"
          aria-expanded={!folded}
          title={`${folded ? 'Show' : 'Fold'} the menu (${describeKey(s.shortcuts.toggleControls)})${folded && summary ? `\n${summary}` : ''}`}
          onClick={() => updateSettings({ controlsFolded: !folded })}
        >
          <span class="fold-arrow" />
          <span class="fold-label">{folded ? summary || 'Menu' : 'Menu'}</span>
        </button>
        {!floating && <SpeedStepper />}
        <div class="stepper" title="Size of the subtitles on the video">
          <button onClick={() => updateSettings({ fontSize: Math.max(1.8, +(s.fontSize - 0.3).toFixed(1)) })}>A−</button>
          <button onClick={() => updateSettings({ fontSize: Math.min(7, +(s.fontSize + 0.3).toFixed(1)) })}>A+</button>
        </div>
      </div>
      {!folded && <MenuBody />}
    </div>
  );
}

/** The unfolded menu: subtitle track, translation, and the toggle chips. */
function MenuBody() {
  const s = settings.value;
  const lang = mainLang.value;
  const mode = translationMode.value;
  const showRubyChip = !!lang && (isJapanese(lang) || isChinese(lang));
  return (
    <>
      <label class="field">
        <span>Subtitles</span>
        <select
          value={mainTrackPinned.value ? (mainTrack.value?.id ?? 'auto') : 'auto'}
          onChange={(e) => ctl().selectMainTrack((e.target as HTMLSelectElement).value)}
        >
          <option value="auto">Follow Netflix{!mainTrackPinned.value && mainTrack.value ? ` (${mainTrack.value.label})` : ''}</option>
          {tracks.value.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <div class="field-row">
        <label class="field">
          <span>Translate to</span>
          <select value={s.nativeLang} onChange={(e) => updateSettings({ nativeLang: (e.target as HTMLSelectElement).value })}>
            {NATIVE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>Source</span>
          <select
            value={s.translationSource}
            onChange={(e) => updateSettings({ translationSource: (e.target as HTMLSelectElement).value as TranslationSource })}
          >
            <option value="auto">Auto</option>
            <option value="human">Netflix only</option>
            <option value="machine">Machine only</option>
          </select>
        </label>
      </div>
      <div class="mode-line">
        {mode === 'human' && <span class="badge human">Netflix subtitles · {humanTrack.value?.label}</span>}
        {mode === 'machine' && <span class="badge machine">Machine translation</span>}
        {mode === 'same-language' && <span class="badge">Already in {languageName(s.nativeLang)}</span>}
        {mode === 'none' && s.translationSource === 'human' && cues.value.length > 0 && (
          <span class="badge">No Netflix subtitles in {languageName(s.nativeLang)}</span>
        )}
      </div>
      <div class="chips">
        <Chip on={s.autoPause} label="Auto-pause" title="Pause at the end of every line (Q)" onClick={() => ctl().runAction('toggleAutoPause')} />
        <Chip on={s.showTranslation} label="Translation" onClick={() => updateSettings({ showTranslation: !s.showTranslation })} />
        <Chip on={s.blurTranslation} label="Blur" title="Blur translation until hovered (W)" onClick={() => updateSettings({ blurTranslation: !s.blurTranslation })} />
        <Chip
          on={s.blurVideo}
          label="Blur video"
          title={`Blur every line on the video and the floating window's big line until hovered; hovering the translation shows both. The list stays readable (${describeKey(s.shortcuts.toggleBlurVideo)}, hold ${describeKey(s.shortcuts.holdReveal)} to peek, ${describeKey(s.shortcuts.revealLine)} to show the line you are on)`}
          onClick={() => ctl().runAction('toggleBlurVideo')}
        />
        {needsRomanization(lang) && (
          <Chip on={s.showRomanization} label="Romanize" onClick={() => updateSettings({ showRomanization: !s.showRomanization })} />
        )}
        {showRubyChip && (
          <Chip
            on={s.showFurigana}
            label={isChinese(lang) ? 'Pinyin' : 'Furigana'}
            onClick={() => updateSettings({ showFurigana: !s.showFurigana })}
          />
        )}
        <Chip on={s.hideSoundDescriptions} label="Hide [SDH]" title="Hide sound descriptions and speaker labels" onClick={() => updateSettings({ hideSoundDescriptions: !s.hideSoundDescriptions })} />
        <Chip on={s.pauseOnHover} label="Hover pause" title="Pause while the mouse is over the subtitles" onClick={() => updateSettings({ pauseOnHover: !s.pauseOnHover })} />
        <Chip
          on={s.overlayRepeat}
          label="↺ on video"
          title={`A ↺ right of the line on the video: click replays the line (${describeKey(s.shortcuts.repeatLine)}), Shift+click loops it. With key lines, ‹ › beside the line go to the previous / next key line.`}
          onClick={() => updateSettings({ overlayRepeat: !s.overlayRepeat })}
        />
      </div>
    </>
  );
}

const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * Model, level and cost of a key-lines or summary result, with ↻ to make it again. A result made with other settings
 * (shown until a new one is made) gets ✨ Update instead.
 */
function ResultInfo(props: { data: ModelUsage & ResultSource; busy: boolean; what: string; onRedo: () => void }) {
  const { data, busy, what, onRedo } = props;
  const s = settings.value;
  const model = s.keyLinesProvider === 'openai' ? 'OpenAI' : s.claudeCodeModel;
  const cost = data.cached ? 'cached' : `${fmtTokens(data.inputTokens)} in / ${fmtTokens(data.outputTokens)} out`;
  const about = [
    `Made ${new Date(data.createdAt).toLocaleString()}. Kept per episode, model and level, so opening the episode again is free.`,
    data.adapted && 'Made from slightly different subtitles and matched to these line by line.',
  ];
  return (
    <span class="result-info">
      <span class="muted small" title={about.filter(Boolean).join(' ')}>
        {data.model} · {data.level} · {cost}
      </span>
      {data.current ? (
        <button class="icon" disabled={busy} title={`Make the ${what} again with ${model}. The new result replaces this one.`} onClick={onRedo}>
          {busy ? 'Updating…' : '↻'}
        </button>
      ) : (
        <button
          class="accent small"
          disabled={busy}
          title={`Make the ${what} again with your current settings (${model}, ${s.learnerLevel})`}
          onClick={onRedo}
        >
          {busy ? 'Updating…' : '✨ Update'}
        </button>
      )}
    </span>
  );
}

/** Under a result made with other settings. */
function EarlierRunNote({ data, what }: { data: ResultSource & ModelUsage; what: string }) {
  if (data.current) return null;
  return (
    <div class="muted small">
      From an earlier run ({data.model}, {data.level}). ✨ Update makes the {what} again with your current settings.
    </div>
  );
}

const KEY_VIEWS: { id: KeyView; label: string; title: string }[] = [
  { id: 'both', label: 'Both', title: 'Mark shadowing and story lines' },
  { id: 'shadow', label: '🎤 Shadowing', title: 'Lines worth repeating aloud' },
  { id: 'story', label: '📖 Story', title: 'Lines you need to follow the plot' },
];

function KeyLinesBar() {
  const s = settings.value;
  const k = keyLines.value;
  const n = keyUnits.value.length;
  const sel = keySelection.value;
  if (!n) return null;
  const toggle = (patch: 'keyOnly' | 'shadowMode' | 'skipMode', label: string) => {
    updateSettings({ [patch]: !s[patch] });
    if (patch !== 'keyOnly') showToast(`${label} ${!s[patch] ? 'on' : 'off'}`);
  };
  return (
    <div class="keylines">
      <div class="kl-head">
        <span class="kl-title">Key lines</span>
        {k.data ? (
          <ResultInfo
            data={k.data}
            busy={k.status === 'loading'}
            what="key lines"
            onRedo={() => void ctl().analyzeKeyLines(true)}
          />
        ) : (
          <button
            class="accent"
            disabled={k.status === 'loading'}
            title={`Send this episode's ${n} sentences to ${s.keyLinesProvider === 'openai' ? 'OpenAI' : 'Claude Code (your Claude subscription)'} once. The result is cached.`}
            onClick={() => void ctl().analyzeKeyLines()}
          >
            {k.status === 'loading' ? 'Analyzing…' : '✨ Find key lines'}
          </button>
        )}
      </div>
      {k.data && <EarlierRunNote data={k.data} what="key lines" />}
      {k.status === 'error' && <div class="error small">{k.error}</div>}
      {sel && (
        <>
          <div class="chips">
            {([1, 2, 3] as KeyLevel[]).map((l) => (
              <Chip key={l} on={s.keyLevel === l} label={`${l * 10}%`} onClick={() => updateSettings({ keyLevel: l })} />
            ))}
            <span class="kl-sep" />
            {KEY_VIEWS.map((v) => (
              <Chip key={v.id} on={s.keyView === v.id} label={v.label} title={v.title} onClick={() => updateSettings({ keyView: v.id })} />
            ))}
          </div>
          <div class="chips">
            <Chip on={s.keyOnly} label="Key only" title="Show only key lines in the list" onClick={() => toggle('keyOnly', 'Key only')} />
            <Chip
              on={s.shadowMode}
              label="Shadow mode"
              title="Pause after each 🎤 sentence. S replays the whole sentence."
              onClick={() => toggle('shadowMode', 'Shadow mode')}
            />
            <Chip
              on={s.skipMode}
              label="Skip mode"
              title="Play only 📖 story sentences and skip the rest"
              onClick={() => toggle('skipMode', 'Skip mode')}
            />
          </div>
          <div class="kl-count">
            <span class="muted small">
              🎤 {sel.shadow.size} · 📖 {sel.story.size} of {n} sentences
            </span>
            <KeyStepper />
          </div>
        </>
      )}
    </div>
  );
}

/** ‹ 🎤 ›: the previous / next key line in the list chosen with the Both / 🎤 / 📖 chips, like J / L. */
function KeyStepper() {
  const s = settings.value;
  if (!keySelection.value) return null;
  const icon = keyViewIcon(s.keyView);
  const hint = (code: string) => (code ? ` (${describeKey(code)})` : '');
  return (
    <div class="stepper keystep">
      <button title={`Previous ${icon} line${hint(s.shortcuts.prevKeyLine)}`} onClick={() => ctl().stepKeyLine(-1)}>
        ‹
      </button>
      <span>{icon}</span>
      <button title={`Next ${icon} line${hint(s.shortcuts.nextKeyLine)}`} onClick={() => ctl().stepKeyLine(1)}>
        ›
      </button>
    </div>
  );
}

const lineCount = (n: number) => (n === 1 ? '1 line' : `${n} lines`);

/** The loop being picked or played: its lines, pass, repeat count, speaking gap and hidden text. */
function LoopBar() {
  const l = loop.value;
  const start = loopStart.value;
  if (!l && start == null) return null;
  // A practice drill and a 🔎 run show their own bars.
  if (l && (drill.value?.phase === 'playing' || findPlaying.value)) return null;
  const s = settings.value;
  const list = cues.value;
  const key = describeKey(s.shortcuts.loop);
  if (!l) {
    return (
      <div class="loopbar">
        <div class="lb-head">
          <span class="lb-text">
            🔁 From {formatTime(list[start!]?.start)} · Shift+click the last line, click its 🔁 or press {key} on it
          </span>
          <button class="icon" title="Cancel (Esc)" onClick={() => ctl().stopLoop()}>
            ✕
          </button>
        </div>
      </div>
    );
  }
  const saved = !!findSavedLoop(list, videoBookmarks.value?.loops, l.from, l.to);
  // A saved sentence made of exactly the looped lines.
  const starred = hereSentences.value.some((x) => {
    const r = findLoopRange(list, x);
    return !!r && r[0] === l.from && r[1] === l.to;
  });
  return (
    <div class="loopbar on">
      <div class="lb-head">
        <span class="lb-text">
          🔁 {formatTime(list[l.from]?.start)}–{formatTime(list[l.to]?.end)} · {lineCount(l.to - l.from + 1)}
        </span>
        <span class={`lb-pass${l.gap ? ' gap' : ''}`} title={l.gap ? 'Say it back. Space starts the next pass now.' : undefined}>
          {l.gap ? '🗣 Your turn' : `Pass ${l.pass}${s.loopCount ? `/${s.loopCount}` : ''}`}
        </span>
        <button
          class="icon"
          disabled={saved}
          title={saved ? 'Saved in the Loops tab' : 'Save this loop to practise it again later'}
          onClick={() => ctl().saveCurrentLoop()}
        >
          {saved ? '✓' : '💾'}
        </button>
        <button
          class={`icon star${starred ? ' saved' : ''}`}
          disabled={starred}
          title={starred ? 'Saved in ⭐ Sentences' : 'Save these lines as one sentence to practise (⭐ Sentences tab)'}
          onClick={() => ctl().saveLoopAsSentence()}
        >
          {starred ? '★' : '☆'}
        </button>
        <button class="icon" title={`Stop looping (${key} or Esc)`} onClick={() => ctl().stopLoop()}>
          ■
        </button>
      </div>
      <div class="chips">
        {LOOP_COUNTS.map((c) => (
          <Chip
            key={c}
            on={s.loopCount === c}
            label={c ? `${c}×` : '∞'}
            title={c ? `Play ${c} passes, then go on normally` : 'Loop until you stop it'}
            onClick={() => updateSettings({ loopCount: c })}
          />
        ))}
        <span class="kl-sep" />
        <Chip
          on={s.loopGap}
          label="🗣 Gap"
          title="After each pass, pause as long as it took so you can say it back. Space skips the gap."
          onClick={() => updateSettings({ loopGap: !s.loopGap })}
        />
        <Chip
          on={s.loopHideText}
          label="🙈 Hide text"
          title="Blur the subtitles from the second pass on, to practise listening. Hover to peek."
          onClick={() => updateSettings({ loopHideText: !s.loopHideText })}
        />
      </div>
    </div>
  );
}

interface RowProps {
  index: number;
  cue: Cue;
  ruby?: RubySegment[];
  translation: string | null;
  roman: string | null;
  isCurrent: boolean;
  lang: string;
  nativeLang: string;
  words: WordMap;
  highlight: boolean;
  showTrans: boolean;
  showRoman: boolean;
  blur: boolean;
  canExplain: boolean;
  findKey: string;
  selRange: [number, number] | null;
  /** Visible key flags: 's' shadowing, 'u' story, 'su' both, '' none. */
  keyFlags: string;
  bookmarked: boolean;
  bookmarkKey: string;
  /** Inside a saved ⭐ sentence. */
  saved: boolean;
  /** Inside the loop being played. */
  inLoop: boolean;
  /** The first line of a loop being picked. */
  loopStart: boolean;
  /** Blurred while a loop hides its text. */
  peek: boolean;
}

const Row = memo(function Row(p: RowProps) {
  const [explain, setExplain] = useState<{ loading: boolean; data?: LineExplainResult; error?: string } | null>(null);
  const list = cues.peek();

  const runExplain = (e: Event) => {
    e.stopPropagation();
    if (explain) {
      setExplain(null);
      return;
    }
    setExplain({ loading: true });
    send('explainLine', {
      sentence: flatten(p.cue.text),
      prevLine: list[p.index - 1] ? flatten(list[p.index - 1].text) : undefined,
      nextLine: list[p.index + 1] ? flatten(list[p.index + 1].text) : undefined,
      from: p.lang,
      to: p.nativeLang,
    })
      .then((data) => setExplain({ loading: false, data }))
      .catch((err: Error) => setExplain({ loading: false, error: err.message }));
  };

  return (
    <div
      class={
        `row${p.isCurrent ? ' current' : ''}${p.keyFlags ? ` key-${p.keyFlags}` : ''}${p.bookmarked ? ' bookmarked' : ''}` +
        `${p.saved ? ' saved' : ''}` +
        `${p.inLoop ? ' in-loop' : ''}${p.loopStart ? ' loop-start' : ''}${p.peek ? ' peek' : ''}`
      }
      data-index={p.index}
      // Shift+click picks a loop; don't let it select text.
      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      onClick={(e) => {
        if (e.shiftKey) ctl().loopTo(p.index);
        // A drag-selection ends with a click on the row; it opened the popup, so don't also seek.
        else if (!popup.peek()) ctl().playback.goTo(p.index);
      }}
    >
      <div class="row-time">
        {formatTime(p.cue.start)}
        {(p.keyFlags || p.bookmarked || p.saved) && (
          <div class="row-key">
            {p.bookmarked && <span title="Your bookmark">🔖</span>}
            {p.saved && (
              <span class="row-star" title="Saved in ⭐ Sentences">
                ★
              </span>
            )}
            {p.keyFlags.includes('s') && <span title="Shadowing">🎤</span>}
            {p.keyFlags.includes('u') && <span title="Story">📖</span>}
          </div>
        )}
      </div>
      <div class="row-body">
        <div class="row-main" lang={p.lang}>
          <TokenLine
            cueIndex={p.index}
            scope="sidebar"
            text={p.cue.text}
            lang={p.lang}
            ruby={p.ruby}
            words={p.words}
            highlight={p.highlight}
            selRange={p.selRange}
          />
        </div>
        {p.showRoman && p.roman ? <div class="row-roman">{p.roman}</div> : null}
        {p.showTrans && p.translation ? <div class={`row-trans${p.blur ? ' blur' : ''}`}>{p.translation}</div> : null}
        {explain && (
          <div class="row-explain" onClick={(e) => e.stopPropagation()}>
            {explain.loading && <div class="muted">Asking Claude…</div>}
            {explain.error && <div class="error">{explain.error}</div>}
            {explain.data && (
              <>
                <div class="pp-meaning">{explain.data.translation}</div>
                {explain.data.breakdown.map((b, i) => (
                  <div key={i} class="bd">
                    <b lang={p.lang}>{b.chunk}</b> — {b.meaning}
                  </div>
                ))}
                {explain.data.grammarNotes.map((g, i) => (
                  <div key={i} class="pp-note">
                    {g}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
      <div class="row-actions">
        <button class="icon" title="Play this line" onClick={(e) => (e.stopPropagation(), ctl().playback.goTo(p.index))}>
          ▶
        </button>
        <button
          class="icon loop-btn"
          title="Loop: click 🔁 on the first line, then on the last line (or Shift+click it)"
          onClick={(e) => (e.stopPropagation(), ctl().pickLoopLine(p.index, false))}
        >
          🔁
        </button>
        <button
          class="icon"
          title="Copy line"
          onClick={(e) => {
            e.stopPropagation();
            // The clipboard of the window clicked in: the page's refuses while the floating window has the focus.
            const win = (e.currentTarget as Element).ownerDocument.defaultView ?? window;
            void win.navigator.clipboard.writeText(flatten(p.cue.text));
          }}
        >
          ⧉
        </button>
        <button
          class="icon"
          title={p.bookmarked ? 'Remove bookmark' : `Bookmark this line to continue from it later (${p.bookmarkKey})`}
          onClick={(e) => (e.stopPropagation(), ctl().toggleBookmark(p.index))}
        >
          🔖
        </button>
        <StarButton index={p.index} saved={p.saved} />
        <button
          class="icon"
          title={`Find lines like this in your shows: its chunks and lines with the same meaning (${p.findKey})`}
          onClick={(e) => (e.stopPropagation(), void ctl().find.findLike(p.index))}
        >
          🔎
        </button>
        {p.canExplain && (
          <button class="icon" title="Explain this line with Claude" onClick={runExplain}>
            ✨
          </button>
        )}
      </div>
    </div>
  );
});

function SubtitleList() {
  const listRef = useRef<HTMLDivElement>(null);
  const lastUserScroll = useRef(0);
  const s = settings.value;
  const list = cues.value;
  const cur = currentIndex.value;
  const trans = translations.value;
  const roman = romanizations.value;
  const w = words.value;
  const sel = selection.value;
  const lang = mainLang.value;
  const keys = cueKeys.value;
  const keyOnly = s.keyOnly && keys.length > 0;
  const marked = bookmarkIndex.value;
  const bookmarkKey = describeKey(s.shortcuts.bookmark);
  const findKey = describeKey(s.shortcuts.findLine);
  const lp = loop.value;
  const pickedStart = loopStart.value;
  const hidden = loopTextHidden.value;
  const starred = savedLines.value;

  useEffect(() => {
    if (cur < 0 || Date.now() - lastUserScroll.current < 4000) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${cur}"]`);
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [cur]);

  const st = status.value;
  if (!list.length) {
    return (
      <div class="list-empty">
        {st.kind === 'loading' && st.message}
        {st.kind === 'error' && <span class="error">{st.message}</span>}
        {st.kind === 'waiting' && 'Waiting for subtitles… Start playing the video.'}
        {st.kind === 'ready' && 'This track has no subtitle lines.'}
      </div>
    );
  }

  return (
    <div
      class="list"
      ref={listRef}
      onWheel={() => (lastUserScroll.current = Date.now())}
      onTouchMove={() => (lastUserScroll.current = Date.now())}
    >
      {list.map((cue, i) => {
        const flags = visibleKeys(keys[i], s.keyView);
        const inLoop = !!lp && i >= lp.from && i <= lp.to;
        if (keyOnly && !flags && i !== marked && !inLoop && i !== pickedStart) return null;
        return (
          <Row
            key={i}
            index={i}
            cue={cue}
            ruby={rubyFor(i, cue.ruby)}
            translation={trans[i] ?? null}
            roman={roman[i] ?? null}
            isCurrent={i === cur}
            lang={lang}
            nativeLang={s.nativeLang}
            words={w}
            highlight={s.highlightSaved}
            showTrans={s.showTranslation}
            showRoman={s.showRomanization}
            blur={s.blurTranslation}
            canExplain={!!s.claudeApiKey}
            findKey={findKey}
            selRange={sel && sel.scope === 'sidebar' && sel.cueIndex === i ? [sel.from, sel.to] : null}
            keyFlags={flags}
            bookmarked={i === marked}
            bookmarkKey={bookmarkKey}
            saved={starred.has(i)}
            inLoop={inLoop}
            loopStart={i === pickedStart}
            peek={inLoop && hidden}
          />
        );
      })}
    </div>
  );
}

/** This episode's saved loops; click one to loop it again. */
function LoopsTab() {
  const saved = videoBookmarks.value?.loops ?? [];
  const list = cues.value;
  const lp = loop.value;
  const lang = mainLang.value;
  const key = describeKey(settings.value.shortcuts.loop);
  if (!saved.length) {
    return (
      <div class="list-empty">
        No saved loops yet. Loop some lines (press {key} on the first and the last line, or use 🔁 on a line), then click 💾.
      </div>
    );
  }
  return (
    <div class="list loops">
      {saved.map((l) => {
        const range = findLoopRange(list, l);
        const playing = !!lp && !!range && lp.from === range[0] && lp.to === range[1];
        const n = range ? range[1] - range[0] + 1 : 0;
        const end = range ? list[range[1]]?.end : l.to.timeMs;
        return (
          <div
            key={l.createdAt}
            class={`loop-item${playing ? ' current' : ''}`}
            title={playing ? 'Looping now' : 'Loop these lines'}
            onClick={() => ctl().playSavedLoop(l)}
          >
            <div class="loop-main">
              <div class="loop-time">
                🔁 {formatTime(l.from.timeMs)}–{formatTime(end)}
                {n ? ` · ${lineCount(n)}` : ''}
              </div>
              <div lang={lang}>{l.from.text}</div>
              {n > 1 && (
                <div class="muted" lang={lang}>
                  … {l.to.text}
                </div>
              )}
            </div>
            <div class="row-actions visible">
              <button
                class="icon"
                title="Delete this loop"
                onClick={(e) => (e.stopPropagation(), ctl().deleteSavedLoop(l))}
              >
                🗑
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WordsTab() {
  const vid = videoId.value;
  const [scope, setScope] = useState<'video' | 'all'>('video');
  const lang = mainLang.value;
  const all = Object.values(words.value) as SavedWord[];
  const list = all
    .filter((w) => (scope === 'video' ? w.videoId === vid : !lang || w.key.startsWith(`${lang.split('-')[0].toLowerCase()}:`)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div class="list words">
      <div class="words-scope">
        <Chip on={scope === 'video'} label="This video" onClick={() => setScope('video')} />
        <Chip on={scope === 'all'} label={`All ${lang ? languageName(lang) : ''}`} onClick={() => setScope('all')} />
      </div>
      {!list.length && <div class="list-empty">No saved words yet. Click a word in the subtitles to save it.</div>}
      {list.map((w) => (
        <div class={`word-row ${w.level}`} key={w.key}>
          <div class="word-main">
            <b lang={w.lang}>{w.word}</b>
            {w.reading ? <span class="muted"> {w.reading}</span> : null}
            <div class="muted">{w.translation}</div>
          </div>
          <div class="row-actions visible">
            {w.videoId === vid && w.timeMs != null && (
              <button class="icon" title="Go to this line" onClick={() => ctl().seekToWord(w.timeMs!)}>
                ▶
              </button>
            )}
            <button
              class="icon"
              title={w.level === 'learning' ? 'Mark as known' : 'Mark as learning'}
              onClick={() => void updateWord(w.key, { level: w.level === 'learning' ? 'known' : 'learning' })}
            >
              {w.level === 'learning' ? '★' : '✓'}
            </button>
            <button class="icon" title="Delete" onClick={() => void deleteWords([w.key])}>
              🗑
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 🔊 for items [from, to] of the reading script; ■ while that range is being read. */
function SpeakButton({ range, what }: { range: [number, number] | undefined; what: string }) {
  if (!range) return null;
  const r = reading.value;
  const mine = r.status !== 'idle' && r.from === range[0] && r.to === range[1];
  return (
    <button
      class={`icon speak${mine ? ' on' : ''}`}
      title={mine ? 'Stop reading' : `Read ${what} aloud`}
      onClick={(e) => {
        e.stopPropagation();
        if (mine) ctl().stopReading();
        else void ctl().readAloud(range[0], range[1]);
      }}
    >
      {mine ? '■' : '🔊'}
    </button>
  );
}

/** A block's sentences, with the one being read highlighted. */
function Sentences({ items, block, current }: { items: ReadItem[]; block: string; current: number }) {
  return (
    <>
      {items.map((it, i) =>
        it.key === block ? (
          <span key={i} class={i === current ? 'reading' : undefined}>
            {it.text}
          </span>
        ) : null,
      )}
    </>
  );
}

/** What the reader is doing, next to Read all. */
function readingStatus(): string {
  const r = reading.value;
  if (r.status !== 'loading') return '';
  return r.progress != null && r.progress < 1 ? `Loading voice… ${Math.round(r.progress * 100)}%` : 'Preparing voice…';
}

/**
 * Scene-by-scene summary in the language being learned. Every scene and quoted line jumps to that point in the
 * video, so the summary can be checked against what is actually said. 🔊 reads it aloud, sentence by sentence.
 */
function SummaryTab() {
  const s = settings.value;
  const sum = summary.value;
  const units = keyUnits.value;
  const lang = mainLang.value;
  const data = sum.data;
  const script = readingScript.value;
  const current = reading.value.item;
  const listRef = useRef<HTMLDivElement>(null);
  // Keep the sentence being read in view.
  useEffect(() => {
    if (current >= 0) listRef.current?.querySelector('.reading')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [current]);
  if (!units.length) return <div class="list-empty">Waiting for subtitles… Start playing the video.</div>;

  if (!data) {
    const provider = s.keyLinesProvider === 'openai' ? 'OpenAI' : 'Claude Code (your Claude subscription)';
    return (
      <div class="list-empty sum-empty">
        <p>
          A scene-by-scene summary in {languageName(lang)} at your level ({s.learnerLevel}). Each scene links to the lines it is
          based on, so you can check it.
        </p>
        <button
          class="accent"
          disabled={sum.status === 'loading'}
          title={`Send this episode's ${units.length} sentences to ${provider} once. The result is cached.`}
          onClick={() => void ctl().summarize()}
        >
          {sum.status === 'loading' ? 'Summarizing…' : '✨ Summarize episode'}
        </button>
        {sum.status === 'error' && <div class="error small">{sum.error}</div>}
      </div>
    );
  }

  // Highlight the scene being played, so the summary follows the video.
  const playing = sceneAt(data.scenes, cueUnits.value[currentIndex.value] ?? -1);
  const items = script?.items ?? [];
  const readingKey = items[current]?.key;
  const all: [number, number] | undefined = items.length ? [0, items.length - 1] : undefined;
  return (
    <div class="list summary" ref={listRef}>
      <div class="sum-head">
        <ResultInfo data={data} busy={sum.status === 'loading'} what="summary" onRedo={() => void ctl().summarize(true)} />
        <span class="muted small">{readingStatus()}</span>
        <SpeakButton range={all} what="the whole summary" />
      </div>
      <EarlierRunNote data={data} what="summary" />
      {sum.status === 'error' && <div class="error small">{sum.error}</div>}
      {data.overview && (
        <section>
          <div class="sum-head">
            <div class="kl-title">Overview</div>
            <SpeakButton range={script?.ranges.overview} what="the overview" />
          </div>
          <p lang={lang}>
            <Sentences items={items} block="overview" current={current} />
          </p>
        </section>
      )}
      {data.characters.length > 0 && (
        <section>
          <div class="sum-head">
            <div class="kl-title">Who's who</div>
            <SpeakButton range={script?.ranges.cast} what="who's who" />
          </div>
          <ul class="sum-chars" lang={lang}>
            {data.characters.map((c, i) => (
              <li key={c.name} class={readingKey === `cast:${i}` ? 'reading' : undefined}>
                <b>{c.name}</b> — {c.role}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <div class="kl-title">Scenes</div>
        {data.scenes.map((sc, i) => (
          <div key={sc.start} class={`scene${i === playing ? ' current' : ''}`}>
            <div class="scene-top">
              <button class="scene-head" title="Play this scene" onClick={() => ctl().goToSentence(sc.start)}>
                <span class="scene-time">
                  ▶ {formatTime(units[sc.start]?.start)}–{formatTime(units[sc.end]?.end)}
                </span>
                <b lang={lang} class={readingKey === `title:${i}` ? 'reading' : undefined}>
                  {i + 1}. {sc.title}
                </b>
              </button>
              <SpeakButton range={script?.ranges.scenes[i]} what="this scene" />
            </div>
            <p lang={lang}>
              <Sentences items={items} block={`scene:${i}`} current={current} />
            </p>
            {sc.evidence.map((u) => (
              <button
                key={u}
                class="evidence"
                lang={lang}
                title={`The summary is based on this line. Play it (${formatTime(units[u]?.start)})`}
                onClick={() => ctl().goToSentence(u)}
              >
                “{units[u]?.text}”
              </button>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}

/** The line before or after the big line, small and dimmed; click to play it. */
function ContextLine({ index, peek }: { index: number; peek: boolean }) {
  const cue = cues.value[index];
  if (!cue) return <div class="bl-ctx" />;
  return (
    <button
      class={`bl-ctx${peek ? ' peek' : ''}`}
      lang={mainLang.value}
      title={`Play this line (${formatTime(cue.start)})`}
      onClick={() => ctl().playback.goTo(index)}
    >
      {flatten(cue.text)}
    </button>
  );
}

/**
 * The line being played, large, in the floating window, so you can shadow it without looking at the video on the
 * other monitor. The lines before and after it are shown dimmed. Between lines it keeps the last one, dimmed too.
 */
function BigLine() {
  const s = settings.value;
  const list = cues.value;
  const act = activeIndex.value;
  const idx = act >= 0 ? act : currentIndex.value;
  const cue = list[idx];
  const lang = mainLang.value;
  const badge = loopBadge();
  const keyFlags = cue ? visibleKeys(cueKeys.value[idx], s.keyView) : '';
  const sel = selection.value;
  const selRange: [number, number] | null = sel && sel.scope === 'big' && sel.cueIndex === idx ? [sel.from, sel.to] : null;
  const roman = cue && s.showRomanization ? romanizations.value[idx] : null;
  const trans = cue && s.showTranslation ? translations.value[idx] : null;
  const l = loop.value;
  // Loop "Hide text": blurred from the second pass on, like the subtitles on the video; hover to peek.
  const hidden = (i: number) => loopTextHidden.value && !!l && i >= l.from && i <= l.to;
  const peek = hidden(idx) ? ' peek' : '';
  // "Blur video" blurs the big line as on the video, hovering, V and U included; the lines around it and the list stay
  // readable.
  const blur = s.blurVideo ? ' blur' : '';
  const reveal = revealHeld.value || revealedLine.value === idx ? ' reveal' : '';
  return (
    <div class={`big-line${cue && act !== idx ? ' idle' : ''}${reveal}`}>
      <div class="bl-meta">
        {cue && <span class="muted">{formatTime(cue.start)}</span>}
        {keyFlags.includes('s') && <span title="Shadowing">🎤</span>}
        {keyFlags.includes('u') && <span title="Story">📖</span>}
        {cue && <StarButton index={idx} saved={savedLines.value.has(idx)} />}
        {cue && (
          <button
            class="icon"
            title={`Find lines like this in your shows (${describeKey(s.shortcuts.findLine)})`}
            onClick={() => void ctl().find.findLike(idx)}
          >
            🔎
          </button>
        )}
        {badge && <span class="bl-loop">{badge}</span>}
        <span class="spacer" />
        <Chip
          on={!s.floatHideVideoSubs}
          label="Subtitles on video"
          title="Off: while this window is open, the subtitles show only here and the video stays clean"
          onClick={() => updateSettings({ floatHideVideoSubs: !s.floatHideVideoSubs })}
        />
      </div>
      {cue ? (
        <div class="bl-lines">
          <ContextLine index={idx - 1} peek={hidden(idx - 1)} />
          <div class={`bl-main${blur}${peek}`} lang={lang}>
            <TokenLine
              cueIndex={idx}
              scope="big"
              text={cue.text}
              lang={lang}
              ruby={rubyFor(idx, cue.ruby)}
              words={words.value}
              highlight={s.highlightSaved}
              selRange={selRange}
            />
          </div>
          {roman ? <div class={`bl-roman${blur}${peek}`}>{roman}</div> : null}
          {trans ? (
            <div class={`bl-trans${s.blurTranslation || s.blurVideo ? ' blur' : ''}${peek}`} lang={s.nativeLang}>
              {trans}
            </div>
          ) : null}
          <ContextLine index={idx + 1} peek={hidden(idx + 1)} />
        </div>
      ) : (
        <div class="bl-lines bl-empty">The line being played shows here.</div>
      )}
    </div>
  );
}

/**
 * The episode's progress, since Netflix's own bar is on the other monitor. Click to jump. The loop and the bookmark
 * are marked on it.
 */
function SeekBar() {
  const { now, duration } = playClock.value;
  const [hover, setHover] = useState<number | null>(null);
  if (!duration) return null;
  const list = cues.value;
  const l = loop.value;
  const mark = list[bookmarkIndex.value];
  const pct = (ms: number) => `${Math.max(0, Math.min(100, (ms / duration) * 100))}%`;
  const at = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
  };
  return (
    <div class="seekbar">
      <span class="sk-time">{formatTime(now)}</span>
      <div
        class="sk-track"
        onMouseMove={(e) => setHover(at(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => ctl().seekTo(at(e))}
      >
        <div class="sk-rail" />
        {l && list[l.from] && list[l.to] && (
          <div
            class="sk-loop"
            style={{ left: pct(list[l.from].start), width: `calc(${pct(list[l.to].end)} - ${pct(list[l.from].start)})` }}
          />
        )}
        <div class="sk-fill" style={{ width: pct(now) }} />
        {mark && <div class="sk-mark" style={{ left: pct(mark.start) }} />}
        <div class="sk-knob" style={{ left: pct(now) }} />
        {hover != null && (
          <div class="sk-hover" style={{ left: pct(hover) }}>
            {formatTime(hover)}
          </div>
        )}
      </div>
      <span class="sk-time">−{formatTime(Math.max(0, duration - now))}</span>
    </div>
  );
}

/** Netflix's controls are on the other monitor, so the floating window has its own. */
function PlayBar() {
  const k = settings.value.shortcuts;
  return (
    <div class="playbar">
      <button class="icon" title={`Previous line (${describeKey(k.prevLine)})`} onClick={() => ctl().runAction('prevLine')}>
        ⏮&#xFE0E;
      </button>
      <button class="icon" title={`Repeat the line (${describeKey(k.repeatLine)})`} onClick={() => ctl().runAction('repeatLine')}>
        ↺
      </button>
      <button class="play" title="Play / pause (Space)" onClick={() => ctl().togglePlay()}>
        {paused.value ? '▶︎' : '⏸︎'}
      </button>
      <button class="icon" title={`Next line (${describeKey(k.nextLine)})`} onClick={() => ctl().runAction('nextLine')}>
        ⏭&#xFE0E;
      </button>
      <KeyStepper />
      <SpeedStepper />
      <span class="spacer" />
      <button class="icon" title="Netflix fullscreen on / off (F)" onClick={() => ctl().toggleFullscreen()}>
        ⛶
      </button>
    </div>
  );
}

const TEXT_SCALE = { min: 0.7, max: 2.5, step: 0.1 };

/** Text size in the floating window, which side its list is on, and fullscreen or maximized for it. */
function FloatWindowButtons() {
  const s = settings.value;
  const scale = (dir: 1 | -1) => {
    const next = Math.min(TEXT_SCALE.max, Math.max(TEXT_SCALE.min, s.floatTextScale + dir * TEXT_SCALE.step));
    updateSettings({ floatTextScale: +next.toFixed(1) });
  };
  return (
    <>
      <div class="stepper text-size" title={`Text size in this window (${Math.round(s.floatTextScale * 100)}%)`}>
        <button onClick={() => scale(-1)}>−</button>
        <span>Aa</span>
        <button onClick={() => scale(1)}>+</button>
      </div>
      <button
        class="icon fl-swap"
        title={`${s.floatPanelLeft ? 'Move the list back to the right' : 'Move the list to the left'} (${describeKey(s.shortcuts.swapColumns)})`}
        onClick={() => ctl().runAction('swapColumns')}
      >
        ⇄
      </button>
      <button
        class="icon"
        title={s.floatFullscreen ? 'Leave fullscreen (keep the window maximized)' : 'Fullscreen on this monitor'}
        onClick={() => ctl().setFloatFullscreen(!s.floatFullscreen)}
      >
        {s.floatFullscreen ? '⤡' : '⤢'}
      </button>
    </>
  );
}

/** Narrowest the panel and the stage may get when you drag the line between them, in px. */
const MIN_PANEL_PX = 260;
const MIN_STAGE_PX = 360;

/**
 * The floating window's stage and panel, side by side when the window is wide (the panel on either side). Drag the
 * line between them to set the panel's width, kept as a share of the window so the text size (a zoom) and the monitor
 * don't change it. Double-click the line for the automatic width.
 */
function FloatBody({ stage, panel }: { stage: ComponentChildren; panel: ComponentChildren }) {
  const s = settings.value;
  // While dragging: where the pointer and the panel's width started, and the share so far (saved once, on release).
  const start = useRef<{ x: number; px: number; width: number } | null>(null);
  const [dragShare, setDragShare] = useState<number | null>(null);
  const share = dragShare ?? s.floatPanelShare;
  // The panel grows by as much as the pointer moved towards the stage, so the line doesn't jump to the pointer.
  const shareAt = (x: number) => {
    const { x: x0, px, width } = start.current!;
    const grown = s.floatPanelLeft ? x - x0 : x0 - x;
    return +(Math.min(Math.max(px + grown, MIN_PANEL_PX), width - MIN_STAGE_PX) / width).toFixed(3);
  };
  const stop = () => {
    start.current = null;
    setDragShare(null);
  };
  return (
    <div
      class={`fl-body${s.floatPanelLeft ? ' panel-left' : ''}${dragShare != null ? ' dragging' : ''}`}
      style={share ? { '--fl-panel-w': `${+(share * 100).toFixed(1)}%` } : undefined}
    >
      <div class="fl-stage">{stage}</div>
      <div
        class="fl-divider"
        title="Drag to resize the columns. Double-click for the automatic width."
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const line = e.currentTarget as HTMLElement;
          const width = line.parentElement!.getBoundingClientRect().width;
          const px = line.nextElementSibling!.getBoundingClientRect().width;
          line.setPointerCapture(e.pointerId);
          start.current = { x: e.clientX, px, width };
          setDragShare(+(px / width).toFixed(3));
        }}
        onPointerMove={(e) => {
          if (start.current) setDragShare(shareAt(e.clientX));
        }}
        onPointerUp={(e) => {
          if (!start.current) return;
          // A click (or the two of a double-click) leaves the width as it was, automatic or not.
          if (e.clientX !== start.current.x) updateSettings({ floatPanelShare: shareAt(e.clientX) });
          stop();
        }}
        onPointerCancel={stop}
        onDblClick={() => updateSettings({ floatPanelShare: 0 })}
      />
      <div class="fl-panel">{panel}</div>
    </div>
  );
}

/**
 * The sidebar's left edge on the page. Drag it to set the sidebar's width: the video follows as you drag, and the
 * width is saved when you let go. Double-click it for the default width.
 */
function SidebarEdge() {
  // While dragging: where the pointer and the width started.
  const start = useRef<{ x: number; width: number } | null>(null);
  // The sidebar grows by as much as the pointer moved left, so the edge doesn't jump to the pointer.
  const widthAt = (x: number) => fitSidebarWidth(start.current!.width + start.current!.x - x, windowWidth.value);
  const stop = () => {
    start.current = null;
    sidebarDragWidth.value = null;
  };
  // In fullscreen the UI sits inside Netflix's player, which must not take these presses as its own.
  const keep = (e: Event) => e.stopPropagation();
  return (
    <div
      class="sb-edge"
      title="Drag to resize the sidebar. Double-click for the default width."
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width: sidebarWidthPx.value };
        sidebarDragWidth.value = start.current.width;
      }}
      onPointerMove={(e) => {
        if (start.current) sidebarDragWidth.value = widthAt(e.clientX);
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        // A click (or the two of a double-click) leaves the width as it was.
        if (e.clientX !== start.current.x) updateSettings({ sidebarWidth: widthAt(e.clientX) });
        stop();
      }}
      onPointerCancel={stop}
      onMouseDown={keep}
      onClick={keep}
      onDblClick={(e) => {
        e.stopPropagation();
        updateSettings({ sidebarWidth: DEFAULT_SETTINGS.sidebarWidth });
      }}
    />
  );
}

/**
 * The sidebar on the page, or, floating, filling its own window: the big line, seek bar and play bar on top (on the
 * left when the window is wide, or on the right with the columns swapped), the menu and tabs below them (beside them).
 */
export function Sidebar({ floating = false }: { floating?: boolean }) {
  const s = settings.value;
  if (!floating && !sidebarOnPage.value) return null;
  const m = meta.value;
  const tab = sidebarTab.value;
  const savedHere = (Object.values(words.value) as SavedWord[]).filter((w) => w.videoId === videoId.value).length;
  const loopsHere = videoBookmarks.value?.loops?.length ?? 0;
  const starredHere = Object.values(sentences.value).filter((x) => x.videoId === videoId.value).length;
  const bookmark = videoBookmarks.value?.bookmark;
  const floatKey = describeKey(s.shortcuts.toggleFloat);
  const panel = (
    <>
      <Controls floating={floating} />
      {!s.controlsFolded && <KeyLinesBar />}
      <PracticeBar />
      <FindRunBar />
      <LoopBar />
      <nav class="tabs">
        <button class={tab === 'subs' ? 'on' : ''} onClick={() => (sidebarTab.value = 'subs')}>
          Subtitles
        </button>
        <button class={tab === 'words' ? 'on' : ''} onClick={() => (sidebarTab.value = 'words')}>
          Words{savedHere ? ` (${savedHere})` : ''}
        </button>
        <button class={tab === 'loops' ? 'on' : ''} onClick={() => (sidebarTab.value = 'loops')}>
          Loops{loopsHere ? ` (${loopsHere})` : ''}
        </button>
        <button
          class={tab === 'sentences' ? 'on' : ''}
          title={`Sentences you saved to practise by shadowing (${describeKey(s.shortcuts.saveSentence)} saves the line you are on)`}
          onClick={() => (sidebarTab.value = 'sentences')}
        >
          ⭐ Sentences{starredHere ? ` (${starredHere})` : ''}
        </button>
        <button class={tab === 'summary' ? 'on' : ''} onClick={() => (sidebarTab.value = 'summary')}>
          Summary
        </button>
        <button
          class={tab === 'find' ? 'on' : ''}
          title={`Find lines in the episodes you watched (${describeKey(s.shortcuts.findLine)} finds lines like the one you are on)`}
          onClick={() => (sidebarTab.value = 'find')}
        >
          🔎 Find
        </button>
        <button
          class={tab === 'chat' ? 'on' : ''}
          title={`Chat about this episode (${describeKey(s.shortcuts.openChat)})`}
          onClick={() => (sidebarTab.value = 'chat')}
        >
          💬 Chat
        </button>
      </nav>
      {tab === 'subs' ? (
        <SubtitleList />
      ) : tab === 'words' ? (
        <WordsTab />
      ) : tab === 'loops' ? (
        <LoopsTab />
      ) : tab === 'sentences' ? (
        <SentencesTab />
      ) : tab === 'find' ? (
        <FindTab />
      ) : tab === 'chat' ? (
        <ChatTab />
      ) : (
        <SummaryTab />
      )}
    </>
  );
  return (
    <aside
      class={`sidebar${floating ? ' floating' : sidebarDragWidth.value != null ? ' resizing' : ''}`}
      style={floating ? { '--fl-scale': String(s.floatTextScale) } : { width: `${sidebarWidthPx.value}px` }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {!floating && <SidebarEdge />}
      <header class="sb-head">
        <div class="sb-title">
          <div class="title">{m?.title ?? 'Polyglot Player'}</div>
          {m?.episodeTitle ? <div class="muted">{m.episodeTitle}</div> : null}
        </div>
        {bookmark && (
          <button class="icon" title={`Go to your bookmark (${formatTime(bookmark.timeMs)})`} onClick={() => ctl().goToBookmark()}>
            🔖
          </button>
        )}
        {floating && <FloatWindowButtons />}
        <button class="icon" title="Keyboard shortcuts (?)" onClick={() => (helpOpen.value = true)}>
          ⌨
        </button>
        <button class="icon" title="Options" onClick={() => void send('openOptions', {})}>
          ⚙
        </button>
        {floating ? (
          <button class="icon" title={`Put the sidebar back on the Netflix page (${floatKey})`} onClick={() => ctl().dock()}>
            ⇲
          </button>
        ) : (
          <>
            {floatAvailable.value && (
              <button
                class="icon"
                title={`Move the sidebar to its own window on your other monitor (${floatKey})`}
                onClick={() => ctl().openFloat()}
              >
                ⧉
              </button>
            )}
            <button class="icon" title="Hide sidebar (E)" onClick={() => updateSettings({ sidebarOpen: false })}>
              ⟩
            </button>
          </>
        )}
      </header>
      {floating ? (
        <FloatBody
          stage={
            <>
              <BigLine />
              <SeekBar />
              <PlayBar />
            </>
          }
          panel={panel}
        />
      ) : (
        panel
      )}
    </aside>
  );
}

/**
 * Small tab on the right edge to reopen the sidebar, or, while floating, the floating window (after a reload; in
 * fullscreen a click elsewhere doesn't reopen it, since opening it ends fullscreen).
 */
export function SidebarHandle() {
  const s = settings.value;
  if (floatOpen.value) return null;
  if (s.floating) {
    return (
      <button
        class="sb-handle float-handle"
        title={`Open the floating sidebar again (${describeKey(s.shortcuts.toggleFloat)}). Outside fullscreen, any click or key press on the page also does.`}
        onClick={() => ctl().openFloat()}
      >
        ⧉
      </button>
    );
  }
  if (s.sidebarOpen) return null;
  return (
    <button class="sb-handle" title="Show sidebar (E)" onClick={() => updateSettings({ sidebarOpen: true })}>
      ⟨
    </button>
  );
}
