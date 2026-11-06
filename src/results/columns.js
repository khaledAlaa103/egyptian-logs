// Column catalogue and row builder for the results table. Pure JS (no React, no DB).
// Every derived cell carries a trace (what it was computed from) and a status class
// (measured | corrected | calculated | estimated | user) so reports can separate them.
import { statsInInterval } from './intervalStats.js';
import { convert, toCanonical, fromCanonical } from '../engine/units/units.js';
import { parseNumber } from '../io/importEngine.js';
import { WATER_STATUS } from './constants.js';

export const CONFIDENCE = ['low', 'medium', 'high'];
export const AQUIFER_CLASS = ['unknown', 'aquifer', 'aquitard', 'aquiclude'];

// kind: auto | input | curve | run | override
export const COLUMNS = [
  { id: 'number', kind: 'auto', type: 'int', width: 56 },
  { id: 'name', kind: 'input', type: 'text', width: 150 },
  { id: 'top', kind: 'input', type: 'number', group: 'depth', min: 0, width: 90 },
  { id: 'bottom', kind: 'input', type: 'number', group: 'depth', min: 0, width: 90 },
  { id: 'thickness', kind: 'auto', type: 'number', group: 'depth', width: 90 },
  { id: 'gr', kind: 'curve', type: 'number', group: 'gr', picks: ['gr', 'sgr'], mode: 'arith', status: 'measured', min: 0, width: 90 },
  { id: 'rs', kind: 'curve', type: 'number', group: 'resistivity', picks: ['res_shallow', 'micro_res', 'short_normal'], mode: 'geo', status: 'measured', positive: true, width: 100 },
  { id: 'rd', kind: 'curve', type: 'number', group: 'resistivity', picks: ['res_deep', 'laterolog', 'induction', 'long_normal', 'res_medium'], mode: 'geo', status: 'measured', positive: true, width: 100 },
  { id: 'rc', kind: 'run', type: 'number', group: 'resistivity', series: 'rt', mode: 'geo', positive: true, width: 110 },
  { id: 'rt', kind: 'run', type: 'number', group: 'resistivity', series: 'rt', mode: 'geo', positive: true, width: 110 },
  { id: 'rw', kind: 'run', type: 'number', group: 'resistivity', series: 'rw', mode: 'geo', positive: true, width: 100 },
  { id: 'vsh', kind: 'run', type: 'number', group: 'porosity', series: 'vsh', mode: 'arith', status: 'calculated', min: 0, max: 1, width: 90 },
  { id: 'phi', kind: 'run', type: 'number', group: 'porosity', series: 'phi', mode: 'arith', status: 'calculated', min: 0, max: 1, width: 90 },
  { id: 'sw', kind: 'run', type: 'number', group: 'porosity', series: 'sw', mode: 'arith', status: 'calculated', min: 0, max: 1, width: 90 },
  { id: 'ec', kind: 'curve', type: 'number', group: 'conductivity', picks: ['ec', 'fluid_ec'], mode: 'arith', status: 'measured', min: 0, width: 100 },
  { id: 'tds', kind: 'override', type: 'number', group: 'tds', min: 0, width: 100 },
  { id: 'lithology', kind: 'input', type: 'text', width: 120 },
  { id: 'waterBearing', kind: 'input', type: 'enum', options: WATER_STATUS, width: 130 },
  { id: 'aquiferClass', kind: 'input', type: 'enum', options: AQUIFER_CLASS, width: 120 },
  { id: 'interpretation', kind: 'input', type: 'text', width: 200 },
  { id: 'confidence', kind: 'input', type: 'enum', options: CONFIDENCE, allowEmpty: true, width: 100 },
  { id: 'notes', kind: 'input', type: 'text', width: 200 },
];
export const COL = Object.fromEntries(COLUMNS.map((c) => [c.id, c]));
export const DEFAULT_VISIBLE = ['number', 'name', 'top', 'bottom', 'thickness', 'gr', 'rs', 'rd', 'rc', 'rt', 'rw', 'phi', 'sw', 'ec', 'tds', 'lithology', 'waterBearing', 'interpretation', 'confidence', 'notes'];

