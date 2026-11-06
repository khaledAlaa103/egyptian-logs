import { usePrefs } from '../../app/PrefsContext.jsx';
import { pickCurve, COL } from '../../results/columns.js';
import { getLog } from '../../registry/logRegistry.js';

const WATER = { yes: 'rgba(6,182,212,0.28)', probable: 'rgba(6,182,212,0.13)' };

/** Side-by-side depth profiles (SVG) with formation bands: GR, resistivity (log), porosity, Sw. */
export default function ProfileTracks({ curves, run, formations, selected, onPick }) {
  const { t } = usePrefs();
  const grId = pickCurve('gr', { curves, sources: {} }), rdId = pickCurve('rd', { curves, sources: {} });
  const tracks = [
    grId && { key: 'gr', label: `${getLog(grId).abbr}`, depth: curves[grId].depth, values: curves[grId].values, color: '#16a34a', min: 0, max: 150 },
    rdId && { key: 'rd', label: `${getLog(rdId).abbr}`, depth: curves[rdId].depth, values: curves[rdId].values, color: '#dc2626', log: true },
    run && run.series.phi.some((v) => v != null) && { key: 'phi', label: t('res.col.phi'), depth: run.depth, values: run.series[run.config?.porosity?.shaleCorrection?.enabled ? 'phiE' : 'phi'], color: '#2563eb', min: 0, max: 0.5 },
    run && run.series.sw.some((v) => v != null) && { key: 'sw', label: t('res.col.sw'), depth: run.depth, values: run.series.sw, color: '#0891b2', min: 0, max: 1 },
  ].filter(Boolean);

  const all = [...tracks.flatMap((x) => x.depth), ...formations.flatMap((f) => [f.top, f.bottom])];
  if (!all.length) return null;
  const d0 = Math.min(...all), d1 = Math.max(...all);
  const W = 130, H = 420, pad = 6, axisW = 44;
  const y = (d) => pad + ((d - d0) / (d1 - d0 || 1)) * (H - 2 * pad);
  const total = axisW + tracks.length * (W + 6) + 6;
  const ticks = Array.from({ length: 6 }, (_, i) => d0 + ((d1 - d0) * i) / 5);

  return (
    <div className="profiles" dir="ltr">
      <svg viewBox={`0 0 ${total} ${H + 24}`} width="100%" style={{ maxWidth: total + 40, color: 'var(--text)' }} role="img" aria-label={t('fa.profiles')}>
        {ticks.map((d) => <text key={d} x={axisW - 4} y={y(d) + 24 + 3} fontSize="9" textAnchor="end" fill="currentColor">{Number(d.toPrecision(3))}</text>)}
        {tracks.map((tr, i) => {
          const x0 = axisW + i * (W + 6);
          const vs = tr.values.filter((v) => v != null && Number.isFinite(v) && (!tr.log || v > 0));
          const lo = tr.min ?? (tr.log ? Math.floor(Math.log10(Math.min(...vs, 1))) : Math.min(...vs));
          const hi = tr.max ?? (tr.log ? Math.ceil(Math.log10(Math.max(...vs, 10))) : Math.max(...vs));
          const lg = tr.log;
          const sx = (v) => x0 + pad + (((lg ? Math.log10(v) : v) - (lg ? lo : lo)) / ((lg ? hi : hi) - (lg ? lo : lo) || 1)) * (W - 2 * pad);
          let path = '', pen = false;
          tr.values.forEach((v, k) => {
            if (v == null || !Number.isFinite(v) || (lg && v <= 0)) { pen = false; return; }
            path += `${pen ? 'L' : 'M'}${sx(v).toFixed(1)},${(y(tr.depth[k]) + 24).toFixed(1)}`; pen = true;
          });
          return (
            <g key={tr.key}>
              <text x={x0 + W / 2} y="12" fontSize="10" textAnchor="middle" fontWeight="600" fill={tr.color}>{tr.label}</text>
              <text x={x0 + 2} y="22" fontSize="8" fill="currentColor" opacity=".7">{lg ? Number((10 ** lo).toPrecision(2)) : Number(lo.toPrecision(3))}</text>
              <text x={x0 + W - 2} y="22" fontSize="8" textAnchor="end" fill="currentColor" opacity=".7">{lg ? Number((10 ** hi).toPrecision(2)) : Number(hi.toPrecision(3))}</text>
              <rect x={x0} y="24" width={W} height={H - 0} fill="none" stroke="currentColor" opacity=".3" />
              {formations.map((f) => WATER[f.waterBearing] && <rect key={f.id} x={x0} y={y(f.top) + 24} width={W} height={Math.max(1, y(f.bottom) - y(f.top))} fill={WATER[f.waterBearing]} />)}
              {formations.map((f) => <line key={`l${f.id}`} x1={x0} x2={x0 + W} y1={y(f.top) + 24} y2={y(f.top) + 24} stroke="currentColor" opacity=".35" strokeDasharray="3 3" />)}
              <path d={path} fill="none" stroke={tr.color} strokeWidth="1.4" />
            </g>
          );
        })}
        {formations.map((f) => selected === f.id && <rect key={`s${f.id}`} x={axisW - 2} y={y(f.top) + 24} width={total - axisW} height={Math.max(2, y(f.bottom) - y(f.top))} fill="none" stroke="#e11d48" strokeWidth="1.5" />)}
        {formations.map((f) => <rect key={`h${f.id}`} x="0" y={y(f.top) + 24} width={total} height={Math.max(2, y(f.bottom) - y(f.top))} fill="transparent" style={{ cursor: 'pointer' }} onClick={() => onPick(f.id)}><title>{f.name || ''} {f.top}–{f.bottom} m</title></rect>)}
      </svg>
      <p className="muted small">{COL.gr ? t('fa.profileHint') : ''}</p>
    </div>
  );
}
