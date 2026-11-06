import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../src/db/db.js';
import { parseCsvText, detectDelimiter, parseDelimited, parseWorkbook, buildWorkbookBuffer } from '../src/io/tableParse.js';
import { parseNumber, detectHeaderRow, guessMapping, buildPreview, unitFromHeader } from '../src/io/importEngine.js';
import { saveCurves, listWellCurves, addCustomCurve, getCustomCurves } from '../src/db/curves.js';
import { createProject, createWell, deleteWell } from '../src/db/repos.js';

const sample = (n) => readFileSync(resolve(process.cwd(), 'samples', n), 'utf8');

describe('number parsing', () => {
  it('handles decimal point, decimal comma and thousands separators', () => {
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('1,234,567')).toBe(1234567);
    expect(parseNumber('1e-3')).toBe(0.001);
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('')).toBeNaN();
    expect(parseNumber('12,5', '.')).toBe(125);
  });
});

describe('delimited text', () => {
  it('detects comma, semicolon, tab and pipe', () => {
    expect(detectDelimiter('a,b,c\n1,2,3\n4,5,6').delimiter).toBe(',');
    expect(detectDelimiter('a;b;c\n1,5;2,5;3\n4;5;6').delimiter).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3').delimiter).toBe('\t');
    expect(detectDelimiter('a|b|c\n1|2|3').delimiter).toBe('|');
  });
  it('parses quoted fields, escaped quotes and CRLF', () => {
    expect(parseDelimited('a,"b,1","c ""q"""\r\n1,2,3\r\n', ',')).toEqual([['a', 'b,1', 'c "q"'], ['1', '2', '3']]);
  });
  it('strips BOM', () => {
    expect(parseCsvText('﻿a,b\n1,2').rows[0][0]).toBe('a');
  });
});

describe('header & mapping detection', () => {
  it('skips preamble lines to find the header', () => {
    const rows = [['Company', 'ACME'], [''], ['DEPTH', 'GR', 'RD'], ['1', '2', '3'], ['2', '3', '4']];
    expect(detectHeaderRow(rows)).toBe(2);
  });
  it('maps columns, takes units ONLY from headers', () => {
    const m = guessMapping(['Depth (ft)', 'GR', 'ILD (ohm.m)', 'foo']);
    expect(m[0]).toEqual({ role: 'depth', unit: 'ft' });
    expect(m[1]).toEqual({ role: 'gr', unit: null }); // unit not assumed
    expect(m[2]).toEqual({ role: 'res_deep', unit: 'ohm.m' });
    expect(m[3].role).toBe('ignore');
    expect(unitFromHeader('RD [ohm-m]')).toBe('ohm.m');
  });
});

describe('preview / validation', () => {
  it('imports the synthetic ft/null CSV: converts, flags and excludes bad cells', () => {
    const { rows } = parseCsvText(sample('SYNTHETIC_comma_ft_nulls.csv'));
    const mapping = guessMapping(rows[0]);
    mapping[1].unit = 'gAPI';
    const p = buildPreview(rows, 0, mapping, { totalDepth: 40 });
    expect(p.blocking).toEqual([]);
    const gr = p.curves.find((c) => c.curveId === 'gr');
    expect(gr.stats).toMatchObject({ n: 5, missing: 1, invalid: 1 }); // -999.25 null, "abc" invalid
    expect(gr.points[0].depth).toBeCloseTo(30.48, 8); // 100 ft -> m
    expect(gr.points[0].row).toBe(2); // traceable source row
    const rd = p.curves.find((c) => c.curveId === 'res_deep');
    expect(rd.stats.invalid).toBe(1); // -5 ohm.m on log scale
    expect(p.issues.some((i) => i.code === 'log_nonpositive' && i.row === 7)).toBe(true);
    expect(p.issues.some((i) => i.code === 'value_invalid' && i.row === 6)).toBe(true);
    expect(p.issues.some((i) => i.code === 'depth_beyond_td')).toBe(false); // 103 ft = 31.4 m < 40
    const rho = p.curves.find((c) => c.curveId === 'density');
    expect(rho.points).toHaveLength(7);
    expect(p.curves.find((c) => c.curveId === 'caliper').points[0].value).toBeCloseTo(215.9, 8); // 8.5 in -> mm
  });

  it('blocks when units are missing instead of assuming', () => {
    const rows = [['Depth', 'GR'], ['1', '50'], ['2', '60']];
    const p = buildPreview(rows, 0, guessMapping(rows[0]));
    expect(p.blocking.map((b) => b.code).sort()).toEqual(['unit_missing', 'unit_missing']);
    expect(p.curves).toHaveLength(0);
  });

  it('blocks without depth column and with duplicate curve mapping', () => {
    const rows = [['a', 'b'], ['1', '2']];
    expect(buildPreview(rows, 0, { 0: { role: 'gr', unit: 'gAPI' }, 1: { role: 'gr', unit: 'gAPI' } }).blocking.map((b) => b.code))
      .toEqual(expect.arrayContaining(['depth_missing', 'curve_duplicate']));
  });

  it('rejects a unit from the wrong group', () => {
    const rows = [['Depth', 'GR'], ['1', '50']];
    const p = buildPreview(rows, 0, { 0: { role: 'depth', unit: 'm' }, 1: { role: 'gr', unit: 'ohm.m' } });
    expect(p.blocking[0].code).toBe('unit_invalid');
  });

  it('handles decimal comma / semicolon file, flags unsorted & duplicate depth', () => {
    const { rows, delimiter } = parseCsvText(sample('SYNTHETIC_semicolon_decimal_comma.csv'));
    expect(delimiter).toBe(';');
    const p = buildPreview(rows, 0, guessMapping(rows[0]));
    expect(p.blocking).toEqual([]);
    expect(p.curves.map((c) => c.curveId).sort()).toEqual(['gr', 'res_deep', 'sp', 'temp']);
    expect(p.curves.find((c) => c.curveId === 'sp').points[0].value).toBe(-12.5);

    const rows2 = [['Depth (m)', 'GR (gAPI)'], ['5', '10'], ['3', '12'], ['3', '13'], ['x', '1']];
    const p2 = buildPreview(rows2, 0, guessMapping(rows2[0]));
    const codes = p2.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['depth_unsorted', 'depth_duplicate', 'depth_invalid']));
    expect(p2.curves[0].points.map((x) => x.depth)).toEqual([3, 5]); // sorted
  });

  it('custom curves: free unit, no conversion', () => {
    const custom = [{ id: 'custom_x', abbr: 'X', kind: 'curve', group: null, scale: 'linear', range: null, customUnit: 'ppb', aliases: ['x'], name: { en: 'x', ar: 'x' }, use: [] }];
    const rows = [['Depth (m)', 'X (ppb)'], ['1', '5'], ['2', '6']];
    const m = guessMapping(rows[0], custom);
    const p = buildPreview(rows, 0, { ...m, 1: { role: 'custom_x', unit: 'ppb' } }, { custom });
    expect(p.curves[0].points.map((x) => x.value)).toEqual([5, 6]);
  });
});

