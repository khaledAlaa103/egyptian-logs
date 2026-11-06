import { describe, it, expect } from 'vitest';
import { arps, cToF, fToC, normalizeConductivity, temperatureAt } from '../src/engine/resistivity/temperature.js';
import { computeRt, rwFromSP, rmfeAt, spK, rwa, INSUFFICIENT } from '../src/engine/resistivity/resistivity.js';
import * as P from '../src/engine/petrophysics/petrophysics.js';
import { runInterpretation, methodsUsed } from '../src/engine/interpret.js';
import { METHOD_INFO } from '../src/engine/methodsInfo.js';

const close = (a, b, d = 6) => expect(a).toBeCloseTo(b, d);

describe('temperature', () => {
  it('Arps: 1.0 ohm.m at 25C -> 75C = 46.5/96.5; reversible; unit F consistent', () => {
    close(arps(1, 25, 75), 46.5 / 96.5, 10);
    close(arps(arps(1, 25, 75), 75, 25), 1, 10);
    close(arps(1, 77, 167, 'F'), arps(1, 25, 75, 'C'), 3); // 77F=25C, 167F=75C
    expect(arps(-1, 25, 75)).toBeNaN();
    expect(arps(1, -30, 75)).toBeNaN();
  });
  it('C/F conversion and conductivity normalisation needs an explicit alpha', () => {
    close(cToF(100), 212, 10); close(fToC(32), 0, 10);
    close(normalizeConductivity(1200, 35, 0.02), 1200 / 1.2, 10);
    expect(normalizeConductivity(1200, 35, undefined)).toBeNaN();
    expect(normalizeConductivity(1200, 25, 0.02)).toBe(1200);
  });
  it('temperature profile methods', () => {
    expect(temperatureAt({ method: 'constant', value: 30 }, 100)).toBe(30);
    close(temperatureAt({ method: 'gradient', surface: 20, gradient: 3 }, 200), 26, 10); // 3 C/100 m
    expect(temperatureAt({ method: 'curve' }, 5, (d) => d * 2)).toBe(10);
    expect(temperatureAt({ method: 'gradient', surface: 20 }, 100)).toBeNull();
    expect(temperatureAt(null, 1)).toBeNull();
  });
});

describe('Rt: apparent resistivity is never silently Rt', () => {
  it('no declared method -> insufficient', () => {
    const r = computeRt('none', { ra: 20 });
    expect(r.status).toBe(INSUFFICIENT);
    expect(computeRt(undefined, { ra: 20 }).value).toBeNull();
  });
  it('direct needs all three conditions asserted', () => {
    expect(computeRt('direct', { ra: 20, cond: { thickBed: true, invasionNegligible: true } }).missing).toEqual(['boreholeNegligible']);
    const ok = computeRt('direct', { ra: 20, cond: { thickBed: true, invasionNegligible: true, boreholeNegligible: true } });
    expect(ok).toMatchObject({ status: 'estimated', value: 20 }); // estimated, not "corrected"
  });
  it('geometric factor: Rt = (Ra - J Rxo)/(1 - J)', () => {
    close(computeRt('geometric', { ra: 8, rxo: 2, J: 0.3 }).value, (8 - 0.6) / 0.7, 10);
    expect(computeRt('geometric', { ra: 8, rxo: 2, J: 1 }).status).toBe(INSUFFICIENT);
    expect(computeRt('geometric', { ra: 8, J: 0.3 }).missing).toEqual(['rxo']);
    expect(computeRt('geometric', { ra: 1, rxo: 10, J: 0.5 }).status).toBe(INSUFFICIENT); // negative Rt rejected
  });
  it('chart factor needs K and a cited source', () => {
    expect(computeRt('factor', { ra: 10, factor: 1.1 }).missing).toEqual(['factorSource']);
    const r = computeRt('factor', { ra: 10, factor: 1.1, factorSource: 'Chart Rcor-2' });
    close(r.value, 11, 10); expect(r.status).toBe('corrected');
  });
});

