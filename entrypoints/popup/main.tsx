import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { forgetPosition, requestResume } from '../../src/bookmarks/store';
import type { AnalysisKind } from '../../src/core/analyses';
import { resumeChoice } from '../../src/core/bookmarks';
import { NATIVE_LANGUAGES } from '../../src/core/langs';
import { send } from '../../src/core/messages';
import { dueSentences } from '../../src/core/sentences';
import type { Settings } from '../../src/core/settings';
import { describeShortcut } from '../../src/core/shortcuts';
import type { LineMark, SavedWord, VideoBookmarks } from '../../src/core/types';
import { openPracticePage, useBookmarks, useSentences, useSettings, useWords } from '../../src/pages/hooks';
import '../../src/pages/pages.css';
import { WATCH_PATH } from '../../src/sites/netflix/selectors';
import { formatTime, netflixLink } from '../../src/words/export';

const CONTINUE_SHOWN = 5;

/** Open the episode (in the current Netflix tab when there is one); its page then jumps to the line. */
async function continueVideo(videoId: string, mark: LineMark): Promise<void> {
  await requestResume(videoId);
  const url = netflixLink(videoId, mark.timeMs);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onNetflix = tab?.id != null && !!tab.url?.startsWith('https://www.netflix.com/');
  // Already watching this video: the open page picks the request up without a reload.
  if (onNetflix && WATCH_PATH.exec(new URL(tab.url!).pathname)?.[1] !== videoId) await chrome.tabs.update(tab.id!, { url });
  else if (!onNetflix) await chrome.tabs.create({ url });
  window.close();
}

function ContinueList() {
  // Episodes with only saved loops have nowhere to continue from.
  const list = (Object.values(useBookmarks()) as VideoBookmarks[])
    .filter((v) => v.bookmark || v.last)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, CONTINUE_SHOWN);
  // Mark the episodes whose key lines or summary are already saved.
  const ids = list.map((v) => v.videoId).join(',');
  const [saved, setSaved] = useState<Record<string, AnalysisKind[]>>({});
  useEffect(() => {
    if (!ids) return;
    send('savedKinds', { videoIds: ids.split(',') })
      .then(setSaved)
      .catch(() => undefined);
  }, [ids]);
  if (!list.length) return null;
  return (
    <div class="continue">
      <div class="small muted">Continue watching</div>
      {list.map((v) => {
        const c = resumeChoice(v);
        if (!c) return null;
        return (
          <div class="cw-item" key={v.videoId}>
            <button class="cw-main" title={`Continue from “${c.primary.text}”`} onClick={() => void continueVideo(v.videoId, c.primary)}>
              <div class="cw-title">
                {saved[v.videoId]?.includes('keylines') && <span title="Key lines are ready">🎤 </span>}
                {saved[v.videoId]?.includes('summary') && <span title="A summary is ready">📖 </span>}
                {v.title || `Netflix ${v.videoId}`}
              </div>
              <div class="cw-line small">
                <span class="muted">
                  {c.isBookmark ? '🔖' : '⏱'} {formatTime(c.primary.timeMs)}
                </span>{' '}
                <span lang={c.primary.lang}>{c.primary.text}</span>
              </div>
            </button>
            <button class="cw-del" title="Forget this position" onClick={() => void forgetPosition(v.videoId)}>
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Saved sentences due for practice; opens the practice page. */
function PracticeBox() {
  const [all, loaded] = useSentences();
  const total = Object.keys(all).length;
  if (!loaded || !total) return null;
  const due = dueSentences(all, Date.now()).length;
  return (
    <button
      class={`practice-box${due ? ' due' : ''}`}
      title="Practise your saved sentences with text-to-speech"
      onClick={() => void openPracticePage().then(() => window.close())}
    >
      <span class="pr-star">⭐</span>
      <span>
        <b class="pr-label">{due ? `${due} ${due === 1 ? 'sentence' : 'sentences'} to practise` : 'Nothing due today'}</b>
        <span class="small muted">{total} saved</span>
      </span>
      <span class="spacer" />
      <span class="small">{due ? 'Practise ›' : 'Open ›'}</span>
    </button>
  );
}

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

const TOGGLES: [BoolKey, string][] = [
  ['autoPause', 'Auto-pause after each line'],
  ['pauseOnHover', 'Pause while hovering subtitles'],
  ['showTranslation', 'Show translation'],
  ['blurTranslation', 'Blur translation until hover'],
  ['blurVideo', 'Blur every line on the video until hover'],
  ['showRomanization', 'Show romanization'],
  ['hideSoundDescriptions', 'Hide [sound descriptions]'],
  ['sidebarOpen', 'Show sidebar'],
];

/** The master switch. Off, Netflix plays as if the extension weren't installed; on picks the episode up again. */
function PowerButton({ s, update }: { s: Settings; update: (patch: Partial<Settings>) => void }) {
  const key = describeShortcut('toggleExtension', s.shortcuts.toggleExtension);
  return (
    <button
      class={`power${s.enabled ? ' on' : ''}`}
      aria-pressed={s.enabled}
      title={`Turn Polyglot Player ${s.enabled ? 'off' : 'on'} (${key} on Netflix)`}
      onClick={() => update({ enabled: !s.enabled })}
    >
      <span class="power-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
        </svg>
      </span>
      <span>
        <b class="power-label">{s.enabled ? 'On' : 'Off'}</b>
        <span class="small muted">{s.enabled ? 'Active on Netflix' : 'Netflix plays as usual'}</span>
      </span>
      <span class="spacer" />
      <kbd class="small muted">{key}</kbd>
    </button>
  );
}

function Popup() {
  const [s, update] = useSettings();
  const words = Object.values(useWords()) as SavedWord[];
  const learning = words.filter((w) => w.level === 'learning').length;
  const known = words.length - learning;

  return (
    <div class="popup-page">
      <header>
        <div class="brand">
          Polyglot <span>Player</span>
        </div>
      </header>

      <PowerButton s={s} update={update} />

      {/* Greyed out and not clickable while off; the button above and Options below still work. */}
      <div class="popup-body" inert={!s.enabled}>
        <label class="setting" style={{ gridTemplateColumns: '110px 1fr' }}>
          <span>Translate to</span>
          <select value={s.nativeLang} onChange={(e) => update({ nativeLang: (e.target as HTMLSelectElement).value })}>
            {NATIVE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <div>
          {TOGGLES.map(([key, label]) => (
            <label class="switch" key={key}>
              <span>{label}</span>
              <input type="checkbox" checked={s[key]} onChange={() => update({ [key]: !s[key] })} />
            </label>
          ))}
        </div>

        <PracticeBox />

        <ContinueList />

        <div class="stats">
          <div class="stat">
            <b style={{ color: 'var(--learning)' }}>{learning}</b>
            <span class="small muted">learning</span>
          </div>
          <div class="stat">
            <b style={{ color: 'var(--known)' }}>{known}</b>
            <span class="small muted">known</span>
          </div>
        </div>
      </div>

      <div class="row">
        <button class="primary" onClick={() => void chrome.runtime.openOptionsPage()}>
          Words & options
        </button>
        <span class="spacer" />
        <span class="small muted">Press ? on Netflix for shortcuts</span>
      </div>
    </div>
  );
}

render(<Popup />, document.getElementById('app')!);
