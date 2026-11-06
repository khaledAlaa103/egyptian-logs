import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db.js';
import {
  listFormations, addFormation, updateFormation, deleteFormation, WATER_STATUS,
  listMarkers, addMarker, deleteMarker, updateMarker,
} from '../../db/intervals.js';
import { usePrefs } from '../../app/PrefsContext.jsx';

const EMPTY = { top: '', bottom: '', name: '', waterBearing: 'unknown' };

/** Formation intervals (with water-bearing status) and depth markers for the selected well. */
export default function IntervalsPanel({ wellPk, cursor }) {
  const { t } = usePrefs();
  const formations = useLiveQuery(() => listFormations(wellPk), [wellPk], []);
  const markers = useLiveQuery(() => listMarkers(wellPk), [wellPk], []);
  const [form, setForm] = useState(EMPTY);
  const [err, setErr] = useState(null);
  const [mLabel, setMLabel] = useState('');
  void db;

  const msg = (e) => t(`viewer.ferr.${e.message}`) || e.message;
  const add = async (e) => {
    e.preventDefault();
    try { await addFormation(wellPk, form); setForm(EMPTY); setErr(null); } catch (x) { setErr(msg(x)); }
  };
  const upd = async (id, patch) => { try { await updateFormation(id, patch); setErr(null); } catch (x) { setErr(msg(x)); } };

  return (
    <div className="intervals">
      <h3>{t('viewer.formationsTitle')}</h3>
      {err && <div className="notice bad" role="alert">{err}</div>}
      <div className="table-wrap">
        <table className="data compact">
          <thead><tr><th>{t('viewer.top')}</th><th>{t('viewer.bottom')}</th><th>{t('viewer.fname')}</th><th>{t('viewer.waterStatus')}</th><th /></tr></thead>
          <tbody>
            {formations.map((f) => (
              <tr key={f.id}>
                <td><input key={f.top} defaultValue={f.top} dir="ltr" aria-label={`${t('viewer.top')} ${f.name || f.id}`} onBlur={(e) => e.target.value !== String(f.top) && upd(f.id, { top: e.target.value })} /></td>
                <td><input key={f.bottom} defaultValue={f.bottom} dir="ltr" aria-label={`${t('viewer.bottom')} ${f.name || f.id}`} onBlur={(e) => e.target.value !== String(f.bottom) && upd(f.id, { bottom: e.target.value })} /></td>
                <td><input defaultValue={f.name} aria-label={`${t('viewer.fname')} ${f.id}`} onBlur={(e) => e.target.value !== f.name && upd(f.id, { name: e.target.value })} /></td>
                <td>
                  <select value={f.waterBearing} aria-label={`${t('viewer.waterStatus')} ${f.name || f.id}`} onChange={(e) => upd(f.id, { waterBearing: e.target.value })}>
                    {WATER_STATUS.map((w) => <option key={w} value={w}>{t(`viewer.water_${w}`)}</option>)}
                  </select>
                </td>
                <td><button className="icon-x" aria-label={`${t('common.delete')} ${f.name || f.id}`} onClick={() => deleteFormation(f.id)}>×</button></td>
              </tr>
            ))}
            {formations.length === 0 && <tr><td colSpan="5" className="muted">{t('viewer.noFormations')}</td></tr>}
          </tbody>
        </table>
      </div>
      <form className="toolbar wrap add-form" onSubmit={add} noValidate>
        <input placeholder={t('viewer.top')} dir="ltr" value={form.top} aria-label={t('viewer.newTop')} onChange={(e) => setForm({ ...form, top: e.target.value })} />
        <input placeholder={t('viewer.bottom')} dir="ltr" value={form.bottom} aria-label={t('viewer.newBottom')} onChange={(e) => setForm({ ...form, bottom: e.target.value })} />
        <input placeholder={t('viewer.fname')} value={form.name} aria-label={t('viewer.newName')} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select value={form.waterBearing} aria-label={t('viewer.newWater')} onChange={(e) => setForm({ ...form, waterBearing: e.target.value })}>
          {WATER_STATUS.map((w) => <option key={w} value={w}>{t(`viewer.water_${w}`)}</option>)}
        </select>
        <button className="btn sm primary" type="submit">+ {t('viewer.addFormation')}</button>
      </form>
      <p className="muted small">{t('viewer.formationHint')}</p>

      <h3>{t('viewer.markersTitle')}</h3>
      <div className="toolbar wrap">
        <input placeholder={t('viewer.markerLabel')} value={mLabel} aria-label={t('viewer.markerLabel')} onChange={(e) => setMLabel(e.target.value)} />
        <button className="btn sm" disabled={cursor == null} onClick={async () => { await addMarker(wellPk, Number(cursor.toFixed(2)), mLabel); setMLabel(''); }}>
          + {t('viewer.addMarker')}{cursor != null ? ` (${cursor.toFixed(2)} m)` : ''}
        </button>
      </div>
      {cursor == null && <p className="muted small">{t('viewer.markerHint')}</p>}
      <ul className="marker-list">
        {markers.map((m) => (
          <li key={m.id}>
            <span dir="ltr">{m.depth} m</span>
            <input defaultValue={m.label} aria-label={`${t('viewer.markerLabel')} ${m.depth}`} onBlur={(e) => e.target.value !== m.label && updateMarker(m.id, { label: e.target.value })} />
            <button className="icon-x" aria-label={`${t('common.delete')} ${m.depth}`} onClick={() => deleteMarker(m.id)}>×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
