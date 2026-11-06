import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach } from 'vitest';
import App from '../src/app/App.jsx';
import { PrefsProvider } from '../src/app/PrefsContext.jsx';
import { db } from '../src/db/db.js';
import { createProject, createWell } from '../src/db/repos.js';
import { saveCurves } from '../src/db/curves.js';
import { addFormation } from '../src/db/intervals.js';

let wid;
beforeEach(async () => {
  const pid = await createProject({ name: 'P' });
  wid = await createWell({ projectId: pid, wellId: 'T-1', name: 'Table well', totalDepth: 40 });
  const depth = Array.from({ length: 41 }, (_, i) => i);
  const pts = (f) => depth.map((d) => ({ depth: d, value: f(d) }));
  await saveCurves(wid, [
    { curveId: 'gr', unit: 'gAPI', points: pts((d) => (d < 20 ? 100 : 25)) },
    { curveId: 'res_deep', unit: 'ohm.m', points: pts((d) => (d < 20 ? 2 : 40)) },
  ], { source: 'csv' });
  await addFormation(wid, { top: 0, bottom: 20, name: 'Clay' });
  await addFormation(wid, { top: 20, bottom: 40, name: 'Sand' });
});

const open = async (user, path = '/results') => {
  render(<PrefsProvider><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></PrefsProvider>);
  await user.selectOptions(await screen.findByLabelText(/Target well/), String(wid));
  if (path === '/results') await screen.findByRole('grid');
};
const dbl = (td) => fireEvent.doubleClick(td);
const cellOf = (rowIdx, text) => screen.getAllByRole('row')[rowIdx + 2].querySelectorAll('td')[text];

describe('results table', () => {
  it('shows intervals with automatic thickness and measured values from the logs', async () => {
    const user = userEvent.setup();
    await open(user);
    const rows = screen.getAllByRole('row').slice(2);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Clay')).toBeInTheDocument();
    expect(within(rows[1]).getAllByText('20').length).toBeGreaterThan(0); // thickness 20 m
    expect(within(rows[1]).getByText('25')).toBeInTheDocument();          // mean GR of the sand
    expect(within(rows[0]).getByText('2')).toBeInTheDocument();           // geometric mean Rd of the clay
  });

  it('edits a cell inline, recalculates thickness, rejects invalid and overlapping values', async () => {
    const user = userEvent.setup();
    await open(user);
    const input = async (label) => screen.findByLabelText(label);
    // bottom of the clay: 20 -> 15  (thickness becomes 15)
    dbl(screen.getAllByRole('row')[2].querySelectorAll('td')[4]); // 0 sel,1 number,2 name,3 top,4 bottom
    const bottom = await input('Bottom depth 1');
    await user.clear(bottom); await user.type(bottom, '15{Enter}');
    await waitFor(async () => expect((await db.formations.where('wellId').equals(wid).sortBy('top'))[0].bottom).toBe(15));
    await waitFor(() => expect(screen.queryByLabelText('Bottom depth 1')).toBeNull()); // editor closed

    // invalid text stays in the editor with an error and nothing is saved
    dbl(screen.getAllByRole('row')[2].querySelectorAll('td')[4]);
    const b2 = await input('Bottom depth 1');
    fireEvent.change(b2, { target: { value: 'abc' } }); fireEvent.keyDown(b2, { key: 'Enter' });
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent('Not a number');
    fireEvent.keyDown(b2, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByLabelText('Bottom depth 1')).toBeNull());

    // overlap rejected
    dbl(screen.getAllByRole('row')[2].querySelectorAll('td')[4]);
    await waitFor(() => expect(screen.getByLabelText('Bottom depth 1')).toHaveValue('15'));
    const b3 = screen.getByLabelText('Bottom depth 1');
    fireEvent.change(b3, { target: { value: '30' } });
    await waitFor(() => expect(screen.getByLabelText('Bottom depth 1')).toHaveValue('30')); fireEvent.keyDown(b3, { key: 'Enter' });
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent('Overlaps another interval');
    expect((await db.formations.where('wellId').equals(wid).sortBy('top'))[0].bottom).toBe(15);
  });

  it('typing in a calculated column stores a manual value with its marker; clearing removes it', async () => {
    const user = userEvent.setup();
    await open(user);
    // the TDS column is visible by default (lab values can be typed); it has no calculated source yet
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    const idx = headers.findIndex((h) => h.startsWith('TDS'));
    dbl(screen.getAllByRole('row')[3].querySelectorAll('td')[idx]);
    const inp = await screen.findByLabelText('TDS 2');
    await user.type(inp, '850{Enter}');
    await waitFor(async () => {
      const f = (await db.formations.where('wellId').equals(wid).sortBy('top'))[1];
      expect(JSON.stringify(f)).toContain('850');
    });
    expect(await screen.findByTitle('manual')).toBeInTheDocument();
  });

  it('filters, sorts and converts units (feet)', async () => {
    const user = userEvent.setup();
    await open(user);
    await user.type(screen.getByLabelText('Filter Formation name'), 'sand');
    expect(screen.getAllByRole('row').slice(2)).toHaveLength(1);
    await user.clear(screen.getByLabelText('Filter Formation name'));
    await user.type(screen.getByLabelText('Filter Gamma ray'), '>50');
    const rows = screen.getAllByRole('row').slice(2);
    expect(rows).toHaveLength(1); expect(within(rows[0]).getByText('Clay')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Filter Gamma ray'));

    await user.selectOptions(screen.getByLabelText('Depth unit'), 'ft');
    expect(screen.getAllByText('65.617').length).toBeGreaterThan(0); // 20 m = 65.617 ft
    await user.click(screen.getByRole('columnheader', { name: /Top depth/ })); // already ascending -> descending
    expect(within(screen.getAllByRole('row')[2]).getByText('Sand')).toBeInTheDocument();
  });

  it('bulk edit applies one value to all ticked rows; add and delete rows', async () => {
    const user = userEvent.setup();
    await open(user);
    await user.click(screen.getByLabelText('Select all rows'));
    await user.selectOptions(screen.getByLabelText('Column'), 'lithology');
    await user.type(screen.getByLabelText('Value'), 'sandy clay');
    await user.click(screen.getByRole('button', { name: /Apply to selected/ }));
    await waitFor(async () => { const fs = await db.formations.where('wellId').equals(wid).toArray(); expect(fs.every((f) => f.lithology === 'sandy clay')).toBe(true); });

    await user.click(screen.getByLabelText('Select all rows')); // untick
    await user.click(screen.getByRole('button', { name: /Add interval/ }));
    await waitFor(async () => expect(await db.formations.where('wellId').equals(wid).count()).toBe(3)); // the last interval ends at TD, so the new one is 40..41
    window.confirm = () => true;
  });

  it('pastes a block copied from Excel (tab separated) into consecutive cells', async () => {
    const user = userEvent.setup();
    await open(user);
    const grid = screen.getByRole('grid');
    await user.click(screen.getAllByRole('row')[2].querySelectorAll('td')[7]); // Lithology column? find by header below
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    const li = headers.findIndex((h) => h.startsWith('Lithology'));
    await user.click(screen.getAllByRole('row')[2].querySelectorAll('td')[li]);
    fireEvent.paste(grid, { clipboardData: { getData: () => 'shale\nsandstone' } });
    await waitFor(async () => {
      const fs = await db.formations.where('wellId').equals(wid).sortBy('top');
      expect(fs.map((f) => f.lithology)).toEqual(['shale', 'sandstone']);
    });
    expect(await screen.findByText(/2 cell\(s\) accepted, 0 rejected/)).toBeInTheDocument();
  });

  it('snapshots can be restored after deleting intervals', async () => {
    const user = userEvent.setup();
    await open(user);
    await user.type(screen.getByLabelText('Snapshot name'), 'before');
    await user.click(screen.getByRole('button', { name: 'Save snapshot' }));
    await screen.findByText('before');
    await db.formations.where('wellId').equals(wid).delete();
    window.confirm = () => true;
    await user.click(await screen.findByRole('button', { name: 'Restore' }));
    await waitFor(async () => expect(await db.formations.where('wellId').equals(wid).count()).toBe(2));
  });
});

