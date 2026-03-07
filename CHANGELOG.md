# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### User-facing
- Fixed member photo uploads that previously failed with generic errors.
- Fixed cases where a photo saved successfully but did not display afterward.
- Improved upload failure messages, including clearer feedback for server and size-related failures.

### Technical
- Hardened backend photo processing and storage flow to tolerate partial derivative write failures while preserving required processed image saves.
- Increased upload-size limits and made frontend multipart uploads size-aware by skipping oversized optional original files.
- Added authenticated API endpoints for processed and thumbnail profile images to avoid reliance on direct `/media` routing.
- Improved container startup permission handling for media, static, and Celery beat storage paths in Docker Compose deployments.

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
