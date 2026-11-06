import en from './en.js';
import ar from './ar.js';
import enImport from './en.import.js';
import arImport from './ar.import.js';
import enViewer from './en.viewer.js';
import arViewer from './ar.viewer.js';
import enDig from './en.dig.js';
import arDig from './ar.dig.js';
import enInterp from './en.interp.js';
import arInterp from './ar.interp.js';
import enRes from './en.res.js';
import arRes from './ar.res.js';
import enWq from './en.wq.js';
import arWq from './ar.wq.js';
import enRep from './en.rep.js';
import arRep from './ar.rep.js';
import enPwa from './en.pwa.js';
import arPwa from './ar.pwa.js';
import enDesk from './en.desk.js';
import arDesk from './ar.desk.js';

// Feature dictionaries are merged on top of the core ones (top-level keys must not collide).
export const dictionaries = { en: { ...en, ...enImport, ...enViewer, ...enDig, ...enInterp, ...enRes, ...enWq, ...enRep, ...enPwa, ...enDesk }, ar: { ...ar, ...arImport, ...arViewer, ...arDig, ...arInterp, ...arRes, ...arWq, ...arRep, ...arPwa, ...arDesk } };
export const LANGS = { en: { dir: 'ltr' }, ar: { dir: 'rtl' } };

/** Resolve a dotted key ("nav.wells") in a language; falls back to English, then the key. */
export function translate(lang, key) {
  const walk = (d) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), d);
  const v = walk(dictionaries[lang]);
  if (v !== undefined) return v;
  const f = walk(dictionaries.en);
  return f !== undefined ? f : key;
}
