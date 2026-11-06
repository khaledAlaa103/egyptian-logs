import Dexie from 'dexie';

export const DB_NAME = 'welllog-pro';

/**
 * Tables that belong to a well (deleted/duplicated/exported together with it).
 * calcSettings and reports may also carry a projectId.
 */
export const WELL_CHILD_TABLES = [
  'logMeasurements', 'logImages', 'digitizedCurves', 'formations',
  'interpretations', 'calcSettings', 'reports', 'markers',
];

export const ALL_TABLES = ['projects', 'wells', ...WELL_CHILD_TABLES, 'preferences'];

export function createDb(name = DB_NAME) {
  const db = new Dexie(name);

  // ---- Version 1 (Phase 2). NEVER edit a released version: add version(n+1) with an upgrade().
  db.version(1).stores({
    projects: '++id, name, status, updatedAt',
    wells: '++id, projectId, wellId, name, status, country, wellType, updatedAt',
    logMeasurements: '++id, wellId, curveId, [wellId+curveId]',
    logImages: '++id, wellId',
    digitizedCurves: '++id, wellId, curveId',
    formations: '++id, wellId, top',
    interpretations: '++id, wellId',
    calcSettings: '++id, projectId, wellId',
    reports: '++id, projectId, wellId',
    preferences: 'key',
  });

  // ---- Version 2 (Phase 4): depth markers / annotations for the log viewer. Additive: no data change.
  db.version(2).stores({
    markers: '++id, wellId, depth',
  });

  return db;
}

export const db = createDb();
