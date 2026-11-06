// Service-worker registration (production builds only). The worker precaches the whole app so it
// starts and works without internet. Updates are applied only when the user accepts them.
export function registerPwa({ onNeedRefresh, onOfflineReady } = {}) {
  // no service worker in the desktop app: it is already local (served from the app:// scheme)
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator) || window.desktop) return Promise.resolve(null);
  return import('virtual:pwa-register').then(({ registerSW }) => registerSW({
    immediate: true,
    onNeedRefresh: () => onNeedRefresh?.(),
    onOfflineReady: () => onOfflineReady?.(),
  })).catch(() => null);
}
