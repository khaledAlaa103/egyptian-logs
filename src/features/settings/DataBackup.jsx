import { useRef, useState } from 'react';
import { exportBackup, restoreBackup } from '../../db/repos.js';
import { downloadFile, readFileText } from '../../io/download.js';
import { usePrefs } from '../../app/PrefsContext.jsx';

export default function DataBackup() {
  const { t } = usePrefs();
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

  const backup = async () => {
    const data = await exportBackup();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`welllog-backup-${stamp}.json`, JSON.stringify(data), 'application/json');
    setMsg({ ok: true, text: t('settings.backupDone') });
  };

  const restore = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm(t('settings.confirmRestore'))) return;
    try {
      await restoreBackup(JSON.parse(await readFileText(file)));
      setMsg({ ok: true, text: t('settings.restoreDone') });
    } catch (err) {
      setMsg({ ok: false, text: err.message === 'NEWER_VERSION' ? t('err.newerVersion') : t('err.invalidFile') });
    }
  };

  return (
    <div className="card" style={{ marginTop: '1rem', maxWidth: 640 }}>
      <h2>{t('settings.dataTitle')}</h2>
      <p className="muted">{t('settings.dataBody')}</p>
      <div className="toolbar wrap">
        <button className="btn primary" onClick={backup}>{t('settings.backup')}</button>
        <button className="btn" onClick={() => fileRef.current.click()}>{t('settings.restore')}</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={restore}
          aria-label={t('settings.restore')} />
      </div>
      {msg && <div className={`notice ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
    </div>
  );
}
