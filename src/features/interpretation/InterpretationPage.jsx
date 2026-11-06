import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db.js';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { runInterpretation } from '../../engine/interpret.js';
import { loadConfig, saveConfig, saveInterpretation, listInterpretations, deleteInterpretation } from '../../db/interp.js';
import WellPicker from '../import/WellPicker.jsx';
import ParamsForm, { emptyConfig } from './ParamsForm.jsx';
import ResultsView from './ResultsView.jsx';

export default function InterpretationPage() {
  const { t } = usePrefs();
  const [wellPk, setWellPk] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState(null);
  const loaded = useRef(null);

  const well = useLiveQuery(() => (wellPk ? db.wells.get(wellPk) : undefined), [wellPk]);
  const rows = useLiveQuery(() => (wellPk ? db.logMeasurements.where('wellId').equals(wellPk).toArray() : []), [wellPk], []);
  const saved = useLiveQuery(() => (wellPk ? listInterpretations(wellPk) : []), [wellPk], []);

  const curves = useMemo(() => Object.fromEntries(rows.map((r) => [r.curveId, { depth: r.depth, values: r.values }])), [rows]);
  const avail = useMemo(() => Object.keys(curves), [curves]);

  // load / initialise config per well
  useEffect(() => {
    setCfg(null); setMsg(null); loaded.current = null;
    if (!wellPk) return undefined;
    let alive = true;
    loadConfig(wellPk).then((c) => { if (alive) { loaded.current = c; setCfg(c || emptyConfig('')); } });
    return () => { alive = false; };
  }, [wellPk]);

  // pick a sensible grid curve once data is known (a choice of grid, not a scientific parameter)
  useEffect(() => {
    if (!cfg || cfg.grid.curveId || !avail.length) return;
    const pref = ['res_deep', 'laterolog', 'induction', 'gr'].find((i) => avail.includes(i)) || avail[0];
    setCfg((c) => ({ ...c, grid: { ...c.grid, curveId: pref } }));
  }, [cfg, avail]);

  // autosave config
  useEffect(() => {
    if (!wellPk || !cfg || cfg === loaded.current) return undefined;
    const h = setTimeout(() => saveConfig(wellPk, cfg), 500);
    return () => clearTimeout(h);
  }, [cfg, wellPk]);

  const result = useMemo(() => (cfg && avail.length ? runInterpretation(cfg, curves) : null), [cfg, curves, avail.length]);

  const save = async () => {
    await saveInterpretation(wellPk, { name: name || new Date().toLocaleString(), config: cfg, result });
    setName(''); setMsg(t('interp.savedOk'));
  };

  return (
    <section className="page">
      <div className="page-head"><h1>{t('nav.interpretation')}</h1></div>
      <WellPicker value={wellPk} onChange={setWellPk} />
      {!wellPk && <div className="card empty"><p>{t('imp.selectWellFirst')}</p></div>}
      {wellPk && well && avail.length === 0 && <div className="card empty"><p>{t('viewer.noCurves')}</p><p className="muted small">{t('viewer.noCurvesHint')}</p></div>}

      {wellPk && well && avail.length > 0 && cfg && (
        <>
          <div className="notice ok small">{t('interp.principles')}</div>
          <div className="interp-grid">
            <div className="card"><ParamsForm cfg={cfg} setCfg={setCfg} avail={avail} curves={curves} /></div>
            <div className="card">
              <div className="toolbar wrap save-bar">
                <input placeholder={t('interp.runName')} value={name} onChange={(e) => setName(e.target.value)} aria-label={t('interp.runName')} />
                <button className="btn primary" disabled={!result || result.errors?.length || !result.depth.length} onClick={save}>{t('interp.saveRun')}</button>
              </div>
              {msg && <div className="notice ok small" role="status">{msg}</div>}
              {result && <ResultsView result={result} />}
              {saved.length > 0 && (
                <>
                  <h3>{t('interp.savedRuns')}</h3>
                  <ul className="img-list">
                    {saved.map((r) => (
                      <li key={r.id}><span className="grow">{r.name} <span className="muted small" dir="ltr">({r.depth.length})</span></span>
                        <button className="icon-x" aria-label={`${t('common.delete')} ${r.name}`} onClick={() => deleteInterpretation(r.id)}>×</button></li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
