import type { Cue } from '../types';

/** Sort cues and merge those sharing identical timing (Netflix splits two speakers into two cues). */
export function mergeCues(cues: Cue[]): Cue[] {
  const sorted = [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Cue[] = [];
  for (const cue of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.start === cue.start && prev.end === cue.end) {
      if (prev.text.split('\n').includes(cue.text)) continue;
      if (prev.ruby || cue.ruby) {
        prev.ruby = [
          ...(prev.ruby ?? [{ base: prev.text }]),
          { base: '\n' },
          ...(cue.ruby ?? [{ base: cue.text }]),
        ];
      }
      prev.text = `${prev.text}\n${cue.text}`;
      continue;
    }
    out.push({ ...cue, ruby: cue.ruby ? [...cue.ruby] : undefined });
  }
  for (const c of out) if (!c.ruby) delete c.ruby;
  return out;
}

const SOUND_PATTERNS: RegExp[] = [
  /\[[^\]]*\]/g, // [door slams]
  /（[^）]*）/g, // Japanese full-width parentheses (sound effects / speaker names)
  /\([^)]*\)/g, // (laughs)
  /[♪♫]+/g,
];

const SPEAKER_LABEL = /^(?:-\s*)?[\p{Lu}][\p{Lu}\d .'’-]{1,30}:\s*/u;

/** Remove SDH annotations: sound descriptions, music notes and ALL-CAPS speaker labels. */
export function stripSoundDescriptions(text: string): string {
  let t = text;
  for (const re of SOUND_PATTERNS) t = t.replace(re, '');
  return t
    .split('\n')
    .map((line) => line.replace(SPEAKER_LABEL, (m) => (m.trimStart().startsWith('-') ? '- ' : '')).trim())
    .filter((line) => line.length > 0 && line !== '-')
    .join('\n');
}

/** Produce the display cue list, optionally without SDH annotations (dropping cues that become empty). */
export function prepareCues(cues: Cue[], hideSoundDescriptions: boolean): Cue[] {
  if (!hideSoundDescriptions) return cues;
  const out: Cue[] = [];
  for (const c of cues) {
    const text = stripSoundDescriptions(c.text);
    if (!text) continue;
    // Ruby markup can't be safely re-mapped after stripping, so drop it when text changed.
    out.push(text === c.text ? c : { start: c.start, end: c.end, text });
  }
  return out;
}

/** Single-line version of a cue for translation requests and tokenizing. */
export function flatten(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}
