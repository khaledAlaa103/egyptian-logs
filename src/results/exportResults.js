// Builds export tables (Excel / CSV) from the results rows. Values are exported in the DISPLAY units
// chosen by the user, with the unit in the header, and a Traceability sheet states where each derived
// column comes from. Pure JS except the SheetJS workbook builder.
import { COL, formatCell } from './columns.js';
import { unitLabel } from '../engine/units/units.js';
import { buildWorkbookBuffer } from '../io/tableParse.js';
import { toCsv } from '../io/csvWriter.js';

const numeric = (col, v, unit) => {
  const c = COL[col];
  if (c.type !== 'number' || v == null) return v ?? '';
  const t = formatCell(col, v, unit);
  return t === '' ? '' : Number(t);
};

/** label(colId) -> header text; statusLabel(status) -> text. */
export function buildResultsTable({ rows, cols, units, label, statusLabel }) {
  const head = cols.map((c) => {
    const u = COL[c].group && units[COL[c].group] ? ` (${unitLabel(units[COL[c].group])})` : '';
    return label(c) + u;
  });
  const body = rows.map((r) => cols.map((c) => numeric(c, r.cells[c].v, units[COL[c].group])));
  const status = rows.map((r) => cols.map((c) => (r.cells[c].status === 'input' || r.cells[c].status === 'auto' ? '' : statusLabel(r.cells[c].status))));
  return { head, body, status };
}

export function buildTraceTable({ rows, cols, label, traceText }) {
  const lines = [['#', label('name'), 'Column', 'Status', 'Trace']];
  rows.forEach((r) => cols.forEach((c) => {
    const cell = r.cells[c];
    if (!cell.trace) return;
    lines.push([r.cells.number.v, r.cells.name.v, label(c), cell.status, traceText(cell)]);
  }));
  return lines;
}

export function resultsToWorkbook({ well, rows, cols, units, label, statusLabel, traceText, infoLines }) {
  const t = buildResultsTable({ rows, cols, units, label, statusLabel });
  const sheets = {
    Results: [t.head, ...t.body],
    Status: [t.head, ...t.status],
    Traceability: buildTraceTable({ rows, cols, label, traceText }),
    Info: [['Well ID', well.wellId], ['Well name', well.name], ...infoLines],
  };
  return buildWorkbookBuffer(sheets, 'xlsx');
}

export function resultsToCsv({ rows, cols, units, label }) {
  const t = buildResultsTable({ rows, cols, units, label, statusLabel: (s) => s });
  const columns = t.head.map((h, i) => ({ key: String(i), label: h }));
  const data = t.body.map((r) => Object.fromEntries(r.map((v, i) => [String(i), v])));
  return toCsv(data, columns);
}
