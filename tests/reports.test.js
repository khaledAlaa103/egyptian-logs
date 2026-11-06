import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../src/db/db.js';
import { createProject, createWell } from '../src/db/repos.js';
import { saveCurves } from '../src/db/curves.js';
import { addFormation } from '../src/db/intervals.js';
import { addSample, saveSettings } from '../src/db/water.js';
import { saveInterpretation } from '../src/db/interp.js';
import { runInterpretation } from '../src/engine/interpret.js';
import { gatherReportData } from '../src/reports/gather.js';
import { buildReportModel, SECTION_IDS, STATUS_CODE } from '../src/reports/model.js';
import { reportToWorkbook, curvesToCsv, curvesTable, sectionRows } from '../src/reports/excel.js';
import { computeBreaks, assemblePdf } from '../src/reports/pdf.js';
import { saveReport, listReports, deleteReport } from '../src/db/reports.js';
import { parseWorkbook } from '../src/io/tableParse.js';
import { dictionaries, translate } from '../src/i18n/index.js';

const trOf = (lang) => (k) => translate(lang, k);

async function seed({ withRun = true, withSamples = true } = {}) {
  const pid = await createProject({ name: 'Aquifer Project', client: 'Client X' });
  const wid = await createWell({ projectId: pid, wellId: 'RP-1', name: 'Report well', country: 'Egypt', totalDepth: 60, loggingCompany: 'LogCo', equipment: 'Tool-77', lat: 30.1, lon: 31.2 });
  const depth = Array.from({ length: 61 }, (_, i) => i);
  const pts = (f) => depth.map((d) => ({ depth: d, value: f(d) }));
  await saveCurves(wid, [
    { curveId: 'res_deep', unit: 'ohm.m', points: pts((d) => (d < 30 ? 3 : 30)) }, { curveId: 'gr', unit: 'gAPI', points: pts((d) => (d < 30 ? 100 : 25)) },
    { curveId: 'density', unit: 'g/cm3', points: pts(() => 2.65 - 0.25 * 1.65) },
  ], { source: 'csv', meta: { fileName: 'logs.csv' } });
  await addFormation(wid, { top: 0, bottom: 30, name: 'Clay', lithology: 'clay' });
  await addFormation(wid, { top: 30, bottom: 60, name: 'Sand', lithology: 'sand', waterBearing: 'probable' });
  if (withRun) {
    const rows = await db.logMeasurements.where('wellId').equals(wid).toArray();
    const curves = Object.fromEntries(rows.map((r) => [r.curveId, { depth: r.depth, values: r.values }]));
    const config = {
      grid: { curveId: 'res_deep' }, temperature: { method: 'constant', value: 25 },
      resistivity: { rtCurve: 'res_deep', method: 'direct', cond: { thickBed: true, invasionNegligible: true, boreholeNegligible: true } },
      rw: { method: 'manual', value: 5, refTemp: 25, source: 'sample S9' }, vshale: { model: 'linear', curve: 'gr', grClean: 25, grShale: 100 },
      porosity: { method: 'density', rhoMa: 2.65, rhoFl: 1, curves: { density: 'density' }, shaleCorrection: {} },
      saturation: { model: 'simandoux', a: 1, m: 2, n: 2, vshLimit: 0.1, rsh: 2 },
    };
    await saveInterpretation(wid, { name: 'Run R', config, result: runInterpretation(config, curves) });
  }
  if (withSamples) {
    await addSample(wid, { sampleId: 'D1', depthTop: 40, source: 'Lab 5', tds: 1250, ec: 1950, ecTemp: 25 });
    await saveSettings(wid, { normalization: { method: 'arps' }, calibration: { mode: 'manual', model: 'factor', scope: 'well', manual: { k: 0.64, source: 'Study X', uncertaintyPct: 10 } }, rwUncertaintyPct: 20, runId: null });
  }
  return wid;
}

