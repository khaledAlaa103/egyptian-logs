import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { getLog, acceptedUnitsOf, canonicalUnitOf, validateCurveValue } from '../../registry/logRegistry.js';
import { convert, unitLabel, toCanonical, fromCanonical } from '../../engine/units/units.js';
import { parseNumber } from '../../io/importEngine.js';
import { saveCurves, listWellCurves, deleteCurve } from '../../db/curves.js';
import CurveSelect from './CurveSelect.jsx';

const DEPTH_UNITS = ['m', 'ft', 'cm'];
const blankRow = () => ({ depth: '', v: {} });
const round = (x) => Number(x.toPrecision(10));

/** Cell-level validation. Returns error code or null. Empty value cells are allowed (missing). */
export function cellError(def, unit, text) {
  if (text === '' || text == null) return null;
  const n = parseNumber(text);
  if (!Number.isFinite(n)) return 'not_number';
  const canon = def.group ? toCanonical(n, def.group, unit) : n;
  return validateCurveValue(def, canon);
}

export default function ManualEntry({ well, custom }) {
  const { t } = usePrefs();
  const [curves, setCurves] = useState([]); // [{id, unit}]
  const [depthUnit, setDepthUnit] = useState('m');
  const [rows, setRows] = useState([blankRow()]);
  const [locked, setLocked] = useState([]); // curve ids stored from other sources
  const [pick, setPick] = useState('gr');
  const [status, setStatus] = useState('idle'); // idle | saving | saved
  const dirty = useRef(false);
  const loadedFor = useRef(null);

  // Load existing manual curves of this well
  useEffect(() => {
    let alive = true;
    loadedFor.current = null;
    dirty.current = false;
    setStatus('idle');
    if (!well) { setCurves([]); setRows([blankRow()]); setLocked([]); return; }
    listWellCurves(well.id).then((stored) => {
      if (!alive) return;
      setLocked(stored.filter((s) => s.source !== 'manual').map((s) => s.curveId));
      const manual = stored.filter((s) => s.source === 'manual');
      const cs = manual.map((s) => {
        const def = getLog(s.curveId, custom);
        const u = def && acceptedUnitsOf(def).includes(s.enteredUnit) ? s.enteredUnit : canonicalUnitOf(def || {});
        return { id: s.curveId, unit: u, rec: s };
      }).filter((c) => getLog(c.id, custom));
      const depths = [...new Set(cs.flatMap((c) => c.rec.depth))].sort((a, b) => a - b);
      const rs = depths.map((d) => {
        const v = {};
        cs.forEach((c) => {
          const i = c.rec.depth.indexOf(d);
          if (i >= 0) {
            const def = getLog(c.id, custom);
            v[c.id] = String(round(def.group ? fromCanonical(c.rec.values[i], def.group, c.unit) : c.rec.values[i]));
          }
        });
        return { depth: String(round(d)), v };
      });
      setDepthUnit('m');
      setCurves(cs.map(({ id, unit }) => ({ id, unit })));
      setRows(rs.length ? [...rs, blankRow()] : [blankRow()]);
      loadedFor.current = well.id;
    });
    return () => { alive = false; };
  }, [well, custom]);

  // Validation state
  const depthErr = (r, i) => {
    if (r.depth === '') return Object.values(r.v).some((x) => x !== '' && x != null) ? 'required' : null;
    const n = parseNumber(r.depth);
    if (!Number.isFinite(n) || n < 0) return 'depth';
    const dup = rows.findIndex((o, j) => j !== i && o.depth !== '' && parseNumber(o.depth) === n);
    return dup >= 0 && dup < i ? 'duplicate' : null;
  };

  const build = useCallback(() => curves.map((c) => {
    const def = getLog(c.id, custom);
    const points = [];
    rows.forEach((r, i) => {
      const dText = r.depth, vText = r.v[c.id];
      if (dText === '' || vText === '' || vText == null) return;
      const dn = parseNumber(dText);
      if (!Number.isFinite(dn) || dn < 0 || depthErr(r, i)) return;
      if (cellError(def, c.unit, vText)) return;
      const n = parseNumber(vText);
      points.push({ depth: toCanonical(dn, 'depth', depthUnit), value: def.group ? toCanonical(n, def.group, c.unit) : n, row: i + 1 });
    });
    return { curveId: c.id, unit: canonicalUnitOf(def), enteredUnit: c.unit, points };
  }), [curves, rows, depthUnit, custom]);  

  // Autosave (debounced). Only valid cells are persisted; invalid cells stay highlighted.
  useEffect(() => {
    if (!well || !dirty.current) return undefined;
    setStatus('saving');
    const h = setTimeout(async () => {
      const built = build();
      for (const c of built) {
        if (c.points.length) await saveCurves(well.id, [c], { mode: 'replace', source: 'manual', meta: { depthUnit } });
        else await deleteCurve(well.id, c.curveId);
      }
      dirty.current = false;
      setStatus('saved');
    }, 700);
    return () => clearTimeout(h);
  }, [rows, curves, depthUnit, well]);  

  const touch = () => { dirty.current = true; };
  const setCell = (i, key, val) => {
    touch();
    setRows((rs) => {
      const next = rs.map((r, j) => (j === i ? (key === 'depth' ? { ...r, depth: val } : { ...r, v: { ...r.v, [key]: val } }) : r));
      const last = next[next.length - 1];
      if (last.depth !== '' || Object.values(last.v).some((x) => x !== '')) next.push(blankRow());
      return next;
    });
  };
  const delRow = (i) => { touch(); setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [blankRow()])); };

  const addCurve = () => {
    if (!pick || curves.some((c) => c.id === pick) || locked.includes(pick)) return;
    const def = getLog(pick, custom);
    touch();
    setCurves((cs) => [...cs, { id: pick, unit: canonicalUnitOf(def) }]);
  };
  const removeCurve = async (id) => {
    touch();
    setCurves((cs) => cs.filter((c) => c.id !== id));
    setRows((rs) => rs.map((r) => { const v = { ...r.v }; delete v[id]; return { ...r, v }; }));
    if (well) await deleteCurve(well.id, id);
  };
  const changeUnit = (id, to) => {
    const c = curves.find((x) => x.id === id);
    const def = getLog(id, custom);
    if (!def.group || c.unit === to) return;
    touch();
    setRows((rs) => rs.map((r) => {
      const n = parseNumber(r.v[id]);
      return Number.isFinite(n) && r.v[id] !== '' ? { ...r, v: { ...r.v, [id]: String(round(convert(n, def.group, c.unit, to))) } } : r;
    }));
    setCurves((cs) => cs.map((x) => (x.id === id ? { ...x, unit: to } : x)));
  };
  const changeDepthUnit = (to) => {
    if (to === depthUnit) return;
    touch();
    setRows((rs) => rs.map((r) => {
      const n = parseNumber(r.depth);
      return Number.isFinite(n) ? { ...r, depth: String(round(convert(n, 'depth', depthUnit, to))) } : r;
    }));
    setDepthUnit(to);
  };

  const onPaste = (e, i, colKey) => {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text)) return; // single value: normal paste
    e.preventDefault();
    touch();
    const cols = ['depth', ...curves.map((c) => c.id)];
    const start = cols.indexOf(colKey);
    const grid = text.replace(/\r/g, '').split('\n').filter((l) => l !== '').map((l) => l.split('\t'));
    setRows((rs) => {
      const next = rs.map((r) => ({ ...r, v: { ...r.v } }));
      grid.forEach((cells, gi) => {
        while (next.length <= i + gi) next.push(blankRow());
        cells.forEach((val, gj) => {
          const key = cols[start + gj];
          if (!key) return;
          if (key === 'depth') next[i + gi].depth = val.trim(); else next[i + gi].v[key] = val.trim();
        });
      });
      next.push(blankRow());
      return next;
    });
  };

  if (!well) return <div className="card empty"><p>{t('imp.selectWellFirst')}</p></div>;

  const errCount = rows.reduce((n, r, i) => n + (depthErr(r, i) ? 1 : 0)
    + curves.reduce((m, c) => m + (cellError(getLog(c.id, custom), c.unit, r.v[c.id]) ? 1 : 0), 0), 0);

  return (
    <div className="manual">
      <div className="toolbar wrap">
        <CurveSelect value={pick} onChange={setPick} custom={custom} disabledIds={locked} aria-label={t('imp.addCurve')} />
        <button className="btn" onClick={addCurve}>+ {t('imp.addCurve')}</button>
        <label className="inline"><span>{t('imp.depthUnit')}</span>
          <select value={depthUnit} onChange={(e) => changeDepthUnit(e.target.value)} aria-label={t('imp.depthUnit')}>
            {DEPTH_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select></label>
        <span className={`save-state ${status}`} role="status">
          {status === 'saving' ? t('imp.saving') : status === 'saved' ? t('imp.autosaved') : ''}
          {errCount > 0 && ` · ${t('imp.invalidCells').replace('{n}', errCount)}`}
        </span>
      </div>
      <p className="muted small">{t('imp.manualHint')}</p>

      <div className="table-wrap grid-wrap" tabIndex={0}>
        <table className="data grid">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('imp.depth')} ({depthUnit})</th>
              {curves.map((c) => {
                const def = getLog(c.id, custom);
                const units = acceptedUnitsOf(def);
                return (
                  <th key={c.id}>
                    <div className="col-head">
                      <strong>{def.abbr}</strong>
                      <button className="icon-x" onClick={() => removeCurve(c.id)} aria-label={`${t('common.delete')} ${def.abbr}`}>×</button>
                    </div>
                    <select value={c.unit} onChange={(e) => changeUnit(c.id, e.target.value)} aria-label={`${t('imp.unit')} ${def.abbr}`}
                      disabled={units.length < 2}>
                      {units.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                    </select>
                  </th>
                );
              })}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const de = depthErr(r, i);
              return (
                <tr key={i}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <input dir="ltr" inputMode="decimal" value={r.depth} aria-invalid={!!de} aria-label={`${t('imp.depth')} ${i + 1}`}
                      title={de ? t(`imp.cell.${de}`) : ''}
                      onChange={(e) => setCell(i, 'depth', e.target.value)} onPaste={(e) => onPaste(e, i, 'depth')} />
                  </td>
                  {curves.map((c) => {
                    const def = getLog(c.id, custom);
                    const ce = cellError(def, c.unit, r.v[c.id]);
                    return (
                      <td key={c.id}>
                        <input dir="ltr" inputMode="decimal" value={r.v[c.id] ?? ''} aria-invalid={!!ce}
                          aria-label={`${def.abbr} ${i + 1}`} title={ce ? t(`imp.cell.${ce}`) : ''}
                          onChange={(e) => setCell(i, c.id, e.target.value)} onPaste={(e) => onPaste(e, i, c.id)} />
                      </td>
                    );
                  })}
                  <td><button className="icon-x" onClick={() => delRow(i)} aria-label={`${t('common.delete')} ${i + 1}`}>×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
