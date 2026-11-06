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

## Phase 4 — Log viewer and multi-track charts ✅
Done:
- DB v2 (additive migration, tested against a real v1 database): `markers` table. Export format version 2 (v1 files still import).
- Pure viewer modules (`src/viewer/`): scale math (linear, log, reversed), nice depth ticks, log decades, gap-aware interpolation (data gaps are never bridged), pixel-row decimation, zoom/pan clamping, track geometry, default layout built only from curves that exist, and a canvas renderer (`renderLog`) shared by screen, PNG export and print.
- Viewer page: synchronized tracks sharing one depth axis, resizable tracks (drag a header edge), independent per-curve min/max/scale (linear/log), overlays, colour and visibility controls, track add/remove/reorder, depth unit m/ft (display only), wheel/pinch zoom, drag pan, click to select a depth with values read at the cursor for all curves, keyboard (arrows, +/-, Home), from/to depth inputs, layouts saved per well.
- Formation intervals (manual, with water-bearing status: unknown/yes/probable/no) drawn as boundaries and highlighted bands across all tracks; depth markers with labels; PNG export and print layout.
- Tests: 75 passing (geometry, renderer via recording context, defaults, intervals, migration, viewer UI). Build OK. Checked in a real browser with a synthetic seeded well (render, click-select, wheel zoom).

Known limits:
- Water-bearing status is entered by the user; it is not calculated until Phases 6–8.
- Canvas drawing is verified by a recording context in tests and visually in the browser, not by pixel comparison.
- PNG export/print were not exercised in a real browser session.
- Spectral/NMR curves use automatic display ranges; the neutron/sonic default scales are reversed by convention.
- Dev servers: after editing the schema, an old `vite` instance serves stale modules; start a fresh one.

## Phase 5 — Image/PDF import, calibration, digitisation ✅
Done:
- Upload JPG/PNG/PDF (type, size, empty-file checks). The ORIGINAL file is stored unchanged (`logImages`); PDF pages are rendered with pdf.js bundled locally (worker included, works offline) and a page can be re-selected.
- Crop and rotate (90° steps + fine rotation, crop rectangle). Every point maps back to the original image pixel (`workingToOriginal`, round-trip tested). Changing rotation/crop clears calibration after confirmation.
- Depth calibration: ≥2 reference lines with typed depths (m or ft), least-squares fit for more points, resolution (m/px) and residual shown, warnings for decreasing depth/large residual, refusal when unusable. "Detect gridlines" finds line positions (no OCR: depth values are always typed) and new points snap to them.
- Horizontal calibration per track: own quantity/unit, linear or logarithmic scale, ≥2 reference values, reversed scales supported, per-track status and resolution.
- Digitisation: manual point add/drag/delete (Delete key), pan/zoom (wheel, pinch), per-curve colour; optional automatic extraction by colour tracing with tolerance, search region and row step. Gaps are never interpolated; unreliable results (low coverage, many jumps, ambiguity) are flagged with advice to digitise manually. Auto points that are edited become "auto (edited)".
- Review & export: depth/value preview, quality (resolution, residual), issues (out of range, duplicates, extrapolation). Optional regular resampling (recorded in metadata). Export writes `digitizedCurves` (each point: working px, original px, depth, value, method, flags + calibration snapshot) and pushes the curve to the workspace as source `image` with provenance. Sessions autosave and reopen.
- Tests: 95 passing (calibration, transform round-trip, extraction on synthetic images, gridline detection, pipeline with unit conversion/log scale, storage/export, UI entry). Build OK.
- Real-browser end-to-end check with a synthetic image whose true curve is known (GR 75 + 50 sin(depth/10)): upload → gridline snap → calibration → colour pick → auto extraction → export: max error 0.24 gAPI (pixel resolution 0.5 gAPI/px); session reopened after reload. A hand-built PDF rendered to a 1080×1350 PNG.

Fixed during verification: 0.5 px bias between detected and clicked positions (now continuous coordinates), coverage penalised empty margins, step-tab CSS class collision, radio inputs styled as text boxes.

Known limits:
- No OCR: depth/value labels must be typed. Auto extraction is colour-based and needs a distinct curve colour; black curves overlapping black gridlines will be unreliable (use manual digitisation).
- Vertical depth scale is assumed linear (typical for logs); skew is corrected by rotation, not by perspective warp.
- Pointer-event simulation was used for the browser check (not a human mouse session); pdf.js paint needs animation frames, so rendering pauses while the window is hidden.
- Stale `vite` dev servers keep older ports (5173–5177); start a fresh one after installing dependencies.

## Commands
- `npm run dev` — dev server; `npm test` — tests; `npm run build` — production build
