/**
 * The native messaging helper registered by `npm run claude:install` (native-host/claude-code-host.mjs). It runs
 * Claude Code for key lines and summaries and writes backup files.
 */
const HOST = 'com.polyglot_player.claude_code';

type HostReply<T> = ({ ok: true } & T) | { ok: false; error: string };

export const INSTALL_COMMAND = () => `npm run claude:install -- ${chrome.runtime.id}`;

function hostError(lastError: string): Error {
  const install = INSTALL_COMMAND();
  if (/not found/i.test(lastError)) return new Error(`The Claude Code helper isn't installed. In the project folder, run: ${install}`);
  if (/forbidden/i.test(lastError)) return new Error(`The Claude Code helper was installed for another extension ID. Run: ${install}`);
  return new Error(`The Claude Code helper stopped unexpectedly${lastError ? ` (${lastError})` : ''}.`);
}

/**
 * One request whose reply comes in pieces: each `{ ok: true, delta }` goes to `onDelta` until the final reply.
 * `stop()` disconnects, which makes the helper stop Claude Code.
 */
export function nativeStream<T>(msg: object, onDelta: (text: string) => void): { done: Promise<T>; stop(): void } {
  let port: chrome.runtime.Port | null = null;
  const done = new Promise<T>((resolve, reject) => {
    try {
      port = chrome.runtime.connectNative(HOST);
    } catch (e) {
      reject(hostError(e instanceof Error ? e.message : String(e)));
      return;
    }
    const p = port;
    p.onMessage.addListener((reply: HostReply<T & { delta?: string }>) => {
      if (reply.ok && typeof reply.delta === 'string') {
        onDelta(reply.delta);
        return;
      }
      p.disconnect();
      port = null;
      if (reply.ok) resolve(reply);
      else reject(new Error(reply.error));
    });
    p.onDisconnect.addListener(() => {
      port = null;
      reject(hostError(chrome.runtime.lastError?.message ?? ''));
    });
    p.postMessage(msg);
  });
  return {
    done,
    stop: () => {
      port?.disconnect();
      port = null;
    },
  };
}

/** One request per connection. The open port also keeps the service worker alive during a long run. */
export function nativeRequest<T>(msg: object): Promise<T> {
  return new Promise((resolve, reject) => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connectNative(HOST);
    } catch (e) {
      reject(hostError(e instanceof Error ? e.message : String(e)));
      return;
    }
    port.onMessage.addListener((reply: HostReply<T>) => {
      port.disconnect();
      if (reply.ok) resolve(reply);
      else reject(new Error(reply.error));
    });
    port.onDisconnect.addListener(() => reject(hostError(chrome.runtime.lastError?.message ?? '')));
    port.postMessage(msg);
  });
}
