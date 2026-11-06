import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db.js';
import { usePrefs } from '../../app/PrefsContext.jsx';
import WellPicker from '../import/WellPicker.jsx';
import useResultsData from '../results/useResultsData.js';
import ProfileTracks from '../formations/ProfileTracks.jsx';
import { qualityWarnings } from '../../results/quality.js';
import { classifySalinity } from '../../engine/water/water.js';

const f4 = (v) => (v == null || !Number.isFinite(v) ? '—' : Number(v.toPrecision(4)).toString());

/** TDS per interval as horizontal bars (values come from the results table: measured, estimated or manual). */
function TdsBars({ rows, t }) {
  const items = rows.filter((r) => r.cells.tds.v != null);
  if (!items.length) return <p className="muted small">{t('dash.noTds')}</p>;
  const max = Math.max(...items.map((r) => r.cells.tds.v));
  return (
    <div className="tds-bars" dir="ltr">
      {items.map((r) => (
        <div key={r.id} className="tds-row" title={`${r.cells.tds.status}`}>
          <span className="tds-name">#{r.cells.number.v} {r.cells.name.v}</span>
          <span className="tds-track"><span className={`tds-fill st-${r.cells.tds.status}`} style={{ width: `${Math.max(2, (r.cells.tds.v / max) * 100)}%` }} /></span>
          <span className="tds-val">{f4(r.cells.tds.v)} mg/L · {t(`wq.cls.${classifySalinity(r.cells.tds.v)}`)}</span>
        </div>
      ))}
    </div>
  );
}

/** Per-well overview on the dashboard: well data, profiles (GR, resistivity, porosity), intervals, TDS and data-quality warnings. */
export default function DashboardWell() {
  const { t } = usePrefs();
  const wells = useLiveQuery(() => db.wells.filter((w) => w.status !== 'archived').toArray(), [], null);
  const [wellPk, setWellPk] = useState(null);
  useEffect(() => {
    if (wells && wells.length && (wellPk == null || !wells.some((w) => w.id === wellPk))) {
      setWellPk([...wells].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0].id);
    }
  }, [wells, wellPk]);
  const { well, formations, curves, run, rows } = useResultsData(wellPk, null, {});
  const warnings = useMemo(() => (well ? qualityWarnings({ formations, rows, curves, run, well }) : []), [formations, rows, curves, run, well]);
  if (!wells || wells.length === 0) return null;
  const water = rows.filter((r) => ['yes', 'probable'].includes(r.cells.waterBearing.v));

  return (
    <div className="dash-well">
      <h2>{t('dash.wellOverview')}</h2>
      <WellPicker value={wellPk} onChange={setWellPk} />
      {well && (
        <>
          <div className="stat-grid">
            <div className="card stat"><div className="stat-value" dir="ltr">{well.totalDepth ?? '—'}</div><div className="stat-label">{t('wells.totalDepth')} (m)</div></div>
            <div className="card stat"><div className="stat-value">{Object.keys(curves).length}</div><div className="stat-label">{t('dashboard.logs')}</div></div>
            <div className="card stat"><div className="stat-value">{rows.length}</div><div className="stat-label">{t('dashboard.formations')}</div></div>
            <div className="card stat"><div className="stat-value">{water.length}</div><div className="stat-label">{t('dashboard.waterZones')}</div></div>
          </div>
          <div className="two-col">
            <div className="card">
              <h3>{t('fa.profiles')}</h3>
              {Object.keys(curves).length === 0 ? <p className="muted">{t('viewer.noCurves')}</p>
                : <ProfileTracks curves={curves} run={run} formations={[...formations].sort((a, b) => a.top - b.top)} selected={null} onPick={() => {}} />}
            </div>
            <div className="card">
              <h3>{t('fa.intervals')}</h3>
              {rows.length === 0 ? <p className="muted">{t('viewer.noFormations')}</p> : (
                <div className="table-wrap" tabIndex={0}>
                  <table className="data compact">
                    <thead><tr><th>#</th><th>{t('res.col.name')}</th><th>{t('res.col.top')}–{t('res.col.bottom')} (m)</th><th>{t('res.col.waterBearing')}</th></tr></thead>
                    <tbody>{rows.map((r) => (
                      <tr key={r.id}><td>{r.cells.number.v}</td><td>{r.cells.name.v || '—'}</td><td dir="ltr">{f4(r.formation.top)} – {f4(r.formation.bottom)}</td><td>{t(`viewer.water_${r.cells.waterBearing.v}`)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              <h3>TDS</h3>
              <TdsBars rows={rows} t={t} />
              <h3>{t('dashboard.quality')}</h3>
              {warnings.filter((w) => w.severity === 'warning').length === 0
                ? <p className="muted small">{t('fa.noWarnings')}</p>
                : <ul className="warn-list small">{warnings.filter((w) => w.severity === 'warning').slice(0, 6).map((w, i) => <li key={i}>⚠ {t(`fa.warn.${w.code}`).replace(/\{[a-z]+\}/g, '…')}</li>)}</ul>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
