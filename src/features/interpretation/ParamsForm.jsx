import { usePrefs } from '../../app/PrefsContext.jsx';
import { getLog, logName } from '../../registry/logRegistry.js';
import { NumField, SelectField, TextField, Check, Section } from './fields.jsx';

const PRESETS = {
  matrix: [
    { id: 'sandstone', rhoMa: 2.65, dtMa: 55.5 }, { id: 'limestone', rhoMa: 2.71, dtMa: 47.5 }, { id: 'dolomite', rhoMa: 2.87, dtMa: 43.5 },
  ],
  fluid: [{ id: 'fresh', rhoFl: 1.0, dtFl: 189 }, { id: 'brine', rhoFl: 1.1, dtFl: 185 }],
  archie: [{ id: 'archie', a: 1, m: 2, n: 2 }, { id: 'humble', a: 0.62, m: 2.15, n: 2 }],
};

export const emptyConfig = (grid) => ({
  grid: { curveId: grid || '' },
  temperature: {}, resistivity: { cond: {} }, rw: {}, vshale: {}, porosity: { curves: {}, shaleCorrection: {} }, saturation: {},
});

// percentile helper for the explicit "suggest baselines" action
export function percentile(values, p) {
  const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.max(0, Math.floor((p / 100) * (v.length - 1))))] : undefined;
}

