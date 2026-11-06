import en from './en.js';
import ar from './ar.js';
import enImport from './en.import.js';
import arImport from './ar.import.js';
import enViewer from './en.viewer.js';
import arViewer from './ar.viewer.js';

// Feature dictionaries are merged on top of the core ones (top-level keys must not collide).
export const dictionaries = { en: { ...en, ...enImport, ...enViewer }, ar: { ...ar, ...arImport, ...arViewer } };
export const LANGS = { en: { dir: 'ltr' }, ar: { dir: 'rtl' } };

/** Resolve a dotted key ("nav.wells") in a language; falls back to English, then the key. */
export function translate(lang, key) {
  const walk = (d) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), d);
  const v = walk(dictionaries[lang]);
  if (v !== undefined) return v;
  const f = walk(dictionaries.en);
  return f !== undefined ? f : key;
}
