import { db as defaultDb } from './db.js';

const now = () => new Date().toISOString();

/** A saved report = its definition (options and the author's texts) plus, optionally, the generated PDF. */
export async function saveReport(wellId, projectId, { id, title, lang, options, pdfBlob, pageCount }, db = defaultDb) {
  const rec = { wellId, projectId, title, lang, options, updatedAt: now(), ...(pdfBlob ? { pdf: pdfBlob, pdfBytes: pdfBlob.size, pageCount, generatedAt: now() } : {}) };
  if (id) { await db.reports.update(id, rec); return id; }
  return db.reports.add({ ...rec, createdAt: now() });
}
export const listReports = (wellId, db = defaultDb) => db.reports.where('wellId').equals(wellId).toArray();
export const deleteReport = (id, db = defaultDb) => db.reports.delete(id);
