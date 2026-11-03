import type { AnalysisRecord } from '../core/analyses';
import type { SavedSentence, SavedWord } from '../core/types';

export function netflixLink(videoId?: string, timeMs?: number): string {
  if (!videoId) return '';
  const t = timeMs != null ? `?t=${Math.max(0, Math.floor(timeMs / 1000))}` : '';
  return `https://www.netflix.com/watch/${videoId}${t}`;
}

export function formatTime(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Quote a CSV cell; neutralize spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CSV_COLUMNS: [string, (w: SavedWord) => unknown][] = [
  ['word', (w) => w.word],
  ['lemma', (w) => w.lemma],
  ['reading', (w) => w.reading],
  ['translation', (w) => w.translation],
  ['level', (w) => w.level],
  ['language', (w) => w.lang],
  ['sentence', (w) => w.sentence],
  ['sentence_translation', (w) => w.sentenceTranslation],
  ['title', (w) => w.title],
  ['time', (w) => formatTime(w.timeMs)],
  ['link', (w) => netflixLink(w.videoId, w.timeMs)],
  ['created', (w) => new Date(w.createdAt).toISOString()],
];

export function toCsv(words: SavedWord[]): string {
  const header = CSV_COLUMNS.map(([name]) => name).join(',');
  const rows = words.map((w) => CSV_COLUMNS.map(([, get]) => csvCell(get(w))).join(','));
  // BOM so Excel opens UTF-8 (CJK etc.) correctly.
  return `﻿${[header, ...rows].join('\r\n')}\r\n`;
}

export interface Backup {
  app: 'polyglot-player';
  /** 1: words only. 2: also saved key lines and summaries. 3: also saved sentences. */
  version: 1 | 2 | 3;
  exportedAt: string;
  words: SavedWord[];
  analyses?: AnalysisRecord[];
  sentences?: SavedSentence[];
}

export function toBackup(words: SavedWord[], analyses: AnalysisRecord[] = [], sentences: SavedSentence[] = []): string {
  const backup: Backup = { app: 'polyglot-player', version: 3, exportedAt: new Date().toISOString(), words, analyses, sentences };
  return JSON.stringify(backup, null, 2);
}

/**
 * Words, saved results and sentences from a backup file. Results and sentences are checked when they are stored
 * (`importAnalyses`, `importSentences`).
 */
export function parseBackup(json: string): { words: SavedWord[]; analyses: unknown[]; sentences: unknown[] } {
  const data = JSON.parse(json) as Partial<Backup> | SavedWord[];
  const list = Array.isArray(data) ? data : data.words;
  if (!Array.isArray(list)) throw new Error('Not a Polyglot Player backup file.');
  return {
    words: list.filter((w) => w && typeof w.key === 'string' && typeof w.word === 'string'),
    analyses: !Array.isArray(data) && Array.isArray(data.analyses) ? data.analyses : [],
    sentences: !Array.isArray(data) && Array.isArray(data.sentences) ? data.sentences : [],
  };
}

const SENTENCE_COLUMNS: [string, (s: SavedSentence) => unknown][] = [
  ['sentence', (s) => s.text],
  ['translation', (s) => s.translation],
  ['note', (s) => s.note],
  ['language', (s) => s.lang],
  ['title', (s) => s.title],
  ['time', (s) => formatTime(s.startMs)],
  ['link', (s) => netflixLink(s.videoId, s.startMs)],
  ['practised', (s) => s.practiced],
  ['next_review', (s) => new Date(s.srs.due).toISOString()],
  ['created', (s) => new Date(s.createdAt).toISOString()],
];

export function sentencesToCsv(list: SavedSentence[]): string {
  const header = SENTENCE_COLUMNS.map(([name]) => name).join(',');
  const rows = list.map((s) => SENTENCE_COLUMNS.map(([, get]) => csvCell(get(s))).join(','));
  // BOM so Excel opens UTF-8 correctly, as for words.
  return `﻿${[header, ...rows].join('\r\n')}\r\n`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Wrap occurrences of `word` in the sentence with <b>, escaping everything else. */
export function highlightInSentence(sentence: string, word: string): string {
  if (!word) return escapeHtml(sentence);
  const idx = sentence.toLocaleLowerCase().indexOf(word.toLocaleLowerCase());
  if (idx < 0) return escapeHtml(sentence);
  return (
    escapeHtml(sentence.slice(0, idx)) +
    `<b>${escapeHtml(sentence.slice(idx, idx + word.length))}</b>` +
    escapeHtml(sentence.slice(idx + word.length))
  );
}

/** Front/back HTML for an Anki "Basic"-style note. */
export function ankiCard(w: SavedWord): { front: string; back: string } {
  const front = [
    `<div style="font-size:1.8em">${escapeHtml(w.word)}</div>`,
    w.reading ? `<div style="color:#888">${escapeHtml(w.reading)}</div>` : '',
    w.sentence ? `<div style="margin-top:12px">${highlightInSentence(w.sentence.replace(/\n/g, ' '), w.word)}</div>` : '',
  ].join('');
  const link = netflixLink(w.videoId, w.timeMs);
  const back = [
    `<div style="font-size:1.4em">${escapeHtml(w.translation ?? '')}</div>`,
    w.lemma && w.lemma !== w.word ? `<div>Lemma: ${escapeHtml(w.lemma)}</div>` : '',
    w.sentenceTranslation ? `<div style="margin-top:12px;color:#666">${escapeHtml(w.sentenceTranslation)}</div>` : '',
    link
      ? `<div style="margin-top:12px;font-size:.8em"><a href="${escapeHtml(link)}">${escapeHtml(w.title ?? 'Netflix')} ${escapeHtml(formatTime(w.timeMs))}</a></div>`
      : '',
  ].join('');
  return { front, back };
}
