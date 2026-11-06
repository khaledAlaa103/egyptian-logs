# Compliance with the master specification (honest status)

✅ implemented and tested · ⚠️ partial · ❌ not done

| Requirement | Status | Notes |
|---|---|---|
| React + Vite, JavaScript only | ✅ | |
| Arabic RTL + English LTR everywhere, incl. reports | ✅ | Arabic PDF verified by rendering |
| Offline-first, IndexedDB (Dexie) | ✅ | Real-Chrome offline test 13/13 |
| Installable Android PWA | ✅ | Verified in desktop Chrome with mobile emulation; **not on a physical phone** |
| Electron Windows installer, shortcut, icon, secure IPC | ✅ | Packaged exe tested 24/24; **installer itself not run on this machine** |
| Manual / CSV / Excel input | ✅ | Validation, units, null handling |
| Image/PDF input, calibration, digitisation | ✅ | Accuracy depends on calibration (shown) |
| Modular log registry + custom curves | ✅ | |
| Projects / wells / formations / markers | ✅ | |
| Multi-track viewer (zoom, pan, cursor, export PNG) | ✅ | Narrow screens show first tracks only |
| Interpretation engine (Rt, Rw, Vsh, φ, Sw) | ✅ | Constants need expert review (VALIDATION.md §3) |
| No apparent-resistivity = Rt shortcut; no universal Rt→TDS | ✅ | Enforced and tested |
| Excel-like results table, overrides, snapshots, screening | ✅ | |
| Water quality / TDS / classes | ✅ | User-calibrated only |
| Reports PDF / XLSX / CSV, status M/C/K/E/U | ✅ | |
| Dashboard, keyboard shortcuts | ✅ | Alt+digit navigation, help table in Settings |
| Accessibility | ⚠️ | 0 serious/critical (axe); 2 minor/moderate left (heading order, empty table header on action column) |
| Comprehensive tests | ✅ | 21 test files + 5 browser/Electron scripts |
| Code signing, auto-update | ❌ | Intentional / needs user certificate |
| macOS / Linux builds | ❌ | Windows x64 only |
| Independent scientific certification | ❌ | Requires an external expert |
