import type { JSX } from 'preact';
import { memo } from 'preact/compat';
import { useMemo, useRef } from 'preact/hooks';
import { ctl } from '../app/instance';
import { selection, type Selection } from '../app/state';
import { buildRenderTokens, displayText, type Piece, type RenderToken } from '../core/ruby';
import { wordKey } from '../core/tokenize';
import type { RubySegment } from '../core/types';
import type { WordMap } from '../words/store';

interface Props {
  cueIndex: number;
  scope: Selection['scope'];
  text: string;
  lang: string;
  ruby?: RubySegment[];
  words: WordMap;
  highlight: boolean;
  /** [from, to] token range when this line holds the active selection. */
  selRange: [number, number] | null;
}

let dragging = false;

/**
 * Children of one token, as a flat keyed list. Every token renders as exactly one <span>
 * (no fragments), which keeps Preact's diff stable when a line's tokens change.
 */
function tokenChildren(token: RenderToken): (string | JSX.Element)[] {
  if (!token.isWord && token.text.includes('\n')) {
    const out: (string | JSX.Element)[] = [];
    token.text.split('\n').forEach((part, i) => {
      if (i > 0) out.push(<br key={`b${i}`} />);
      if (part) out.push(part);
    });
    return out;
  }
  return token.pieces.map((p: Piece, i) =>
    p.ruby ? (
      <ruby key={`r${i}`}>
        {p.text}
        <rt>{p.ruby}</rt>
      </ruby>
    ) : (
      p.text
    ),
  );
}

export const TokenLine = memo(function TokenLine({ cueIndex, scope, text, lang, ruby, words, highlight, selRange }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const tokens = useMemo(() => buildRenderTokens(text, lang, ruby), [text, lang, ruby]);
  const source = useMemo(() => displayText(text, ruby), [text, ruby]);
  const [lo, hi] = selRange ? [Math.min(...selRange), Math.max(...selRange)] : [-1, -1];

  const finish = () => {
    dragging = false;
    const sel = selection.peek();
    if (!sel || sel.cueIndex !== cueIndex || sel.scope !== scope || !ref.current) return;
    const a = Math.min(sel.from, sel.to);
    const b = Math.max(sel.from, sel.to);
    const first = tokens[a];
    const last = tokens[b];
    if (!first || !last) return;
    const phrase = source.slice(first.index, last.index + last.text.length).replace(/\s+/g, ' ');
    const r1 = ref.current.querySelector(`[data-k="${a}"]`)?.getBoundingClientRect();
    const r2 = ref.current.querySelector(`[data-k="${b}"]`)?.getBoundingClientRect();
    if (!r1 || !r2) return;
    const rect = new DOMRect(
      Math.min(r1.left, r2.left),
      Math.min(r1.top, r2.top),
      Math.max(r1.right, r2.right) - Math.min(r1.left, r2.left),
      Math.max(r1.bottom, r2.bottom) - Math.min(r1.top, r2.top),
    );
    // Lines in the floating window live in its own document; the popup opens there.
    ctl().openPopup(phrase, cueIndex, rect, ref.current.ownerDocument === document ? 'page' : 'float');
  };

  const onDown = (e: MouseEvent, k: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const sel = selection.peek();
    if (e.shiftKey && sel && sel.cueIndex === cueIndex && sel.scope === scope) {
      selection.value = { ...sel, to: k };
      finish();
      return;
    }
    // Shift+click on another line in the sidebar picks a loop, as it does on the rest of the row.
    if (e.shiftKey && scope === 'sidebar') {
      ctl().loopTo(cueIndex);
      return;
    }
    selection.value = { cueIndex, scope, from: k, to: k };
    dragging = true;
    (ref.current?.ownerDocument.defaultView ?? window).addEventListener('mouseup', finish, { once: true });
  };

  const onEnter = (k: number) => {
    if (!dragging) return;
    const sel = selection.peek();
    if (sel && sel.cueIndex === cueIndex && sel.scope === scope && sel.to !== k) selection.value = { ...sel, to: k };
  };

  return (
    <span class="tokens" ref={ref}>
      {tokens.map((t, k) => {
        if (!t.isWord) return <span key={k}>{tokenChildren(t)}</span>;
        const level = highlight ? words[wordKey(t.text, lang)]?.level : undefined;
        let cls = 'w';
        if (level === 'learning') cls += ' learning';
        else if (level === 'known') cls += ' known';
        if (k >= lo && k <= hi) cls += ' sel';
        return (
          <span
            key={k}
            class={cls}
            data-k={k}
            onMouseDown={(e) => onDown(e as unknown as MouseEvent, k)}
            onMouseEnter={() => onEnter(k)}
            onClick={(e) => e.stopPropagation()}
          >
            {tokenChildren(t)}
          </span>
        );
      })}
    </span>
  );
});
