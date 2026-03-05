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