describe('Rw from SP', () => {
  it('K = 65 + 0.24 T; Rwe = Rmfe*10^(SSP/K)', () => {
    close(spK(50), 77, 10);
    const r = rwFromSP({ ssp: -60, tFormC: 50, rmfeFormTemp: 1 });
    close(r.rwe, 10 ** (-60 / 77), 8);
    expect(r.status).toBe('estimated');
  });
  it('Rw is larger when SSP is less negative; positive SSP and chart-range cases are refused', () => {
    const a = rwFromSP({ ssp: -80, tFormC: 50, rmfeFormTemp: 1.5 }).value;
    const b = rwFromSP({ ssp: -40, tFormC: 50, rmfeFormTemp: 1.5 }).value;
    expect(b).toBeGreaterThan(a);
    expect(rwFromSP({ ssp: 10, tFormC: 50, rmfeFormTemp: 1 }).reason).toBe('ssp_not_negative');
    expect(rwFromSP({ ssp: -150, tFormC: 50, rmfeFormTemp: 0.2 }).status).toBe(INSUFFICIENT); // Rwe75 below 0.12
    expect(rwFromSP({ ssp: -60, tFormC: 50 }).missing).toEqual(['rmfe']);
  });
  it('pins the Bateman-Konen fit at T=150F, Rwe75=0.5 -> Rw75 = 0.5276 (hand calculation)', () => {
    // choose T so that tF=150F and make Rwe(T) equal to Rwe75 by using Arps back-conversion
    const tC = fToC(150), rwe75 = 0.5;
    const rweT = arps(rwe75, fToC(75), tC);
    const rmfe = rweT / 10 ** (-60 / spK(tC)); // so that Rwe at T equals rweT for SSP -60
    const r = rwFromSP({ ssp: -60, tFormC: tC, rmfeFormTemp: rmfe });
    close(arps(r.value, tC, fToC(75)), 0.5276, 3);
  });
  it('Rmfe rule: 0.85*Rmf only above 0.1 ohm.m at 75F, else a chart is required', () => {
    close(rmfeAt({ rmf: 1, rmfTempC: 25 }, 25).value, 0.85, 10);
    expect(rmfeAt({ rmf: 0.05, rmfTempC: 25 }, 25).reason).toBe('rmfe_chart_needed');
    expect(rmfeAt({ rmf: 1 }, 25).missing).toEqual(['rmfTempC']);
    close(rmfeAt({ rmfe: 0.5, rmfeTempC: 25 }, 25).value, 0.5, 10);
  });
  it('Rwa = Rt phi^m / a', () => {
    close(rwa(10, 0.25, 1, 2), 0.625, 10);
    expect(rwa(10, 0, 1, 2)).toBeNaN();
  });
});

describe('shale volume', () => {
  it('GR index with clipping and invalid baselines', () => {
    expect(P.grIndex(60, 20, 100).value).toBeCloseTo(0.5, 10);
    expect(P.grIndex(150, 20, 100)).toMatchObject({ value: 1, flags: ['igr_clipped'] });
    expect(P.grIndex(5, 20, 100).value).toBe(0);
    expect(P.grIndex(60, undefined, 100).missing).toEqual(['grClean', 'grShale']); // no default baselines
    expect(P.grIndex(60, 100, 20).reason).toBe('baselines_invalid');
  });
  it('textbook values at IGR = 0.5', () => {
    expect(P.vshaleFromIndex(0.5, 'linear').value).toBe(0.5);
    close(P.vshaleFromIndex(0.5, 'larionov_older').value, 0.33, 10);
    close(P.vshaleFromIndex(0.5, 'steiber').value, 0.25, 10);
    close(P.vshaleFromIndex(0.5, 'clavier').value, 1.7 - Math.sqrt(1.94), 10);
    close(P.vshaleFromIndex(0.5, 'larionov_tertiary').value, 0.083 * (2 ** 1.85 - 1), 10);
    expect(P.vshaleFromIndex(0.5, 'nope').status).toBe(INSUFFICIENT);
  });
  it('all models map 0 -> 0 and 1 -> 1 and are monotonic', () => {
    for (const k of Object.keys(P.VSH_MODELS)) {
      close(P.VSH_MODELS[k](0), 0, 6);
      expect(P.VSH_MODELS[k](1)).toBeGreaterThan(0.95);
      let prev = -1;
      for (let i = 0; i <= 20; i++) { const v = P.VSH_MODELS[k](i / 20); expect(v).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; }
    }
  });
  it('SP linear', () => {
    expect(P.vshaleFromSP(-20, -40, 10).value).toBeCloseTo(0.4, 10);
    expect(P.vshaleFromSP(-20, 10, 10).reason).toBe('baselines_invalid');
  });
});

