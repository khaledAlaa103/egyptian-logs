// Statistics of log samples inside a depth interval. Pure JS.
// Intervals are half-open [top, bottom) so a boundary sample is never counted twice.

/**
 * mode 'arith' (arithmetic mean) or 'geo' (geometric mean; right for resistivity).
 * null/NaN samples are ignored. Returns { n, mean, min, max } or { n: 0 } when nothing falls inside.
 */
export function statsInInterval(depth, values, top, bottom, mode = 'arith') {
  let n = 0, sum = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i];
    if (d < top) continue;
    if (d >= bottom) break; // depth is sorted ascending
    const v = values[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (mode === 'geo' && v <= 0) continue;
    sum += mode === 'geo' ? Math.log10(v) : v;
    min = Math.min(min, v); max = Math.max(max, v); n++;
  }
  if (!n) return { n: 0 };
  return { n, mean: mode === 'geo' ? 10 ** (sum / n) : sum / n, min, max };
}

/** Median sampling interval of a depth array (Infinity if fewer than two samples). */
export function sampling(depth) {
  if (depth.length < 2) return Infinity;
  const d = [];
  for (let i = 1; i < depth.length; i++) d.push(depth[i] - depth[i - 1]);
  d.sort((a, b) => a - b);
  return d[d.length >> 1] || Infinity;
}
