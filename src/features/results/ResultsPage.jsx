import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { COL, COLUMNS, DEFAULT_VISIBLE, columnAvailable, parseCell, makeFilter, compareValues } from '../../results/columns.js';
import { unitsFor, unitLabel, fromCanonical } from '../../engine/units/units.js';
import { updateFormation } from '../../db/intervals.js';
import { bulkUpdate, bulkDelete, addNextInterval, setOverride, saveSnapshot, listSnapshots, restoreSnapshot, deleteSnapshot, loadView, saveView } from '../../db/results.js';
import { resultsToWorkbook, resultsToCsv } from '../../results/exportResults.js';
import { downloadFile, safeName } from '../../io/download.js';
import { getLog } from '../../registry/logRegistry.js';
import { METHOD_INFO } from '../../engine/methodsInfo.js';
import { useLiveQuery } from 'dexie-react-hooks';
import WellPicker from '../import/WellPicker.jsx';
import ResultsGrid from './ResultsGrid.jsx';
import useResultsData from './useResultsData.js';

const UNIT_DEFAULTS = { depth: 'm', resistivity: 'ohm.m', gr: 'gAPI', porosity: 'v/v', conductivity: 'mS/m', tds: 'mg/L' };
const BULK_COLS = ['lithology', 'waterBearing', 'aquiferClass', 'confidence', 'interpretation', 'notes', 'name'];

