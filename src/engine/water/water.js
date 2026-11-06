// Water quality engine: EC / Rw / TDS / NaCl-equivalent salinity. Pure JS.
//
// Rules enforced here:
//  * There is NO conversion from formation resistivity (Rt) to TDS. Only Rw (resistivity of the
//    formation WATER) or a measured water EC can enter these functions.
//  * Every empirical parameter (temperature coefficient, EC->TDS relation) is supplied by the caller
//    and comes with a recorded source; nothing is defaulted.
//  * Direct (sample) and indirect (geophysical) results are labelled differently by `basis`.
import { arps } from '../resistivity/temperature.js';

export const INSUFFICIENT = 'insufficient-inputs';
const need = (...m) => ({ status: INSUFFICIENT, value: null, missing: m });
const pos = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
const num = (x) => typeof x === 'number' && Number.isFinite(x);

// ---------------- EC <-> Rw ----------------
/** EC (mS/m) from resistivity (Ω·m) at the SAME temperature: EC = 1000 / R. */
export const rwToEc = (rw) => (pos(rw) ? 1000 / rw : NaN);
/** Resistivity (Ω·m) from EC (mS/m). */
export const ecToRw = (ecMSm) => (pos(ecMSm) ? 1000 / ecMSm : NaN);

export const mSmToUScm = (v) => v * 10; // 1 mS/m = 10 µS/cm
export const uScmToMSm = (v) => v / 10;

// ---------------- temperature normalisation to 25 °C ----------------
/**
 * Normalise a conductivity (µS/cm) measured at tC to tRef.
 * method 'alpha': EC_ref = EC / (1 + alpha·(T − Tref))   (alpha required)
 * method 'arps' : applied to the resistivity (R = 1/EC) with the Arps relation (NaCl solutions).
 */
export function normalizeEc(ecUScm, tC, { method, alpha, tRef = 25 } = {}) {
  if (!pos(ecUScm)) return need('ec');
  if (!num(tC)) return need('temperature');
  if (method === 'alpha') {
    if (!pos(alpha)) return need('alpha');
    return { value: ecUScm / (1 + alpha * (tC - tRef)), method: 'ec_normalize_alpha' };
  }
  if (method === 'arps') {
    const r = arps(1 / ecUScm, tC, tRef);
    return Number.isFinite(r) ? { value: 1 / r, method: 'ec_normalize_arps' } : { status: INSUFFICIENT, value: null, missing: [], reason: 'temperature_out_of_range' };
  }
  return need('normalizationMethod');
}

/** EC25 (µS/cm) from the water resistivity Rw (Ω·m) at formation/measurement temperature tC. */
export function ec25FromRw(rw, tC, norm) {
  if (!pos(rw)) return need('rw');
  const ecT = mSmToUScm(rwToEc(rw)); // µS/cm at tC
  return normalizeEc(ecT, tC, norm);
}

// ---------------- EC25 -> TDS calibrations ----------------
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

function stats(pairs, predict) {
  const y = pairs.map((p) => p.tds), yh = pairs.map((p) => predict(p.ec25));
  const sse = y.reduce((s, v, i) => s + (v - yh[i]) ** 2, 0);
  const my = mean(y), sst = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const rmse = Math.sqrt(sse / y.length);
  return { n: pairs.length, rmse, relRmse: rmse / my, r2: sst > 0 ? 1 - sse / sst : null, range: [Math.min(...pairs.map((p) => p.ec25)), Math.max(...pairs.map((p) => p.ec25))] };
}

/**
 * Fit a local calibration TDS = f(EC25) from pairs [{ec25 (µS/cm), tds (mg/L)}].
 * model: 'factor' (TDS = k·EC25), 'linear' (TDS = a + b·EC25), 'power' (TDS = c·EC25^d).
 */
