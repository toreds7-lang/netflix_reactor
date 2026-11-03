import { ctl } from '../app/instance';
import {
  activeIndex,
  cueKeys,
  cues,
  currentIndex,
  drill,
  findPlaying,
  floatOpen,
  generatedRuby,
  keySelection,
  keyViewIcon,
  loop,
  loopStart,
  loopTextHidden,
  mainLang,
  paused,
  revealHeld,
  revealedLine,
  romanizations,
  savedLines,
  selection,
  settings,
  sidebarOnPage,
  sidebarWidthPx,
  translations,
  visibleKeys,
  words,
} from '../app/state';
import { drillStepInfo } from '../core/sentences';
import { describeKey } from '../core/shortcuts';
import type { RubySegment } from '../core/types';
import { formatTime } from '../words/export';
import { StarButton } from './Sentences';
import { TokenLine } from './TokenLine';

/** While paused in a gap, keep showing the previous line for this long after it ended. */
const LINGER_MS = 10_000;

export function rubyFor(index: number, cueRuby: RubySegment[] | undefined): RubySegment[] | undefined {
  if (!settings.value.showFurigana) return undefined;
  return cueRuby ?? generatedRuby.value[index];
}

/**
 * What the loop or a practice drill is doing, shown above the subtitles (even between lines, so it doesn't flicker).
 * After a drill, how to rate it.
 */
export function loopBadge(): string | null {
  const l = loop.value;
  const d = drill.value;
  if (d?.phase === 'rate') return '⭐ How did it go? 1 Again · 2 Hard · 3 Good · 4 Easy';
  if (l && d) {
    if (l.gap) return '🗣 Your turn';
    const step = drillStepInfo(d.steps[l.pass - 1] ?? 'text');
    return `⭐ ${step.icon} ${step.label} · ${l.pass}/${d.steps.length}`;
  }
  if (l) {
    if (l.gap) return '🗣 Your turn';
    // A 🔎 run's line has its own number of passes.
    const count = l.passes ?? settings.value.loopCount;
    return `${findPlaying.value ? '🔎' : '🔁'} ${l.pass}${count ? `/${count}` : ''}${loopTextHidden.value ? ' · listen' : ''}`;
  }
  const start = loopStart.value;
  if (start == null) return null;
  return `🔁 From ${formatTime(cues.value[start]?.start)} · ${describeKey(settings.value.shortcuts.loop)} on the last line`;
}

/** ‹ left of the line and › right of the ↺: the previous / next key line, like J / L. */
function KeyStepButton({ dir }: { dir: 1 | -1 }) {
  const s = settings.value;
  const icon = keyViewIcon(s.keyView);
  const code = dir > 0 ? s.shortcuts.nextKeyLine : s.shortcuts.prevKeyLine;
  return (
    <button
      class={`ov-step ${dir > 0 ? 'next' : 'prev'}`}
      title={`${dir > 0 ? 'Next' : 'Previous'} ${icon} line${code ? ` (${describeKey(code)})` : ''}`}
      // Like the ↺: no focus and no click through to Netflix.
      onMouseDown={(e) => (e.preventDefault(), e.stopPropagation())}
      onClick={(e) => (e.stopPropagation(), ctl().stepKeyLine(dir))}
    >
      {dir > 0 ? `${icon} ›` : `‹ ${icon}`}
    </button>
  );
}

/** ↺ right of the line: replay it (like the repeat key); Shift+click loops it, and again stops that loop. */
function RepeatButton({ index }: { index: number }) {
  const l = loop.value;
  const looping = !!l && l.from === index && l.to === index;
  const key = describeKey(settings.value.shortcuts.repeatLine);
  return (
    <button
      class={`ov-repeat${looping ? ' looping' : ''}`}
      title={`Repeat this line (${key}) · Shift+click: ${looping ? 'stop looping it' : 'loop it'}`}
      // No focus (Space would press the button instead of Netflix's play / pause) and no click through to Netflix.
      onMouseDown={(e) => (e.preventDefault(), e.stopPropagation())}
      onClick={(e) => (e.stopPropagation(), ctl().repeatShown(index, e.shiftKey))}
    >
      ↺
    </button>
  );
}

