// Parsing of delimited text and Excel workbooks into a plain 2-D array ("rows of cells").
import * as XLSX from 'xlsx';

const CANDIDATES = [',', ';', '\t', '|'];

/** Quote-aware CSV/TSV parser (RFC 4180). Returns array of rows (arrays of strings). */
export function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += c;
    } else if (c === '"' && cell === '') inQ = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * Detect the delimiter: choose the candidate that yields the most consistent
 * column count (>1) across the first lines, outside quotes. Returns { delimiter, confident }.
 */
export function detectDelimiter(text) {
  const sample = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).filter((l) => l.trim() !== '').slice(0, 30);
  let best = { delimiter: ',', score: -1, cols: 1 };
  for (const d of CANDIDATES) {
    const counts = parseDelimited(sample.join('\n'), d).map((r) => r.length);
    if (!counts.length) continue;
    const mode = Object.entries(counts.reduce((m, c) => ((m[c] = (m[c] || 0) + 1), m), {}))
      .sort((a, b) => b[1] - a[1])[0];
    const cols = Number(mode[0]);
    const consistency = mode[1] / counts.length;
    const score = cols > 1 ? consistency * 100 + Math.min(cols, 20) : -1;
    if (score > best.score) best = { delimiter: d, score, cols };
  }
  return { delimiter: best.delimiter, confident: best.score >= 90 && best.cols > 1 };
}

/** Parse CSV text with auto-detected (or forced) delimiter. */
export function parseCsvText(text, forcedDelimiter) {
  const det = forcedDelimiter ? { delimiter: forcedDelimiter, confident: true } : detectDelimiter(text);
  return { rows: parseDelimited(text, det.delimiter), delimiter: det.delimiter, confident: det.confident };
}

/** Read an XLSX/XLS (ArrayBuffer) and return { sheetNames, sheets: {name: rows} } with raw cell values. */
export function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheets = {};
  for (const name of wb.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false });
  }
  return { sheetNames: wb.SheetNames, sheets };
}

/** Build an XLSX ArrayBuffer from sheets {name: rows}; used for tests and sample files. */
export function buildWorkbookBuffer(sheets, bookType = 'xlsx') {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { type: 'array', bookType });
}
