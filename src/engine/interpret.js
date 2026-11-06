// Interpretation orchestrator: runs the selected methods over a depth grid.
// Pure JS (no React/DB). Inputs are CANONICAL-unit curves {depth[], values[]} and a config object.
// Nothing is defaulted: a missing parameter produces no value for that quantity and is reported
// in `diagnostics` (why it could not be computed).
import { valueAt, medianSpacing } from '../viewer/geometry.js';
import { temperatureAt } from './resistivity/temperature.js';
import { arps } from './resistivity/temperature.js';
import { computeRt, rwFromSP, rmfeAt, rwa, INSUFFICIENT } from './resistivity/resistivity.js';
import {
  grIndex, vshaleFromIndex, vshaleFromSP, densityPorosity, sonicPorosityWyllie, sonicPorosityRHG,
  neutronPorosity, neutronDensityPorosity, effectivePorosity, formationFactor, swArchie, swSimandoux,
  swIndonesia, resistivityIndex,
} from './petrophysics/petrophysics.js';

export const SERIES = ['temp', 'ra', 'rt', 'rxo', 'igr', 'vsh', 'phi', 'phiE', 'rw', 'rwa', 'f', 'sw', 'bvw', 'ri'];

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

function makeSampler(c) {
  if (!c) return () => null;
  const mdz = medianSpacing(c.depth);
  return (d) => valueAt(c.depth, c.values, d, mdz);
}

/** Which method ids the config will use (for the methods table / report). */
export function methodsUsed(cfg) {
  const ids = new Set(['arps']);
  const r = cfg.resistivity || {};
  ids.add({ direct: 'rt_direct', geometric: 'rt_geometric', factor: 'rt_factor' }[r.method] || 'rt_none');
  const rw = cfg.rw || {};
  if (rw.method === 'manual') ids.add('rw_manual');
  else if (rw.method === 'sp') ids.add('rw_sp');
  else if (rw.method === 'rwa_min') ids.add('rwa');
  const v = cfg.vshale || {};
  if (v.model === 'sp_linear') ids.add('vsh_sp');
  else if (v.model) { ids.add('igr'); ids.add(`vsh_${v.model}`); }
  const p = cfg.porosity || {};
  if (p.method) ids.add(`phi_${p.method}`);
  if (p.shaleCorrection?.enabled) ids.add('phi_effective');
  ids.add('formation_factor');
  if (cfg.saturation?.model) ids.add(`sw_${cfg.saturation.model}`);
  return [...ids];
}

/**
 * config: {
 *  grid:{curveId, top?, bottom?},
 *  temperature:{method, value|surface+gradient|curveId, source},
 *  resistivity:{rtCurve, method, rxoCurve, J, factor, factorSource, cond:{...}},
 *  rw:{method:'manual'|'sp'|'rwa_min', value, refTemp, source, ssp | {spClean, spShale}, rmf,rmfTemp,rmfe,rmfeTemp, interval:{top,bottom}},
 *  vshale:{model, curve, grClean, grShale, spClean, spShale},
 *  porosity:{method, rhoMa, rhoFl, dtMa, dtFl, cp, shaleCorrection:{enabled,phiShale}, curves:{...}},
 *  saturation:{model, a, m, n, rsh, vshLimit}
 * }
 */
