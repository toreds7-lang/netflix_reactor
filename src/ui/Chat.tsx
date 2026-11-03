import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ctl } from '../app/instance';
import { chat, chatFocusAt, chatReading, currentIndex, cueUnits, keyUnits, mainLang, settings, showToast } from '../app/state';
import { parseAnswer, plainAnswer, QUICK_QUESTIONS, type ChatInline, type ChatMessage, type QuickQuestion } from '../core/chat';
import { languageName, sameLanguage } from '../core/langs';
import { CLAUDE_CODE_MODELS, type Settings } from '../core/settings';
import { describeKey } from '../core/shortcuts';
import { formatTime } from '../words/export';

/**
 * 💬 Chat about the episode: ask what a line means, what just happened or who someone is, in your language or the
 * one you are learning. Answers stream in, and every line they cite is a ▶ button that plays it.
 */

// Typing in the box must not reach Netflix's own keys.
const keep = (e: Event) => e.stopPropagation();
/** The box grows with the question up to this height, then scrolls. */
const MAX_BOX_PX = 140;
/** Scrolled this close to the bottom, the chat follows new text. */
const STICK_PX = 48;
const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const modelName = (id: string) =>
  CLAUDE_CODE_MODELS.find((m) => id.startsWith(m.id))?.label.replace(/\s*\(.*\)$/, '') ?? id.replace(/-\d{8}$/, '');

function providerName(s: Settings): string {
  return s.keyLinesProvider === 'openai' ? 'OpenAI' : `${modelName(s.claudeCodeModel)} with Claude Code (your Claude plan)`;
}

/** ▶ 12:34 for a line the answer cites; plays it. A number that isn't a line stays as written. */
function RefButton({ n, msg }: { n: number; msg: ChatMessage }) {
  const ref = msg.refs?.[n] ?? keyUnits.value[n];
  if (!ref) return <>[{n}]</>;
  return (
    <button class="chat-ref" title={`Play: “${short(ref.text, 120)}”`} onClick={() => ctl().chat.goTo(n, msg.refs?.[n])}>
      ▶ {formatTime(ref.start)}
    </button>
  );
}

function Inline({ parts, msg }: { parts: ChatInline[]; msg: ChatMessage }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.t === 'ref') return <RefButton key={i} n={p.n} msg={msg} />;
        const text: JSX.Element | string = p.italic ? <i>{p.text}</i> : p.text;
        return p.bold ? <b key={i}>{text}</b> : <span key={i}>{text}</span>;
      })}
    </>
  );
}

/** The answer's paragraphs and lists, with a caret while it is still being written. */
function Answer({ msg, writing }: { msg: ChatMessage; writing: boolean }) {
  const blocks = parseAnswer(msg.text);
  const caret = writing ? <span class="chat-caret" /> : null;
  return (
    <>
      {blocks.map((b, i) => {
        const last = i === blocks.length - 1;
        if (b.t === 'p') {
          return (
            <p key={i}>
              <Inline parts={b.parts} msg={msg} />
              {last && caret}
            </p>
          );
        }
        const List = b.t === 'ul' ? 'ul' : 'ol';
        return (
          <List key={i}>
            {b.items.map((it, k) => (
              <li key={k}>
                <Inline parts={it} msg={msg} />
                {last && k === b.items.length - 1 && caret}
              </li>
            ))}
          </List>
        );
      })}
    </>
  );
}

/** 🔊 on an answer: reads it aloud; ■ while it is being read. */
function ReadButton({ msg }: { msg: ChatMessage }) {
  const r = chatReading.value;
  const mine = r.status !== 'idle' && r.id === msg.id;
  const loading = mine && r.status === 'loading';
  const title = !mine
    ? 'Read this answer aloud'
    : loading
      ? r.progress != null && r.progress < 1
        ? `Loading voice… ${Math.round(r.progress * 100)}%`
        : 'Preparing voice…'
      : 'Stop reading';
  return (
    <button
      class={`icon speak${mine ? ' on' : ''}`}
      title={title}
      onClick={() => (mine ? ctl().stopReading() : void ctl().readChat(msg.id))}
    >
      {mine ? (loading ? '…' : '■') : '🔊'}
    </button>
  );
}

