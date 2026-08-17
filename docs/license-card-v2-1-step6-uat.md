# License Card v2.1 - Step 6 Full Regression + Stability UAT

Date: 2026-03-06  
Scope: Card v2.1 closure gate after Steps 1-5 (`e9e69c5`) plus Step 6 gate stabilization fix for asset activation defaults.

## Executive Outcome

- Gate result: **PASS (GO for v0.3.3 production rollout)**.
- Blocking regressions (`P0`/`P1`): **none open**.
- Runtime geometry, asset resolution, simulation refresh, merge fields, date format, and print pipeline checks passed.

## Environment and Runtime Notes

- Docker stack healthy (`backend`, `frontend`, `worker`, `beat`, `db`, `redis`).
- Migration state:
  - `docker compose exec backend python manage.py migrate`
  - Applied during gate: `licenses.0027_lp798_geometry_contract_v21`
- Worker queue binding confirmed:
  - `docker compose top worker`
  - command includes `-Q celery,print_jobs`

## UAT Matrix (v2.1)

| ID | Area | Case | Expected | Actual | Status |
|---|---|---|---|---|---|
| G1 | Geometry | LP798 contract values | card `85.00x55.00`, margins/gaps match contract | DB/runtime values match (`15/10/15`, `10/0`) | PASS |
| G2 | Geometry | Slot coordinate precision | slot0, slot1, slot9 exact coordinates | `slot0 15/10-100/65`, `slot1 110/10-195/65`, `slot9 110/230-195/285` | PASS |
| G3 | Geometry | Sheet bounds integrity | layout remains within A4 sheet | `within_sheet_bounds=true` | PASS |
| G4 | Geometry | Guides neutrality | guides must not shift slot math | covered by backend suite (`test_lp798_guides_do_not_change_slot_geometry`) | PASS |
| A1 | Assets | Upload default activation | uploaded assets should be active by default | runtime upload without `is_active` returns `is_active=true` | PASS |
| A2 | Assets | Multi-image asset reliability | second/third image must resolve selected assets | two image elements resolved via `style.image_asset_id` (PNG + SVG) | PASS |
| A3 | Assets | Explicit asset-id strictness | no profile-picture fallback when asset id is missing | covered by suite (`test_preview_data_explicit_image_asset_id_does_not_fallback_to_member_photo`) | PASS |
| A4 | Assets | SVG rendering path | uploaded SVG asset resolves in preview/simulation | runtime `data:image/svg+xml;base64,...` resolved for second image object | PASS |
| A5 | Assets | SVG security | dangerous SVG content must not survive storage/render | covered by suite (`test_svg_upload_sanitizes_malicious_payload_before_storage`) | PASS |
| A6 | Assets | Raster compatibility | PNG/JPEG uploads still render | covered by suite (`test_raster_image_upload_remains_supported_after_svg_hardening`) | PASS |
| M1 | Merge fields | New role fields in registry | `primary_license_role`, `secondary_license_role` available | merge-fields endpoint includes both keys | PASS |
| M2 | Merge fields | Role resolution | role merge fields resolve in preview context | context shows `athlete` and `coach` | PASS |
| M3 | Date format | Locked date format | date fields must render `DD Mon YYYY` everywhere | context values `09 Nov 2016`, `09 Jan 2016`, `09 Nov 2016` | PASS |
| M4 | Simulation | Role/date text rendering | simulation HTML reflects resolved role/date values | front simulation contains formatted dates + role strings | PASS |
| M5 | PDF preview | Date-format parity | PDF preview path uses same date formatting | covered by suite (`test_preview_card_pdf_receives_ltf_date_formatted_context`) | PASS |
| S1 | Simulation stability | Front/back responsiveness | simulation refresh should be fast and side-correct | front/back HTML calls `200` with low latency (~33ms/~29ms) | PASS |
| S2 | Simulation stability | Deterministic override refresh | immediate refresh should show newest payload | override A then B returns B without stale A bleed-through | PASS |
| S3 | Simulation/PDF parity | Font-size parity | simulation and PDF use aligned font sizing | covered by suite (`test_preview_simulation_and_pdf_share_font_size_css`) | PASS |
| P1 | Print pipeline | Quick print lifecycle | create -> execute -> download should succeed | runtime job succeeded, PDF `200` | PASS |
| P2 | Print pipeline | Duplicate execute guard | repeated execute should not duplicate execution | second execute accepted, final `execution_attempts=1` | PASS |
| P3 | Print pipeline | Side-aware execution | requested side must persist/honor (`back`) | quick print persisted `side=back` and succeeded | PASS |
| P4 | Print pipeline | Missing artifact behavior | missing file should return controlled not-found | PDF endpoint returns `404` after artifact delete | PASS |
| P5 | Stability | Moderate batch run | >=50 cards should complete without stalls | runtime batch `50` items succeeded with attempts `1` | PASS |
| P6 | Stability | Queue health after batch | no stale queued/running jobs | queued/running count `0` | PASS |
| C1 | Automated | Backend card suite | regression suite must pass | `83/83` passed | PASS |
| C2 | Automated | Django checks | no system check issues | passed | PASS |
| C3 | Automated | Frontend lint | no lint errors | pass (`0 errors`, `9 warnings`) | PASS |
| C4 | Automated | Frontend build | production build should succeed | passed | PASS |
| C5 | Automated | Frontend card unit test | gradient helper tests pass | `4/4` passed | PASS |
| C6 | Runtime health | Service availability | backend/frontend health endpoints return 200 | backend `200`, frontend `200` | PASS |

## Matrix Totals

- PASS: **30**
- FAIL: **0**

## Defects

### DEF-6-001 (Resolved during gate) - Multipart asset uploads defaulted to inactive when `is_active` was omitted

- Severity at detection: **P1 (asset reliability risk)**
- Symptom: newly uploaded image assets could be created as inactive, causing unresolved asset sources at render time.
- Resolution in Step 6:
  - Backend serializers now default omitted `is_active` to `true` on create for font/image assets.
  - Frontend designer upload payload now sends `is_active: true` explicitly.
  - Regression assertions added in `licenses.test_cards` to lock this behavior.
- Post-fix verification:
  - runtime upload without `is_active` returns `is_active=true`,
  - full backend suite remains green.

## Command Output Summary

- Backend:
  - `docker compose exec backend python manage.py migrate` -> applied `licenses.0027_lp798_geometry_contract_v21`
  - `docker compose exec backend python manage.py test licenses.test_cards --keepdb --noinput` -> **83 passed**
  - `docker compose exec backend python manage.py check` -> **no issues**
- Frontend:
  - `docker compose exec frontend npm run lint` -> **pass** (`0 errors`, `9 warnings`)
  - `docker compose exec frontend npm run build` -> **pass**
  - `docker compose exec frontend npm test -- --runInBand src/lib/license-card-gradient.test.ts` -> **4 passed**
- Runtime:
  - health checks: backend `200`, frontend `200`
  - worker queue binding includes `print_jobs`
  - quick print + batch print runtime checks passed (`succeeded`, no stale queued/running jobs)

## Final Recommendation

- **GO** - proceed with v0.3.3 release tag and production rollout.
- Rationale: no open P0/P1 defects remain after v2.1 closure gate.
