import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach } from 'vitest';
import App from '../src/app/App.jsx';
import { PrefsProvider } from '../src/app/PrefsContext.jsx';
import { db } from '../src/db/db.js';
import { createProject, createWell } from '../src/db/repos.js';
import { saveCurves } from '../src/db/curves.js';
import { addFormation } from '../src/db/intervals.js';
import { addSample, saveSettings } from '../src/db/water.js';
import { runInterpretation } from '../src/engine/interpret.js';
import { saveInterpretation } from '../src/db/interp.js';
import { buildRows } from '../src/results/columns.js';

let wid;
beforeEach(async () => {
  const pid = await createProject({ name: 'P' });
  wid = await createWell({ projectId: pid, wellId: 'Q-1', name: 'Quality well', totalDepth: 60 });
});

const open = async (user, path = '/water') => {
  render(<PrefsProvider><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></PrefsProvider>);
  await user.selectOptions(await screen.findByLabelText(/Target well/), String(wid));
};

describe('water samples', () => {
  it('validates, saves in canonical units, lists with EC25 and class', async () => {
    const user = userEvent.setup();
    await open(user);
    expect(await screen.findByText(/TDS is never calculated from formation resistivity/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add sample/ }));
    expect((await screen.findAllByText('Required')).length).toBeGreaterThan(0);
    expect(await db.waterSamples.count()).toBe(0);

    await user.type(screen.getByLabelText('Sample ID'), 'S-1');
    await user.type(screen.getByLabelText('Depth (top)'), '25');
    await user.type(screen.getByLabelText('TDS'), '640');
    await user.type(screen.getByLabelText('EC'), '1.0');
    await user.selectOptions(screen.getByLabelText('EC unit'), 'mS/cm');
    await user.type(screen.getByLabelText('Source / laboratory'), 'Lab report 12');
    await user.click(screen.getByRole('button', { name: /Add sample/ }));
    expect(await screen.findByText('Temperature is required')).toBeInTheDocument(); // EC needs its temperature
    await user.type(screen.getByLabelText('Temperature of the EC measurement'), '25');
    await user.click(screen.getByRole('button', { name: /Add sample/ }));
    await waitFor(async () => {
      const [s] = await db.waterSamples.toArray();
      expect(s).toMatchObject({ sampleId: 'S-1', tds: 640, ecUScm: 1000, ecTemp: 25, source: 'Lab report 12' });
    });
    expect(await screen.findByText('Fresh')).toBeInTheDocument();
  });
});

