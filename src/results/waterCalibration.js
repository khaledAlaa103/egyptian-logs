// Resolve the normalisation + EC25->TDS calibration from saved settings and samples. Pure JS.
import { fromSample, fitCalibration, manualCalibration } from '../engine/water/water.js';

export function resolveCalibration({ settings, samples, projectSamples }) {
  const normalization = settings?.normalization || {};
  const normOk = normalization.method === 'arps' || (normalization.method === 'alpha' && normalization.alpha > 0);
  const c = settings?.calibration;
  const calSamples = c?.scope === 'project' ? projectSamples : samples;
  const pairs = (calSamples || []).map((s) => fromSample(s, normalization)).filter((r) => r.tds && r.ec25)
    .map((r) => ({ ec25: r.ec25, tds: r.tds, sampleId: r.sampleId }));
  let calibration = null;
  if (c && c.mode) {
    if (c.mode === 'manual') calibration = manualCalibration({ k: c.manual?.k, source: c.manual?.source, uncertaintyPct: c.manual?.uncertaintyPct });
    else if (!normOk) calibration = { ok: false, errors: ['normalization_missing'] };
    else calibration = fitCalibration(pairs, c.model);
  }
  return { normalization, normOk, pairs, calibration };
}
