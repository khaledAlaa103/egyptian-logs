import { useState } from 'react';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { getLog, logName } from '../../registry/logRegistry.js';
import { nextTrackId, displayRange, colorFor } from '../../viewer/defaults.js';
import CurveSelect from '../import/CurveSelect.jsx';

/** Numeric field committed on blur / Enter; ignores invalid input. */
function Num({ value, onCommit, label, positive }) {
  return (
    <input key={String(value)} defaultValue={value} dir="ltr" aria-label={label} inputMode="decimal" className="num-in"
      onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && e.target.value !== '' && (!positive || n > 0)) onCommit(n); else e.target.value = value; }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
  );
}

export default function LayoutPanel({ layout, edit, data, custom, onReset }) {
  const { t, lang } = usePrefs();
  const [adding, setAdding] = useState({}); // trackId -> curveId
  const shown = new Set(layout.tracks.flatMap((tr) => tr.curves.map((c) => c.curveId)));
  const hidden = Object.keys(data).filter((id) => !shown.has(id));

  const setTrack = (i, patch) => edit((l) => { Object.assign(l.tracks[i], patch); });
  const setCurve = (i, j, patch) => edit((l) => { Object.assign(l.tracks[i].curves[j], patch); });
  const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };

  const addCurve = (i, id) => {
    if (!id || !data[id]) return;
    const def = getLog(id, custom);
    const r = displayRange(def, data[id].values);
    edit((l) => { l.tracks[i].curves.push({ curveId: id, color: colorFor(id, l.tracks[i].curves.length), visible: true, min: r.min, max: r.max, scale: r.scale }); });
  };
  const addTrack = (id) => {
    const def = id && data[id] ? getLog(id, custom) : null;
    const r = def ? displayRange(def, data[id].values) : { min: 0, max: 100, scale: 'linear' };
    edit((l) => {
      l.tracks.push({ id: nextTrackId(l.tracks), title: def ? def.abbr : t('viewer.newTrack'), width: 150, scale: r.scale, min: r.min, max: r.max,
        curves: def ? [{ curveId: id, color: colorFor(id, 0), visible: true, min: r.min, max: r.max, scale: r.scale }] : [] });
    });
  };

  return (
    <div className="layout-panel">
      <div className="toolbar wrap">
        <label className="inline"><span>{t('imp.depthUnit')}</span>
          <select value={layout.depthUnit} onChange={(e) => edit((l) => { l.depthUnit = e.target.value; })} aria-label={t('imp.depthUnit')}>
            <option value="m">m</option><option value="ft">ft</option>
          </select></label>
        <button className="btn sm" onClick={() => addTrack(null)}>+ {t('viewer.addTrack')}</button>
        <button className="btn sm" onClick={onReset}>{t('viewer.resetLayout')}</button>
      </div>

      {layout.tracks.map((tr, i) => (
        <fieldset className="track-box" key={tr.id}>
          <legend>{t('viewer.track')} {i + 1}</legend>
          <div className="track-row">
            <input value={tr.title} aria-label={`${t('viewer.title')} ${i + 1}`} onChange={(e) => setTrack(i, { title: e.target.value })} />
            <label className="inline"><span>{t('viewer.width')}</span><Num value={tr.width} positive label={`${t('viewer.width')} ${i + 1}`} onCommit={(n) => setTrack(i, { width: Math.max(60, Math.round(n)) })} /></label>
            <div className="mini-btns">
              <button className="icon-x" aria-label={`${t('viewer.moveUp')} ${i + 1}`} disabled={i === 0} onClick={() => edit((l) => move(l.tracks, i, -1))}>↑</button>
              <button className="icon-x" aria-label={`${t('viewer.moveDown')} ${i + 1}`} disabled={i === layout.tracks.length - 1} onClick={() => edit((l) => move(l.tracks, i, 1))}>↓</button>
              <button className="icon-x" aria-label={`${t('common.delete')} ${t('viewer.track')} ${i + 1}`} onClick={() => edit((l) => { l.tracks.splice(i, 1); })}>×</button>
            </div>
          </div>
          {tr.curves.map((c, j) => {
            const def = getLog(c.curveId, custom);
            const has = !!data[c.curveId];
            return (
              <div className="curve-row" key={c.curveId}>
                <input type="checkbox" checked={c.visible !== false} disabled={!has} aria-label={`${t('viewer.visible')} ${def?.abbr}`}
                  onChange={(e) => setCurve(i, j, { visible: e.target.checked })} />
                <input type="color" value={c.color} aria-label={`${t('viewer.color')} ${def?.abbr}`} onChange={(e) => setCurve(i, j, { color: e.target.value })} />
                <span className="cname" title={def ? logName(def, lang) : ''}>{def?.abbr || c.curveId}{!has && <em> ({t('viewer.noData')})</em>}</span>
                <select value={c.scale} aria-label={`${t('imp.scale')} ${def?.abbr}`} onChange={(e) => {
                  const s = e.target.value;
                  if (s === 'log' && !(c.min > 0 && c.max > 0)) setCurve(i, j, { scale: s, min: 0.1, max: 1000 }); else setCurve(i, j, { scale: s });
                }}>
                  <option value="linear">{t('imp.linear')}</option><option value="log">{t('imp.logarithmic')}</option>
                </select>
                <Num value={c.min} label={`${t('imp.min')} ${def?.abbr}`} positive={c.scale === 'log'} onCommit={(n) => setCurve(i, j, { min: n })} />
                <Num value={c.max} label={`${t('imp.max')} ${def?.abbr}`} positive={c.scale === 'log'} onCommit={(n) => setCurve(i, j, { max: n })} />
                <button className="icon-x" aria-label={`${t('common.delete')} ${def?.abbr}`} onClick={() => edit((l) => { l.tracks[i].curves.splice(j, 1); })}>×</button>
              </div>
            );
          })}
          <div className="toolbar">
            <select value={adding[tr.id] || ''} aria-label={`${t('viewer.addCurveTo')} ${i + 1}`} onChange={(e) => setAdding({ ...adding, [tr.id]: e.target.value })}>
              <option value="">— {t('viewer.addCurve')} —</option>
              {Object.keys(data).filter((id) => !tr.curves.some((c) => c.curveId === id)).map((id) => {
                const d = getLog(id, custom);
                return <option key={id} value={id}>{d?.abbr} — {d ? logName(d, lang) : id}</option>;
              })}
            </select>
            <button className="btn sm" disabled={!adding[tr.id]} onClick={() => { addCurve(i, adding[tr.id]); setAdding({ ...adding, [tr.id]: '' }); }}>+</button>
          </div>
        </fieldset>
      ))}

      {hidden.length > 0 && (
        <p className="muted small">{t('viewer.notShown')}: {hidden.map((id) => getLog(id, custom)?.abbr || id).join(', ')}</p>
      )}
    </div>
  );
}
