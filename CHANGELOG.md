# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.3.6] - 2026-03-14

### User-facing
- **Printer profiles (user-owned):** Club Admins can select their own printer profile when creating quick-print jobs (members, licenses, and quick-print page) and have a dedicated **Printer profiles** nav link and CRUD page at **Dashboard (club) → Printer profiles**. LTF Admins can create, edit, and delete their own printer profiles at **Dashboard (LTF) → Printer profiles**. Offsets (X/Y mm) are applied only in the final PDF output; designer canvas and live simulation are unchanged.
- Fixed member photo uploads that previously failed with generic errors.
- Fixed cases where a photo saved successfully but did not display afterward.
- Improved upload failure messages, including clearer feedback for server and size-related failures.

### Technical
- Backend: PrinterProfile model with `created_by` ownership; owner-scoped list/retrieve/update/delete and create; print job creation accepts only the caller’s profiles. Render offset applied in final PDF path only (`_apply_printer_offset_to_pdf`).
- Frontend: Printer profile API helpers and selection in Club Admin quick-print flows; LTF Admin CRUD page at `/dashboard/ltf/printer-profiles` and Club Admin CRUD page at `/dashboard/club/printer-profiles` (nav link shown only for Club Admin role), with create/edit/delete modals.
- Hardened backend photo processing and storage flow to tolerate partial derivative write failures while preserving required processed image saves.
- Increased upload-size limits and made frontend multipart uploads size-aware by skipping oversized optional original files.
- Added authenticated API endpoints for processed and thumbnail profile images to avoid reliance on direct `/media` routing.
- Improved container startup permission handling for media, static, and Celery beat storage paths in Docker Compose deployments.

## [0.3.5] - 2026-03-11

### User-facing
- Finalized SVG logo rendering reliability so uploaded SVG assets now appear consistently in the designer simulation and generated PDFs.
- Preserved simulation/PDF visual parity for typography and element placement to match print output more closely.
- Added support for the `current_grade` merge field in card templates and preview/print rendering.
- Reconfirmed LP798 geometry precision (85.00 x 55.00 mm card canvas and exact sheet placement contract) after the recovery/fix cycle.

### Technical
- Hardened SVG data-URI normalization and render-path embedding across preview, simulation, and PDF generation.
- Stabilized simulation refresh behavior to avoid stale iframe payloads after image/source updates.
- Extended regression coverage for real uploaded SVG assets and merge-field rendering consistency.
- Completed patch-release readiness for Card v2.1 + recovery closure on `v0.3.5`.

## [0.3.4] - 2026-03-07

### User-facing
- Card v2.1 Recovery Step 4 final gate is complete and release-ready.
- LP798 geometry placement and multi-image asset behavior were revalidated end-to-end (including SVG assets).
- Designer ruler/snap controls and simulation/PDF parity remain stable after recovery fixes.

### Technical
- Added final recovery UAT report with full matrix coverage in `docs/license-card-v2-1-recovery-step4-uat.md` (`23 PASS`, `0 FAIL`).
- Re-ran backend card regression suite (`licenses.test_cards`), runtime preview/simulation/PDF assertions, and print execution/duplicate-guard checks.
- Refreshed release runbooks and project memory for patch release rollout (`README.md`, `PROJECT_CONTEXT.md`, `docs/license-card-rollout-rollback-checklists.md`).

## [0.3.3] - 2026-03-06

### User-facing
- Card v2.1 precision/stability closure is complete with exact LP798 geometry parity across preview and print.
- Multi-image card designs now resolve selected uploaded image assets reliably (including SVG) across simulation/PDF/print.
- Designer merge fields now include `primary_license_role` and `secondary_license_role`, with locked date formatting applied consistently.

### Technical
- Enforced deterministic simulation refresh behavior and validated simulation/PDF font-size parity in regression coverage.
- Added/extended runtime and backend regression checks for LP798 slot geometry, role/date merge context, and print pipeline stability.
- Fixed multipart asset upload activation defaults by forcing omitted `is_active` to `true` on create and sending explicit `is_active: true` from the designer upload flow.
- Finalized v2.1 UAT gate documentation and rollout checklist updates for release `v0.3.3`.

## [0.3.2] - 2026-03-05

### User-facing
- License Card Designer v2 stability gate passed after remediation sprint and full regression/UAT rerun.
- Publishing a draft now protects unsaved in-memory edits before publish.
- Asset library upload flow is stable for repeated file-picker usage.

### Technical
- Closed P1 findings from deep review: dual-side print selection, enqueue failure stranding, duplicate execution guard, and preview/print parity hardening.
- Added/expanded print pipeline and preview regression coverage in `licenses.test_cards`.
- Enforced and documented SVG sanitize-and-accept policy with strict stripping of dangerous constructs before storage/render.
- Finalized v0.3.2 rollout and rollback runbooks for production operations.
