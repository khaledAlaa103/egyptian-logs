import { db as defaultDb } from './db.js';

/** Workspace statistics read from the local database. Warning entries are {key, count} (translated in UI). */
export async function getWorkspaceStats(db = defaultDb) {
  const [projects, wells, formations, logRows] = await Promise.all([
    db.projects.filter((p) => p.status !== 'archived').count(),
    db.wells.filter((w) => w.status !== 'archived').toArray(),
    db.formations.toArray(),
    db.logMeasurements.toArray(),
  ]);
  const activeIds = new Set(wells.map((w) => w.id));
  const curves = new Set(logRows.filter((r) => activeIds.has(r.wellId)).map((r) => `${r.wellId}:${r.curveId}`)).size;
  const wellsWithLogs = new Set(logRows.map((r) => r.wellId));
  const fm = formations.filter((f) => activeIds.has(f.wellId));

  const warnings = [];
  const noDepth = wells.filter((w) => w.totalDepth == null).length;
  const noLogs = wells.filter((w) => !wellsWithLogs.has(w.id)).length;
  const noCoords = wells.filter((w) => w.lat == null || w.lon == null).length;
  if (noDepth) warnings.push({ key: 'noDepth', count: noDepth });
  if (noLogs) warnings.push({ key: 'noLogs', count: noLogs });
  if (noCoords) warnings.push({ key: 'noCoords', count: noCoords });

  return {
    projects, wells: wells.length, curves, formations: fm.length,
    waterZones: fm.filter((f) => f.waterBearing === 'yes' || f.waterBearing === 'probable').length,
    warnings,
  };
}
