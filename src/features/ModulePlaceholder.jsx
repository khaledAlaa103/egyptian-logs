import { usePrefs } from '../app/PrefsContext.jsx';

/** Shown for modules whose implementation phase has not been reached yet. Honest about status. */
export default function ModulePlaceholder({ item }) {
  const { t } = usePrefs();
  return (
    <section className="page">
      <h1>{t(`nav.${item.id}`)}</h1>
      <div className="card empty">
        <span className="badge">{t('common.phase')} {item.phase}</span>
        <p>{t('placeholder.body')}</p>
        <p className="muted">{t('common.comingIn')} {item.phase}</p>
      </div>
    </section>
  );
}
