import { usePrefs } from '../../app/PrefsContext.jsx';
import { NumField, SelectField, TextField } from '../interpretation/fields.jsx';
import { predictTds } from '../../engine/water/water.js';

const f4 = (v) => (v == null || !Number.isFinite(v) ? '—' : Number(v.toPrecision(4)).toString());

function Scatter({ pairs, cal }) {
  const W = 360, H = 240, pad = 38;
  if (!pairs.length) return null;
  const xs = pairs.map((p) => p.ec25), ys = pairs.map((p) => p.tds);
  const x0 = 0, x1 = Math.max(...xs) * 1.1, y0 = 0, y1 = Math.max(...ys, ...(cal?.ok ? [predictTds(cal, x1).value || 0] : [])) * 1.1;
  const sx = (x) => pad + (x / x1) * (W - pad - 10), sy = (y) => H - pad - (y / y1) * (H - pad - 10);
  const line = cal?.ok ? [x0, x1].map((x) => ({ x, y: predictTds(cal, Math.max(x, 1)).value })).filter((p) => p.y != null) : [];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, color: 'var(--text)' }} role="img" aria-label="EC25 vs TDS" dir="ltr">
      <rect x={pad} y="10" width={W - pad - 10} height={H - pad - 10} fill="none" stroke="currentColor" opacity=".3" />
      {[0, 0.5, 1].map((k) => <g key={k}><text x={pad + k * (W - pad - 10)} y={H - pad + 14} fontSize="9" textAnchor="middle" fill="currentColor">{f4(x1 * k)}</text>
        <text x={pad - 4} y={sy(y1 * k) + 3} fontSize="9" textAnchor="end" fill="currentColor">{f4(y1 * k)}</text></g>)}
      <text x={W / 2} y={H - 4} fontSize="10" textAnchor="middle" fill="currentColor">EC25 (µS/cm)</text>
      <text x="10" y="12" fontSize="10" fill="currentColor">TDS (mg/L)</text>
      {line.length === 2 && <line x1={sx(line[0].x)} y1={sy(line[0].y)} x2={sx(line[1].x)} y2={sy(line[1].y)} stroke="#0891b2" strokeWidth="1.5" />}
      {pairs.map((p, i) => <circle key={i} cx={sx(p.ec25)} cy={sy(p.tds)} r="3.5" fill="#dc2626"><title>{p.sampleId}: {f4(p.ec25)} → {f4(p.tds)}</title></circle>)}
    </svg>
  );
}

