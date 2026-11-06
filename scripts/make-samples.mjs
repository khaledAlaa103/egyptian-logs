// Generates SYNTHETIC sample datasets in samples/ (CSV + XLSX). They are test data, not a real well.
//   node scripts/make-samples.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

mkdirSync('samples', { recursive: true });
const rows = [['DEPT', 'GR', 'RD', 'RHOB', 'NPHI', 'SP']];
for (let i = 0; i <= 200; i++) {
  const d = i * 0.5;
  const sand = d > 40 && d < 70;
  rows.push([d, sand ? 30 : 100, sand ? 20 : 3, sand ? 2.2 : 2.5, sand ? 0.28 : 0.38, sand ? -40 : 0]);
}
writeFileSync('samples/synthetic-well.csv', rows.map((r) => r.join(',')).join('\n') + '\n');
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Logs');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['Sample', 'Depth (m)', 'TDS (mg/L)', 'EC (uS/cm)', 'Temp (C)', 'Source'],
  ['S1', 50, 800, 1250, 25, 'synthetic'], ['S2', 60, 1500, 2300, 25, 'synthetic'],
]), 'Water');
writeFileSync('samples/synthetic-well.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log('samples/ written');