export default function ResultsPage() {
  const { t, lang } = usePrefs();
  const [wellPk, setWellPk] = useState(null);
  const [view, setView] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [focus, setFocus] = useState(null); // {rowId, col}
  const [msg, setMsg] = useState(null);
  const [bulk, setBulk] = useState({ col: 'lithology', value: '' });
  const [snapName, setSnapName] = useState('');
  const loaded = useRef(null);

  const { well, formations, curves, runs, run, ctx, rows } = useResultsData(wellPk, view?.runId, view?.sources);
  const snaps = useLiveQuery(() => (wellPk ? listSnapshots(wellPk) : []), [wellPk, formations], []);

  // ---- view config load / init / persist ----
  useEffect(() => {
    setView(null); setSelected(new Set()); setFocus(null); setMsg(null); loaded.current = null;
    if (!wellPk) return undefined;
    let alive = true;
    loadView(wellPk).then((v) => { if (alive) { loaded.current = v; setView(v || { units: { ...UNIT_DEFAULTS }, sort: { col: 'top', dir: 'asc' }, filters: {}, visible: null, runId: null, sources: {} }); } });
    return () => { alive = false; };
  }, [wellPk]);
  useEffect(() => {
    if (!wellPk || !view || view === loaded.current) return undefined;
    const h = setTimeout(() => saveView(wellPk, view), 500);
    return () => clearTimeout(h);
  }, [view, wellPk]);

  const patchView = (p) => setView((v) => ({ ...v, ...p }));
  const visible = useMemo(() => {
    if (!view) return [];
    if (view.visible) return view.visible;
    return DEFAULT_VISIBLE.filter((c) => columnAvailable(c, ctx) || ['tds'].includes(c) && rows.some((r) => r.cells.tds.overridden));
  }, [view, ctx, rows]);

  // ---- filter / sort in DISPLAY units ----
  const unitOf = (col) => (COL[col].group ? view.units[COL[col].group] : null);
  const display = (row, col) => {
    const v = row.cells[col].v;
    if (v == null || v === '') return null;
    return COL[col].type === 'number' && COL[col].group ? fromCanonical(v, COL[col].group, unitOf(col)) : v;
  };
  const shown = useMemo(() => {
    if (!view) return [];
    const preds = Object.entries(view.filters).map(([c, e]) => [c, makeFilter(e, COL[c]?.type === 'number' || COL[c]?.type === 'int')]).filter(([, p]) => p);
    let r = rows.filter((row) => preds.every(([c, p]) => p(display(row, c))));
    const { col, dir } = view.sort;
    if (col) {
      r = [...r].sort((a, b) => {
        const av = display(a, col), bv = display(b, col);
        if (av == null || av === '') return 1; if (bv == null || bv === '') return -1;
        return dir === 'asc' ? compareValues(av, bv) : compareValues(bv, av);
      });
    }
    return r;
  }, [rows, view]);  

  // ---- labels ----
  const label = useCallback((id) => {
    if (id.startsWith('unit:')) return unitLabel(id.slice(5));
    if (id.startsWith('opt:')) { const [, c, v] = id.split(':'); return c === 'waterBearing' ? t(`viewer.water_${v}`) : t(`res.opt.${c}.${v}`); }
    return t(`res.col.${id}`) || id;
  }, [t]);
  const errorText = (e) => t(`res.err.${e}`);
  const statusTitle = (cell) => (cell.status === 'input' || cell.status === 'auto' ? undefined : t(`res.status.${cell.status}`));

  // ---- editing ----
  const commit = useCallback(async (rowId, col, text) => {
    const c = COL[col];
    const f = formations.find((x) => x.id === rowId);
    if (!f) return { error: 'number' };
    if (c.kind === 'auto') return { error: 'readonly' };
    const parsed = parseCell(col, text, c.group ? view.units[c.group] : null);
    if (parsed.error) return { error: parsed.error };
    try {
      if (c.kind === 'input') {
        const patch = { [col]: parsed.value };
        if (col === 'top' || col === 'bottom') { if (parsed.value == null) return { error: 'required' }; }
        await updateFormation(rowId, patch);
      } else {
        await setOverride(rowId, col, parsed.value, { status: 'user', source: f.overrides?.[col]?.source || '' });
      }
      return { ok: true };
    } catch (e) { return { error: e.message in { order: 1, overlap: 1, negative: 1, required: 1, number: 1 } ? e.message : 'number' }; }
  }, [formations, view]);

  const onPaste = async (matrix, r0, c0) => {
    let ok = 0, bad = 0;
    for (let i = 0; i < matrix.length; i++) {
      const row = shown[r0 + i]; if (!row) break;
      for (let j = 0; j < matrix[i].length; j++) {
        const col = visible[c0 + j]; if (!col) break;
        if (COL[col].kind === 'auto') continue;
        const res = await commit(row.id, col, matrix[i][j]);
        if (res.error) bad++; else ok++;
      }
    }
    setMsg({ ok: bad === 0, text: t('res.pasted').replace('{ok}', ok).replace('{bad}', bad) });
  };

  const canEdit = (col) => COL[col].kind !== 'auto';

  // ---- actions ----
  const sel = [...selected];
  const doBulk = async () => {
    if (!sel.length) return;
    const parsed = parseCell(bulk.col, bulk.value, null);
    if (parsed.error) { setMsg({ ok: false, text: errorText(parsed.error) }); return; }
    const r = await bulkUpdate(sel, { [bulk.col]: parsed.value });
    setMsg({ ok: !r.failed.length, text: t('res.bulkDone').replace('{n}', r.ok.length).replace('{bad}', r.failed.length) });
  };
  const doDelete = async () => {
    if (!sel.length || !window.confirm(t('res.confirmDelete').replace('{n}', sel.length))) return;
    await bulkDelete(sel); setSelected(new Set());
  };
  const doClearOverrides = async () => {
    for (const id of sel) { const f = formations.find((x) => x.id === id); for (const c of Object.keys(f?.overrides || {})) await setOverride(id, c, null); }
    setMsg({ ok: true, text: t('res.overridesCleared') });
  };

  // ---- export ----
  const exportCols = visible;
  const traceText = (cell) => {
    const tr = cell.trace;
    if (!tr) return '';
    if (tr.kind === 'curve') return `${tr.curveId}: ${tr.mode === 'geo' ? t('res.geoMean') : t('res.mean')} (n=${tr.n}) [${tr.top}–${tr.bottom} m]`;
    if (tr.kind === 'run') return `${tr.runName || '#' + tr.runId} / ${tr.series}: ${tr.mode === 'geo' ? t('res.geoMean') : t('res.mean')} (n=${tr.n}) [${tr.top}–${tr.bottom} m]; ${tr.methods.join(', ')}`;
    if (tr.kind === 'water') return `${tr.basis === 'direct' ? t('wq.direct') : t('wq.indirect')}: ${tr.method || ''}${tr.sampleId ? ' ' + tr.sampleId : ''}${tr.ec25 != null ? '; EC25=' + Number(tr.ec25.toPrecision(5)) + ' µS/cm' : ''}${tr.relPct != null ? '; ±' + Number(tr.relPct.toPrecision(2)) + ' %' : ''}${tr.flags?.length ? '; ' + tr.flags.join(',') : ''}`;
    return `${t('res.manual')}: ${tr.source}`;
  };
  const doExport = (kind) => {
    const base = safeName(`${well.wellId}_results`);
    if (kind === 'xlsx') {
      const buf = resultsToWorkbook({
        well, rows: shown, cols: exportCols, units: view.units, label, statusLabel: (s) => t(`res.status.${s}`), traceText,
        infoLines: [['Run', run ? run.name : '-'], ['Exported', new Date().toISOString()], ['Depth range (m)', formations.length ? `${formations[0].top} – ${formations[formations.length - 1].bottom}` : '']],
      });
      downloadFile(`${base}.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    } else downloadFile(`${base}.csv`, resultsToCsv({ rows: shown, cols: exportCols, units: view.units, label }), 'text/csv;charset=utf-8');
  };

  const focusCell = focus && rows.find((r) => r.id === focus.rowId)?.cells[focus.col];
  const usedGroups = [...new Set(visible.map((c) => COL[c].group).filter(Boolean))];
  const runMethods = (id) => METHOD_INFO[id]?.name[lang];

  return (
    <section className="page results-page">
      <div className="page-head no-print"><h1>{t('nav.results')}</h1></div>
      <div className="no-print"><WellPicker value={wellPk} onChange={setWellPk} /></div>
      {!wellPk && <div className="card empty"><p>{t('imp.selectWellFirst')}</p></div>}

      {wellPk && well && view && (
        <>
          <div className="toolbar wrap no-print rtools">
            <button className="btn sm primary" onClick={() => addNextInterval(well)}>+ {t('res.addRow')}</button>
            <button className="btn sm danger" disabled={!sel.length} onClick={doDelete}>{t('res.deleteRows')} ({sel.length})</button>
            <label className="inline"><span>{t('res.run')}</span>
              <select value={view.runId ?? ''} aria-label={t('res.run')} onChange={(e) => patchView({ runId: e.target.value === '' ? null : e.target.value === 'none' ? 'none' : Number(e.target.value) })}>
                <option value="">{t('res.latestRun')}</option>
                <option value="none">{t('res.noRun')}</option>
                {runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select></label>
            {usedGroups.map((g) => (
              <label className="inline" key={g}><span>{t(`res.group.${g}`)}</span>
                <select value={view.units[g]} aria-label={t(`res.group.${g}`)} onChange={(e) => patchView({ units: { ...view.units, [g]: e.target.value } })}>
                  {unitsFor(g).map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                </select></label>
            ))}
            <span className="grow" />
            <button className="btn sm" onClick={() => doExport('xlsx')} disabled={!shown.length}>{t('res.exportXlsx')}</button>
            <button className="btn sm" onClick={() => doExport('csv')} disabled={!shown.length}>{t('res.exportCsv')}</button>
          </div>

          <details className="no-print colchooser">
            <summary>{t('res.columns')}</summary>
            <div className="chips">
              {COLUMNS.map((c) => (
                <label key={c.id} className="icheck"><input type="checkbox" checked={visible.includes(c.id)} aria-label={label(c.id)}
                  onChange={(e) => patchView({ visible: COLUMNS.map((x) => x.id).filter((id) => (id === c.id ? e.target.checked : visible.includes(id))) })} />
                  {label(c.id)}{!columnAvailable(c.id, ctx) ? <em className="muted"> ({t('res.noSource')})</em> : null}</label>
              ))}
              <button className="btn sm" onClick={() => patchView({ visible: null })}>{t('res.autoColumns')}</button>
            </div>
            <div className="chips">
              {['gr', 'rs', 'rd', 'ec'].map((c) => (
                <label key={c} className="inline"><span>{t('res.sourceFor')} {label(c)}</span>
                  <select value={view.sources?.[c] || ''} aria-label={`${t('res.sourceFor')} ${label(c)}`} onChange={(e) => patchView({ sources: { ...view.sources, [c]: e.target.value || undefined } })}>
                    <option value="">{t('res.autoPick')}</option>
                    {COL[c].picks.filter((p) => curves[p]).map((p) => <option key={p} value={p}>{getLog(p)?.abbr}</option>)}
                  </select></label>
              ))}
            </div>
          </details>

          {msg && <div className={`notice ${msg.ok ? 'ok' : 'bad'} small`} role="status">{msg.text}</div>}

          <ResultsGrid rows={shown} cols={visible} units={view.units} label={(id) => (id === 'title' ? t('nav.results') : id === 'selectAll' ? t('res.selectAll') : id === 'select' ? t('res.select') : id === 'filter' ? t('res.filter') : id === 'noRows' ? t('res.noRows') : label(id))}
            statusTitle={statusTitle} sort={view.sort} filters={view.filters}
            onSort={(col) => patchView({ sort: { col, dir: view.sort.col === col && view.sort.dir === 'asc' ? 'desc' : 'asc' } })}
            onFilter={(col, v) => patchView({ filters: { ...view.filters, [col]: v } })}
            selected={selected} onSelect={setSelected} onCommit={commit} onPaste={onPaste} onActive={(rowId, col) => setFocus({ rowId, col })} canEdit={canEdit} errorText={errorText} />

          <div className="res-panels no-print">
            <div className="card">
              <h3>{t('res.traceTitle')}</h3>
              {!focusCell || !focusCell.trace ? <p className="muted small">{t('res.traceHint')}</p> : (
                <TracePanel cell={focusCell} col={focus.col} rowId={focus.rowId} t={t} lang={lang} traceText={traceText} runMethods={runMethods}
                  formation={formations.find((f) => f.id === focus.rowId)} />
              )}
            </div>
            <div className="card">
              <h3>{t('res.bulkTitle')}</h3>
              <p className="muted small">{t('res.bulkHint')}</p>
              <div className="toolbar wrap">
                <select value={bulk.col} aria-label={t('res.bulkColumn')} onChange={(e) => setBulk({ col: e.target.value, value: '' })}>
                  {BULK_COLS.map((c) => <option key={c} value={c}>{label(c)}</option>)}
                </select>
                {COL[bulk.col].type === 'enum'
                  ? <select value={bulk.value} aria-label={t('res.bulkValue')} onChange={(e) => setBulk({ ...bulk, value: e.target.value })}>
                      <option value="" />{COL[bulk.col].options.map((o) => <option key={o} value={o}>{label(`opt:${bulk.col}:${o}`)}</option>)}</select>
                  : <input value={bulk.value} aria-label={t('res.bulkValue')} onChange={(e) => setBulk({ ...bulk, value: e.target.value })} />}
                <button className="btn sm primary" disabled={!sel.length} onClick={doBulk}>{t('res.applyBulk')} ({sel.length})</button>
                <button className="btn sm" disabled={!sel.length} onClick={doClearOverrides}>{t('res.clearOverrides')}</button>
              </div>
            </div>
            <div className="card">
              <h3>{t('res.snapshots')}</h3>
              <div className="toolbar wrap">
                <input value={snapName} placeholder={t('res.snapName')} aria-label={t('res.snapName')} onChange={(e) => setSnapName(e.target.value)} />
                <button className="btn sm" onClick={async () => { await saveSnapshot(wellPk, snapName); setSnapName(''); setMsg({ ok: true, text: t('res.snapSaved') }); }}>{t('res.saveSnapshot')}</button>
              </div>
              <ul className="img-list">
                {snaps.map((s) => (
                  <li key={s.id}><span className="grow">{s.name} <span className="muted small" dir="ltr">({s.rows.length})</span></span>
                    <button className="btn sm" onClick={async () => { if (window.confirm(t('res.confirmRestore'))) { await restoreSnapshot(wellPk, s.id); setMsg({ ok: true, text: t('res.restored') }); } }}>{t('res.restore')}</button>
                    <button className="icon-x" aria-label={`${t('common.delete')} ${s.name}`} onClick={() => deleteSnapshot(wellPk, s.id).then(() => setSnapName(''))}>×</button></li>
                ))}
              </ul>
            </div>
          </div>
          <p className="muted small no-print">{t('res.keysHelp')}</p>
        </>
      )}
    </section>
  );
}

function TracePanel({ cell, col, rowId, t, lang, traceText, runMethods, formation }) {
  const [src, setSrc] = useState(formation?.overrides?.[col]?.source || '');
  useEffect(() => { setSrc(formation?.overrides?.[col]?.source || ''); }, [rowId, col]);  
  const tr = cell.trace;
  return (
    <div className="small">
      <p><strong>{t(`res.col.${col}`)}</strong> — <span className={`badge st-${cell.status}`}>{t(`res.status.${cell.status}`)}</span></p>
      <p>{traceText(cell)}</p>
      {tr.warn === 'fluid_ec' && <p className="err">{t('res.fluidEcWarn')}</p>}
      {tr.kind === 'run' && <ul>{tr.methods.map((m) => <li key={m}>{runMethods(m)} — <span dir="ltr" className="muted">{METHOD_INFO[m]?.equation}</span></li>)}</ul>}
      {tr.kind === 'user' && formation && (
        <>
          <label className="ifield wide"><span>{t('res.manualSource')}</span><input value={src} aria-label={t('res.manualSource')} onChange={(e) => setSrc(e.target.value)} /></label>
          <div className="toolbar wrap">
            {['measured', 'estimated', 'user'].map((s) => (
              <button key={s} className={`btn sm${formation.overrides?.[col]?.status === s ? ' primary' : ''}`}
                onClick={() => setOverride(rowId, col, formation.overrides[col].value, { status: s, source: src })}>{t(`res.status.${s}`)}</button>
            ))}
            <button className="btn sm" onClick={() => setOverride(rowId, col, formation.overrides[col].value, { status: formation.overrides[col].status, source: src })}>{t('common.save')}</button>
          </div>
        </>
      )}
    </div>
  );
}
