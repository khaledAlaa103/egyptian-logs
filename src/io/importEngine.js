// Import engine: header detection, column mapping guesses, number parsing, validation and
// preview construction. Pure functions; every extracted point keeps its source row.
import {
  guessCurve, getLog, validateCurveValue, canonicalUnitOf, acceptedUnitsOf,
} from '../registry/logRegistry.js';
import { normalizeUnit, toCanonical } from '../engine/units/units.js';

export const DEFAULT_NULLS = ['-999.25', '-999', '-9999', '-99999', '-999.2500', 'nan', 'null', 'na', 'n/a', '#n/a', '--', ''];

const DEPTH_ALIASES = ['depth', 'dept', 'dep', 'md', 'tvd', 'tvdss', 'measureddepth', 'depthm', 'depthft', 'عمق'];

const isEmptyRow = (r) => r.every((c) => c === '' || c == null);

/** Parse a number from text/number. decimal: 'auto' | '.' | ','. Returns NaN when invalid. */
export function parseNumber(v, decimal = 'auto') {
  if (typeof v === 'number') return v;
  if (v == null) return NaN;
  let s = String(v).trim().replace(/\s/g, '');
  if (s === '') return NaN;
  const hasC = s.includes(','), hasD = s.includes('.');
  if (decimal === ',') s = s.replace(/\./g, '').replace(',', '.');
  else if (decimal === '.') s = s.replace(/,/g, '');
  else if (hasC && hasD) {
    // last separator is the decimal mark
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (hasC) {
    s = /^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/** First row (within the first 30) that contains text cells and is followed by a mostly numeric row. */
export function detectHeaderRow(rows) {
  const limit = Math.min(rows.length - 1, 30);
  for (let i = 0; i < limit; i++) {
    const r = rows[i];
    if (isEmptyRow(r)) continue;
    const textCells = r.filter((c) => c !== '' && Number.isNaN(parseNumber(c))).length;
    const next = rows.slice(i + 1).find((x) => !isEmptyRow(x));
    if (!next) break;
    const numNext = next.filter((c) => !Number.isNaN(parseNumber(c))).length;
    if (textCells >= 2 && numNext >= Math.max(2, Math.floor(next.length / 2))) return i;
  }
  return 0;
}

/** Extract a unit written in a header, e.g. "RD (ohm.m)" or "Depth [ft]". */
export function unitFromHeader(h) {
  const m = /[\(\[]\s*([^)\]]+?)\s*[\)\]]/.exec(String(h ?? ''));
  return m ? normalizeUnit(m[1]) : null;
}

export function isDepthHeader(h) {
  const n = String(h ?? '').toLowerCase().replace(/[\(\[].*?[\)\]]/g, '').replace(/[^a-z؀-ۿ0-9]/g, '');
  return DEPTH_ALIASES.includes(n);
}

/**
 * Suggest a mapping: { [colIndex]: { role: 'depth'|'ignore'|curveId, unit: string|null } }.
 * Units come ONLY from the header; when absent the user must choose (no silent assumption).
 */
export function guessMapping(headers, custom = []) {
  const mapping = {};
  let depthSet = false;
  headers.forEach((h, i) => {
    if (!depthSet && isDepthHeader(h)) {
      mapping[i] = { role: 'depth', unit: unitFromHeader(h) };
      depthSet = true;
      return;
    }
    const id = guessCurve(h, custom);
    mapping[i] = id ? { role: id, unit: unitFromHeader(h) } : { role: 'ignore', unit: null };
  });
  return mapping;
}

/**
 * Validate and convert. Inputs:
 *  rows: array of arrays; headerRow: index of header row; mapping as above;
 *  opts: { nullValues, decimal, totalDepth (m), custom, sourceName }
 * Output: { curves, issues, summary, blocking }
 * Points: { depth (m, canonical), value (canonical), row (1-based source row), raw }
 */
export function buildPreview(rows, headerRow, mapping, opts = {}) {
  const { nullValues = DEFAULT_NULLS, decimal = 'auto', totalDepth = null, custom = [] } = opts;
  const nulls = new Set(nullValues.map((x) => String(x).trim().toLowerCase()));
  const issues = [];
  const blocking = [];
  const headers = rows[headerRow] || [];

  const depthCols = Object.entries(mapping).filter(([, m]) => m.role === 'depth');
  if (depthCols.length !== 1) blocking.push({ code: depthCols.length ? 'depth_multiple' : 'depth_missing' });
  const depthCol = depthCols.length === 1 ? Number(depthCols[0][0]) : null;
  const depthUnit = depthCols.length === 1 ? depthCols[0][1].unit : null;
  if (depthCol != null && (!depthUnit || !(depthUnit in { m: 1, ft: 1, cm: 1 }))) {
    blocking.push({ code: depthUnit ? 'unit_invalid' : 'unit_missing', col: depthCol, header: headers[depthCol] });
  }

  // curve columns
  const curveCols = [];
  const seen = new Map();
  for (const [col, m] of Object.entries(mapping)) {
    if (m.role === 'depth' || m.role === 'ignore') continue;
    const def = getLog(m.role, custom);
    const c = Number(col);
    if (!def || def.kind !== 'curve') { blocking.push({ code: 'curve_unknown', col: c }); continue; }
    if (seen.has(def.id)) blocking.push({ code: 'curve_duplicate', col: c, curveId: def.id });
    seen.set(def.id, c);
    const unit = m.unit;
    const ok = unit && acceptedUnitsOf(def).includes(unit);
    if (!ok) {
      blocking.push({ code: unit ? 'unit_invalid' : 'unit_missing', col: c, curveId: def.id, header: headers[c] });
      continue;
    }
    curveCols.push({ col: c, def, unit });
  }

  const out = new Map(curveCols.map((c) => [c.def.id, {
    curveId: c.def.id, unit: canonicalUnitOf(c.def), enteredUnit: c.unit, header: String(headers[c.col] ?? ''),
    col: c.col, points: [], stats: { n: 0, min: null, max: null, missing: 0, invalid: 0 },
  }]));

  let rowsRead = 0, rowsUsed = 0;
  if (!blocking.length) {
    const body = rows.slice(headerRow + 1);
    const depthSeen = new Map();
    let prev = -Infinity, unsorted = false;
    body.forEach((r, i) => {
      if (isEmptyRow(r)) return;
      rowsRead++;
      const rowNo = headerRow + 2 + i;
      const raw = r[depthCol];
      const d = nulls.has(String(raw).trim().toLowerCase()) ? NaN : parseNumber(raw, decimal);
      if (!Number.isFinite(d)) { issues.push({ severity: 'error', code: 'depth_invalid', row: rowNo, value: String(raw) }); return; }
      const depth = toCanonical(d, 'depth', depthUnit);
      if (depth < 0) { issues.push({ severity: 'error', code: 'depth_negative', row: rowNo, value: String(raw) }); return; }
      if (totalDepth != null && depth > totalDepth + 1e-9) {
        issues.push({ severity: 'warning', code: 'depth_beyond_td', row: rowNo, value: depth });
      }
      const key = depth.toFixed(6);
      if (depthSeen.has(key)) { issues.push({ severity: 'warning', code: 'depth_duplicate', row: rowNo, value: depth, firstRow: depthSeen.get(key) }); return; }
      depthSeen.set(key, rowNo);
      if (depth < prev) unsorted = true;
      prev = depth;
      let used = false;
      for (const c of curveCols) {
        const cell = r[c.col];
        const cur = out.get(c.def.id);
        if (nulls.has(String(cell ?? '').trim().toLowerCase())) { cur.stats.missing++; continue; }
        const v = parseNumber(cell, decimal);
        if (!Number.isFinite(v)) {
          cur.stats.invalid++;
          issues.push({ severity: 'error', code: 'value_invalid', row: rowNo, curveId: c.def.id, value: String(cell) });
          continue;
        }
        const canon = c.def.group ? toCanonical(v, c.def.group, c.unit) : v; // custom curves: single free unit
        const bad = validateCurveValue(c.def, canon);
        if (bad) {
          cur.stats.invalid++;
          issues.push({ severity: 'error', code: bad, row: rowNo, curveId: c.def.id, value: v });
          continue;
        }
        cur.points.push({ depth, value: canon, row: rowNo, raw: String(cell) });
        cur.stats.n++;
        cur.stats.min = cur.stats.min == null ? canon : Math.min(cur.stats.min, canon);
        cur.stats.max = cur.stats.max == null ? canon : Math.max(cur.stats.max, canon);
        used = true;
      }
      if (used) rowsUsed++;
    });
    if (unsorted) issues.push({ severity: 'warning', code: 'depth_unsorted' });
    for (const cur of out.values()) {
      cur.points.sort((a, b) => a.depth - b.depth);
      if (cur.stats.n === 0) issues.push({ severity: 'error', code: 'curve_empty', curveId: cur.curveId });
    }
  }

  const curves = [...out.values()].filter((c) => c.points.length);
  return {
    curves, issues, blocking,
    summary: {
      rowsRead, rowsUsed,
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
    },
  };
}
