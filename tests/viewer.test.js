import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import {
  xFrac, niceStep, depthTicks, logTicks, valueAt, decimate, clampWindow, zoomWindow, panWindow,
  layoutColumns, hitDivider, headerHeight, depthToY, yToDepth, medianSpacing, DEPTH_COL_W,
} from '../src/viewer/geometry.js';
import { defaultLayout, autoRange, displayRange } from '../src/viewer/defaults.js';
import { renderLog, LIGHT } from '../src/viewer/renderLog.js';
import { getLog } from '../src/registry/logRegistry.js';
import { createDb, db } from '../src/db/db.js';
import { createProject, createWell, deleteWell, duplicateWell } from '../src/db/repos.js';
import { addFormation, updateFormation, validateFormation, addMarker, listMarkers, saveLayout, loadLayout } from '../src/db/intervals.js';

describe('scales', () => {
  it('linear and log fractions; reversed linear scale; invalid log input', () => {
    expect(xFrac(50, 'linear', 0, 100)).toBe(0.5);
    expect(xFrac(0.45, 'linear', 0.45, -0.15)).toBeCloseTo(0, 10); // reversed (neutron convention)
    expect(xFrac(-0.15, 'linear', 0.45, -0.15)).toBeCloseTo(1, 10);
    expect(xFrac(10, 'log', 1, 100)).toBeCloseTo(0.5, 10);
    expect(xFrac(200, 'log', 0.2, 2000)).toBeCloseTo(0.75, 10);
    expect(xFrac(0, 'log', 1, 100)).toBeNull();
    expect(xFrac(-5, 'log', 1, 100)).toBeNull();
    expect(xFrac(NaN, 'linear', 0, 1)).toBeNull();
  });
  it('nice steps and ticks', () => {
    expect(niceStep(100, 10)).toBe(10);
    expect(niceStep(37, 8)).toBe(5);
    const t = depthTicks(0, 100, 10);
    expect(t.major).toContain(0); expect(t.major).toContain(100);
    expect(t.minor.length).toBe(t.major.length * 4 - 4);
    const l = logTicks(0.2, 2000);
    expect(l.major).toEqual([1, 10, 100, 1000]);
    expect(l.minor.some((v) => Math.abs(v - 0.3) < 1e-12)).toBe(true); expect(l.minor).toContain(2000);
  });
});

describe('sampling and decimation', () => {
  const depth = [0, 1, 2, 3, 4, 50, 51, 52];
  const vals = [0, 10, 20, 30, 40, 500, 510, 520];
  it('interpolates, refuses to bridge gaps and extrapolate', () => {
    const m = medianSpacing(depth);
    expect(valueAt(depth, vals, 2.5, m)).toBe(25);
    expect(valueAt(depth, vals, 3, m)).toBe(30);
    expect(valueAt(depth, vals, 20, m)).toBeNull(); // inside the 4→50 gap
    expect(valueAt(depth, vals, -1, m)).toBeNull();
    expect(valueAt(depth, vals, 53, m)).toBeNull();
  });
  it('keeps raw points when sparse, averages per pixel row when dense', () => {
    const d = Array.from({ length: 10000 }, (_, i) => i / 10);
    const v = d.map((x) => x * 2);
    expect(decimate(d, v, 0, 10, 600).length).toBeLessThan(10000 / 5);
    const dense = decimate(d, v, 0, 100, 100);
    expect(dense.length).toBeLessThanOrEqual(103);
    dense.forEach(([x, y]) => expect(y).toBeCloseTo(x * 2, 6)); // mean of linear data stays on the line
    expect(decimate([1, 2, 3], [1, 2, 3], 1.5, 2.5, 100)).toEqual([[1, 1], [2, 2], [3, 3]]); // + neighbours
    expect(decimate([], [], 0, 1, 10)).toEqual([]);
  });
});

