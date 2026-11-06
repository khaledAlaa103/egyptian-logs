import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../db/db.js';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { updateFormation } from '../../db/intervals.js';
import { COL } from '../../results/columns.js';
import { screenInterval } from '../../results/screening.js';
import { qualityWarnings } from '../../results/quality.js';
import { unitLabel } from '../../engine/units/units.js';
import WellPicker from '../import/WellPicker.jsx';
import useResultsData from '../results/useResultsData.js';
import { NumField } from '../interpretation/fields.jsx';
import ProfileTracks from './ProfileTracks.jsx';

const f4 = (v) => (v == null ? '—' : Number(v.toPrecision(4)).toString());
const STAT_COLS = ['gr', 'rs', 'rd', 'rt', 'vsh', 'phi', 'sw', 'rw', 'ec'];
const cutKey = (w) => `formations:cutoffs:${w}`;

export default function FormationsPage() {
  const { t, lang } = usePrefs();
  const [wellPk, setWellPk] = useState(null);
  const [runId, setRunId] = useState(null);
  const [sel, setSel] = useState(null);
  const [cmp, setCmp] = useState(new Set());
  const [cut, setCut] = useState({});
  const [msg, setMsg] = useState(null);
  const cutLoaded = useRef(null);

  const { well, formations, curves, runs, run, rows } = useResultsData(wellPk, runId, {});

  useEffect(() => {
    setSel(null); setCmp(new Set()); setMsg(null); setCut({}); cutLoaded.current = null;
    if (!wellPk) return undefined;
    let alive = true;
    db.preferences.get(cutKey(wellPk)).then((r) => { if (alive) { cutLoaded.current = r?.value || {}; setCut(r?.value || {}); } });
    return () => { alive = false; };
  }, [wellPk]);
  useEffect(() => {
    if (!wellPk || cut === cutLoaded.current) return undefined;
    const h = setTimeout(() => db.preferences.put({ key: cutKey(wellPk), value: cut }), 500);
    return () => clearTimeout(h);
  }, [cut, wellPk]);

  const warnings = useMemo(() => (well ? qualityWarnings({ formations, rows, curves, run, well }) : []), [formations, rows, curves, run, well]);
  const waterRows = rows.filter((r) => ['yes', 'probable'].includes(r.cells.waterBearing.v));
  const waterThick = waterRows.reduce((s, r) => s + r.cells.thickness.v, 0);
  const current = rows.find((r) => r.id === sel) || rows[0] || null;

  const screened = useMemo(() => rows.map((r) => ({ row: r, res: screenInterval({ vsh: r.cells.vsh.v, phi: r.cells.phi.v, sw: r.cells.sw.v }, cut) })), [rows, cut]);

  const apply = async (items) => {
    let n = 0;
    for (const { row, res } of items) {
      const cur = row.formation.waterBearing || 'unknown';
      if (cur !== 'unknown' && cur !== res.status) continue; // never overwrite a decision already taken
      const note = `${t('fa.screeningNote')}: ${res.passed.map((p) => `${p}✓`).concat(res.failed.map((p) => `${p}✗`)).join(' ')}`;
      try { await updateFormation(row.id, { waterBearing: res.status, confidence: res.confidence, interpretation: row.formation.interpretation || note }); n++; } catch { /* skip */ }
    }
    setMsg({ ok: true, text: t('fa.applied').replace('{n}', n) });
  };

  const unitFor = (col, v) => {
    const c = COL[col];
    if (!c.group || v == null) return '';
    const u = { resistivity: 'ohm.m', porosity: 'v/v', gr: 'gAPI', conductivity: 'mS/m', tds: 'mg/L', depth: 'm' }[c.group];
    return unitLabel(u);
  };

  const cmpRows = rows.filter((r) => cmp.has(r.id));

  return (
    <section className="page fa-page">
      <div className="page-head"><h1>{t('nav.formations')}</h1></div>
      <WellPicker value={wellPk} onChange={setWellPk} />
      {!wellPk && <div className="card empty"><p>{t('imp.selectWellFirst')}</p></div>}

      {wellPk && well && (
        <>
          <div className="stat-grid">
            <div className="card stat"><div className="stat-value" dir="ltr">{well.totalDepth ?? '—'}</div><div className="stat-label">{t('wells.totalDepth')} (m)</div></div>
            <div className="card stat"><div className="stat-value">{rows.length}</div><div className="stat-label">{t('dashboard.formations')}</div></div>
            <div className="card stat"><div className="stat-value">{waterRows.length}</div><div className="stat-label">{t('dashboard.waterZones')}</div></div>
            <div className="card stat"><div className="stat-value" dir="ltr">{waterThick ? f4(waterThick) : '—'}</div><div className="stat-label">{t('fa.waterThickness')} (m)</div></div>
          </div>

          <div className="toolbar wrap">
            <label className="inline"><span>{t('res.run')}</span>
              <select value={runId ?? ''} aria-label={t('res.run')} onChange={(e) => setRunId(e.target.value === '' ? null : e.target.value === 'none' ? 'none' : Number(e.target.value))}>
                <option value="">{t('res.latestRun')}</option><option value="none">{t('res.noRun')}</option>
                {runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select></label>
            {run && <span className="muted small">{t('fa.usingRun')}: <strong>{run.name}</strong></span>}
          </div>

          <div className="card">
            <h3>{t('fa.profiles')}</h3>
            {Object.keys(curves).length === 0 ? <p className="muted">{t('viewer.noCurves')}</p>
              : <ProfileTracks curves={curves} run={run} formations={[...formations].sort((a, b) => a.top - b.top)} selected={current?.id} onPick={setSel} />}
          </div>

          <div className="fa-grid">
            <div className="card">
              <h3>{t('fa.intervals')}</h3>
              {rows.length === 0 ? <p className="muted">{t('viewer.noFormations')}</p> : (
                <div className="table-wrap" tabIndex={0}>
                  <table className="data compact">
                    <thead><tr><th /><th>#</th><th>{t('res.col.name')}</th><th>{t('res.col.top')}–{t('res.col.bottom')} (m)</th><th>{t('res.col.waterBearing')}</th></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className={current?.id === r.id ? 'sel' : ''} onClick={() => setSel(r.id)} style={{ cursor: 'pointer' }}>
                          <td><input type="checkbox" checked={cmp.has(r.id)} aria-label={`${t('fa.compare')} ${r.cells.number.v}`} onClick={(e) => e.stopPropagation()}
                            onChange={(e) => { const n = new Set(cmp); if (e.target.checked) n.add(r.id); else n.delete(r.id); setCmp(n); }} /></td>
                          <td>{r.cells.number.v}</td><td>{r.cells.name.v || '—'}</td>
                          <td dir="ltr">{f4(r.formation.top)} – {f4(r.formation.bottom)}</td>
                          <td>{t(`viewer.water_${r.cells.waterBearing.v}`)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <h3>{t('fa.detail')}{current ? ` — #${current.cells.number.v} ${current.cells.name.v || ''}` : ''}</h3>
              {!current ? <p className="muted">{t('fa.pickInterval')}</p> : (
                <>
                  <p className="small" dir="ltr">{f4(current.formation.top)} – {f4(current.formation.bottom)} m · {t('res.col.thickness')} {f4(current.cells.thickness.v)} m</p>
                  <p className="small">{t('res.col.lithology')}: <strong>{current.cells.lithology.v || '—'}</strong> · {t('res.col.aquiferClass')}: <strong>{t(`res.opt.aquiferClass.${current.cells.aquiferClass.v}`)}</strong> · {t('res.col.confidence')}: <strong>{current.cells.confidence.v ? t(`res.opt.confidence.${current.cells.confidence.v}`) : '—'}</strong></p>
                  <div className="table-wrap" tabIndex={0}>
                    <table className="data compact">
                      <thead><tr><th>{t('imp.curve')}</th><th className="num">{t('interp.mean')}</th><th className="num">{t('imp.min')}</th><th className="num">{t('imp.max')}</th><th className="num">n</th><th>{t('res.statusCol')}</th></tr></thead>
                      <tbody>
                        {STAT_COLS.filter((c) => current.cells[c].v != null || current.cells[c].trace).map((c) => {
                          const cell = current.cells[c];
                          return (
                            <tr key={c}><td>{t(`res.col.${c}`)} <span className="muted small">{unitFor(c, cell.v)}</span></td>
                              <td className="num">{f4(cell.v)}</td><td className="num">{f4(cell.trace?.min)}</td><td className="num">{f4(cell.trace?.max)}</td>
                              <td className="num">{cell.trace?.n ?? '—'}</td><td className="small">{cell.status ? t(`res.status.${cell.status}`) : ''}</td></tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted small">{t('fa.statsNote')}</p>
                </>
              )}
            </div>
          </div>

          {cmpRows.length >= 2 && (
            <div className="card">
              <h3>{t('fa.comparison')}</h3>
              <div className="table-wrap" tabIndex={0}>
                <table className="data compact">
                  <thead><tr><th>{t('imp.curve')}</th>{cmpRows.map((r) => <th key={r.id} className="num">#{r.cells.number.v} {r.cells.name.v}</th>)}</tr></thead>
                  <tbody>
                    {['thickness', ...STAT_COLS].map((c) => (
                      <tr key={c}><td>{t(`res.col.${c}`)}</td>{cmpRows.map((r) => <td key={r.id} className="num">{f4(r.cells[c].v)}</td>)}</tr>
                    ))}
                    <tr><td>{t('res.col.waterBearing')}</td>{cmpRows.map((r) => <td key={r.id} className="num">{t(`viewer.water_${r.cells.waterBearing.v}`)}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <h3>{t('fa.screening')}</h3>
            <p className="muted small">{t('fa.screeningNoteLong')}</p>
            <div className="igrid cutgrid">
              <NumField label={t('fa.vshMax')} value={cut.vshMax} onChange={(x) => setCut((c) => ({ ...c, vshMax: x }))} />
              <NumField label={t('fa.phiMin')} value={cut.phiMin} onChange={(x) => setCut((c) => ({ ...c, phiMin: x }))} />
              <NumField label={t('fa.swMin')} value={cut.swMin} onChange={(x) => setCut((c) => ({ ...c, swMin: x }))} />
            </div>
            {rows.length > 0 && (
              <>
                <div className="table-wrap" tabIndex={0}>
                  <table className="data compact">
                    <thead><tr><th>#</th><th>{t('res.col.name')}</th><th className="num">Vsh</th><th className="num">φ</th><th className="num">Sw</th><th>{t('fa.suggested')}</th><th>{t('res.col.confidence')}</th><th>{t('fa.criteria')}</th></tr></thead>
                    <tbody>
                      {screened.map(({ row, res }) => (
                        <tr key={row.id}>
                          <td>{row.cells.number.v}</td><td>{row.cells.name.v}</td>
                          <td className="num">{f4(row.cells.vsh.v)}</td><td className="num">{f4(row.cells.phi.v)}</td><td className="num">{f4(row.cells.sw.v)}</td>
                          <td><strong>{t(`viewer.water_${res.status}`)}</strong></td><td>{t(`res.opt.confidence.${res.confidence}`)}</td>
                          <td className="small muted">{[...res.passed.map((p) => `✓ ${p}`), ...res.failed.map((p) => `✗ ${p}`), ...res.notEvaluated.map((p) => `— ${p}`)].join('  ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="toolbar"><button className="btn primary" onClick={() => apply(screened)}>{t('fa.applyUnknown')}</button></div>
              </>
            )}
            {msg && <div className="notice ok small" role="status">{msg.text}</div>}
          </div>

          <div className="card">
            <h3>{t('fa.quality')}</h3>
            {warnings.length === 0 ? <p className="muted">{t('fa.noWarnings')}</p> : (
              <ul className="warnlist">
                {warnings.map((w, i) => {
                  const fr = rows.find((r) => r.id === w.fid);
                  const text = t(`fa.warn.${w.code}`).replace('{from}', f4(w.params.from)).replace('{to}', f4(w.params.to)).replace('{td}', w.params.td)
                    .replace('{thickness}', f4(w.params.thickness)).replace('{dz}', f4(w.params.dz)).replace('{vsh}', f4(w.params.vsh)).replace('{limit}', w.params.limit).replace('{share}', w.params.share != null ? Math.round(w.params.share * 100) : '').replace('{col}', w.params.col ? t(`res.col.${w.params.col}`) : '');
                  return <li key={i} className={w.severity}>{w.severity === 'warning' ? '⚠' : 'ℹ'} {fr ? `#${fr.cells.number.v} ` : ''}{text}</li>;
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
