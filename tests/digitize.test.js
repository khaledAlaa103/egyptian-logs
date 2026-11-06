import { describe, it, expect } from 'vitest';
import {
  fitLinear, calibrateDepth, calibrateTrack, pixelToDepth, pixelToValue, isExtrapolated, resample,
} from '../src/digitize/calibration.js';
import { rotatedSize, workingToOriginal, originalToWorking, workingSize } from '../src/digitize/transform.js';
import { extractCurve, detectHorizontalLines, snapTo, pixelColor } from '../src/digitize/extract.js';
import { newSession, computeCurve, exportPoints, depthCalibrationOf } from '../src/digitize/pipeline.js';
import { db } from '../src/db/db.js';
import { createProject, createWell, deleteWell } from '../src/db/repos.js';
import { addImage, validateImageFile, exportDigitized, listDigitized, saveSession, deleteImage } from '../src/db/images.js';
import { listWellCurves } from '../src/db/curves.js';
import { getLog } from '../src/registry/logRegistry.js';

describe('calibration', () => {
  it('fits an exact line and reports rms 0', () => {
    const f = fitLinear([0, 10, 20], [5, 15, 25]);
    expect(f.a).toBeCloseTo(5, 10); expect(f.b).toBeCloseTo(1, 10); expect(f.rms).toBeCloseTo(0, 10);
    expect(fitLinear([3, 3], [1, 2])).toBeNull();
  });
  it('depth calibration from two points; resolution and monotonic warnings', () => {
    const c = calibrateDepth([{ py: 100, depth: 0 }, { py: 600, depth: 50 }]);
    expect(c.ok).toBe(true);
    expect(pixelToDepth(c, 350)).toBeCloseTo(25, 10);
    expect(c.resolution).toBeCloseTo(0.1, 10);
    expect(calibrateDepth([{ py: 100, depth: 50 }, { py: 600, depth: 0 }]).warnings).toContain('depth_decreasing');
  });
  it('refuses unusable calibrations instead of guessing', () => {
    expect(calibrateDepth([{ py: 1, depth: 0 }]).errors).toContain('need_two_points');
    expect(calibrateDepth([{ py: 100, depth: 0 }, { py: 102, depth: 5 }]).errors).toContain('points_too_close');
    expect(calibrateDepth([{ py: 100, depth: 5 }, { py: 300, depth: 5 }]).errors).toContain('same_depth');
    expect(calibrateTrack([{ px: 0, value: 1 }, { px: 100, value: 1 }]).errors).toContain('same_value');
    expect(calibrateTrack([{ px: 0, value: 0 }, { px: 100, value: 10 }], 'log').errors).toContain('log_nonpositive');
  });
  it('detects bad references through the residual (3 points, one wrong)', () => {
    const c = calibrateDepth([{ py: 0, depth: 0 }, { py: 100, depth: 10 }, { py: 200, depth: 35 }]);
    expect(c.ok).toBe(true);
    expect(c.warnings).toContain('large_residual');
  });
  it('linear track calibration incl. reversed scales; log scales are exact on decades', () => {
    const lin = calibrateTrack([{ px: 100, value: 0 }, { px: 400, value: 150 }]);
    expect(pixelToValue(lin, 250)).toBeCloseTo(75, 10);
    const rev = calibrateTrack([{ px: 100, value: 0.45 }, { px: 400, value: -0.15 }]);
    expect(pixelToValue(rev, 250)).toBeCloseTo(0.15, 10);
    const log = calibrateTrack([{ px: 100, value: 0.2 }, { px: 500, value: 2000 }], 'log');
    expect(pixelToValue(log, 100)).toBeCloseTo(0.2, 10);
    expect(pixelToValue(log, 500)).toBeCloseTo(2000, 6);
    expect(pixelToValue(log, 300)).toBeCloseTo(Math.sqrt(0.2 * 2000), 8); // geometric mean at the middle
  });
  it('extrapolation flag and resampling (no gap bridging)', () => {
    expect(isExtrapolated([100, 200], 120)).toBe(false);
    expect(isExtrapolated([100, 200], 300)).toBe(true);
    const pts = [{ depth: 0, value: 0 }, { depth: 10, value: 100 }, { depth: 100, value: 200 }];
    expect(resample(pts, 5, 20).map((p) => p.depth)).toEqual([0, 5, 10]); // 10→100 gap not bridged
    expect(resample(pts, 5, 20)[1].value).toBe(50);
  });
});

describe('image transform', () => {
  it('rotated size and round trip working <-> original for rotation + crop', () => {
    expect(rotatedSize(200, 100, 90)).toEqual({ w: 100, h: 200 });
    for (const p of [{ rotation: 0, crop: null }, { rotation: 90, crop: null }, { rotation: 2.5, crop: { x: 20, y: 30, w: 100, h: 120 } }, { rotation: -7, crop: { x: 5, y: 5, w: 80, h: 90 } }]) {
      const o = workingToOriginal(37, 52, 400, 300, p);
      const w = originalToWorking(o.ox, o.oy, 400, 300, p);
      expect(w.px).toBeCloseTo(37, 8); expect(w.py).toBeCloseTo(52, 8);
    }
    // 90° rotation maps the working-image top-left corner onto the original bottom-left (rotated clockwise)
    const o = workingToOriginal(0, 0, 200, 100, { rotation: 90, crop: null });
    expect(o.ox).toBeCloseTo(0, 8); expect(o.oy).toBeCloseTo(100, 8);
    expect(workingSize(400, 300, { rotation: 0, crop: { x: 0, y: 0, w: 50, h: 60 } })).toEqual({ w: 50, h: 60 });
  });
});

