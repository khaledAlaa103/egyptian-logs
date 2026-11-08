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

// Whole project in the "Projects -> Import project from Excel" format (two synthetic wells).
const pb = XLSX.utils.book_new();
const sheet = (name, aoa) => XLSX.utils.book_append_sheet(pb, XLSX.utils.aoa_to_sheet(aoa), name);
sheet('Project', [['Name', 'SYNTHETIC demo project'], ['Client', 'Test data'], ['Description', 'Synthetic data for trying the import — not real wells']]);
sheet('Wells', [['Well ID', 'Name', 'Type', 'Total depth (m)', 'Country'], ['DEMO-1', 'Synthetic well 1', 'water', 100, 'Egypt'], ['DEMO-2', 'Synthetic well 2', 'water', 80, 'Egypt']]);
const logs = [['Well ID', 'Depth (m)', 'GR (gAPI)', 'RD (ohm.m)', 'RHOB (g/cm3)', 'SP (mV)']];
for (const [id, td, top, bot] of [['DEMO-1', 100, 40, 70], ['DEMO-2', 80, 30, 55]]) {
  for (let d = 0; d <= td; d += 0.5) {
    const sand = d > top && d < bot;
    logs.push([id, d, sand ? 30 : 100, sand ? 20 : 3, sand ? 2.2 : 2.5, sand ? -40 : 0]);
  }
}
sheet('Logs', logs);
sheet('Formations', [['Well ID', 'Top (m)', 'Bottom (m)', 'Name', 'Lithology', 'Water-bearing'],
  ['DEMO-1', 0, 40, 'Clay', 'clay', 'no'], ['DEMO-1', 40, 70, 'Sand', 'sand', 'probable'],
  ['DEMO-2', 0, 30, 'Clay', 'clay', 'no'], ['DEMO-2', 30, 55, 'Sand', 'sand', 'probable']]);
writeFileSync('samples/synthetic-project.xlsx', XLSX.write(pb, { type: 'buffer', bookType: 'xlsx' }));
console.log('samples/ written');