export default function ParamsForm({ cfg, setCfg, avail, curves }) {
  const { t, lang } = usePrefs();
  const set = (path, value) => setCfg((c) => {
    const n = JSON.parse(JSON.stringify(c));
    let o = n;
    path.slice(0, -1).forEach((k) => { o[k] ||= {}; o = o[k]; });
    o[path[path.length - 1]] = value;
    return n;
  });
  const opts = (filter) => avail.filter((id) => !filter || filter(getLog(id))).map((id) => {
    const d = getLog(id);
    return { value: id, label: `${d?.abbr || id} — ${d ? logName(d, lang) : ''}` };
  });
  const resOpts = opts((d) => d?.group === 'resistivity');
  const M = (key, list) => list.map((x) => ({ value: x, label: t(`interp.${key}.${x}`) }));
  const r = cfg.resistivity, rw = cfg.rw, v = cfg.vshale, p = cfg.porosity, s = cfg.saturation, tp = cfg.temperature;

  const suggestGR = () => {
    const c = curves[v.curve];
    if (!c) return;
    set(['vshale', 'grClean'], Number(percentile(c.values, 5).toFixed(1)));
    set(['vshale', 'grShale'], Number(percentile(c.values, 95).toFixed(1)));
  };
  const apply = (obj) => Object.entries(obj).forEach(([k, val]) => { if (k !== 'id') set(['porosity', k], val); });
  const applyArchie = (obj) => Object.entries(obj).forEach(([k, val]) => { if (k !== 'id') set(['saturation', k], val); });

  return (
    <div className="params">
      <Section title={t('interp.sec.grid')} note={t('interp.sec.gridNote')}>
        <SelectField label={t('interp.gridCurve')} value={cfg.grid.curveId} onChange={(x) => set(['grid', 'curveId'], x)} options={opts()} />
        <NumField label={t('viewer.from')} unit="m" value={cfg.grid.top} onChange={(x) => set(['grid', 'top'], x)} />
        <NumField label={t('viewer.to')} unit="m" value={cfg.grid.bottom} onChange={(x) => set(['grid', 'bottom'], x)} />
      </Section>

      <Section title={t('interp.sec.temp')} note={t('interp.sec.tempNote')}>
        <SelectField label={t('interp.method')} value={tp.method} onChange={(x) => set(['temperature', 'method'], x)} options={M('tempMethod', ['constant', 'gradient', 'curve'])} />
        {tp.method === 'constant' && <NumField label={t('interp.tFormation')} unit="°C" value={tp.value} onChange={(x) => set(['temperature', 'value'], x)} />}
        {tp.method === 'gradient' && <>
          <NumField label={t('interp.tSurface')} unit="°C" value={tp.surface} onChange={(x) => set(['temperature', 'surface'], x)} />
          <NumField label={t('interp.gradient')} unit="°C/100 m" value={tp.gradient} onChange={(x) => set(['temperature', 'gradient'], x)} />
        </>}
        {tp.method === 'curve' && <SelectField label={t('interp.tCurve')} value={tp.curveId} onChange={(x) => set(['temperature', 'curveId'], x)} options={opts((d) => d?.group === 'temperature')} />}
        <TextField label={t('interp.source')} value={tp.source} onChange={(x) => set(['temperature', 'source'], x)} help={t('interp.sourceHelp')} />
      </Section>

      <Section title={t('interp.sec.rt')} note={t('interp.sec.rtNote')}>
        <SelectField label={t('interp.rtCurve')} value={r.rtCurve} onChange={(x) => set(['resistivity', 'rtCurve'], x)} options={resOpts} />
        <SelectField label={t('interp.rtMethodLabel')} value={r.method} onChange={(x) => set(['resistivity', 'method'], x)} options={M('rtMethod', ['none', 'direct', 'geometric', 'factor'])} />
        {r.method === 'direct' && (
          <div className="wide">
            <p className="muted small">{t('interp.directNote')}</p>
            <Check label={t('interp.cond.thickBed')} checked={r.cond?.thickBed} onChange={(x) => set(['resistivity', 'cond', 'thickBed'], x)} />
            <Check label={t('interp.cond.invasionNegligible')} checked={r.cond?.invasionNegligible} onChange={(x) => set(['resistivity', 'cond', 'invasionNegligible'], x)} />
            <Check label={t('interp.cond.boreholeNegligible')} checked={r.cond?.boreholeNegligible} onChange={(x) => set(['resistivity', 'cond', 'boreholeNegligible'], x)} />
          </div>
        )}
        {r.method === 'geometric' && <>
          <SelectField label={t('interp.rxoCurve')} value={r.rxoCurve} onChange={(x) => set(['resistivity', 'rxoCurve'], x)} options={resOpts} />
          <NumField label="J" value={r.J} onChange={(x) => set(['resistivity', 'J'], x)} help={t('interp.jHelp')} />
        </>}
        {r.method === 'factor' && <>
          <NumField label="K" value={r.factor} onChange={(x) => set(['resistivity', 'factor'], x)} />
          <TextField label={t('interp.factorSource')} required value={r.factorSource} onChange={(x) => set(['resistivity', 'factorSource'], x)} help={t('interp.factorHelp')} />
        </>}
      </Section>

      <Section title={t('interp.sec.rw')} note={t('interp.sec.rwNote')}>
        <SelectField label={t('interp.method')} value={rw.method} onChange={(x) => set(['rw', 'method'], x)} options={M('rwMethod', ['manual', 'sp', 'rwa_min'])} />
        {rw.method === 'manual' && <>
          <NumField label="Rw" unit="Ω·m" value={rw.value} onChange={(x) => set(['rw', 'value'], x)} />
          <NumField label={t('interp.rwRefTemp')} unit="°C" value={rw.refTemp} onChange={(x) => set(['rw', 'refTemp'], x)} />
          <TextField label={t('interp.rwSource')} required value={rw.source} onChange={(x) => set(['rw', 'source'], x)} help={t('interp.rwSourceHelp')} />
        </>}
        {rw.method === 'sp' && <>
          <NumField label="SP clean" unit="mV" value={rw.spClean} onChange={(x) => set(['rw', 'spClean'], x)} />
          <NumField label="SP shale" unit="mV" value={rw.spShale} onChange={(x) => set(['rw', 'spShale'], x)} help={t('interp.sspHelp')} />
          <NumField label="Rmf" unit="Ω·m" value={rw.rmf} onChange={(x) => set(['rw', 'rmf'], x)} />
          <NumField label={t('interp.rmfTemp')} unit="°C" value={rw.rmfTemp} onChange={(x) => set(['rw', 'rmfTemp'], x)} />
          <NumField label="Rmfe" unit="Ω·m" value={rw.rmfe} onChange={(x) => set(['rw', 'rmfe'], x)} help={t('interp.rmfeHelp')} />
          <NumField label={t('interp.rmfeTemp')} unit="°C" value={rw.rmfeTemp} onChange={(x) => set(['rw', 'rmfeTemp'], x)} />
        </>}
        {rw.method === 'rwa_min' && <>
          <NumField label={t('interp.wetTop')} unit="m" value={rw.interval?.top} onChange={(x) => set(['rw', 'interval', 'top'], x)} />
          <NumField label={t('interp.wetBottom')} unit="m" value={rw.interval?.bottom} onChange={(x) => set(['rw', 'interval', 'bottom'], x)} />
          <p className="muted small wide">{t('interp.rwaNote')}</p>
        </>}
      </Section>

      <Section title={t('interp.sec.vsh')} note={t('interp.sec.vshNote')}>
        <SelectField label={t('interp.vshModelLabel')} value={v.model} onChange={(x) => set(['vshale', 'model'], x)}
          options={[...M('vshModel', ['linear', 'larionov_tertiary', 'larionov_older', 'clavier', 'steiber']), { value: 'sp_linear', label: t('interp.vshModel.sp_linear') }]} />
        <SelectField label={t('interp.vshCurve')} value={v.curve} onChange={(x) => set(['vshale', 'curve'], x)} options={opts((d) => (v.model === 'sp_linear' ? d?.id === 'sp' : d?.id === 'gr' || d?.id === 'sgr'))} />
        {v.model && v.model !== 'sp_linear' && <>
          <NumField label="GR clean" unit="gAPI" value={v.grClean} onChange={(x) => set(['vshale', 'grClean'], x)} />
          <NumField label="GR shale" unit="gAPI" value={v.grShale} onChange={(x) => set(['vshale', 'grShale'], x)} />
          <button type="button" className="btn sm" disabled={!curves[v.curve]} onClick={suggestGR}>{t('interp.suggestGR')}</button>
        </>}
        {v.model === 'sp_linear' && <>
          <NumField label="SP clean" unit="mV" value={v.spClean} onChange={(x) => set(['vshale', 'spClean'], x)} />
          <NumField label="SP shale" unit="mV" value={v.spShale} onChange={(x) => set(['vshale', 'spShale'], x)} />
        </>}
      </Section>

      <Section title={t('interp.sec.phi')} note={t('interp.sec.phiNote')}>
        <SelectField label={t('interp.method')} value={p.method} onChange={(x) => set(['porosity', 'method'], x)} options={M('phiMethod', ['density', 'sonic_wyllie', 'sonic_rhg', 'neutron', 'neutron_density'])} />
        {['density', 'neutron_density'].includes(p.method) && <SelectField label={t('interp.densityCurve')} value={p.curves?.density} onChange={(x) => set(['porosity', 'curves', 'density'], x)} options={opts((d) => d?.id === 'density')} />}
        {['sonic_wyllie', 'sonic_rhg'].includes(p.method) && <SelectField label={t('interp.sonicCurve')} value={p.curves?.sonic} onChange={(x) => set(['porosity', 'curves', 'sonic'], x)} options={opts((d) => d?.group === 'sonic')} />}
        {['neutron', 'neutron_density'].includes(p.method) && <SelectField label={t('interp.neutronCurve')} value={p.curves?.neutron} onChange={(x) => set(['porosity', 'curves', 'neutron'], x)} options={opts((d) => d?.id === 'neutron' || d?.id === 'nmr')} />}
        {['density', 'neutron_density'].includes(p.method) && <>
          <NumField label="ρma" unit="g/cm³" value={p.rhoMa} onChange={(x) => set(['porosity', 'rhoMa'], x)} />
          <NumField label="ρf" unit="g/cm³" value={p.rhoFl} onChange={(x) => set(['porosity', 'rhoFl'], x)} />
        </>}
        {['sonic_wyllie', 'sonic_rhg'].includes(p.method) && <NumField label="Δtma" unit="µs/ft" value={p.dtMa} onChange={(x) => set(['porosity', 'dtMa'], x)} />}
        {p.method === 'sonic_wyllie' && <>
          <NumField label="Δtf" unit="µs/ft" value={p.dtFl} onChange={(x) => set(['porosity', 'dtFl'], x)} />
          <NumField label="Cp" value={p.cp} onChange={(x) => set(['porosity', 'cp'], x)} help={t('interp.cpHelp')} />
        </>}
        <div className="wide presets">
          <span className="muted small">{t('interp.presets')}:</span>
          {PRESETS.matrix.map((x) => <button type="button" key={x.id} className="btn sm" onClick={() => apply({ rhoMa: x.rhoMa, dtMa: x.dtMa })}>{t(`interp.lith.${x.id}`)}</button>)}
          {PRESETS.fluid.map((x) => <button type="button" key={x.id} className="btn sm" onClick={() => apply({ rhoFl: x.rhoFl, dtFl: x.dtFl })}>{t(`interp.fluid.${x.id}`)}</button>)}
        </div>
        <Check label={t('interp.shaleCorr')} checked={p.shaleCorrection?.enabled} onChange={(x) => set(['porosity', 'shaleCorrection', 'enabled'], x)} />
        {p.shaleCorrection?.enabled && <NumField label="φsh" value={p.shaleCorrection.phiShale} onChange={(x) => set(['porosity', 'shaleCorrection', 'phiShale'], x)} />}
      </Section>

      <Section title={t('interp.sec.sw')} note={t('interp.sec.swNote')}>
        <SelectField label={t('interp.swModelLabel')} value={s.model} onChange={(x) => set(['saturation', 'model'], x)} options={M('swModel', ['archie', 'simandoux', 'indonesia'])} />
        <NumField label="a" value={s.a} onChange={(x) => set(['saturation', 'a'], x)} />
        <NumField label="m" value={s.m} onChange={(x) => set(['saturation', 'm'], x)} />
        <NumField label="n" value={s.n} onChange={(x) => set(['saturation', 'n'], x)} />
        <div className="wide presets">
          <span className="muted small">{t('interp.presets')}:</span>
          {PRESETS.archie.map((x) => <button type="button" key={x.id} className="btn sm" onClick={() => applyArchie({ a: x.a, m: x.m, n: x.n })}>{t(`interp.arch.${x.id}`)}</button>)}
        </div>
        <NumField label={t('interp.vshLimit')} value={s.vshLimit} onChange={(x) => set(['saturation', 'vshLimit'], x)} help={t('interp.vshLimitHelp')} />
        {s.model && s.model !== 'archie' && <NumField label="Rsh" unit="Ω·m" value={s.rsh} onChange={(x) => set(['saturation', 'rsh'], x)} help={t('interp.rshHelp')} />}
      </Section>
    </div>
  );
}
