import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db.js';
import { loadSettings, saveSettings, calibrationSamples, listSamples } from '../../db/water.js';
import { fromSample } from '../../engine/water/water.js';
import { resolveCalibration } from '../../results/waterCalibration.js';
import useResultsData from '../results/useResultsData.js';

export const DEFAULT_SETTINGS = {
  normalization: {}, calibration: { mode: undefined, model: 'factor', scope: 'well', manual: {} }, rwUncertaintyPct: undefined, runId: null,
};

/** Shared state of the Water Quality module: samples, persisted settings, normalisation and calibration. */
export default function useWater(wellPk) {
  const [settings, setSettings] = useState(null);
  const loaded = useRef(null);
  const data = useResultsData(wellPk, settings?.runId, {});
  const samples = useLiveQuery(() => (wellPk ? listSamples(wellPk) : []), [wellPk], []);
  const projectSamples = useLiveQuery(async () => (wellPk && data.well ? calibrationSamples(data.well, 'project') : []), [wellPk, data.well?.projectId, samples], []);

  useEffect(() => {
    setSettings(null); loaded.current = null;
    if (!wellPk) return undefined;
    let alive = true;
    loadSettings(wellPk).then((s) => { if (alive) { loaded.current = s; setSettings(s || JSON.parse(JSON.stringify(DEFAULT_SETTINGS))); } });
    return () => { alive = false; };
  }, [wellPk]);
  useEffect(() => {
    if (!wellPk || !settings || settings === loaded.current) return undefined;
    const h = setTimeout(() => saveSettings(wellPk, settings), 500);
    return () => clearTimeout(h);
  }, [settings, wellPk]);

  const { normalization, normOk, pairs, calibration } = useMemo(
    () => resolveCalibration({ settings, samples, projectSamples }), [settings, samples, projectSamples]);
  const direct = useMemo(() => samples.map((s) => ({ s, r: fromSample(s, normalization) })), [samples, normalization]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...data, settings, setSettings, samples, direct, pairs, normalization, normOk, calibration };
}

export { db };