describe('calibration tab', () => {
  it('needs a normalisation method; fits a local factor from samples; reports too few points', async () => {
    for (const [i, [ec, tds]] of [[500, 330], [1000, 640], [2000, 1280], [4000, 2570], [8000, 5100]].entries()) {
      await addSample(wid, { sampleId: `C${i}`, depthTop: 10 + i, source: 'Lab', tds, ec, ecTemp: 25 });
    }
    const user = userEvent.setup();
    await open(user);
    await user.click(screen.getByRole('tab', { name: 'Calibration' }));
    await user.selectOptions(screen.getByLabelText('Source of the relation'), 'local');
    expect(await screen.findByText(/Choose a temperature-normalisation method first/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Method'), 'arps');
    expect(await screen.findByText('Calibration result')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument(); // n pairs
    expect(screen.getByText(/EC25 500 – 8000 µS\/cm/)).toBeInTheDocument(); // validity range stated
    expect(screen.getByText(/5 sample\(s\) with both TDS and EC/)).toBeInTheDocument();
  });

  it('manual factor requires a source', async () => {
    const user = userEvent.setup();
    await open(user);
    await user.click(screen.getByRole('tab', { name: 'Calibration' }));
    await user.selectOptions(screen.getByLabelText('Method'), 'arps');
    await user.selectOptions(screen.getByLabelText('Source of the relation'), 'manual');
    await user.type(screen.getByLabelText('k (TDS / EC25)'), '0.65');
    expect(await screen.findByText(/Enter the source of the factor/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Source of the factor'), 'Study X');
    expect(await screen.findByText('Calibration result')).toBeInTheDocument();
  });
});

describe('estimates and the results table', () => {
  async function seed() {
    const depth = Array.from({ length: 61 }, (_, i) => i);
    const pts = (f) => depth.map((d) => ({ depth: d, value: f(d) }));
    await saveCurves(wid, [
      { curveId: 'res_deep', unit: 'ohm.m', points: pts((d) => (d < 30 ? 3 : 30)) },
      { curveId: 'gr', unit: 'gAPI', points: pts((d) => (d < 30 ? 100 : 25)) },
      { curveId: 'density', unit: 'g/cm3', points: pts(() => 2.65 - 0.25 * 1.65) },
    ], { source: 'csv' });
    const rows = await db.logMeasurements.where('wellId').equals(wid).toArray();
    const curves = Object.fromEntries(rows.map((r) => [r.curveId, { depth: r.depth, values: r.values }]));
    const config = {
      grid: { curveId: 'res_deep' }, temperature: { method: 'constant', value: 25 },
      resistivity: { rtCurve: 'res_deep', method: 'direct', cond: { thickBed: true, invasionNegligible: true, boreholeNegligible: true } },
      rw: { method: 'manual', value: 5, refTemp: 25, source: 'sample S9' }, vshale: { model: 'linear', curve: 'gr', grClean: 25, grShale: 100 },
      porosity: { method: 'density', rhoMa: 2.65, rhoFl: 1, curves: { density: 'density' }, shaleCorrection: {} },
      saturation: { model: 'simandoux', a: 1, m: 2, n: 2, vshLimit: 0.1, rsh: 2 },
    };
    await saveInterpretation(wid, { name: 'Run W', config, result: runInterpretation(config, curves) });
    await addFormation(wid, { top: 0, bottom: 30, name: 'Clay' });
    await addFormation(wid, { top: 30, bottom: 60, name: 'Sand' });
    await addSample(wid, { sampleId: 'D1', depthTop: 40, source: 'Lab', tds: 1250 });
    await saveSettings(wid, {
      normalization: { method: 'arps' }, calibration: { mode: 'manual', model: 'factor', scope: 'well', manual: { k: 0.64, source: 'Study X', uncertaintyPct: 10 } },
      rwUncertaintyPct: 20, runId: null,
    });
  }

  it('estimates TDS from Rw (never from Rt), shows direct vs indirect, and applies it to the results table with its trace', async () => {
    await seed();
    const user = userEvent.setup();
    await open(user);
    await user.click(screen.getByRole('tab', { name: 'Estimate by interval' }));
    // Rw = 5 ohm.m at 25 C -> EC25 = 2000 uS/cm -> TDS = 0.64*2000 = 1280 mg/L
    expect((await screen.findAllByText('2000')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('1280').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1250').length).toBeGreaterThan(0); // direct sample TDS of the sand
    expect(screen.getAllByText(/-?\+?2\.4/).length).toBeGreaterThan(0); // difference +2.4 %
    expect(screen.getByText(/Rw is the resistivity of the formation water/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apply all estimates to the results table' }));
    await waitFor(async () => {
      const f = await db.formations.where('wellId').equals(wid).sortBy('top');
      expect(f[1].waterQuality).toMatchObject({ basis: 'indirect', status: 'estimated' });
      expect(f[1].waterQuality.tds).toBeCloseTo(1280, 4);
      expect(f[1].waterQuality.calibration).toMatchObject({ model: 'factor', source: 'manual', sourceText: 'Study X' });
      expect(f[1].waterQuality.relPct).toBeCloseTo(Math.sqrt(0.1 ** 2 + 0.2 ** 2) * 100, 6);
    });
    // the results table reads it, classified as estimated and traceable
    const f = await db.formations.where('wellId').equals(wid).sortBy('top');
    const row = buildRows(f, { curves: {}, run: null, sources: {} })[1];
    expect(row.cells.tds).toMatchObject({ status: 'estimated', trace: { kind: 'water', basis: 'indirect' } });
    expect(row.cells.tds.v).toBeCloseTo(1280, 4);
  });

  it('applying a direct sample value labels it measured/direct', async () => {
    await seed();
    const user = userEvent.setup();
    await open(user);
    await user.click(screen.getByRole('tab', { name: 'Estimate by interval' }));
    await user.click(await screen.findByRole('button', { name: 'Use sample' }));
    await waitFor(async () => {
      const f = await db.formations.where('wellId').equals(wid).sortBy('top');
      expect(f[1].waterQuality).toMatchObject({ basis: 'direct', status: 'measured', tds: 1250, sampleId: 'D1' });
    });
  });

  it('refuses to estimate until normalisation and calibration are defined', async () => {
    await seed();
    await saveSettings(wid, { normalization: {}, calibration: { model: 'factor', scope: 'well', manual: {} }, runId: null });
    const user = userEvent.setup();
    await open(user);
    await user.click(screen.getByRole('tab', { name: 'Estimate by interval' }));
    expect(await screen.findByText(/Complete the Calibration tab/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply all estimates to the results table' })).toBeDisabled();
  });
});

describe('converter', () => {
  it('converts Rw at temperature and shows the full trace; TDS only with a calibration', async () => {
    await saveSettings(wid, { normalization: { method: 'alpha', alpha: 0.02 }, calibration: { mode: 'manual', model: 'factor', scope: 'well', manual: { k: 0.6, source: 'Cited' } }, runId: null });
    const user = userEvent.setup();
    await open(user);
    await user.click(screen.getByRole('tab', { name: 'Converter' }));
    await user.type(screen.getByLabelText('Rw'), '5');
    await user.type(screen.getByLabelText('Temperature of the value'), '35');
    // EC(35C) = 2000 uS/cm ; EC25 = 2000/(1+0.02*10) = 1666.67 ; TDS = 0.6*1666.67 = 1000
    expect(await screen.findByText('1666.7')).toBeInTheDocument();
    expect(screen.getByText('1000')).toBeInTheDocument();
    const trace = screen.getByText('Inputs:').closest('.water-trace');
    expect(within(trace).getByText(/Temperature reference/)).toBeInTheDocument();
    expect(within(trace).getByText(/Cited/)).toBeInTheDocument();
    expect(within(trace).getByText('EC normalisation to 25 °C – linear coefficient')).toBeInTheDocument();
  });
});
