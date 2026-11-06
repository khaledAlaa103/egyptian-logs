# WellLog Pro — Development Plan & Architecture

## 0. Inspection result
- Project folder `D:\برنامج اللوج المصري` is **empty** (no package.json, no files). Nothing to preserve; this is a greenfield build.
- Node v26.13.0, npm 11.20.0 available.

## 1. Stack (all bundled locally, offline)
| Concern | Choice |
|---|---|
| UI | React 18 + Vite (JavaScript only) |
| Routing | react-router-dom (HashRouter — works in Electron `file://` and PWA) |
| DB | Dexie.js (IndexedDB), versioned migrations |
| i18n | Lightweight own i18n (ar/en dictionaries, `dir` switching) |
| Charts / log tracks | Canvas-based custom multi-track renderer (+ SVG for print) |
| Excel/CSV | SheetJS `xlsx` (bundled), PapaParse (CSV, delimiter autodetect) |
| PDF input | pdfjs-dist (bundled worker) |
| PDF output | jsPDF + jspdf-autotable (Arabic font embedded locally) |
| Image CV | Own canvas-based color/threshold curve tracer (no network) |
| PWA | vite-plugin-pwa (Workbox, precache all assets) |
| Desktop | Electron + electron-builder (NSIS installer, desktop shortcut, icon) |
| Tests | Vitest + React Testing Library + fake-indexeddb |

## 2. Architecture
```
src/
  app/            App shell, routes, providers (theme, i18n, db)
  design/         tokens.css, themes, base components (Button, Table, Modal…)
  i18n/           ar.js, en.js, useI18n
  db/             dexie schema, migrations, repositories, backup/restore
  registry/       logRegistry.js (log types: name, abbr, unit, scale, rules, formulas)
  engine/         PURE JS science — no React imports
    resistivity/  temperature correction, Rw methods, corrections (require tool info)
    petrophysics/ GR index, Vshale, porosity, Archie (guarded), formation factor
    water/        EC<->TDS (configurable calibrations), Rw/SP
    units/        conversions
    validation/   range/consistency checks
    trace.js      every result carries {equation, inputs, units, Tref, source, validity, assumptions, uncertainty, status: measured|corrected|calculated|estimated}
  io/             excelImport, csvImport, exporters (xlsx/csv/json)
  digitize/       calibration (linear/log axes), curve extraction, provenance (pixel + calibration id per point)
  features/       dashboard, projects, wells, import, viewer, interpretation,
                  formations, waterQuality, results, reports, settings
  reports/        PDF builder, one module per report section (18 sections)
electron/         main.js, preload.js (contextIsolation on, nodeIntegration off, IPC allow-list)
tests/            unit / integration / ui + sample datasets in tests/data
docs/             plan, scientific-methods, test-cases
```
Rules: engine has zero UI imports; each feature is split into small components; every scientific output is a `TracedResult`; unavailable inputs yield `status:"insufficient-inputs"` — never silent defaults.

## 3. Scientific guardrails
- Apparent ≠ true resistivity: Rt requires tool type, borehole diameter, mud Rm, invasion info, correction chart/method chosen by the user.
- No universal Rt→TDS. TDS comes only from (a) direct water sample EC/TDS, or (b) Rw derived by a chosen method + user/local calibration (EC→TDS factor, temperature reference 25 °C). Direct vs indirect clearly labelled.
- Archie only with m, n, a supplied/selected; warning flag on high Vsh (clay-rich) → suggest Simandoux/Indonesia alternatives (modular).
- Digitized points store `{px,py,calibrationId,trackId,value}`; calibration required before values are produced.

## 4. Phases (each ends: run app → run tests → fix → docs → report)
1. Scaffold, design system (navy/teal/cyan, light/dark), i18n AR/EN + RTL, shell nav (11 sections), dashboard
2. Wells/projects CRUD + Dexie schema/migrations, autosave, backup/restore, JSON import/export
3. Log registry, manual entry, Excel & CSV import wizards (mapping, preview, validation)
4. Multi-track log viewer (zoom/pan, log scales, formations, markers, print)
5. Image/PDF import, crop/rotate, calibration, manual + auto digitization
6. Scientific engine + unit tests
7. Formation analysis + Excel-like results grid
8. Water quality / TDS module
9. PDF (18 sections) / XLSX / CSV reports
10. PWA & offline verification
11. Electron + Windows NSIS installer, shortcut, icon
12. Full QA, scientific validation, release

## 5. Notes / open decisions
- Build of the Windows installer needs electron-builder download of Electron binaries (internet needed once at build time only; the installed app is fully offline).
- Android: PWA install from Chrome; must be served over HTTPS or localhost once to install (can be hosted on any static host, e.g. GitHub Pages), then works offline.
- Arabic PDF requires embedding a local Arabic font (Noto Naskh/Amiri) — will be bundled.
