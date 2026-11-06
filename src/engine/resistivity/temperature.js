// Temperature conversions and corrections for fluid resistivity/conductivity. Pure JS.

export const cToF = (c) => c * 9 / 5 + 32;
export const fToC = (f) => (f - 32) * 5 / 9;

/**
 * Arps correction of resistivity from T1 to T2 (both in °C unless unit='F').
 * R2 = R1 · (T1 + k) / (T2 + k), k = 21.5 (°C) or 6.77 (°F).
 */
export function arps(r1, t1, t2, unit = 'C') {
  const k = unit === 'F' ? 6.77 : 21.5;
  if (!(r1 > 0) || !Number.isFinite(t1) || !Number.isFinite(t2)) return NaN;
  if (t1 + k <= 0 || t2 + k <= 0) return NaN;
  return r1 * (t1 + k) / (t2 + k);
}

/**
 * Normalise a conductivity measured at T to a reference temperature (default 25 °C):
 * EC_ref = EC_T / (1 + alpha · (T − Tref)). alpha MUST be supplied by the caller (no hidden default).
 */
export function normalizeConductivity(ec, t, alpha, tRef = 25) {
  if (!Number.isFinite(ec) || !Number.isFinite(t) || !(alpha > 0)) return NaN;
  return ec / (1 + alpha * (t - tRef));
}

/** Formation temperature profile at depth (m). cfg: {method:'constant'|'gradient'|'curve', ...}. */
export function temperatureAt(cfg, depth, curveSampler) {
  if (!cfg) return null;
  if (cfg.method === 'constant') return Number.isFinite(cfg.value) ? cfg.value : null;
  if (cfg.method === 'gradient') {
    return Number.isFinite(cfg.surface) && Number.isFinite(cfg.gradient) ? cfg.surface + (cfg.gradient / 100) * depth : null;
  }
  if (cfg.method === 'curve') return curveSampler ? curveSampler(depth) : null;
  return null;
}
