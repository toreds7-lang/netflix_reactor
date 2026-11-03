/**
 * Same-meaning search for 🔎 Find: a small sentence model (all-MiniLM-L6-v2, English) turns each sentence into 384
 * numbers that stand for its meaning, and lines whose numbers point the same way mean nearly the same thing. The model
 * runs in the offscreen page (src/services/embed.ts); the background keeps the numbers per episode
 * (src/services/meaning.ts). They are kept as 8-bit numbers, a quarter of the size, which barely changes the order.
 */

export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBED_DIMS = 384;
/** Port from the background to the offscreen page. */
export const EMBED_PORT = 'polyglot-embed';
/** Sentences per request to the model. */
export const EMBED_BATCH = 32;
/**
 * Lines less alike than this are not shown as "same meaning". Measured with this model: "I'm starving." is 0.75 like
 * "I'm so hungry.", 0.61 like "Let's get something to eat.", 0.48 like "I haven't eaten all day.", and at most 0.30
 * like unrelated lines.
 */
export const MIN_SIMILARITY = 0.45;

export type EmbedCommand = { type: 'embed'; id: number; texts: string[] };
export type EmbedEvent =
  | { type: 'vectors'; id: number; data: string; dims: number }
  | { type: 'error'; id: number; message: string }
  | { type: 'loading'; progress: number | null };

/**
 * Vectors laid end to end (`dims` numbers each) as 8-bit numbers, each scaled so its largest number is ±127. Only a
 * vector's direction matters, so each may have its own scale.
 */
export function quantize(flat: ArrayLike<number>, dims: number): Int8Array {
  const n = Math.floor(flat.length / dims);
  const out = new Int8Array(n * dims);
  for (let v = 0; v < n; v++) {
    const from = v * dims;
    let max = 0;
    for (let i = from; i < from + dims; i++) max = Math.max(max, Math.abs(flat[i]));
    const k = max ? 127 / max : 0;
    for (let i = from; i < from + dims; i++) out[i] = Math.round(flat[i] * k);
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** The length of each vector, to turn a dot product into a similarity. */
export function vectorNorms(data: Int8Array, dims: number): Float32Array {
  const n = Math.floor(data.length / dims);
  const out = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    let sum = 0;
    for (let i = v * dims, end = i + dims; i < end; i++) sum += data[i] * data[i];
    out[v] = Math.sqrt(sum);
  }
  return out;
}

export interface VectorSet<K> {
  key: K;
  data: Int8Array;
  norms: Float32Array;
}

export interface Similar<K> {
  key: K;
  /** The vector's place in its set (the sentence's place in its episode). */
  index: number;
  /** Cosine similarity, -1 to 1. */
  score: number;
}

/** The `k` vectors most like `query` across all sets, at least `min` alike, best first. */
export function mostSimilar<K>(query: Int8Array, sets: VectorSet<K>[], dims: number, k: number, min = MIN_SIMILARITY): Similar<K>[] {
  let qn = 0;
  for (let i = 0; i < dims; i++) qn += query[i] * query[i];
  qn = Math.sqrt(qn);
  if (!qn) return [];
  const top: Similar<K>[] = [];
  for (const set of sets) {
    const n = set.norms.length;
    for (let v = 0; v < n; v++) {
      const dn = set.norms[v];
      if (!dn) continue;
      let dot = 0;
      for (let i = 0, j = v * dims; i < dims; i++, j++) dot += query[i] * set.data[j];
      const score = dot / (qn * dn);
      if (score < min || (top.length >= k && score <= top[top.length - 1].score)) continue;
      top.push({ key: set.key, index: v, score });
      top.sort((a, b) => b.score - a.score);
      if (top.length > k) top.pop();
    }
  }
  return top;
}

/** A short fingerprint of an episode's sentences, so its vectors are made again when they change. */
export function textsHash(texts: string[]): string {
  let h = 0x811c9dc5;
  for (const t of texts) {
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x1e;
    h = Math.imul(h, 0x01000193);
  }
  return `${texts.length}:${(h >>> 0).toString(16)}`;
}
