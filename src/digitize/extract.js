// Offline curve extraction (colour tracing) and gridline detection. Pure JS on ImageData-like
// objects ({data:Uint8ClampedArray RGBA, width, height}). No external CV library required.

const dist = (d, i, c) => Math.hypot(d[i] - c[0], d[i + 1] - c[1], d[i + 2] - c[2]);

/** Colour at pixel (x,y) as [r,g,b]. */
export const pixelColor = (img, x, y) => {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

/**
 * Trace a curve of a known colour row by row.
 * opts: { color:[r,g,b], tolerance (0..441), roi:{x0,x1,y0,y1}, stepY (px), maxJump (px per step, default 40) }
 * Returns { points:[{px,py,conf}], stats:{rows, matched, coverage, jumps, reliable, reasons[]} }.
 * Rows with no matching pixel produce NO point (gaps are never interpolated).
 */
export function extractCurve(img, opts) {
  const { color, tolerance = 60, roi, stepY = 2, maxJump = 40 } = opts;
  const x0 = Math.max(0, Math.floor(roi?.x0 ?? 0)), x1 = Math.min(img.width - 1, Math.ceil(roi?.x1 ?? img.width - 1));
  const y0 = Math.max(0, Math.floor(roi?.y0 ?? 0)), y1 = Math.min(img.height - 1, Math.ceil(roi?.y1 ?? img.height - 1));
  const points = [];
  let rows = 0, matched = 0, jumps = 0, prevX = null, firstRow = -1, lastRow = -1;

  for (let y = y0; y <= y1; y += stepY) {
    rows++;
    // collect runs of matching pixels along the row
    const runs = [];
    let start = -1;
    for (let x = x0; x <= x1 + 1; x++) {
      const hit = x <= x1 && dist(img.data, (y * img.width + x) * 4, color) <= tolerance;
      if (hit && start < 0) start = x;
      if (!hit && start >= 0) { runs.push([start, x - 1]); start = -1; }
    }
    if (!runs.length) continue;
    matched++;
    if (firstRow < 0) firstRow = rows;
    lastRow = rows;
    const centres = runs.map(([a, b]) => ({ c: (a + b) / 2, w: b - a + 1 }));
    let pick;
    if (prevX == null) pick = centres.reduce((m, r) => (r.w > m.w ? r : m)); // widest run to start
    else pick = centres.reduce((m, r) => (Math.abs(r.c - prevX) < Math.abs(m.c - prevX) ? r : m));
    if (prevX != null && Math.abs(pick.c - prevX) > maxJump) jumps++;
    // confidence: 1 for a single clear run, lower when several candidate runs compete
    // Continuous image coordinates: pixel i covers [i, i+1), so its centre is i + 0.5 (same convention as clicks).
    points.push({ px: pick.c + 0.5, py: y + 0.5, conf: Number((1 / runs.length).toFixed(2)) });
    prevX = pick.c;
  }

  // Coverage is measured between the first and last matched row, so empty margins above/below the curve do not count against it, but gaps inside do.
  const span = firstRow < 0 ? 0 : lastRow - firstRow + 1;
  const coverage = span ? matched / span : 0;
  const reasons = [];
  if (coverage < 0.6) reasons.push('low_coverage');
  if (matched && jumps / matched > 0.05) reasons.push('many_jumps');
  if (points.length && points.filter((p) => p.conf < 0.5).length / points.length > 0.3) reasons.push('ambiguous');
  return { points, stats: { rows, matched, coverage, jumps, reliable: reasons.length === 0, reasons } };
}

/**
 * Detect horizontal gridlines/ticks: rows where a large fraction of pixels in [x0,x1] is dark.
 * Returns { lines:[y...], spacing (median spacing or null) }. This finds line POSITIONS only;
 * the depth values must still be entered by the user (no OCR).
 */
export function detectHorizontalLines(img, { x0 = 0, x1 = img.width - 1, darkThreshold = 140, minFrac = 0.6 } = {}) {
  const hits = [];
  const w = x1 - x0 + 1;
  for (let y = 0; y < img.height; y++) {
    let dark = 0;
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.width + x) * 4;
      if ((img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3 < darkThreshold) dark++;
    }
    if (dark / w >= minFrac) hits.push(y);
  }
  // merge adjacent rows into one line (centre)
  const lines = [];
  let g = [];
  for (const y of hits) {
    if (g.length && y - g[g.length - 1] > 1) { lines.push((g[0] + g[g.length - 1]) / 2 + 0.5); g = []; }
    g.push(y);
  }
  if (g.length) lines.push((g[0] + g[g.length - 1]) / 2 + 0.5); // +0.5: continuous coordinates
  let spacing = null;
  if (lines.length > 2) {
    const d = lines.slice(1).map((v, i) => v - lines[i]).sort((a, b) => a - b);
    spacing = d[d.length >> 1];
  }
  return { lines, spacing };
}

/** Snap v to the nearest candidate within `tol`, else return v. */
export function snapTo(v, candidates, tol = 6) {
  let best = null;
  for (const c of candidates) if (Math.abs(c - v) <= tol && (best == null || Math.abs(c - v) < Math.abs(best - v))) best = c;
  return best ?? v;
}
