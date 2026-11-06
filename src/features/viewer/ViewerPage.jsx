import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db.js';
import { getCustomCurves } from '../../db/curves.js';
import { listFormations, listMarkers, loadLayout, saveLayout } from '../../db/intervals.js';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { getLog, logName } from '../../registry/logRegistry.js';
import { unitLabel } from '../../engine/units/units.js';
import { defaultLayout } from '../../viewer/defaults.js';
import { medianSpacing, valueAt, clampWindow, zoomWindow, panWindow, fmtNum } from '../../viewer/geometry.js';
import { renderLog, LIGHT } from '../../viewer/renderLog.js';
import { downloadFile, safeName } from '../../io/download.js';
import LogCanvas from '../../viewer/LogCanvas.jsx';
import WellPicker from '../import/WellPicker.jsx';
import LayoutPanel from './LayoutPanel.jsx';
import IntervalsPanel from './IntervalsPanel.jsx';

const clone = (o) => JSON.parse(JSON.stringify(o));
const CANVAS_H = 560;

export default function ViewerPage() {
  const { t, lang } = usePrefs();
  const [wellPk, setWellPk] = useState(null);
  const [tab, setTab] = useState('layout');
  const [saved, setSaved] = useState(undefined); // undefined=loading, null=none, object=user layout
  const [view, setView] = useState({ top: 0, bottom: 100 });
  const [cursor, setCursor] = useState(null);
  const canvasRef = useRef(null);
  const loadedLayout = useRef(null);

  const well = useLiveQuery(() => (wellPk ? db.wells.get(wellPk) : undefined), [wellPk]);
  const rows = useLiveQuery(() => (wellPk ? db.logMeasurements.where('wellId').equals(wellPk).toArray() : []), [wellPk], []);
  const formations = useLiveQuery(() => (wellPk ? listFormations(wellPk) : []), [wellPk], []);
  const markers = useLiveQuery(() => (wellPk ? listMarkers(wellPk) : []), [wellPk], []);
  const custom = useLiveQuery(() => getCustomCurves(), [], []);

  // curve data keyed by id (canonical units, depth in m)
  const data = useMemo(() => {
    const out = {};
    for (const r of rows) out[r.curveId] = { depth: r.depth, values: r.values, unit: r.unit, medianDz: medianSpacing(r.depth) };
    return out;
  }, [rows]);
  const hasData = Object.keys(data).length > 0;

  const titles = useMemo(() => ({
    gr: t('viewer.trackTitles.gr'), res: t('viewer.trackTitles.res'), por: t('viewer.trackTitles.por'),
    fluid: t('viewer.trackTitles.fluid'), other: t('viewer.trackTitles.other'),
  }), [t]);
  const auto = useMemo(() => defaultLayout(rows.map((r) => ({ curveId: r.curveId, values: r.values })), custom, titles), [rows, custom, titles]);

  // load saved layout when the well changes
  useEffect(() => {
    setSaved(undefined); setCursor(null); loadedLayout.current = null;
    if (!wellPk) return undefined;
    let alive = true;
    loadLayout(wellPk).then((l) => { if (alive) { loadedLayout.current = l; setSaved(l); } });
    return () => { alive = false; };
  }, [wellPk]);

  const layout = saved === undefined ? null : (saved || auto);

  // debounced persistence of user edits
  useEffect(() => {
    if (!wellPk || !saved || saved === loadedLayout.current) return undefined;
    const h = setTimeout(() => saveLayout(wellPk, saved), 400);
    return () => clearTimeout(h);
  }, [saved, wellPk]);

  const edit = useCallback((fn) => setSaved((cur) => { const base = clone(cur || auto); fn(base); return base; }), [auto]);
  const resetLayout = async () => { await db.preferences.delete(`viewer:layout:${wellPk}`); loadedLayout.current = null; setSaved(null); };

  const onResizeTrack = useCallback((i, w) => edit((l) => { l.tracks[i].width = w; }), [edit]);

  // depth extent
  const extent = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const c of Object.values(data)) { if (c.depth.length) { lo = Math.min(lo, c.depth[0]); hi = Math.max(hi, c.depth[c.depth.length - 1]); } }
    for (const f of formations) { lo = Math.min(lo, f.top); hi = Math.max(hi, f.bottom); }
    if (!Number.isFinite(lo)) return [0, 100];
    return hi - lo < 1 ? [lo, lo + 1] : [lo, hi];
  }, [data, formations]);
  const extentKey = `${wellPk}:${extent[0]}:${extent[1]}`;
  useEffect(() => { setView({ top: extent[0], bottom: extent[1] }); }, [extentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const model = useMemo(() => ({ layout, data, formations, markers, custom }), [layout, data, formations, markers, custom]);

  const zoomBy = (f) => setView((v) => zoomWindow(v, cursor ?? (v.top + v.bottom) / 2, f, extent[0], extent[1]));
  const panBy = (f) => setView((v) => panWindow(v, (v.bottom - v.top) * f, extent[0], extent[1]));
  const fit = () => setView(clampWindow(extent[0], extent[1], extent[0], extent[1]));
  const setRange = (which, val) => {
    const n = Number(val); if (!Number.isFinite(n)) return;
    setView((v) => (which === 'top' ? clampWindow(n, Math.max(n + 0.5, v.bottom), extent[0], extent[1]) : clampWindow(Math.min(n - 0.5, v.top), n, extent[0], extent[1])));
  };

  const exportPng = () => {
    if (!layout) return;
    const w = Math.max(900, Math.round(canvasRef.current?.clientWidth || 900)), h = 1400, scale = 2;
    const c = document.createElement('canvas');
    c.width = w * scale; c.height = h * scale;
    const ctx = c.getContext('2d');
    if (!ctx || !c.toBlob) return;
    ctx.scale(scale, scale);
    renderLog(ctx, w, h, { ...model, view, cursor: null, hover: null, palette: LIGHT, lang, labels: { formations: t('viewer.formations'), water: t('viewer.water') } });
    c.toBlob((b) => b && downloadFile(`${safeName(well?.wellId)}_log.png`, b, 'image/png'));
  };

  // readout at cursor
  const readout = useMemo(() => {
    if (cursor == null || !layout) return null;
    const items = [];
    for (const tr of layout.tracks) for (const c of tr.curves) {
      const cd = data[c.curveId]; if (!cd || c.visible === false) continue;
      const def = getLog(c.curveId, custom);
      items.push({ id: c.curveId, abbr: def?.abbr || c.curveId, name: def ? logName(def, lang) : '', color: c.color, unit: cd.unit, v: valueAt(cd.depth, cd.values, cursor, cd.medianDz) });
    }
    const fm = formations.find((f) => cursor >= f.top && cursor <= f.bottom) || null;
    return { items, fm };
  }, [cursor, layout, data, custom, formations, lang]);

  return (
    <section className="page viewer-page">
      <div className="page-head no-print"><h1>{t('nav.viewer')}</h1></div>
      <div className="no-print"><WellPicker value={wellPk} onChange={setWellPk} /></div>

      {!wellPk && <div className="card empty"><p>{t('imp.selectWellFirst')}</p></div>}
      {wellPk && well && !hasData && (
        <div className="card empty"><p>{t('viewer.noCurves')}</p><p className="muted small">{t('viewer.noCurvesHint')}</p></div>
      )}

      {wellPk && well && hasData && layout && (
        <>
          <div className="print-head">
            <strong>{well.wellId} — {well.name}</strong>
            <span> · {well.country || ''} {well.location || ''} · {t('viewer.depthRange')}: {fmtNum(view.top)}–{fmtNum(view.bottom)} m</span>
          </div>

          <div className="toolbar wrap no-print viewer-tools">
            <button className="btn sm" onClick={() => zoomBy(1.5)} aria-label={t('viewer.zoomIn')}>＋</button>
            <button className="btn sm" onClick={() => zoomBy(1 / 1.5)} aria-label={t('viewer.zoomOut')}>－</button>
            <button className="btn sm" onClick={() => panBy(-0.5)} aria-label={t('viewer.panUp')}>▲</button>
            <button className="btn sm" onClick={() => panBy(0.5)} aria-label={t('viewer.panDown')}>▼</button>
            <button className="btn sm" onClick={fit}>{t('viewer.fit')}</button>
            <label className="inline range"><span>{t('viewer.from')} (m)</span>
              <input key={`t${view.top.toFixed(2)}`} dir="ltr" defaultValue={Number(view.top.toFixed(2))} aria-label={t('viewer.from')}
                onBlur={(e) => setRange('top', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} /></label>
            <label className="inline range"><span>{t('viewer.to')} (m)</span>
              <input key={`b${view.bottom.toFixed(2)}`} dir="ltr" defaultValue={Number(view.bottom.toFixed(2))} aria-label={t('viewer.to')}
                onBlur={(e) => setRange('bottom', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} /></label>
            <span className="grow" />
            <button className="btn sm" onClick={exportPng}>{t('viewer.exportPng')}</button>
            <button className="btn sm primary" onClick={() => window.print()}>{t('viewer.print')}</button>
          </div>

          <div className="viewer-grid">
            <div className="viewer-main">
              <LogCanvas model={model} extent={extent} view={view} onView={setView} cursor={cursor} onCursor={setCursor}
                onResizeTrack={onResizeTrack} height={CANVAS_H} canvasRef={canvasRef} />
              <p className="muted small no-print">{t('viewer.help')}</p>
              <div className="legend-print">
                <span className="swatch water" /> {t('viewer.water_yes')} <span className="swatch prob" /> {t('viewer.water_probable')}
              </div>
            </div>

            <aside className="viewer-side no-print">
              <div className="card readout" aria-live="polite">
                <h3>{t('viewer.readout')}</h3>
                {!readout ? <p className="muted small">{t('viewer.clickToSelect')}</p> : (
                  <>
                    <p dir="ltr"><strong>{cursor.toFixed(2)} m</strong> / {(cursor / 0.3048).toFixed(1)} ft</p>
                    {readout.fm && <p>{readout.fm.name || t('viewer.unnamed')} · {t(`viewer.water_${readout.fm.waterBearing}`)}</p>}
                    <ul className="readout-list">
                      {readout.items.map((it) => (
                        <li key={it.id}><span className="dot" style={{ background: it.color }} /> <strong>{it.abbr}</strong>
                          <span dir="ltr" className="val">{it.v == null ? t('viewer.noValue') : `${fmtNum(it.v)} ${unitLabel(it.unit)}`}</span></li>
                      ))}
                    </ul>
                    <button className="btn sm" onClick={() => setCursor(null)}>{t('viewer.clearCursor')}</button>
                  </>
                )}
              </div>
              <div className="tabs" role="tablist">
                {['layout', 'intervals'].map((k) => (
                  <button key={k} role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{t(`viewer.tabs.${k}`)}</button>
                ))}
              </div>
              <div className="card">
                {tab === 'layout'
                  ? <LayoutPanel layout={layout} edit={edit} data={data} custom={custom} onReset={resetLayout} />
                  : <IntervalsPanel wellPk={wellPk} cursor={cursor} />}
              </div>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