export function runInterpretation(cfg, curves) {
  const out = { depth: [], series: {}, flags: [], diagnostics: {}, methods: methodsUsed(cfg), errors: [], notes: [] };
  SERIES.forEach((s) => { out.series[s] = []; });

  const gridId = cfg.grid?.curveId;
  const gridCurve = gridId ? curves[gridId] : null;
  if (!gridCurve || !gridCurve.depth.length) { out.errors.push('no_grid_curve'); return out; }

  const diag = (param, res) => {
    const d = (out.diagnostics[param] ||= { computed: 0, missing: 0, reasons: {} });
    if (res && res.status === INSUFFICIENT) {
      d.missing++;
      const keys = res.missing?.length ? res.missing : [res.reason || 'unspecified'];
      keys.forEach((k) => { d.reasons[k] = (d.reasons[k] || 0) + 1; });
    } else d.computed++;
  };

  const S = (id) => makeSampler(curves[id]);
  const rtc = cfg.resistivity || {}, vc = cfg.vshale || {}, pc = cfg.porosity || {}, sc = cfg.saturation || {}, rwc = cfg.rw || {};
  const sRt = S(rtc.rtCurve), sRxo = S(rtc.rxoCurve), sGR = S(vc.curve), sSP = S(vc.curve);
  const sTemp = S(cfg.temperature?.curveId);
  const pcv = pc.curves || {};
  const sRho = S(pcv.density), sDt = S(pcv.sonic), sN = S(pcv.neutron);

  // Simandoux (this form) is an n = 2 model: say so instead of silently ignoring a different n
  if (sc.model === 'simandoux' && isNum(sc.n) && sc.n !== 2) out.notes.push('simandoux_n_ignored');

  const top = cfg.grid.top ?? -Infinity, bottom = cfg.grid.bottom ?? Infinity;
  const depths = gridCurve.depth.filter((d) => d >= top && d <= bottom);

  // ---------- pass 1: T, Rt, Vsh, porosity ----------
  const rows = depths.map((d) => {
    const r = { d, flags: [] };
    r.temp = temperatureAt(cfg.temperature, d, sTemp);
    if (!isNum(r.temp)) r.temp = null;
    r.ra = sRt(d);
    r.rxo = rtc.rxoCurve ? sRxo(d) : null;
    // Rt
    const rt = !rtc.rtCurve ? { status: INSUFFICIENT, missing: ['rtCurve'] }
      : r.ra == null ? { status: INSUFFICIENT, missing: ['ra'] }
      : computeRt(rtc.method, { ra: r.ra, rxo: r.rxo, J: rtc.J, factor: rtc.factor, factorSource: rtc.factorSource, cond: rtc.cond });
    diag('rt', rt);
    r.rt = rt.status === INSUFFICIENT ? null : rt.value;
    // Vsh
    let vs = { status: INSUFFICIENT, missing: ['vshModel'] };
    if (vc.model === 'sp_linear') vs = vshaleFromSP(sSP(d) ?? NaN, vc.spClean, vc.spShale);
    else if (vc.model) {
      const gi = grIndex(sGR(d) ?? NaN, vc.grClean, vc.grShale);
      diag('igr', gi);
      r.igr = gi.status === INSUFFICIENT ? null : gi.value;
      vs = gi.status === INSUFFICIENT ? gi : vshaleFromIndex(gi.value, vc.model);
      if (gi.flags) r.flags.push(...gi.flags);
    }
    diag('vsh', vs);
    r.vsh = vs.status === INSUFFICIENT ? null : vs.value;
    if (vs.flags) r.flags.push(...vs.flags);
    // porosity
    let ph = { status: INSUFFICIENT, missing: ['porosityMethod'] };
    const rho = sRho(d) ?? NaN, dt = sDt(d) ?? NaN, nphi = sN(d) ?? NaN;
    switch (pc.method) {
      case 'density': ph = densityPorosity(rho, pc.rhoMa, pc.rhoFl); break;
      case 'sonic_wyllie': ph = sonicPorosityWyllie(dt, pc.dtMa, pc.dtFl, pc.cp ?? 1); break;
      case 'sonic_rhg': ph = sonicPorosityRHG(dt, pc.dtMa); break;
      case 'neutron': ph = neutronPorosity(nphi); break;
      case 'neutron_density': ph = neutronDensityPorosity(nphi, rho, pc.rhoMa, pc.rhoFl); break;
      default: break;
    }
    diag('phi', ph);
    r.phi = ph.status === INSUFFICIENT ? null : ph.value;
    if (ph.flags) r.flags.push(...ph.flags);
    r.phiE = null;
    if (pc.shaleCorrection?.enabled) {
      const pe = effectivePorosity(r.phi ?? NaN, r.vsh ?? NaN, pc.shaleCorrection.phiShale);
      diag('phiE', pe);
      r.phiE = pe.status === INSUFFICIENT ? null : pe.value;
      if (pe.flags) r.flags.push(...pe.flags);
    }
    return r;
  });

  // Porosity used for resistivity models: effective if the shale correction is enabled, else total.
  const phiUsed = (r) => (pc.shaleCorrection?.enabled ? r.phiE : r.phi);
  const m = sc.m, a = sc.a;

  // ---------- Rw ----------
  let rwRef = null; // for rwa_min: {value, tempC}
  rows.forEach((r) => {
    const p = phiUsed(r);
    r.rwa = r.rt != null && p != null && p > 0 && isNum(a) && isNum(m) ? rwa(r.rt, p, a, m) : null;
  });
  if (rwc.method === 'rwa_min') {
    const lim = sc.vshLimit;
    const iv = rwc.interval || {};
    const cand = rows.filter((r) => r.rwa != null && r.rwa > 0 && r.temp != null && isNum(lim) && r.vsh != null && r.vsh <= lim
      && (iv.top == null || r.d >= iv.top) && (iv.bottom == null || r.d <= iv.bottom));
    if (cand.length) { const b = cand.reduce((x, y) => (y.rwa < x.rwa ? y : x)); rwRef = { value: b.rwa, tempC: b.temp }; }
  }
  rows.forEach((r) => {
    let rw = { status: INSUFFICIENT, missing: ['rwMethod'] };
    if (rwc.method === 'manual') {
      if (!(rwc.value > 0) || !isNum(rwc.refTemp)) rw = { status: INSUFFICIENT, missing: ['rwValue', 'rwRefTemp'] };
      else if (!rwc.source || !String(rwc.source).trim()) rw = { status: INSUFFICIENT, missing: ['rwSource'] };
      else if (r.temp == null) rw = { status: INSUFFICIENT, missing: ['temperature'] };
      else rw = { value: arps(rwc.value, rwc.refTemp, r.temp) };
    } else if (rwc.method === 'sp') {
      const ssp = isNum(rwc.ssp) ? rwc.ssp : (isNum(rwc.spClean) && isNum(rwc.spShale) ? rwc.spClean - rwc.spShale : NaN);
      if (r.temp == null) rw = { status: INSUFFICIENT, missing: ['temperature'] };
      else {
        const rm = rmfeAt({ rmfe: rwc.rmfe, rmfeTempC: rwc.rmfeTemp, rmf: rwc.rmf, rmfTempC: rwc.rmfTemp }, r.temp);
        rw = rm.status === INSUFFICIENT ? rm : rwFromSP({ ssp, tFormC: r.temp, rmfeFormTemp: rm.value });
      }
    } else if (rwc.method === 'rwa_min') {
      if (!rwRef) rw = { status: INSUFFICIENT, missing: ['rwaInterval'] };
      else if (r.temp == null) rw = { status: INSUFFICIENT, missing: ['temperature'] };
      else rw = { value: arps(rwRef.value, rwRef.tempC, r.temp) };
    }
    diag('rw', rw);
    r.rw = rw.status === INSUFFICIENT ? null : rw.value;
  });

  // ---------- Formation factor, Sw ----------
  rows.forEach((r) => {
    const p = phiUsed(r);
    const f = formationFactor(p ?? NaN, a, m);
    diag('f', f);
    r.f = f.status === INSUFFICIENT ? null : f.value;
    let sw = { status: INSUFFICIENT, missing: ['swModel'] };
    const base = { rt: r.rt ?? NaN, rw: r.rw ?? NaN, phi: p ?? NaN, a, m, n: sc.n, vsh: r.vsh ?? NaN, rsh: sc.rsh, vshLimit: sc.vshLimit };
    if (sc.model === 'archie') sw = swArchie(base);
    else if (sc.model === 'simandoux') sw = swSimandoux(base);
    else if (sc.model === 'indonesia') sw = swIndonesia(base);
    diag('sw', sw);
    r.sw = sw.status === INSUFFICIENT ? null : sw.value;
    if (sw.flags) r.flags.push(...sw.flags);
    if (sw.status === INSUFFICIENT && sw.reason === 'archie_clay_rich') r.flags.push('archie_clay_rich');
    r.bvw = r.sw != null && p != null ? p * r.sw : null;
    const ri = r.f != null && r.rt != null && r.rw != null ? resistivityIndex(r.rt, r.rw, r.f) : null;
    r.ri = ri && ri.status !== INSUFFICIENT ? ri.value : null;
  });

  // ---------- pack ----------
  for (const r of rows) {
    out.depth.push(r.d);
    SERIES.forEach((s) => out.series[s].push(r[s] ?? null));
    out.flags.push([...new Set(r.flags)]);
  }
  out.summary = {};
  for (const s of SERIES) {
    const v = out.series[s].filter(isNum);
    out.summary[s] = v.length ? { n: v.length, min: Math.min(...v), max: Math.max(...v), mean: v.reduce((x, y) => x + y, 0) / v.length } : { n: 0 };
  }
  out.flagCounts = out.flags.flat().reduce((c, f) => ((c[f] = (c[f] || 0) + 1), c), {});
  return out;
}