function copyAnswer(msg: ChatMessage, el: HTMLElement): void {
  const units = keyUnits.peek();
  const text = plainAnswer(msg.text, (n) => {
    const at = msg.refs?.[n]?.start ?? units[n]?.start;
    return at != null ? `(${formatTime(at)})` : '';
  });
  // The floating window has its own clipboard access, which needs its own focus.
  const clipboard = (el.ownerDocument.defaultView ?? window).navigator.clipboard;
  clipboard.writeText(text).then(
    () => showToast('Answer copied'),
    () => showToast('Could not copy the answer'),
  );
}

function Message({ msg, last }: { msg: ChatMessage; last: boolean }) {
  const writing = chat.value.streaming === msg.id;
  if (msg.role === 'user') {
    return (
      <div class={`chat-msg user${msg.label ? ' quick' : ''}`}>
        <div class="bubble">{msg.label ?? msg.text}</div>
        {msg.at && (
          <button
            class="chat-at"
            title={`You asked at this line: “${short(msg.at.text, 120)}”. Play it`}
            onClick={() => ctl().chat.goTo(msg.at!.n, msg.at)}
          >
            at {formatTime(msg.at.start)} · “{short(msg.at.text, 40)}”
          </button>
        )}
      </div>
    );
  }
  const empty = !msg.text.trim();
  return (
    <div class="chat-msg bot">
      <div class="bubble">
        {writing && empty ? (
          <span class="chat-typing" title="Thinking…">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <Answer msg={msg} writing={writing} />
        )}
        {msg.error && <div class="error small">{msg.error}</div>}
      </div>
      {!writing && (
        <div class="chat-actions">
          {!empty && <ReadButton msg={msg} />}
          {!empty && (
            <button class="icon" title="Copy this answer" onClick={(e) => copyAnswer(msg, e.currentTarget)}>
              📋
            </button>
          )}
          {last && (
            <button
              class={empty ? 'retry' : 'icon'}
              title="Ask this question again"
              onClick={() => ctl().chat.retry()}
            >
              {empty ? '↻ Try again' : '↻'}
            </button>
          )}
          <span class="muted small">
            {msg.stopped ? 'Stopped' : msg.error ? '' : msg.model ? modelName(msg.model) : ''}
          </span>
        </div>
      )}
    </div>
  );
}

