/** Language helpers: Netflix BCP-47 codes <-> Google Translate codes. */

export const NATIVE_LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'pl', name: 'Polish' },
  { code: 'cs', name: 'Czech' },
  { code: 'ro', name: 'Romanian' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'el', name: 'Greek' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ru', name: 'Russian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'iw', name: 'Hebrew' },
  { code: 'fa', name: 'Persian' },
  { code: 'hi', name: 'Hindi' },
  { code: 'bn', name: 'Bengali' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ms', name: 'Malay' },
  { code: 'tl', name: 'Filipino' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: 'Chinese (Traditional)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
];

export function baseLang(code: string): string {
  return (code || '').split(/[-_]/)[0].toLowerCase();
}

/** Map a Netflix/BCP-47 language code to the code Google Translate expects. */
export function toGoogleLang(code: string): string {
  const c = (code || '').trim();
  const lower = c.toLowerCase();
  if (lower.startsWith('zh') || lower === 'yue') {
    if (/hant|tw|hk|mo/.test(lower) || lower === 'yue') return 'zh-TW';
    return 'zh-CN';
  }
  const base = baseLang(c);
  switch (base) {
    case 'he':
      return 'iw';
    case 'nb':
    case 'nn':
      return 'no';
    case 'fil':
      return 'tl';
    case 'jv':
      return 'jw';
    default:
      return base;
  }
}

/** True when a Netflix track language is the same language as a Google target code. */
export function sameLanguage(a: string, b: string): boolean {
  return toGoogleLang(a) === toGoogleLang(b);
}

export function isChinese(code: string): boolean {
  return toGoogleLang(code).startsWith('zh');
}

export function isJapanese(code: string): boolean {
  return baseLang(code) === 'ja';
}

/** Languages whose script is not Latin, where a romanization line helps learners. */
const NON_LATIN = new Set([
  'ja', 'zh', 'ko', 'ru', 'uk', 'bg', 'sr', 'mk', 'be', 'el', 'ar', 'he', 'iw', 'fa', 'ur',
  'hi', 'mr', 'ne', 'bn', 'pa', 'gu', 'ta', 'te', 'kn', 'ml', 'si', 'th', 'lo', 'km', 'my',
  'ka', 'hy', 'am', 'yue',
]);

export function needsRomanization(code: string): boolean {
  return NON_LATIN.has(baseLang(code));
}

/** Languages written without spaces between words. */
export function isSpaceless(code: string): boolean {
  return ['ja', 'zh', 'th', 'lo', 'km', 'my', 'yue'].includes(baseLang(code));
}

export function languageName(code: string): string {
  const g = toGoogleLang(code);
  const known = NATIVE_LANGUAGES.find((l) => l.code === g);
  if (known) return known.name;
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
