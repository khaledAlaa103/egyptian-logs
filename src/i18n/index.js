import en from './en.js';
import ar from './ar.js';

export const dictionaries = { en, ar };
export const LANGS = { en: { dir: 'ltr' }, ar: { dir: 'rtl' } };

/** Resolve a dotted key ("nav.wells") in a language; falls back to English, then the key. */
export function translate(lang, key) {
  const walk = (d) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), d);
  const v = walk(dictionaries[lang]);
  if (v !== undefined) return v;
  const f = walk(dictionaries.en);
  return f !== undefined ? f : key;
}