describe('porosity', () => {
  it('density: (2.65-2.30)/(2.65-1.0) = 0.2121; needs matrix and fluid', () => {
    close(P.densityPorosity(2.3, 2.65, 1).value, 0.35 / 1.65, 10);
    expect(P.densityPorosity(2.3).missing).toEqual(['rhoMa', 'rhoFl']);
    expect(P.densityPorosity(2.9, 2.65, 1)).toMatchObject({ value: 0, flags: ['phi_clipped'] });
    expect(P.densityPorosity(2.3, 1, 2.65).reason).toBe('matrix_le_fluid');
  });
  it('sonic Wyllie and Raymer-Hunt-Gardner', () => {
    close(P.sonicPorosityWyllie(90, 55.5, 189).value, 34.5 / 133.5, 10);
    close(P.sonicPorosityWyllie(90, 55.5, 189, 1.2).value, 34.5 / 133.5 / 1.2, 10);
    close(P.sonicPorosityRHG(90, 55.5).value, (0.625 * 34.5) / 90, 10);
    expect(P.sonicPorosityWyllie(90, 55.5, 40).reason).toBe('fluid_le_matrix');
  });
  it('neutron-density combination and gas crossover flag', () => {
    const r = P.neutronDensityPorosity(0.3, 2.65 - 0.2 * 1.65, 2.65, 1); // phiD = 0.2
    close(r.value, Math.sqrt(0.065), 8);
    expect(r.flags).not.toContain('gas_crossover');
    expect(P.neutronDensityPorosity(0.1, 2.65 - 0.3 * 1.65, 2.65, 1).flags).toContain('gas_crossover');
  });
  it('effective porosity', () => {
    close(P.effectivePorosity(0.25, 0.2, 0.3).value, 0.19, 10);
    expect(P.effectivePorosity(0.05, 0.5, 0.3)).toMatchObject({ value: 0, flags: ['phi_clipped'] });
    expect(P.effectivePorosity(0.25, 0.2).missing).toEqual(['phiShale']);
  });
  it('formation factor', () => {
    close(P.formationFactor(0.25, 1, 2).value, 16, 10);
    close(P.formationFactor(0.2, 0.62, 2.15).value, 0.62 / 0.2 ** 2.15, 10);
    expect(P.formationFactor(0, 1, 2).status).toBe(INSUFFICIENT);
  });
});

