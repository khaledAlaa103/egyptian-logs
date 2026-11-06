import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LANGS, translate } from '../i18n/index.js';

const KEY = 'welllog.prefs.v1';
const DEFAULTS = { lang: 'en', theme: 'system', sidebarCollapsed: false };

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

const PrefsCtx = createContext(null);

export function PrefsProvider({ children }) {
  const [prefs, setPrefs] = useState(load);

  const update = useCallback((patch) => setPrefs((p) => ({ ...p, ...patch })), []);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
  }, [prefs]);

  // Apply language/direction and theme to <html>
  useEffect(() => {
    const el = document.documentElement;
    el.lang = prefs.lang;
    el.dir = LANGS[prefs.lang].dir;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && mq?.matches);
      el.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    mq?.addEventListener?.('change', apply);
    return () => mq?.removeEventListener?.('change', apply);
  }, [prefs.lang, prefs.theme]);

  const value = useMemo(() => ({
    ...prefs,
    dir: LANGS[prefs.lang].dir,
    t: (key) => translate(prefs.lang, key),
    setLang: (lang) => update({ lang }),
    setTheme: (theme) => update({ theme }),
    toggleSidebar: () => update({ sidebarCollapsed: !prefs.sidebarCollapsed }),
  }), [prefs, update]);

  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>;
}

export function usePrefs() {
  const ctx = useContext(PrefsCtx);
  if (!ctx) throw new Error('usePrefs must be used inside PrefsProvider');
  return ctx;
}
