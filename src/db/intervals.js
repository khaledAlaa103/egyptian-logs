import { db as defaultDb } from './db.js';

import { WATER_STATUS } from '../results/constants.js';
export { WATER_STATUS };
const now = () => new Date().toISOString();

/** Returns error code or null. top/bottom in metres. */
export function validateFormation(f, others = []) {
  const top = Number(f.top), bottom = Number(f.bottom);
  if (f.top === '' || f.bottom === '' || f.top == null || f.bottom == null) return 'required';
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return 'number';
  if (top < 0 || bottom < 0) return 'negative';
  if (bottom <= top) return 'order';
  if (others.some((o) => top < o.bottom && bottom > o.top)) return 'overlap';
  return null;
}

export const listFormations = (wellId, db = defaultDb) =>
  db.formations.where('wellId').equals(wellId).sortBy('top');

export async function addFormation(wellId, data, db = defaultDb) {
  const others = await listFormations(wellId, db);
  const err = validateFormation(data, others);
  if (err) throw new Error(err);
  return db.formations.add({
    wellId, top: Number(data.top), bottom: Number(data.bottom), name: data.name || '',
    lithology: data.lithology || '', waterBearing: data.waterBearing || 'unknown', notes: data.notes || '',
    createdAt: now(), updatedAt: now(),
  });
}

export async function updateFormation(id, patch, db = defaultDb) {
  const cur = await db.formations.get(id);
  const next = { ...cur, ...patch };
  const others = (await listFormations(cur.wellId, db)).filter((f) => f.id !== id);
  const err = validateFormation(next, others);
  if (err) throw new Error(err);
  await db.formations.update(id, { ...patch, top: Number(next.top), bottom: Number(next.bottom), updatedAt: now() });
}

export const deleteFormation = (id, db = defaultDb) => db.formations.delete(id);

export const listMarkers = (wellId, db = defaultDb) => db.markers.where('wellId').equals(wellId).sortBy('depth');
export async function addMarker(wellId, depth, label, db = defaultDb) {
  if (!Number.isFinite(depth) || depth < 0) throw new Error('number');
  return db.markers.add({ wellId, depth, label: label || '', createdAt: now() });
}
export const updateMarker = (id, patch, db = defaultDb) => db.markers.update(id, patch);
export const deleteMarker = (id, db = defaultDb) => db.markers.delete(id);

// Viewer layouts are per-well user preferences.
const layoutKey = (wellId) => `viewer:layout:${wellId}`;
export async function loadLayout(wellId, db = defaultDb) {
  return (await db.preferences.get(layoutKey(wellId)))?.value || null;
}
export const saveLayout = (wellId, layout, db = defaultDb) => db.preferences.put({ key: layoutKey(wellId), value: layout });
