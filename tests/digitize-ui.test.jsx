import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach } from 'vitest';
import App from '../src/app/App.jsx';
import { PrefsProvider } from '../src/app/PrefsContext.jsx';
import { createProject, createWell } from '../src/db/repos.js';
import { addImage } from '../src/db/images.js';
import { db } from '../src/db/db.js';

let wid;
beforeEach(async () => {
  const pid = await createProject({ name: 'P' });
  wid = await createWell({ projectId: pid, wellId: 'D-1', name: 'Dig well' });
});

const open = async (user) => {
  render(<PrefsProvider><MemoryRouter initialEntries={['/import']}><App /></MemoryRouter></PrefsProvider>);
  await user.selectOptions(await screen.findByLabelText(/Target well/), String(wid));
  await user.click(screen.getByRole('tab', { name: 'Log image' }));
};

describe('image digitizer entry (jsdom has no canvas: pure logic is tested elsewhere)', () => {
  it('shows the five workflow steps with only step 1 enabled before an image is open', async () => {
    const user = userEvent.setup();
    await open(user);
    const tabs = await screen.findAllByRole('tab', { name: /^\d\./ });
    expect(tabs.map((t) => t.textContent)).toEqual(['1. Image', '2. Crop & rotate', '3. Calibrate', '4. Digitize', '5. Review & export']);
    expect(tabs[0]).toBeEnabled();
    tabs.slice(1).forEach((t) => expect(t).toBeDisabled());
  });

  it('rejects unsupported files with a clear message and stores nothing', async () => {
    const user = userEvent.setup({ applyAccept: false }); // bypass the browser accept filter to test our own validation
    await open(user);
    const input = await screen.findByLabelText('Choose image or PDF');
    await user.upload(input, new File(['gif'], 'a.gif', { type: 'image/gif' }));
    expect(await screen.findByText(/Unsupported file type/)).toBeInTheDocument();
    expect(await db.logImages.count()).toBe(0);
  });

  it('lists saved images of the selected well', async () => {
    await addImage(wid, { name: 'scan_01.png', mime: 'image/png', blob: new Blob(['x']), width: 640, height: 480 });
    const user = userEvent.setup();
    await open(user);
    expect(await screen.findByText('scan_01.png')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled());
  });
});
