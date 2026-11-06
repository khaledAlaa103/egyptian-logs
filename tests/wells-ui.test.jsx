import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import App from '../src/app/App.jsx';
import { PrefsProvider } from '../src/app/PrefsContext.jsx';
import { db } from '../src/db/db.js';
import { createProject } from '../src/db/repos.js';
import en from '../src/i18n/en.js';

const setup = (path) => render(
  <PrefsProvider><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></PrefsProvider>
);

describe('projects & wells UI', () => {
  it('creates a project with validation, persisting to IndexedDB', async () => {
    const user = userEvent.setup();
    setup('/projects');
    await user.click(await screen.findByRole('button', { name: /New project/ }));
    await user.click(screen.getByRole('button', { name: en.common.save }));
    expect(await screen.findByText(en.err.required)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /Project name/ }), 'Aquifer Study');
    await user.click(screen.getByRole('button', { name: en.common.save }));
    expect(await screen.findByText('Aquifer Study')).toBeInTheDocument();
    expect(await db.projects.count()).toBe(1);
  });

  it('adds, searches and archives a well', async () => {
    const user = userEvent.setup();
    await createProject({ name: 'P' });
    setup('/wells');
    await user.click(await screen.findByRole('button', { name: /New well/ }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText(/Well ID/), 'BH-7');
    await user.type(within(dlg).getByLabelText(/Well name/), 'Borehole Seven');
    await user.type(within(dlg).getByLabelText(/Latitude/), '123');
    await user.click(within(dlg).getByRole('button', { name: en.common.save }));
    expect(await within(dlg).findByText(en.err.range)).toBeInTheDocument();
    await user.clear(within(dlg).getByLabelText(/Latitude/));
    await user.click(within(dlg).getByRole('button', { name: en.common.save }));
    expect(await screen.findByText('Borehole Seven')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(await screen.findByText(en.wells.empty)).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.click(await screen.findByRole('button', { name: en.common.archive }));
    expect(await screen.findByText(en.wells.empty)).toBeInTheDocument();
    expect((await db.wells.toArray())[0].status).toBe('archived');
  });
});