export function Overlay() {
  const s = settings.value;
  if (!s.subtitlesVisible) return null;
  // "Subtitles on video" off: while the sidebar floats, the lines show only in its window.
  if (floatOpen.value && s.floatHideVideoSubs) return null;
  const list = cues.value;
  let idx = activeIndex.value;
  if (idx < 0 && paused.value) {
    const cur = currentIndex.value;
    const now = ctl().adapter.nowMs();
    if (cur >= 0 && now != null && now - list[cur].end < LINGER_MS) idx = cur;
  }
  const cue = list[idx];
  const badge = loopBadge();
  const right = sidebarOnPage.value ? sidebarWidthPx.value : 0;
  const style = { right: `${right}px`, bottom: `${s.bottomOffset}%`, fontSize: `${s.fontSize}vh` };
  if (!cue) {
    return badge ? (
      <div class="overlay" style={style}>
        <div class="ov-block">
          <div class="ov-loop">{badge}</div>
        </div>
      </div>
    ) : null;
  }

  const sel = selection.value;
  const selRange: [number, number] | null =
    sel && sel.scope === 'overlay' && sel.cueIndex === idx ? [sel.from, sel.to] : null;
  const roman = s.showRomanization ? romanizations.value[idx] : null;
  const trans = s.showTranslation ? translations.value[idx] : null;
  const keyFlags = visibleKeys(cueKeys.value[idx], s.keyView);
  const l = loop.value;
  // "Hide text on repeats": blur the looped lines from the second pass on; hovering peeks (and pauses).
  const peek = loopTextHidden.value && !!l && idx >= l.from && idx <= l.to ? ' peek' : '';
  // "Blur video": every line blurred (the sidebar list stays readable); hovering a line shows it, and hovering the
  // translation shows the line above it too (theme.css). Holding the reveal key shows them all, and U shows this line.
  const blur = s.blurVideo ? ' blur' : '';
  const reveal = revealHeld.value || revealedLine.value === idx ? ' reveal' : '';
  // The "↺ on video" setting covers every button beside the line.
  const steps = s.overlayRepeat && !!keySelection.value;

  return (
    <div class="overlay" style={style}>
      <div class={`ov-block${reveal}`} onMouseEnter={ctl().onSubtitlesEnter} onMouseLeave={ctl().onSubtitlesLeave}>
        {badge || keyFlags ? (
          <div class="ov-badges">
            {badge ? <div class="ov-loop">{badge}</div> : null}
            {keyFlags ? (
              <div class="ov-key">
                {keyFlags.includes('s') ? '🎤' : ''}
                {keyFlags.includes('u') ? '📖' : ''}
              </div>
            ) : null}
          </div>
        ) : null}
        <div class="ov-line">
          {steps ? <KeyStepButton dir={-1} /> : null}
          <div class={`ov-main${blur}${peek}`} lang={mainLang.value}>
            <TokenLine
              cueIndex={idx}
              scope="overlay"
              text={cue.text}
              lang={mainLang.value}
              ruby={rubyFor(idx, cue.ruby)}
              words={words.value}
              highlight={s.highlightSaved}
              selRange={selRange}
            />
          </div>
          {s.overlayRepeat ? <RepeatButton index={idx} /> : null}
          {s.overlayRepeat ? <StarButton index={idx} saved={savedLines.value.has(idx)} cls="ov-star" /> : null}
          {steps ? <KeyStepButton dir={1} /> : null}
        </div>
        {roman ? <div class={`ov-roman${blur}${peek}`}>{roman}</div> : null}
        {trans ? (
          <div class={`ov-trans${s.blurTranslation || s.blurVideo ? ' blur' : ''}${peek}`} lang={s.nativeLang}>
            {trans}
          </div>
        ) : null}
      </div>
    </div>
  );
}
