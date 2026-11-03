import { baseLang } from '../core/langs';
import { send } from '../core/messages';
import { KOKORO_PORT, type KokoroCommand, type KokoroDevice, type KokoroEvent, type KokoroVoice } from '../core/readaloud';

export interface ReaderEvents {
  /** Item `index` of the texts started playing. */
  onItem(index: number): void;
  /** The voice model is loading; `progress` is 0-1 while it downloads, or null. */
  onLoading(progress: number | null): void;
  onDone(): void;
  onError(message: string): void;
}

export interface Reader {
  stop(): void;
}

/** Read `texts` with Kokoro in the offscreen document. Events stop after done, error or stop(). */
export async function readWithKokoro(
  texts: string[],
  opts: { voice: KokoroVoice; rate: number; device: KokoroDevice },
  ev: ReaderEvents,
): Promise<Reader> {
  await send('kokoroOpen', {});
  const port = chrome.runtime.connect({ name: KOKORO_PORT });
  let open = true;
  const close = () => {
    if (!open) return false;
    open = false;
    port.disconnect();
    return true;
  };
  port.onMessage.addListener((e: KokoroEvent) => {
    if (!open) return;
    if (e.type === 'item') ev.onItem(e.index);
    else if (e.type === 'loading') ev.onLoading(e.progress);
    else if (close()) {
      if (e.type === 'done') ev.onDone();
      else ev.onError(e.message);
    }
  });
  port.onDisconnect.addListener(() => {
    if (open) {
      open = false;
      ev.onError('The Kokoro reader closed unexpectedly. Try again.');
    }
  });
  port.postMessage({ type: 'read', texts, ...opts } satisfies KokoroCommand);
  return { stop: close };
}

async function voicesFor(lang: string): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  let voices = synth.getVoices();
  // Chrome fills the list asynchronously on first use.
  if (!voices.length) {
    await new Promise<void>((resolve) => {
      synth.addEventListener('voiceschanged', () => resolve(), { once: true });
      setTimeout(resolve, 1500);
    });
    voices = synth.getVoices();
  }
  return voices.filter((v) => baseLang(v.lang) === baseLang(lang));
}

/** Read `texts` with the browser's own voice for `lang`, one utterance per item so each can be highlighted. */
export async function readWithBrowserVoice(texts: string[], lang: string, rate: number, ev: ReaderEvents): Promise<Reader> {
  const synth = window.speechSynthesis;
  const matching = await voicesFor(lang);
  if (!matching.length) throw new Error(`No text-to-speech voice is installed for ${lang}.`);
  // An exact region match first (zh-TW vs zh-CN), then Google's network voices, as for word lookups.
  const voice =
    matching.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ?? matching.find((v) => /google/i.test(v.name)) ?? matching[0];
  let open = true;
  synth.cancel();
  // Keep the utterances referenced: Chrome drops events of utterances that were garbage-collected.
  const utterances = texts.map((text, i) => {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = rate;
    u.onstart = () => open && ev.onItem(i);
    u.onend = () => {
      if (open && i === texts.length - 1) {
        open = false;
        ev.onDone();
      }
    };
    u.onerror = (e) => {
      if (!open || e.error === 'interrupted' || e.error === 'canceled') return;
      open = false;
      synth.cancel();
      ev.onError(`Speech failed (${e.error}).`);
    };
    return u;
  });
  utterances.forEach((u) => synth.speak(u));
  return {
    stop: () => {
      if (!open) return;
      open = false;
      synth.cancel();
      utterances.length = 0;
    },
  };
}
