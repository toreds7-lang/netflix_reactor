import { ctl } from '../app/instance';
import { floatOpen, helpOpen, resumeOffer, settings, sidebarOnPage, sidebarWidthPx, toast, videoId, warmupOffer } from '../app/state';
import { SHORTCUT_LABELS, type ShortcutAction } from '../core/settings';
import { describeShortcut } from '../core/shortcuts';
import { formatTime } from '../words/export';
import { Overlay } from './Overlay';
import { Sidebar, SidebarHandle } from './Sidebar';
import { WordPopup } from './WordPopup';

export function Help() {
  if (!helpOpen.value) return null;
  const map = settings.value.shortcuts;
  return (
    <div class="modal-backdrop" onClick={() => (helpOpen.value = false)}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <b>Keyboard shortcuts</b>
          <button class="icon" onClick={() => (helpOpen.value = false)}>
            ✕
          </button>
        </div>
        <table class="keys">
          <tbody>
            {(Object.keys(SHORTCUT_LABELS) as ShortcutAction[]).map((a) => (
              <tr key={a}>
                <td>
                  <kbd>{describeShortcut(a, map[a])}</kbd>
                </td>
                <td>{SHORTCUT_LABELS[a]}</td>
              </tr>
            ))}
            <tr>
              <td>
                <kbd>Space</kbd>
              </td>
              <td>Play / pause (Netflix)</td>
            </tr>
            <tr>
              <td>
                <kbd>Click</kbd> / <kbd>Drag</kbd>
              </td>
              <td>Look up a word / a phrase (Shift+click extends)</td>
            </tr>
            <tr>
              <td>
                <kbd>Shift</kbd>+<kbd>Click</kbd>
              </td>
              <td>On a line in the sidebar: loop from the line playing now (or the loop's first line) to that line</td>
            </tr>
            <tr>
              <td>
                <kbd>1</kbd>–<kbd>4</kbd>
              </td>
              <td>After a ⭐ practice drill: rate it (Again / Hard / Good / Easy)</td>
            </tr>
            <tr>
              <td>
                <kbd>Esc</kbd>
              </td>
              <td>Close popup · stop the loop or the ⭐ practice drill</td>
            </tr>
            <tr>
              <td>
                <kbd>F</kbd> · <kbd>←</kbd> <kbd>→</kbd>
              </td>
              <td>In the floating window: Netflix fullscreen · back / forward 10 s</td>
            </tr>
          </tbody>
        </table>
        <div class="muted small">Rebind keys in Options.</div>
      </div>
    </div>
  );
}

/** Offered when an episode with a bookmark or a saved position opens. */
function ResumeBanner() {
  const offer = resumeOffer.value;
  if (!offer) return null;
  const { primary, alsoLast } = offer;
  return (
    <div class="resume-box">
      <div class="resume-text">
        <div class="muted small">
          {offer.isBookmark ? '🔖 Your bookmark' : '⏱ Where you stopped'} · {formatTime(primary.timeMs)}
        </div>
        <div class="resume-line" lang={primary.lang} title={primary.text}>
          “{primary.text}”
        </div>
      </div>
      <button class="on" onClick={() => ctl().continueFrom(primary)}>
        Continue
      </button>
      {alsoLast && (
        <button title={`Where you stopped: “${alsoLast.text}”`} onClick={() => ctl().continueFrom(alsoLast)}>
          ⏱ {formatTime(alsoLast.timeMs)}
        </button>
      )}
      <button class="icon" title="Dismiss" onClick={() => (resumeOffer.value = null)}>
        ✕
      </button>
    </div>
  );
}

/** Offered when an episode opens and saved sentences are due: practise them first, with the original voices. */
function WarmupBanner() {
  const w = warmupOffer.value;
  if (!w) return null;
  return (
    <div class="resume-box warmup">
      <div class="resume-text">
        <div class="muted small">⭐ Warm-up</div>
        <div class="resume-line">
          {w.due} saved {w.due === 1 ? 'sentence is' : 'sentences are'} due for practice
          {w.here ? ` · ${w.here} from this episode` : ''}
        </div>
      </div>
      <button class="on" title="Shadow them now, one after another" onClick={() => ctl().startDuePractice()}>
        Practise
      </button>
      <button class="icon" title="Not now" onClick={() => (warmupOffer.value = null)}>
        ✕
      </button>
    </div>
  );
}

/** The Continue and warm-up offers, stacked at the top of the video. */
function Banners() {
  if (!resumeOffer.value && !warmupOffer.value) return null;
  return (
    <div class="resume" style={{ right: `${sidebarOnPage.value ? sidebarWidthPx.value : 0}px` }}>
      <ResumeBanner />
      <WarmupBanner />
    </div>
  );
}

export function Toast() {
  const t = toast.value;
  return t ? <div class="toast">{t}</div> : null;
}

export function App() {
  // When switched off only the toast stays, so "Extension off" is confirmed.
  if (!settings.value.enabled) return <Toast />;
  if (!videoId.value) return null;
  return (
    <>
      <Overlay />
      <Sidebar />
      <SidebarHandle />
      <WordPopup where="page" />
      <Banners />
      {/* While the sidebar floats, the shortcut list opens in its window. */}
      {!floatOpen.value && <Help />}
      <Toast />
    </>
  );
}
