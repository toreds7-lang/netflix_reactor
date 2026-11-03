import { describe, expect, it } from 'vitest';
import { pinyinLine, pinyinRuby } from '../src/core/chinese';
import { needsRomanization, sameLanguage, toGoogleLang } from '../src/core/langs';
import { buildRenderTokens } from '../src/core/ruby';
import { normalizeWord, tokenize, wordKey } from '../src/core/tokenize';

const words = (text: string, lang: string) => tokenize(text, lang).filter((t) => t.isWord).map((t) => t.text);

describe('tokenize', () => {
  it('splits English, keeping contractions together', () => {
    expect(words("Don't go, Tom!", 'en')).toEqual(["Don't", 'go', 'Tom']);
  });

  it('segments spaceless scripts', () => {
    expect(words('今日は雨です', 'ja').length).toBeGreaterThan(1);
    expect(words('我喜欢学习中文', 'zh-Hans').length).toBeGreaterThan(1);
    expect(words('ฉันรักภาษาไทย', 'th').length).toBeGreaterThan(1);
  });

  it('round-trips the original text', () => {
    const text = '¿Adónde vas?\n-A casa.';
    expect(tokenize(text, 'es').map((t) => t.text).join('')).toBe(text);
  });
});

describe('normalizeWord / wordKey', () => {
  it('lowercases and trims punctuation', () => {
    expect(normalizeWord('¡Hola!', 'es')).toBe('hola');
    expect(normalizeWord('Don’t', 'en')).toBe("don't");
    expect(wordKey('İstanbul', 'tr-TR')).toBe('tr:istanbul');
    expect(wordKey('Haus', 'de')).toBe('de:haus');
  });
});

describe('buildRenderTokens', () => {
  it('merges tokens so a ruby segment is never split', () => {
    const tokens = buildRenderTokens('今日は雨だ', 'ja', [
      { base: '今日', ruby: 'きょう' },
      { base: 'は' },
      { base: '雨', ruby: 'あめ' },
      { base: 'だ' },
    ]);
    const withRuby = tokens.flatMap((t) => t.pieces.filter((p) => p.ruby));
    expect(withRuby).toEqual([
      { text: '今日', ruby: 'きょう' },
      { text: '雨', ruby: 'あめ' },
    ]);
    expect(tokens.map((t) => t.text).join('')).toBe('今日は雨だ');
  });

  it('is a plain tokenization without ruby', () => {
    const tokens = buildRenderTokens('Hello there', 'en');
    expect(tokens.every((t) => t.pieces.length === 1 && !t.pieces[0].ruby)).toBe(true);
  });
});

describe('Chinese pinyin', () => {
  it('produces per-character ruby and a readable line', () => {
    expect(pinyinRuby('你好！')).toEqual([{ base: '你', ruby: 'nǐ' }, { base: '好', ruby: 'hǎo' }, { base: '！' }]);
    expect(pinyinLine('你好，世界')).toBe('nǐ hǎo， shì jiè');
  });
});

describe('language codes', () => {
  it('maps Netflix codes to Google codes', () => {
    expect(toGoogleLang('zh-Hant')).toBe('zh-TW');
    expect(toGoogleLang('zh-Hans')).toBe('zh-CN');
    expect(toGoogleLang('pt-BR')).toBe('pt');
    expect(toGoogleLang('he')).toBe('iw');
    expect(toGoogleLang('nb')).toBe('no');
    expect(sameLanguage('es-ES', 'es')).toBe(true);
    expect(sameLanguage('zh-Hant', 'zh-CN')).toBe(false);
    expect(needsRomanization('ja')).toBe(true);
    expect(needsRomanization('fr')).toBe(false);
  });
});
