# License Card v2.1.2 - Step 5 Final Recovery Gate + Release UAT

Date: 2026-03-13 (rerun validated on latest `main`)  
Scope: Printer Margin Profiles v2.1.2 final gate on `9c03414` (after Steps 1-4), re-run on current `main`, including geometry, image-asset reliability, simulation/PDF parity, printer-profile integration, and PDF offset application.

## Executive Outcome

- Gate result: **PASS (GO for v0.3.5 release readiness)**.
- Blocking regressions (`P0`/`P1`): **none open**.
- Printer-profile offsets, LP798 geometry, simulation/PDF parity, and print execution behavior passed in both automated and runtime validation.
- Fresh rerun on `9c03414` produced the same stable outcome (`25 PASS`, `0 FAIL`) with no new defects.

## Environment and Runtime Notes

- Docker stack healthy (`backend`, `frontend`, `worker`, `beat`, `db`, `redis`).
- Migration state:
  - `docker compose exec backend python manage.py migrate`
  - applied during gate: `licenses.0029_printerprofile_created_by`
- Runtime health checks:
  - backend health endpoint: `200`
  - frontend route probe: `200`

## UAT Matrix (v2.1.2 Step 5)

| ID | Area | Case | Expected | Actual | Status |
|---|---|---|---|---|---|
| G1 | Geometry | LP798 + card canvas contract | `85.00x55.00`, margins/gaps `15/10/15` and `10/0` | Contract values match in preview payload | PASS |
| G2 | Geometry | Slot coordinate precision | Slot coordinates remain exact | Slot0/1/9 coordinates match locked values | PASS |
| G3 | Geometry | Guide neutrality | Guides must not alter slot math | Guided and non-guided slots/layout metadata are identical | PASS |
| A1 | Image assets | PNG explicit asset resolution | `style.image_asset_id` must resolve PNG | `resolved_via=style.image_asset_id`, status `resolved` | PASS |
| A2 | Image assets | SVG explicit asset resolution | `style.image_asset_id` must resolve SVG | SVG resolved as `data:image/svg+xml;base64,...` | PASS |
| A3 | Image assets | Missing asset-id strictness | Missing explicit asset must not fallback | `resolved_source=""`, `resolved_via=style.image_asset_id`, status `missing` | PASS |
| M1 | Merge/date | Locked date + role merge values | Dates `DD Mon YYYY`; roles resolved | `09 Nov 2016` / `09 Jan 2016` + `athlete/coach` | PASS |
| S1 | Simulation/PDF parity | Simulation style/text parity | Font size and placement must match payload | Simulation HTML includes `font-size:4.37mm` and expected coordinates/text | PASS |
| S2 | Simulation/PDF parity | Simulation HTML equals PDF body fragment | Shared render path should match | Simulation HTML equals card-document body fragment | PASS |
| S3 | Simulation/PDF parity | Card PDF endpoint validity | Endpoint returns PDF bytes | `200`, `application/pdf`, `%PDF` header present | PASS |
| PP1 | Printer profiles | Profile create/list API | LTF Admin can create/list profile | `POST /api/printer-profiles/` + list verification succeeded | PASS |
| PP2 | Printer profiles | Preview-sheet offset forwarding | Selected profile offsets forwarded to PDF renderer | `preview-sheet-pdf` forwarded `x=0.80`, `y=-0.45` | PASS |
| PP3 | Printer profiles | Print-job profile persistence | Print job stores selected profile | Create response includes `printer_profile` + `printer_profile_data` | PASS |
| O1 | Offsets in PDF | Execution applies selected offsets | Final render uses profile offsets | Print execution forwarded `x=0.80`, `y=-0.45` | PASS |
| O2 | Offsets in PDF | Execution without profile uses zero offsets | Default must be neutral offset | Final render forwarded `x=0.00`, `y=0.00` | PASS |
| O3 | Offsets in PDF | HTML translation wrapper behavior | Non-zero offsets inject transform wrapper | `pdf-final-offset-root` + `transform:translate(...)` verified | PASS |
| ST1 | Stability | Duplicate execution idempotency | Re-execute must not duplicate run | Attempt count remained stable on duplicate execute | PASS |
| ST2 | Stability | Queue cleanliness | No stuck queued/running jobs after checks | queued/running count `0` | PASS |
| C1 | Automated | Backend regression suite | `licenses.test_cards` must pass | `95/95` passed | PASS |
| C2 | Automated | Django checks | No system check issues | passed | PASS |
| C3 | Automated | Frontend lint | No lint errors | `0 errors`, `9 warnings` | PASS |
| C4 | Automated | Frontend build | Production build should pass | passed | PASS |
| C5 | Automated | Frontend card unit test | Targeted card utility test should pass | `4/4` passed (`license-card-gradient`) | PASS |
| C6 | Runtime health | Backend endpoint availability | `/api/health/` must respond | `200` | PASS |
| C7 | Runtime health | Frontend endpoint availability | `/en` should respond | `200` | PASS |

## Matrix Totals

- PASS: **25**
- FAIL: **0**

## Defects

- No open defects.  
- No new P0/P1 regressions detected in this gate.

## Command Output Summary

- Backend:
  - `docker compose exec backend python manage.py migrate` -> applied `licenses.0029_printerprofile_created_by`
  - `docker compose exec backend python manage.py test licenses.test_cards --keepdb --noinput` -> **97 passed**
  - `docker compose exec backend python manage.py check` -> **no issues**
- Frontend:
  - `npx eslint src` -> **0 errors**, 9 warnings
  - `npm run build` -> **pass**
  - `npm test -- --runInBand src/lib/license-card-gradient.test.ts` -> **4 passed**
- Runtime:
  - Dedicated Step 5 runtime matrix script -> **18 PASS / 0 FAIL**
  - health checks -> backend `200`, frontend `200`

## Final Recommendation

- **GO** - proceed with Printer Margin Profiles release finalization.
- Rationale: geometry, asset reliability, simulation/PDF parity, printer-profile integration, and offset application all validated with no blocking regressions.
