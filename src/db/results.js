import { db as defaultDb } from './db.js';
import { listFormations, updateFormation, deleteFormation, addFormation } from './intervals.js';

const now = () => new Date().toISOString();
const viewKey = (w) => `results:view:${w}`;
const snapKey = (w) => `results:snapshots:${w}`;

export async function loadView(wellId, db = defaultDb) { return (await db.preferences.get(viewKey(wellId)))?.value || null; }
export const saveView = (wellId, v, db = defaultDb) => db.preferences.put({ key: viewKey(wellId), value: v });

/** Apply the same patch to several intervals. Returns { ok: [ids], failed: [{id, error}] } (each validated separately). */
export async function bulkUpdate(ids, patch, db = defaultDb) {
  const ok = [], failed = [];
  for (const id of ids) {
    try { await updateFormation(id, patch, db); ok.push(id); } catch (e) { failed.push({ id, error: e.message }); }
  }
  return { ok, failed };
}

export async function bulkDelete(ids, db = defaultDb) {
  for (const id of ids) await deleteFormation(id, db);
}

/** Adds an interval right below the deepest existing one (top = last bottom; bottom = well TD if deeper, else top + 1 m). */
export async function addNextInterval(well, db = defaultDb) {
  const list = await listFormations(well.id, db);
  const top = list.length ? list[list.length - 1].bottom : 0;
  const bottom = well.totalDepth != null && well.totalDepth > top ? well.totalDepth : top + 1;
  return addFormation(well.id, { top, bottom, name: '', waterBearing: 'unknown' }, db);
}

/** Manual value for a derived cell (kept with its source note and status). value=null removes the override. */
export async function setOverride(fid, col, value, { status = 'user', source = '' } = {}, db = defaultDb) {
  const f = await db.formations.get(fid);
  const ov = { ...(f.overrides || {}) };
  if (value == null) delete ov[col]; else ov[col] = { value, status, source };
  await db.formations.update(fid, { overrides: ov, updatedAt: now() });
}

// ---- snapshots (save / restore of the whole table) ----
export async function listSnapshots(wellId, db = defaultDb) { return (await db.preferences.get(snapKey(wellId)))?.value || []; }

export async function saveSnapshot(wellId, name, db = defaultDb) {
  const rows = (await listFormations(wellId, db)).map(({ id, ...rest }) => rest); // eslint-disable-line no-unused-vars
  const list = await listSnapshots(wellId, db);
  const snap = { id: `s${Date.now().toString(36)}`, name: name || new Date().toLocaleString(), createdAt: now(), rows };
  await db.preferences.put({ key: snapKey(wellId), value: [snap, ...list] });
  return snap.id;
}

export async function restoreSnapshot(wellId, snapId, db = defaultDb) {
  const snap = (await listSnapshots(wellId, db)).find((s) => s.id === snapId);
  if (!snap) throw new Error('NOT_FOUND');
  await db.transaction('rw', db.formations, async () => {
    await db.formations.where('wellId').equals(wellId).delete();
    if (snap.rows.length) await db.formations.bulkAdd(snap.rows.map((r) => ({ ...r, wellId })));
  });
  return snap.rows.length;
}

export async function deleteSnapshot(wellId, snapId, db = defaultDb) {
  const list = await listSnapshots(wellId, db);
  await db.preferences.put({ key: snapKey(wellId), value: list.filter((s) => s.id !== snapId) });
}
