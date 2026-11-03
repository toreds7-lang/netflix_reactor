import type { Cue, RubySegment } from '../types';
import { tidyText } from './entities';

const NS_TTP = 'http://www.w3.org/ns/ttml#parameter';
const NS_TTS = 'http://www.w3.org/ns/ttml#styling';

interface TimeBase {
  tickRate: number;
  frameRate: number;
}

function attr(el: Element, ns: string, local: string, prefixed: string): string | null {
  return el.getAttributeNS(ns, local) ?? el.getAttribute(prefixed);
}

export function parseTtmlTime(value: string | null, base: TimeBase): number {
  if (!value) return NaN;
  const v = value.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(\d+(?:\.\d+)?)t$/.exec(v))) return (parseFloat(m[1]) / base.tickRate) * 1000;
  if ((m = /^(\d+(?:\.\d+)?)(h|m|s|ms|f)$/.exec(v))) {
    const n = parseFloat(m[1]);
    switch (m[2]) {
      case 'h':
        return n * 3_600_000;
      case 'm':
        return n * 60_000;
      case 's':
        return n * 1000;
      case 'ms':
        return n;
      case 'f':
        return (n / base.frameRate) * 1000;
    }
  }
  if ((m = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(v))) {
    const frac = m[4] ? parseFloat(`0.${m[4]}`) : 0;
    return (parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + frac) * 1000;
  }
  if ((m = /^(\d+):(\d{2}):(\d{2}):(\d+)$/.exec(v))) {
    return (
      (parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) * 1000 +
      (parseInt(m[4], 10) / base.frameRate) * 1000
    );
  }
  return NaN;
}

function rubyRole(el: Element): string | null {
  return attr(el, NS_TTS, 'ruby', 'tts:ruby');
}

function findRubyPart(el: Element, role: 'base' | 'text'): string {
  const all = Array.from(el.getElementsByTagName('*'));
  const direct = all.filter((d) => rubyRole(d) === role);
  if (direct.length) return direct.map((d) => d.textContent ?? '').join('');
  return all.find((d) => rubyRole(d) === `${role}Container`)?.textContent ?? '';
}

/** Walk a <p> and collect text as ruby segments ('\n' for <br/>). */
function collect(node: Node, out: RubySegment[]): void {
  if (node.nodeType === 3) {
    const t = (node.nodeValue ?? '').replace(/[\r\n\t]+/g, ' ');
    if (t) out.push({ base: t });
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const name = el.localName;
  if (name === 'br') {
    out.push({ base: '\n' });
    return;
  }
  const role = rubyRole(el);
  if (role === 'container') {
    const base = findRubyPart(el, 'base');
    const ruby = findRubyPart(el, 'text');
    if (base) out.push({ base, ruby: ruby || undefined });
    return;
  }
  if (role === 'text' || role === 'textContainer') return;
  for (const child of Array.from(el.childNodes)) collect(child, out);
}

function mergePlain(segments: RubySegment[]): RubySegment[] {
  const merged: RubySegment[] = [];
  for (const s of segments) {
    const prev = merged[merged.length - 1];
    if (prev && !prev.ruby && !s.ruby) prev.base += s.base;
    else merged.push({ ...s });
  }
  return merged;
}

export function parseTtml(xml: string): Cue[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (!root || root.getElementsByTagName('parsererror').length) return [];
  const tickRate = parseFloat(attr(root, NS_TTP, 'tickRate', 'ttp:tickRate') ?? '') || 10_000_000;
  const frameRate = parseFloat(attr(root, NS_TTP, 'frameRate', 'ttp:frameRate') ?? '') || 30;
  const base: TimeBase = { tickRate, frameRate };

  const cues: Cue[] = [];
  // Unprefixed <p> (Netflix) first; namespace-wildcard lookup catches prefixed documents (<tt:p>).
  const plain = doc.getElementsByTagName('p');
  const ps = Array.from(plain.length ? plain : doc.getElementsByTagNameNS('*', 'p'));
  for (const p of ps) {
    const start = parseTtmlTime(p.getAttribute('begin'), base);
    let end = parseTtmlTime(p.getAttribute('end'), base);
    if (!Number.isFinite(end)) {
      const dur = parseTtmlTime(p.getAttribute('dur'), base);
      end = start + dur;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const segments: RubySegment[] = [];
    collect(p, segments);
    const hasRuby = segments.some((s) => s.ruby);
    const text = tidyText(segments.map((s) => s.base).join(''));
    if (!text) continue;
    cues.push({
      start: Math.round(start),
      end: Math.round(end),
      text,
      ...(hasRuby ? { ruby: mergePlain(segments) } : {}),
    });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}
