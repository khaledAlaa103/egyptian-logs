import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import App from '../src/app/App.jsx';
import { PrefsProvider } from '../src/app/PrefsContext.jsx';
import { db } from '../src/db/db.js';
import { createProject, createWell } from '../src/db/repos.js';
import { saveCurves } from '../src/db/curves.js';
import { loadLayout } from '../src/db/intervals.js';

let wid;
beforeEach(async () => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null); // jsdom has no canvas; drawing is tested via renderLog
  const pid = await createProject({ name: 'P' });
  wid = await createWell({ projectId: pid, wellId: 'V-1', name: 'View well' });
  const depth = Array.from({ length: 50 }, (_, i) => i * 2);
  await saveCurves(wid, [
    { curveId: 'gr', unit: 'gAPI', points: depth.map((d) => ({ depth: d, value: 40 + (d % 30) })) },
    { curveId: 'res_deep', unit: 'ohm.m', points: depth.map((d) => ({ depth: d, value: 5 + d })) },
  ], { source: 'csv' });
});

const open = async (user) => {
  render(<PrefsProvider><MemoryRouter initialEntries={['/viewer']}><App /></MemoryRouter></PrefsProvider>);
  await user.selectOptions(await screen.findByLabelText(/Target well/), String(wid));
};

describe('log viewer page', () => {
  it('shows a notice for a well without curves', async () => {
    const user = userEvent.setup();
    const w2 = await createWell({ projectId: 1, wellId: 'EMPTY', name: 'Empty' });
    render(<PrefsProvider><MemoryRouter initialEntries={['/viewer']}><App /></MemoryRouter></PrefsProvider>);
    await user.selectOptions(await screen.findByLabelText(/Target well/), String(w2));
    expect(await screen.findByText(/no log curves yet/)).toBeInTheDocument();
  });

  it('builds a default layout from existing curves and persists user edits', async () => {
    const user = userEvent.setup();
    await open(user);
    expect(await screen.findByTestId('log-canvas')).toBeInTheDocument();
    expect(await screen.findByLabelText('Title 1')).toHaveValue('GR / SP / CAL');
    expect(screen.getByLabelText('Title 2')).toHaveValue('Resistivity');

    const title = screen.getByLabelText('Title 2');
    await user.clear(title);
    await user.type(title, 'Deep res');
    await user.click(screen.getByLabelText('Visible RD'));
    await waitFor(async () => {
      const l = await loadLayout(wid);
      expect(l.tracks[1].title).toBe('Deep res');
      expect(l.tracks[1].curves[0].visible).toBe(false);
    }, { timeout: 3000 });

    // changing a curve scale to log with invalid bounds falls back to valid log bounds
    await user.selectOptions(screen.getByLabelText('Scale GR'), 'log');
    const l = await waitFor(async () => { const x = await loadLayout(wid); expect(x.tracks[0].curves[0].scale).toBe('log'); return x; });
    expect(l.tracks[0].curves[0].min).toBeGreaterThan(0);
  });

  it('reorders, adds and removes tracks and curves', async () => {
    const user = userEvent.setup();
    await open(user);
    await user.click(await screen.findByLabelText('Move down 1'));
    expect(screen.getByLabelText('Title 1')).toHaveValue('Resistivity');
    await user.click(screen.getByRole('button', { name: /Add track/ }));
    expect(screen.getByLabelText('Title 3')).toHaveValue('New track');
    await user.selectOptions(screen.getByLabelText('Add curve to track 3'), 'gr');
    await user.click(screen.getByLabelText('Add curve to track 3').nextElementSibling);
    expect(screen.getAllByLabelText('Visible GR')).toHaveLength(2); // GR now in two tracks (overlay allowed)
    await user.click(screen.getByLabelText('Delete Track 3'));
    expect(screen.queryByLabelText('Title 3')).not.toBeInTheDocument();
  });

  it('adds formation intervals with validation and shows water status', async () => {
    const user = userEvent.setup();
    await open(user);
    await user.click(await screen.findByRole('tab', { name: 'Intervals & markers' }));
    await user.type(screen.getByLabelText('New top'), '10');
    await user.type(screen.getByLabelText('New bottom'), '5');
    await user.click(screen.getByRole('button', { name: /Add interval/ }));
    expect(await screen.findByText('Bottom must be deeper than top')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('New bottom'));
    await user.type(screen.getByLabelText('New bottom'), '30');
    await user.type(screen.getByLabelText('New name'), 'Sand A');
    await user.selectOptions(screen.getByLabelText('New water status'), 'yes');
    await user.click(screen.getByRole('button', { name: /Add interval/ }));
    await waitFor(async () => {
      const f = await db.formations.toArray();
      expect(f).toHaveLength(1);
      expect(f[0]).toMatchObject({ name: 'Sand A', top: 10, bottom: 30, waterBearing: 'yes' });
    });
    expect(await screen.findByDisplayValue('Sand A')).toBeInTheDocument();
  });
});

