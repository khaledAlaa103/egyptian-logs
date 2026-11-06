import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import App from '../src/app/App.jsx';
import { PrefsProvider } from '../src/app/PrefsContext.jsx';
import { db } from '../src/db/db.js';
import { createProject, createWell } from '../src/db/repos.js';
import { saveCurves } from '../src/db/curves.js';
import { addFormation } from '../src/db/intervals.js';

let wid;
beforeEach(async () => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
  URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn();
  const pid = await createProject({ name: 'Proj' });
  wid = await createWell({ projectId: pid, wellId: 'UI-1', name: 'UI well', totalDepth: 40 });
  const depth = Array.from({ length: 41 }, (_, i) => i);
  await saveCurves(wid, [{ curveId: 'gr', unit: 'gAPI', points: depth.map((d) => ({ depth: d, value: 50 })) }], { source: 'csv' });
  await addFormation(wid, { top: 0, bottom: 40, name: 'Sand' });
});

const open = async (user) => {
  render(<PrefsProvider><MemoryRouter initialEntries={['/reports']}><App /></MemoryRouter></PrefsProvider>);
  await user.selectOptions(await screen.findByLabelText(/Target well/), String(wid));
};

describe('reports page', () => {
  it('shows the 18-section preview, switches the report to Arabic RTL independently of the interface, and honours section toggles', async () => {
    const user = userEvent.setup();
    await open(user);
    const doc = await waitFor(() => { const d = document.querySelector('.rdoc'); expect(d).toBeTruthy(); return d; }, { timeout: 5000 });
    expect(doc).toHaveAttribute('dir', 'ltr');
    await waitFor(() => expect(doc.querySelectorAll('.r-h').length).toBe(17)); // 17 numbered headings: the cover page has none
    expect(within(doc).getByText('11. Water quality and TDS estimation')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Report language'), 'ar');
    await waitFor(() => expect(document.querySelector('.rdoc')).toHaveAttribute('dir', 'rtl'));
    expect(document.documentElement.dir).toBe('ltr'); // the application interface did not change
    await waitFor(() => expect(within(document.querySelector('.rdoc')).getByText(/11\. جودة المياه وتقدير TDS/)).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Report language'), 'en');
    await user.click(screen.getByLabelText('Original well-log images'));
    await waitFor(() => expect(within(document.querySelector('.rdoc')).queryByText(/6. Original well-log images/)).toBeNull());
  });

  it('puts the author’s texts in the report, exports Excel/CSV, and saves the report definition', async () => {
    const user = userEvent.setup();
    await open(user);
    await waitFor(() => expect(document.querySelector('.rdoc')).toBeTruthy(), { timeout: 5000 });
    await user.type(screen.getByLabelText('Your conclusions (section 17)'), 'Sand is the target aquifer.');
    await waitFor(() => expect(within(document.querySelector('.rdoc')).getByText('Sand is the target aquifer.')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Excel workbook' }));
    await user.click(screen.getByRole('button', { name: 'Results CSV' }));
    await user.click(screen.getByRole('button', { name: 'Curves CSV' }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(3);

    await user.click(screen.getByRole('button', { name: 'Save report definition' }));
    await waitFor(async () => { const [r] = await db.reports.toArray(); expect(r.options.texts.conclusions).toBe('Sand is the target aquifer.'); expect(r.wellId).toBe(wid); });
    expect(await screen.findByText(/Report saved/)).toBeInTheDocument();
  });
});
