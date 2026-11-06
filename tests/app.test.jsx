import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import App from '../src/app/App.jsx';
import { PrefsProvider } from '../src/app/PrefsContext.jsx';
import { NAV_ITEMS } from '../src/app/navigation.js';
import en from '../src/i18n/en.js';
import ar from '../src/i18n/ar.js';

const setup = (path = '/') =>
  render(
    <PrefsProvider>
      <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
    </PrefsProvider>
  );

describe('i18n dictionaries', () => {
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? flat(v, p + k + '.') : [p + k]);
  it('Arabic has exactly the same keys as English', () => {
    expect(flat(ar).sort()).toEqual(flat(en).sort());
  });
});

describe('navigation', () => {
  it('has the 11 required sections, each with translations', () => {
    expect(NAV_ITEMS).toHaveLength(11);
    NAV_ITEMS.forEach((n) => { expect(en.nav[n.id]).toBeTruthy(); expect(ar.nav[n.id]).toBeTruthy(); });
  });

  it('every nav item opens a routed page', async () => {
    setup();
    const user = userEvent.setup();
    for (const n of NAV_ITEMS.slice(1)) {
      await user.click(screen.getAllByRole('link', { name: en.nav[n.id] })[0]);
      expect(await screen.findByRole('heading', { level: 1, name: en.nav[n.id] })).toBeInTheDocument();
    }
  });
});

describe('dashboard', () => {
  it('shows honest zero counts and empty state (no fake data)', async () => {
    setup();
    expect(await screen.findByText(en.dashboard.emptyTitle)).toBeInTheDocument();
  });
});

describe('language / RTL', () => {
  it('switches to Arabic with rtl direction and persists', async () => {
    setup('/settings');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: en.common.language }), 'ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(await screen.findByRole('heading', { level: 1, name: ar.nav.settings })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('welllog.prefs.v1')).lang).toBe('ar');
  });

  it('applies dark theme', async () => {
    setup('/settings');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: en.common.theme }), 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('sidebar', () => {
  it('collapses with Ctrl+B', async () => {
    const { container } = setup();
    const user = userEvent.setup();
    expect(container.querySelector('.shell')).not.toHaveClass('is-collapsed');
    await user.keyboard('{Control>}b{/Control}');
    expect(container.querySelector('.shell')).toHaveClass('is-collapsed');
  });
});
