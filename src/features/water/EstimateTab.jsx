import { useMemo, useState } from 'react';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { NumField, Check } from '../interpretation/fields.jsx';
import { statsInInterval } from '../../results/intervalStats.js';
import { normalizeEc, predictTds, classifySalinity, INSUFFICIENT } from '../../engine/water/water.js';
import { estimateIntervals } from '../../results/waterEstimates.js';
import { applyWaterQuality, clearWaterQuality } from '../../db/water.js';
import WaterTrace from './WaterTrace.jsx';

const f4 = (v) => (v == null || !Number.isFinite(v) ? '—' : Number(v.toPrecision(4)).toString());

export default function EstimateTab({ w }) {
  const { t } = usePrefs();
  const { settings, setSettings, calibration: cal, normalization, normOk, rows, run, runs, samples, curves } = w;
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState(null);
  const [fluid, setFluid] = useState(false);
  const [fluidOk, setFluidOk] = useState(false);

  const ready = normOk && cal?.ok;

  const items = useMemo(() => {
    const base = estimateIntervals({ rows, run, curves, samples, normalization, calibration: cal, rwUncertaintyPct: settings.rwUncertaintyPct, ready });
    return base.map((it) => {
      // optional: borehole-fluid EC (only under an explicit assumption)
      let fl = null;
      if (fluid && fluidOk && ready && curves.fluid_ec && it.tC != null) {
        const st = statsInInterval(curves.fluid_ec.depth, curves.fluid_ec.values, it.f.top, it.f.bottom, 'arith');
        if (st.n) {
          const ec = normalizeEc(st.mean * 10, it.tC, normalization); // mS/m -> µS/cm
          if (ec.status !== INSUFFICIENT) { const p = predictTds(cal, ec.value); if (p.status !== INSUFFICIENT) fl = { tds: p.value, ec25: ec.value, tC: it.tC, flags: [...p.flags, 'fluid_ec_assumed'] }; }
        }
      }
      return { ...it, fl };
    });
  }, [rows, run, curves, samples, ready, normalization, cal, settings.rwUncertaintyPct, fluid, fluidOk]);

  const applyEst = async (it) => {
    const e = it.est;
    await applyWaterQuality(it.f.id, { tds: e.tds, basis: 'indirect', status: 'estimated', method: e.trace.methods[2], ec25: e.ec25, rw: e.rw, tC: e.tC, relPct: e.uncertainty.relPct, flags: e.flags, class: e.class, calibration: e.trace.calibration });
  };
  const applyDirect = async (it) => {
    await applyWaterQuality(it.f.id, { tds: it.directTds, basis: 'direct', status: 'measured', method: 'lab_sample', sampleId: it.inside.filter((s) => s.tds).map((s) => s.sampleId).join(', '), flags: [], class: classifySalinity(it.directTds) });
  };
  const applyFluid = async (it) => {
    await applyWaterQuality(it.f.id, { tds: it.fl.tds, basis: 'indirect', status: 'estimated', method: 'fluid_ec', ec25: it.fl.ec25, tC: it.fl.tC, relPct: null, flags: it.fl.flags, class: classifySalinity(it.fl.tds), calibration: cal ? { model: cal.model, params: cal.params, source: cal.source, sourceText: cal.sourceText ?? null, n: cal.n, range: cal.range } : null });
  };
  const applyAll = async () => {
    let n = 0;
    for (const it of items) if (it.est) { await applyEst(it); n++; }
    setMsg(t('wq.appliedN').replace('{n}', n));
  };

  const sel = items.find((i) => i.f.id === open);

  return (
    <div>
      <div className="notice bad small">{t('wq.rwNotRt')}</div>
      <div className="toolbar wrap" style={{ margin: '.8rem 0' }}>
        <label className="inline"><span>{t('res.run')}</span>
          <select value={settings.runId ?? ''} aria-label={t('res.run')} onChange={(e) => setSettings((s) => ({ ...s, runId: e.target.value === '' ? null : e.target.value === 'none' ? 'none' : Number(e.target.value) }))}>
            <option value="">{t('res.latestRun')}</option><option value="none">{t('res.noRun')}</option>
            {runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select></label>
        <NumField label={t('wq.rwUncertainty')} unit="%" value={settings.rwUncertaintyPct} onChange={(x) => setSettings((s) => ({ ...s, rwUncertaintyPct: x }))} help={t('wq.rwUncertaintyHelp')} />
        {run && <span className="muted small">{t('wq.rwMethodOfRun')}: <strong>{run.config?.rw?.method ? t(`interp.rwMethod.${run.config.rw.method}`) : '—'}</strong></span>}
      </div>
      {!ready && <div className="notice bad small" role="alert">{t('wq.notReady')}</div>}
      {curves.fluid_ec && (
        <div className="card small" style={{ marginBottom: '.8rem' }}>
          <Check label={t('wq.useFluid')} checked={fluid} onChange={setFluid} />
          {fluid && <Check label={t('wq.fluidAssume')} checked={fluidOk} onChange={setFluidOk} />}
          <p className="muted small">{t('wq.fluidNote')}</p>
        </div>
      )}

      {items.length === 0 ? <p className="muted">{t('viewer.noFormations')}</p> : (
        <div className="table-wrap">
          <table className="data compact">
            <thead><tr><th>#</th><th>{t('res.col.name')}</th><th className="num">Rw (Ω·m)</th><th className="num">T (°C)</th><th className="num">EC25 (µS/cm)</th>
              <th className="num">{t('wq.tdsEst')} (mg/L)</th><th className="num">±%</th><th className="num">{t('wq.nacl')}</th><th>{t('wq.class')}</th>
              <th className="num">{t('wq.tdsDirect')}</th><th className="num">Δ%</th>{fluid && fluidOk && <th className="num">{t('wq.tdsFluid')}</th>}<th /></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.f.id} className={open === it.f.id ? 'sel' : ''} onClick={() => setOpen(it.f.id)} style={{ cursor: 'pointer' }}>
                  <td>{it.row.cells.number.v}</td><td>{it.f.name || '—'}</td>
                  <td className="num">{f4(it.rw)}{it.rw != null && <span className="muted small"> ({t(`res.status.${it.rwStatus}`)})</span>}</td>
                  <td className="num">{f4(it.tC)}</td><td className="num">{f4(it.est?.ec25)}</td>
                  <td className="num"><strong>{f4(it.est?.tds)}</strong>{it.est?.flags?.length ? ' ⚠' : ''}</td>
                  <td className="num">{it.est ? (it.est.uncertainty.relPct != null ? f4(it.est.uncertainty.relPct) : t('wq.nq')) : '—'}</td>
                  <td className="num">{it.est?.naclPpm != null ? f4(it.est.naclPpm) : '—'}</td>
                  <td>{it.est?.class ? t(`wq.cls.${it.est.class}`) : (it.reason ? <span className="muted small">{t(`wq.reason.${it.reason}`)}</span> : '—')}</td>
                  <td className="num">{f4(it.directTds)}</td><td className="num">{it.diffPct != null ? `${it.diffPct > 0 ? '+' : ''}${f4(it.diffPct)}` : '—'}</td>
                  {fluid && fluidOk && <td className="num">{it.fl ? f4(it.fl.tds) : '—'}</td>}
                  <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                    {it.est && <button className="btn sm" onClick={() => applyEst(it)}>{t('wq.applyEst')}</button>}
                    {it.directTds != null && <button className="btn sm" onClick={() => applyDirect(it)}>{t('wq.applyDirect')}</button>}
                    {it.fl && <button className="btn sm" onClick={() => applyFluid(it)}>{t('wq.applyFluid')}</button>}
                    {it.f.waterQuality && <button className="icon-x" aria-label={`${t('wq.clearApplied')} ${it.f.name}`} title={t('wq.clearApplied')} onClick={() => clearWaterQuality(it.f.id)}>⌫</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="toolbar" style={{ marginTop: '.6rem' }}>
        <button className="btn primary" disabled={!items.some((i) => i.est)} onClick={applyAll}>{t('wq.applyAll')}</button>
        <span className="muted small">{t('wq.applyNote')}</span>
      </div>
      {msg && <div className="notice ok small" role="status">{msg}</div>}

      {sel?.est && (
        <div className="card" style={{ marginTop: '.8rem' }}>
          <h3>{t('wq.trace.title')} — #{sel.row.cells.number.v} {sel.f.name}</h3>
          <WaterTrace methods={sel.est.trace.methods} calibration={sel.est.trace.calibration} uncertainty={sel.est.uncertainty} flags={sel.est.flags}
            inputs={[{ name: 'Rw', value: sel.est.rw, unit: 'Ω·m' }, { name: 'T', value: sel.est.tC, unit: '°C' }, { name: 'EC25', value: sel.est.ec25, unit: 'µS/cm' }, { name: 'TDS', value: sel.est.tds, unit: 'mg/L' }]} />
        </div>
      )}
    </div>
  );
}
