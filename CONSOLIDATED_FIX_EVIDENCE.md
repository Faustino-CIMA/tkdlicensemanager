# Consolidated Final Fix Evidence

Date: 2026-03-07

## Before vs After Artifacts

- Before run: `frontend/artifacts/card-v21-recovery-p0-2026-03-07T11-14-29-468Z`
- After run: `frontend/artifacts/card-v21-recovery-p0-2026-03-07T12-47-27-650Z`
- Backend triage run: `backend/artifacts/card-v21-recovery-step1/20260307124854-f6c4e056`

## Screenshot and PDF Paths

- Issue 1 before screenshot: `frontend/artifacts/card-v21-recovery-p0-2026-03-07T11-14-29-468Z/issue1-simulation.png`
- Issue 1 after screenshot: `frontend/artifacts/card-v21-recovery-p0-2026-03-07T12-47-27-650Z/issue1-simulation.png`
- Issue 3 before simulation screenshot: `frontend/artifacts/card-v21-recovery-p0-2026-03-07T11-14-29-468Z/issue3-simulation.png`
- Issue 3 after simulation screenshot: `frontend/artifacts/card-v21-recovery-p0-2026-03-07T12-47-27-650Z/issue3-simulation.png`
- Issue 3 before PDF popup screenshot: `frontend/artifacts/card-v21-recovery-p0-2026-03-07T11-14-29-468Z/issue3-pdf-popup.png`
- Issue 3 after PDF popup screenshot: `frontend/artifacts/card-v21-recovery-p0-2026-03-07T12-47-27-650Z/issue3-pdf-popup.png`
- Issue 3 before generated PDF: `frontend/artifacts/card-v21-recovery-p0-2026-03-07T11-14-29-468Z/issue3-preview-card.pdf`
- Issue 3 after generated PDF: `frontend/artifacts/card-v21-recovery-p0-2026-03-07T12-47-27-650Z/issue3-preview-card.pdf`
- Backend parity render HTML: `backend/artifacts/card-v21-recovery-step1/20260307124854-f6c4e056/render/parity_pdf_render_html.html`
- Backend parity simulation HTML payload: `backend/artifacts/card-v21-recovery-step1/20260307124854-f6c4e056/responses/parity_preview_html.json`
- Backend parity summary: `backend/artifacts/card-v21-recovery-step1/20260307124854-f6c4e056/SUMMARY.json`

## Key Comparison Notes

- Issue 1 (image asset selection):
  - Before: second selected asset was `Contract Image Malicious SVG` and simulation only had one image source sample.
  - After: second selected asset is `Recovery SVG 20260307091600141032`; simulation source samples include both PNG and SVG data URIs and `fallbackDetected=false`.
  - Backend triage confirms strict style resolution metadata: `resolved_via=style.image_asset_id`; no fallback path used when assets are inactive (`print_failing_no_image_count=2`, `print_failing_html_has_svg_data_uri=false`).

- Issue 2 (layout quirks):
  - Post-fix geometry checks at browser zoom 80%, 100%, and 125% report `topClipped=false`, `sideOverlapsCanvas=false`, and `sideOverflowHost=false`.
  - Back-side/front-side toggle screenshots captured with no ruler overflow artifacts.

- Issue 3 (simulation/PDF parity scaling):
  - Before simulation metrics:
    - rect: left 18.891, top 113.375, width 264.563, height 45.344
  - After simulation metrics:
    - rect: left 14.168, top 85.031, width 198.422, height 34.008
  - Frontend triage comparison keeps `fontSizeMm=4.37` and reports tighter physical-size parity with the PDF preview capture.
  - Backend triage parity summary reports `simulation_font_sizes=["4.37mm"]`, `pdf_font_sizes=["4.37mm"]`, `font_size_sets_match=true`.

## Test Execution Summary

- Backend (full): `docker compose exec backend python manage.py test --keepdb --noinput`
  - Result: PASS (`252` tests)

- Frontend (full): `docker compose exec frontend npm test -- --runInBand`
  - Result: FAIL due pre-existing test in `src/components/history/member-history-timeline.test.tsx`
  - Failing assertion: `screen.getByText(/From:/)` now matches multiple elements.
  - Card simulation tests pass, including `src/lib/card-simulation.test.ts`.