export function fitCalibration(pairs, model) {
  const p = pairs.filter((x) => pos(x.ec25) && pos(x.tds));
  const warnings = [];
  const min = model === 'factor' ? 1 : 3;
  if (p.length < min) return { ok: false, errors: ['too_few_points'], needed: min, n: p.length };
  if (p.length < 5) warnings.push('few_points');
  let params, predict;
  if (model === 'factor') {
    const k = p.reduce((s, v) => s + v.ec25 * v.tds, 0) / p.reduce((s, v) => s + v.ec25 ** 2, 0);
    params = { k }; predict = (x) => k * x;
  } else if (model === 'linear') {
    const mx = mean(p.map((v) => v.ec25)), my = mean(p.map((v) => v.tds));
    const sxx = p.reduce((s, v) => s + (v.ec25 - mx) ** 2, 0);
    if (sxx === 0) return { ok: false, errors: ['no_spread'], n: p.length };
    const b = p.reduce((s, v) => s + (v.ec25 - mx) * (v.tds - my), 0) / sxx, a = my - b * mx;
    params = { a, b }; predict = (x) => a + b * x;
  } else if (model === 'power') {
    const lx = p.map((v) => Math.log(v.ec25)), ly = p.map((v) => Math.log(v.tds));
    const mx = mean(lx), my = mean(ly);
    const sxx = lx.reduce((s, v) => s + (v - mx) ** 2, 0);
    if (sxx === 0) return { ok: false, errors: ['no_spread'], n: p.length };
    const d = lx.reduce((s, v, i) => s + (v - mx) * (ly[i] - my), 0) / sxx, c = Math.exp(my - d * mx);
    params = { c, d }; predict = (x) => c * x ** d;
  } else return { ok: false, errors: ['unknown_model'], n: p.length };
  const st = stats(p, predict);
  if (model === 'linear' && params.b <= 0) warnings.push('non_increasing');
  return { ok: true, model, params, ...st, warnings, source: 'local', pairs: p };
}

/** Manual (published / site-specific) factor. source is mandatory: it is recorded with every result. */
export function manualCalibration({ k, source, uncertaintyPct }) {
  if (!pos(k)) return { ok: false, errors: ['factor_missing'] };
  if (!source || !String(source).trim()) return { ok: false, errors: ['source_missing'] };
  return { ok: true, model: 'factor', params: { k }, n: 0, range: null, relRmse: Number.isFinite(uncertaintyPct) ? uncertaintyPct / 100 : null, warnings: [], source: 'manual', sourceText: String(source).trim() };
}

export function predictTds(cal, ec25UScm) {
  if (!cal?.ok) return need('calibration');
  if (!pos(ec25UScm)) return need('ec25');
  const q = cal.params;
  const v = cal.model === 'factor' ? q.k * ec25UScm : cal.model === 'linear' ? q.a + q.b * ec25UScm : q.c * ec25UScm ** q.d;
  const flags = [];
  if (cal.range) {
    const [lo, hi] = cal.range;
    if (ec25UScm < lo * 0.8 || ec25UScm > hi * 1.25) flags.push('outside_calibration_range');
  }
  if (!(v > 0)) return { status: INSUFFICIENT, value: null, missing: [], reason: 'tds_nonpositive' };
  return { value: v, flags, method: `tds_${cal.model}` };
}

// ---------------- NaCl-equivalent salinity ----------------
/**
 * Approximate NaCl-equivalent salinity (ppm) of a solution of resistivity rw (Ω·m) at tC:
 *   Rw75 = Rw at 75 °F (Arps);  C = 10^((3.562 − log10(Rw75 − 0.0123)) / 0.955)
 * An empirical chart fit for NaCl brines: NOT total dissolved solids of a natural water.
 */
export function naclEquivalent(rw, tC) {
  if (!pos(rw)) return need('rw');
  if (!num(tC)) return need('temperature');
  const rw75 = arps(rw, tC, (75 - 32) * 5 / 9);
  if (!(rw75 > 0.0123)) return { status: INSUFFICIENT, value: null, missing: [], reason: 'rw_too_low' };
  return { value: 10 ** ((3.562 - Math.log10(rw75 - 0.0123)) / 0.955), rw75, method: 'nacl_equiv' };
}

