// Scientific validation suite. Each block checks a method in an INDEPENDENT way: textbook/hand values,
// limiting cases, invariances (units, scaling), monotonicity, inverse round trips, and seeded random
// property tests against a numerical root-finder that shares no code with the closed forms.
import { describe, it, expect } from 'vitest';
import { arps, cToF, fToC, normalizeConductivity } from '../src/engine/resistivity/temperature.js';
import { rwFromSP, spK, rmfeAt, computeRt, rwa } from '../src/engine/resistivity/resistivity.js';
import * as P from '../src/engine/petrophysics/petrophysics.js';
import { runInterpretation } from '../src/engine/interpret.js';
import { convert, UNIT_GROUPS } from '../src/engine/units/units.js';
import { naclEquivalent, fitCalibration, ec25FromRw, rwToEc, estimateTds, manualCalibration, classifySalinity } from '../src/engine/water/water.js';
import { calibrateDepth, calibrateTrack, pixelToDepth, pixelToValue } from '../src/digitize/calibration.js';
import { parseDelimited, detectDelimiter } from '../src/io/tableParse.js';
import { parseNumber } from '../src/io/importEngine.js';
import { statsInInterval } from '../src/results/intervalStats.js';
import { toCsv } from '../src/io/csvWriter.js';

// small seeded PRNG (mulberry32) so failures are reproducible
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const between = (r, a, b) => a + (b - a) * r();
/** Independent bisection solver for monotonic f on [lo, hi]. */
const bisect = (f, lo, hi) => { for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (f(lo) * f(m) <= 0) hi = m; else lo = m; } return (lo + hi) / 2; };

describe('temperature correction (Arps)', () => {
  it('matches hand calculations and the classic chart relation', () => {
    expect(arps(0.05, fToC(75), fToC(150))).toBeCloseTo(0.05 * (75 + 6.77) / (150 + 6.77), 3); // using the °F form
    expect(arps(0.05, 75, 150, 'F')).toBeCloseTo(0.05 * 81.77 / 156.77, 10);
    expect(arps(0.05, 75, 150, 'F')).toBeCloseTo(0.02608, 4);
    expect(arps(1, 25, 25)).toBe(1);
  });
  it('°C and °F forms agree (the two published constants 21.5 and 6.77 are rounded) within 0.5 %', () => {
    const r = rng(1);
    for (let i = 0; i < 300; i++) {
      const t1 = between(r, 5, 60), t2 = between(r, 5, 150), R = between(r, 0.02, 50);
      const a = arps(R, t1, t2), b = arps(R, cToF(t1), cToF(t2), 'F');
      expect(Math.abs(a - b) / a).toBeLessThan(5e-3);
    }
  });
  it('is invertible and transitive: T1→T2→T3 equals T1→T3', () => {
    const r = rng(2);
    for (let i = 0; i < 200; i++) {
      const [a, b, c] = [between(r, 0, 100), between(r, 0, 100), between(r, 0, 100)], R = between(r, 0.01, 100);
      expect(arps(arps(R, a, b), b, c)).toBeCloseTo(arps(R, a, c), 9);
      expect(arps(arps(R, a, b), b, a)).toBeCloseTo(R, 9);
    }
  });
  it('resistivity falls when temperature rises (all tested ranges)', () => {
    for (let t = 0; t < 140; t += 5) expect(arps(1, 25, t + 5)).toBeLessThan(arps(1, 25, t));
  });
  it('linear EC normalisation is consistent with its inverse', () => {
    const r = rng(3);
    for (let i = 0; i < 100; i++) { const ec = between(r, 50, 50000), t = between(r, 5, 40), a = between(r, 0.015, 0.025); const e25 = normalizeConductivity(ec, t, a); expect(e25 * (1 + a * (t - 25))).toBeCloseTo(ec, 6); }
  });
});

