import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach } from 'vitest';
import App from '../src/app/App.jsx';
import { PrefsProvider } from '../src/app/PrefsContext.jsx';
import { createProject, createWell } from '../src/db/repos.js';
import { saveCurves } from '../src/db/curves.js';
import { saveConfig, listInterpretations } from '../src/db/interp.js';

let wid;
beforeEach(async () => {
  const pid = await createProject({ name: 'P' });
  wid = await createWell({ projectId: pid, wellId: 'I-1', name: 'Interp well' });
  const depth = Array.from({ length: 21 }, (_, i) => i);
  const pts = (f) => depth.map((d) => ({ depth: d, value: f(d) }));
  await saveCurves(wid, [
    { curveId: 'res_deep', unit: 'ohm.m', points: pts(() => 10) },
    { curveId: 'gr', unit: 'gAPI', points: pts(() => 20) },
    { curveId: 'density', unit: 'g/cm3', points: pts(() => 2.65 - 0.25 * 1.65) },
  ], { source: 'csv' });
});

const open = async (user) => {
  render(<PrefsProvider><MemoryRouter initialEntries={['/interpretation']}><App /></MemoryRouter></PrefsProvider>);
  await user.selectOptions(await screen.findByLabelText(/Target well/), String(wid));
};

describe('interpretation page', () => {
  it('computes nothing without parameters and says exactly what is missing', async () => {
    const user = userEvent.setup();
    await open(user);
    expect(await screen.findByText(/Nothing is assumed/)).toBeInTheDocument();
    expect(await screen.findByText(/no resistivity curve selected/)).toBeInTheDocument();
    expect(screen.getByText(/no Rw method/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save this interpretation' })).toBeEnabled(); // saving an empty run is allowed but shows zeros
  });

  it('a stored, fully specified configuration yields Sw, and the run can be saved', async () => {
    await saveConfig(wid, {
      grid: { curveId: 'res_deep' }, temperature: { method: 'constant', value: 25, source: 'test' },
      resistivity: { rtCurve: 'res_deep', method: 'direct', cond: { thickBed: true, invasionNegligible: true, boreholeNegligible: true } },
      rw: { method: 'manual', value: 0.05, refTemp: 25, source: 'sample S1' },
      vshale: { model: 'larionov_older', curve: 'gr', grClean: 20, grShale: 100 },
      porosity: { method: 'density', rhoMa: 2.65, rhoFl: 1, curves: { density: 'density' }, shaleCorrection: {} },
      saturation: { model: 'archie', a: 1, m: 2, n: 2, vshLimit: 0.1 },
    });
    const user = userEvent.setup();
    await open(user);
    // Sw column in the results table shows the Archie value 0.2828
    expect((await screen.findAllByText('0.2828')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Water saturation – Archie/)).toBeInTheDocument(); // method documentation present
    await user.type(screen.getByLabelText('Run name'), 'Run A');
    await user.click(screen.getByRole('button', { name: 'Save this interpretation' }));
    await waitFor(async () => {
      const [r] = await listInterpretations(wid);
      expect(r.name).toBe('Run A');
      expect(r.series.sw[0]).toBeCloseTo(Math.sqrt(0.08), 8);
      expect(r.methods).toContain('sw_archie');
      expect(r.config.rw.source).toBe('sample S1'); // inputs are stored with the results
    });
  });

  it('typing parameters updates results live (Rw changes Sw)', async () => {
    await saveConfig(wid, {
      grid: { curveId: 'res_deep' }, temperature: { method: 'constant', value: 25 },
      resistivity: { rtCurve: 'res_deep', method: 'direct', cond: { thickBed: true, invasionNegligible: true, boreholeNegligible: true } },
      rw: { method: 'manual', value: 0.05, refTemp: 25, source: 'S1' },
      vshale: { model: 'linear', curve: 'gr', grClean: 20, grShale: 100 },
      porosity: { method: 'density', rhoMa: 2.65, rhoFl: 1, curves: { density: 'density' }, shaleCorrection: {} },
      saturation: { model: 'archie', a: 1, m: 2, n: 2, vshLimit: 0.1 },
    });
    const user = userEvent.setup();
    await open(user);
    await screen.findAllByText('0.2828');
    const rw = screen.getByLabelText('Rw');
    await user.clear(rw);
    await user.type(rw, '0.2');
    expect((await screen.findAllByText('0.5657')).length).toBeGreaterThan(0); // sqrt(0.2/0.625)
  });
});