describe('report model', () => {
  it('has the 18 sections in the required order, in English and Arabic (RTL)', async () => {
    const wid = await seed();
    const data = await gatherReportData(wid);
    const en = buildReportModel(data, { lang: 'en' }, trOf('en'));
    const ar = buildReportModel(data, { lang: 'ar' }, trOf('ar'));
    expect(SECTION_IDS).toHaveLength(18);
    expect(en.sections.map((s) => s.id)).toEqual(SECTION_IDS);
    expect(ar.sections.map((s) => s.id)).toEqual(SECTION_IDS);
    expect(en.dir).toBe('ltr'); expect(ar.dir).toBe('rtl');
    expect(en.sections[0].title).toBe('Cover page'); expect(ar.sections[0].title).toBe('صفحة الغلاف');
    expect(en.sections[10].title).toBe('Water quality and TDS estimation');
    expect(ar.sections.every((s, i) => s.title && s.title !== en.sections[i].title)).toBe(true);
  });

  it('can omit sections; cover shows the well and an author-provided title', async () => {
    const data = await gatherReportData(await seed());
    const m = buildReportModel(data, { lang: 'en', title: 'My title', sections: { images: false, equations: false }, texts: { preparedBy: 'A. Engineer' } }, trOf('en'));
    expect(m.sections.map((s) => s.id)).not.toContain('images');
    expect(m.sections).toHaveLength(16);
    const cover = m.sections[0].blocks[0];
    expect(cover).toMatchObject({ type: 'cover', title: 'My title', subtitle: 'RP-1 — Report well', preparedBy: 'A. Engineer', project: 'Aquifer Project' });
  });

  it('marks values by class: measured GR, direct Rt = estimated, Rw from a sample = corrected, calculated Sw', async () => {
    const data = await gatherReportData(await seed());
    const m = buildReportModel(data, { lang: 'en' }, trOf('en'));
    const res = m.sections.find((s) => s.id === 'resistivity');
    const tbl = res.blocks.find((b) => b.type === 'table');
    const sand = tbl.rows[1];
    expect(sand.find((c) => c && c.s === 'estimated')).toBeTruthy(); // Rt (direct reading) is an estimate
    expect(res.blocks[0].text).toMatch(/not true formation resistivity/);
    const form = m.sections.find((s) => s.id === 'formations').blocks[0];
    expect(form.rows[1].some((c) => c && c.s === 'measured')).toBe(true); // GR
    const rw = m.sections.find((s) => s.id === 'rw').blocks.find((b) => b.type === 'table');
    expect(rw.rows[1].some((c) => c && c.s === 'corrected')).toBe(true);
    const aq = m.sections.find((s) => s.id === 'aquifer').blocks.find((b) => b.type === 'table');
    expect(JSON.stringify(aq.rows[1])).toContain('calculated');
    expect(Object.values(STATUS_CODE).sort()).toEqual(['C', 'E', 'K', 'M', 'U']);
    expect(m.sections[0].blocks[1].type).toBe('legend');
  });

  it('water section separates direct and indirect results and states calibration source, range, Tref and uncertainty', async () => {
    const data = await gatherReportData(await seed());
    const m = buildReportModel(data, { lang: 'en' }, trOf('en'));
    const w = m.sections.find((s) => s.id === 'quality_tds');
    const direct = w.blocks.find((b) => b.type === 'table' && b.caption === 'Direct measurements (water samples)');
    expect(direct.rows[0][0]).toBe('D1');
    expect(direct.rows[0][2]).toEqual({ t: '1250', s: 'measured' });
    const est = w.blocks.find((b) => b.type === 'table' && /TDS by interval/.test(b.caption));
    const sandRow = est.rows[1];
    expect(sandRow.find((c) => c && c.s === 'estimated')).toBeTruthy();
    expect(sandRow[sandRow.length - 1]).toMatch(/indirect/);
    const kv = w.blocks.find((b) => b.type === 'kv').rows;
    expect(kv.find(([k]) => k === 'Source of the factor')[1]).toBe('Study X');
    expect(kv.find(([k]) => k === 'Temperature reference')[1]).toBe('25 °C');
    expect(w.blocks[0].text).toMatch(/never calculated from formation resistivity/);
  });

  it('never invents content: no run / no samples / no author text produce explicit notices', async () => {
    const data = await gatherReportData(await seed({ withRun: false, withSamples: false }));
    const m = buildReportModel(data, { lang: 'en' }, trOf('en'));
    const byId = (id) => m.sections.find((s) => s.id === id);
    expect(byId('resistivity').blocks.some((b) => b.type === 'notice' && /No saved interpretation run/.test(b.text))).toBe(true);
    expect(byId('quality_tds').blocks.some((b) => b.type === 'notice' && /No water samples/.test(b.text))).toBe(true);
    expect(byId('equations').blocks[0]).toMatchObject({ type: 'notice' });
    expect(byId('conclusions').blocks.some((b) => b.type === 'notice' && /No text was written/.test(b.text))).toBe(true);
    expect(byId('conclusions').blocks.find((b) => b.type === 'list').items.join(' ')).not.toMatch(/TDS values are available/);
    expect(byId('images').blocks[0]).toMatchObject({ type: 'notice' });
    const sug = byId('recommendations').blocks.find((b) => b.type === 'list').items.join(' ');
    expect(sug).toMatch(/Collect and analyse formation-water samples/);
  });

  it('conclusions state data-derived facts; the author text is shown separately and verbatim', async () => {
    const data = await gatherReportData(await seed());
    const m = buildReportModel(data, { lang: 'en', texts: { conclusions: 'The sand A is a good aquifer.', recommendations: 'Drill to 80 m.' } }, trOf('en'));
    const c = m.sections.find((s) => s.id === 'conclusions').blocks;
    const facts = c.find((b) => b.type === 'list').items;
    expect(facts[0]).toBe('3 log curve(s) were available: RD, GR, RHOB.');
    expect(facts.some((f) => /2 formation interval\(s\)/.test(f))).toBe(true);
    expect(facts.some((f) => /1 interval\(s\) are marked water-bearing or probable, with a total thickness of 30 m: Sand/.test(f))).toBe(true);
    expect(c.find((b) => b.type === 'author').text).toBe('The sand A is a good aquifer.');
    expect(m.sections.find((s) => s.id === 'recommendations').blocks.find((b) => b.type === 'author').text).toBe('Drill to 80 m.');
  });

  it('equations section lists each method used with its equation, source and validity', async () => {
    const data = await gatherReportData(await seed());
    const m = buildReportModel(data, { lang: 'ar' }, trOf('ar'));
    const eq = m.sections.find((s) => s.id === 'equations').blocks[0];
    expect(eq.type).toBe('methods');
    const ids = eq.items.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['arps', 'rt_direct', 'sw_simandoux', 'tds_factor', 'ec_normalize_arps', 'rw_to_ec']));
    eq.items.forEach((x) => { expect(x.equation).toBeTruthy(); expect(x.source).toBeTruthy(); expect(x.validity).toBeTruthy(); });
    expect(eq.items.find((x) => x.id === 'arps').name).toMatch(/أرپس/);
  });

  it('every translation key used by the model exists in both languages', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/reports/model.js'), 'utf8');
    const keys = [...src.matchAll(/\btr\('([a-zA-Z0-9_.]+)'\)/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(80);
    const get = (d, k) => k.split('.').reduce((o, x) => (o == null ? undefined : o[x]), d);
    for (const k of new Set(keys)) { expect(get(dictionaries.en, k), `en ${k}`).toBeTypeOf('string'); expect(get(dictionaries.ar, k), `ar ${k}`).toBeTypeOf('string'); }
    for (const id of SECTION_IDS) { expect(get(dictionaries.en, `rep.s.${id}`)).toBeTruthy(); expect(get(dictionaries.ar, `rep.s.${id}`)).toBeTruthy(); }
  });
});

