import { describe, it, expect } from 'vitest';
import { convert, normalizeUnit, toCanonical, UNIT_GROUPS, groupOf } from '../src/engine/units/units.js';
import {
  BUILTIN_LOGS, ALL_BUILTIN, getLog, guessCurve, validateCurveValue, makeCustomCurve,
  acceptedUnitsOf, canonicalUnitOf, normalizeHeader,
} from '../src/registry/logRegistry.js';

describe('unit conversion', () => {
  it('depth ft <-> m', () => {
    expect(convert(100, 'depth', 'ft', 'm')).toBeCloseTo(30.48, 10);
    expect(convert(30.48, 'depth', 'm', 'ft')).toBeCloseTo(100, 10);
  });
  it('conductivity: 1 mS/m = 10 uS/cm; 1 S/m = 1000 mS/m', () => {
    expect(convert(1, 'conductivity', 'mS/m', 'uS/cm')).toBeCloseTo(10, 10);
    expect(convert(1, 'conductivity', 'S/m', 'mS/m')).toBeCloseTo(1000, 10);
    expect(convert(1, 'conductivity', 'mS/cm', 'uS/cm')).toBeCloseTo(1000, 10);
  });
  it('temperature', () => {
    expect(convert(212, 'temperature', 'degF', 'degC')).toBeCloseTo(100, 10);
    expect(convert(0, 'temperature', 'degC', 'K')).toBeCloseTo(273.15, 10);
    expect(convert(25, 'temperature', 'degC', 'degF')).toBeCloseTo(77, 10);
  });
  it('sonic us/ft <-> us/m, caliper in <-> mm, density, porosity %', () => {
    expect(convert(100, 'sonic', 'us/ft', 'us/m')).toBeCloseTo(328.084, 2);
    expect(convert(8, 'length', 'in', 'mm')).toBeCloseTo(203.2, 10);
    expect(convert(2650, 'density', 'kg/m3', 'g/cm3')).toBeCloseTo(2.65, 10);
    expect(convert(25, 'porosity', '%', 'v/v')).toBeCloseTo(0.25, 10);
  });
  it('resistivity ohm.ft -> ohm.m', () => {
    expect(convert(10, 'resistivity', 'ohm.ft', 'ohm.m')).toBeCloseTo(3.048, 10);
  });
  it('round trips every unit of every group', () => {
    for (const [g, def] of Object.entries(UNIT_GROUPS)) {
      for (const u of Object.keys(def.units)) {
        expect(convert(convert(12.34, g, def.canon, u), g, u, def.canon)).toBeCloseTo(12.34, 8);
      }
    }
  });
  it('rejects invalid unit for group', () => {
    expect(() => toCanonical(1, 'depth', 'in')).toThrow();
  });
  it('normalises free-text units and returns null for unknown', () => {
    expect(normalizeUnit('Ohm-m')).toBe('ohm.m');
    expect(normalizeUnit('g/cc')).toBe('g/cm3');
    expect(normalizeUnit('µS/cm')).toBe('uS/cm');
    expect(normalizeUnit('furlongs')).toBeNull();
    expect(groupOf('mS/m')).toEqual(['conductivity']);
  });
});

describe('log registry', () => {
  it('contains every required log type', () => {
    const need = ['res_deep', 'res_medium', 'res_shallow', 'lateral', 'laterolog', 'induction', 'short_normal', 'long_normal',
      'normal_res', 'micro_res', 'ec', 'sp', 'gr', 'sgr', 'density', 'neutron', 'pef', 'sonic', 'dtc', 'dts', 'caliper', 'bhd',
      'temp', 'fluid_ec', 'fluid_res', 'nmr', 'image_log'];
    for (const id of need) expect(getLog(id), id).toBeTruthy();
  });
  it('every log has name, abbreviation, description and limitations in both languages', () => {
    for (const l of ALL_BUILTIN) {
      for (const k of ['name', 'description', 'limitations']) {
        expect(l[k].en, `${l.id}.${k}.en`).toBeTruthy();
        expect(l[k].ar, `${l.id}.${k}.ar`).toBeTruthy();
      }
      expect(l.abbr).toBeTruthy();
    }
  });
  it('ids unique; every numeric curve has a unit group and units', () => {
    expect(new Set(ALL_BUILTIN.map((l) => l.id)).size).toBe(ALL_BUILTIN.length);
    for (const l of BUILTIN_LOGS) {
      expect(UNIT_GROUPS[l.group], l.id).toBeTruthy();
      expect(acceptedUnitsOf(l).length).toBeGreaterThan(0);
      expect(canonicalUnitOf(l)).toBe(UNIT_GROUPS[l.group].canon);
    }
  });
  it('resistivity logs use a log scale and state the apparent-vs-true limitation', () => {
    const rd = getLog('res_deep');
    expect(rd.scale).toBe('log');
    expect(rd.limitations.en).toMatch(/apparent/i);
  });
  it('validation rules', () => {
    const rd = getLog('res_deep');
    expect(validateCurveValue(rd, 10)).toBeNull();
    expect(validateCurveValue(rd, 0)).toBe('log_nonpositive');
    expect(validateCurveValue(rd, -3)).toBe('log_nonpositive');
    expect(validateCurveValue(rd, 1e9)).toBe('out_of_range');
    expect(validateCurveValue(rd, NaN)).toBe('not_number');
    expect(validateCurveValue(getLog('sp'), -50)).toBeNull();
  });
  it('header guessing ignores units and punctuation', () => {
    expect(guessCurve('GR (gAPI)')).toBe('gr');
    expect(guessCurve('ILD')).toBe('res_deep');
    expect(guessCurve('RHOB [g/cc]')).toBe('density');
    expect(guessCurve('CALI')).toBe('caliper');
    expect(guessCurve('mystery')).toBeNull();
    expect(normalizeHeader('Depth (m)')).toBe('depth');
  });
  it('custom curves have one free unit and no built-in interpretation', () => {
    const c = makeCustomCurve({ id: 'custom_x', abbr: 'X', name: 'X curve', unit: 'ppb', min: 0, max: 10 });
    expect(acceptedUnitsOf(c)).toEqual(['ppb']);
    expect(c.use).toEqual([]);
    expect(validateCurveValue(c, 11)).toBe('out_of_range');
    expect(guessCurve('x', [c])).toBe('custom_x');
  });
});
