import { env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import {
  encodeWav,
  KOKORO_MODEL,
  KOKORO_PORT,
  type KokoroCommand,
  type KokoroDevice,
  type KokoroEvent,
  type KokoroVoice,
} from '../core/readaloud';
import { cacheGet, cacheSet, hashKey } from './cache';
import { closeWhenIdle, holdOffscreen, releaseOffscreen } from './offscreen-idle';

/**
 * Kokoro text-to-speech in the offscreen document. A page connects a `KOKORO_PORT` port and sends a `read`
 * command; this generates the texts one at a time (the next while the current one plays), caches each clip and
 * plays them, reporting which item is playing. One reader at a time: a new `read` stops the previous one.
 */

// onnxruntime-web would fetch its WebAssembly from a CDN, which extension pages may not load code from.
env.backends.onnx.wasm!.wasmPaths = chrome.runtime.getURL('/ort/');

interface Session {
  port: chrome.runtime.Port;
  stopped: boolean;
}

let model: { device: KokoroDevice; tts: Promise<KokoroTTS> } | null = null;
let session: Session | null = null;
/** Clips are generated one at a time; the runtime can't run one model twice at once. */
let queue: Promise<unknown> = Promise.resolve();
const audio = new Audio();

async function pickDevice(want: KokoroDevice): Promise<'webgpu' | 'wasm'> {
  if (want !== 'auto') return want;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  return (await gpu?.requestAdapter().catch(() => null)) ? 'webgpu' : 'wasm';
}

/**
 * fp32 on both devices: it is what Kokoro runs correctly at on WebGPU, and on the CPU it is about twice as fast as
 * the 8-bit model (whose quantized operators are slow in WebAssembly). One 326 MB download serves both.
 */
function fromPretrained(device: 'webgpu' | 'wasm'): Promise<KokoroTTS> {
  return KokoroTTS.from_pretrained(KOKORO_MODEL, {
    device,
    dtype: 'fp32',
    progress_callback: (p) => {
      // The .onnx weights are nearly all of the download; config and tokenizer files would make progress jump.
      if (p.status !== 'progress' || !p.file.endsWith('.onnx') || !session) return;
      post(session, { type: 'loading', progress: p.total ? p.loaded / p.total : null });
    },
  });
}

function loadModel(want: KokoroDevice): Promise<KokoroTTS> {
  if (model?.device === want) return model.tts;
  void model?.tts.then((old) => old.model.dispose()).catch(() => undefined);
  const tts = (async () => {
    const device = await pickDevice(want);
    try {
      return await fromPretrained(device);
    } catch (e) {
      // A GPU adapter that can't run the model: fall back to the CPU when the device was chosen automatically.
      if (want !== 'auto' || device === 'wasm') throw e;
      return fromPretrained('wasm');
    }
  })();
  model = { device: want, tts };
  tts.catch(() => {
    if (model?.tts === tts) model = null;
  });
  return tts;
}

class Stopped extends Error {}

/** WAV for `text`, from the cache or generated (queued behind other generations). */
async function clip(text: string, voice: KokoroVoice, device: KokoroDevice, s: Session): Promise<Blob> {
  // The voice and text decide the clip; WebGPU and CPU output sound the same, so they share the cache.
  const key = await hashKey(['kokoro', KOKORO_MODEL, voice, text]);
  const hit = await cacheGet<ArrayBuffer>('tts', key);
  if (hit) return new Blob([hit], { type: 'audio/wav' });
  const run = queue.then(async () => {
    if (s.stopped) throw new Stopped();
    const tts = await loadModel(device);
    const out = await tts.generate(text, { voice });
    return encodeWav(out.audio, out.sampling_rate);
  });
  queue = run.catch(() => undefined);
  const wav = await run;
  await cacheSet('tts', key, wav);
  return new Blob([wav], { type: 'audio/wav' });
}

function play(blob: Blob, rate: number, s: Session): Promise<void> {
  const url = URL.createObjectURL(blob);
  const listening = new AbortController();
  return new Promise<void>((resolve, reject) => {
    const done = (err?: unknown) => {
      listening.abort();
      URL.revokeObjectURL(url);
      if (err && !s.stopped) reject(err instanceof Error ? err : new Error('Audio playback failed.'));
      else resolve();
    };
    const opts = { signal: listening.signal };
    audio.addEventListener('ended', () => done(), opts);
    audio.addEventListener('error', () => done(new Error(audio.error?.message || 'Audio playback failed.')), opts);
    audio.addEventListener('pause', () => s.stopped && done(), opts);
    audio.src = url;
    // A new source resets playbackRate to the default rate. Pitch is preserved.
    audio.defaultPlaybackRate = audio.playbackRate = rate;
    audio.play().catch(done);
  });
}

function post(s: Session, e: KokoroEvent): void {
  try {
    s.port.postMessage(e);
  } catch {
    stop(s); // the page went away
  }
}

function stop(s: Session | null): void {
  if (!s || s.stopped) return;
  s.stopped = true;
  if (session === s) {
    session = null;
    audio.pause();
  }
}

async function read(port: chrome.runtime.Port, cmd: KokoroCommand): Promise<void> {
  stop(session);
  holdOffscreen();
  const s: Session = { port, stopped: false };
  session = s;
  const { texts, voice, device } = cmd;
  const rate = Math.max(0.5, Math.min(2, cmd.rate || 1));
  try {
    let next: Promise<Blob> | null = texts.length ? clip(texts[0], voice, device, s) : null;
    for (let i = 0; next; i++) {
      const blob = await next;
      if (s.stopped) return;
      next = i + 1 < texts.length ? clip(texts[i + 1], voice, device, s) : null;
      next?.catch(() => undefined); // reported when awaited
      post(s, { type: 'item', index: i });
      await play(blob, rate, s);
      if (s.stopped) return;
    }
    post(s, { type: 'done' });
  } catch (e) {
    if (!s.stopped && !(e instanceof Stopped)) post(s, { type: 'error', message: `Kokoro: ${e instanceof Error ? e.message : String(e)}` });
  } finally {
    stop(s);
    releaseOffscreen();
  }
}

export function startKokoroReader(): void {
  closeWhenIdle();
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== KOKORO_PORT) return;
    port.onMessage.addListener((cmd: KokoroCommand) => {
      if (cmd?.type === 'read') void read(port, cmd);
    });
    port.onDisconnect.addListener(() => {
      if (session?.port === port) stop(session);
    });
  });
}
