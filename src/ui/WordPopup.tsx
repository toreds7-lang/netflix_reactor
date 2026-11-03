import { useEffect, useRef, useState } from 'preact/hooks';
import { ctl } from '../app/instance';
import {
  cues,
  floatWin,
  mainLang,
  meta,
  popup,
  settings,
  translations,
  words,
  type PopupState,
  type UiWindow,
} from '../app/state';
import { toGoogleLang } from '../core/langs';
import { send } from '../core/messages';
import { flatten } from '../core/subtitles';
import { wordKey } from '../core/tokenize';
import type { DictEntry, ExplainResult } from '../core/types';
import { FindInShows } from './Find';

const WIDTH = 380;

type Load<T> = { state: 'idle' } | { state: 'loading' } | { state: 'done'; data: T } | { state: 'error'; message: string };

function Body({ p }: { p: PopupState }) {
  const s = settings.value;
  const lang = mainLang.value;
  const [dict, setDict] = useState<Load<DictEntry>>({ state: 'loading' });
  const [explain, setExplain] = useState<Load<ExplainResult>>({ state: 'idle' });
  const saved = words.value[wordKey(p.text, lang)];

  useEffect(() => {
    let alive = true;
    setDict({ state: 'loading' });
    setExplain({ state: 'idle' });
    send('lookup', { text: p.text, from: toGoogleLang(lang), to: s.nativeLang })
      .then((data) => alive && setDict({ state: 'done', data }))
      .catch((e: Error) => alive && setDict({ state: 'error', message: e.message }));
    return () => {
      alive = false;
    };
  }, [p.text, lang, s.nativeLang]);

  const runExplain = () => {
    const list = cues.peek();
    const cue = list[p.cueIndex];
    setExplain({ state: 'loading' });
    const m = meta.peek();
    send('explainWord', {
      text: p.text,
      sentence: cue ? flatten(cue.text) : p.text,
      prevLine: list[p.cueIndex - 1] ? flatten(list[p.cueIndex - 1].text) : undefined,
      nextLine: list[p.cueIndex + 1] ? flatten(list[p.cueIndex + 1].text) : undefined,
      from: lang,
      to: s.nativeLang,
      title: m?.title,
    })
      .then((data) => setExplain({ state: 'done', data }))
      .catch((e: Error) => setExplain({ state: 'error', message: e.message }));
  };

  const dictData = dict.state === 'done' ? dict.data : null;
  const explainData = explain.state === 'done' ? explain.data : null;
  const save = (level: 'learning' | 'known') =>
    void ctl().saveWord(p.text, p.cueIndex, level, { dict: dictData, explain: explainData });

  return (
    <>
      <div class="pp-head">
        <div class="pp-word" lang={lang}>
          {p.text}
        </div>
        <button class="icon" title="Listen" onClick={() => ctl().speak(p.text)}>
          🔊
        </button>
        <button class="icon" title="Close (Esc)" onClick={() => ctl().closePopup()}>
          ✕
        </button>
      </div>
      {dictData?.romanization && dictData.romanization.toLowerCase() !== p.text.toLowerCase() ? (
        <div class="pp-reading">{dictData.romanization}</div>
      ) : null}

      <div class="pp-section">
        {dict.state === 'loading' && <div class="muted">Looking up…</div>}
        {dict.state === 'error' && <div class="error">{dict.message}</div>}
        {dictData && (
          <>
            <div class="pp-translation" lang={s.nativeLang}>
              {dictData.translation}
            </div>
            {dictData.groups.map((g) => (
              <div class="pp-group" key={g.pos}>
                <span class="pos">{g.pos}</span> {g.terms.join(', ')}
              </div>
            ))}
            {dictData.definitions.length > 0 && (
              <details class="pp-defs">
                <summary>Definitions</summary>
                {dictData.definitions.map((d) => (
                  <div key={d.pos} class="pp-group">
                    <span class="pos">{d.pos}</span>
                    <ol>
                      {d.defs.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ol>
                  </div>
                ))}
              </details>
            )}
          </>
        )}
      </div>

      <div class="pp-actions">
        <button class={saved?.level === 'learning' ? 'on' : ''} onClick={() => save('learning')}>
          ★ Learning
        </button>
        <button class={saved?.level === 'known' ? 'on' : ''} onClick={() => save('known')}>
          ✓ Known
        </button>
        {saved && (
          <button class="ghost" onClick={() => void ctl().removeWord(p.text)}>
            Remove
          </button>
        )}
        <FindInShows text={p.text} />
        <span class="spacer" />
        {explain.state === 'idle' && (
          <button class="accent" onClick={runExplain} disabled={!s.claudeApiKey} title={s.claudeApiKey ? '' : 'Add a Claude API key in Options'}>
            ✨ Explain
          </button>
        )}
      </div>

      {explain.state === 'loading' && <div class="pp-section muted">Asking Claude…</div>}
      {explain.state === 'error' && <div class="pp-section error">{explain.message}</div>}
      {explainData && (
        <div class="pp-section pp-explain">
          <div>
            <b>{explainData.lemma}</b>
            {explainData.reading ? <span class="muted"> · {explainData.reading}</span> : null}
            {explainData.partOfSpeech ? <span class="pos"> {explainData.partOfSpeech}</span> : null}
          </div>
          <div class="pp-meaning">{explainData.meaningInContext}</div>
          {explainData.grammarNote ? <div class="pp-note">{explainData.grammarNote}</div> : null}
          {explainData.examples.map((ex, i) => (
            <div class="pp-example" key={i}>
              <div lang={lang}>{ex.sentence}</div>
              <div class="muted">{ex.translation}</div>
            </div>
          ))}
          <div class="pp-model">{explainData.model}</div>
        </div>
      )}

      {translations.value[p.cueIndex] ? (
        <div class="pp-context muted">
          <span class="pos">Line</span> {translations.value[p.cueIndex]}
        </div>
      ) : null}
    </>
  );
}

/** The word popup for one window: the Netflix page, or the floating sidebar window. */
export function WordPopup({ where = 'page' }: { where?: UiWindow }) {
  const p = popup.value;
  const win = where === 'float' ? floatWin.value : window;
  const ref = useRef<HTMLDivElement>(null);

  // A click anywhere else in this window closes the popup, also one open in the other window.
  useEffect(() => {
    if (!p || !win) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current || !e.composedPath().includes(ref.current)) ctl().closePopup();
    };
    const t = setTimeout(() => win.addEventListener('mousedown', onDown, true), 0);
    return () => {
      clearTimeout(t);
      win.removeEventListener('mousedown', onDown, true);
    };
  }, [p, win]);

  if (!p || p.where !== where || !win) return null;
  // Open toward the larger free space. Anchoring by the edge nearest the word means the popup
  // grows away from it as results load, so it never covers the selection.
  const vh = win.innerHeight;
  const width = Math.min(WIDTH, win.innerWidth - 16);
  const left = Math.max(8, Math.min(win.innerWidth - width - 8, p.x - width / 2));
  const above = p.y > vh - p.bottom;
  const place = above
    ? { bottom: `${vh - p.y + 10}px`, maxHeight: `${Math.max(160, p.y - 20)}px` }
    : { top: `${p.bottom + 10}px`, maxHeight: `${Math.max(160, vh - p.bottom - 20)}px` };
  return (
    <div
      class="popup"
      ref={ref}
      style={{ width: `${width}px`, left: `${left}px`, ...place }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Body key={`${p.text}|${p.cueIndex}`} p={p} />
    </div>
  );
}
