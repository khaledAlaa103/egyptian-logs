import { usePrefs } from '../../app/PrefsContext.jsx';
import { WATER_INFO } from '../../engine/water/waterInfo.js';

const f4 = (v) => (v == null || !Number.isFinite(v) ? '—' : Number(v.toPrecision(5)).toString());

/** Full traceability block of a water-quality calculation: equation, inputs, units, Tref, calibration source, validity, assumptions, uncertainty. */
export default function WaterTrace({ methods, inputs, tRef = 25, calibration, uncertainty, flags = [] }) {
  const { t, lang } = usePrefs();
  return (
    <div className="water-trace small">
      <p><strong>{t('wq.trace.inputs')}:</strong> {inputs.map((i) => `${i.name} = ${f4(i.value)}${i.unit ? ' ' + i.unit : ''}`).join(' · ')}</p>
      <p><strong>{t('wq.trace.tref')}:</strong> {tRef} °C</p>
      {calibration && (
        <p><strong>{t('wq.trace.calibration')}:</strong> {t(`wq.models.${calibration.model}`)} — {calibration.source === 'manual' ? `${t('wq.mode.manual')}: ${calibration.sourceText}` : `${t('wq.mode.local')} (n=${calibration.n})`}
          {calibration.range ? ` · EC25 ${f4(calibration.range[0])}–${f4(calibration.range[1])} µS/cm` : ''}</p>
      )}
      <p><strong>{t('wq.trace.uncertainty')}:</strong> {uncertainty?.relPct != null ? `± ${f4(uncertainty.relPct)} %` : t('wq.trace.notQuantified')}
        {uncertainty ? ` (${t('wq.trace.cal')}: ${uncertainty.parts.calibration != null ? f4(uncertainty.parts.calibration * 100) + ' %' : '—'}; Rw: ${uncertainty.parts.rw != null ? f4(uncertainty.parts.rw * 100) + ' %' : '—'})` : ''}</p>
      {flags.length > 0 && <p className="err">{flags.map((x) => t(`wq.flag.${x}`)).join(' · ')}</p>}
      {methods.map((id) => {
        const m = WATER_INFO[id];
        if (!m) return null;
        return (
          <details key={id} className="method">
            <summary><strong>{m.name[lang]}</strong></summary>
            <p dir="ltr" className="eq">{m.equation}</p>
            <p><strong>{t('interp.mSource')}:</strong> {m.source}</p>
            <p><strong>{t('interp.mAssumptions')}:</strong></p>
            <ul>{m.assumptions[lang].map((a) => <li key={a}>{a}</li>)}</ul>
            <p><strong>{t('interp.mUncertainty')}:</strong> {m.uncertainty[lang]}</p>
            <p><strong>{t('interp.mValidity')}:</strong> {m.validity[lang]}</p>
          </details>
        );
      })}
    </div>
  );
}
