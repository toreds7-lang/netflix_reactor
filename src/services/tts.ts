import { baseLang, toGoogleLang } from '../core/langs';

function ttsLang(code: string): string {
  const g = toGoogleLang(code);
  if (g === 'iw') return 'he';
  if (g.startsWith('zh')) return g;
  return baseLang(code);
}

export async function speak(text: string, lang: string, rate = 1): Promise<void> {
  const target = ttsLang(lang);
  const voices = await chrome.tts.getVoices();
  const matching = voices.filter((v) => v.lang && baseLang(v.lang) === baseLang(target));
  if (voices.length && !matching.length) {
    throw new Error(`No text-to-speech voice installed for ${target}.`);
  }
  // Prefer an exact region match (zh-TW vs zh-CN), then Google network voices.
  const voice =
    matching.find((v) => v.lang?.toLowerCase() === target.toLowerCase()) ??
    matching.find((v) => /google/i.test(v.voiceName ?? '')) ??
    matching[0];
  chrome.tts.stop();
  await new Promise<void>((resolve, reject) => {
    chrome.tts.speak(text, {
      lang: voice?.lang ?? target,
      voiceName: voice?.voiceName,
      rate: Math.max(0.5, Math.min(2, rate)),
      onEvent: (e) => {
        if (e.type === 'error') reject(new Error(e.errorMessage ?? 'Speech failed'));
        if (e.type === 'end' || e.type === 'interrupted' || e.type === 'cancelled') resolve();
      },
    });
    // Don't keep the message channel open for long utterances.
    setTimeout(resolve, 1500);
  });
}
