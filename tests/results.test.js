import { describe, it, expect } from 'vitest';
import { statsInInterval, sampling } from '../src/results/intervalStats.js';
import { COLUMNS, COL, buildRows, columnAvailable, formatCell, parseCell, makeFilter, compareValues, pickCurve } from '../src/results/columns.js';
import { screenInterval } from '../src/results/screening.js';
import { qualityWarnings } from '../src/results/quality.js';
import { resultsToWorkbook, resultsToCsv, buildResultsTable } from '../src/results/exportResults.js';
import { parseWorkbook } from '../src/io/tableParse.js';
import { db } from '../src/db/db.js';
import { createProject, createWell } from '../src/db/repos.js';
import { addFormation } from '../src/db/intervals.js';
import {
  bulkUpdate, bulkDelete, addNextInterval, setOverride, saveSnapshot, restoreSnapshot, listSnapshots, deleteSnapshot, saveView, loadView,
} from '../src/db/results.js';

const close = (a, b, d = 8) => expect(a).toBeCloseTo(b, d);

describe('interval statistics', () => {
  const depth = [0, 1, 2, 3, 4, 5], vals = [10, 20, null, 40, NaN, 60];
  it('half-open interval, arithmetic mean, ignores null/NaN', () => {
    const s = statsInInterval(depth, vals, 0, 4);
    expect(s).toEqual({ n: 3, mean: (10 + 20 + 40) / 3, min: 10, max: 40 });
    expect(statsInInterval(depth, vals, 4, 6).n).toBe(1); // 4 is NaN, 5 -> 60
    expect(statsInInterval(depth, vals, 2, 4).n).toBe(1); // boundary sample at 4 not counted twice
  });
  it('geometric mean for resistivity; non-positive values skipped; empty interval', () => {
    close(statsInInterval([0, 1, 2], [1, 100, -5], 0, 3, 'geo').mean, 10, 10);
    expect(statsInInterval(depth, vals, 100, 200)).toEqual({ n: 0 });
  });
  it('sampling', () => { expect(sampling([0, 0.5, 1, 1.5])).toBe(0.5); expect(sampling([1])).toBe(Infinity); });
});

describe('cell parsing, validation, unit conversion', () => {
  it('depth in feet is stored in metres and shown back in feet', () => {
    close(parseCell('top', '100', 'ft').value, 30.48, 8);
    expect(formatCell('top', 30.48, 'ft')).toBe('100');
    expect(parseCell('top', '-5', 'm').error).toBe('range');
    expect(parseCell('top', 'abc', 'm').error).toBe('number');
    expect(parseCell('top', '12,5', 'm').value).toBe(12.5);
  });
  it('porosity in % <-> fraction; ranges; positive-only resistivity; enums', () => {
    close(parseCell('phi', '25', '%').value, 0.25, 10);
    expect(formatCell('phi', 0.25, '%')).toBe('25');
    expect(parseCell('phi', '120', '%').error).toBe('range');
    expect(parseCell('rd', '0', 'ohm.m').error).toBe('positive');
    close(parseCell('rd', '100', 'ohm.cm').value, 1, 10);
    expect(parseCell('waterBearing', 'YES').value).toBe('yes');
    expect(parseCell('waterBearing', 'maybe').error).toBe('enum');
    expect(parseCell('confidence', '').value).toBe('');
    close(parseCell('tds', '1.5', 'g/L').value, 1500, 10);
    expect(parseCell('name', '  Sand A ').value).toBe('Sand A');
  });
  it('numeric filters', () => {
    expect(makeFilter('>10', true)(11)).toBe(true);
    expect(makeFilter('>10', true)(10)).toBe(false);
    expect(makeFilter('<=5', true)(5)).toBe(true);
    expect(makeFilter('2..8', true)(8)).toBe(true);
    expect(makeFilter('2..8', true)(9)).toBe(false);
    expect(makeFilter('3', true)(3)).toBe(true);
    expect(makeFilter('san', false)('Sandstone')).toBe(true);
    expect(makeFilter('', true)).toBeNull();
    expect(makeFilter('>10', true)(null)).toBe(false);
  });
  it('sorting keeps empties last', () => {
    expect(compareValues(1, 2)).toBeLessThan(0);
    expect(compareValues(null, 2)).toBeGreaterThan(0);
    expect(compareValues('a10', 'a2')).toBeGreaterThan(0); // numeric-aware
  });
});

