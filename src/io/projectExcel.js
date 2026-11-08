// Project <-> Excel workbook.
// Sheets: "Project" (key/value), "Wells", "Logs" (Well ID, Depth (m), curve columns with units in the
// header), "Formations". Pure parsing/building; persistence is done by importProjectExcel() (db layer).
import { parseWorkbook, buildWorkbookBuffer } from './tableParse.js';
import { guessMapping, buildPreview } from './importEngine.js';
import { getLog, canonicalUnitOf } from '../registry/logRegistry.js';
import { unitLabel } from '../engine/units/units.js';
import { validateWell, normalizeWell } from '../features/wells/validate.js';
import { validateFormation } from '../db/intervals.js';

export const SHEETS = { project: 'Project', wells: 'Wells', logs: 'Logs', formations: 'Formations' };
export const WELL_COLS = [
  ['wellId', 'Well ID'], ['name', 'Name'], ['wellType', 'Type'], ['totalDepth', 'Total depth (m)'],
  ['groundElevation', 'Ground elevation (m)'], ['country', 'Country'], ['region', 'Region'], ['location', 'Location'],
  ['lat', 'Latitude'], ['lon', 'Longitude'], ['operator', 'Operator'], ['formation', 'Formation'], ['notes', 'Notes'],
];
const FORM_COLS = ['Well ID', 'Top (m)', 'Bottom (m)', 'Name', 'Lithology', 'Water-bearing', 'Notes'];
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
const blank = (v) => v === '' || v == null;

/** Rows for each sheet from an exportProject() bundle (canonical units: metres etc.). */
export function projectToSheets(bundle) {
  const p = bundle.project;
  const wells = bundle.wells;
  const sheets = {
    [SHEETS.project]: [['Name', p.name], ['Client', p.client || ''], ['Description', p.description || '']],
    [SHEETS.wells]: [WELL_COLS.map((c) => c[1]), ...wells.map((w) => WELL_COLS.map(([k]) => w[k] ?? ''))],
  };
  const wid = new Map(wells.map((w) => [w.id, w.wellId]));
  // Logs: one block per well, union of that well's depths
  const logRows = [];
  const curveIds = [];
  for (const m of bundle.data.logMeasurements || []) if (!curveIds.includes(m.curveId)) curveIds.push(m.curveId);
  const heads = curveIds.map((id) => {
    const m = bundle.data.logMeasurements.find((x) => x.curveId === id);
    return `${getLog(id)?.abbr || id} (${unitLabel(m.unit)})`;
  });
  for (const w of wells) {
    const ms = (bundle.data.logMeasurements || []).filter((m) => m.wellId === w.id);
    const depths = [...new Set(ms.flatMap((m) => m.depth))].sort((a, b) => a - b);
    const maps = new Map(ms.map((m) => [m.curveId, new Map(m.depth.map((d, i) => [d, m.values[i]]))]));
    for (const d of depths) logRows.push([w.wellId, d, ...curveIds.map((id) => maps.get(id)?.get(d) ?? '')]);
  }
  sheets[SHEETS.logs] = [['Well ID', 'Depth (m)', ...heads], ...logRows];
  sheets[SHEETS.formations] = [FORM_COLS, ...(bundle.data.formations || []).map((f) => [
    wid.get(f.wellId) || '', f.top, f.bottom, f.name || '', f.lithology || '', f.waterBearing || 'unknown', f.notes || ''])];
  return sheets;
}

export const projectToWorkbook = (bundle) => buildWorkbookBuffer(projectToSheets(bundle));

/** Blank workbook with the expected sheets and headers (no data rows: nothing fake). */
export function templateWorkbook() {
  const sheets = projectToSheets({ project: { name: '' }, wells: [], data: { logMeasurements: [], formations: [] } });
  sheets[SHEETS.logs] = [['Well ID', 'Depth (m)', ...['gr', 'res_deep', 'density', 'sp'].map((id) => {
    const d = getLog(id);
    return `${d.abbr} (${unitLabel(canonicalUnitOf(d))})`;
  })]];
  return buildWorkbookBuffer(sheets);
}

const findSheet = (sheets, name) => Object.keys(sheets).find((k) => norm(k) === norm(name));

