import { db as defaultDb } from './db.js';
import { saveCurves } from './curves.js';

const now = () => new Date().toISOString();

/**
 * Writes a parsed Excel project (from parseProjectWorkbook) as a NEW project. Never overwrites.
 * Well IDs that already exist get a "-imp2" style suffix. Returns { projectId, wells, curves, formations, renamed }.
 */
export async function importProjectExcel(parsed, { sourceName = 'Excel' } = {}, db = defaultDb) {
  return db.transaction('rw', db.tables, async () => {
    const t = now();
    const projectId = await db.projects.add({ ...parsed.project, status: 'active', createdAt: t, updatedAt: t });
    const taken = new Set((await db.wells.toArray()).map((w) => w.wellId.toLowerCase()));
    const ids = new Map();
    const renamed = [];
    for (const w of parsed.wells) {
      let wellId = w.wellId;
      for (let i = 2; taken.has(wellId.toLowerCase()); i++) wellId = `${w.wellId}-imp${i}`;
      if (wellId !== w.wellId) renamed.push([w.wellId, wellId]);
      taken.add(wellId.toLowerCase());
      ids.set(w.wellId.toLowerCase(), await db.wells.add({ ...w, wellId, projectId, status: 'active', createdAt: t, updatedAt: t }));
    }
    let curves = 0;
    for (const l of parsed.logs) {
      await saveCurves(ids.get(l.wellId.toLowerCase()), l.curves, { mode: 'replace', source: 'excel', meta: { file: sourceName, sheet: 'Logs' } }, db);
      curves += l.curves.length;
    }
    if (parsed.formations.length) {
      await db.formations.bulkAdd(parsed.formations.map(({ wellId, ...f }) => ({
        ...f, wellId: ids.get(wellId.toLowerCase()), createdAt: t, updatedAt: t,
      })));
    }
    return { projectId, wells: parsed.wells.length, curves, formations: parsed.formations.length, renamed };
  });
}