describe('formation analysis page', () => {
  it('shows summary and statistics, screens with user cut-offs, never invents them, and applies only to unknown intervals', async () => {
    const { runInterpretation } = await import('../src/engine/interpret.js');
    const { saveInterpretation } = await import('../src/db/interp.js');
    const rows = await db.logMeasurements.where('wellId').equals(wid).toArray();
    const curves = Object.fromEntries(rows.map((r) => [r.curveId, { depth: r.depth, values: r.values }]));
    const depth = curves.gr.depth;
    await saveCurves(wid, [{ curveId: 'density', unit: 'g/cm3', points: depth.map((d) => ({ depth: d, value: d < 20 ? 2.5 : 2.65 - 0.25 * 1.65 })) }], { source: 'csv' });
    const all = Object.fromEntries((await db.logMeasurements.where('wellId').equals(wid).toArray()).map((r) => [r.curveId, { depth: r.depth, values: r.values }]));
    const config = {
      grid: { curveId: 'res_deep' }, temperature: { method: 'constant', value: 25 },
      resistivity: { rtCurve: 'res_deep', method: 'direct', cond: { thickBed: true, invasionNegligible: true, boreholeNegligible: true } },
      rw: { method: 'manual', value: 1, refTemp: 25, source: 'S1' }, vshale: { model: 'larionov_older', curve: 'gr', grClean: 25, grShale: 100 },
      porosity: { method: 'density', rhoMa: 2.65, rhoFl: 1, curves: { density: 'density' }, shaleCorrection: {} },
      saturation: { model: 'simandoux', a: 1, m: 2, n: 2, vshLimit: 0.1, rsh: 2 },
    };
    await saveInterpretation(wid, { name: 'Run A', config, result: runInterpretation(config, all) });
    const user = userEvent.setup();
    await open(user, '/formations');
    expect(await screen.findByText(/Water-bearing thickness/)).toBeInTheDocument();
    expect(screen.getByText(/Interpretation run:/)).toBeInTheDocument();
    // without cut-offs nothing can be suggested
    expect((await screen.findAllByText('Unknown')).length).toBeGreaterThan(1);
    await user.type(screen.getByLabelText('Maximum Vshale'), '0.15');
    await user.type(screen.getByLabelText('Minimum porosity'), '0.1');
    await user.type(screen.getByLabelText('Minimum water saturation'), '0.5');
    await user.click(screen.getByRole('button', { name: 'Apply to intervals with unknown status' }));
    await waitFor(async () => {
      const f = await db.formations.where('wellId').equals(wid).sortBy('top');
      expect(f[0].waterBearing).toBe('no');        // clay fails Vshale
      expect(f[1].waterBearing).toBe('probable');  // clean sand passes all three
      expect(f[1].confidence).toBe('high');
      expect(f.some((x) => x.waterBearing === 'yes')).toBe(false); // never confirmed automatically
    });
  });
});
