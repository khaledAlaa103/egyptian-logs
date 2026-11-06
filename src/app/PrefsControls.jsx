import { usePrefs } from './PrefsContext.jsx';
import Icon from '../design/Icon.jsx';

export default function PrefsControls() {
  const { lang, setLang, theme, setTheme, t } = usePrefs();
  const isDark = document.documentElement.dataset.theme === 'dark';
  return (
    <div className="prefs-controls">
      <button type="button" className="chip" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
        aria-label={`${lang === 'ar' ? 'EN' : 'ع'} – ${t('common.language')}`}>
        {lang === 'ar' ? 'EN' : 'ع'}
      </button>
      <button type="button" className="icon-btn" aria-label={t('common.toggleTheme')}
        onClick={() => setTheme(isDark ? 'light' : 'dark')}>
        <Icon name={isDark ? 'sun' : 'moon'} />
      </button>
    </div>
  );
}
