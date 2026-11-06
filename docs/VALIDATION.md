# Scientific validation — WELLLOG PRO 1.0

This document states **what has been verified, how, and what has not**. Verification here means
internal consistency and mathematical correctness against independent solvers and invariants. It is
**not** a substitute for review by a qualified petrophysicist / hydrogeologist against field data.

## 1. Verified automatically (`tests/validation.test.js`, `tests/engine.test.js`, `tests/water.test.js`)

| Area | Check |
|---|---|
| Archie | Closed-form Sw compared with an independent bisection solver over a grid of (Rw, Rt, φ, a, m, n) |
| Simandoux / Indonesia | Residual of the model equation at the returned Sw ≈ 0; Simandoux reduces to Archie when Vsh = 0 and n = 2. Finding: the Simandoux form implemented assumes n = 2 — a note (`simandoux_n_ignored`) is attached to the result when the user sets n ≠ 2 |
| Unit invariance | Same physical data entered in m/ft, °C/°F, S/m / mS/cm / µS/cm gives the same canonical results (Arps °C/°F within 0.5 %) |
| Rt | Apparent resistivity is never silently used as Rt: route `none` yields no Rt; every Rt carries its route and inputs |
| Vsh / porosity | Monotonic, bounded to [0, 1]; out-of-range inputs flagged, not clipped silently |
| Statistics | Arithmetic/geometric means, half-open depth intervals, null handling |
| CSV | Writer → parser round-trip fuzz (quotes, delimiters, newlines, unicode) |
| Water | EC→TDS only with a user calibration (factor / linear / power) or a cited manual factor; no universal conversion exists in the code |
| Persistence | Backup export → import restores identical data (schema v3) |

## 2. Verified in real browsers / Electron (scripts)

`verify:pwa`, `e2e:offline` (13/13), `e2e:mobile`, `e2e:electron` (24/24, source and packaged exe),
`e2e:a11y` (0 serious/critical), `e2e:smoke` (every visible button, EN + AR, no errors).

## 3. NOT verified against external references — needs expert review

These use published empirical constants/forms implemented from the literature. They are tested for
internal consistency only; **confirm against your company standards before using results for
decisions**:

1. **SP → Rw** (Bateman–Konen, K = 65 + 0.24·T) and the Rmf/Rw temperature handling.
2. **Arps temperature correction** constants (°C and °F forms).
3. **Winslow & Kister salinity class boundaries** and the **NaCl-equivalent** conversion fit.
4. **Vsh models** (linear, Larionov Tertiary/older, Clavier, Steiber) and **porosity models**
   (density, sonic Wyllie/Raymer–Hunt–Gardner, neutron-density) parameter defaults — user supplies
   matrix/fluid values; the tool does not invent them.
5. **Simandoux (n = 2)** and **Indonesia** equation variants — several published variants exist.
6. Any result computed from **digitised images**: accuracy is bounded by the calibration quality
   reported in the digitiser (residual in px, resolution per px).

## 4. Design guarantees (by construction)

- Measured / corrected / calculated / estimated / unavailable are distinct statuses (M/C/K/E/U) in the
  results table and reports.
- No default parameter silently fills a missing input; missing inputs produce "unavailable" with the
  reason.
- Uncertainty is reported only when its input parts are known.