describe('water saturation', () => {
  const base = { rt: 10, rw: 0.05, phi: 0.25, a: 1, m: 2, n: 2, vsh: 0, rsh: 2, vshLimit: 0.1 };
  it('Archie: sqrt(0.05/(0.0625*10)) = 0.28284', () => {
    close(P.swArchie(base).value, Math.sqrt(0.08), 10);
  });
  it('Archie refuses clay-rich zones and missing parameters (no defaults)', () => {
    expect(P.swArchie({ ...base, vsh: 0.3 }).reason).toBe('archie_clay_rich');
    expect(P.swArchie({ ...base, vsh: undefined }).missing).toEqual(['vsh']);
    expect(P.swArchie({ ...base, vshLimit: undefined }).missing).toEqual(['vshLimit']);
    expect(P.swArchie({ ...base, n: undefined }).missing).toEqual(['a', 'm', 'n']);
    expect(P.swArchie({ ...base, rw: 0 }).missing).toEqual(['rw']);
  });
  it('Archie is monotonic: higher Rt -> lower Sw; clipped to 1 with a flag', () => {
    expect(P.swArchie({ ...base, rt: 20 }).value).toBeLessThan(P.swArchie(base).value);
    const w = P.swArchie({ ...base, rt: 0.2 });
    expect(w.value).toBe(1); expect(w.flags).toContain('sw_clipped');
  });
  it('Simandoux and Indonesia reduce to Archie when Vsh = 0', () => {
    const arch = P.swArchie(base).value;
    close(P.swSimandoux(base).value, arch, 10);
    close(P.swIndonesia(base).value, arch, 10);
  });
  it('shaly models give lower Sw than Archie for the same Rt when shale conducts', () => {
    const shaly = { ...base, vsh: 0.2 };
    const arch = ((1 * 0.05) / (0.0625 * 10)) ** 0.5;
    expect(P.swSimandoux(shaly).value).toBeLessThan(arch);
    expect(P.swIndonesia(shaly).value).toBeLessThan(arch);
    expect(P.swSimandoux({ ...shaly, rsh: undefined }).missing).toEqual(['rsh']);
  });
  it('Simandoux solution satisfies its own equation (round trip)', () => {
    const s = { ...base, vsh: 0.25, rsh: 3 };
    const sw = P.swSimandoux(s).value;
    const lhs = 1 / s.rt;
    const rhs = (s.phi ** s.m * sw * sw) / (s.a * s.rw) + (s.vsh * sw) / s.rsh;
    close(lhs, rhs, 10);
  });
  it('Indonesia solution satisfies its own equation (round trip, n = 2.2)', () => {
    const s = { ...base, vsh: 0.25, rsh: 3, n: 2.2 };
    const sw = P.swIndonesia(s).value;
    const term = s.vsh ** (1 - s.vsh / 2) / Math.sqrt(s.rsh) + s.phi ** (s.m / 2) / Math.sqrt(s.a * s.rw);
    close(1 / Math.sqrt(s.rt), term * sw ** (s.n / 2), 10);
  });
  it('resistivity index', () => {
    close(P.resistivityIndex(10, 0.05, 16).value, 12.5, 10);
  });
});

