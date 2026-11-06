# Phase status

## Phase 1 — Scaffold, design system, navigation, dashboard ✅
Done:
- Vite + React 19 (JavaScript), HashRouter, relative `base` (Electron/PWA ready)
- Design tokens (navy/teal/cyan), light/dark/system theme, logical CSS properties for RTL
- Arabic/English dictionaries (key parity enforced by a test), `dir`/`lang` switching, persisted prefs
- 11-section navigation: collapsible sidebar (Ctrl+B), mobile drawer + bottom nav
- Dashboard with real (currently zero) counts — no fake data; Settings page (language, theme)
- Tests: 7 passing (i18n parity, navigation, RTL, theme, sidebar, empty dashboard). Build OK.

Not done / by design:
- Modules other than Dashboard and Settings show an honest "planned for phase N" page until their phase.
- Dashboard counts come from `src/db/stats.js` (returns zeros until Dexie in Phase 2).
- Preferences use localStorage for now; move to Dexie in Phase 2.
- Offline/PWA verification: Phase 10.

## Phase 2 — Wells, projects, IndexedDB ✅
Done:
- Dexie schema v1 (`src/db/db.js`): projects, wells, logMeasurements, logImages, digitizedCurves, formations, interpretations, calcSettings, reports, preferences. Rule: never edit a released version; add `version(n+1)` + upgrade.
- Repositories (`src/db/repos.js`): project/well create, update, archive, delete (cascade), duplicate (with all data), project/well JSON export, project JSON import (always a NEW project, remaps ids, avoids Well ID clashes), full backup/restore (validated before replacing, atomic). Blobs (images/PDF) are encoded as data URLs in JSON.
- UI: Projects page, Wells page (all 15 required fields, validation, search, filters by project/type/country/status, CSV export of the filtered list, per-well JSON), Settings → backup/restore. Dashboard now reads real counts and data-quality warnings from the DB.
- Tests: 25 passing (validation, cascade delete, duplicate, JSON round-trip, backup/restore, stats, CSV, UI flows). Build OK. Form verified in the browser.

Known limits:
- fake-indexeddb in jsdom cannot store Blobs, so Blob→JSON is unit-tested directly; real Blob storage must be verified in a browser in Phase 5.
- Preferences (language/theme/sidebar) still use localStorage; the `preferences` table exists but is not used yet.
- Autosave applies to manual data entry (Phase 3); project/well forms save on "Save".
- Archived projects' wells are not auto-archived.

## Commands
- `npm run dev` — dev server; `npm test` — tests; `npm run build` — production build
