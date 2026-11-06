// Default display configuration for curves and automatic track layout. Pure.
import { getLog } from '../registry/logRegistry.js';

// Display ranges follow common industry presentation (they are NOT validation limits).
const RANGE = {
  gr: { min: 0, max: 150, scale: 'linear' }, sgr: { min: 0, max: 150, scale: 'linear' },
  sp: { min: -100, max: 100, scale: 'linear' },
  caliper: { min: 100, max: 400, scale: 'linear' }, bhd: { min: 100, max: 400, scale: 'linear' },
  density: { min: 1.95, max: 2.95, scale: 'linear' },
  neutron: { min: 0.45, max: -0.15, scale: 'linear' }, // conventional reversed scale
  nmr: { min: 0.45, max: -0.15, scale: 'linear' },
  sonic: { min: 140, max: 40, scale: 'linear' }, dtc: { min: 140, max: 40, scale: 'linear' },
  pef: { min: 0, max: 10, scale: 'linear' },
  temp: { min: 10, max: 60, scale: 'linear' },
};
const RES = { min: 0.2, max: 2000, scale: 'log' };

const COLORS = {
  gr: '#16a34a', sgr: '#15803d', sp: '#2563eb', caliper: '#111827', bhd: '#4b5563',
  res_deep: '#dc2626', res_medium: '#2563eb', res_shallow: '#16a34a', micro_res: '#9333ea',
  lateral: '#b45309', laterolog: '#dc2626', induction: '#be123c', short_normal: '#0891b2', long_normal: '#7c3aed',
  normal_res: '#0f766e', density: '#dc2626', neutron: '#2563eb', pef: '#9333ea', sonic: '#0d9488', dtc: '#0d9488', dts: '#ea580c',
  ec: '#0891b2', fluid_ec: '#0e7490', fluid_res: '#be185d', temp: '#ea580c', nmr: '#7c3aed',
};
const CYCLE = ['#dc2626', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be185d', '#4b5563'];
export const colorFor = (id, i = 0) => COLORS[id] || CYCLE[i % CYCLE.length];

/** Nice round bounds around data percentiles, used when no conventional range exists. */
export function autoRange(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return { min: 0, max: 1, scale: 'linear' };
  const lo = v[Math.floor(v.length * 0.02)], hi = v[Math.ceil(v.length * 0.98) - 1];
  if (lo === hi) return { min: lo - 1, max: hi + 1, scale: 'linear' };
  const pad = (hi - lo) * 0.05;
  const mag = 10 ** Math.floor(Math.log10(hi - lo));
  return { min: Math.floor((lo - pad) / mag) * mag, max: Math.ceil((hi + pad) / mag) * mag, scale: 'linear' };
}

export function displayRange(def, values) {
  if (!def) return autoRange(values);
  if (RANGE[def.id]) return RANGE[def.id];
  if (def.group === 'resistivity' && def.scale === 'log') return RES;
  if (def.scale === 'log') {
    const pos = values.filter((x) => x > 0);
    const r = autoRange(pos);
    return { min: Math.max(1e-3, 10 ** Math.floor(Math.log10(Math.max(r.min, 1e-3)))), max: 10 ** Math.ceil(Math.log10(Math.max(r.max, 1))), scale: 'log' };
  }
  return autoRange(values);
}

const GROUPS = [
  { title: 'gr', ids: ['gr', 'sgr', 'sgr_k', 'sgr_u', 'sgr_th', 'sp', 'caliper', 'bhd'] },
  { title: 'res', ids: ['res_deep', 'res_medium', 'res_shallow', 'micro_res', 'lateral', 'laterolog', 'induction', 'short_normal', 'long_normal', 'normal_res'] },
  { title: 'por', ids: ['density', 'neutron', 'nmr', 'sonic', 'dtc', 'dts', 'pef'] },
  { title: 'fluid', ids: ['ec', 'fluid_ec', 'fluid_res', 'temp'] },
];

/**
 * Build the default layout from the curves that actually exist (never assume availability).
 * available: [{curveId, values}] ; titles: {gr, res, por, fluid, other} localized track names.
 */
export function defaultLayout(available, custom = [], titles = {}) {
  const byId = new Map(available.map((a) => [a.curveId, a]));
  const used = new Set();
  const tracks = [];
  let n = 0;
  const mkCurve = (id, idx) => {
    const def = getLog(id, custom);
    const r = displayRange(def, byId.get(id).values);
    return { curveId: id, color: colorFor(id, idx), visible: true, min: r.min, max: r.max, scale: r.scale };
  };
  for (const g of GROUPS) {
    const ids = g.ids.filter((id) => byId.has(id));
    if (!ids.length) continue;
    ids.forEach((i) => used.add(i));
    const first = mkCurve(ids[0], 0);
    tracks.push({
      id: `t${++n}`, title: titles[g.title] || g.title, width: g.title === 'res' ? 170 : 150, scale: first.scale,
      min: first.min, max: first.max, curves: ids.map((id, i) => mkCurve(id, i)),
    });
  }
  const rest = available.map((a) => a.curveId).filter((id) => !used.has(id));
  rest.forEach((id, i) => {
    const c = mkCurve(id, i);
    tracks.push({ id: `t${++n}`, title: titles.other || 'other', width: 150, scale: c.scale, min: c.min, max: c.max, curves: [c] });
  });
  return { depthUnit: 'm', tracks };
}

/** Make a new empty track id that does not clash. */
export const nextTrackId = (tracks) => `t${Math.max(0, ...tracks.map((t) => Number(String(t.id).slice(1)) || 0)) + 1}`;
