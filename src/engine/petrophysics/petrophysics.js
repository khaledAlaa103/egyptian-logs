// Petrophysical formulas. Pure JS. Each function returns { value, flags[] } or an
// insufficient-inputs object; none of them invents default parameter values.
import { INSUFFICIENT } from '../resistivity/resistivity.js';

const need = (...keys) => ({ status: INSUFFICIENT, value: null, missing: keys });
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const clip01 = (v, flagName, flags) => {
  if (v < 0) { flags.push(`${flagName}_clipped`); return 0; }
  if (v > 1) { flags.push(`${flagName}_clipped`); return 1; }
  return v;
};

// ---------------- Gamma ray index and shale volume ----------------
export function grIndex(gr, grClean, grShale) {
  if (!num(gr)) return need('gr');
  if (!num(grClean) || !num(grShale)) return need('grClean', 'grShale');
  if (grShale <= grClean) return { status: INSUFFICIENT, value: null, missing: [], reason: 'baselines_invalid' };
  const flags = [];
  const v = clip01((gr - grClean) / (grShale - grClean), 'igr', flags);
  return { value: v, flags };
}

export const VSH_MODELS = {
  linear: (i) => i,
  larionov_tertiary: (i) => 0.083 * (2 ** (3.7 * i) - 1),
  larionov_older: (i) => 0.33 * (2 ** (2 * i) - 1),
  clavier: (i) => 1.7 - Math.sqrt(3.38 - (i + 0.7) ** 2),
  steiber: (i) => i / (3 - 2 * i),
};

export function vshaleFromIndex(igr, model) {
  const f = VSH_MODELS[model];
  if (!f) return need('vshModel');
  if (!num(igr)) return need('igr');
  const flags = [];
  return { value: clip01(f(igr), 'vsh', flags), flags };
}

/** SP-based shale volume (linear). */
export function vshaleFromSP(sp, spClean, spShale) {
  if (!num(sp)) return need('sp');
  if (!num(spClean) || !num(spShale)) return need('spClean', 'spShale');
  if (spClean === spShale) return { status: INSUFFICIENT, value: null, missing: [], reason: 'baselines_invalid' };
  const flags = [];
  return { value: clip01((sp - spClean) / (spShale - spClean), 'vsh', flags), flags };
}

// ---------------- Porosity ----------------
export function densityPorosity(rhob, rhoMa, rhoFl) {
  if (!num(rhob)) return need('rhob');
  if (!num(rhoMa) || !num(rhoFl)) return need('rhoMa', 'rhoFl');
  if (rhoMa <= rhoFl) return { status: INSUFFICIENT, value: null, missing: [], reason: 'matrix_le_fluid' };
  const flags = [];
  return { value: clip01((rhoMa - rhob) / (rhoMa - rhoFl), 'phi', flags), flags };
}

export function sonicPorosityWyllie(dt, dtMa, dtFl, cp = 1) {
  if (!num(dt)) return need('dt');
  if (!num(dtMa) || !num(dtFl)) return need('dtMa', 'dtFl');
  if (dtFl <= dtMa) return { status: INSUFFICIENT, value: null, missing: [], reason: 'fluid_le_matrix' };
  if (!(cp > 0)) return need('cp');
  const flags = [];
  return { value: clip01((dt - dtMa) / (dtFl - dtMa) / cp, 'phi', flags), flags };
}

export function sonicPorosityRHG(dt, dtMa) {
  if (!num(dt)) return need('dt');
  if (!num(dtMa)) return need('dtMa');
  if (!(dt > 0)) return { status: INSUFFICIENT, value: null, missing: [], reason: 'dt_nonpositive' };
  const flags = [];
  return { value: clip01((0.625 * (dt - dtMa)) / dt, 'phi', flags), flags };
}

export function neutronPorosity(nphi) {
  if (!num(nphi)) return need('nphi');
  const flags = [];
  return { value: clip01(nphi, 'phi', flags), flags };
}