describe('excel and csv', () => {
  it('workbook has numeric Results (display units), Status, Traceability, Curves and one sheet per section', async () => {
    const data = await gatherReportData(await seed());
    data.units = { ...data.units, depth: 'ft' };
    const m = buildReportModel(data, { lang: 'en' }, trOf('en'));
    const wb = parseWorkbook(reportToWorkbook(m, data, trOf('en')));
    expect(wb.sheetNames.slice(0, 4)).toEqual(['Results', 'Status', 'Traceability', 'Curves']);
    expect(wb.sheetNames.some((n) => n.startsWith('11 '))).toBe(true);
    const res = wb.sheets.Results;
    expect(res[0].some((h) => /Top depth \(ft\)/.test(h))).toBe(true);
    const bi = res[0].findIndex((h) => /Bottom depth/.test(h));
    expect(res[1][bi]).toBeCloseTo(30 / 0.3048, 2);
    expect(wb.sheets.Curves[0]).toEqual(['Depth (m)', 'RD (Ω·m)', 'GR (gAPI)', 'RHOB (g/cm³)']);
    expect(wb.sheets.Curves).toHaveLength(62);
    expect(wb.sheets.Status.flat().some((c) => c === 'Estimated')).toBe(true);
  });
  it('Arabic report workbook keeps Arabic labels; csv of curves merges on depth', async () => {
    const data = await gatherReportData(await seed());
    const m = buildReportModel(data, { lang: 'ar' }, trOf('ar'));
    const wb = parseWorkbook(reportToWorkbook(m, data, trOf('ar')));
    expect(wb.sheetNames.some((n) => /جودة المياه/.test(n))).toBe(true);
    expect(wb.sheets.Results[0].some((h) => /اسم التكوين/.test(h))).toBe(true);
    const csv = curvesToCsv(data);
    expect(csv.split('\r\n')[0]).toBe('﻿Depth (m),RD (Ω·m),GR (gAPI),RHOB (g/cm³)');
    expect(curvesTable(data).body[30]).toEqual([30, 30, 25, 2.65 - 0.25 * 1.65]);
    expect(sectionRows(m.sections[2]).length).toBeGreaterThanOrEqual(5);
  });
});

