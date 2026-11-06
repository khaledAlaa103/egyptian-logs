// Per-interval water-quality estimates (shared by the Water Quality page and the report). Pure JS.
// Rw and temperature come from the selected interpretation run; formation resistivity is never used.
import { statsInInterval } from './intervalStats.js';
import { estimateTds, INSUFFICIENT } from '../engine/water/water.js';

export function estimateIntervals({ rows, run, curves, samples, normalization, calibration, rwUncertaintyPct, ready }) {
  return rows.map((row) => {
    const f = row.formation;
    const rw = row.cells.rw.v;
    const tRun = run?.series?.temp ? statsInInterval(run.depth, run.series.temp, f.top, f.bottom, 'arith') : { n: 0 };
    const tCur = curves.temp ? statsInInterval(curves.temp.depth, curves.temp.values, f.top, f.bottom, 'arith') : { n: 0 };
    const tC = tRun.n ? tRun.mean : tCur.n ? tCur.mean : null;
    let est = null, reason = null;
    if (!ready) reason = 'notReady';
    else if (rw == null) reason = 'noRw';
    else if (tC == null) reason = 'noTemp';
    else {
      est = estimateTds({ rw, tC, normalization, calibration, rwUncertaintyPct });
      if (est.status === INSUFFICIENT) { reason = est.missing?.[0] || est.reason; est = null; }
    }
    const inside = samples.filter((s) => s.depthTop >= f.top && s.depthTop < f.bottom);
    const withTds = inside.filter((s) => s.tds);
    const directTds = withTds.length ? withTds.reduce((a, s) => a + s.tds, 0) / withTds.length : null;
    const diffPct = est && directTds ? ((est.tds - directTds) / directTds) * 100 : null;
    return { row, f, rw, rwStatus: row.cells.rw.status, tC, est, reason, inside, directTds, diffPct };
  });
}