/** Neutron-density combination for liquid-filled formations; flags gas crossover (φN < φD). */
export function neutronDensityPorosity(nphi, rhob, rhoMa, rhoFl) {
  const d = densityPorosity(rhob, rhoMa, rhoFl);
  if (d.status === INSUFFICIENT) return d;
  if (!num(nphi)) return need('nphi');
  const flags = [...d.flags];
  const n = clip01(nphi, 'phi', flags);
  if (n < d.value) flags.push('gas_crossover');
  return { value: Math.sqrt((n * n + d.value * d.value) / 2), flags };
}

/** Effective porosity φe = φt − Vsh·φsh (≥ 0). */
export function effectivePorosity(phiT, vsh, phiShale) {
  if (!num(phiT)) return need('phiT');
  if (!num(vsh)) return need('vsh');
  if (!num(phiShale)) return need('phiShale');
  const flags = [];
  let v = phiT - vsh * phiShale;
  if (v < 0) { flags.push('phi_clipped'); v = 0; }
  return { value: v, flags };
}

// ---------------- Formation factor and saturation ----------------
export function formationFactor(phi, a, m) {
  if (!num(phi) || !(phi > 0)) return need('phi');
  if (!num(a) || !num(m)) return need('a', 'm');
  return { value: a / phi ** m, flags: [] };
}

const clipSw = (sw, flags) => {
  if (sw > 1) { flags.push('sw_clipped'); return 1; }
  return sw;
};

/** Archie. Refuses clay-rich formations: vsh must be given and not exceed vshLimit. */
export function swArchie({ rt, rw, phi, a, m, n, vsh, vshLimit }) {
  if (!(rt > 0)) return need('rt');
  if (!(rw > 0)) return need('rw');
  if (!(phi > 0)) return need('phi');
  if (![a, m, n].every(num)) return need('a', 'm', 'n');
  if (!num(vsh)) return need('vsh');
  if (!num(vshLimit)) return need('vshLimit');
  if (vsh > vshLimit) return { status: INSUFFICIENT, value: null, missing: [], reason: 'archie_clay_rich' };
  const flags = [];
  return { value: clipSw(((a * rw) / (phi ** m * rt)) ** (1 / n), flags), flags };
}

/** Simandoux (n = 2): solves 1/Rt = φ^m·Sw²/(a·Rw) + Vsh·Sw/Rsh. */
export function swSimandoux({ rt, rw, phi, a, m, vsh, rsh }) {
  if (!(rt > 0)) return need('rt');
  if (!(rw > 0)) return need('rw');
  if (!(phi > 0)) return need('phi');
  if (![a, m].every(num)) return need('a', 'm');
  if (!num(vsh)) return need('vsh');
  if (!(rsh > 0)) return need('rsh');
  const A = phi ** m / (a * rw), B = vsh / rsh;
  const flags = [];
  return { value: clipSw((-B + Math.sqrt(B * B + (4 * A) / rt)) / (2 * A), flags), flags };
}

/** Indonesia (Poupon-Leveaux). */
export function swIndonesia({ rt, rw, phi, a, m, n, vsh, rsh }) {
  if (!(rt > 0)) return need('rt');
  if (!(rw > 0)) return need('rw');
  if (!(phi > 0)) return need('phi');
  if (![a, m, n].every(num)) return need('a', 'm', 'n');
  if (!num(vsh)) return need('vsh');
  if (!(rsh > 0)) return need('rsh');
  const term = vsh ** (1 - vsh / 2) / Math.sqrt(rsh) + phi ** (m / 2) / Math.sqrt(a * rw);
  const flags = [];
  return { value: clipSw(((1 / Math.sqrt(rt)) / term) ** (2 / n), flags), flags };
}

/** Archie resistivity index I = Rt / Ro with Ro = F·Rw. */
export function resistivityIndex(rt, rw, f) {
  if (!(rt > 0) || !(rw > 0) || !(f > 0)) return need('rt', 'rw', 'F');
  return { value: rt / (f * rw), flags: [] };
}