/** Build a synthetic RGBA image with a coloured curve and optional gridlines. */
function synthImage(w, h, curveX, color = [220, 30, 30], opts = {}) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const set = (x, y, c) => { const i = (y * w + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255; };
  if (opts.grid) for (let y = 0; y < h; y += opts.grid) for (let x = 0; x < w; x++) set(x, y, [0, 0, 0]);
  for (let y = 0; y < h; y++) {
    if (opts.gapFrom != null && y >= opts.gapFrom && y < opts.gapTo) continue;
    const cx = Math.round(curveX(y));
    for (let dx = -1; dx <= 1; dx++) if (cx + dx >= 0 && cx + dx < w) set(cx + dx, y, color);
  }
  return { data, width: w, height: h };
}

describe('automatic extraction', () => {
  it('follows a coloured curve and reports good coverage', () => {
    const img = synthImage(200, 300, (y) => 100 + 40 * Math.sin(y / 30));
    const r = extractCurve(img, { color: [220, 30, 30], tolerance: 40, stepY: 3 });
    expect(r.stats.coverage).toBeGreaterThan(0.95);
    expect(r.stats.reliable).toBe(true);
    r.points.forEach((p) => expect(Math.abs(p.px - (100 + 40 * Math.sin(p.py / 30)))).toBeLessThan(1.6));
  });
  it('does not invent points in gaps and flags an unreliable result', () => {
    const img = synthImage(200, 300, () => 100, [220, 30, 30], { gapFrom: 50, gapTo: 250 });
    const r = extractCurve(img, { color: [220, 30, 30], tolerance: 40, stepY: 2 });
    expect(r.points.some((p) => p.py >= 50 && p.py < 250)).toBe(false);
    expect(r.stats.reliable).toBe(false);
    expect(r.stats.reasons).toContain('low_coverage');
  });
  it('finds nothing for a colour that is not in the image; respects the ROI', () => {
    const img = synthImage(200, 100, () => 150);
    expect(extractCurve(img, { color: [0, 200, 0], tolerance: 30 }).points).toHaveLength(0);
    expect(extractCurve(img, { color: [220, 30, 30], tolerance: 30, roi: { x0: 0, x1: 100, y0: 0, y1: 99 } }).points).toHaveLength(0);
    expect(pixelColor(img, 150, 10)).toEqual([220, 30, 30]);
  });
  it('detects horizontal gridlines and their spacing; snapping', () => {
    const img = synthImage(200, 300, () => 0, [255, 255, 255], { grid: 50 });
    const g = detectHorizontalLines(img, { darkThreshold: 100, minFrac: 0.8 });
    expect(g.lines).toEqual([0.5, 50.5, 100.5, 150.5, 200.5, 250.5]); // pixel centres, continuous coordinates
    expect(g.spacing).toBe(50);
    expect(snapTo(103, g.lines, 6)).toBe(100.5);
    expect(snapTo(120, g.lines, 6)).toBe(120);
  });
});