function QuickButtons({ big = false, disabled, onAsk }: { big?: boolean; disabled: boolean; onAsk: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const atLine = (cueUnits.value[currentIndex.value] ?? -1) >= 0;
  return (
    <div
      class={`chat-quick${big ? ' big' : ''}`}
      ref={scroller}
      // One row: the mouse wheel scrolls it sideways.
      onWheel={(e) => {
        const el = scroller.current;
        if (big || !el || el.scrollWidth <= el.clientWidth || !e.deltaY) return;
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }}
    >
      {QUICK_QUESTIONS.map((q: QuickQuestion) => (
        <button
          key={q.id}
          disabled={disabled || (q.needsLine && !atLine)}
          title={q.needsLine && !atLine ? 'Play the video to a line first' : q.text}
          onClick={() => {
            onAsk();
            ctl().chat.ask(q.text, q);
          }}
        >
          {q.label}
        </button>
      ))}
    </div>
  );
}

/** The line "this line" means: the one the video is at. */
function HereLine() {
  const n = cueUnits.value[currentIndex.value] ?? -1;
  const u = keyUnits.value[n];
  if (!u) return null;
  return (
    <div class="chat-here muted small" title={`Questions are about this point of the episode: “${u.text}”`}>
      at {formatTime(u.start)} · <span lang={mainLang.value}>“{u.text}”</span>
    </div>
  );
}

export function ChatTab() {
  const s = settings.value;
  const c = chat.value;
  const units = keyUnits.value;
  const lang = mainLang.value;
  const busy = !!c.streaming;
  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const focusAt = chatFocusAt.value;

  // The chat key: the cursor goes in the box (also when it opened this tab, or the floating window's).
  useEffect(() => {
    const box = boxRef.current;
    if (!box || Date.now() - focusAt > 1500) return;
    box.ownerDocument.defaultView?.focus();
    box.focus();
  }, [focusAt]);

  // Follow new text while scrolled to the bottom; leave it alone while reading further up.
  const lastText = c.messages[c.messages.length - 1]?.text;
  useLayoutEffect(() => {
    const log = logRef.current;
    if (log && stick.current) log.scrollTop = log.scrollHeight;
  }, [c.messages.length, lastText, c.videoId]);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const fit = () => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, MAX_BOX_PX)}px`;
  };
  const follow = () => void (stick.current = true);
  const submit = () => {
    if (busy || !draft.trim()) return;
    follow();
    if (ctl().chat.ask(draft)) {
      setDraft('');
      requestAnimationFrame(fit);
    }
  };

  if (!units.length) return <div class="list-empty">Waiting for subtitles… Start playing the video.</div>;

  const empty = !c.messages.length;
  const chatKey = describeKey(s.shortcuts.openChat);
  return (
    <div class="chat">
      {!empty && (
        <div class="chat-head">
          <span class="muted small chat-provider" title={`Answers come from ${providerName(s)}, which reads the whole episode`}>
            {s.keyLinesProvider === 'openai' ? 'OpenAI' : `${modelName(s.claudeCodeModel)} · Claude Code`}
          </span>
          <button
            class={`ghost small${confirmClear ? ' danger' : ''}`}
            title="Start over: forget this episode's chat"
            onClick={() => {
              if (!confirmClear) return setConfirmClear(true);
              setConfirmClear(false);
              ctl().chat.clear();
            }}
          >
            {confirmClear ? 'Clear the chat?' : '✚ New chat'}
          </button>
        </div>
      )}
      <div
        class="chat-log"
        ref={logRef}
        onScroll={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
        }}
      >
        {empty ? (
          <div class="chat-intro">
            <div class="chat-intro-title">💬 Ask about this episode</div>
            <p>
              What a line means, slang and grammar, what just happened, who someone is. Write in {languageName(s.nativeLang)} or{' '}
              {languageName(lang)}: the answer comes in the same language
              {sameLanguage(s.nativeLang, lang) ? '' : `, in easy ${languageName(lang)} at your level (${s.learnerLevel})`}.
            </p>
            <p>
              Answers point to the lines they talk about: click <span class="chat-ref demo">▶ 12:34</span> to hear one.
            </p>
            <QuickButtons big disabled={busy} onAsk={follow} />
            <p class="muted small">
              {providerName(s)} reads all {units.length} sentences of this episode with each question. Press{' '}
              <kbd>{chatKey}</kbd> to type a question from anywhere.
            </p>
          </div>
        ) : (
          c.messages.map((m, i) => <Message key={m.id} msg={m} last={i === c.messages.length - 1} />)
        )}
      </div>
      {!empty && <QuickButtons disabled={busy} onAsk={follow} />}
      <HereLine />
      <form
        class="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={boxRef}
          class="chat-box"
          rows={1}
          value={draft}
          placeholder={`Ask about this episode… (${chatKey})`}
          title="Enter sends, Shift+Enter starts a new line, Esc leaves the box"
          onInput={(e) => {
            setDraft((e.currentTarget as HTMLTextAreaElement).value);
            fit();
          }}
          onKeyDown={(e) => {
            keep(e);
            // Korean and other input methods use Enter to finish a word: that Enter doesn't send.
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              (e.currentTarget as HTMLTextAreaElement).blur();
            }
          }}
          onKeyUp={keep}
          onKeyPress={keep}
        />
        {busy ? (
          <button type="button" class="chat-send stop" title="Stop the answer" onClick={() => ctl().chat.stop()}>
            ■
          </button>
        ) : (
          <button type="submit" class="chat-send accent" title="Send (Enter)" disabled={!draft.trim()}>
            ➤
          </button>
        )}
      </form>
    </div>
  );
}
