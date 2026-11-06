import { db as defaultDb } from './db.js';

const now = () => new Date().toISOString();
const settingsKey = (w) => `water:settings:${w}`;

export const SAMPLE_KINDS = ['lab', 'field_ec', 'rw'];

/** Returns { field: code } ; a sample needs a depth, an ID, a source and at least one measured quantity. */
export function validateSample(s) {
  const e = {};
  const pos = (x) => x !== '' && x != null && Number.isFinite(Number(x)) && Number(x) > 0;
  const has = (x) => x !== '' && x != null;
  if (!String(s.sampleId || '').trim()) e.sampleId = 'required';
  if (!has(s.depthTop) || !Number.isFinite(Number(s.depthTop)) || Number(s.depthTop) < 0) e.depthTop = 'number';
  if (has(s.depthBottom)) {
    if (!Number.isFinite(Number(s.depthBottom)) || Number(s.depthBottom) < Number(s.depthTop)) e.depthBottom = 'order';
  }
  if (!String(s.source || '').trim()) e.source = 'required';
  const anyValue = has(s.tds) || has(s.ec) || has(s.rw);
  if (!anyValue) e.tds = 'value';
  if (has(s.tds) && !pos(s.tds)) e.tds = 'positive';
  if (has(s.ec)) { if (!pos(s.ec)) e.ec = 'positive'; if (!has(s.ecTemp) || !Number.isFinite(Number(s.ecTemp))) e.ecTemp = 'temperature'; }
  if (has(s.rw)) { if (!pos(s.rw)) e.rw = 'positive'; if (!has(s.rwTemp) || !Number.isFinite(Number(s.rwTemp))) e.rwTemp = 'temperature'; }
  if (has(s.ec) && has(s.rw)) e.rw = 'both';
  return e;
}

const EC_TO_USCM = { 'uS/cm': 1, 'mS/cm': 1000, 'mS/m': 10, 'S/m': 10000 };

/** Normalise a form record to stored numbers (canonical: TDS mg/L, EC µS/cm, Rw Ω·m, T °C, depths m). */
export function normalizeSample(s) {
  const n = (x) => (x === '' || x == null ? null : Number(x));
  const ecU = EC_TO_USCM[s.ecUnit || 'uS/cm'] ?? 1;
  return {
    sampleId: String(s.sampleId).trim(), depthTop: n(s.depthTop), depthBottom: n(s.depthBottom), date: s.date || '',
    tds: n(s.tds), ecUScm: n(s.ec) == null ? null : n(s.ec) * ecU, ecEntered: n(s.ec), ecUnit: s.ecUnit || 'uS/cm', ecTemp: n(s.ecTemp),
    rw: n(s.rw), rwTemp: n(s.rwTemp), source: String(s.source).trim(), notes: s.notes || '',
  };
}

export const listSamples = (wellId, db = defaultDb) => db.waterSamples.where('wellId').equals(wellId).sortBy('depthTop');
export async function addSample(wellId, form, db = defaultDb) {
  const e = validateSample(form);
  if (Object.keys(e).length) throw Object.assign(new Error('INVALID'), { errors: e });
  return db.waterSamples.add({ wellId, ...normalizeSample(form), createdAt: now() });
}
export async function updateSample(id, form, db = defaultDb) {
  const e = validateSample(form);
  if (Object.keys(e).length) throw Object.assign(new Error('INVALID'), { errors: e });
  await db.waterSamples.update(id, { ...normalizeSample(form), updatedAt: now() });
}
export const deleteSample = (id, db = defaultDb) => db.waterSamples.delete(id);

export async function loadSettings(wellId, db = defaultDb) { return (await db.preferences.get(settingsKey(wellId)))?.value || null; }
export const saveSettings = (wellId, v, db = defaultDb) => db.preferences.put({ key: settingsKey(wellId), value: v });

/** Samples of the well, or of every well of the same project (local calibration data). */
export async function calibrationSamples(well, scope, db = defaultDb) {
  if (scope !== 'project') return listSamples(well.id, db);
  const wells = await db.wells.where('projectId').equals(well.projectId).toArray();
  const all = [];
  for (const w of wells) all.push(...(await listSamples(w.id, db)));
  return all;
}

/** Write an estimate (or a direct value) to an interval; the results table reads it (status, trace, uncertainty). */
export async function applyWaterQuality(fid, wq, db = defaultDb) {
  await db.formations.update(fid, { waterQuality: { ...wq, appliedAt: now() }, updatedAt: now() });
}
export async function clearWaterQuality(fid, db = defaultDb) {
  const f = await db.formations.get(fid);
  if (!f) return;
  const { waterQuality, ...rest } = f; // eslint-disable-line no-unused-vars
  await db.formations.put(rest);
}