// ---------------- salinity classes (informational) ----------------
// Winslow & Kister (1956) scheme used by the USGS; limits in mg/L TDS.
export const SALINITY_CLASSES = [
  { id: 'fresh', max: 1000 }, { id: 'slightly_saline', max: 3000 }, { id: 'moderately_saline', max: 10000 },
  { id: 'very_saline', max: 35000 }, { id: 'brine', max: Infinity },
];
export function classifySalinity(tdsMgL) {
  if (!pos(tdsMgL)) return null;
  return SALINITY_CLASSES.find((c) => tdsMgL <= c.max).id;
}

// ---------------- full estimate for one interval ----------------
/**
 * Indirect (geophysical) estimate of TDS from the water resistivity Rw (Ω·m) at temperature tC.
 * Inputs: { rw, tC, normalization:{method,alpha}, calibration, rwUncertaintyPct }
 * Output: { status:'estimated', basis:'indirect', tds, ec25, rw, tC, class, uncertainty:{relPct|null, parts}, flags, trace }
 */
export function estimateTds({ rw, tC, normalization, calibration, rwUncertaintyPct }) {
  const ec = ec25FromRw(rw, tC, normalization);
  if (ec.status === INSUFFICIENT) return ec;
  const t = predictTds(calibration, ec.value);
  if (t.status === INSUFFICIENT) return t;
  // relative uncertainty: calibration scatter and the uncertainty of Rw combined in quadrature (EC ∝ 1/Rw)
  const uCal = calibration.relRmse, uRw = Number.isFinite(rwUncertaintyPct) ? rwUncertaintyPct / 100 : null;
  const parts = { calibration: uCal ?? null, rw: uRw };
  const known = [uCal, uRw].filter((x) => x != null);
  const rel = known.length === 2 ? Math.sqrt(uCal ** 2 + uRw ** 2) : null; // only quantified when both parts are known
  const flags = [...t.flags];
  if (calibration.source === 'manual' && calibration.relRmse == null) flags.push('calibration_uncertainty_unknown');
  const nacl = naclEquivalent(rw, tC);
  return {
    status: 'estimated', basis: 'indirect', tds: t.value, ec25: ec.value, rw, tC,
    class: classifySalinity(t.value), naclPpm: nacl.status === INSUFFICIENT ? null : nacl.value,
    uncertainty: { relPct: rel == null ? null : rel * 100, parts },
    flags,
    trace: {
      methods: ['rw_to_ec', ec.method, t.method, ...(nacl.method ? [nacl.method] : [])],
      inputs: { rw, tC, normalization: normalization.method, alpha: normalization.alpha ?? null },
      tRef: 25,
      calibration: { model: calibration.model, params: calibration.params, source: calibration.source, sourceText: calibration.sourceText ?? null, n: calibration.n, range: calibration.range, relRmse: calibration.relRmse ?? null },
    },
  };
}

/** Direct result from a water sample (laboratory TDS or an EC/Rw measurement). basis 'direct'. */
export function fromSample(s, normalization) {
  const out = { basis: 'direct', sampleId: s.sampleId, depthTop: s.depthTop, depthBottom: s.depthBottom ?? null };
  if (pos(s.tds)) out.tds = s.tds;
  let ec25 = null;
  if (pos(s.ecUScm) && num(s.ecTemp)) { const e = normalizeEc(s.ecUScm, s.ecTemp, normalization); if (e.status !== INSUFFICIENT) ec25 = e.value; else out.ecIssue = e.missing?.[0] || e.reason; }
  else if (pos(s.rw) && num(s.rwTemp)) { const e = ec25FromRw(s.rw, s.rwTemp, normalization); if (e.status !== INSUFFICIENT) ec25 = e.value; else out.ecIssue = e.missing?.[0] || e.reason; }
  out.ec25 = ec25;
  out.class = classifySalinity(out.tds);
  return out;
}