describe('SP method', () => {
  it('K from the °C form agrees with the common K = 61 + 0.133·T(°F) within 1 % over 20–100 °C', () => {
    for (let t = 20; t <= 100; t += 5) { const a = spK(t), b = 61 + 0.133 * cToF(t); expect(Math.abs(a - b) / b).toBeLessThan(0.01); }
  });
  it('a larger SP deflection gives a lower Rw; SSP = −K·log(Rmfe/Rwe) is reproduced', () => {
    const rmfe = 1.5, t = 55;
    let prev = Infinity;
    for (const ssp of [-30, -50, -70, -90, -110]) { const r = rwFromSP({ ssp, tFormC: t, rmfeFormTemp: rmfe }); if (r.value != null) { expect(r.value).toBeLessThan(prev); expect(-spK(t) * Math.log10(rmfe / r.rwe)).toBeCloseTo(ssp, 9); prev = r.value; } }
    expect(prev).toBeLessThan(Infinity);
  });
  it('Rmfe rule boundaries', () => {
    expect(rmfeAt({ rmf: 0.11, rmfTempC: fToC(75) }, fToC(75)).value).toBeCloseTo(0.0935, 10);
    expect(rmfeAt({ rmf: 0.09, rmfTempC: fToC(75) }, fToC(75)).reason).toBe('rmfe_chart_needed');
  });
});

describe('Rt routes', () => {
  it('geometric-factor Rt reduces to Ra when J = 0 and is the inverse of the forward model', () => {
    const r = rng(4);
    expect(computeRt('geometric', { ra: 12, rxo: 3, J: 0 }).value).toBe(12);
    for (let i = 0; i < 200; i++) { const rt = between(r, 1, 200), rxo = between(r, 0.5, 20), J = between(r, 0, 0.9); const ra = J * rxo + (1 - J) * rt; expect(computeRt('geometric', { ra, rxo, J }).value).toBeCloseTo(rt, 8); }
  });
});

describe('shale volume models', () => {
  it('all models are monotonic on [0,1], bounded, agree at the end points', () => {
    for (const k of Object.keys(P.VSH_MODELS)) {
      let prev = -1;
      for (let i = 0; i <= 100; i++) { const v = P.vshaleFromIndex(i / 100, k).value; expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); expect(v).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; }
      expect(P.vshaleFromIndex(0, k).value).toBeCloseTo(0, 6); expect(P.vshaleFromIndex(1, k).value).toBeGreaterThan(0.95);
    }
  });
  it('known ordering at IGR = 0.5: Larionov(tertiary) < Steiber < Clavier < Larionov(older) < linear', () => {
    const v = (k) => P.vshaleFromIndex(0.5, k).value;
    expect(v('larionov_tertiary')).toBeLessThan(v('steiber')); expect(v('steiber')).toBeLessThan(v('clavier'));
    expect(v('clavier')).toBeLessThan(v('larionov_older')); expect(v('larionov_older')).toBeLessThan(v('linear'));
  });
  it('the GR index is invariant to the linear scaling of the GR unit', () => {
    const r = rng(5);
    for (let i = 0; i < 100; i++) { const c = between(r, 10, 40), s = between(r, 90, 160), g = between(r, c, s), k = between(r, 0.5, 3); expect(P.grIndex(g, c, s).value).toBeCloseTo(P.grIndex(g * k, c * k, s * k).value, 10); }
  });
});

