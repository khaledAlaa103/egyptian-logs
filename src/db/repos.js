import { db as defaultDb, WELL_CHILD_TABLES, ALL_TABLES } from './db.js';
import { encodeRows, decodeRows } from './serialize.js';

export const PROJECT_FORMAT = 'welllog-project';
export const BACKUP_FORMAT = 'welllog-backup';
export const SCHEMA_VERSION = 1;

const now = () => new Date().toISOString();
const stripId = ({ id, ...rest }) => rest; // eslint-disable-line no-unused-vars

// ---------------- Projects ----------------
export async function createProject(data, db = defaultDb) {
  const t = now();
  return db.projects.add({
    name: data.name.trim(), client: data.client || '', description: data.description || '',
    status: 'active', createdAt: t, updatedAt: t,
  });
}

export async function updateProject(id, patch, db = defaultDb) {
  await db.projects.update(id, { ...patch, updatedAt: now() });
}

export async function setProjectArchived(id, archived, db = defaultDb) {
  await updateProject(id, { status: archived ? 'archived' : 'active' }, db);
}

/** Deletes a project, all its wells and everything attached to those wells. */
export async function deleteProject(id, db = defaultDb) {
  await db.transaction('rw', db.tables, async () => {
    const wells = await db.wells.where('projectId').equals(id).toArray();
    for (const w of wells) await deleteWellInner(w.id, db);
    await db.calcSettings.where('projectId').equals(id).delete();
    await db.reports.where('projectId').equals(id).delete();
    await db.projects.delete(id);
  });
}

// ---------------- Wells ----------------
export async function createWell(data, db = defaultDb) {
  const t = now();
  return db.wells.add({ ...data, status: 'active', createdAt: t, updatedAt: t });
}

export async function updateWell(id, patch, db = defaultDb) {
  await db.wells.update(id, { ...patch, updatedAt: now() });
}

export async function setWellArchived(id, archived, db = defaultDb) {
  await updateWell(id, { status: archived ? 'archived' : 'active' }, db);
}

async function deleteWellInner(id, db) {
  for (const tbl of WELL_CHILD_TABLES) await db[tbl].where('wellId').equals(id).delete();
  await db.wells.delete(id);
}

export async function deleteWell(id, db = defaultDb) {
  await db.transaction('rw', db.tables, () => deleteWellInner(id, db));
}

/** Copies a well and all of its data. Returns the new well's primary key. */
export async function duplicateWell(id, db = defaultDb, { projectId } = {}) {
  return db.transaction('rw', db.tables, async () => {
    const src = await db.wells.get(id);
    if (!src) throw new Error('Well not found');
    const t = now();
    const taken = new Set((await db.wells.toArray()).map((w) => w.wellId.toLowerCase()));
    let wellId = `${src.wellId}-copy`;
    for (let i = 2; taken.has(wellId.toLowerCase()); i++) wellId = `${src.wellId}-copy${i}`;
    const newId = await db.wells.add({
      ...stripId(src), wellId, projectId: projectId ?? src.projectId,
      status: 'active', createdAt: t, updatedAt: t,
    });
    for (const tbl of WELL_CHILD_TABLES) {
      const rows = await db[tbl].where('wellId').equals(id).toArray();
      if (rows.length) await db[tbl].bulkAdd(rows.map((r) => ({ ...stripId(r), wellId: newId })));
    }
    return newId;
  });
}

export async function duplicateProject(id, db = defaultDb) {
  return db.transaction('rw', db.tables, async () => {
    const src = await db.projects.get(id);
    if (!src) throw new Error('Project not found');
    const t = now();
    const newPid = await db.projects.add({
      ...stripId(src), name: `${src.name} (copy)`, status: 'active', createdAt: t, updatedAt: t,
    });
    const wells = await db.wells.where('projectId').equals(id).toArray();
    for (const w of wells) await duplicateWell(w.id, db, { projectId: newPid });
    const own = [
      ...(await db.calcSettings.where('projectId').equals(id).filter((r) => r.wellId == null).toArray()),
    ];
    if (own.length) await db.calcSettings.bulkAdd(own.map((r) => ({ ...stripId(r), projectId: newPid })));
    return newPid;
  });
}

