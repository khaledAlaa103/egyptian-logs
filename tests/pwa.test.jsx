import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/app/App.jsx';
import { PrefsProvider } from '../src/app/PrefsContext.jsx';
import { PwaProvider, PwaContext } from '../src/pwa/PwaContext.jsx';
import { PwaToasts } from '../src/pwa/PwaUi.jsx';
import { formatBytes, getStorageInfo, requestPersistence } from '../src/pwa/storage.js';
import { verifyDist } from '../scripts/verify-pwa.mjs';

const dist = resolve(process.cwd(), 'dist');

describe.skipIf(!existsSync(resolve(dist, 'sw.js')))('production build is an offline-capable PWA (run `npm run build` first)', () => {
  it('has a valid manifest, a service worker that precaches every asset (incl. the PDF worker), and no external resources', async () => {
    const { problems, info } = await verifyDist(dist);
    expect(problems).toEqual([]);
    expect(info.precached).toBeGreaterThan(10);
  });
});

describe('verifyDist detects a broken build', () => {
  it('reports a missing dist folder', async () => {
    expect((await verifyDist(resolve(process.cwd(), 'no-such-dist'))).problems[0]).toMatch(/not found/);
  });
});

describe('storage helpers', () => {
  it('formats sizes and degrades gracefully without the Storage API', async () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(typeof (await getStorageInfo()).supported).toBe('boolean');
    expect(typeof (await requestPersistence())).toBe('boolean');
  });
  it('reports usage and persistence when available', async () => {
    const original = navigator.storage;
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ usage: 2048, quota: 1048576 }), persisted: async () => true, persist: async () => true } });
    expect(await getStorageInfo()).toEqual({ supported: true, persisted: true, usage: 2048, quota: 1048576 });
    expect(await requestPersistence()).toBe(true);
    Object.defineProperty(navigator, 'storage', { configurable: true, value: original });
  });
});

describe('offline indicator, install prompt, settings panel', () => {
  const setup = (path = '/') => render(
    <PrefsProvider><PwaProvider><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></PwaProvider></PrefsProvider>
  );

  it('shows an offline badge when the connection drops and hides it when it returns', async () => {
    setup();
    expect(screen.queryByRole('status', { name: '' })).toBeNull();
    await act(async () => { window.dispatchEvent(new Event('offline')); });
    expect(await screen.findByText(/Offline/, { selector: '.offline-badge' })).toBeInTheDocument();
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(document.querySelector('.offline-badge')).toBeNull();
  });

  it('offers an install button only when the browser fires beforeinstallprompt, and calls prompt()', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
    const prompt = vi.fn();
    const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    await act(async () => { window.dispatchEvent(ev); });
    await user.click(await screen.findByRole('button', { name: 'Install app' }));
    expect(prompt).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event('appinstalled')); });
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
  });

  it('settings page explains offline use and shows the connection state in both languages', async () => {
    setup('/settings');
    expect(await screen.findByText('Offline use and installation')).toBeInTheDocument();
    expect(screen.getByText(/Make a backup file regularly/)).toBeInTheDocument();
  });

  it('update toast is applied only when the user chooses to; the offline-ready toast can be dismissed', async () => {
    const user = userEvent.setup();
    const applyUpdate = vi.fn(), dismissRefresh = vi.fn(), dismissOfflineReady = vi.fn();
    render(
      <PrefsProvider>
        <PwaContext.Provider value={{ online: true, offlineReady: true, needRefresh: true, canInstall: false, installed: false, install: async () => null, applyUpdate, dismissRefresh, dismissOfflineReady }}>
          <PwaToasts />
        </PwaContext.Provider>
      </PrefsProvider>
    );
    expect(screen.getByText('WellLog Pro is ready to work offline.')).toBeInTheDocument();
    expect(screen.getByText('A new version is available.')).toBeInTheDocument();
    expect(applyUpdate).not.toHaveBeenCalled(); // nothing is applied automatically
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(dismissRefresh).toHaveBeenCalled(); expect(applyUpdate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Update now' }));
    expect(applyUpdate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(dismissOfflineReady).toHaveBeenCalled();
  });
});

beforeEach(() => { localStorage.clear(); });
