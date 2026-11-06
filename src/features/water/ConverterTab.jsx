import { useMemo, useState } from 'react';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { NumField, SelectField } from '../interpretation/fields.jsx';
import { rwToEc, ecToRw, normalizeEc, predictTds, naclEquivalent, classifySalinity, INSUFFICIENT } from '../../engine/water/water.js';
import WaterTrace from './WaterTrace.jsx';

const f4 = (v) => (v == null || !Number.isFinite(v) ? '—' : Number(v.toPrecision(5)).toString());
const EC_U = { 'uS/cm': 1, 'mS/cm': 1000, 'mS/m': 10, 'S/m': 10000 };

/** Single-value converter with the full traceability block. Uses the normalisation and calibration chosen in the Calibration tab. */
export default function ConverterTab({ w }) {
  const { t } = usePrefs();
  const [mode, setMode] = useState('rw');
  const [val, setVal] = useState();
  const [unit, setUnit] = useState('uS/cm');
  const [tC, setTC] = useState();
  const { normalization, normOk, calibration: cal } = w;

  const out = useMemo(() => {
    if (!(val > 0) || !Number.isFinite(tC)) return null;
    const methods = [];
    let ecT, rw;
    if (mode === 'rw') { rw = val; ecT = rwToEc(val) * 10; methods.push('rw_to_ec'); }
    else { ecT = val * EC_U[unit]; rw = ecToRw(ecT / 10); methods.push('rw_to_ec'); }
    const r = { rw, ecT, methods };
    if (normOk) {
      const n = normalizeEc(ecT, tC, normalization);
      if (n.status !== INSUFFICIENT) { r.ec25 = n.value; methods.push(n.method); }
      if (r.ec25 && cal?.ok) { const p = predictTds(cal, r.ec25); if (p.status !== INSUFFICIENT) { r.tds = p.value; r.flags = p.flags; methods.push(p.method); r.cls = classifySalinity(p.value); } }
    }
    const nc = naclEquivalent(rw, tC);
    if (nc.status !== INSUFFICIENT) { r.nacl = nc.value; methods.push('nacl_equiv'); }
    if (r.cls) methods.push('class_winslow');
    return r;
  }, [mode, val, unit, tC, normOk, normalization, cal]);

  return (
    <div>
      <div className="notice bad small">{t('wq.rwNotRt')}</div>
      <div className="card" style={{ marginTop: '.8rem' }}>
        <div className="igrid sgrid">
          <SelectField label={t('wq.convFrom')} value={mode} onChange={(x) => setMode(x || 'rw')} options={[{ value: 'rw', label: t('wq.convRw') }, { value: 'ec', label: t('wq.convEc') }]} />
          <NumField label={mode === 'rw' ? 'Rw' : 'EC'} unit={mode === 'rw' ? 'Ω·m' : undefined} value={val} onChange={setVal} />
          {mode === 'ec' && <label className="ifield"><span>{t('wq.ecUnit')}</span><select value={unit} aria-label={t('wq.ecUnit')} onChange={(e) => setUnit(e.target.value)}><option value="uS/cm">µS/cm</option><option value="mS/cm">mS/cm</option><option value="mS/m">mS/m</option><option value="S/m">S/m</option></select></label>}
          <NumField label={t('wq.measTemp')} unit="°C" value={tC} onChange={setTC} />
        </div>
      </div>
      {!out && <p className="muted small">{t('wq.convHint')}</p>}
      {out && (
        <div className="card" style={{ marginTop: '.8rem' }}>
          <div className="stat-grid">
            <div className="card stat"><div className="stat-value" dir="ltr">{f4(out.rw)}</div><div className="stat-label">Rw (Ω·m) @ T</div></div>
            <div className="card stat"><div className="stat-value" dir="ltr">{f4(out.ecT)}</div><div className="stat-label">EC (µS/cm) @ T</div></div>
            <div className="card stat"><div className="stat-value" dir="ltr">{f4(out.ec25)}</div><div className="stat-label">EC25 (µS/cm)</div></div>
            <div className="card stat"><div className="stat-value" dir="ltr">{f4(out.tds)}</div><div className="stat-label">TDS (mg/L) — {t('wq.indirect')}</div></div>
            <div className="card stat"><div className="stat-value" dir="ltr">{f4(out.nacl)}</div><div className="stat-label">{t('wq.nacl')}</div></div>
          </div>
          {!normOk && <div className="notice bad small">{t('wq.needNorm')}</div>}
          {normOk && !cal?.ok && <div className="notice bad small">{t('wq.needCal')}</div>}
          {out.cls && <p>{t('wq.class')}: <strong>{t(`wq.cls.${out.cls}`)}</strong></p>}
          <WaterTrace methods={out.methods} calibration={cal?.ok ? { model: cal.model, params: cal.params, source: cal.source, sourceText: cal.sourceText, n: cal.n, range: cal.range } : null}
            uncertainty={cal?.ok ? { relPct: null, parts: { calibration: cal.relRmse ?? null, rw: null } } : null} flags={out.flags || []}
            inputs={[{ name: mode === 'rw' ? 'Rw' : 'EC', value: val, unit: mode === 'rw' ? 'Ω·m' : unit }, { name: 'T', value: tC, unit: '°C' }]} />
        </div>
      )}
    </div>
  );
}