// ---------------- Project JSON export / import ----------------
export async function exportProject(id, db = defaultDb) {
  const project = await db.projects.get(id);
  if (!project) throw new Error('Project not found');
  const wells = await db.wells.where('projectId').equals(id).toArray();
  const data = {};
  for (const tbl of WELL_CHILD_TABLES) {
    const rows = [];
    for (const w of wells) rows.push(...(await db[tbl].where('wellId').equals(w.id).toArray()));
    data[tbl] = await encodeRows(rows);
  }
  return {
    format: PROJECT_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: now(),
    project, wells, data,
  };
}

/** Single-well export, packaged as a one-well project bundle (importable via importProject). */
export async function exportWell(id, db = defaultDb) {
  const well = await db.wells.get(id);
  if (!well) throw new Error('Well not found');
  const project = await db.projects.get(well.projectId);
  const data = {};
  for (const tbl of WELL_CHILD_TABLES) data[tbl] = await encodeRows(await db[tbl].where('wellId').equals(id).toArray());
  return {
    format: PROJECT_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: now(),
    project: project || { name: 'Imported well' }, wells: [well], data,
  };
}

/** Imports a project bundle as a NEW project (never overwrites). Returns the new project id. */
export async function importProject(bundle, db = defaultDb) {
  if (!bundle || bundle.format !== PROJECT_FORMAT) throw new Error('INVALID_FORMAT');
  if (!bundle.project || !Array.isArray(bundle.wells)) throw new Error('INVALID_FORMAT');
  if (bundle.schemaVersion > SCHEMA_VERSION) throw new Error('NEWER_VERSION');
  return db.transaction('rw', db.tables, async () => {
    const t = now();
    const pid = await db.projects.add({
      ...stripId(bundle.project), name: bundle.project.name, status: 'active', createdAt: t, updatedAt: t,
    });
    const taken = new Set((await db.wells.toArray()).map((w) => w.wellId.toLowerCase()));
    const wellMap = new Map();
    for (const w of bundle.wells) {
      let wellId = w.wellId;
      for (let i = 2; taken.has(wellId.toLowerCase()); i++) wellId = `${w.wellId}-imp${i}`;
      taken.add(wellId.toLowerCase());
      wellMap.set(w.id, await db.wells.add({ ...stripId(w), wellId, projectId: pid }));
    }
    for (const tbl of WELL_CHILD_TABLES) {
      const rows = decodeRows(bundle.data?.[tbl] || [])
        .filter((r) => wellMap.has(r.wellId))
        .map((r) => ({ ...stripId(r), wellId: wellMap.get(r.wellId), ...(r.projectId != null ? { projectId: pid } : {}) }));
      if (rows.length) await db[tbl].bulkAdd(rows);
    }
    return pid;
  });
}

// ---------------- Full local backup / restore ----------------
export async function exportBackup(db = defaultDb) {
  const tables = {};
  for (const name of ALL_TABLES) tables[name] = await encodeRows(await db[name].toArray());
  return { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: now(), tables };
}

/** Replaces ALL local data with the backup content (validated first, atomic). */
export async function restoreBackup(backup, db = defaultDb) {
  if (!backup || backup.format !== BACKUP_FORMAT || typeof backup.tables !== 'object') {
    throw new Error('INVALID_FORMAT');
  }
  if (backup.schemaVersion > SCHEMA_VERSION) throw new Error('NEWER_VERSION');
  for (const name of ALL_TABLES) {
    if (backup.tables[name] && !Array.isArray(backup.tables[name])) throw new Error('INVALID_FORMAT');
  }
  await db.transaction('rw', db.tables, async () => {
    for (const name of ALL_TABLES) {
      await db[name].clear();
      const rows = decodeRows(backup.tables[name] || []);
      if (rows.length) await db[name].bulkPut(rows);
    }
  });
}
