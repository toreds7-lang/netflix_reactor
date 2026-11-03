import { useEffect, useState } from 'preact/hooks';
import { NATIVE_LANGUAGES } from '../../core/langs';
import { MIN_VIDEO_PX, SIDEBAR_MIN_PX, type Settings, type TranslationSource } from '../../core/settings';
import { describeKey } from '../../core/shortcuts';
import { clearLineTimings, countLineTimingVideos } from '../../lineends/store';
import { ReadAloudCard } from './ReadAloudCard';

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

interface Props {
  s: Settings;
  update: (patch: Partial<Settings>) => void;
}

export function Toggle({ s, update, k, label, hint }: Props & { k: BoolKey; label: string; hint?: string }) {
  return (
    <label class="switch">
      <span>
        {label}
        {hint ? <div class="muted small">{hint}</div> : null}
      </span>
      <input type="checkbox" checked={s[k]} onChange={() => update({ [k]: !s[k] })} />
    </label>
  );
}

/**
 * The widest the sidebar slider goes: what leaves the video its minimum on this screen (the Netflix page may fit the
 * sidebar narrower in a smaller window), and never short of the width already set, e.g. by dragging on a wider screen.
 */
function sidebarMaxPx(current: number): number {
  return Math.max(600, current, Math.floor((screen.width - MIN_VIDEO_PX) / 10) * 10);
}

export function Range({
  label,
  value,
  min,
  max,
  step,
  unit,
  onInput,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onInput: (v: number) => void;
}) {
  return (
    <label class="setting">
      <span>{label}</span>
      <div class="row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onInput={(e) => onInput(parseFloat((e.target as HTMLInputElement).value))}
          style={{ flex: 1 }}
        />
        <span class="muted" style={{ width: '64px' }}>
          {value}
          {unit}
        </span>
      </div>
    </label>
  );
}

/**
 * For subtitles that don't match the speech: pause later and start earlier everywhere, or fix single lines with the
 * extend and start keys.
 */
function LineTimingSettings({ s, update }: Props) {
  const [saved, setSaved] = useState<number | null>(null);
  useEffect(() => {
    countLineTimingVideos()
      .then(setSaved)
      .catch(() => setSaved(0));
  }, []);
  // Each has a second key (M and N by default).
  const bound = (...codes: string[]) => codes.map(describeKey).filter((k) => k !== '—');
  const endKeys = bound(s.shortcuts.extendLine, s.shortcuts.extendLine2);
  const startKeys = bound(s.shortcuts.startEarlier, s.shortcuts.startEarlier2);
  const keys = [...endKeys, ...startKeys];
  const forget = async () => {
    if (!confirm('Forget the line starts and endings saved in every episode?')) return;
    await clearLineTimings();
    setSaved(0);
  };
  return (
    <>
      <Range label="Pause later by" value={s.pauseDelay} min={0} max={1000} step={50} unit=" ms" onInput={(v) => update({ pauseDelay: v })} />
      <p class="muted small">
        If many lines stop just before the speaker finishes, auto-pause waits this much longer after every line (loops too). The line
        stays on screen in the meantime.
      </p>
      <Range label="Start lines earlier by" value={s.startEarly} min={0} max={1000} step={50} unit=" ms" onInput={(v) => update({ startEarly: v })} />
      <p class="muted small">
        If the first word is often missing when you go to a line (repeat, previous / next, a click in the sidebar, loops), every line
        starts this much before its subtitle.
      </p>
      {keys.length > 0 && (
        <>
          <Range
            label={`Each ${keys.join(' / ')} press moves the line by`}
            value={s.extendStep}
            min={200}
            max={2000}
            step={100}
            unit=" ms"
            onInput={(v) => update({ extendStep: v })}
          />
          <p class="muted small">
            {endKeys.length > 0 && (
              <>
                When a line stops too early, press {endKeys.join(' or ')} right away to hear a bit more; press again for more. If that
                runs into the next line, playing on goes back to where the next line starts.{' '}
              </>
            )}
            {startKeys.length > 0 && (
              <>When a line's first words are missing, press {startKeys.join(' or ')} while it plays to start it earlier. </>
            )}
            Each change is saved for that line in that episode, so auto-pause, repeat and loops use it next time. With Shift, the key
            takes some off again.
          </p>
        </>
      )}
      <div class="row">
        <button disabled={!saved} onClick={forget}>
          Forget saved line starts and endings{saved ? ` (${saved} ${saved === 1 ? 'episode' : 'episodes'})` : ''}
        </button>
      </div>
    </>
  );
}