describe('porosity', () => {
  it('density porosity recovers the porosity used to build the bulk density; sonic Wyllie likewise', () => {
    const r = rng(6);
    for (let i = 0; i < 300; i++) {
      const phi = between(r, 0.01, 0.45), rma = between(r, 2.6, 2.9), rf = between(r, 0.9, 1.2), rhob = rma * (1 - phi) + rf * phi;
      expect(P.densityPorosity(rhob, rma, rf).value).toBeCloseTo(phi, 9);
      const dtma = between(r, 43, 56), dtf = between(r, 180, 200), dt = dtma * (1 - phi) + dtf * phi;
      expect(P.sonicPorosityWyllie(dt, dtma, dtf).value).toBeCloseTo(phi, 9);
    }
  });
  it('porosity is unaffected by expressing the density in kg/m³ instead of g/cm³ after conversion', () => {
    const a = P.densityPorosity(2.3, 2.65, 1).value, b = P.densityPorosity(convert(2300, 'density', 'kg/m3', 'g/cm3'), 2.65, 1).value;
    expect(a).toBeCloseTo(b, 12);
  });
  it('neutron-density porosity lies between its inputs and flags gas when φN < φD', () => {
    const r = rng(7);
    for (let i = 0; i < 200; i++) { const n = between(r, 0.05, 0.4), d = between(r, 0.05, 0.4); const rhob = 2.65 - d * 1.65; const res = P.neutronDensityPorosity(n, rhob, 2.65, 1); expect(res.value).toBeGreaterThanOrEqual(Math.min(n, d) - 1e-9); expect(res.value).toBeLessThanOrEqual(Math.max(n, d) + 1e-9); expect(res.flags.includes('gas_crossover')).toBe(n < d - 1e-12); }
  });
});

describe('water saturation models against an independent numerical solver', () => {
  const r = rng(8);
  const cases = Array.from({ length: 1500 }, () => ({ rt: between(r, 0.5, 500), rw: between(r, 0.02, 3), phi: between(r, 0.05, 0.4), a: between(r, 0.6, 1.2), m: between(r, 1.6, 2.4), n: between(r, 1.6, 2.6), vsh: between(r, 0, 0.5), rsh: between(r, 0.8, 8), vshLimit: 0.6 }));
  it('Archie solves Rt = a·Rw / (φ^m · Sw^n)', () => {
    for (const c of cases) {
      const sw = P.swArchie({ ...c, vsh: 0 }).value;
      if (sw >= 1) continue; // clipped
      expect((c.a * c.rw) / (c.phi ** c.m * sw ** c.n)).toBeCloseTo(c.rt, 6);
    }
  });
  it('Simandoux (n=2) equals the numerical root of 1/Rt = φ^m·Sw²/(a·Rw) + Vsh·Sw/Rsh', () => {
    for (const c of cases) {
      const f = (sw) => (c.phi ** c.m * sw * sw) / (c.a * c.rw) + (c.vsh * sw) / c.rsh - 1 / c.rt;
      const root = bisect(f, 0, 50);
      const sw = P.swSimandoux(c).value;
      expect(Math.min(1, root)).toBeCloseTo(sw, 7);
    }
  });
  it('Indonesia equals the numerical root of 1/√Rt = [Vsh^(1−Vsh/2)/√Rsh + φ^(m/2)/√(a·Rw)]·Sw^(n/2)', () => {
    for (const c of cases) {
      const term = c.vsh ** (1 - c.vsh / 2) / Math.sqrt(c.rsh) + c.phi ** (c.m / 2) / Math.sqrt(c.a * c.rw);
      const f = (sw) => term * sw ** (c.n / 2) - 1 / Math.sqrt(c.rt);
      expect(Math.min(1, bisect(f, 1e-9, 50))).toBeCloseTo(P.swIndonesia(c).value, 7);
    }
  });
  it('Sw always lies in [0,1], falls as Rt rises, and all three models coincide at Vsh = 0 (n = 2, the case Simandoux covers)', () => {
    for (const c of cases.slice(0, 300).map((x) => ({ ...x, n: 2 }))) {
      const a = P.swArchie({ ...c, vsh: 0 }).value, s = P.swSimandoux({ ...c, vsh: 0 }).value, i = P.swIndonesia({ ...c, vsh: 0 }).value;
      expect(a).toBeGreaterThan(0); expect(a).toBeLessThanOrEqual(1);
      if (a < 1) { expect(s).toBeCloseTo(a, 7); expect(i).toBeCloseTo(a, 7); }
      expect(P.swArchie({ ...c, vsh: 0, rt: c.rt * 2 }).value).toBeLessThanOrEqual(a);
    }
  });
  it('shale conductivity can only lower Sw relative to Archie at the same Rt (n = 2)', () => {
    for (const c of cases.slice(0, 300).map((x) => ({ ...x, n: 2 }))) { const arch = P.swArchie({ ...c, vsh: 0 }).value; expect(P.swSimandoux(c).value).toBeLessThanOrEqual(arch + 1e-9); expect(P.swIndonesia(c).value).toBeLessThanOrEqual(arch + 1e-9); }
  });
  it('Archie is refused above the clean limit and for missing parameters', () => {
    expect(P.swArchie({ ...cases[0], vsh: 0.7, vshLimit: 0.6 }).reason).toBe('archie_clay_rich');
    expect(P.swArchie({ ...cases[0], a: undefined }).status).toBe('insufficient-inputs');
  });
  it('formation factor F = Ro/Rw: the Archie Ro at Sw = 1 reproduces it, and Rwa recovers Rw in a wet clean zone', () => {
    for (const c of cases.slice(0, 200)) {
      const F = P.formationFactor(c.phi, c.a, c.m).value, ro = F * c.rw;
      expect(rwa(ro, c.phi, c.a, c.m)).toBeCloseTo(c.rw, 9);
      expect(P.resistivityIndex(ro, c.rw, F).value).toBeCloseTo(1, 9);
    }
  });
});

