import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { EMBED_MODEL, EMBED_PORT, quantize, toBase64, type EmbedCommand, type EmbedEvent } from '../core/meaning';
import { holdOffscreen, releaseOffscreen } from './offscreen-idle';

/**
 * The sentence model for 🔎 same-meaning search, in the offscreen document next to Kokoro. The background connects an
 * `EMBED_PORT` port and sends sentences; each reply has their vectors as 8-bit numbers (base64, since port messages
 * are JSON). The 8-bit model is about 23 MB, downloaded once from Hugging Face and then kept in the browser cache.
 */

// onnxruntime-web would fetch its WebAssembly from a CDN, which extension pages may not load code from.
env.backends.onnx.wasm!.wasmPaths = chrome.runtime.getURL('/ort/');

/** `pipeline` for this one task: its own type, over every task and option, is too large for TypeScript. */
const featurePipeline = pipeline as unknown as (
  task: 'feature-extraction',
  model: string,
  options: {
    device: 'wasm';
    dtype: 'q8';
    progress_callback: (info: { status: string; file?: string; loaded?: number; total?: number }) => void;
  },
) => Promise<FeatureExtractionPipeline>;

let model: Promise<FeatureExtractionPipeline> | null = null;
/** One batch at a time: the runtime can't run one model twice at once. */
let queue: Promise<unknown> = Promise.resolve();

function post(port: chrome.runtime.Port, e: EmbedEvent): void {
  try {
    port.postMessage(e);
  } catch {
    /* the background went away; it asks again */
  }
}

/** On the CPU (WebAssembly): the model is small, and the GPU stays free for Kokoro. */
function load(port: chrome.runtime.Port): Promise<FeatureExtractionPipeline> {
  if (!model) {
    const p = featurePipeline('feature-extraction', EMBED_MODEL, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (info) => {
        // The .onnx weights are nearly all of the download; config and tokenizer files would make progress jump.
        if (info.status === 'progress' && info.file?.endsWith('.onnx')) {
          post(port, { type: 'loading', progress: info.total ? (info.loaded ?? 0) / info.total : null });
        }
      },
    });
    model = p;
    p.catch(() => {
      if (model === p) model = null;
    });
  }
  return model;
}

async function embed(port: chrome.runtime.Port, cmd: EmbedCommand): Promise<void> {
  holdOffscreen();
  const run = queue.then(async () => {
    const extractor = await load(port);
    const out = await extractor(cmd.texts, { pooling: 'mean', normalize: true });
    const dims = out.dims[out.dims.length - 1];
    return { dims, data: quantize(out.data as Float32Array, dims) };
  });
  queue = run.catch(() => undefined);
  try {
    const { dims, data } = await run;
    post(port, { type: 'vectors', id: cmd.id, dims, data: toBase64(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)) });
  } catch (e) {
    post(port, { type: 'error', id: cmd.id, message: `Meaning model: ${e instanceof Error ? e.message : String(e)}` });
  } finally {
    releaseOffscreen();
  }
}

export function startEmbedder(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== EMBED_PORT) return;
    port.onMessage.addListener((cmd: EmbedCommand) => {
      if (cmd?.type === 'embed' && Array.isArray(cmd.texts)) void embed(port, cmd);
    });
  });
}