describe('pipeline: pixels -> values with traceability', () => {
  const session = () => {
    const s = newSession();
    s.depthCal.points = [{ id: 'a', py: 100, depth: '0' }, { id: 'b', py: 600, depth: '50' }];
    s.tracks = [{ id: 't1', name: 'Res', curveId: 'res_deep', unit: 'ohm.m', scale: 'log', points: [{ id: 'p1', px: 100, value: '0.2' }, { id: 'p2', px: 500, value: '2000' }] }];
    s.curves = [{ id: 'c1', curveId: 'res_deep', trackId: 't1', color: '#f00', points: [{ id: 'q1', px: 300, py: 350, method: 'manual' }, { id: 'q2', px: 500, py: 600, method: 'auto' }] }];
    return s;
  };
  it('computes depth/value, original pixels and flags; sorted by depth', () => {
    const r = computeCurve(session(), session().curves[0], { W: 800, H: 800 }, []);
    expect(r.blocking).toEqual([]);
    expect(r.points[0]).toMatchObject({ method: 'manual', ox: 300, oy: 350 });
    expect(r.points[0].depth).toBeCloseTo(25, 8);
    expect(r.points[0].value).toBeCloseTo(Math.sqrt(0.2 * 2000), 6);
    expect(r.points[1].value).toBeCloseTo(2000, 4);
    expect(r.calibration.scale).toBe('log');
    expect(r.quality.depthResolution).toBeCloseTo(0.1, 10);
  });
  it('blocks when calibration is missing; unit conversion is applied (ft depth, mS/m)', () => {
    const s = session();
    s.depthCal.points = [];
    expect(computeCurve(s, s.curves[0], { W: 1, H: 1 }).blocking).toContain('depth_calibration');
    const s2 = session();
    s2.depthCal.unit = 'ft'; // typed 0 and 50 ft
    expect(depthCalibrationOf(s2).fit.b).toBeCloseTo(50 * 0.3048 / 500, 10);
    const s3 = session();
    s3.tracks[0].unit = 'ohm.cm'; // values typed in ohm.cm must be converted to ohm.m (x0.01)
    const r = computeCurve(s3, s3.curves[0], { W: 800, H: 800 });
    expect(r.points[1].value).toBeCloseTo(20, 4);
  });
  it('rejects invalid values and curve/track unit mismatches; flags extrapolation', () => {
    const s = session();
    s.curves[0].points.push({ id: 'q3', px: 100000, py: 350, method: 'manual' }); // 10^huge -> out of range
    const r = computeCurve(s, s.curves[0], { W: 800, H: 800 });
    expect(r.issues.some((i) => ['out_of_range', 'not_number'].includes(i.code))).toBe(true); // 10^huge is rejected
    expect(r.points).toHaveLength(2);
    const s2 = session();
    s2.curves[0].curveId = 'gr'; // gAPI vs ohm.m track
    expect(computeCurve(s2, s2.curves[0], { W: 1, H: 1 }).blocking).toContain('unit_mismatch');
    const s3 = session();
    s3.curves[0].points = [{ id: 'z', px: 300, py: 5000, method: 'manual' }];
    const r3 = computeCurve(s3, s3.curves[0], { W: 800, H: 800 });
    expect(r3.points[0].flags).toContain('depth_extrapolated');
  });
  it('optional resampling', () => {
    const s = session();
    const r = computeCurve(s, s.curves[0], { W: 800, H: 800 });
    expect(exportPoints(r, { enabled: false }).length).toBe(2);
    expect(exportPoints(r, { enabled: true, step: 5 }).length).toBe(6);
  });
});

describe('image storage and export to the workspace', () => {
  it('validates files', () => {
    expect(validateImageFile(null)).toBe('none');
    expect(validateImageFile({ name: 'a.gif', type: 'image/gif', size: 5 })).toBe('type');
    expect(validateImageFile({ name: 'a.png', type: 'image/png', size: 0 })).toBe('empty');
    expect(validateImageFile({ name: 'a.png', type: 'image/png', size: 70e6 })).toBe('size');
    expect(validateImageFile({ name: 'scan.PDF', type: '', size: 10 })).toBeNull();
  });

  it('stores sessions, exports digitised curves with provenance, cascades on delete', async () => {
    const pid = await createProject({ name: 'P' });
    const wid = await createWell({ projectId: pid, wellId: 'IMG', name: 'Img well' });
    const iid = await addImage(wid, { name: 'scan.png', mime: 'image/png', blob: new Blob(['x']), width: 800, height: 800 });
    const s = newSession();
    s.depthCal.points = [{ id: 'a', py: 100, depth: '0' }, { id: 'b', py: 600, depth: '50' }];
    s.tracks = [{ id: 't1', name: 'GR', curveId: 'gr', unit: 'gAPI', scale: 'linear', points: [{ id: 'p1', px: 100, value: '0' }, { id: 'p2', px: 400, value: '150' }] }];
    s.curves = [{ id: 'c1', curveId: 'gr', trackId: 't1', color: '#0a0', points: [{ id: 'q1', px: 250, py: 350, method: 'manual' }, { id: 'q2', px: 400, py: 600, method: 'auto' }] }];
    await saveSession(iid, s);
    const image = await db.logImages.get(iid);
    const result = computeCurve(s, s.curves[0], { W: 800, H: 800 });
    const n = await exportDigitized(image, [{ curve: s.curves[0], def: getLog('gr'), result, points: exportPoints(result, s.resample) }], { mode: 'replace' });
    expect(n).toBe(1);

    const [m] = await listWellCurves(wid);
    expect(m).toMatchObject({ curveId: 'gr', source: 'image', unit: 'gAPI', enteredUnit: 'gAPI' });
    expect(m.depth[0]).toBeCloseTo(25, 8); expect(m.values[0]).toBeCloseTo(75, 8);
    expect(m.meta).toMatchObject({ imageId: iid, imageName: 'scan.png' });

    const [d] = await listDigitized(iid);
    expect(d.points[0]).toMatchObject({ px: 250, py: 350, ox: 250, oy: 350, method: 'manual' });
    expect(d.calibration.scale).toBe('linear');
    expect(d.quality.depthResolution).toBeCloseTo(0.1, 10);

    // re-export updates the same digitised record instead of duplicating it
    await exportDigitized(image, [{ curve: s.curves[0], def: getLog('gr'), result, points: result.points }], { mode: 'replace' });
    expect(await listDigitized(iid)).toHaveLength(1);

    await deleteImage(iid);
    expect(await db.digitizedCurves.count()).toBe(0);
    await deleteWell(wid);
    expect(await db.logImages.count()).toBe(0);
  });
});