describe('end-to-end interpretation is consistent with the individual formulas and with unit changes', () => {
  const depth = Array.from({ length: 41 }, (_, i) => i * 0.5);
  const base = () => ({
    curves: { res_deep: { depth, values: depth.map((d) => 5 + d) }, gr: { depth, values: depth.map((d) => 30 + 3 * d) }, density: { depth, values: depth.map((d) => 2.3 + d * 0.005) } },
    cfg: {
      grid: { curveId: 'res_deep' }, temperature: { method: 'gradient', surface: 20, gradient: 3 }, resistivity: { rtCurve: 'res_deep', method: 'factor', factor: 1.1, factorSource: 'chart' },
      rw: { method: 'manual', value: 0.8, refTemp: 25, source: 's' }, vshale: { model: 'larionov_older', curve: 'gr', grClean: 30, grShale: 120 },
      porosity: { method: 'density', rhoMa: 2.65, rhoFl: 1, curves: { density: 'density' }, shaleCorrection: {} }, saturation: { model: 'simandoux', a: 1, m: 2, n: 2, vshLimit: 0.1, rsh: 3 },
    },
  });
  it('every sample reproduces the closed-form chain', () => {
    const { curves, cfg } = base();
    const out = runInterpretation(cfg, curves);
    out.depth.forEach((d, i) => {
      const rt = (5 + d) * 1.1, T = 20 + 0.03 * d, rw = arps(0.8, 25, T), igr = Math.min(1, Math.max(0, (30 + 3 * d - 30) / 90)), vsh = Math.min(1, 0.33 * (2 ** (2 * igr) - 1));
      const phi = Math.min(1, Math.max(0, (2.65 - (2.3 + d * 0.005)) / 1.65));
      const sw = P.swSimandoux({ rt, rw, phi, a: 1, m: 2, vsh, rsh: 3 }).value;
      expect(out.series.rt[i]).toBeCloseTo(rt, 9); expect(out.series.rw[i]).toBeCloseTo(rw, 9); expect(out.series.vsh[i]).toBeCloseTo(vsh, 9);
      expect(out.series.phi[i]).toBeCloseTo(phi, 9); expect(out.series.sw[i]).toBeCloseTo(sw, 9);
    });
  });
  it('results do not depend on how the depth was entered: the same log in feet converted to metres gives identical output', () => {
    const { curves, cfg } = base();
    const ft = Object.fromEntries(Object.entries(curves).map(([k, c]) => [k, { depth: c.depth.map((d) => convert(d, 'depth', 'm', 'ft')), values: c.values }]));
    const back = Object.fromEntries(Object.entries(ft).map(([k, c]) => [k, { depth: c.depth.map((d) => convert(d, 'depth', 'ft', 'm')), values: c.values }]));
    const a = runInterpretation(cfg, curves), b = runInterpretation(cfg, back);
    a.series.sw.forEach((v, i) => expect(b.series.sw[i]).toBeCloseTo(v, 9));
  });
  it('resistivity entered in Ω·ft and converted to Ω·m gives the same Sw as the original Ω·m data', () => {
    const { curves, cfg } = base();
    const viaFt = { ...curves, res_deep: { depth, values: curves.res_deep.values.map((v) => convert(convert(v, 'resistivity', 'ohm.m', 'ohm.ft'), 'resistivity', 'ohm.ft', 'ohm.m')) } };
    runInterpretation(cfg, viaFt).series.sw.forEach((v, i) => expect(v).toBeCloseTo(runInterpretation(cfg, curves).series.sw[i], 9));
  });
  it('no quantity is produced from missing inputs (no silent defaults)', () => {
    const { curves, cfg } = base();
    for (const drop of [['saturation', 'm'], ['saturation', 'a'], ['saturation', 'rsh'], ['porosity', 'rhoMa'], ['vshale', 'grShale'], ['rw', 'source'], ['resistivity', 'factorSource']]) {
      const c = JSON.parse(JSON.stringify(cfg)); delete c[drop[0]][drop[1]];
      const out = runInterpretation(c, curves);
      const hit = { saturation: 'sw', porosity: 'phi', vshale: 'vsh', rw: 'rw', resistivity: 'rt' }[drop[0]];
      expect(out.series[hit].every((v) => v === null) || out.series.sw.every((v) => v === null), drop.join('.')).toBe(true);
    }
  });
});

