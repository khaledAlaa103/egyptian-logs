// Collects everything a report needs from the local database (read-only). Async, no UI.
import { db as defaultDb } from '../db/db.js';
import { listFormations, listMarkers } from '../db/intervals.js';
import { listInterpretations } from '../db/interp.js';
import { listSamples, calibrationSamples, loadSettings } from '../db/water.js';
import { getCustomCurves } from '../db/curves.js';
import { loadView } from '../db/results.js';
import { buildRows } from '../results/columns.js';
import { resolveCalibration } from '../results/waterCalibration.js';
import { estimateIntervals } from '../results/waterEstimates.js';
import { qualityWarnings } from '../results/quality.js';
import { fromSample } from '../engine/water/water.js';

export const DEFAULT_UNITS = { depth: 'm', resistivity: 'ohm.m', gr: 'gAPI', porosity: 'v/v', conductivity: 'mS/m', tds: 'mg/L' };

/** options.runId: interpretation run id | null (latest) | 'none'. */
export async function gatherReportData(wellId, options = {}, db = defaultDb) {
  const well = await db.wells.get(wellId);
  if (!well) throw new Error('WELL_NOT_FOUND');
  const [project, logRows, formations, runs, samples, custom, view, markers, images, digitized, wsettings, cutRec] = await Promise.all([
    db.projects.get(well.projectId), db.logMeasurements.where('wellId').equals(wellId).toArray(), listFormations(wellId, db), listInterpretations(wellId, db),
    listSamples(wellId, db), getCustomCurves(db), loadView(wellId, db), listMarkers(wellId, db),
    db.logImages.where('wellId').equals(wellId).toArray(), db.digitizedCurves.where('wellId').equals(wellId).toArray(), loadSettings(wellId, db),
    db.preferences.get(`formations:cutoffs:${wellId}`),
  ]);
  const sortedRuns = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const run = options.runId === 'none' ? null : sortedRuns.find((r) => r.id === options.runId) || sortedRuns[0] || null;
  const curves = Object.fromEntries(logRows.map((r) => [r.curveId, { depth: r.depth, values: r.values, unit: r.unit }]));
  const sources = view?.sources || {};
  const rows = buildRows([...formations].sort((a, b) => a.top - b.top), { curves, run, sources });
  const projectSamples = wsettings?.calibration?.scope === 'project' ? await calibrationSamples(well, 'project', db) : samples;
  const cal = resolveCalibration({ settings: wsettings, samples, projectSamples });
  const ready = cal.normOk && cal.calibration?.ok;
  const estimates = estimateIntervals({ rows, run, curves, samples, normalization: cal.normalization, calibration: cal.calibration, rwUncertaintyPct: wsettings?.rwUncertaintyPct, ready });
  const warnings = qualityWarnings({ formations, rows, curves, run, well });
  const directResults = samples.map((s) => ({ ...fromSample(s, cal.normalization), source: s.source }));
  const projectWells = (await db.wells.where('projectId').equals(well.projectId).count());
  return {
    well, project, logRows, curves, formations, rows, run, runs: sortedRuns, samples, custom, view: view || {}, units: { ...DEFAULT_UNITS, ...(view?.units || {}) },
    markers, images, digitized, waterSettings: wsettings || null, ...cal, estimates, warnings, directResults, projectWells, cutoffs: cutRec?.value || {}, now: new Date().toISOString(),
  };
}
