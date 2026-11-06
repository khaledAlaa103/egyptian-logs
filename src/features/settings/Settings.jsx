import { usePrefs } from '../../app/PrefsContext.jsx';
import DataBackup from './DataBackup.jsx';
import StorageInfo from './StorageInfo.jsx';
import { DesktopPanel } from '../../desktop/DesktopUi.jsx';

export default function Settings() {
  const { t, lang, setLang, theme, setTheme } = usePrefs();
  return (
    <section className="page">
      <h1>{t('nav.settings')}</h1>
      <div className="card form-grid">
        <label>
          <span>{t('common.language')}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="en">{t('common.english')}</option>
            <option value="ar">{t('common.arabic')}</option>
          </select>
        </label>
        <label>
          <span>{t('common.theme')}</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="system">{t('common.system')}</option>
            <option value="light">{t('common.light')}</option>
            <option value="dark">{t('common.dark')}</option>
          </select>
        </label>
      </div>
      <DataBackup />
      <DesktopPanel />
      <StorageInfo />
    </section>
  );
}