describe('Excel import', () => {
  it('reads xlsx and xls with multiple sheets and numeric cells', () => {
    const sheets = {
      Info: [['Project', 'Test']],
      Logs: [['DEPTH (m)', 'GR (gAPI)', 'RD (ohm.m)'], [10, 40.5, 30], [10.5, 42, 28], [11, '', 25]],
    };
    for (const type of ['xlsx', 'xls']) {
      const wb = parseWorkbook(buildWorkbookBuffer(sheets, type));
      expect(wb.sheetNames).toEqual(['Info', 'Logs']);
      const rows = wb.sheets.Logs;
      const p = buildPreview(rows, detectHeaderRow(rows), guessMapping(rows[0]));
      expect(p.blocking).toEqual([]);
      const gr = p.curves.find((c) => c.curveId === 'gr');
      expect(gr.stats).toMatchObject({ n: 2, missing: 1 });
      expect(gr.points[0]).toMatchObject({ depth: 10, value: 40.5 });
    }
  });
});

describe('curve storage', () => {
  it('saves with provenance, replaces/merges, cascades on well delete, custom curves persist', async () => {
    const pid = await createProject({ name: 'P' });
    const wid = await createWell({ projectId: pid, wellId: 'W', name: 'W' });
    const pts = (a) => a.map(([depth, value], i) => ({ depth, value, row: i + 2 }));
    await saveCurves(wid, [{ curveId: 'gr', unit: 'gAPI', enteredUnit: 'gAPI', header: 'GR', points: pts([[2, 20], [1, 10]]) }],
      { source: 'csv', meta: { fileName: 'a.csv' } });
    let [r] = await listWellCurves(wid);
    expect(r).toMatchObject({ source: 'csv', unit: 'gAPI', depthUnit: 'm', header: 'GR' });
    expect(r.depth).toEqual([1, 2]);
    expect(r.sourceRows).toEqual([3, 2]); // row of depth 1 is 3, of depth 2 is 2
    expect(r.meta.fileName).toBe('a.csv');

    await saveCurves(wid, [{ curveId: 'gr', unit: 'gAPI', points: pts([[2, 99], [3, 30]]) }], { source: 'excel', mode: 'merge' });
    [r] = await listWellCurves(wid);
    expect(r.depth).toEqual([1, 2, 3]);
    expect(r.values).toEqual([10, 99, 30]);

    await saveCurves(wid, [{ curveId: 'gr', unit: 'gAPI', points: pts([[5, 1]]) }], { source: 'manual', mode: 'replace' });
    [r] = await listWellCurves(wid);
    expect(r.depth).toEqual([5]);
    expect(await db.logMeasurements.count()).toBe(1);

    await deleteWell(wid);
    expect(await db.logMeasurements.count()).toBe(0);

    await addCustomCurve({ abbr: 'ZZ', name: 'Zed', unit: 'ppb', scale: 'linear', min: 0, max: 5 });
    await expect(addCustomCurve({ abbr: 'zz', name: 'dup', unit: 'x', scale: 'linear' })).rejects.toThrow('DUPLICATE');
    const [c] = await getCustomCurves();
    expect(c).toMatchObject({ id: 'custom_zz', customUnit: 'ppb' });
  });
});