const isEditable = (c) => c.kind === 'input' || c.kind === 'override' || c.kind === 'curve' || c.kind === 'run';

/** Whether a column has data behind it given the available curves / run. */
export function columnAvailable(col, ctx) {
  const c = COL[col];
  if (c.kind === 'auto' || c.kind === 'input' || c.kind === 'override') return true;
  if (c.kind === 'curve') return c.picks.some((p) => ctx.curves[p]);
  if (c.kind === 'run') {
    if (!ctx.run) return false;
    if (col === 'rc') return ['factor', 'geometric'].includes(ctx.run.config?.resistivity?.method) && ctx.run.series.rt.some((v) => v != null);
    const s = col === 'phi' && ctx.run.config?.porosity?.shaleCorrection?.enabled ? 'phiE' : c.series;
    return ctx.run.series[s]?.some((v) => v != null);
  }
  return false;
}

const RT_STATUS = { direct: 'estimated', geometric: 'corrected', factor: 'corrected' };
const RW_STATUS = { manual: 'corrected', sp: 'estimated', rwa_min: 'estimated' };

/** Which curve feeds a curve-type column (user choice via sources, else first available pick). */
export function pickCurve(col, ctx) {
  const chosen = ctx.sources?.[col];
  if (chosen && ctx.curves[chosen]) return chosen;
  return COL[col].picks.find((p) => ctx.curves[p]) || null;
}

function derive(col, f, ctx) {
  const c = COL[col];
  if (c.kind === 'curve') {
    const id = pickCurve(col, ctx);
    if (!id) return { v: null };
    const cv = ctx.curves[id];
    const st = statsInInterval(cv.depth, cv.values, f.top, f.bottom, c.mode);
    return { v: st.n ? st.mean : null, status: c.status, trace: { kind: 'curve', curveId: id, mode: c.mode, n: st.n, min: st.min, max: st.max, top: f.top, bottom: f.bottom, warn: id === 'fluid_ec' ? 'fluid_ec' : null } };
  }
  if (c.kind === 'run') {
    const run = ctx.run;
    if (!run) return { v: null };
    const cfg = run.config || {};
    if (col === 'rc' && !['factor', 'geometric'].includes(cfg.resistivity?.method)) return { v: null };
    const series = col === 'phi' && cfg.porosity?.shaleCorrection?.enabled ? 'phiE' : c.series;
    const arr = run.series[series];
    if (!arr) return { v: null };
    const st = statsInInterval(run.depth, arr, f.top, f.bottom, c.mode);
    const status = col === 'rt' || col === 'rc' ? RT_STATUS[cfg.resistivity?.method] : col === 'rw' ? RW_STATUS[cfg.rw?.method] : c.status;
    return { v: st.n ? st.mean : null, status, trace: { kind: 'run', runId: run.id, runName: run.name, series, mode: c.mode, n: st.n, min: st.min, max: st.max, methods: run.methods, top: f.top, bottom: f.bottom } };
  }
  return { v: null };
}