describe('zoom / pan / geometry', () => {
  it('zoom keeps the anchor depth fixed and clamps to extent', () => {
    const v = zoomWindow({ top: 0, bottom: 100 }, 25, 2, 0, 100);
    expect(v.bottom - v.top).toBe(50);
    expect(25 - v.top).toBeCloseTo(12.5, 10); // anchor kept at 25% of the window
    const full = zoomWindow({ top: 0, bottom: 100 }, 50, 0.1, 0, 100);
    expect(full).toEqual({ top: 0, bottom: 100 });
    const tiny = zoomWindow({ top: 0, bottom: 1 }, 0.5, 100, 0, 100, 0.5);
    expect(tiny.bottom - tiny.top).toBeCloseTo(0.5, 10);
  });
  it('pan is clamped and preserves span', () => {
    expect(panWindow({ top: 10, bottom: 20 }, 100, 0, 50)).toEqual({ top: 40, bottom: 50 });
    expect(panWindow({ top: 10, bottom: 20 }, -100, 0, 50)).toEqual({ top: 0, bottom: 10 });
    expect(clampWindow(-5, 5, 0, 100)).toEqual({ top: 0, bottom: 10 });
  });
  it('column layout, divider hit-testing and y<->depth round trip', () => {
    const tracks = [{ width: 100, curves: [{}] }, { width: 150, curves: [{}, {}] }];
    const cols = layoutColumns(tracks, 800);
    expect(cols.tracks[0].x).toBe(DEPTH_COL_W);
    expect(cols.tracks[1].x).toBe(DEPTH_COL_W + 100);
    expect(hitDivider(cols, DEPTH_COL_W + 100 + 3)).toBe(0);
    expect(hitDivider(cols, DEPTH_COL_W + 250)).toBe(1);
    expect(hitDivider(cols, 500)).toBe(-1);
    expect(headerHeight(tracks)).toBeGreaterThan(headerHeight([{ curves: [{}] }]));
    const view = { top: 100, bottom: 200 };
    expect(yToDepth(depthToY(137, view, 90, 400), view, 90, 400)).toBeCloseTo(137, 10);
  });
});

describe('default layout', () => {
  it('only builds tracks for curves that exist and groups them conventionally', () => {
    const avail = [{ curveId: 'gr', values: [10, 50] }, { curveId: 'res_deep', values: [5, 50] }, { curveId: 'res_shallow', values: [4, 40] }];
    const l = defaultLayout(avail);
    expect(l.tracks).toHaveLength(2);
    expect(l.tracks[0].curves.map((c) => c.curveId)).toEqual(['gr']);
    expect(l.tracks[1].curves.map((c) => c.curveId)).toEqual(['res_deep', 'res_shallow']);
    expect(l.tracks[1].scale).toBe('log');
    expect(defaultLayout([]).tracks).toEqual([]);
  });
  it('unknown/custom curves get their own track with an automatic range', () => {
    const l = defaultLayout([{ curveId: 'custom_x', values: [1, 2, 3, 4, 100] }], []);
    expect(l.tracks[0].curves[0].curveId).toBe('custom_x');
    const r = autoRange([1, 2, 3, 4, 5]);
    expect(r.min).toBeLessThanOrEqual(1); expect(r.max).toBeGreaterThanOrEqual(5);
    expect(displayRange(getLog('res_deep'), [1]).scale).toBe('log');
  });
});

/** Recording fake 2D context: lets us verify drawing without a browser canvas. */
function fakeCtx() {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_, p) => {
      if (p === 'calls') return calls;
      if (p === 'measureText') return (s) => ({ width: String(s).length * 6 });
      return (...a) => calls.push([p, ...a]);
    },
    set: () => true,
  });
  return ctx;
}

describe('renderLog', () => {
  const depth = Array.from({ length: 200 }, (_, i) => i * 0.5);
  const data = {
    gr: { depth, values: depth.map((d) => 50 + 30 * Math.sin(d / 5)), unit: 'gAPI', medianDz: 0.5 },
    res_deep: { depth, values: depth.map((d) => 10 + d), unit: 'ohm.m', medianDz: 0.5 },
  };
  const layout = defaultLayout([{ curveId: 'gr', values: data.gr.values }, { curveId: 'res_deep', values: data.res_deep.values }]);
  const model = {
    layout, data, view: { top: 0, bottom: 100 }, cursor: 40, hover: 20, palette: LIGHT, lang: 'en',
    formations: [{ top: 10, bottom: 30, name: 'Sand A', waterBearing: 'yes' }, { top: 30, bottom: 60, name: 'Clay', waterBearing: 'no' }],
    markers: [{ depth: 55, label: 'Casing shoe' }],
  };

  it('draws curves, formation names, markers and cursor without throwing', () => {
    const ctx = fakeCtx();
    const out = renderLog(ctx, 900, 600, model);
    const texts = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
    expect(texts).toEqual(expect.arrayContaining(['Sand A', 'Clay', 'Casing shoe', 'DEPTH (m)']));
    expect(ctx.calls.filter((c) => c[0] === 'lineTo').length).toBeGreaterThan(300);
    expect(out.bodyH).toBeGreaterThan(0);
  });
  it('shows feet on the axis when depthUnit is ft', () => {
    const ctx = fakeCtx();
    renderLog(ctx, 900, 600, { ...model, layout: { ...layout, depthUnit: 'ft' } });
    expect(ctx.calls.some((c) => c[0] === 'fillText' && c[1] === 'DEPTH (ft)')).toBe(true);
  });
  it('hidden curves are not drawn; independent per-curve scales are honoured', () => {
    const l = JSON.parse(JSON.stringify(layout));
    l.tracks.forEach((t) => t.curves.forEach((c) => { c.visible = false; }));
    const ctx = fakeCtx();
    renderLog(ctx, 900, 600, { ...model, layout: l, formations: [], markers: [], cursor: null, hover: null });
    // with nothing visible there are only grid lines: no curve polyline is long
    const lt = ctx.calls.filter((c) => c[0] === 'lineTo').length;
    const ctx2 = fakeCtx();
    renderLog(ctx2, 900, 600, { ...model, formations: [], markers: [], cursor: null, hover: null });
    expect(ctx2.calls.filter((c) => c[0] === 'lineTo').length).toBeGreaterThan(lt + 300);
  });
});

