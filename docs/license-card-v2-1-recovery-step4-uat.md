# Card v2.1 Recovery - Step 4 Final Recovery Gate + Release Readiness UAT

Date: 2026-03-07  
Scope: Final Step 4 gate on `main` after Recovery Steps 1-3 (`42c45e5`).

## Executive Outcome

- Gate result: **PASS (GO for v0.3.4 release readiness)**.
- Blocking regressions (`P0`/`P1`): **none open**.
- Required recovery dimensions all validated: geometry, image assets, rulers/snap controls, simulation/PDF parity, merge fields, and locked date format behavior.

## Environment and Runtime Notes

- Docker stack healthy (`backend`, `frontend`, `worker`, `beat`, `db`, `redis`).
- Migration state verified current (`No migrations to apply`).
- Runtime gate executed with deterministic script assertions for preview/simulation/PDF/print pipeline behavior.
- Health checks returned `200` for backend and frontend.

## UAT Matrix (Step 4 Recovery)

| ID | Area | Case | Expected | Actual | Status |
|---|---|---|---|---|---|
| G1 | Geometry | LP798/card contract | `3c` card `85.00x55.00`; LP798 margins/gaps exact | Contract values match (`15/10/15`, `10/0`) | PASS |
| G2 | Geometry | Slot precision + bounds | Slot coordinates and layout bounds match LP798 | `slot0 15/10`, `slot1 110/10`, `slot9 110/230`, `within_sheet_bounds=true` | PASS |
| G3 | Geometry | Guide neutrality | Bleed/safe toggles must not alter slot math | Guided and unguided `slots/layout_metadata` identical | PASS |
| A1 | Image assets | PNG explicit asset reliability | Explicit `style.image_asset_id` resolves | PNG element resolved via `style.image_asset_id` | PASS |
| A2 | Image assets | SVG explicit asset reliability | SVG should resolve without profile fallback | SVG element resolved to `data:image/svg+xml;base64,...` via `style.image_asset_id` | PASS |
| A3 | Image assets | Multi-image metadata consistency | All selected assets reflected in metadata | Both uploaded asset IDs present in `render_metadata.image_assets.resolved_ids` | PASS |
| R1 | Rulers | Ruler/snap controls wiring | Designer still exposes ruler and snap toggles | `showRulers`, `rulerMarksX/Y`, `snapToGrid`, `snapToElements` controls confirmed in designer source | PASS |
| M1 | Merge fields | Role/date context resolution | `primary/secondary` roles + dates formatted correctly | `athlete/coach` + `09 Nov 2016`, `09 Jan 2016`, `09 Nov 2016` | PASS |
| M2 | Merge fields | Resolved text output | Text elements include merged/locked format values | Runtime resolved text contains expected role/date values | PASS |
| S1 | Simulation | HTML render correctness | Simulation contains expected text/layout/font sizing | `font-size:4.37mm` and expected merged text present | PASS |
| S2 | Simulation/PDF parity | Payload parity | Simulation payload must match card document parts | `build_card_simulation_payload` equals `_build_card_document_parts(..., include_page_size=False)` | PASS |
| S3 | Simulation/PDF parity | Body parity | Simulation HTML must equal rendered PDF body fragment | `_render_card_document_html` body fragment equals simulation HTML | PASS |
| S4 | Simulation/PDF parity | PDF generation | Card PDF bytes must render successfully | `render_card_pdf_bytes(...)` starts with `%PDF` | PASS |
| P1 | Print pipeline | Execute lifecycle | Draft print job executes and artifacts persist | Runtime job succeeded with artifact and `execution_attempts=1` | PASS |
| P2 | Print pipeline | Duplicate execute guard | Re-execution should not increment attempts | Repeat execute leaves attempts stable | PASS |
| P3 | Stability | Queue steady state | No stale queued/running jobs after execution | queued/running count `0` | PASS |
| C1 | Automated | Backend license-card suite | Full backend regression should pass | `84/84` passed (`licenses.test_cards`) | PASS |
| C2 | Automated | Django checks | No system-check issues | `python manage.py check` passed | PASS |
| C3 | Automated | Frontend lint | No lint errors | `0 errors`, `9 warnings` | PASS |
| C4 | Automated | Frontend build | Production build should succeed | `next build` passed | PASS |
| C5 | Automated | Frontend card unit test | Card gradient helper regression should pass | `4/4` passed | PASS |
| C6 | Runtime health | Backend availability | Backend health endpoint returns `200` | `GET /api/health/ -> 200` | PASS |
| C7 | Runtime health | Frontend availability | Frontend route returns `200` | `GET /en -> 200` | PASS |

## Matrix Totals

- PASS: **23**
- FAIL: **0**

## Defects

- No open recovery defects from Step 4 gate.

## Command Output Summary

- Backend:
  - `docker compose exec backend python manage.py migrate` -> **no pending migrations**
  - `docker compose exec backend python manage.py test licenses.test_cards --keepdb --noinput` -> **84 passed**
  - `docker compose exec backend python manage.py check` -> **no issues**
- Frontend:
  - `docker compose exec frontend npm run lint` -> **0 errors, 9 warnings**
  - `npm run build` -> **pass**
  - `npm test -- --runInBand src/lib/license-card-gradient.test.ts` -> **4 passed**
- Runtime:
  - `docker compose exec -T backend python manage.py shell` (Step 4 matrix script) -> **15 pass / 0 fail**
  - `curl http://localhost:8000/api/health/` -> **200**
  - `curl http://localhost:3000/en` -> **200**

## Final Recommendation

- **GO** - proceed with patch release `v0.3.4`.
- Rationale: no blocking regressions detected across recovery focus areas and no open P0/P1 defects remain.
