// Excel / CSV export of the report data. The workbook mirrors the report sections (one sheet each) and adds
// numeric sheets: Results (display units, values only), Status (class of every value), Traceability, Curves.
import { buildWorkbookBuffer } from '../io/tableParse.js';
import { toCsv } from '../io/csvWriter.js';
import { buildResultsTable, buildTraceTable } from '../results/exportResults.js';
import { COL, COLUMNS } from '../results/columns.js';
import { getLog } from '../registry/logRegistry.js';
import { unitLabel } from '../engine/units/units.js';

const text = (c) => (c && typeof c === 'object' ? `${c.t} [${c.s}]` : c ?? '');

function sheetName(title, used) {
  let n = String(title).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Sheet';
  let k = 2; const base = n;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 25)} ${k++}`;
  used.add(n.toLowerCase());
  return n;
}

/** Flatten one report section to rows of cells. */
export function sectionRows(section) {
  const rows = [];
  for (const b of section.blocks) {
    if (b.type === 'kv') b.rows.forEach(([k, v]) => rows.push([k, v]));
    else if (b.type === 'table') { if (b.caption) rows.push([b.caption]); rows.push(b.head); b.rows.forEach((r) => rows.push(r.map(text))); rows.push([]); }
    else if (b.type === 'list') b.items.forEach((i) => rows.push([i]));
    else if (b.type === 'p' || b.type === 'notice') rows.push([b.text]);
    else if (b.type === 'author') rows.push([b.title], [b.text]);
    else if (b.type === 'methods') b.items.forEach((m) => rows.push([m.name, m.equation, m.source, m.validity]));
    else if (b.type === 'cover') rows.push([b.title], [b.subtitle], [b.project], [b.date], [b.preparedBy], [b.reviewedBy]);
    else if (b.type === 'legend') b.items.forEach((i) => rows.push([i.code, i.label]));
  }
  return rows;
}

/** All curves merged on the union of depths (metres). Header carries the stored unit. */
export function curvesTable(data) {
  const ids = data.logRows.map((r) => r.curveId);
  const heads = data.logRows.map((r) => `${getLog(r.curveId, data.custom)?.abbr || r.curveId} (${unitLabel(r.unit)})`);
  const depths = [...new Set(data.logRows.flatMap((r) => r.depth))].sort((a, b) => a - b);
  const maps = data.logRows.map((r) => new Map(r.depth.map((d, i) => [d, r.values[i]])));
  const body = depths.map((d) => [d, ...maps.map((m) => (m.has(d) ? m.get(d) : ''))]);
  return { head: ['Depth (m)', ...heads], body, ids };
}

export function curvesToCsv(data) {
  const t = curvesTable(data);
  return toCsv(t.body.map((r) => Object.fromEntries(r.map((v, i) => [String(i), v]))), t.head.map((h, i) => ({ key: String(i), label: h })));
}

export function reportToWorkbook(model, data, tr) {
  const used = new Set();
  const sheets = {};
  const cols = (data.view.visible || COLUMNS.map((c) => c.id)).filter((c) => COL[c]);
  const label = (c) => tr(`res.col.${c}`);
  const statusLabel = (s) => tr(`res.status.${s}`);
  const t = buildResultsTable({ rows: data.rows, cols, units: data.units, label, statusLabel });
  sheets[sheetName('Results', used)] = [t.head, ...t.body];
  sheets[sheetName('Status', used)] = [t.head, ...t.status];
  sheets[sheetName('Traceability', used)] = buildTraceTable({ rows: data.rows, cols, label, traceText: (c) => JSON.stringify(c.trace) });
  if (data.logRows.length) { const c = curvesTable(data); sheets[sheetName('Curves', used)] = [c.head, ...c.body]; }
  model.sections.forEach((s, i) => { sheets[sheetName(`${i + 1} ${s.title}`, used)] = sectionRows(s); });
  sheets[sheetName('Info', used)] = [['Well', data.well.wellId], ['Name', data.well.name], ['Report', model.title], ['Generated', model.generatedAt], ['Language', model.lang], ['Run', data.run ? data.run.name : '-']];
  return buildWorkbookBuffer(sheets, 'xlsx');
}
