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

## Phase 3 — Log registry, manual entry, Excel & CSV import ✅
Done:
- Log registry (`src/registry/logRegistry.js`): 32 numeric logs + Image Logs (non-numeric, Phase 5) in 5 categories; each has name/abbr/description (en+ar), unit group, scale type, plausible range, interpretation roles, limitations (apparent resistivity ≠ Rt, etc.), header aliases. User-defined custom curves (stored in `preferences`).
- Unit engine (`src/engine/units/units.js`): depth, resistivity, conductivity, SP, density, porosity, sonic, caliper/diameter, temperature. Everything is stored in canonical units (depth always m); the entered unit is kept for traceability.
- Importers: quote-aware CSV with delimiter auto-detection (`, ; tab |`), decimal comma/point, XLSX/XLS via SheetJS 0.20.3 (sheet selection), header-row detection, column auto-mapping, null markers (-999.25 etc., editable).
- Validation before save: depth invalid/negative/duplicate/unsorted/beyond total depth, non-numeric values, log-scale ≤ 0, out-of-range values; row numbers shown; invalid points excluded; **units are never assumed** (a column without a unit blocks the import until the user picks one).
- Each saved curve keeps source (manual/excel/csv), file name, sheet, delimiter, header, entered unit and the source row of every point.
- Manual entry grid: multiple curves, per-column unit, depth unit, cell validation, Excel paste, debounced autosave (only valid cells are saved).
- Samples in `samples/` (synthetic, labelled; not real data). Tests: 57 passing. Build OK.

Known limits:
- Manual grid edits only curves whose source is `manual`; imported curves are locked there (edit tools come with the viewer/results grid).
- Spectral channels K/U/Th share one unit per tool; NMR T2 distributions are not imported.
- Excel upload is covered by engine tests, not by a UI test (jsdom `File.arrayBuffer`).
- Bundle is >500 kB because of SheetJS (acceptable offline; may be code-split later).
- Stop stale `vite` dev servers (ports 5173–5175) before starting a new one; after installing a dependency the old server serves a broken page.

## Commands
- `npm run dev` — dev server; `npm test` — tests; `npm run build` — production build
