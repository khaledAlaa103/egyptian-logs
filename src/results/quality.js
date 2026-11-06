// Data-quality warnings for a well's formation table. Pure JS. Returns [{code, severity, fid?, params}].
import { sampling } from './intervalStats.js';

export function qualityWarnings({ formations, rows, curves, run, well }) {
  const out = [];
  const w = (code, severity, fid, params = {}) => out.push({ code, severity, fid, params });
  if (!formations.length) { w('no_formations', 'info'); return out; }
  const sorted = [...formations].sort((a, b) => a.top - b.top);

  sorted.forEach((f, i) => {
    const next = sorted[i + 1];
    if (next && next.top - f.bottom > 1e-9) w('gap_between', 'info', f.id, { from: f.bottom, to: next.top });
    if (well?.totalDepth != null && f.bottom > well.totalDepth + 1e-9) w('beyond_td', 'warning', f.id, { td: well.totalDepth });
    const row = rows.find((r) => r.id === f.id);
    // thin relative to the coarsest sampling among the curves
    const dz = Math.max(...Object.values(curves).map((c) => sampling(c.depth)).filter(Number.isFinite), 0);
    if (dz && f.bottom - f.top < 2 * dz) w('thin_interval', 'warning', f.id, { thickness: f.bottom - f.top, dz });
    if (row) {
      if (curves && Object.keys(curves).length && row.cells.gr?.trace && row.cells.gr.trace.n === 0 && !row.cells.gr.overridden) w('no_log_coverage', 'warning', f.id, { col: 'gr' });
      if (row.cells.rd?.trace && row.cells.rd.trace.n === 0 && !row.cells.rd.overridden) w('no_log_coverage', 'warning', f.id, { col: 'rd' });
      if (row.cells.ec?.trace?.warn === 'fluid_ec') w('fluid_ec_used', 'info', f.id);
      if (f.waterBearing === 'yes' && row.cells.vsh?.v != null && run?.config?.saturation?.vshLimit != null && row.cells.vsh.v > run.config.saturation.vshLimit) {
        w('water_but_clayey', 'warning', f.id, { vsh: row.cells.vsh.v, limit: run.config.saturation.vshLimit });
      }
    }
    // share of flagged samples inside this interval
    if (run) {
      let n = 0, clay = 0, clip = 0;
      run.depth.forEach((d, k) => { if (d >= f.top && d < f.bottom) { n++; if (run.flags[k]?.includes('archie_clay_rich')) clay++; if (run.flags[k]?.includes('sw_clipped')) clip++; } });
      if (n && clay / n > 0.5) w('archie_refused', 'warning', f.id, { share: clay / n });
      if (n && clip / n > 0.2) w('sw_clipped', 'warning', f.id, { share: clip / n });
    }
  });
  if (run?.config?.resistivity?.method === 'direct') w('rt_direct_used', 'info');
  if (run && !run.config?.resistivity?.method) w('rt_not_declared', 'warning');
  return out;
}
