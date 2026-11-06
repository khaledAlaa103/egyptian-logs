import { usePrefs } from '../app/PrefsContext.jsx';
import { usePwa } from './PwaContext.jsx';

/** Small status badge for the top bar: offline indicator and the install button. */
export function ConnectionBadge() {
  const { t } = usePrefs();
  const { online, canInstall, install } = usePwa();
  return (
    <>
      {!online && <span className="badge offline-badge" role="status" title={t('pwa.offlineHint')}>● {t('common.offline')}</span>}
      {canInstall && <button type="button" className="btn sm" onClick={install}>{t('pwa.install')}</button>}
    </>
  );
}

/** Toasts: "ready to work offline" and "update available" (applied only on request). */
export function PwaToasts() {
  const { t } = usePrefs();
  const { offlineReady, needRefresh, applyUpdate, dismissOfflineReady, dismissRefresh } = usePwa();
  if (!offlineReady && !needRefresh) return null;
  return (
    <div className="toasts no-print" role="region" aria-label={t('pwa.status')}>
      {offlineReady && (
        <div className="toast" role="status">
          <span>{t('pwa.offlineReady')}</span>
          <button className="btn sm" onClick={dismissOfflineReady}>{t('pwa.ok')}</button>
        </div>
      )}
      {needRefresh && (
        <div className="toast" role="alert">
          <span>{t('pwa.updateAvailable')}</span>
          <button className="btn sm primary" onClick={applyUpdate}>{t('pwa.updateNow')}</button>
          <button className="btn sm" onClick={dismissRefresh}>{t('pwa.later')}</button>
        </div>
      )}
    </div>
  );
}
