/** Build RFC-4180 CSV text. columns: [{key, label}] ; UTF-8 BOM added so Excel reads Arabic correctly. */
export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label ?? c.key)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(','));
  return '﻿' + [head, ...body].join('\r\n');
}
