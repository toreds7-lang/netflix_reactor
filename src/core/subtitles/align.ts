import type { Cue } from '../types';
import { flatten } from './clean';

function overlap(a: Cue, b: Cue): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/**
 * Align a second-language (human translated) track to the main track by timing.
 * Each translation cue is assigned to the main cue it overlaps most; main cues that
 * received nothing fall back to their best-overlapping translation cue.
 * Both inputs must be sorted by start time.
 */
export function alignTranslation(main: Cue[], other: Cue[]): (string | null)[] {
  const assigned: number[][] = main.map(() => []);
  let lo = 0;
  for (let j = 0; j < other.length; j++) {
    const o = other[j];
    while (lo < main.length && main[lo].end <= o.start) lo++;
    let best = -1;
    let bestOv = 0;
    for (let i = lo; i < main.length && main[i].start < o.end; i++) {
      const ov = overlap(main[i], o);
      if (ov > bestOv) {
        bestOv = ov;
        best = i;
      }
    }
    if (best >= 0) assigned[best].push(j);
  }

  const result: (string | null)[] = new Array(main.length).fill(null);
  let lo2 = 0;
  for (let i = 0; i < main.length; i++) {
    if (assigned[i].length) {
      result[i] = assigned[i].map((j) => flatten(other[j].text)).join(' ');
      continue;
    }
    const m = main[i];
    while (lo2 < other.length && other[lo2].end <= m.start) lo2++;
    let best = -1;
    let bestOv = 0;
    for (let j = lo2; j < other.length && other[j].start < m.end; j++) {
      const ov = overlap(m, other[j]);
      if (ov > bestOv) {
        bestOv = ov;
        best = j;
      }
    }
    if (best >= 0) result[i] = flatten(other[best].text);
  }
  return result;
}