describe('row building with traceability', () => {
  const depth = Array.from({ length: 21 }, (_, i) => i);
  const curves = {
    gr: { depth, values: depth.map((d) => (d < 10 ? 100 : 20)) },
    res_deep: { depth, values: depth.map((d) => (d < 10 ? 2 : 50)) },
    fluid_ec: { depth, values: depth.map(() => 300) },
  };
  const run = {
    id: 7, name: 'Run 1', depth, methods: ['arps', 'rt_direct'], flags: depth.map(() => []),
    config: { resistivity: { method: 'direct' }, rw: { method: 'manual' }, porosity: { shaleCorrection: {} }, saturation: { vshLimit: 0.1 } },
    series: {
      rt: depth.map((d) => (d < 10 ? null : 50)), rw: depth.map(() => 0.5), vsh: depth.map((d) => (d < 10 ? 0.9 : 0.02)),
      phi: depth.map(() => 0.25), phiE: depth.map(() => null), sw: depth.map((d) => (d < 10 ? null : 0.3)),
    },
  };
  const formations = [
    { id: 1, wellId: 1, top: 0, bottom: 10, name: 'Clay', waterBearing: 'unknown' },
    { id: 2, wellId: 1, top: 10, bottom: 20, name: 'Sand', waterBearing: 'yes', overrides: { tds: { value: 800, status: 'measured', source: 'Lab 12' } } },
  ];
  const rows = buildRows(formations, { curves, run, sources: {} });

  it('thickness is automatic; measured columns come from the curves with n and curve id', () => {
    expect(rows[1].cells.thickness.v).toBe(10);
    expect(rows[0].cells.number.v).toBe(1);
    expect(rows[0].cells.gr).toMatchObject({ v: 100, status: 'measured', trace: { kind: 'curve', curveId: 'gr', n: 10 } });
    close(rows[1].cells.rd.v, 50, 8);
    expect(rows[1].cells.ec.trace.warn).toBe('fluid_ec'); // borehole fluid conductivity is flagged, not passed off as formation water
  });
  it('run-derived columns keep status by method; direct Rt is "estimated", not "corrected"', () => {
    expect(rows[1].cells.rt.status).toBe('estimated'); close(rows[1].cells.rt.v, 50, 8);
    expect(rows[1].cells.rt.trace).toMatchObject({ kind: 'run', runName: 'Run 1', n: 10 });
    expect(rows[1].cells.rc.v).toBeNull(); // corrected resistivity exists only for factor/geometric
    expect(rows[1].cells.sw.status).toBe('calculated'); close(rows[1].cells.sw.v, 0.3, 8);
    expect(rows[0].cells.sw.v).toBeNull(); // Archie refused in the clay interval -> empty, not 0 and not 1
    expect(rows[1].cells.rw.status).toBe('corrected');
  });
  it('overrides replace derived values and are labelled with their source', () => {
    expect(rows[1].cells.tds).toMatchObject({ v: 800, status: 'measured', overridden: true, trace: { kind: 'user', source: 'Lab 12' } });
    expect(rows[0].cells.tds.v).toBeNull();
  });
  it('column availability depends on the logs and the run that exist', () => {
    expect(columnAvailable('gr', { curves, run })).toBe(true);
    expect(columnAvailable('rs', { curves, run })).toBe(false); // no shallow resistivity in this well
    expect(columnAvailable('sw', { curves, run: null })).toBe(false);
    expect(columnAvailable('rc', { curves, run })).toBe(false);
    expect(columnAvailable('name', { curves: {}, run: null })).toBe(true);
    expect(pickCurve('rd', { curves, sources: { rd: 'nope' } })).toBe('res_deep');
  });
  it('every column has a unique id and known kind', () => {
    expect(new Set(COLUMNS.map((c) => c.id)).size).toBe(COLUMNS.length);
    expect(COL.waterBearing.options).toEqual(['unknown', 'yes', 'probable', 'no']);
    ['number', 'name', 'top', 'bottom', 'thickness', 'gr', 'rs', 'rd', 'rc', 'rt', 'rw', 'phi', 'sw', 'ec', 'tds', 'lithology', 'waterBearing', 'interpretation', 'confidence', 'notes'].forEach((id) => expect(COL[id], id).toBeTruthy());
  });

  it('quality warnings: gaps, TD, thin, no coverage, clayey water zone, direct Rt', () => {
    const f2 = [{ id: 1, top: 0, bottom: 5, waterBearing: 'unknown' }, { id: 2, top: 8, bottom: 40, waterBearing: 'yes' }];
    const r2 = buildRows(f2, { curves, run, sources: {} });
    const w = qualityWarnings({ formations: f2, rows: r2, curves, run, well: { totalDepth: 30 } });
    const codes = w.map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['gap_between', 'beyond_td', 'rt_direct_used']));
    expect(qualityWarnings({ formations: [], rows: [], curves, run: null, well: {} })[0].code).toBe('no_formations');
    const f3 = [{ id: 1, top: 0, bottom: 10, waterBearing: 'yes' }];
    const w3 = qualityWarnings({ formations: f3, rows: buildRows(f3, { curves, run, sources: {} }), curves, run, well: {} });
    expect(w3.map((x) => x.code)).toContain('water_but_clayey'); // Vsh 0.9 > limit 0.1 while marked water-bearing
    const f4 = [{ id: 1, top: 0, bottom: 1, waterBearing: 'unknown' }];
    expect(qualityWarnings({ formations: f4, rows: buildRows(f4, { curves, run: null, sources: {} }), curves, run: null, well: {} }).map((x) => x.code)).toContain('thin_interval');
  });

  it('export: display units in headers and values, status sheet, traceability sheet', () => {
    const cols = ['number', 'name', 'top', 'rd', 'phi', 'tds'];
    const units = { depth: 'ft', resistivity: 'ohm.m', porosity: '%', tds: 'g/L' };
    const label = (c) => c.toUpperCase();
    const t = buildResultsTable({ rows, cols, units, label, statusLabel: (s) => s });
    expect(t.head).toEqual(['NUMBER', 'NAME', 'TOP (ft)', 'RD (Ω·m)', 'PHI (%)', 'TDS (g/L)']);
    close(t.body[1][2], 10 / 0.3048, 3);
    expect(t.body[0][4]).toBe(25);
    expect(t.body[1][5]).toBe(0.8);
    expect(t.status[1][5]).toBe('measured');
    const buf = resultsToWorkbook({ well: { wellId: 'W', name: 'N' }, rows, cols, units, label, statusLabel: (s) => s, traceText: (c) => c.trace.kind, infoLines: [['Run', 'Run 1']] });
    const wb = parseWorkbook(buf);
    expect(wb.sheetNames).toEqual(['Results', 'Status', 'Traceability', 'Info']);
    expect(wb.sheets.Results[0][2]).toBe('TOP (ft)');
    expect(wb.sheets.Traceability.length).toBeGreaterThan(2);
    const csv = resultsToCsv({ rows, cols, units, label });
    expect(csv.startsWith('﻿NUMBER,NAME,TOP (ft)')).toBe(true);
  });
});