describe('Simandoux n handling', () => {
  it('reports that n is ignored (Simandoux is an n = 2 model) instead of staying silent', () => {
    const depth = [0, 1, 2];
    const curves = { res_deep: { depth, values: [10, 10, 10] }, gr: { depth, values: [30, 30, 30] }, density: { depth, values: [2.3, 2.3, 2.3] } };
    const cfg = (n) => ({ grid: { curveId: 'res_deep' }, temperature: { method: 'constant', value: 25 }, resistivity: { rtCurve: 'res_deep', method: 'factor', factor: 1, factorSource: 'c' }, rw: { method: 'manual', value: 0.8, refTemp: 25, source: 's' }, vshale: { model: 'linear', curve: 'gr', grClean: 30, grShale: 120 }, porosity: { method: 'density', rhoMa: 2.65, rhoFl: 1, curves: { density: 'density' }, shaleCorrection: {} }, saturation: { model: 'simandoux', a: 1, m: 2, n, vshLimit: 0.1, rsh: 3 } });
    expect(runInterpretation(cfg(2.4), curves).notes).toEqual(['simandoux_n_ignored']);
    expect(runInterpretation(cfg(2), curves).notes).toEqual([]);
  });
});

describe('water quality', () => {
  it('EC = 1000/Rw and its inverse; normalisation to 25 °C is the identity at 25 °C', () => {
    const r = rng(9);
    for (let i = 0; i < 100; i++) { const rw = between(r, 0.05, 100); expect(1000 / rwToEc(rw)).toBeCloseTo(rw, 9); expect(ec25FromRw(rw, 25, { method: 'arps' }).value).toBeCloseTo(rwToEc(rw) * 10, 7); }
  });
  it('local calibration recovers the generating relation from noisy data within the noise level', () => {
    const r = rng(10);
    const pairs = Array.from({ length: 60 }, () => { const ec = between(r, 200, 8000); return { ec25: ec, tds: 0.66 * ec * (1 + between(r, -0.03, 0.03)) }; });
    const f = fitCalibration(pairs, 'factor');
    expect(f.params.k).toBeGreaterThan(0.64); expect(f.params.k).toBeLessThan(0.68); expect(f.relRmse).toBeLessThan(0.03);
    const lin = fitCalibration(pairs, 'linear'); expect(lin.r2).toBeGreaterThan(0.99);
    expect(fitCalibration(pairs, 'power').params.d).toBeGreaterThan(0.95);
  });
  it('TDS estimate grows when Rw falls (more saline water) and the NaCl equivalent agrees in direction', () => {
    const cal = manualCalibration({ k: 0.65, source: 's' });
    let prev = 0, prevN = 0;
    for (const rw of [20, 10, 5, 2, 1, 0.5, 0.2]) { const e = estimateTds({ rw, tC: 25, normalization: { method: 'arps' }, calibration: cal }); expect(e.tds).toBeGreaterThan(prev); prev = e.tds; expect(e.naclPpm).toBeGreaterThan(prevN); prevN = e.naclPpm; }
  });
  it('NaCl-equivalent salinity is within 20 % of approximate rounded chart readings (informational; verify against your chartbook)', () => {
    const t75 = fToC(75);
    for (const [rw, ppm] of [[1.1, 5000], [0.58, 10000], [0.28, 20000], [0.12, 50000]]) { const v = naclEquivalent(rw, t75).value; expect(Math.abs(v - ppm) / ppm).toBeLessThan(0.2); }
  });
  it('salinity classes are exhaustive and ordered', () => {
    let rank = -1; const order = ['fresh', 'slightly_saline', 'moderately_saline', 'very_saline', 'brine'];
    for (const v of [10, 999, 1000, 1001, 2999, 3001, 9999, 10001, 34999, 35001, 1e6]) { const k = order.indexOf(classifySalinity(v)); expect(k).toBeGreaterThanOrEqual(rank); rank = k; }
  });
});

