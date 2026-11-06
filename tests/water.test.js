import { describe, it, expect } from 'vitest';
import {
  rwToEc, ecToRw, mSmToUScm, normalizeEc, ec25FromRw, fitCalibration, manualCalibration, predictTds, naclEquivalent,
  classifySalinity, estimateTds, fromSample, INSUFFICIENT, SALINITY_CLASSES,
} from '../src/engine/water/water.js';
import { WATER_INFO } from '../src/engine/water/waterInfo.js';
import { arps } from '../src/engine/resistivity/temperature.js';
import { db } from '../src/db/db.js';
import { createProject, createWell } from '../src/db/repos.js';
import {
  validateSample, normalizeSample, addSample, updateSample, deleteSample, listSamples, calibrationSamples,
  applyWaterQuality, clearWaterQuality, saveSettings, loadSettings,
} from '../src/db/water.js';
import { addFormation } from '../src/db/intervals.js';

const close = (a, b, d = 6) => expect(a).toBeCloseTo(b, d);

describe('EC <-> Rw and temperature normalisation', () => {
  it('EC [mS/m] = 1000 / Rw and back; mS/m -> uS/cm', () => {
    close(rwToEc(10), 100, 10); close(ecToRw(100), 10, 10); close(mSmToUScm(100), 1000, 10);
    expect(rwToEc(0)).toBeNaN(); expect(ecToRw(-1)).toBeNaN();
  });
  it('alpha method needs alpha explicitly; 1200 uS/cm at 35C with 2%/C -> 1000', () => {
    close(normalizeEc(1200, 35, { method: 'alpha', alpha: 0.02 }).value, 1000, 8);
    expect(normalizeEc(1200, 35, { method: 'alpha' }).missing).toEqual(['alpha']);
    close(normalizeEc(1000, 25, { method: 'alpha', alpha: 0.02 }).value, 1000, 10);
    expect(normalizeEc(1200, 35, {}).missing).toEqual(['normalizationMethod']);
    expect(normalizeEc(1200, undefined, { method: 'alpha', alpha: 0.02 }).missing).toEqual(['temperature']);
  });
  it('Arps method: Rw = 2.0 ohm.m at 35C -> R25 = 2*(56.5/46.5)', () => {
    const e = ec25FromRw(2.0, 35, { method: 'arps' });
    close(e.value, 1 / (2 * 56.5 / 46.5) * 10000, 4); // 1/R25 in S/m -> x10000 = uS/cm
    close(1 / arps(1 / e.value, 25, 35), 5000, 4); // warming it back to 35 C returns the measured 5000 uS/cm
    expect(ec25FromRw(0, 35, { method: 'arps' }).missing).toEqual(['rw']);
  });
  it('warmer water of the same Rw has lower EC25 than colder water (physical sanity)', () => {
    const cold = ec25FromRw(5, 15, { method: 'arps' }).value, warm = ec25FromRw(5, 45, { method: 'arps' }).value;
    expect(warm).toBeLessThan(cold);
  });
});

