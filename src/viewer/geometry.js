// Pure geometry / data helpers for the multi-track log viewer. No DOM, no React.

export const DEPTH_COL_W = 62;
export const FORMATION_COL_W = 110;
export const MIN_TRACK_W = 60;

/** Fraction (0..1 inside the track) of value v for a linear or logarithmic scale. null if not drawable. */
export function xFrac(v, scale, min, max) {
  if (!Number.isFinite(v)) return null;
  if (scale === 'log') {
    if (v <= 0 || min <= 0 || max <= 0 || max === min) return null;
    return (Math.log10(v) - Math.log10(min)) / (Math.log10(max) - Math.log10(min));
  }
  if (max === min) return null;
  return (v - min) / (max - min);
}

/** "Nice" major tick step (1, 2, 5 × 10^n) so that ~targetCount ticks fit in span. */
export function niceStep(span, targetCount = 8) {
  const raw = span / Math.max(1, targetCount);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

/** Depth ticks inside [top,bottom]: { major:[], minor:[] } (minor = step/5 lines, excluding majors). */
export function depthTicks(top, bottom, targetCount = 8) {
  const step = niceStep(bottom - top, targetCount);
  const minorStep = step / 5;
  const major = [], minor = [];
  const eps = step * 1e-9;
  for (let d = Math.ceil(top / minorStep - 1e-9) * minorStep; d <= bottom + eps; d += minorStep) {
    const r = Math.round(d / step) * step;
    const isMajor = Math.abs(d - r) < eps * 10;
    (isMajor ? major : minor).push(Number(d.toPrecision(12)));
  }
  return { major, minor, step };
}

/** Decade lines for a log track: { major: [10^n...], minor: [2..9 × 10^n] } within [min,max]. */
export function logTicks(min, max) {
  const major = [], minor = [];
  if (!(min > 0) || !(max > min)) return { major, minor };
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (let k = 1; k <= 9; k++) {
      const v = k * 10 ** e;
      if (v < min * (1 - 1e-9) || v > max * (1 + 1e-9)) continue;
      (k === 1 ? major : minor).push(v);
    }
  }
  return { major, minor };
}

/** Linear value ticks for a track with `divisions` equal parts. */
export function linearTicks(min, max, divisions = 5) {
  return Array.from({ length: divisions + 1 }, (_, i) => min + ((max - min) * i) / divisions);
}

function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

export function medianSpacing(depth) {
  if (depth.length < 2) return Infinity;
  const d = [];
  for (let i = 1; i < depth.length; i++) d.push(depth[i] - depth[i - 1]);
  d.sort((a, b) => a - b);
  return d[d.length >> 1] || Infinity;
}

/**
 * Value at a given depth by linear interpolation. Returns null outside the data range or when the
 * depth falls inside a data gap (> gapFactor × median sampling interval): gaps are never bridged.
 */
export function valueAt(depth, values, d, medianDz = medianSpacing(depth), gapFactor = 5) {
  const n = depth.length;
  if (!n || d < depth[0] || d > depth[n - 1]) return null;
  const i = lowerBound(depth, d);
  if (depth[i] === d) return values[i];
  const d0 = depth[i - 1], d1 = depth[i];
  if (d1 - d0 > gapFactor * medianDz) return null;
  const t = (d - d0) / (d1 - d0);
  return values[i - 1] + t * (values[i] - values[i - 1]);
}

/**
 * Reduce points inside [top,bottom] for drawing (+1 neighbour each side for line continuity).
 * When there are more than 2 points per pixel row they are averaged per row (mean depth / mean value).
 */
export function decimate(depth, values, top, bottom, rows) {
  const n = depth.length;
  if (!n) return [];
  let a = lowerBound(depth, top), b = lowerBound(depth, bottom);
  a = Math.max(0, a - 1);
  b = Math.min(n - 1, b);
  const count = b - a + 1;
  if (count <= rows * 2 || rows < 1) {
    const out = [];
    for (let i = a; i <= b; i++) out.push([depth[i], values[i]]);
    return out;
  }
  const span = bottom - top;
  const buckets = new Map();
  for (let i = a; i <= b; i++) {
    const k = Math.max(-1, Math.min(rows, Math.floor(((depth[i] - top) / span) * rows)));
    const e = buckets.get(k);
    if (e) { e.d += depth[i]; e.v += values[i]; e.n++; } else buckets.set(k, { d: depth[i], v: values[i], n: 1 });
  }
  return [...buckets.entries()].sort((x, y) => x[0] - y[0]).map(([, e]) => [e.d / e.n, e.v / e.n]);
}

/** Clamp a depth window to [min,max] keeping its span when possible. */
export function clampWindow(top, bottom, min, max, minSpan = 0.5) {
  let span = Math.max(minSpan, bottom - top);
  span = Math.min(span, max - min);
  let t = top;
  if (t < min) t = min;
  if (t + span > max) t = max - span;
  return { top: t, bottom: t + span };
}

/** Zoom by factor (>1 zooms in) keeping the depth under `anchor` fixed. */
export function zoomWindow(view, anchor, factor, min, max, minSpan = 0.5) {
  const span = (view.bottom - view.top) / factor;
  const rel = (anchor - view.top) / (view.bottom - view.top);
  const top = anchor - rel * span;
  return clampWindow(top, top + span, min, max, minSpan);
}

export function panWindow(view, delta, min, max) {
  return clampWindow(view.top + delta, view.bottom + delta, min, max, view.bottom - view.top);
}

/** Header height from the largest number of curves in any track. */
export function headerHeight(tracks) {
  const maxCurves = Math.max(1, ...tracks.map((t) => t.curves.filter((c) => c.visible !== false).length));
  return 30 + maxCurves * 30 + 6;
}

/** Column geometry in CSS px. rtl mirrors the whole layout. */
export function layoutColumns(tracks, totalWidth, { showFormations = true } = {}) {
  let x = DEPTH_COL_W;
  const cols = tracks.map((t, i) => { const c = { x, w: t.width, index: i }; x += t.width; return c; });
  const formation = showFormations ? { x, w: Math.max(FORMATION_COL_W, totalWidth - x) } : null;
  return { depthAxis: { x: 0, w: DEPTH_COL_W }, tracks: cols, formation, contentWidth: x + (formation ? formation.w : 0) };
}

/** If (px) is within `tol` of a track's right edge, return that track's index, else -1. */
export function hitDivider(cols, px, tol = 5) {
  for (const c of cols.tracks) if (Math.abs(px - (c.x + c.w)) <= tol) return c.index;
  return -1;
}

export const depthToY = (d, view, bodyTop, bodyH) => bodyTop + ((d - view.top) / (view.bottom - view.top)) * bodyH;
export const yToDepth = (y, view, bodyTop, bodyH) => view.top + ((y - bodyTop) / bodyH) * (view.bottom - view.top);

/** Format a number compactly for axis labels. */
export function fmtNum(v) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 10000 || a < 0.01) return v.toExponential(0).replace('e+', 'e');
  return Number(v.toPrecision(4)).toString();
}
