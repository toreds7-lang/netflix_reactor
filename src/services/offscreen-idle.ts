import { send } from '../core/messages';

/**
 * The offscreen document holds two models: Kokoro, reading summaries aloud (kokoro.ts), and the sentence model for
 * 🔎 same-meaning search (embed.ts). It asks the background to close it once neither has worked for a while, to
 * give back their memory.
 */
const IDLE_CLOSE_MS = 5 * 60_000;

let timer: ReturnType<typeof setTimeout> | undefined;
let busy = 0;

/** Close the document after IDLE_CLOSE_MS unless something starts working before. */
export function closeWhenIdle(): void {
  clearTimeout(timer);
  if (busy) return;
  timer = setTimeout(() => void send('kokoroIdle', {}).catch(() => undefined), IDLE_CLOSE_MS);
}

/** Work starts: keep the document open until the matching `releaseOffscreen`. */
export function holdOffscreen(): void {
  busy++;
  clearTimeout(timer);
}

export function releaseOffscreen(): void {
  busy = Math.max(0, busy - 1);
  closeWhenIdle();
}