describe('PDF assembly and page planning', () => {
  it('computeBreaks keeps blocks whole, glues headings to the next block and splits tall blocks', () => {
    const blocks = [
      { top: 0, bottom: 300 }, { top: 300, bottom: 700 }, { top: 700, bottom: 740, heading: true }, { top: 740, bottom: 900 },
      { top: 900, bottom: 1000 },
    ];
    const pages = computeBreaks(blocks, 800);
    expect(pages[0]).toEqual({ y0: 0, y1: 700 }); // heading (700-740) + its first block would overflow: moved to page 2
    expect(pages[1]).toEqual({ y0: 700, y1: 1000 });
    expect(computeBreaks([{ top: 0, bottom: 2000 }], 800)).toEqual([{ y0: 0, y1: 800 }, { y0: 800, y1: 1600 }, { y0: 1600, y1: 2000 }]);
    expect(computeBreaks([{ top: 0, bottom: 100 }, { top: 100, bottom: 200, forceBefore: true }], 800)).toEqual([{ y0: 0, y1: 100 }, { y0: 100, y1: 200 }]);
    expect(computeBreaks([], 800)).toEqual([]);
  });
  it('assemblePdf writes a valid multi-page PDF', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const blob = assemblePdf([1, 2, 3].map(() => ({ dataUrl: png, w: 794, h: 1100 })), { title: 'T', footerText: 'RP-1', jpeg: false });
    const text = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(new Blob([blob])); });
    expect(text.startsWith('%PDF-')).toBe(true);
    expect((text.match(/\/Type\s*\/Page\b(?!s)/g) || []).length).toBe(3);
    expect(blob.type).toBe('application/pdf');
  });
});

describe('saved reports', () => {
  it('stores the definition (and optional PDF), lists, updates and deletes', async () => {
    const pid = await createProject({ name: 'P' });
    const wid = await createWell({ projectId: pid, wellId: 'S1', name: 'S' });
    const id = await saveReport(wid, pid, { title: 'R1', lang: 'ar', options: { lang: 'ar', texts: { conclusions: 'x' } } });
    await saveReport(wid, pid, { id, title: 'R1b', lang: 'ar', options: { lang: 'ar' }, pdfBlob: new Blob(['%PDF'], { type: 'application/pdf' }), pageCount: 3 });
    const [r] = await listReports(wid);
    expect(r).toMatchObject({ title: 'R1b', lang: 'ar', pageCount: 3 });
    expect(await listReports(wid)).toHaveLength(1);
    await deleteReport(id);
    expect(await listReports(wid)).toHaveLength(0);
  });
});