describe('screening with user cut-offs (no defaults)', () => {
  const cut = { vshMax: 0.15, phiMin: 0.1, swMin: 0.8 };
  it('probable only if every evaluable criterion passes and at least two can be evaluated', () => {
    expect(screenInterval({ vsh: 0.05, phi: 0.25, sw: 0.95 }, cut)).toMatchObject({ status: 'probable', confidence: 'high', failed: [] });
    expect(screenInterval({ vsh: 0.05, phi: 0.25 }, cut)).toMatchObject({ status: 'probable', confidence: 'medium', notEvaluated: ['sw'] });
    expect(screenInterval({ vsh: 0.05 }, cut)).toMatchObject({ status: 'unknown', confidence: 'low' });
  });
  it('any failed criterion -> no; never returns yes; missing cut-offs are not assumed', () => {
    expect(screenInterval({ vsh: 0.6, phi: 0.25, sw: 0.95 }, cut)).toMatchObject({ status: 'no', failed: ['vsh'] });
    expect(screenInterval({ vsh: 0.01, phi: 0.3, sw: 1 }, {}).status).toBe('unknown');
    expect(screenInterval({ vsh: 0.01, phi: 0.3, sw: 1 }, { vshMax: 0.1 }).notEvaluated).toEqual(['phi', 'sw']);
  });
});