describe('local calibration of EC25 -> TDS', () => {
  const lin = [[500, 330], [1000, 640], [2000, 1280], [4000, 2570], [8000, 5100]].map(([ec25, tds]) => ({ ec25, tds }));
  it('factor through the origin recovers an exact factor with zero error', () => {
    const f = fitCalibration([{ ec25: 1000, tds: 640 }, { ec25: 2000, tds: 1280 }], 'factor');
    close(f.params.k, 0.64, 10); close(f.rmse, 0, 8); expect(f.warnings).toContain('few_points');
  });
  it('linear and power fits recover exact relations', () => {
    const l = fitCalibration([100, 400, 900, 1600, 2500].map((x) => ({ ec25: x, tds: 50 + 0.6 * x })), 'linear');
    close(l.params.a, 50, 6); close(l.params.b, 0.6, 8); close(l.r2, 1, 8);
    const p = fitCalibration([100, 400, 900, 1600, 2500].map((x) => ({ ec25: x, tds: 0.5 * x ** 1.05 })), 'power');
    close(p.params.d, 1.05, 8); close(p.params.c, 0.5, 6);
  });
  it('reports fit quality on noisy data and the EC range of the calibration', () => {
    const f = fitCalibration(lin, 'factor');
    expect(f.n).toBe(5); expect(f.range).toEqual([500, 8000]);
    expect(f.relRmse).toBeGreaterThan(0); expect(f.relRmse).toBeLessThan(0.05);
    expect(f.warnings).not.toContain('few_points');
  });
  it('refuses too few points / unknown model / bad values instead of guessing', () => {
    expect(fitCalibration([], 'factor')).toMatchObject({ ok: false, errors: ['too_few_points'] });
    expect(fitCalibration([{ ec25: 1, tds: 1 }, { ec25: 2, tds: 2 }], 'linear').ok).toBe(false);
    expect(fitCalibration(lin, 'cubic').ok).toBe(false);
    expect(fitCalibration([{ ec25: 100, tds: 100 }, { ec25: 100, tds: 120 }, { ec25: 100, tds: 90 }], 'linear').errors).toContain('no_spread');
    expect(fitCalibration([{ ec25: -5, tds: 3 }, { ec25: 0, tds: 3 }], 'factor').ok).toBe(false);
  });
  it('manual factor must carry a source and a positive value', () => {
    expect(manualCalibration({ k: 0.65 }).errors).toEqual(['source_missing']);
    expect(manualCalibration({ k: 0, source: 'x' }).errors).toEqual(['factor_missing']);
    const m = manualCalibration({ k: 0.65, source: 'Lab report 7', uncertaintyPct: 10 });
    expect(m).toMatchObject({ ok: true, source: 'manual', sourceText: 'Lab report 7' }); close(m.relRmse, 0.1, 10);
  });
  it('prediction flags extrapolation beyond the calibration range', () => {
    const cal = fitCalibration(lin, 'factor');
    close(predictTds(cal, 2000).value, cal.params.k * 2000, 8);
    expect(predictTds(cal, 2000).flags).toEqual([]);
    expect(predictTds(cal, 50000).flags).toContain('outside_calibration_range');
    expect(predictTds(cal, 100).flags).toContain('outside_calibration_range');
    expect(predictTds(null, 100).status).toBe(INSUFFICIENT);
    expect(predictTds(manualCalibration({ k: 0.6, source: 's' }), 1000).flags).toEqual([]);
  });
});

describe('NaCl equivalent and classes', () => {
  it('decreases with Rw, is about 5-6 g/L for 1 ohm.m at 75F, refuses Rw below the formula domain', () => {
    const t75 = (75 - 32) * 5 / 9;
    const a = naclEquivalent(1, t75).value, b = naclEquivalent(0.5, t75).value, c = naclEquivalent(5, t75).value;
    expect(b).toBeGreaterThan(a); expect(a).toBeGreaterThan(c);
    expect(a).toBeGreaterThan(5000); expect(a).toBeLessThan(6000);
    expect(naclEquivalent(0.01, t75).reason).toBe('rw_too_low');
    close(naclEquivalent(2, 50).rw75, arps(2, 50, t75), 8); // converted to 75F before the fit
    expect(naclEquivalent(1).missing).toEqual(['temperature']);
  });
  it('salinity classes by TDS (Winslow & Kister)', () => {
    expect(classifySalinity(500)).toBe('fresh'); expect(classifySalinity(1000)).toBe('fresh'); expect(classifySalinity(1001)).toBe('slightly_saline');
    expect(classifySalinity(5000)).toBe('moderately_saline'); expect(classifySalinity(20000)).toBe('very_saline'); expect(classifySalinity(50000)).toBe('brine');
    expect(classifySalinity(0)).toBeNull(); expect(SALINITY_CLASSES).toHaveLength(5);
  });
});

