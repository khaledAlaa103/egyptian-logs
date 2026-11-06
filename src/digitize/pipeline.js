// Converts a digitisation session (pixels + calibration) into scientific readings, with full
// traceability: every output point keeps its working-image pixel, its original-image pixel,
// the method (manual/auto) and flags. Pure JS.
import { calibrateDepth, calibrateTrack, pixelToDepth, pixelToValue, isExtrapolated, resample } from './calibration.js';
import { workingToOriginal } from './transform.js';
import { getLog, validateCurveValue, acceptedUnitsOf } from '../registry/logRegistry.js';
import { toCanonical } from '../engine/units/units.js';

export const newSession = () => ({
  processing: { rotation: 0, crop: null },
  depthCal: { unit: 'm', points: [] },
  tracks: [],
  curves: [],
  resample: { enabled: false, step: 0.5 },
});

let seq = 0;
export const uid = (p = 'x') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Depth calibration with reference depths converted to metres. */
export function depthCalibrationOf(session) {
  const f = session.depthCal.unit === 'ft' ? 0.3048 : 1;
  const pts = session.depthCal.points.map((p) => ({ py: p.py, depth: Number(p.depth) * f }));
  const cal = calibrateDepth(pts.filter((p) => p.depth === p.depth)); // drop NaN
  return cal;
}

export const trackCalibrationOf = (track) =>
  calibrateTrack(track.points.map((p) => ({ px: p.px, value: Number(p.value) })), track.scale);

/**
 * Compute readings for one digitised curve.
 * Returns { points:[{depth,value,px,py,ox,oy,method,flags}], issues:[{code,...}], blocking:[codes] }.
 */
export function computeCurve(session, curve, imageSize, custom = []) {
  const issues = [], blocking = [];
  const def = getLog(curve.curveId, custom);
  const track = session.tracks.find((t) => t.id === curve.trackId);
  const dcal = depthCalibrationOf(session);
  if (!dcal.ok) blocking.push('depth_calibration');
  if (!track) blocking.push('no_track');
  const tcal = track ? trackCalibrationOf(track) : null;
  if (track && !tcal.ok) blocking.push('track_calibration');
  if (!def || def.kind !== 'curve') blocking.push('no_curve');
  else if (track && !acceptedUnitsOf(def).includes(track.unit)) blocking.push('unit_mismatch');
  if (blocking.length) return { points: [], issues, blocking };

  const dRange = [Math.min(...session.depthCal.points.map((p) => p.py)), Math.max(...session.depthCal.points.map((p) => p.py))];
  const out = [];
  for (const p of curve.points) {
    const depth = pixelToDepth(dcal, p.py);
    const raw = pixelToValue(tcal, p.px);
    const canon = def.group ? toCanonical(raw, def.group, track.unit) : raw;
    const bad = validateCurveValue(def, canon);
    if (bad || depth < 0) { issues.push({ code: bad || 'depth_negative', px: p.px, py: p.py, value: raw }); continue; }
    const flags = [];
    if (isExtrapolated(dRange, p.py)) flags.push('depth_extrapolated');
    if (isExtrapolated(tcal.pxRange, p.px)) flags.push('value_extrapolated');
    const o = workingToOriginal(p.px, p.py, imageSize.W, imageSize.H, session.processing);
    out.push({ depth, value: canon, px: p.px, py: p.py, ox: o.ox, oy: o.oy, method: p.method || 'manual', flags });
  }
  out.sort((a, b) => a.depth - b.depth);
  // duplicate depths (identical y): keep the first, report
  const dedup = [];
  for (const p of out) {
    if (dedup.length && Math.abs(p.depth - dedup[dedup.length - 1].depth) < 1e-9) { issues.push({ code: 'depth_duplicate', py: p.py }); continue; }
    dedup.push(p);
  }
  if (dedup.some((p) => p.flags.length)) issues.push({ code: 'extrapolated', n: dedup.filter((p) => p.flags.length).length });
  return {
    points: dedup, issues, blocking,
    quality: { depthResolution: dcal.resolution, depthResidualPx: dcal.residualPx, valuePerPixel: tcal.perPixel, valueResidualPx: tcal.residualPx },
    calibration: { depth: dcal.fit, track: tcal.fit, scale: tcal.scale, unit: track.unit },
  };
}

/** Apply optional regular resampling for export. */
export function exportPoints(result, rs) {
  if (!rs?.enabled) return result.points.map((p) => ({ depth: p.depth, value: p.value }));
  return resample(result.points, Number(rs.step));
}
