// Pure validation for well and project records. Returns { field: errorCode } (empty = valid).
// Error codes are translated in the UI (err.*).

const isBlank = (v) => v === '' || v == null;
const toNum = (v) => (typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.')));

function numberField(errors, w, key, { min, max } = {}) {
  if (isBlank(w[key])) return;
  const n = toNum(w[key]);
  if (!Number.isFinite(n)) { errors[key] = 'number'; return; }
  if (min != null && n < min) errors[key] = 'range';
  if (max != null && n > max) errors[key] = 'range';
}

/** existingWellIds: other wells' Well IDs (case-insensitive uniqueness). */
export function validateWell(w, existingWellIds = []) {
  const errors = {};
  if (isBlank(w.projectId)) errors.projectId = 'required';
  if (isBlank(w.wellId) || !String(w.wellId).trim()) errors.wellId = 'required';
  else if (existingWellIds.some((x) => String(x).trim().toLowerCase() === String(w.wellId).trim().toLowerCase())) {
    errors.wellId = 'duplicate';
  }
  if (isBlank(w.name) || !String(w.name).trim()) errors.name = 'required';
  numberField(errors, w, 'lat', { min: -90, max: 90 });
  numberField(errors, w, 'lon', { min: -180, max: 180 });
  numberField(errors, w, 'totalDepth', { min: 0, max: 20000 });
  numberField(errors, w, 'groundElevation', { min: -500, max: 9000 });
  if (!isBlank(w.drillingDate) && !isBlank(w.loggingDate) && w.loggingDate < w.drillingDate) {
    errors.loggingDate = 'dateOrder';
  }
  return errors;
}

export function validateProject(p) {
  const errors = {};
  if (isBlank(p.name) || !String(p.name).trim()) errors.name = 'required';
  return errors;
}

/** Normalise form strings to stored types (numbers or null). */
export function normalizeWell(w) {
  const num = (v) => (isBlank(v) ? null : toNum(v));
  return {
    ...w,
    wellId: String(w.wellId).trim(),
    name: String(w.name).trim(),
    lat: num(w.lat), lon: num(w.lon),
    totalDepth: num(w.totalDepth), groundElevation: num(w.groundElevation),
  };
}