function table(rows) {
  const head = (rows[0] || []).map((h) => norm(h));
  return rows.slice(1).filter((r) => r.some((c) => !blank(c))).map((r) => ({ r, get: (label) => r[head.indexOf(norm(label))] }));
}

/**
 * Parse a workbook ArrayBuffer. Returns { project, wells, logs: [{wellId, curves}], formations, warnings }
 * or throws Error('EXCEL_INVALID:<reason>') when nothing can be imported reliably.
 */
export function parseProjectWorkbook(buffer) {
  let wb;
  try { wb = parseWorkbook(buffer); } catch { throw new Error('EXCEL_INVALID:unreadable'); }
  const { sheets } = wb;
  const warnings = [];
  const sp = findSheet(sheets, SHEETS.project), sw = findSheet(sheets, SHEETS.wells);
  if (!sp) throw new Error('EXCEL_INVALID:no_project_sheet');
  const kv = new Map(sheets[sp].map((r) => [norm(r[0]), r[1]]));
  const name = String(kv.get('name') ?? '').trim();
  if (!name) throw new Error('EXCEL_INVALID:no_project_name');
  const project = { name, client: String(kv.get('client') ?? ''), description: String(kv.get('description') ?? '') };
  if (!sw) throw new Error('EXCEL_INVALID:no_wells_sheet');

  const wells = [];
  const seen = new Set();
  for (const { get, r } of table(sheets[sw])) {
    const w = {};
    for (const [key, label] of WELL_COLS) { const v = get(label); if (!blank(v)) w[key] = v; }
    w.wellType = w.wellType ? String(w.wellType).toLowerCase() : 'water';
    const errs = validateWell({ ...w, projectId: 1 }, [...seen]);
    if (Object.keys(errs).length) throw new Error(`EXCEL_INVALID:well_row:${r[0] ?? ''}:${Object.keys(errs).join(',')}`);
    seen.add(String(w.wellId).trim().toLowerCase());
    wells.push(normalizeWell(w));
  }
  if (!wells.length) throw new Error('EXCEL_INVALID:no_wells');

  // Logs
  const logs = [];
  const sl = findSheet(sheets, SHEETS.logs);
  if (sl && sheets[sl].length > 1) {
    const [head, ...body] = sheets[sl];
    const groups = new Map();
    for (const r of body) {
      if (r.every(blank)) continue;
      const id = String(r[0] ?? '').trim().toLowerCase();
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(r.slice(1));
    }
    for (const [id, rows] of groups) {
      const w = wells.find((x) => x.wellId.toLowerCase() === id);
      if (!w) throw new Error(`EXCEL_INVALID:log_unknown_well:${id}`);
      const header = head.slice(1);
      const table2 = [header, ...rows];
      const mapping = guessMapping(header);
      const prev = buildPreview(table2, 0, mapping, { totalDepth: w.totalDepth });
      if (prev.blocking.length) throw new Error(`EXCEL_INVALID:log_blocking:${w.wellId}:${prev.blocking.map((b) => b.code + (b.header ? `(${b.header})` : '')).join(',')}`);
      if (prev.summary.errors) warnings.push({ code: 'log_rows_skipped', wellId: w.wellId, n: prev.summary.errors });
      logs.push({ wellId: w.wellId, curves: prev.curves });
    }
  }

  // Formations
  const formations = [];
  const sf = findSheet(sheets, SHEETS.formations);
  if (sf) {
    const done = new Map();
    for (const { get } of table(sheets[sf])) {
      const wid = String(get('Well ID') ?? '').trim().toLowerCase();
      const w = wells.find((x) => x.wellId.toLowerCase() === wid);
      const f = { top: get('Top (m)'), bottom: get('Bottom (m)'), name: get('Name') ?? '', lithology: get('Lithology') ?? '',
        waterBearing: get('Water-bearing') || 'unknown', notes: get('Notes') ?? '' };
      const err = w ? validateFormation(f, done.get(w.wellId) || []) : 'well';
      if (err) { warnings.push({ code: 'formation_skipped', wellId: wid, reason: err }); continue; }
      const rec = { ...f, top: Number(f.top), bottom: Number(f.bottom) };
      done.set(w.wellId, [...(done.get(w.wellId) || []), rec]);
      formations.push({ wellId: w.wellId, ...rec });
    }
  }
  return { project, wells, logs, formations, warnings };
}
