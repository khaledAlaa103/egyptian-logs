import { useEffect, useState } from 'react';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { getWorkspaceStats } from '../../db/stats.js';
import DashboardWell from './DashboardWell.jsx';

const CARDS = ['projects', 'wells', 'logs', 'formations', 'waterZones'];
const KEYS = { projects: 'projects', wells: 'wells', logs: 'curves', formations: 'formations', waterZones: 'waterZones' };

export default function Dashboard() {
  const { t } = usePrefs();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let alive = true;
    getWorkspaceStats().then((s) => alive && setStats(s));
    return () => { alive = false; };
  }, []);

  const steps = t('dashboard.workflowSteps');
  const empty = stats && stats.wells === 0;

  return (
    <section className="page">
      <h1>{t('dashboard.title')}</h1>
      <p className="muted">{t('dashboard.subtitle')}</p>

      <div className="stat-grid">
        {CARDS.map((c) => (
          <div className="card stat" key={c}>
            <div className="stat-value">{stats ? stats[KEYS[c]] : '…'}</div>
            <div className="stat-label">{t(`dashboard.${c}`)}</div>
          </div>
        ))}
      </div>

      {empty && (
        <div className="card empty">
          <h2>{t('dashboard.emptyTitle')}</h2>
          <p>{t('dashboard.emptyBody')}</p>
        </div>
      )}

      <div className="two-col">
        <div className="card">
          <h2>{t('dashboard.workflow')}</h2>
          <ol className="steps">
            {Array.isArray(steps) && steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
        </div>
        <div className="card">
          <h2>{t('dashboard.quality')}</h2>
          <div className="muted">
            {stats && stats.warnings.length
              ? <ul className="warn-list">
                  {stats.warnings.map((w) => (
                    <li key={w.key}>{t(`dashboard.warn.${w.key}`).replace('{n}', w.count)}</li>
                  ))}
                </ul>
              : t('dashboard.qualityNone')}
          </div>
          <h2>{t('dashboard.storage')}</h2>
          <p>{t('dashboard.storageValue')}</p>
        </div>
      </div>
      <DashboardWell />
    </section>
  );
}
