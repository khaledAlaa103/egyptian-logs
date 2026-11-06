import { useState } from 'react';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { uid, computeCurve } from '../../digitize/pipeline.js';
import { ALL_BUILTIN, getLog, acceptedUnitsOf, canonicalUnitOf } from '../../registry/logRegistry.js';
import { colorFor } from '../../viewer/defaults.js';
import { unitLabel } from '../../engine/units/units.js';
import CurveSelect from '../import/CurveSelect.jsx';

const fmt = (n) => (n == null || !Number.isFinite(n) ? '—' : Number(n.toPrecision(5)).toString());
const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

export default function DigitizePanel({
  session, upd, tool, setTool, activeCurveId, setActiveCurveId, selected, onDeleteSelected, custom, imageSize,
  onAuto, autoInfo, hasRoi, onClearRoi,
}) {
  const { t } = usePrefs();
  const [trackId, setTrackId] = useState('');
  const [curveId, setCurveId] = useState('gr');
  const tr = session.tracks.find((x) => x.id === (trackId || session.tracks[0]?.id));
  const incompatible = [...ALL_BUILTIN.filter((l) => l.kind === 'curve'), ...custom]
    .filter((l) => !tr || !acceptedUnitsOf(l).includes(tr.unit)).map((l) => l.id);
  const active = session.curves.find((c) => c.id === activeCurveId);

  const addCurve = () => {
    if (!tr || incompatible.includes(curveId)) return;
    const id = uid('c');
    upd((s) => { s.curves.push({ id, curveId, trackId: tr.id, color: colorFor(curveId, s.curves.length), points: [], extract: { color: null, tolerance: 60, stepY: 2 } }); });
    setActiveCurveId(id);
    setTool('point');
  };

  const info = (() => {
    if (!selected) return null;
    const cv = session.curves.find((c) => c.id === selected.curveId);
    const p = cv?.points.find((x) => x.id === selected.pointId);
    if (!p) return null;
    const r = computeCurve(session, { ...cv, points: [p] }, imageSize, custom);
    return { p, r, unit: session.tracks.find((x) => x.id === cv.trackId)?.unit };
  })();

  return (
    <div className="side-panel">
      <h3>{t('dig.digitizeTitle')}</h3>
      {session.tracks.length === 0 && <div className="notice bad small">{t('dig.needTrack')}</div>}
      <div className="toolbar wrap add-form">
        <select value={tr?.id || ''} onChange={(e) => setTrackId(e.target.value)} aria-label={t('dig.activeTrack')}>
          {session.tracks.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <CurveSelect value={curveId} onChange={setCurveId} custom={custom} disabledIds={incompatible} aria-label={t('dig.curveToDigitize')} />
        <button className="btn sm primary" disabled={!tr || incompatible.includes(curveId)} onClick={addCurve}>+ {t('dig.addCurve')}</button>
      </div>

      {session.curves.map((cv, i) => {
        const def = getLog(cv.curveId, custom);
        const trk = session.tracks.find((x) => x.id === cv.trackId);
        return (
          <div key={cv.id} className={`curve-card${cv.id === activeCurveId ? ' active' : ''}`}>
            <label><input type="radio" name="active-curve" checked={cv.id === activeCurveId} onChange={() => setActiveCurveId(cv.id)} aria-label={`${t('dig.activeCurve')} ${def?.abbr}`} />
              <strong> {def?.abbr}</strong> <span className="muted small">({trk?.name}, {cv.points.length} {t('imp.points')})</span></label>
            <input type="color" value={cv.color} aria-label={`${t('viewer.color')} ${def?.abbr}`} onChange={(e) => upd((s) => { s.curves[i].color = e.target.value; })} />
            <button className="icon-x" aria-label={`${t('dig.clearPoints')} ${def?.abbr}`} title={t('dig.clearPoints')} onClick={() => upd((s) => { s.curves[i].points = []; })}>⌫</button>
            <button className="icon-x" aria-label={`${t('common.delete')} ${def?.abbr}`} onClick={() => { upd((s) => { s.curves.splice(i, 1); }); if (cv.id === activeCurveId) setActiveCurveId(null); }}>×</button>
          </div>
        );
      })}

      <div className="toolbar wrap">
        <button className={`btn sm${tool === 'point' ? ' primary' : ''}`} onClick={() => setTool('point')} disabled={!active}>{t('dig.pointTool')}</button>
        <button className={`btn sm${tool === 'pan' ? ' primary' : ''}`} onClick={() => setTool('pan')}>{t('dig.panTool')}</button>
        <button className="btn sm danger" disabled={!selected} onClick={onDeleteSelected}>{t('dig.deletePoint')}</button>
      </div>
      <p className="muted small">{t('dig.digitizeHint')}</p>

      {info && (
        <div className="notice ok small" role="status">
          {info.r.points[0]
            ? <><strong dir="ltr">{fmt(info.r.points[0].depth)} m</strong> · <strong dir="ltr">{fmt(info.r.points[0].value)} {unitLabel(canonicalUnitOf(getLog(session.curves.find((c) => c.id === selected.curveId).curveId, custom)))}</strong> <span className="muted">({info.p.method})</span></>
            : <span>{info.r.blocking.length ? t('dig.notCalibrated') : t('dig.pointRejected')}</span>}
        </div>
      )}

      {active && (
        <fieldset className="track-box">
          <legend>{t('dig.autoTitle')}</legend>
          <p className="muted small">{t('dig.autoHint')}</p>
          <div className="toolbar wrap">
            <button className={`btn sm${tool === 'pick' ? ' primary' : ''}`} onClick={() => setTool('pick')}>{t('dig.pickColor')}</button>
            {active.extract.color && <span className="swatch-box" style={{ background: hex(active.extract.color) }} aria-label={t('dig.pickedColor')} />}
            <button className={`btn sm${tool === 'roi' ? ' primary' : ''}`} onClick={() => setTool('roi')}>{t('dig.setRoi')}</button>
            {hasRoi && <button className="btn sm" onClick={onClearRoi}>{t('dig.clearRoi')}</button>}
          </div>
          <label className="inline"><span>{t('dig.tolerance')}: {active.extract.tolerance}</span>
            <input type="range" min="10" max="200" value={active.extract.tolerance} aria-label={t('dig.tolerance')}
              onChange={(e) => upd((s) => { s.curves.find((c) => c.id === active.id).extract.tolerance = Number(e.target.value); })} /></label>
          <label className="inline"><span>{t('dig.stepY')}</span>
            <input type="number" min="1" max="50" value={active.extract.stepY} dir="ltr" aria-label={t('dig.stepY')}
              onChange={(e) => upd((s) => { s.curves.find((c) => c.id === active.id).extract.stepY = Math.max(1, Number(e.target.value) || 1); })} /></label>
          <button className="btn sm primary" disabled={!active.extract.color} onClick={onAuto}>{t('dig.runAuto')}</button>
          {autoInfo && (
            <div className={`notice ${autoInfo.reliable ? 'ok' : 'bad'} small`} role="status">
              {t('dig.autoResult').replace('{n}', autoInfo.points).replace('{c}', Math.round(autoInfo.coverage * 100))}
              {!autoInfo.reliable && <> · <strong>{t('dig.unreliable')}</strong> ({autoInfo.reasons.map((r) => t(`dig.reason.${r}`)).join(', ')}) — {t('dig.useManual')}</>}
            </div>
          )}
        </fieldset>
      )}
    </div>
  );
}
