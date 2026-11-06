import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { usePrefs } from './PrefsContext.jsx';
import { NAV_ITEMS } from './navigation.js';
import Icon from '../design/Icon.jsx';
import PrefsControls from './PrefsControls.jsx';
import { ConnectionBadge, PwaToasts } from '../pwa/PwaUi.jsx';
import { DesktopToasts } from '../desktop/DesktopUi.jsx';

export default function Shell() {
  const { t, sidebarCollapsed, toggleSidebar } = usePrefs();
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => setMobileOpen(false), [loc.pathname]);

  // Keyboard shortcuts: Ctrl/Cmd+B toggles sidebar; Alt+1..9 jumps to a section.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);

  const cls = ['shell', sidebarCollapsed ? 'is-collapsed' : '', mobileOpen ? 'is-mobile-open' : '']
    .filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <aside className="sidebar" aria-label={t('nav.menu')}>
        <div className="brand">
          <span className="brand-mark">WL</span>
          <span className="brand-text">{t('app.name')}</span>
        </div>
        <nav>
          <ul>
            {NAV_ITEMS.map((n) => (
              <li key={n.id}>
                <NavLink to={n.path} end={n.path === '/'} title={t(`nav.${n.id}`)}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                  <Icon name={n.icon} />
                  <span className="nav-label">{t(`nav.${n.id}`)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <button type="button" className="collapse-btn" onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? t('nav.expand') : t('nav.collapse')}
          title="Ctrl+B">
          <Icon name="chevron" />
          <span className="nav-label">{sidebarCollapsed ? t('nav.expand') : t('nav.collapse')}</span>
        </button>
      </aside>
      {mobileOpen && <div className="scrim" onClick={() => setMobileOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setMobileOpen(true)}
            aria-label={t('nav.menu')}>
            <Icon name="menu" />
          </button>
          <div className="topbar-title">{t('app.tagline')}</div>
          <ConnectionBadge />
          <PrefsControls />
        </header>
        <main className="content"><Outlet /></main>
      </div>
      <PwaToasts />
      <DesktopToasts />
      <nav className="bottom-nav" aria-label={t('nav.menu')}>
        {NAV_ITEMS.filter((n) => ['dashboard', 'wells', 'import', 'viewer', 'reports'].includes(n.id)).map((n) => (
          <NavLink key={n.id} to={n.path} end={n.path === '/'}
            className={({ isActive }) => `bn-link${isActive ? ' active' : ''}`}>
            <Icon name={n.icon} size={22} />
            <span>{t(`nav.${n.id}`)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
