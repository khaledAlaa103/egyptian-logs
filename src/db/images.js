import { db as defaultDb } from './db.js';
import { saveCurves } from './curves.js';
import { newSession } from '../digitize/pipeline.js';
import { canonicalUnitOf } from '../registry/logRegistry.js';

const now = () => new Date().toISOString();

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
export const MAX_FILE_MB = 60;

/** Validates a user file before reading it. Returns error code or null. */
export function validateImageFile(file) {
  if (!file) return 'none';
  const okType = IMAGE_TYPES.includes(file.type) || /\.(jpe?g|png|pdf)$/i.test(file.name || '');
  if (!okType) return 'type';
  if (file.size > MAX_FILE_MB * 1024 * 1024) return 'size';
  if (file.size === 0) return 'empty';
  return null;
}

/** Stores the ORIGINAL file (never modified). renderBlob = PNG of the chosen PDF page. */
export async function addImage(wellId, { name, mime, blob, renderBlob = null, width, height, page = null, pageCount = null }, db = defaultDb) {
  return db.logImages.add({
    wellId, name, mime, blob, renderBlob, width, height, page, pageCount,
    session: newSession(), createdAt: now(), updatedAt: now(),
  });
}

export const listImages = (wellId, db = defaultDb) => db.logImages.where('wellId').equals(wellId).toArray();
export const getImage = (id, db = defaultDb) => db.logImages.get(id);
export const saveSession = (id, session, db = defaultDb) => db.logImages.update(id, { session, updatedAt: now() });
export const deleteImage = async (id, db = defaultDb) => {
  await db.transaction('rw', db.logImages, db.digitizedCurves, async () => {
    await db.digitizedCurves.filter((d) => d.imageId === id).delete();
    await db.logImages.delete(id);
  });
};

export const listDigitized = (imageId, db = defaultDb) => db.digitizedCurves.filter((d) => d.imageId === imageId).toArray();

/**
 * Persist digitised results and push them into the interpretation workspace (log measurements).
 * results: [{ curve (session curve), def, result (computeCurve output), points (export points) }]
 */
export async function exportDigitized(image, results, { mode = 'replace', resample = null, custom = [] } = {}, db = defaultDb) {
  const toSave = [];
  for (const r of results) {
    if (!r.points.length) continue;
    const existing = await db.digitizedCurves.filter((d) => d.imageId === image.id && d.curveId === r.curve.curveId).first();
    const rec = {
      wellId: image.wellId, imageId: image.id, imageName: image.name, curveId: r.curve.curveId, trackId: r.curve.trackId,
      calibration: r.result.calibration, quality: r.result.quality, issues: r.result.issues,
      resample: resample?.enabled ? resample : null, method: 'image-digitisation',
      points: r.result.points.map((p) => ({ px: p.px, py: p.py, ox: p.ox, oy: p.oy, depth: p.depth, value: p.value, method: p.method, flags: p.flags })),
      updatedAt: now(),
    };
    const id = existing ? existing.id : await db.digitizedCurves.add({ ...rec, createdAt: now() });
    if (existing) await db.digitizedCurves.put({ ...existing, ...rec });
    toSave.push({
      curveId: r.curve.curveId, unit: canonicalUnitOf(r.def), enteredUnit: r.result.calibration.unit,
      header: `image:${image.name}`, points: r.points.map((p, i) => ({ depth: p.depth, value: p.value, row: i + 1 })),
      digitizedId: id,
    });
  }
  for (const c of toSave) {
    await saveCurves(image.wellId, [c], { mode, source: 'image', meta: { imageId: image.id, imageName: image.name, digitizedCurveId: c.digitizedId, resampled: !!resample?.enabled } }, db);
  }
  return toSave.length;
}
