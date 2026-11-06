// True-resistivity (Rt) handling and water-resistivity (Rw) methods. Pure JS.
// Rule: apparent resistivity (Ra) is NEVER silently used as Rt. Every route to Rt either needs
// explicit user-declared information or returns { status: 'insufficient-inputs' }.
import { arps, cToF, fToC } from './temperature.js';

export const INSUFFICIENT = 'insufficient-inputs';
const missing = (...keys) => ({ status: INSUFFICIENT, value: null, missing: keys });

/**
 * Rt from an apparent reading.
 * method 'none'      -> no Rt (returns insufficient: apparent stays apparent)
 * method 'direct'    -> requires cond = {thickBed, invasionNegligible, boreholeNegligible} all true
 * method 'geometric' -> Rt = (Ra − J·Rxo)/(1 − J)   (needs rxo and J in [0,1))
 * method 'factor'    -> Rc = K·Ra                    (needs factor K and its source)
 */
export function computeRt(method, p) {
  const { ra } = p;
  if (!(ra > 0)) return missing('ra');
  switch (method) {
    case 'direct': {
      const c = p.cond || {};
      const need = ['thickBed', 'invasionNegligible', 'boreholeNegligible'].filter((k) => c[k] !== true);
      return need.length ? missing(...need) : { status: 'estimated', value: ra, method: 'rt_direct' };
    }
    case 'geometric': {
      if (!(p.rxo > 0)) return missing('rxo');
      if (!Number.isFinite(p.J)) return missing('J');
      if (p.J < 0 || p.J >= 1) return { status: INSUFFICIENT, value: null, missing: ['J'], reason: 'J_out_of_range' };
      const rt = (ra - p.J * p.rxo) / (1 - p.J);
      if (!(rt > 0)) return { status: INSUFFICIENT, value: null, missing: [], reason: 'rt_nonpositive' };
      return { status: 'corrected', value: rt, method: 'rt_geometric' };
    }
    case 'factor': {
      if (!(p.factor > 0)) return missing('factor');
      if (!p.factorSource || !String(p.factorSource).trim()) return missing('factorSource');
      return { status: 'corrected', value: ra * p.factor, method: 'rt_factor' };
    }
    default:
      return { status: INSUFFICIENT, value: null, missing: ['correctionMethod'], reason: 'rt_none' };
  }
}

/** Rw at depth temperature from a reference value (Arps). */
export function rwAtTemperature(rwRef, tRefC, tC) {
  return arps(rwRef, tRefC, tC, 'C');
}

/** SP constant K (mV per decade) for a formation temperature in °C: K = 65 + 0.24·T. */
export const spK = (tC) => 65 + 0.24 * tC;

/**
 * Equivalent mud-filtrate resistivity at formation temperature.
 * If Rmfe is given it is used as is; otherwise Rmf (at rmfTempC) is converted to formation temperature
 * and Rmfe = 0.85·Rmf, valid only when Rmf at 75 °F is > 0.1 Ω·m (else a chart is required).
 */
export function rmfeAt({ rmfe, rmfeTempC, rmf, rmfTempC }, tFormC) {
  if (Number.isFinite(rmfe) && rmfe > 0) {
    if (!Number.isFinite(rmfeTempC)) return missing('rmfeTempC');
    return { status: 'estimated', value: arps(rmfe, rmfeTempC, tFormC), via: 'given' };
  }
  if (!(rmf > 0)) return missing('rmf');
  if (!Number.isFinite(rmfTempC)) return missing('rmfTempC');
  const rmf75 = arps(rmf, rmfTempC, fToC(75));
  if (!(rmf75 > 0.1)) return { status: INSUFFICIENT, value: null, missing: [], reason: 'rmfe_chart_needed' };
  return { status: 'estimated', value: 0.85 * arps(rmf, rmfTempC, tFormC), via: 'rmf085' };
}

/**
 * Rw from SSP. ssp in mV (negative against a permeable water-bearing bed), tFormC formation temp.
 * Returns Rw at formation temperature (Ω·m).
 */
export function rwFromSP({ ssp, tFormC, rmfeFormTemp }) {
  if (!Number.isFinite(ssp)) return missing('ssp');
  if (!Number.isFinite(tFormC)) return missing('temperature');
  if (!(rmfeFormTemp > 0)) return missing('rmfe');
  if (ssp >= 0) return { status: INSUFFICIENT, value: null, missing: [], reason: 'ssp_not_negative' };
  const K = spK(tFormC);
  const rwe = rmfeFormTemp * 10 ** (ssp / K);
  // Rwe -> Rw (Bateman & Konen fit); the fit works at 75 °F values and temperature in °F
  const tF = cToF(tFormC);
  if (!(tF > 50.8)) return { status: INSUFFICIENT, value: null, missing: [], reason: 'temperature_out_of_range' };
  const rwe75 = arps(rwe, tFormC, fToC(75));
  if (!(rwe75 > 0.12)) return { status: INSUFFICIENT, value: null, missing: [], reason: 'rwe_chart_needed', rwe };
  const num = rwe75 + 0.131 * 10 ** (1 / Math.log10(tF / 19.9) - 2);
  const den = -0.5 * rwe75 + 10 ** (0.0426 / Math.log10(tF / 50.8));
  if (!(den > 0)) return { status: INSUFFICIENT, value: null, missing: [], reason: 'rwe_out_of_range' };
  const rw75 = num / den;
  return { status: 'estimated', value: arps(rw75, fToC(75), tFormC), rwe, K, method: 'rw_sp' };
}

/** Apparent water resistivity from Archie with Sw = 1: Rwa = Rt·φ^m / a. */
export function rwa(rt, phi, a, m) {
  if (!(rt > 0) || !(phi > 0) || !(a > 0) || !Number.isFinite(m)) return NaN;
  return (rt * phi ** m) / a;
}