describe('unit conversions', () => {
  it('every conversion is reversible and transitive across all groups', () => {
    const r = rng(11);
    for (const [g, def] of Object.entries(UNIT_GROUPS)) {
      const units = Object.keys(def.units);
      for (let i = 0; i < 40; i++) {
        const [a, b, c] = [units[Math.floor(r() * units.length)], units[Math.floor(r() * units.length)], units[Math.floor(r() * units.length)]], v = between(r, 0.1, 1000);
        expect(convert(convert(v, g, a, b), g, b, a)).toBeCloseTo(v, 8);
        expect(convert(convert(v, g, a, b), g, b, c)).toBeCloseTo(convert(v, g, a, c), 8);
      }
    }
  });
  it('well-known constants', () => {
    expect(convert(1, 'depth', 'ft', 'm')).toBeCloseTo(0.3048, 12); expect(convert(1, 'length', 'in', 'mm')).toBeCloseTo(25.4, 12);
    expect(convert(1, 'conductivity', 'S/m', 'uS/cm')).toBeCloseTo(10000, 8); expect(convert(100, 'temperature', 'degC', 'degF')).toBeCloseTo(212, 10);
    expect(convert(0, 'temperature', 'degC', 'K')).toBeCloseTo(273.15, 10); expect(convert(1, 'tds', 'g/L', 'mg/L')).toBe(1000);
  });
});

