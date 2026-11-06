import { useEffect, useState } from 'react';
import { usePrefs } from '../app/PrefsContext.jsx';
import { desktop } from './bridge.js';
import { exportBackup } from '../db/repos.js';

/** Toast "Saved to <path>" after a native save (desktop app only). */
export function DesktopToasts() {
  const { t } = usePrefs();
  const [saved, setSaved] = useState(null);
  useEffect(() => {
    const on = (e) => setSaved(e.detail.path);
    window.addEventListener('desktop:saved', on);
    return () => window.removeEventListener('desktop:saved', on);
  }, []);
  useEffect(() => { if (!saved) return undefined; const h = setTimeout(() => setSaved(null), 6000); return () => clearTimeout(h); }, [saved]);
  if (!saved) return null;
  return (
    <div className="toasts no-print" role="region" aria-label={t('desk.title')}>
      <div className="toast" role="status"><span dir="ltr">{t('desk.saved')}: {saved}</span><button className="btn sm" onClick={() => setSaved(null)}>{t('pwa.ok')}</button></div>
    </div>
  );
}

/** Settings panel shown only inside the desktop app: where the data lives and one-click backups to Documents. */
export function DesktopPanel() {
  const { t } = usePrefs();
  const d = desktop();
  const [info, setInfo] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { d?.getInfo().then(setInfo).catch(() => {}); }, [d]);
  if (!d) return null;

  const backupNow = async () => {
    try {
      const data = await exportBackup();
      const r = await d.writeBackup({ json: JSON.stringify(data) });
      setMsg({ ok: !!r?.ok, text: r?.ok ? `${t('desk.backupDone')}: ${r.path}` : t('desk.backupFail') });
    } catch { setMsg({ ok: false, text: t('desk.backupFail') }); }
  };

  return (
    <div className="card" style={{ marginTop: '1rem', maxWidth: 640 }}>
      <h2>{t('desk.title')}</h2>
      <p className="muted">{t('desk.body')}</p>
      {info && (
        <ul className="plain" dir="ltr">
          <li>{t('desk.version')}: <strong>{info.name} {info.version}</strong> (Electron {info.electron})</li>
          <li>{t('desk.dataDir')}: <code>{info.dataDir}</code></li>
          <li>{t('desk.backupDir')}: <code>{info.backupsDir}</code></li>
        </ul>
      )}
      <div className="toolbar wrap">
        <button className="btn primary" onClick={backupNow}>{t('desk.backupNow')}</button>
        <button className="btn" onClick={() => d.reveal('backups')}>{t('desk.openBackups')}</button>
        <button className="btn" onClick={() => d.reveal('data')}>{t('desk.openData')}</button>
      </div>
      {msg && <div className={`notice ${msg.ok ? 'ok' : 'bad'} small`} role="status" dir="ltr">{msg.text}</div>}
    </div>
  );
}