/** Build display rows. formations must be sorted by top. */
export function buildRows(formations, ctx) {
  return formations.map((f, i) => {
    const cells = {};
    for (const c of COLUMNS) {
      let cell;
      if (c.id === 'number') cell = { v: i + 1, status: 'auto' };
      else if (c.id === 'thickness') cell = { v: f.bottom - f.top, status: 'auto' };
      else if (c.kind === 'input') cell = { v: f[c.id] ?? (c.type === 'enum' && !c.allowEmpty ? c.options[0] : ''), status: 'input' };
      else if (c.kind === 'override') {
        const wq = c.id === 'tds' ? f.waterQuality : null; // written by the Water Quality module
        cell = wq && wq.tds != null
          ? { v: wq.tds, status: wq.status || 'estimated', trace: { kind: 'water', basis: wq.basis, method: wq.method, sampleId: wq.sampleId ?? null, relPct: wq.relPct ?? null, ec25: wq.ec25 ?? null, calibration: wq.calibration ?? null, rw: wq.rw ?? null, tC: wq.tC ?? null, flags: wq.flags || [], cls: wq.class ?? null } }
          : { v: null, status: 'user' };
      }
      else cell = derive(c.id, f, ctx);
      const ov = f.overrides?.[c.id];
      if (ov && typeof ov.value === 'number') cell = { v: ov.value, status: ov.status || 'user', overridden: true, trace: { kind: 'user', source: ov.source || '' }, derivedValue: cell.v };
      cells[c.id] = cell;
    }
    return { id: f.id, formation: f, cells };
  });
}

// ---------------- display / parsing ----------------

/** Canonical -> display text in the chosen unit. */
export function formatCell(col, v, unit) {
  const c = COL[col];
  if (v == null || v === '') return '';
  if (c.type === 'number') {
    const x = c.group && unit ? fromCanonical(v, c.group, unit) : v;
    return Number.isFinite(x) ? String(Number(x.toPrecision(5))) : '';
  }
  return String(v);
}

/** Display text -> { value (canonical) } or { error }. */
export function parseCell(col, text, unit) {
  const c = COL[col];
  const t = String(text ?? '').trim();
  if (c.type === 'text') return { value: t };
  if (c.type === 'enum') {
    if (t === '' && c.allowEmpty) return { value: '' };
    const hit = c.options.find((o) => o.toLowerCase() === t.toLowerCase());
    return hit ? { value: hit } : { error: 'enum' };
  }
  if (t === '') return { value: null };
  const n = parseNumber(t);
  if (!Number.isFinite(n)) return { error: 'number' };
  const canon = c.group && unit ? toCanonical(n, c.group, unit) : n;
  if (c.positive && canon <= 0) return { error: 'positive' };
  if (c.min != null && canon < c.min) return { error: 'range' };
  if (c.max != null && canon > c.max) return { error: 'range' };
  return { value: canon };
}

/** Convert a value between display units (used when the user switches a unit). */
export const convertDisplay = (group, v, from, to) => convert(v, group, from, to);

// ---------------- sorting and filtering ----------------
export function compareValues(a, b) {
  const an = a == null || a === '', bn = b == null || b === '';
  if (an && bn) return 0;
  if (an) return 1; // empty values sort last in either direction handled by caller
  if (bn) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Filter expression for a column: text (substring) or for numbers: ">10", "<=5", "=3", "2..8" (display units).
 * Returns a predicate over the display value or null for an empty filter.
 */
export function makeFilter(expr, isNumber) {
  const e = String(expr ?? '').trim();
  if (!e) return null;
  if (!isNumber) { const q = e.toLowerCase(); return (v) => String(v ?? '').toLowerCase().includes(q); }
  let m = /^(-?[\d.,]+)\s*\.\.\s*(-?[\d.,]+)$/.exec(e);
  if (m) { const a = parseNumber(m[1]), b = parseNumber(m[2]); return (v) => typeof v === 'number' && v >= Math.min(a, b) && v <= Math.max(a, b); }
  m = /^(>=|<=|>|<|=)\s*(-?[\d.,]+)$/.exec(e);
  if (m) {
    const x = parseNumber(m[2]);
    const ops = { '>': (v) => v > x, '<': (v) => v < x, '>=': (v) => v >= x, '<=': (v) => v <= x, '=': (v) => Math.abs(v - x) < 1e-9 * Math.max(1, Math.abs(x)) };
    return (v) => typeof v === 'number' && ops[m[1]](v);
  }
  const x = parseNumber(e);
  if (Number.isFinite(x)) return (v) => typeof v === 'number' && Math.abs(v - x) < 1e-9 * Math.max(1, Math.abs(x));
  return () => false;
}

export { isEditable };
