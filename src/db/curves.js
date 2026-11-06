import { db as defaultDb } from './db.js';
import { makeCustomCurve } from '../registry/logRegistry.js';

const now = () => new Date().toISOString();
const key = (d) => d.toFixed(6);

/**
 * Save curves for a well. Each curve: { curveId, unit (canonical), points:[{depth,value,row?}], enteredUnit?, header? }.
 * mode 'replace' overwrites the stored curve; 'merge' combines by depth (new values win).
 * Every stored curve records its source and provenance so results stay traceable.
 */
export async function saveCurves(wellId, curves, { mode = 'replace', source, meta = {} } = {}, db = defaultDb) {
  if (!source) throw new Error('source is required');
  await db.transaction('rw', db.logMeasurements, async () => {
    for (const c of curves) {
      const existing = await db.logMeasurements.where('[wellId+curveId]').equals([wellId, c.curveId]).first();
      let map = new Map();
      if (mode === 'merge' && existing) existing.depth.forEach((d, i) => map.set(key(d), [d, existing.values[i], existing.sourceRows?.[i] ?? null]));
      for (const p of c.points) map.set(key(p.depth), [p.depth, p.value, p.row ?? null]);
      const sorted = [...map.values()].sort((a, b) => a[0] - b[0]);
      const row = {
        wellId, curveId: c.curveId, unit: c.unit, depthUnit: 'm',
        depth: sorted.map((x) => x[0]), values: sorted.map((x) => x[1]),
        source, enteredUnit: c.enteredUnit || c.unit, header: c.header || null,
        sourceRows: sorted.map((x) => x[2]), // source file row of each point, aligned with depth/values
        meta: { ...meta }, updatedAt: now(),
      };
      if (existing) await db.logMeasurements.put({ ...existing, ...row, id: existing.id });
      else await db.logMeasurements.add({ ...row, importedAt: now() });
    }
  });
}

export const listWellCurves = (wellId, db = defaultDb) => db.logMeasurements.where('wellId').equals(wellId).toArray();

export const deleteCurve = (wellId, curveId, db = defaultDb) =>
  db.logMeasurements.where('[wellId+curveId]').equals([wellId, curveId]).delete();

// ---- Custom curve definitions are kept in the preferences table ----
const CUSTOM_KEY = 'customCurves';

export async function getCustomCurves(db = defaultDb) {
  const rec = await db.preferences.get(CUSTOM_KEY);
  return (rec?.value || []).map(makeCustomCurve);
}

export async function addCustomCurve({ abbr, name, unit, scale, min, max, description }, db = defaultDb) {
  const rec = await db.preferences.get(CUSTOM_KEY);
  const list = rec?.value || [];
  const id = `custom_${abbr.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  if (!abbr.trim() || !name.trim()) throw new Error('INVALID');
  if (list.some((c) => c.id === id)) throw new Error('DUPLICATE');
  await db.preferences.put({ key: CUSTOM_KEY, value: [...list, { id, abbr: abbr.trim(), name: name.trim(), unit: unit.trim(), scale, min, max, description }] });
  return id;
}