describe('intervals, markers, layouts and DB v2', () => {
  it('validates formations (order, overlap, negatives) and edits safely', async () => {
    expect(validateFormation({ top: 10, bottom: 5 })).toBe('order');
    expect(validateFormation({ top: -1, bottom: 5 })).toBe('negative');
    expect(validateFormation({ top: 'a', bottom: 5 })).toBe('number');
    expect(validateFormation({ top: '', bottom: 5 })).toBe('required');
    expect(validateFormation({ top: 0, bottom: 5 }, [{ top: 4, bottom: 8 }])).toBe('overlap');
    expect(validateFormation({ top: 5, bottom: 8 }, [{ top: 0, bottom: 5 }])).toBeNull(); // touching is fine
    const pid = await createProject({ name: 'P' });
    const wid = await createWell({ projectId: pid, wellId: 'V1', name: 'V' });
    const a = await addFormation(wid, { top: '0', bottom: '10', name: 'A', waterBearing: 'yes' });
    await addFormation(wid, { top: 10, bottom: 20, name: 'B' });
    await expect(addFormation(wid, { top: 15, bottom: 25 })).rejects.toThrow('overlap');
    await expect(updateFormation(a, { bottom: 12 })).rejects.toThrow('overlap');
    await updateFormation(a, { name: 'A2', bottom: 10 });
    expect((await db.formations.get(a)).name).toBe('A2');
    await addMarker(wid, 12.5, 'shoe');
    await expect(addMarker(wid, NaN, 'x')).rejects.toThrow();
    await saveLayout(wid, { depthUnit: 'ft', tracks: [] });
    expect(await loadLayout(wid)).toEqual({ depthUnit: 'ft', tracks: [] });
    // duplicate carries markers; delete cascades them
    const nid = await duplicateWell(wid);
    expect(await listMarkers(nid)).toHaveLength(1);
    await deleteWell(wid);
    expect(await db.markers.where('wellId').equals(wid).count()).toBe(0);
    expect(await listMarkers(nid)).toHaveLength(1);
  });

  it('migrates a v1 database to v2 without losing data', async () => {
    const name = 'migration-test';
    await Dexie.delete(name);
    const old = new Dexie(name);
    old.version(1).stores({
      projects: '++id, name, status, updatedAt', wells: '++id, projectId, wellId, name, status, country, wellType, updatedAt',
      logMeasurements: '++id, wellId, curveId, [wellId+curveId]', logImages: '++id, wellId', digitizedCurves: '++id, wellId, curveId',
      formations: '++id, wellId, top', interpretations: '++id, wellId', calcSettings: '++id, projectId, wellId',
      reports: '++id, projectId, wellId', preferences: 'key',
    });
    await old.open();
    await old.table('wells').add({ projectId: 1, wellId: 'OLD', name: 'Old well', status: 'active' });
    old.close();
    const upgraded = createDb(name);
    await upgraded.open();
    expect(await upgraded.wells.toArray()).toHaveLength(1);
    expect(upgraded.verno).toBe(2);
    await upgraded.markers.add({ wellId: 1, depth: 5, label: 'ok' });
    expect(await upgraded.markers.count()).toBe(1);
    upgraded.close();
    await Dexie.delete(name);
  });
});