describe('database helpers for the table', () => {
  it('bulk update validates each row, overrides, next interval, delete', async () => {
    const pid = await createProject({ name: 'P' });
    const wid = await createWell({ projectId: pid, wellId: 'R1', name: 'R', totalDepth: 100 });
    const a = await addFormation(wid, { top: 0, bottom: 10, name: 'A' });
    const b = await addFormation(wid, { top: 10, bottom: 20, name: 'B' });
    const r = await bulkUpdate([a, b], { lithology: 'sand', waterBearing: 'probable' });
    expect(r.ok).toEqual([a, b]);
    expect((await db.formations.get(b)).lithology).toBe('sand');
    const r2 = await bulkUpdate([a, b], { bottom: 15 }); // a (0-10 -> 0-15) overlaps b and is refused; b (10-20 -> 10-15) is valid
    expect(r2.failed.map((x) => x.id)).toEqual([a]);
    expect(r2.ok).toEqual([b]);

    await setOverride(a, 'tds', 900, { status: 'measured', source: 'Lab' });
    expect((await db.formations.get(a)).overrides.tds).toEqual({ value: 900, status: 'measured', source: 'Lab' });
    await setOverride(a, 'tds', null);
    expect((await db.formations.get(a)).overrides.tds).toBeUndefined();

    const next = await addNextInterval({ id: wid, totalDepth: 100 });
    expect(await db.formations.get(next)).toMatchObject({ top: 15, bottom: 100 });
    await bulkDelete([next]);
    expect(await db.formations.get(next)).toBeUndefined();
  });

  it('snapshots restore the whole table; view config persists', async () => {
    const pid = await createProject({ name: 'P2' });
    const wid = await createWell({ projectId: pid, wellId: 'R2', name: 'R2' });
    await addFormation(wid, { top: 0, bottom: 10, name: 'One' });
    await addFormation(wid, { top: 10, bottom: 20, name: 'Two' });
    const sid = await saveSnapshot(wid, 'before');
    await db.formations.where('wellId').equals(wid).delete();
    await addFormation(wid, { top: 0, bottom: 5, name: 'Other' });
    expect(await restoreSnapshot(wid, sid)).toBe(2);
    expect((await db.formations.where('wellId').equals(wid).sortBy('top')).map((f) => f.name)).toEqual(['One', 'Two']);
    expect(await listSnapshots(wid)).toHaveLength(1);
    await deleteSnapshot(wid, sid);
    expect(await listSnapshots(wid)).toHaveLength(0);
    await expect(restoreSnapshot(wid, 'nope')).rejects.toThrow('NOT_FOUND');
    await saveView(wid, { visible: ['name'], units: { depth: 'ft' } });
    expect(await loadView(wid)).toEqual({ visible: ['name'], units: { depth: 'ft' } });
  });
});