describe('orchestrator', () => {
  // Synthetic, internally consistent test curves (NOT real data): a clean wet sand over shale.
  const depth = Array.from({ length: 41 }, (_, i) => i * 0.5); // 0..20 m
  const sand = (d) => d >= 8 && d <= 14;
  const curves = {
    res_deep: { depth, values: depth.map((d) => (sand(d) ? 10 : 2)) },
    gr: { depth, values: depth.map((d) => (sand(d) ? 20 : 100)) },
    density: { depth, values: depth.map((d) => (sand(d) ? 2.65 - 0.25 * 1.65 : 2.5)) },
  };
  const cfg = () => ({
    grid: { curveId: 'res_deep' },
    temperature: { method: 'constant', value: 25, source: 'test' },
    resistivity: { rtCurve: 'res_deep', method: 'direct', cond: { thickBed: true, invasionNegligible: true, boreholeNegligible: true } },
    rw: { method: 'manual', value: 0.05, refTemp: 25, source: 'test sample' },
    vshale: { model: 'larionov_older', curve: 'gr', grClean: 20, grShale: 100 },
    porosity: { method: 'density', rhoMa: 2.65, rhoFl: 1, curves: { density: 'density' } },
    saturation: { model: 'archie', a: 1, m: 2, n: 2, vshLimit: 0.1, rsh: 2 },
  });
  const at = (res, d) => res.depth.indexOf(d);

  it('computes the full chain in the clean sand and refuses Archie in shale', () => {
    const r = runInterpretation(cfg(), curves);
    const i = at(r, 10);
    close(r.series.vsh[i], 0, 10);
    close(r.series.phi[i], 0.25, 8);
    close(r.series.rt[i], 10, 10);
    close(r.series.sw[i], Math.sqrt(0.08), 8);
    close(r.series.f[i], 16, 8);
    close(r.series.bvw[i], 0.25 * Math.sqrt(0.08), 8);
    const j = at(r, 2);
    expect(r.series.vsh[j]).toBeCloseTo(0.33 * (2 ** 2 - 1), 8) ; // IGR=1 -> 0.99
    expect(r.series.sw[j]).toBeNull();
    expect(r.flags[j]).toContain('archie_clay_rich');
    expect(r.diagnostics.sw.reasons.archie_clay_rich).toBeGreaterThan(0);
  });

  it('without a declared Rt method nothing downstream is produced (apparent stays apparent)', () => {
    const c = cfg(); c.resistivity.method = 'none';
    const r = runInterpretation(c, curves);
    expect(r.series.rt.every((v) => v === null)).toBe(true);
    expect(r.series.sw.every((v) => v === null)).toBe(true);
    expect(r.series.ra.some((v) => v != null)).toBe(true); // the measured value is still reported
    expect(r.diagnostics.rt.reasons.correctionMethod).toBeGreaterThan(0);
  });

  it('missing Archie parameters are reported, not defaulted', () => {
    const c = cfg(); delete c.saturation.m;
    const r = runInterpretation(c, curves);
    expect(r.series.sw.every((v) => v === null)).toBe(true);
    expect(Object.keys(r.diagnostics.sw.reasons)).toContain('m');
  });

  it('Rw is temperature-corrected along a gradient (Arps)', () => {
    const c = cfg(); c.temperature = { method: 'gradient', surface: 20, gradient: 3 };
    c.rw = { method: 'manual', value: 0.05, refTemp: 25, source: 'sample' };
    const r = runInterpretation(c, curves);
    const i = at(r, 10); // T = 20 + 0.03*10 = 20.3 C
    close(r.series.temp[i], 20.3, 8);
    close(r.series.rw[i], arps(0.05, 25, 20.3), 10);
    expect(r.series.rw[i]).toBeGreaterThan(0.05); // colder -> more resistive
  });

  it('manual Rw requires a source note (traceability)', () => {
    const c = cfg(); c.rw.source = '';
    const r = runInterpretation(c, curves);
    expect(r.series.rw.every((v) => v === null)).toBe(true);
    expect(r.diagnostics.rw.reasons.rwSource).toBeGreaterThan(0);
  });

  it('Rwa minimum in a clean zone recovers the true Rw of a wet synthetic sand', () => {
    const c = cfg();
    c.rw = { method: 'rwa_min', interval: { top: 8, bottom: 14 } };
    const r = runInterpretation(c, curves);
    // Rt=10, phi=0.25, a=1, m=2 -> Rwa = 10*0.0625 = 0.625 (this synthetic zone is NOT wet at Rw=0.05; Rwa is an upper bound)
    close(r.series.rwa[at(r, 10)], 0.625, 8);
    close(r.series.rw[at(r, 10)], 0.625, 8);
  });

  it('uses effective porosity when the shale correction is enabled; depth window; empty input', () => {
    const c = cfg(); c.porosity.shaleCorrection = { enabled: true, phiShale: 0.3 }; c.grid.top = 9; c.grid.bottom = 11;
    const r = runInterpretation(c, curves);
    expect(r.depth[0]).toBe(9); expect(r.depth[r.depth.length - 1]).toBe(11);
    expect(r.series.phiE.every((v) => v != null)).toBe(true);
    expect(runInterpretation({ grid: { curveId: 'nope' } }, curves).errors).toContain('no_grid_curve');
  });

  it('every method used is documented bilingually with equation, source, assumptions, uncertainty', () => {
    const ids = methodsUsed(cfg());
    expect(ids).toEqual(expect.arrayContaining(['arps', 'rt_direct', 'rw_manual', 'igr', 'vsh_larionov_older', 'phi_density', 'sw_archie', 'formation_factor']));
    for (const id of Object.keys(METHOD_INFO)) {
      const m = METHOD_INFO[id];
      expect(m.equation, id).toBeTruthy(); expect(m.source, id).toBeTruthy();
      for (const f of ['name', 'uncertainty', 'validity']) { expect(m[f].en, `${id}.${f}`).toBeTruthy(); expect(m[f].ar, `${id}.${f}.ar`).toBeTruthy(); }
      expect(m.assumptions.en.length, id).toBeGreaterThan(0); expect(m.assumptions.ar.length, id).toBe(m.assumptions.en.length);
    }
    ids.forEach((id) => expect(METHOD_INFO[id], id).toBeTruthy());
  });
});