/** Which side of the floating window the list is on, and going back to the automatic column width. */
function FloatColumns({ s, update }: Props) {
  const key = describeKey(s.shortcuts.swapColumns);
  return (
    <>
      <Toggle
        s={s}
        update={update}
        k="floatPanelLeft"
        label="Floating window: list on the left, big line on the right"
        hint={`When the window is wide enough for two columns. ⇄ in the window${key !== '—' ? ` or ${key}` : ''} switches it too. Drag the line between the columns to resize them.`}
      />
      {s.floatPanelShare > 0 && (
        <div class="setting">
          <span>Floating window list width</span>
          <div class="row">
            <span class="muted">{Math.round(s.floatPanelShare * 100)}% of the window, dragged there</span>
            <button onClick={() => update({ floatPanelShare: 0 })}>Automatic width</button>
          </div>
        </div>
      )}
    </>
  );
}

export function SettingsPanel({ s, update }: Props) {
  return (
    <div class="stack">
      <h2>Settings</h2>

      <div class="card">
        <h3 style={{ marginTop: 0 }}>Translation</h3>
        <label class="setting">
          <span>Translate subtitles into</span>
          <select value={s.nativeLang} onChange={(e) => update({ nativeLang: (e.target as HTMLSelectElement).value })}>
            {NATIVE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label class="setting">
          <span>Translation source</span>
          <select
            value={s.translationSource}
            onChange={(e) => update({ translationSource: (e.target as HTMLSelectElement).value as TranslationSource })}
          >
            <option value="auto">Netflix subtitles when available, otherwise machine translation</option>
            <option value="human">Netflix subtitles only</option>
            <option value="machine">Machine translation only</option>
          </select>
        </label>
        <p class="muted small">
          The main subtitle line follows the language you pick in Netflix's own subtitle menu. Netflix's human-made subtitles in your
          translation language are used as the second line when they exist.
        </p>
      </div>

      <div class="card">
        <h3 style={{ marginTop: 0 }}>Display</h3>
        <Range label="Subtitle size" value={s.fontSize} min={1.8} max={7} step={0.1} unit=" vh" onInput={(v) => update({ fontSize: v })} />
        <Range label="Distance from bottom" value={s.bottomOffset} min={2} max={40} step={1} unit=" %" onInput={(v) => update({ bottomOffset: v })} />
        <Range
          label="Sidebar width"
          value={s.sidebarWidth}
          min={SIDEBAR_MIN_PX}
          max={sidebarMaxPx(s.sidebarWidth)}
          step={10}
          unit=" px"
          onInput={(v) => update({ sidebarWidth: v })}
        />
        <FloatColumns s={s} update={update} />
        <Toggle s={s} update={update} k="showTranslation" label="Show translation line" />
        <Toggle s={s} update={update} k="blurTranslation" label="Blur translation until hovered" hint="Try to understand first, then peek." />
        <Toggle
          s={s}
          update={update}
          k="blurVideo"
          label="Blur every subtitle line on the video until hovered"
          hint={`Listen first, hover a line to read it. Hovering the translation shows the line above it too. Also blurs the big line in the floating window; the sidebar list stays readable. Shortcut: ${describeKey(s.shortcuts.toggleBlurVideo)}. Hold ${describeKey(s.shortcuts.holdReveal)} to show every line, or press ${describeKey(s.shortcuts.revealLine)} to show the line you are on until the next one.`}
        />
        <Toggle
          s={s}
          update={update}
          k="overlayRepeat"
          label="Show a ↺ repeat button right of the line on the video"
          hint="Click replays the line, like S. Shift+click loops it until you Shift+click again or press Esc. Once an episode has key lines, ‹ and › beside the line go to the previous / next key line, like J / L."
        />
        <Toggle s={s} update={update} k="showRomanization" label="Show romanization for non-Latin scripts" />
        <Toggle s={s} update={update} k="showFurigana" label="Show furigana (Japanese) / pinyin (Chinese) above characters" />
        <Toggle s={s} update={update} k="hideSoundDescriptions" label="Hide [sound descriptions] and speaker labels" />
        <Toggle s={s} update={update} k="highlightSaved" label="Highlight words you are learning" />
        <Toggle s={s} update={update} k="hideNativeSubs" label="Hide Netflix's own subtitles while ours are shown" />
      </div>

      <div class="card">
        <h3 style={{ marginTop: 0 }}>Playback</h3>
        <Toggle s={s} update={update} k="autoPause" label="Auto-pause at the end of every subtitle" hint="Shortcut: Q" />
        <LineTimingSettings s={s} update={update} />
        <Toggle s={s} update={update} k="pauseOnHover" label="Pause while the mouse is over the subtitles" />
        <Toggle s={s} update={update} k="enabled" label="Extension enabled on Netflix" />
      </div>

      <ReadAloudCard s={s} update={update} />
    </div>
  );
}
