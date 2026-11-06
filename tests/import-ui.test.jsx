import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import App from '../src/app/App.jsx';
import { PrefsProvider } from '../src/app/PrefsContext.jsx';
import { db } from '../src/db/db.js';
import { createProject, createWell } from '../src/db/repos.js';
import { listWellCurves } from '../src/db/curves.js';

let wid;
beforeEach(async () => {
  const pid = await createProject({ name: 'P' });
  wid = await createWell({ projectId: pid, wellId: 'W-1', name: 'One', totalDepth: 200 });
});

const setup = () => render(
  <PrefsProvider><MemoryRouter initialEntries={['/import']}><App /></MemoryRouter></PrefsProvider>
);
const pickWell = async (user) => {
  const sel = await screen.findByLabelText(/Target well/);
  await user.selectOptions(sel, String(wid));
};

describe('manual entry', () => {
  it('autosaves valid cells (converted to canonical units) and flags invalid ones', async () => {
    const user = userEvent.setup();
    setup();
    await pickWell(user);
    await user.selectOptions(screen.getByLabelText('Add curve', { selector: 'select' }), 'res_deep');
    await user.click(screen.getByRole('button', { name: /Add curve/ }));

    await user.selectOptions(screen.getByLabelText('Depth unit'), 'ft');
    await user.type(screen.getByLabelText('Depth 1'), '100');
    await user.type(screen.getByLabelText('RD 1'), '25');
    await user.type(screen.getByLabelText('Depth 2'), '200');
    await user.type(screen.getByLabelText('RD 2'), '-4'); // log scale: invalid

    expect(screen.getByLabelText('RD 2')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('RD 1')).toHaveAttribute('aria-invalid', 'false');

    await waitFor(async () => {
      const [r] = await listWellCurves(wid);
      expect(r).toBeTruthy();
      expect(r.depth[0]).toBeCloseTo(30.48, 8); // ft -> m
      expect(r.values).toEqual([25]); // invalid value NOT saved
      expect(r.source).toBe('manual');
    }, { timeout: 4000 });
  });
});

describe('CSV import wizard', () => {
  it('maps, validates, blocks until unit chosen, then saves with provenance', async () => {
    const user = userEvent.setup();
    setup();
    await pickWell(user);
    await user.click(screen.getByRole('tab', { name: 'CSV' }));

    const text = readFileSync(resolve(process.cwd(), 'samples', 'SYNTHETIC_semicolon_decimal_comma.csv'), 'utf8')
      .replace('GR (gAPI)', 'GR'); // remove the unit: must block until the user chooses one
    const file = new File([text], 'test.csv', { type: 'text/csv' });
    await user.upload(screen.getByLabelText('Choose CSV file'), file);

    expect(await screen.findByText(/select its unit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm and save' })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('Unit GR'), 'gAPI');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm and save' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Confirm and save' }));

    await waitFor(async () => expect((await listWellCurves(wid)).length).toBe(4));
    const gr = (await listWellCurves(wid)).find((c) => c.curveId === 'gr');
    expect(gr).toMatchObject({ source: 'csv', unit: 'gAPI' });
    expect(gr.meta).toMatchObject({ fileName: 'test.csv', delimiter: ';' });
    expect(gr.values[0]).toBe(40.5);
    expect(await screen.findByText(/4 curve\(s\) saved/)).toBeInTheDocument();
  });

  it('shows row-level import errors before saving', async () => {
    const user = userEvent.setup();
    setup();
    await pickWell(user);
    await user.click(screen.getByRole('tab', { name: 'CSV' }));
    const text = 'Depth (m),GR (gAPI)\n1,50\nx,60\n3,abc\n';
    await user.upload(screen.getByLabelText('Choose CSV file'), new File([text], 'bad.csv'));
    expect(await screen.findByText(/Row 3: depth "x" is not a valid number/)).toBeInTheDocument();
    expect(screen.getByText(/Row 4, GR: "abc" is not a number/)).toBeInTheDocument();
    expect(within(document.body).getByText(/1 used|data rows read/)).toBeInTheDocument();
    expect(await db.logMeasurements.count()).toBe(0); // nothing saved yet
  });
});
