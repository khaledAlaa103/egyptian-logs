// Unit conversion. Pure JS, no UI imports.
// Each group has a canonical unit (what the database stores). Every other unit defines
// toCanon(v) / fromCanon(v). Non-trivial conversions are documented inline.

const lin = (k) => ({ toCanon: (v) => v * k, fromCanon: (v) => v / k });

export const UNIT_GROUPS = {
  depth: { canon: 'm', units: { m: lin(1), ft: lin(0.3048), cm: lin(0.01) } },
  // Resistivity: canonical ohm.m. "mS/m" is NOT here (that is conductivity, a different quantity).
  resistivity: { canon: 'ohm.m', units: { 'ohm.m': lin(1), 'ohm.cm': lin(0.01), 'ohm.ft': lin(0.3048) } },
  // Conductivity: canonical mS/m (1 mS/m = 10 uS/cm)
  conductivity: { canon: 'mS/m', units: { 'mS/m': lin(1), 'uS/cm': lin(0.1), 'mS/cm': lin(100), 'S/m': lin(1000) } },
  potential: { canon: 'mV', units: { mV: lin(1), V: lin(1000) } },
  gr: { canon: 'gAPI', units: { gAPI: lin(1) } },
  density: { canon: 'g/cm3', units: { 'g/cm3': lin(1), 'kg/m3': lin(0.001) } },
  porosity: { canon: 'v/v', units: { 'v/v': lin(1), '%': lin(0.01) } },
  // Sonic slowness: us/ft -> us/m multiplies by 1/0.3048
  sonic: { canon: 'us/ft', units: { 'us/ft': lin(1), 'us/m': lin(0.3048) } },
  length: { canon: 'mm', units: { mm: lin(1), cm: lin(10), in: lin(25.4), m: lin(1000) } },
  temperature: {
    canon: 'degC',
    units: {
      degC: lin(1),
      degF: { toCanon: (v) => (v - 32) * 5 / 9, fromCanon: (v) => v * 9 / 5 + 32 },
      K: { toCanon: (v) => v - 273.15, fromCanon: (v) => v + 273.15 },
    },
  },
  // Total dissolved solids (concentration in water)
  tds: { canon: 'mg/L', units: { 'mg/L': lin(1), 'g/L': lin(1000) } },
  pef: { canon: 'b/e', units: { 'b/e': lin(1) } },
  pct: { canon: '%', units: { '%': lin(1) } },
  ppm: { canon: 'ppm', units: { ppm: lin(1) } },
};

/** Display labels (kept ASCII-safe as keys; shown with symbols). */
export const UNIT_LABELS = {
  'ohm.m': 'Ω·m', 'ohm.cm': 'Ω·cm', 'ohm.ft': 'Ω·ft', 'uS/cm': 'µS/cm', 'us/ft': 'µs/ft', 'us/m': 'µs/m',
  'g/cm3': 'g/cm³', 'kg/m3': 'kg/m³', degC: '°C', degF: '°F',
};
export const unitLabel = (u) => UNIT_LABELS[u] || u;

// Free-text unit aliases found in file headers -> canonical key
const ALIASES = {
  m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm', ft: 'ft', feet: 'ft', foot: 'ft', cm: 'cm',
  ohmm: 'ohm.m', 'ohm.m': 'ohm.m', 'ohm-m': 'ohm.m', 'ohm m': 'ohm.m', 'ω.m': 'ohm.m', 'ω·m': 'ohm.m', 'ωm': 'ohm.m',
  ohmcm: 'ohm.cm', 'ohm.cm': 'ohm.cm', 'ohm-cm': 'ohm.cm', 'ohmft': 'ohm.ft', 'ohm.ft': 'ohm.ft',
  'ms/m': 'mS/m', 'us/cm': 'uS/cm', 'µs/cm': 'uS/cm', 'μs/cm': 'uS/cm', 'ms/cm': 'mS/cm', 's/m': 'S/m',
  mv: 'mV', v: 'V',
  gapi: 'gAPI', api: 'gAPI',
  'g/cm3': 'g/cm3', 'g/cc': 'g/cm3', 'g/cm³': 'g/cm3', 'kg/m3': 'kg/m3', 'kg/m³': 'kg/m3',
  'v/v': 'v/v', frac: 'v/v', fraction: 'v/v', '%': '%', pu: '%', percent: '%',
  'us/ft': 'us/ft', 'µs/ft': 'us/ft', 'μs/ft': 'us/ft', 'usec/ft': 'us/ft', 'us/m': 'us/m', 'µs/m': 'us/m', 'μs/m': 'us/m',
  mm: 'mm', in: 'in', inch: 'in', inches: 'in', '"': 'in',
  degc: 'degC', c: 'degC', '°c': 'degC', degf: 'degF', f: 'degF', '°f': 'degF', k: 'K',
  'b/e': 'b/e', 'barns/e': 'b/e', ppm: 'ppm',
};

/** Map a free-text unit string to a canonical key, or null when unknown. */
export function normalizeUnit(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  return ALIASES[s] ?? ALIASES[s.replace(/\s/g, '')] ?? null;
}

export function groupOf(unitKey) {
  return Object.keys(UNIT_GROUPS).filter((g) => unitKey in UNIT_GROUPS[g].units);
}

export const unitsFor = (group) => Object.keys(UNIT_GROUPS[group].units);
export const canonicalUnit = (group) => UNIT_GROUPS[group].canon;

export function toCanonical(value, group, unit) {
  const u = UNIT_GROUPS[group]?.units[unit];
  if (!u) throw new Error(`Unit "${unit}" is not valid for group "${group}"`);
  return u.toCanon(value);
}

export function fromCanonical(value, group, unit) {
  const u = UNIT_GROUPS[group]?.units[unit];
  if (!u) throw new Error(`Unit "${unit}" is not valid for group "${group}"`);
  return u.fromCanon(value);
}

export function convert(value, group, from, to) {
  if (from === to) return value;
  return fromCanonical(toCanonical(value, group, from), group, to);
}