export default function CalibrationTab({ w }) {
  const { t } = usePrefs();
  const { settings, setSettings, calibration: cal, pairs, normOk } = w;
  const set = (path, value) => setSettings((s) => {
    const n = JSON.parse(JSON.stringify(s));
    let o = n; path.slice(0, -1).forEach((k) => { o[k] ||= {}; o = o[k]; });
    o[path[path.length - 1]] = value;
    return n;
  });
  const nm = settings.normalization, c = settings.calibration;

  return (
    <div>
      <div className="notice bad small">{t('wq.noRtTds')}</div>
      <div className="card" style={{ marginTop: '.8rem' }}>
        <h3>{t('wq.normTitle')}</h3>
        <p className="muted small">{t('wq.normNote')}</p>
        <div className="igrid sgrid">
          <SelectField label={t('wq.normMethod')} value={nm.method} onChange={(x) => set(['normalization', 'method'], x)}
            options={[{ value: 'arps', label: t('wq.norm.arps') }, { value: 'alpha', label: t('wq.norm.alpha') }]} />
          {nm.method === 'alpha' && <NumField label={t('wq.alpha')} unit="1/°C" value={nm.alpha} onChange={(x) => set(['normalization', 'alpha'], x)} help={t('wq.alphaHelp')} />}
        </div>
        {nm.method === 'alpha' && <div className="presets"><span className="muted small">{t('interp.presets')}:</span>
          {[0.019, 0.02, 0.021].map((a) => <button key={a} type="button" className="btn sm" onClick={() => set(['normalization', 'alpha'], a)}>{a}</button>)}</div>}
      </div>

      <div className="card" style={{ marginTop: '.8rem' }}>
        <h3>{t('wq.calTitle')}</h3>
        <p className="muted small">{t('wq.calNote')}</p>
        <div className="igrid sgrid">
          <SelectField label={t('wq.calMode')} value={c.mode} onChange={(x) => set(['calibration', 'mode'], x)} options={[{ value: 'local', label: t('wq.mode.local') }, { value: 'manual', label: t('wq.mode.manual') }]} />
          {c.mode === 'local' && <>
            <SelectField label={t('wq.model')} value={c.model} onChange={(x) => set(['calibration', 'model'], x || 'factor')} options={[{ value: 'factor', label: t('wq.models.factor') }, { value: 'linear', label: t('wq.models.linear') }, { value: 'power', label: t('wq.models.power') }]} />
            <SelectField label={t('wq.scope')} value={c.scope} onChange={(x) => set(['calibration', 'scope'], x || 'well')} options={[{ value: 'well', label: t('wq.scopeWell') }, { value: 'project', label: t('wq.scopeProject') }]} />
          </>}
          {c.mode === 'manual' && <>
            <NumField label="k (TDS / EC25)" value={c.manual?.k} onChange={(x) => set(['calibration', 'manual', 'k'], x)} help={t('wq.kHelp')} />
            <NumField label={t('wq.calUncertainty')} unit="%" value={c.manual?.uncertaintyPct} onChange={(x) => set(['calibration', 'manual', 'uncertaintyPct'], x)} help={t('wq.calUncertaintyHelp')} />
            <TextField label={t('wq.calSource')} required value={c.manual?.source} onChange={(x) => set(['calibration', 'manual', 'source'], x)} help={t('wq.calSourceHelp')} />
          </>}
        </div>
        {c.mode === 'manual' && <div className="presets"><span className="muted small">{t('wq.kRange')}</span></div>}
      </div>

      {c.mode === 'local' && !normOk && <div className="notice bad small" role="alert">{t('wq.needNorm')}</div>}
      {cal && !cal.ok && normOk !== false && c.mode && <div className="notice bad small" role="alert">{(cal.errors || []).map((e) => t(`wq.calerr.${e}`).replace('{n}', cal.needed ?? '')).join(' · ')}{cal.n != null && c.mode === 'local' ? ` (n=${cal.n})` : ''}</div>}
      {cal?.ok && (
        <div className="card" style={{ marginTop: '.8rem' }}>
          <h3>{t('wq.result')}</h3>
          <div className="stat-grid">
            <div className="card stat"><div className="stat-value" dir="ltr">{cal.model === 'factor' ? f4(cal.params.k) : cal.model === 'linear' ? `${f4(cal.params.a)} + ${f4(cal.params.b)}·x` : `${f4(cal.params.c)}·x^${f4(cal.params.d)}`}</div><div className="stat-label">{t(`wq.models.${cal.model}`)}</div></div>
            <div className="card stat"><div className="stat-value">{cal.n || '—'}</div><div className="stat-label">{t('wq.nPairs')}</div></div>
            <div className="card stat"><div className="stat-value" dir="ltr">{cal.relRmse != null ? `${f4(cal.relRmse * 100)} %` : '—'}</div><div className="stat-label">{t('wq.relRmse')}</div></div>
            <div className="card stat"><div className="stat-value" dir="ltr">{cal.r2 != null ? f4(cal.r2) : '—'}</div><div className="stat-label">R²</div></div>
          </div>
          {cal.range && <p className="small" dir="ltr">{t('wq.validRange')}: EC25 {f4(cal.range[0])} – {f4(cal.range[1])} µS/cm</p>}
          {cal.warnings.length > 0 && <div className="notice bad small">{cal.warnings.map((x) => t(`wq.calwarn.${x}`)).join(' · ')}</div>}
          {cal.source === 'manual' && <p className="small">{t('wq.calSource')}: {cal.sourceText}</p>}
          <Scatter pairs={pairs} cal={cal} />
        </div>
      )}
      {c.mode === 'local' && <p className="muted small">{t('wq.pairsInfo').replace('{n}', pairs.length)}</p>}
    </div>
  );
}
