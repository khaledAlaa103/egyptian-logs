import { useMemo, useState } from 'react';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { computeCurve, exportPoints } from '../../digitize/pipeline.js';
import { getLog } from '../../registry/logRegistry.js';
import { unitLabel } from '../../engine/units/units.js';
import { canonicalUnitOf } from '../../registry/logRegistry.js';
import { exportDigitized } from '../../db/images.js';

const fmt = (n) => (n == null || !Number.isFinite(n) ? '—' : Number(n.toPrecision(6)).toString());

/** Review digitised readings (with issues and quality) and export them into the workspace. */
export default function ExportPanel({ image, session, upd, imageSize, custom }) {
  const { t } = usePrefs();
  const [mode, setMode] = useState('replace');
  const [sel, setSel] = useState(null);
  const [msg, setMsg] = useState(null);

  const results = useMemo(() => session.curves.map((curve) => {
    const result = computeCurve(session, curve, imageSize, custom);
    return { curve, def: getLog(curve.curveId, custom), result, points: result.blocking.length ? [] : exportPoints(result, session.resample) };
  }), [session, imageSize, custom]);

  const ready = results.filter((r) => r.points.length);
  const view = results.find((r) => r.curve.id === sel) || results[0];

  const doExport = async () => {
    try {
      const n = await exportDigitized(image, ready, { mode, resample: session.resample, custom });
      setMsg({ ok: true, text: t('dig.exported').replace('{n}', n) });
    } catch {
      setMsg({ ok: false, text: t('err.invalidFile') });
    }
  };

  return (
    <div className="side-panel">
      <h3>{t('dig.reviewTitle')}</h3>
      {results.length === 0 && <p className="muted">{t('dig.nothingToExport')}</p>}
      {results.length > 0 && (
        <div className="table-wrap">
          <table className="data compact">
            <thead><tr><th>{t('imp.curve')}</th><th className="num">{t('imp.points')}</th><th>{t('imp.depthRange')}</th><th>{t('dig.status')}</th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.curve.id} className={view?.curve.id === r.curve.id ? 'sel' : ''} onClick={() => setSel(r.curve.id)} style={{ cursor: 'pointer' }}>
                  <td><strong>{r.def?.abbr}</strong></td>
                  <td className="num">{r.result.points.length}</td>
                  <td dir="ltr">{r.result.points.length ? `${fmt(r.result.points[0].depth)} – ${fmt(r.result.points[r.result.points.length - 1].depth)} m` : '—'}</td>
                  <td>{r.result.blocking.length ? <span className="err">{r.result.blocking.map((b) => t(`dig.block.${b}`)).join(', ')}</span> : (r.result.issues.length ? <span>⚠ {r.result.issues.length}</span> : '✓')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view && !view.result.blocking.length && (
        <>
          <h3>{t('dig.preview')} — {view.def?.abbr} ({unitLabel(canonicalUnitOf(view.def))})</h3>
          <p className="muted small">
            {t('dig.quality')}: {t('dig.resolution')} {fmt(view.result.quality.depthResolution)} m/px · {fmt(view.result.quality.valuePerPixel)} /px
            {view.result.quality.depthResidualPx != null && <> · {t('dig.residual')} {fmt(view.result.quality.depthResidualPx)} px</>}
          </p>
          {view.result.issues.length > 0 && (
            <ul className="small issues-inline">{view.result.issues.slice(0, 8).map((i, k) => (
              <li key={k}>⚠ {t(`dig.issue.${i.code}`).replace('{n}', i.n ?? '').replace('{value}', i.value != null ? fmt(i.value) : '')}</li>))}</ul>
          )}
          <div className="table-wrap" style={{ maxHeight: 240, overflow: 'auto' }}>
            <table className="data compact">
              <thead><tr><th>{t('imp.depth')} (m)</th><th>{t('dig.value')}</th><th>{t('dig.method')}</th><th>x,y px</th></tr></thead>
              <tbody>
                {view.result.points.slice(0, 40).map((p, i) => (
                  <tr key={i}><td dir="ltr">{fmt(p.depth)}</td><td dir="ltr">{fmt(p.value)}</td>
                    <td>{t(`dig.m_${p.method}`)}{p.flags.length ? ' ⚠' : ''}</td><td dir="ltr" className="muted">{p.px.toFixed(0)},{p.py.toFixed(0)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <fieldset className="track-box">
        <legend>{t('dig.exportTitle')}</legend>
        <label className="inline"><input type="checkbox" checked={session.resample.enabled} aria-label={t('dig.resample')}
          onChange={(e) => upd((s) => { s.resample.enabled = e.target.checked; })} /> {t('dig.resample')}</label>
        {session.resample.enabled && (
          <label className="inline"><span>{t('dig.step')} (m)</span>
            <input type="number" min="0.01" step="0.01" dir="ltr" value={session.resample.step} aria-label={t('dig.step')}
              onChange={(e) => upd((s) => { s.resample.step = Math.max(0.01, Number(e.target.value) || 0.5); })} /></label>
        )}
        <p className="muted small">{t('dig.resampleHint')}</p>
        <label className="inline"><span>{t('imp.ifExists')}</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="replace">{t('imp.replace')}</option><option value="merge">{t('imp.merge')}</option></select></label>
        <button className="btn primary" disabled={!ready.length} onClick={doExport}>{t('dig.exportBtn')}</button>
        {msg && <div className={`notice ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
      </fieldset>
    </div>
  );
}
