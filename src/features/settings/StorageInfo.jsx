import { useEffect, useState } from 'react';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { usePwa } from '../../pwa/PwaContext.jsx';
import { getStorageInfo, requestPersistence, formatBytes } from '../../pwa/storage.js';

/** Offline/installation status: what is stored on this device and whether it is protected from eviction. */
export default function StorageInfo() {
  const { t } = usePrefs();
  const { installed, canInstall, install, online } = usePwa();
  const [info, setInfo] = useState(null);
  const refresh = () => getStorageInfo().then(setInfo);
  useEffect(() => { refresh(); }, []);

  return (
    <div className="card" style={{ marginTop: '1rem', maxWidth: 640 }}>
      <h2>{t('pwa.title')}</h2>
      <p className="muted">{t('pwa.body')}</p>
      <ul className="plain">
        <li>{t('pwa.connection')}: <strong>{online ? t('common.online') : t('common.offline')}</strong></li>
        <li>{t('pwa.installState')}: <strong>{installed ? t('pwa.installed') : t('pwa.notInstalled')}</strong></li>
        {info?.supported && <li dir="ltr">{t('pwa.used')}: <strong>{formatBytes(info.usage)}</strong> / {formatBytes(info.quota)}</li>}
        <li>{t('pwa.persistent')}: <strong>{info?.persisted ? t('pwa.yes') : t('pwa.no')}</strong></li>
      </ul>
      <div className="toolbar wrap">
        {canInstall && <button className="btn primary" onClick={install}>{t('pwa.install')}</button>}
        {info && !info.persisted && (
          <button className="btn" onClick={async () => { await requestPersistence(); refresh(); }}>{t('pwa.requestPersist')}</button>
        )}
      </div>
      <p className="muted small">{t('pwa.androidHint')}</p>
    </div>
  );
}