describe('indirect estimate with traceability and uncertainty', () => {
  const cal = fitCalibration([[500, 330], [1000, 640], [2000, 1280], [4000, 2570], [8000, 5100]].map(([ec25, tds]) => ({ ec25, tds })), 'factor');
  it('is labelled indirect/estimated and records every parameter used', () => {
    const r = estimateTds({ rw: 5, tC: 25, normalization: { method: 'arps' }, calibration: cal, rwUncertaintyPct: 20 });
    expect(r).toMatchObject({ status: 'estimated', basis: 'indirect' });
    close(r.ec25, 2000, 6); // 1/5 S/m = 2000 uS/cm
    close(r.tds, cal.params.k * 2000, 6);
    expect(r.trace.tRef).toBe(25);
    expect(r.trace.methods).toEqual(expect.arrayContaining(['rw_to_ec', 'ec_normalize_arps', 'tds_factor', 'nacl_equiv']));
    expect(r.trace.calibration).toMatchObject({ model: 'factor', source: 'local', n: 5 });
    expect(r.class).toBe('slightly_saline');
    r.trace.methods.forEach((m) => expect(WATER_INFO[m], m).toBeTruthy());
  });
  it('uncertainty is quantified only when both parts are known (quadrature), never invented', () => {
    const both = estimateTds({ rw: 5, tC: 25, normalization: { method: 'arps' }, calibration: cal, rwUncertaintyPct: 20 });
    close(both.uncertainty.relPct, Math.sqrt(cal.relRmse ** 2 + 0.2 ** 2) * 100, 8);
    const noRw = estimateTds({ rw: 5, tC: 25, normalization: { method: 'arps' }, calibration: cal });
    expect(noRw.uncertainty.relPct).toBeNull(); expect(noRw.uncertainty.parts.rw).toBeNull();
    const man = estimateTds({ rw: 5, tC: 25, normalization: { method: 'arps' }, calibration: manualCalibration({ k: 0.64, source: 'cited' }), rwUncertaintyPct: 10 });
    expect(man.flags).toContain('calibration_uncertainty_unknown'); expect(man.uncertainty.relPct).toBeNull();
  });
  it('insufficient inputs are reported; nothing is estimated from missing temperature or calibration', () => {
    expect(estimateTds({ rw: 5, normalization: { method: 'arps' }, calibration: cal }).missing).toEqual(['temperature']);
    expect(estimateTds({ rw: 5, tC: 25, normalization: { method: 'alpha' }, calibration: cal }).missing).toEqual(['alpha']);
    expect(estimateTds({ rw: 5, tC: 25, normalization: { method: 'arps' }, calibration: { ok: false } }).missing).toEqual(['calibration']);
    expect(estimateTds({ rw: undefined, tC: 25, normalization: { method: 'arps' }, calibration: cal }).missing).toEqual(['rw']);
  });
  it('flags extrapolation of the calibration', () => {
    expect(estimateTds({ rw: 0.05, tC: 25, normalization: { method: 'arps' }, calibration: cal }).flags).toContain('outside_calibration_range');
  });
});

describe('direct sample results', () => {
  it('lab TDS, EC at temperature and Rw at temperature are normalised the same way', () => {
    const n = { method: 'alpha', alpha: 0.02 };
    const a = fromSample({ sampleId: 'A', depthTop: 10, tds: 640, ecUScm: 1200, ecTemp: 35 }, n);
    expect(a).toMatchObject({ basis: 'direct', tds: 640, class: 'fresh' }); close(a.ec25, 1000, 8);
    const b = fromSample({ sampleId: 'B', depthTop: 12, rw: 5, rwTemp: 25 }, { method: 'arps' });
    close(b.ec25, 2000, 6); expect(b.tds).toBeUndefined();
    const c = fromSample({ sampleId: 'C', depthTop: 1, ecUScm: 1200, ecTemp: 35 }, { method: 'alpha' });
    expect(c.ec25).toBeNull(); expect(c.ecIssue).toBe('alpha');
  });
});

