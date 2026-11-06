import { useState } from 'react';
import { usePrefs } from '../../app/PrefsContext.jsx';
import { METHOD_INFO } from '../../engine/methodsInfo.js';
import { SERIES } from '../../engine/interpret.js';

const fmt = (v) => (v == null ? '—' : Number(v.toPrecision(4)).toString());
const PARAMS = ['rt', 'vsh', 'phi', 'rw', 'f', 'sw'];
const CHARTS = [
  { id: 'rt', color: '#dc2626', log: true }, { id: 'vsh', color: '#92400e', min: 0, max: 1 },
  { id: 'phi', color: '#2563eb', min: 0, max: 0.5 }, { id: 'sw', color: '#0891b2', min: 0, max: 1 },
];

function Strip({ depth, values, color, log, min, max, label }) {
  const W = 120, H = 300, pad = 4;
  const ok = values.map((v, i) => [v, depth[i]]).filter(([v]) => v != null && (!log || v > 0));
  if (!ok.length) return <div className="strip empty-strip"><small>{label}</small><div className="muted small">—</div></div>;
  const vs = ok.map(([v]) => (log ? Math.log10(v) : v));
  const lo = min ?? (log ? Math.floor(Math.min(...vs)) : Math.min(...vs)), hi = max ?? (log ? Math.ceil(Math.max(...vs)) : Math.max(...vs));
  const d0 = depth[0], d1 = depth[depth.length - 1] || d0 + 1;
  const sx = (v) => pad + (((log ? Math.log10(v) : v) - lo) / (hi - lo || 1)) * (W - 2 * pad);
  const sy = (d) => pad + ((d - d0) / (d1 - d0 || 1)) * (H - 2 * pad);
  let path = '', pen = false;
  values.forEach((v, i) => {
    if (v == null || (log && v <= 0)) { pen = false; return; }
    path += `${pen ? 'L' : 'M'}${sx(v).toFixed(1)},${sy(depth[i]).toFixed(1)}`;
    pen = true;
  });
  return (
    <div className="strip">
      <small><strong>{label}</strong> <span dir="ltr" className="muted">{log ? `${(10 ** lo).toPrecision(2)}–${(10 ** hi).toPrecision(2)}` : `${fmt(lo)}–${fmt(hi)}`}</span></small>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={label}>
        <rect x="0.5" y="0.5" width={W - 1} height={H - 1} fill="none" stroke="currentColor" opacity=".25" />
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
      </svg>
    </div>
  );
}

export default function ResultsView({ result }) {
  const { t, lang } = usePrefs();
  const [page, setPage] = useState(0);
  const PAGE = 50;
  if (result.errors?.length) return <div className="notice bad" role="alert">{t(`interp.err.${result.errors[0]}`)}</div>;
  const n = result.depth.length;
  const total = Math.max(1, Math.ceil(n / PAGE));
  const p = Math.min(page, total - 1);
  const rows = result.depth.slice(p * PAGE, p * PAGE + PAGE).map((d, k) => ({ d, i: p * PAGE + k }));

  return (
    <div className="results">
      {(result.notes || []).map((n) => <div key={n} className="notice bad small" role="status">{t(`interp.note.${n}`)}</div>)}
      <h3>{t('interp.diag')}</h3>
      <div className="diag-grid">
        {PARAMS.map((id) => {
          const d = result.diagnostics[id];
          const ok = d ? d.computed : 0, bad = d ? d.missing : 0;
          return (
            <div key={id} className={`diag ${bad === 0 && ok > 0 ? 'good' : ok > 0 ? 'part' : 'none'}`}>
              <strong>{t(`interp.series.${id}`)}</strong>
              <span dir="ltr">{ok}/{ok + bad}</span>
              {bad > 0 && d && (
                <ul className="small">{Object.entries(d.reasons).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, c]) => (
                  <li key={k}>{t(`interp.reason.${k}`)} <span className="muted" dir="ltr">({c})</span></li>))}</ul>
              )}
            </div>
          );
        })}
      </div>
      {Object.keys(result.flagCounts).length > 0 && (
        <p className="small muted">{t('interp.flags')}: {Object.entries(result.flagCounts).map(([k, c]) => `${t(`interp.flag.${k}`)} (${c})`).join(' · ')}</p>
      )}

      <h3>{t('interp.profiles')}</h3>
      <div className="strips">
        {CHARTS.map((c) => <Strip key={c.id} depth={result.depth} values={result.series[c.id]} label={t(`interp.series.${c.id}`)} {...c} />)}
      </div>

      <h3>{t('interp.summaryTitle')}</h3>
      <div className="table-wrap" tabIndex={0}>
        <table className="data compact">
          <thead><tr><th>{t('imp.curve')}</th><th className="num">n</th><th className="num">{t('imp.min')}</th><th className="num">{t('imp.max')}</th><th className="num">{t('interp.mean')}</th></tr></thead>
          <tbody>
            {SERIES.filter((s) => result.summary[s]?.n).map((s) => (
              <tr key={s}><td>{t(`interp.series.${s}`)}</td><td className="num">{result.summary[s].n}</td><td className="num">{fmt(result.summary[s].min)}</td><td className="num">{fmt(result.summary[s].max)}</td><td className="num">{fmt(result.summary[s].mean)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>{t('interp.methodsTitle')}</h3>
      {result.methods.map((id) => {
        const m = METHOD_INFO[id];
        if (!m) return null;
        return (
          <details className="method" key={id}>
            <summary><strong>{m.name[lang]}</strong></summary>
            <p dir="ltr" className="eq">{m.equation}</p>
            <p className="small"><strong>{t('interp.mSource')}:</strong> {m.source}</p>
            <p className="small"><strong>{t('interp.mAssumptions')}:</strong></p>
            <ul className="small">{m.assumptions[lang].map((a) => <li key={a}>{a}</li>)}</ul>
            <p className="small"><strong>{t('interp.mUncertainty')}:</strong> {m.uncertainty[lang]}</p>
            <p className="small"><strong>{t('interp.mValidity')}:</strong> {m.validity[lang]}</p>
          </details>
        );
      })}

      <h3>{t('interp.tableTitle')}</h3>
      <div className="table-wrap" tabIndex={0}>
        <table className="data compact">
          <thead><tr><th>{t('imp.depth')} (m)</th>{['temp', 'ra', 'rt', 'vsh', 'phi', 'rw', 'sw'].map((s) => <th key={s} className="num">{t(`interp.series.${s}`)}</th>)}<th>{t('interp.flags')}</th></tr></thead>
          <tbody>
            {rows.map(({ d, i }) => (
              <tr key={i}>
                <td dir="ltr">{fmt(d)}</td>
                {['temp', 'ra', 'rt', 'vsh', 'phi', 'rw', 'sw'].map((s) => <td key={s} className="num">{fmt(result.series[s][i])}</td>)}
                <td className="small muted">{result.flags[i].map((f) => t(`interp.flag.${f}`)).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="toolbar">
        <button className="btn sm" disabled={p === 0} onClick={() => setPage(p - 1)}>‹</button>
        <span className="small" dir="ltr">{p + 1} / {total} ({n})</span>
        <button className="btn sm" disabled={p >= total - 1} onClick={() => setPage(p + 1)}>›</button>
      </div>
    </div>
  );
}
