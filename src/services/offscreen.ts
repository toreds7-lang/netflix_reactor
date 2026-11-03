/**
 * The offscreen document that runs Kokoro (entrypoints/offscreen). The service worker can't play audio or keep
 * a model loaded, so pages ask for the document here and then talk to it over a port.
 */

const URL_PATH = 'offscreen.html';
let creating: Promise<void> | null = null;

async function isOpen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(URL_PATH)],
  });
  return contexts.length > 0;
}

export async function openReader(): Promise<void> {
  if (await isOpen()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: URL_PATH,
      // BLOBS too: each clip is played from a blob URL, and with AUDIO_PLAYBACK alone Chrome closes the document
      // after 30 silent seconds, which would cut off the first model download. It closes itself when idle.
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK, chrome.offscreen.Reason.BLOBS],
      justification: 'Reads episode summaries aloud with the Kokoro text-to-speech model.',
    })
    .finally(() => (creating = null));
  await creating;
}

export async function closeReader(): Promise<void> {
  if (await isOpen()) await chrome.offscreen.closeDocument();
}