describe('digitisation calibration', () => {
  it('recovers an arbitrary affine and a logarithmic axis from exact reference points', () => {
    const r = rng(12);
    for (let i = 0; i < 200; i++) {
      const b = between(r, 0.01, 2), a = between(r, -50, 50), p = [between(r, 0, 300), between(r, 400, 900)];
      const cal = calibrateDepth(p.map((py) => ({ py, depth: a + b * py })));
      const q = between(r, 0, 1000); expect(pixelToDepth(cal, q)).toBeCloseTo(a + b * q, 6);
      const lo = between(r, 0.1, 1), hi = lo * 10 ** between(r, 1, 4), tc = calibrateTrack([{ px: 100, value: lo }, { px: 400, value: hi }], 'log');
      expect(pixelToValue(tc, 100)).toBeCloseTo(lo, 8); expect(pixelToValue(tc, 400)).toBeCloseTo(hi, 6); expect(pixelToValue(tc, 250)).toBeCloseTo(Math.sqrt(lo * hi), 6);
    }
  });
  it('extra reference points never make a perfect calibration worse', () => {
    const pts = [0, 200, 450, 800].map((py) => ({ py, depth: 10 + 0.05 * py }));
    const c = calibrateDepth(pts); expect(c.residualPx).toBeLessThan(1e-9); expect(c.warnings).toEqual([]);
  });
});

describe('importers (fuzz and round trip)', () => {
  it('CSV writer → parser round trip for random text including quotes, commas, semicolons and Arabic', () => {
    const r = rng(13);
    const alphabet = ['a', 'b', 'ع', 'ر', ',', ';', '"', ' ', '1', '.', '\n'];
    for (let i = 0; i < 200; i++) {
      const cols = 1 + Math.floor(r() * 4), rows = 1 + Math.floor(r() * 5);
      const mk = () => Array.from({ length: 1 + Math.floor(r() * 6) }, () => alphabet[Math.floor(r() * alphabet.length)]).join('');
      const data = Array.from({ length: rows }, () => Array.from({ length: cols }, mk));
      const csv = toCsv(data.map((row) => Object.fromEntries(row.map((v, j) => [String(j), v]))), data[0].map((_, j) => ({ key: String(j), label: `h${j}` })));
      const parsed = parseDelimited(csv, ',');
      expect(parsed[0]).toEqual(Array.from({ length: cols }, (_, j) => `h${j}`));
      data.forEach((row, ri) => expect(parsed[ri + 1]).toEqual(row.map((v) => v.replace(/\r/g, ''))));
    }
  });
  it('number parsing round-trips plain numbers in both decimal conventions and never accepts garbage', () => {
    const r = rng(14);
    for (let i = 0; i < 500; i++) { const v = between(r, -1e5, 1e5); expect(parseNumber(String(v))).toBeCloseTo(v, 6); expect(parseNumber(String(v).replace('.', ','), ',')).toBeCloseTo(v, 6); }
    for (const g of ['abc', '1.2.3.4', '--5', '1e', '', ' ', '12abc', 'NaN', 'Infinity']) expect(parseNumber(g), g).toBeNaN();
  });
  it('delimiter detection is correct for generated tables with each delimiter', () => {
    for (const d of [',', ';', '\t', '|']) {
      const text = ['a', 'b', 'c'].join(d) + '\n' + Array.from({ length: 10 }, (_, i) => [i, i * 2, i * 3].join(d)).join('\n');
      expect(detectDelimiter(text).delimiter).toBe(d);
    }
  });
});

describe('interval statistics', () => {
  it('half-open intervals partition the samples: sums over adjacent intervals equal the total', () => {
    const r = rng(15);
    const depth = Array.from({ length: 300 }, (_, i) => i * 0.37), vals = depth.map(() => between(r, 1, 100));
    const cuts = [0, 20, 55.5, 80, 111]; let n = 0, s = 0;
    for (let i = 0; i < cuts.length - 1; i++) { const st = statsInInterval(depth, vals, cuts[i], cuts[i + 1]); n += st.n; s += st.mean * st.n; }
    const all = statsInInterval(depth, vals, 0, 111);
    expect(n).toBe(all.n); expect(s / n).toBeCloseTo(all.mean, 9);
  });
  it('geometric mean of resistivities is scale-equivariant', () => {
    const depth = [0, 1, 2, 3], v = [2, 8, 32, 128];
    expect(statsInInterval(depth, v.map((x) => x * 10), 0, 4, 'geo').mean).toBeCloseTo(statsInInterval(depth, v, 0, 4, 'geo').mean * 10, 9);
  });
});