describe('samples in the database', () => {
  it('validates required fields, temperature with EC/Rw, unit conversion to uS/cm', async () => {
    expect(validateSample({})).toMatchObject({ sampleId: 'required', depthTop: 'number', source: 'required', tds: 'value' });
    expect(validateSample({ sampleId: 'S', depthTop: 5, source: 'lab', ec: 1.2 })).toMatchObject({ ecTemp: 'temperature' });
    expect(validateSample({ sampleId: 'S', depthTop: 5, source: 'lab', tds: -3 }).tds).toBe('positive');
    expect(validateSample({ sampleId: 'S', depthTop: 5, depthBottom: 3, source: 'lab', tds: 100 }).depthBottom).toBe('order');
    expect(validateSample({ sampleId: 'S', depthTop: 5, source: 'lab', ec: 1, ecTemp: 20, rw: 3, rwTemp: 20 }).rw).toBe('both');
    expect(validateSample({ sampleId: 'S', depthTop: 5, source: 'lab', tds: 100 })).toEqual({});
    const n = normalizeSample({ sampleId: ' S ', depthTop: '5', source: ' lab ', ec: '1.2', ecUnit: 'mS/cm', ecTemp: '22' });
    expect(n).toMatchObject({ sampleId: 'S', ecUScm: 1200, ecTemp: 22, source: 'lab', tds: null });
  });
  it('CRUD, project-wide calibration data, settings, apply/clear on formations', async () => {
    const pid = await createProject({ name: 'P' });
    const w1 = await createWell({ projectId: pid, wellId: 'A', name: 'A' });
    const w2 = await createWell({ projectId: pid, wellId: 'B', name: 'B' });
    const s1 = await addSample(w1, { sampleId: 'S1', depthTop: 10, source: 'Lab 1', tds: 640, ec: 1000, ecTemp: 25 });
    await addSample(w2, { sampleId: 'S2', depthTop: 20, source: 'Lab 1', tds: 1280, ec: 2000, ecTemp: 25 });
    await expect(addSample(w1, { sampleId: '' })).rejects.toThrow('INVALID');
    expect(await listSamples(w1)).toHaveLength(1);
    expect(await calibrationSamples({ id: w1, projectId: pid }, 'well')).toHaveLength(1);
    expect(await calibrationSamples({ id: w1, projectId: pid }, 'project')).toHaveLength(2);
    await updateSample(s1, { sampleId: 'S1', depthTop: 10, source: 'Lab 1', tds: 650, ec: 1000, ecTemp: 25 });
    expect((await db.waterSamples.get(s1)).tds).toBe(650);
    await saveSettings(w1, { normalization: { method: 'arps' } });
    expect(await loadSettings(w1)).toEqual({ normalization: { method: 'arps' } });

    const f = await addFormation(w1, { top: 0, bottom: 50, name: 'Sand' });
    await applyWaterQuality(f, { tds: 800, basis: 'indirect', status: 'estimated' });
    expect((await db.formations.get(f)).waterQuality).toMatchObject({ tds: 800, basis: 'indirect' });
    await clearWaterQuality(f);
    expect((await db.formations.get(f)).waterQuality).toBeUndefined();
    await deleteSample(s1);
    expect(await listSamples(w1)).toHaveLength(0);
  });
  it('water info is documented bilingually for every method', () => {
    for (const [id, m] of Object.entries(WATER_INFO)) {
      expect(m.equation, id).toBeTruthy(); expect(m.source, id).toBeTruthy();
      for (const f of ['name', 'uncertainty', 'validity']) { expect(m[f].en, `${id}.${f}`).toBeTruthy(); expect(m[f].ar, `${id}.${f}`).toBeTruthy(); }
      expect(m.assumptions.ar.length).toBe(m.assumptions.en.length);
    }
  });
});
