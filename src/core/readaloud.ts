import { baseLang } from './langs';
import type { EpisodeSummary } from './types';

/** Kokoro-82M (ONNX) on Hugging Face; downloaded once by the offscreen page, then served from the browser cache. */
export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
/** Name of the runtime port between a page and the offscreen Kokoro reader. */
export const KOKORO_PORT = 'kokoro';

/** Kokoro's American English female voices, best first (grades from the Kokoro-82M voice list). */
export const KOKORO_VOICES = [
  { id: 'af_heart', label: 'Heart (A, best)' },
  { id: 'af_bella', label: 'Bella (A-)' },
  { id: 'af_nicole', label: 'Nicole (B-, soft)' },
  { id: 'af_aoede', label: 'Aoede (C+)' },
  { id: 'af_kore', label: 'Kore (C+)' },
  { id: 'af_sarah', label: 'Sarah (C+)' },
  { id: 'af_nova', label: 'Nova (C)' },
  { id: 'af_alloy', label: 'Alloy (C)' },
  { id: 'af_sky', label: 'Sky (C-)' },
] as const;
export type KokoroVoice = (typeof KOKORO_VOICES)[number]['id'];

/** Where Kokoro runs: auto = WebGPU when the browser has a GPU adapter, otherwise WebAssembly on the CPU. */
export type KokoroDevice = 'auto' | 'webgpu' | 'wasm';

export const READ_RATES = [0.7, 0.8, 0.9, 1, 1.1, 1.25];

/** Kokoro only speaks English in the browser (kokoro-js); other summaries use the browser's own voice. */
export function usesKokoro(lang: string): boolean {
  return baseLang(lang) === 'en';
}

/** Page <-> offscreen reader protocol over a `KOKORO_PORT` port. Closing the port stops reading. */
export type KokoroCommand = { type: 'read'; texts: string[]; voice: KokoroVoice; rate: number; device: KokoroDevice };
export type KokoroEvent =
  /** The model is loading; `progress` is the downloaded share (0-1) on first use, null when it is unknown. */
  | { type: 'loading'; progress: number | null }
  /** Item `index` of the texts just started playing. */
  | { type: 'item'; index: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** One piece read aloud: a sentence of the overview or a scene, a character, or a scene title. */
export interface ReadItem {
  /** 'overview', `cast:<i>`, `title:<scene>` or `scene:<scene>`: the block the item highlights. */
  key: string;
  /** The text as shown, with its trailing space, so a block's items join back into its paragraph. */
  text: string;
  /** What is spoken. */
  speech: string;
}

export interface ReadingScript {
  items: ReadItem[];
  /** First and last item of each part that has its own 🔊 button. */
  ranges: { overview?: [number, number]; cast?: [number, number]; scenes: [number, number][] };
}

/** Kokoro truncates input past ~510 phonemes, so longer sentences are split at a clause boundary. */
const MAX_CHARS = 280;
const ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|No)\.\s*$/;

/** Sentences of `text` as shown (trailing whitespace kept); long ones are cut at commas or dashes. */
export function splitSentences(text: string, lang: string): string[] {
  const seg = new Intl.Segmenter(lang || 'en', { granularity: 'sentence' });
  const out: string[] = [];
  for (const { segment } of seg.segment(text)) {
    // ICU breaks after "Mr." and friends; keep "Mr. Smith" together.
    if (out.length && ABBREVIATION.test(out[out.length - 1])) out[out.length - 1] += segment;
    else out.push(segment);
  }
  return out.flatMap(splitLong).filter((s) => s.trim());
}

function splitLong(s: string): string[] {
  const parts: string[] = [];
  let rest = s;
  while (rest.trim().length > MAX_CHARS) {
    const window = rest.slice(0, MAX_CHARS);
    const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' – '), window.lastIndexOf(' — '));
    const at = cut > MAX_CHARS / 3 ? cut + 2 : window.lastIndexOf(' ') + 1 || MAX_CHARS;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  return [...parts, rest];
}

const withStop = (s: string) => (/[.!?。！？…]["'”’)]?$/.test(s) ? s : `${s}.`);

/** The summary in reading order: overview, who's who, then each scene's title and summary. */
export function buildReadingScript(summary: EpisodeSummary, lang: string): ReadingScript {
  const items: ReadItem[] = [];
  const push = (key: string, text: string, speech = text.trim()) => {
    if (speech) items.push({ key, text, speech });
  };
  const range = (from: number): [number, number] | undefined => (items.length > from ? [from, items.length - 1] : undefined);

  let from = items.length;
  for (const s of splitSentences(summary.overview, lang)) push('overview', s);
  const overview = range(from);

  from = items.length;
  summary.characters.forEach((c, i) => push(`cast:${i}`, '', withStop(c.role ? `${c.name}: ${c.role}` : c.name)));
  const cast = range(from);

  const scenes = summary.scenes.map((sc, i): [number, number] => {
    const start = items.length;
    if (sc.title) push(`title:${i}`, '', withStop(sc.title));
    for (const s of splitSentences(sc.summary, lang)) push(`scene:${i}`, s);
    return [start, items.length - 1];
  });
  return { items, ranges: { overview, cast, scenes } };
}

/** 16-bit mono PCM WAV of `samples` (-1..1), half the size of the float WAV kokoro-js produces. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ascii = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return buf;
}
