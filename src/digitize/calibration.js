// Calibration math for log-image digitisation. Pure JS.
// Pixel positions are NEVER values: every conversion goes through a fitted calibration, and the
// fit quality (residual in pixels, resolution per pixel) is reported with the result.

/** Least-squares line y = a + b x. Returns null when x has no spread. */
export function fitLinear(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  if (sxx === 0) return null;
  const b = sxy / sxx, a = my - b * mx;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (ys[i] - (a + b * xs[i])) ** 2;
  return { a, b, n, rms: Math.sqrt(ss / n) };
}

const MIN_SEP_PX = 5;

/**
 * Vertical (depth) calibration. points: [{py, depth}] with depth already in metres.
 * Returns { ok, fit, errors:[], warnings:[], resolution } where depth(py) = fit.a + fit.b*py.
 */
export function calibrateDepth(points) {
  const errors = [], warnings = [];
  const pts = points.filter((p) => Number.isFinite(p.py) && Number.isFinite(p.depth));
  if (pts.length < 2) errors.push('need_two_points');
  else {
    const pys = pts.map((p) => p.py), ds = pts.map((p) => p.depth);
    if (Math.max(...pys) - Math.min(...pys) < MIN_SEP_PX) errors.push('points_too_close');
    if (Math.max(...ds) === Math.min(...ds)) errors.push('same_depth');
  }
  if (errors.length) return { ok: false, fit: null, errors, warnings, resolution: null };
  const fit = fitLinear(pts.map((p) => p.py), pts.map((p) => p.depth));
  if (!fit) return { ok: false, fit: null, errors: ['points_too_close'], warnings, resolution: null };
  if (fit.b <= 0) warnings.push('depth_decreasing');
  const residualPx = fit.rms / Math.abs(fit.b);
  if (pts.length > 2 && residualPx > 3) warnings.push('large_residual');
  return { ok: true, fit, errors, warnings, resolution: Math.abs(fit.b), residualPx };
}

/**
 * Horizontal calibration of one track. points: [{px, value}] (value in the track's unit);
 * scale 'linear' | 'log'. value(px) = a + b*px (linear) or 10^(a + b*px) (log).
 */
export function calibrateTrack(points, scale = 'linear') {
  const errors = [], warnings = [];
  const pts = points.filter((p) => Number.isFinite(p.px) && Number.isFinite(p.value));
  if (pts.length < 2) errors.push('need_two_points');
  else {
    const pxs = pts.map((p) => p.px), vs = pts.map((p) => p.value);
    if (Math.max(...pxs) - Math.min(...pxs) < MIN_SEP_PX) errors.push('points_too_close');
    if (Math.max(...vs) === Math.min(...vs)) errors.push('same_value');
    if (scale === 'log' && vs.some((v) => v <= 0)) errors.push('log_nonpositive');
  }
  if (errors.length) return { ok: false, fit: null, errors, warnings, scale };
  const ys = scale === 'log' ? pts.map((p) => Math.log10(p.value)) : pts.map((p) => p.value);
  const fit = fitLinear(pts.map((p) => p.px), ys);
  if (!fit) return { ok: false, fit: null, errors: ['points_too_close'], warnings, scale };
  const residualPx = fit.rms / Math.abs(fit.b);
  if (pts.length > 2 && residualPx > 3) warnings.push('large_residual');
  const pxRange = [Math.min(...pts.map((p) => p.px)), Math.max(...pts.map((p) => p.px))];
  return { ok: true, fit, errors, warnings, scale, residualPx, pxRange, perPixel: Math.abs(fit.b) };
}

export const pixelToDepth = (cal, py) => cal.fit.a + cal.fit.b * py;
export const pixelToValue = (cal, px) => {
  const y = cal.fit.a + cal.fit.b * px;
  return cal.scale === 'log' ? 10 ** y : y;
};

/** True when a pixel lies further than `tol` × span outside the reference points (extrapolation). */
export function isExtrapolated(range, p, tol = 0.5) {
  const span = range[1] - range[0];
  return p < range[0] - tol * span || p > range[1] + tol * span;
}

/** Optional resampling of digitised points to a regular depth step (linear interpolation, no gap bridging beyond maxGap). */
export function resample(points, step, maxGap = Infinity) {
  if (!(step > 0) || points.length < 2) return points.slice();
  const s = points.slice().sort((a, b) => a.depth - b.depth);
  const out = [];
  const start = Math.ceil(s[0].depth / step - 1e-9) * step;
  let j = 0;
  for (let d = start; d <= s[s.length - 1].depth + 1e-9; d += step) {
    while (j < s.length - 2 && s[j + 1].depth < d) j++;
    const p0 = s[j], p1 = s[j + 1];
    if (p1.depth - p0.depth > maxGap || d < p0.depth - 1e-9 || d > p1.depth + 1e-9) continue;
    const t = p1.depth === p0.depth ? 0 : (d - p0.depth) / (p1.depth - p0.depth);
    out.push({ depth: Number(d.toPrecision(12)), value: p0.value + t * (p1.value - p0.value) });
  }
  return out;
}
