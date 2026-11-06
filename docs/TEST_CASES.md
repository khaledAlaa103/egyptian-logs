# Test cases and datasets

Run everything: `npm test` (21 files) · browser checks listed in `docs/BUILD_AND_INSTALL.md`.

## Sample datasets (`samples/`, all SYNTHETIC)
| File | Use |
|---|---|
| `synthetic-well.csv` / `.xlsx` | 0–100 m every 0.5 m: GR, RD, RHOB, NPHI, SP; sand 40–70 m. XLSX also has a `Water` sheet |
| `SYNTHETIC_comma_ft_nulls.csv` | Feet, null −999.25, bad cell, negative resistivity |
| `SYNTHETIC_semicolon_decimal_comma.csv` | `;` delimiter and decimal comma |

## Manual acceptance cases
| # | Steps | Expected |
|---|---|---|
| 1 | Projects → New project; Wells → New well (duplicate well id) | Created; duplicate rejected with message |
| 2 | Import `synthetic-well.csv`, map columns | Preview, units detected, 201 points per curve |
| 3 | Import `SYNTHETIC_comma_ft_nulls.csv` | Feet converted to m, nulls excluded, bad cell and negative resistivity reported |
| 4 | Viewer: zoom wheel, drag pan, click depth, resize track | Cursor shows values at depth; layout saved per well |
| 5 | Interpretation: Archie with Rw from SP, Rt route direct | Table with method, inputs and warnings; no Rt without a route |
| 6 | Results: edit a cell, undo/redo, filter, screening cut-offs | Override marked; export XLSX/CSV matches the grid |
| 7 | Water: add sample with TDS and EC, fit calibration | Factor/linear/power fit shown with R²; class by Winslow & Kister |
| 8 | Reports: all sections, Arabic then English; PDF + XLSX + CSV | RTL/LTR correct; M/C/K/E/U statuses visible |
| 9 | Settings → Backup → restore into a clean profile | Identical data |
| 10 | Offline: install PWA, stop server, reload | App and data work (`npm run e2e:offline`) |
| 11 | Desktop: installer, shortcut, export dialog | Native save dialog; vector PDF |

## Automated suites
app, db, wells-ui, import, import-ui, units-registry, viewer, viewer-ui, digitize, digitize-ui,
engine, interp-ui, results, results-ui, water, water-ui, reports, reports-ui, pwa, electron-lib,
validation.
