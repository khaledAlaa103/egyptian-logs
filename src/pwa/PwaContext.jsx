import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { registerPwa } from './register.js';
import { requestPersistence } from './storage.js';

export const PwaContext = createContext(null);
const Ctx = PwaContext;

const isStandalone = () => (typeof window !== 'undefined')
  && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);

/** Online/offline state, service-worker events, and the browser's "install app" prompt. */
export function PwaProvider({ children }) {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [offlineReady, setOfflineReady] = useState(false);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [installEvent, setInstallEvent] = useState(null);
  const [installed, setInstalled] = useState(isStandalone());
  const updateRef = useRef(null);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    const beforeInstall = (e) => { e.preventDefault(); setInstallEvent(e); };
    const done = () => { setInstalled(true); setInstallEvent(null); };
    window.addEventListener('online', on); window.addEventListener('offline', off);
    window.addEventListener('beforeinstallprompt', beforeInstall); window.addEventListener('appinstalled', done);
    registerPwa({ onNeedRefresh: () => setNeedRefresh(true), onOfflineReady: () => setOfflineReady(true) }).then((u) => { updateRef.current = u; });
    requestPersistence();
    return () => {
      window.removeEventListener('online', on); window.removeEventListener('offline', off);
      window.removeEventListener('beforeinstallprompt', beforeInstall); window.removeEventListener('appinstalled', done);
    };
  }, []);

  const install = useCallback(async () => {
    if (!installEvent) return null;
    installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    return choice?.outcome;
  }, [installEvent]);

  const applyUpdate = useCallback(() => updateRef.current?.(true), []);

  const value = useMemo(() => ({
    online, offlineReady, needRefresh, canInstall: !!installEvent && !installed, installed,
    install, applyUpdate, dismissOfflineReady: () => setOfflineReady(false), dismissRefresh: () => setNeedRefresh(false),
  }), [online, offlineReady, needRefresh, installEvent, installed, install, applyUpdate]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const FALLBACK = {
  online: true, offlineReady: false, needRefresh: false, canInstall: false, installed: false,
  install: async () => null, applyUpdate: () => {}, dismissOfflineReady: () => {}, dismissRefresh: () => {},
};

/** Outside a PwaProvider (e.g. isolated component tests) the app behaves as online, not installable. */
export function usePwa() {
  return useContext(Ctx) || FALLBACK;
}
