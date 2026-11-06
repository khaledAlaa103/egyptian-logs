import { usePrefs } from '../../app/PrefsContext.jsx';
import { depthCalibrationOf, trackCalibrationOf, uid } from '../../digitize/pipeline.js';
import { getLog, acceptedUnitsOf } from '../../registry/logRegistry.js';
import { unitLabel } from '../../engine/units/units.js';
import CurveSelect from '../import/CurveSelect.jsx';

const fmt = (n, d = 4) => (n == null || !Number.isFinite(n) ? '—' : Number(n.toPrecision(d)).toString());

function Status({ cal, t }) {
  if (!cal) return null;
  if (!cal.ok) return <div className="notice bad small" role="status">{cal.errors.map((e) => t(`dig.cal.${e}`)).join(' · ')}</div>;
  return (
    <div className={`notice ${cal.warnings.length ? 'bad' : 'ok'} small`} role="status">
      {t('dig.cal.ok')}
      {cal.warnings.length > 0 && <> · {cal.warnings.map((w) => t(`dig.cal.${w}`)).join(' · ')}</>}
    </div>
  );
}

export default function CalibratePanel({ session, upd, tool, setTool, activeTrackId, setActiveTrackId, custom, onDetectLines, linesInfo }) {
  const { t } = usePrefs();
  const dcal = depthCalibrationOf(session);

  const addTrack = () => {
    const id = uid('t');
    upd((s) => { s.tracks.push({ id, name: `${t('dig.trackWord')} ${s.tracks.length + 1}`, curveId: 'gr', unit: 'gAPI', scale: 'linear', points: [] }); });
    setActiveTrackId(id);
    setTool('trackCal');
  };

  return (
    <div className="side-panel">
      <h3>{t('dig.depthCalTitle')}</h3>
      <p className="muted small">{t('dig.depthCalHint')}</p>
      <div className="toolbar wrap">
        <button className={`btn sm${tool === 'depthCal' ? ' primary' : ''}`} onClick={() => setTool('depthCal')}>{t('dig.addDepthPoint')}</button>
        <label className="inline"><span>{t('imp.depthUnit')}</span>
          <select value={session.depthCal.unit} aria-label={t('dig.depthRefUnit')} onChange={(e) => upd((s) => { s.depthCal.unit = e.target.value; })}>
            <option value="m">m</option><option value="ft">ft</option></select></label>
        <button className="btn sm" onClick={onDetectLines}>{t('dig.detectLines')}</button>
      </div>
      {linesInfo && <p className="muted small">{linesInfo}</p>}
      <table className="data compact">
        <thead><tr><th>y (px)</th><th>{t('imp.depth')} ({session.depthCal.unit})</th><th /></tr></thead>
        <tbody>
          {session.depthCal.points.map((p, i) => (
            <tr key={p.id}>
              <td dir="ltr">{p.py.toFixed(1)}</td>
              <td><input dir="ltr" inputMode="decimal" value={p.depth} aria-label={`${t('dig.depthValue')} ${i + 1}`}
                onChange={(e) => upd((s) => { s.depthCal.points[i].depth = e.target.value; })} /></td>
              <td><button className="icon-x" aria-label={`${t('common.delete')} ${t('dig.depthValue')} ${i + 1}`} onClick={() => upd((s) => { s.depthCal.points.splice(i, 1); })}>×</button></td>
            </tr>
          ))}
          {session.depthCal.points.length === 0 && <tr><td colSpan="3" className="muted">{t('dig.noPoints')}</td></tr>}
        </tbody>
      </table>
      <Status cal={session.depthCal.points.length ? dcal : null} t={t} />
      {dcal.ok && <p className="muted small">{t('dig.resolution')}: <span dir="ltr">{fmt(dcal.resolution)} m/px</span></p>}

      <h3>{t('dig.trackCalTitle')}</h3>
      <p className="muted small">{t('dig.trackCalHint')}</p>
      <button className="btn sm" onClick={addTrack}>+ {t('dig.addTrack')}</button>
      {session.tracks.map((tr, ti) => {
        const cal = trackCalibrationOf(tr);
        const def = getLog(tr.curveId, custom);
        const units = def ? acceptedUnitsOf(def) : [];
        const active = tr.id === activeTrackId;
        return (
          <fieldset className={`track-box${active ? ' active' : ''}`} key={tr.id}>
            <legend>
              <label><input type="radio" name="active-track" checked={active} onChange={() => { setActiveTrackId(tr.id); setTool('trackCal'); }} aria-label={`${t('dig.activeTrack')} ${tr.name}`} /> {tr.name}</label>
            </legend>
            <div className="track-row">
              <input value={tr.name} aria-label={`${t('viewer.title')} ${ti + 1}`} onChange={(e) => upd((s) => { s.tracks[ti].name = e.target.value; })} />
              <button className="icon-x" aria-label={`${t('common.delete')} ${tr.name}`} onClick={() => upd((s) => {
                s.tracks.splice(ti, 1); s.curves = s.curves.filter((c) => c.trackId !== tr.id);
              })}>×</button>
            </div>
            <div className="track-row">
              <CurveSelect value={tr.curveId} custom={custom} aria-label={`${t('dig.trackCurve')} ${ti + 1}`}
                onChange={(id) => upd((s) => { const d = getLog(id, custom); s.tracks[ti].curveId = id; const u = acceptedUnitsOf(d); if (!u.includes(s.tracks[ti].unit)) s.tracks[ti].unit = u[0]; if (d.scale === 'log') s.tracks[ti].scale = 'log'; })} />
              <select value={tr.unit} aria-label={`${t('imp.unit')} ${ti + 1}`} onChange={(e) => upd((s) => { s.tracks[ti].unit = e.target.value; })}>
                {units.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
              </select>
              <select value={tr.scale} aria-label={`${t('imp.scale')} ${ti + 1}`} onChange={(e) => upd((s) => { s.tracks[ti].scale = e.target.value; })}>
                <option value="linear">{t('imp.linear')}</option><option value="log">{t('imp.logarithmic')}</option>
              </select>
            </div>
            <table className="data compact">
              <thead><tr><th>x (px)</th><th>{t('dig.value')}</th><th /></tr></thead>
              <tbody>
                {tr.points.map((p, pi) => (
                  <tr key={p.id}>
                    <td dir="ltr">{p.px.toFixed(1)}</td>
                    <td><input dir="ltr" inputMode="decimal" value={p.value} aria-label={`${tr.name} ${t('dig.value')} ${pi + 1}`}
                      onChange={(e) => upd((s) => { s.tracks[ti].points[pi].value = e.target.value; })} /></td>
                    <td><button className="icon-x" aria-label={`${t('common.delete')} ${tr.name} ${pi + 1}`} onClick={() => upd((s) => { s.tracks[ti].points.splice(pi, 1); })}>×</button></td>
                  </tr>
                ))}
                {tr.points.length === 0 && <tr><td colSpan="3" className="muted">{t('dig.noPoints')}</td></tr>}
              </tbody>
            </table>
            <Status cal={tr.points.length ? cal : null} t={t} />
            {cal.ok && <p className="muted small">{t('dig.resolution')}: <span dir="ltr">{fmt(cal.perPixel)} {cal.scale === 'log' ? 'log10' : unitLabel(tr.unit)}/px</span></p>}
          </fieldset>
        );
      })}
      <button className={`btn sm${tool === 'pan' ? ' primary' : ''}`} onClick={() => setTool('pan')}>{t('dig.panTool')}</button>
    </div>
  );
}
