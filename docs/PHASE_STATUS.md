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

## Phase 6 — Scientific interpretation engine ✅
Done (`src/engine/`, pure JS, no UI imports):
- Temperature: Arps correction (°C/°F), conductivity normalisation (alpha must be supplied; no hidden default), temperature profile (constant / gradient / measured curve).
- Rt: apparent resistivity is never silently used as Rt. Routes: none (no Rt), direct (only when thick bed + negligible invasion + negligible borehole effect are all asserted → status "estimated"), geometric factor (Rt = (Ra − J·Rxo)/(1 − J)), chart factor (K and its cited source required).
- Rw: known value (source note required, Arps to depth temperature), SP method (K = 65 + 0.24·T, Rmfe rule with chart-needed refusal, Bateman–Konen fit), minimum Rwa in a user-chosen clean wet zone.
- Petrophysics: GR index, Vshale (linear, Larionov ×2, Clavier, Steiber, SP), density / Wyllie / Raymer-Hunt-Gardner / neutron / neutron–density porosity (gas crossover flag), effective porosity, formation factor, resistivity index; Sw by Archie (blocked in clay-rich zones: Vsh must exist and be ≤ the user's clean limit), Simandoux (n=2) and Indonesia. Round-trip tests confirm each shaly solution satisfies its own equation.
- Every method is documented bilingually (equation, source, assumptions, uncertainty, validity) in `methodsInfo.js`, shown in the UI and stored with each run for the report.
- Orchestrator: runs over the depth grid of a chosen curve (interpolation never bridges data gaps); a quantity with a missing input is left empty and the exact reason is reported with counts ("what could be calculated").
- UI: Interpretation page with all parameter sections (nothing pre-filled; presets only fill when pressed; "suggest GR baselines" is an explicit action), live results, profiles, summary, method table, per-depth table with flags, save/delete runs (inputs stored with outputs), config autosaved per well.
- Tests: 135 passing (37 engine tests with hand-computed values + UI tests). Build OK. Visual check in the browser with a synthetic well.

Fixed during testing: i18n option-group keys collided with label keys (form crash); missing Rt curve now reports "no resistivity curve selected".

Known limits / verify before relying on results:
- Tool-specific environmental/borehole correction charts are not built in: you supply J or K from your chart (with source). 
- The SP → Rw fit (Bateman–Konen) and K = 65 + 0.24 T are published empirical relations; confirm the constants against the chartbook your organisation uses. Cases below Rwe(75 °F) = 0.12 Ω·m need a chart and are refused.
- Water quality / TDS conversion is Phase 8; results are stored in `interpretations` and feed the results tables in Phase 7.
- Desktop view: `start-app.bat` builds the app and opens it at http://localhost:4173 (Electron installer is Phase 11).

## Phase 7 — Excel-like results table and formation analysis ✅
Done:
- Results Tables: spreadsheet-like grid (`src/features/results`) with the 20 requested columns (+ Vshale and aquifer class available): inline editing (double-click, Enter/F2, or just type), Tab/Enter commit, arrows and Shift+arrows (range), Delete to clear, Ctrl+C / Ctrl+V as tab-separated text (works with Excel), column sort, per-column filters (text, `>10`, `<=5`, `2..8`), row selection, bulk edit of lithology/status/class/confidence/interpretation/notes/name, add interval, delete selected, automatic numbering and thickness, validation on every cell (invalid input stays in the editor with the reason and nothing is saved; overlaps and order rejected).
- Unit conversion: depth (m/ft/cm), resistivity (Ω·m/Ω·cm/Ω·ft), GR, porosity & Sw (v/v or %), EC (mS/m, µS/cm, mS/cm, S/m), TDS (mg/L, g/L). Stored canonical; display and typing use the chosen unit.
- Customisable columns: show/hide any column; columns without data in the well are marked "no data"; the curve feeding GR / shallow Rd / deep Rd / EC can be chosen.
- Derived values from the logs (arithmetic mean; resistivities by geometric mean; half-open interval) and from a chosen saved interpretation run. Each cell is classified measured / corrected / calculated / estimated / manual and carries a trace (curve or run, statistic, sample count, interval, methods and equations). Direct Rt is "estimated", never "corrected". EC from the borehole-fluid log is flagged as not formation water.
- Typing in a calculated column stores a manual value (marked ✎) with an editable source note and status; it can be cleared.
- Automatic recalculation: results follow edits to intervals, logs and the selected run immediately.
- Save/restore: autosave per edit, named snapshots of the whole table with restore, view settings (columns, units, sort, filters, run) saved per well.
- Export: Excel (Results, Status, Traceability, Info sheets) and CSV, in the display units shown in the headers.
- Formation Analysis: summary cards (TD, intervals, water-bearing count and thickness), profiles with formation bands (click to select), per-interval statistics with n/min/max, interval comparison, data-quality warnings (gaps, below TD, thin intervals, no log coverage, water-bearing but clayey, Archie refused, Sw clipped, direct-Rt estimate), and screening of potential water-bearing zones using cut-offs you enter (none by default; max 'probable', never 'yes'; confidence = completeness of evidence; applies only to intervals still 'unknown').
- Tests: 161 passing (pure engine incl. float/units/filters/screening/quality/export, DB helpers, grid UI, formation page). Build OK.

Bugs found and fixed during verification: key presses in filter boxes started cell edits; clicking inside the cell editor stole focus; fast typing after the first key lost characters (editor focused too late).

Known limits:
- Interval statistics use sample means; no thickness-weighted or median option yet.
- Phase 8 will fill TDS/EC-based water-quality values; until then TDS is a manual (lab) entry.
- The grid is not virtualised (fine for hundreds of intervals).
- Browser check used scripted events for some interactions (the automation tool sends text without key events).

## Phase 8 — Water quality and TDS ✅
Done (`src/engine/water/`, `src/db/water.js`, `src/features/water/`):
- DB v3 (additive): `waterSamples` (direct measurements: laboratory TDS, EC or Rw with temperature, depth, date, source). Export format 3; older files still import.
- Engine: EC ↔ Rw, temperature normalisation to 25 °C (Arps, or linear α that the user must choose), local calibration of EC25 → TDS by least squares (proportional k, linear a+b·EC, power c·EC^d) with n, RMSE, relative RMSE, R² and valid EC range, or a cited manual factor (source mandatory), prediction with an "outside calibration range" flag, NaCl-equivalent salinity from Rw (empirical chart fit, labelled as an equivalent, not TDS), salinity classes (Winslow & Kister 1956, informational).
- **No Rt → TDS path exists**: only Rw (water resistivity from the interpretation run) or measured water EC enter the functions. Direct (sample) and indirect (geophysical) results are separate (`basis`) and compared side by side with the % difference.
- Uncertainty: calibration scatter and the user-supplied Rw uncertainty are combined in quadrature; if either part is unknown the combined value is reported as "not quantified" (never invented).
- Every result shows equation, inputs with units, temperature reference (25 °C), calibration source/range, assumptions, validity and uncertainty, bilingual (`waterInfo.js`).
- UI (Water Quality): Samples (validated, unit conversion), Calibration (normalisation, local/manual relation, scatter chart, statistics), Estimate by interval (Rw and temperature from a saved run, estimate, direct sample, optional borehole-fluid EC only under an explicit "represents formation water" confirmation), Converter (single value with full trace). "Apply" writes TDS with its basis, status (estimated/measured), method, EC25, uncertainty, calibration and flags to the interval; the Results Tables TDS column shows it with its trace. A manual value typed in the table still overrides it.
- Tests: 188 passing (31 water/engine/UI tests with hand-computed values). Build OK. Visual check in the browser.

Known limits / verify:
- The NaCl-equivalent formula and the salinity-class limits are published empirical relations; confirm against the references your organisation uses. The EC→TDS relation always needs your own samples or a cited factor.
- A few percent of EC variation is not modelled by the single-α/Arps normalisation; mixed-ion waters can deviate.
- (Fixed in Phase 9) An intermittent inline-edit failure in the results grid was a real race: Enter followed by the input losing focus committed twice. The editor now ignores re-entrant commits and focus moves inside the grid.

## Phase 9 — Reports (PDF, Excel, CSV) ✅
Done (`src/reports/`, `src/features/reports/`, `src/db/reports.js`):
- Report model (pure): the 18 required sections in order (cover, project, well, equipment, input summary, original images, digitized curves, depth/formation analysis, resistivity, Rw, water quality and TDS, aquifer zones, interpretation tables, equations, assumptions, data quality and uncertainty, conclusions, recommendations). Built from the database by `gatherReportData`; sections can be switched off; numbering stays canonical.
- Language: the report is generated in Arabic (RTL) or English (LTR) independently of the interface language.
- Classes: every value carries M measured / C corrected / K calculated / E estimated / U manual, with a legend; direct sample results and indirect estimates are in separate tables.
- No invented content: missing run/samples/images/calibration produce explicit notices; conclusions contain only facts counted from the data plus the author's own text (shown separately and verbatim); recommendations = the author's text + clearly labelled automatic suggestions.
- Equations section lists every method used (equation, source, validity); assumptions section lists exactly the parameters the interpreter entered (none assumed by the program); uncertainty is quantified only where its parts are known.
- Figures: log display with formations/markers, original image thumbnails, EC25–TDS calibration scatter.
- Export: PDF in two ways — (1) Print / Save as PDF (vector text, selectable; Arabic shaped by the browser), (2) one-click PDF file (page images of the same document via html2canvas + jsPDF, offline, works on Android too). Excel workbook (Results in display units, Status, Traceability, Curves merged by depth, one sheet per report section), results CSV, curves CSV. Report definitions (options and your texts) and, optionally, the generated PDF are stored in the project (`reports` table) and can be reopened.
- Tests: 203 passing (model, Arabic/English, statuses, exports, page-break planner, PDF assembly, UI). Real-browser check: an Arabic report with figures produced a 9-page PDF (2.6 MB, ~4 s) that pdf.js rendered back with correct RTL layout.

Fixed on the way: the results-grid editor race (re-entrant commit/blur), previously masked with test retries.

Known limits:
- The one-click PDF is image-based (not selectable/searchable); use Print → Save as PDF for vector text. Electron (Phase 11) will add a direct vector PDF export.
- Page footers in the file PDF use Latin text/digits only (well ID and page numbers).
- Original images are included as downscaled thumbnails (≤ 900 px, max 6).

## Phase 10 — PWA and offline support ✅
Done:
- Installable PWA (vite-plugin-pwa / Workbox): web manifest (name, standalone display, relative `start_url`/`scope`, theme colours, 192/512 and maskable icons), generated icons (`npm run icons`, source `public/icons/icon.svg`), Apple touch icon, favicon.
- Service worker precaches the whole app (19 files, ≈3.7 MB: app, CSS, icons, the PDF worker and the lazily loaded PDF/Excel libraries) and falls back to `index.html` for navigation (hash routes). Updates are never forced: a toast offers "Update now / Later". No external URLs anywhere (verified).
- UI: offline badge in the top bar, "Install app" button when the browser offers installation (Android/Chrome), toasts for "ready to work offline" and "update available", Settings → "Offline use and installation" (connection, installed state, storage used/quota, request protection from clean-up, Android instructions). The app asks the browser for persistent storage so IndexedDB is not evicted.
- Verification:
  - `npm run verify:pwa` checks the build (manifest, icons, worker, every asset precached, no external resources); a vitest test runs it when `dist/` exists.
  - `npm run e2e:offline` drives a real Chrome/Edge: installs the service worker, creates data, STOPS the server and goes offline, reloads and confirms the app starts, all 11 sections open, every precached file is available, existing data is intact and new data can be saved. Result: 13/13 checks passed.
  - `npm run e2e:mobile` opens every section at 375 px in English and Arabic (touch emulation) and detects horizontal overflow. It found a real overflow in the viewer's curve rows (fixed); now clean. Chrome also offered "Install app" in that run, confirming installability.
- Tests: 211 passing (offline badge, install prompt, update toast, storage helpers, build verification) plus the two browser scripts.

Known limits:
- The built-in preview pane of this development environment cannot run service workers, so offline behaviour was verified with real Chrome through puppeteer-core instead (not on a physical Android phone).
- Installing on Android needs the app to be served once over HTTPS (or localhost) from any static host; afterwards it works without internet. Clearing the browser's site data deletes the local database: use Settings → Backup regularly.
- On very narrow screens the log viewer shows the first tracks only (resize tracks or pan with two fingers); no automatic track scaling yet.

## Phase 11 — Electron desktop app and Windows installer ✅
Done (`electron/`, `src/desktop/`, `build/`, `docs/BUILD_AND_INSTALL.md`):
- Electron 45 main process (`main.cjs`), sandboxed preload (`preload.cjs`) and testable helpers (`lib.cjs`). Same React app as the web/PWA version, loaded from a private `app://welllog` scheme (served from the asar, no `file://`).
- Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`; strict CSP (no `unsafe-eval`, no inline scripts, no remote origins); navigation, pop-ups and webviews blocked; all permissions denied; single-instance lock; DevTools only in development.
- Local file access through six validated IPC channels (`app:info`, `file:save`, `file:open`, `pdf:print`, `backup:write`, `folder:reveal`); every handler checks the sender's URL; the page cannot choose a write path (native Save dialog or a fixed backups folder); only json/csv/xlsx/pdf/png/txt allowed; file names sanitised (path traversal neutralised); sizes limited.
- App integration: every export (Excel, CSV, JSON, PDF, PNG) uses the native Save dialog in the desktop app; Reports → "Print / Save as PDF" writes a **vector PDF with selectable text** directly; Settings → Desktop application (data/backup folders, "Backup now to Documents", newest 20 kept); toast "Saved: path"; window size/position remembered; local database (IndexedDB) lives in the app profile; no service worker needed.
- Windows installer (electron-builder, NSIS x64): choose install folder, **Desktop shortcut always created**, Start-menu shortcut, custom icon (`build/icon.ico`, multi-size), multi-language installer, data kept on uninstall. Built: `release/WellLog-Pro-Setup-0.1.0.exe` (122.7 MB, SHA-256 4CB813BF77D0CB595CE31A6B553352CD99665C1D9370FE93C6B91039E1A1F23F); app code in the asar is only 3.9 MB.
- Tests: 224 unit/UI tests (13 new for the Electron helpers and configuration) and `npm run e2e:electron`: 24/24 checks in a real Electron window, both from source and from the **packaged** `WellLog Pro.exe`: no Node in the page, frozen allow-listed API, CSP enforced, window.open/navigation blocked, IPC rejects .exe and bad folders, local data survives reload, all 11 sections, Excel / image PDF / vector PDF saved, backup valid, zero network requests, second launch hands over to the first.

Known limits:
- The installer was built and its packaged app tested, but the installer itself was **not run** on this machine (it would create real shortcuts/registry entries). Please run it once to confirm the shortcut and the install flow.
- Not code-signed: Windows SmartScreen may warn about an unknown publisher until you sign it with your certificate.
- Windows x64 only; no auto-update (intentional: the app is offline-first).
- The installer is 122 MB because it contains the Electron runtime.

## Phase 12 — QA, scientific validation and release ✅ (v1.0.0)
Done:
- Scientific validation suite `tests/validation.test.js` (41 tests: Archie/Simandoux/Indonesia vs an independent solver, unit invariance, CSV round-trip fuzz). Real finding: Simandoux assumes n = 2 → result note `simandoux_n_ignored`.
- ESLint flat config (clean); results-grid edit race fixed (double commit on Enter+blur); dashboard well overview; Alt+digit navigation and shortcuts table.
- Accessibility: `npm run e2e:a11y` (axe, 11 sections × EN/AR × light/dark): **0 serious/critical**. Fixed contrast (dark-theme selects, report cover), focusable scroll regions, labels. Remaining: 1 moderate (heading order), 1 minor (empty action-column header).
- `npm run e2e:smoke`: clicks every visible button on all sections in EN and AR (destructive ones skipped): no errors.
- Docs: `VALIDATION.md` (what is and is not externally verified), `COMPLIANCE.md` (spec vs implementation, honest gaps), `TEST_CASES.md`, `USER_GUIDE.md` (AR/EN), `README.md`, `CHANGELOG.md`; synthetic samples in `samples/` (`scripts/make-samples.mjs`).
- Version 1.0.0; installer rebuilt: `release/WellLog-Pro-Setup-1.0.0.exe` (122.7 MB, SHA-256 6BC476C9DD689224B47490F797D85D10ECC06896AC21977E906C0B4D0D03349A). Final run: 265/265 tests, ESLint 0 errors, verify:pwa OK, e2e:offline 13/13, e2e:mobile clean, e2e:electron 24/24 (source and packaged exe), e2e:a11y 0 serious/critical, e2e:smoke clean.

Remaining / known limits:
- Empirical constants (SP/Bateman–Konen, Arps, Winslow–Kister, NaCl fit, Vsh/porosity defaults) need review by a qualified petrophysicist/hydrogeologist.
- Not tested on a physical Android phone; installer not run on this machine; not code-signed; Windows x64 only.

## Commands
- `npm run dev` — dev server; `npm test` — tests; `npm run build` — production build
