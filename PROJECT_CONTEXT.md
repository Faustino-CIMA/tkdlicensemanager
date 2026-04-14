**LTF Taekwondo License Manager — Master Summary (March 2026)**
Last updated: 2026-03-28

Current main branch state:
- Version: v0.3.9 (annotated tag v0.3.9 created and pushed)
- Printer Profiles feature fully merged and live (v0.3.6)
- Docker infrastructure cleanup and stable stack released
- Full HeroUI v3.0.1 integration with custom ltf_theme + sharp consistent radii completed
- Sticky top bar implemented
- Navigation tabs stabilized (no more swapping on club dashboard)
- Club Members page fully cleaned up (RadioGroup filters with total counts, improved Members/Actions Selects, row status confirmation modals, pagination 50/150/300/All)

Current working branch: main
Status: All visual, navigation and Club Members page improvements merged and verified on main

Current Stack (locked) — Updated 2026-03-28
- Backend: python:3.13-slim-bookworm + Django 6.0.3 + DRF 3.17.0 + PostgreSQL 18
- Frontend: Next.js 16.2.1 (App Router) + React 19.2.4 + TypeScript 5.9.3 + HeroUI v3.0.1 + Tailwind 4.2.2
- Runtime: Python 3.13 + Node 22
- Cache / queue: Redis 8.4 + Celery 5.6.2
- Containers: Docker + Dokploy deployment

Rules we follow:
- Always work on dedicated feature branches for new work
- Always test in Docker (`docker compose up -d --build`)
- Use oh-my-cursor Team Avatar agents (@toph, @iroh, @appa, @sokka, @escher, ...)
- Agents must update CHANGELOG.md and README.md after every significant change
- PROJECT_CONTEXT.md is the single source of truth

## Major Features & Status (from transcripts)
- Multi-role system (LTF Admin, LTF Finance (strict), Club Admin, Coach, Member) — completed
- Member license-role taxonomy expanded (Volunteer, Staff, Media, Fan) across backend/frontend/import contracts with compatibility normalization — completed
- Full Finance Module (Order, OrderItem, Invoice, Payment with card details, Stripe Checkout + webhooks + manual record payment, audit logs) — completed
- License & Grade History tracking with django-simple-history — completed
- Profile Picture system (upload, crop/framing for 8:10 print, @imgly/background-removal-js) — completed
- UX improvements across dashboards (clickable rows, detail pages, Qty instead of Member, date+time, club names) — completed
- Celery Beat/Worker with staggered safe defaults (120s Stripe reconcile, etc.) — completed
- Dokploy multi-container deployment (Traefik routing fixed, staticfiles permissions fixed, healthchecks) — completed
- Checkout success/cancel pages with locale middleware — completed
- Consent logic adjusted (removed unnecessary club-admin consent block for payments)
- Payconiq backend supports both `mock` and production-ready `aggregator` mode with stable API contracts — completed
- Final documentation polish: root README publication pass, screenshot package, and frontend README alignment — completed
- License Card Step 3 backend render engine: deterministic preview-data + card/sheet PDF APIs with guides and merge resolution — completed
- License Card Step 5 backend print execution pipeline: async execute/retry/cancel lifecycle, PDF artifact persistence, secure download endpoint, and audit/status history — completed
- License Card Step 7 backend hardening: print history endpoint, list filters, guarded transition audits, Celery queue/time limits, cooperative cancellation checks, and artifact prune command — completed
- License Card Step 8 final closure (v2): full UAT matrix pass (dual-side + simulation + quick print/history), runtime queue/schema verification, docs/runbook alignment, and rollout/rollback checklists — completed
- License Card v2 Bug Fix & Polish (post-v0.2.0): P0 fixes (gradient save crash, per-corner radius, asset file-picker reliability), SVG sanitization hardening, deep review phases (designer + render/print), targeted remediation sprint, and Step 7 full regression gate PASS on `ea4ab58` — completed
- License Card v0.3.2 final docs/rollout pass: README/frontend docs refresh, rollout/rollback checklist finalization, and release tag `v0.3.2` creation/push — completed
- Card v2.1 (v0.3.3) closure: LP798 geometry precision lock, multi-image asset reliability (including active-by-default uploads), simulation font/refresh parity stabilization, role merge fields + locked date format coverage, and full Step 6 regression gate PASS — completed
- Card v2.1 Recovery Step 4 (v0.3.4): final recovery gate rerun PASS (`23/23`), release-readiness docs refresh (README/context/rollout checklist), and release tag `v0.3.4` prepared — completed
- Card v2.1 Consolidated Final Fix (post-recovery): strict `style.image_asset_id` guardrail, active-only image asset selection UX, simulation PDF-point scaling alignment, iframe refresh stability improvements, and fresh before/after evidence + backend/frontend test reruns — completed
- Card v2.1 Final Targeted SVG Fix: canonical SVG data-URI sanitization/normalization in render pipeline, strict SVG asset embedding for preview/PDF, simulation iframe refresh keying, and inspector image-source debug telemetry — completed
- Card v2.1 Final Targeted SVG Fix (real uploaded logos): widened SVG sanitizer baseline allowlist (clip/mask/filter/logo attributes), deterministic SVG data-URI embedding for preview/PDF HTML, simulation iframe keying from full srcDoc payload, explicit real-world SVG regression coverage, and refreshed before/after + PDF evidence artifacts — completed
- Printer Margin Profiles v2.1.2 closure (v0.3.5): owner-scoped printer-profile model/API integration (`created_by` ownership), quick-print/profile selection flow, final PDF x/y offset application for preview/print execution, and Step 5 full regression/stability gate PASS (`25/25`) on `9c03414` — completed
- Printer Profile Step 1–2 (feature/general-improvements): PrinterProfile ownership + owner-scoped CRUD/selection (backend), render offset in final PDF only (backend). Step 3: Club Admin quick-print printer profile selection (members, licenses, quick-print page) + LTF Admin CRUD at /dashboard/ltf/printer-profiles — completed. Step 3 (Club Admin access): "Printer Profiles" nav link in Club Admin layout (role=club_admin only) + /dashboard/club/printer-profiles page (CRUD, same as LTF) — completed
- Printer Profile Step 4 (feature/general-improvements): Full regression (licenses.test_cards 99/99), lint/build pass, Docker services healthy; end-to-end verification of Club Admin selection, LTF Admin CRUD, and PDF offset — completed. Step 4 re-run (2026-03-18): licenses.test_cards 99/99 OK, npm lint/build OK, docker compose up -d --build + ps all healthy.
- Printer Profile Step 5 (feature/general-improvements): Dokploy deploy + smoke tests passed; merged to `main`, tag `v0.3.6` created and pushed (2026-03-19).
- **Release v0.3.6 (2026-03-19):** Merged `feature/general-improvements` to `main` (fast-forward). Printer profiles (user-owned, Club Admin nav + `/dashboard/club/printer-profiles`, LTF Admin CRUD, quick-print selection, PDF offset in final output) + photo fixes live on `main`. Tag `v0.3.6` created and pushed.
- **v0.3.9 HeroUI Release (2026-03-28):** Full HeroUI v3.0.1 integration with custom ltf_theme.css, sticky top bar, stable tab navigation (no more swapping), Club Members page overhaul (RadioGroup filters with total counts, improved Members/Actions Selects, row status confirmation modals, pagination 50/150/300/All) — completed

## Key Decisions
- Club Admin payments do NOT require extra consent prompt
- Batch orders create ONE Order + ONE Invoice (grouped)
- Stripe uses invoice_number as reference (not order_number)
- All history is immutable and audited
- Docker containers run without .cursor bind-mounts (ownership stability)

## Current Open / Next Priorities (update after every milestone)
- Post-rollout observation on production/Dokploy (print queue, printer-profile offset correctness)
- Gather real Payconiq sandbox credentials and run first live sandbox verification
- Any remaining Dokploy stability tweaks

Next phase: General improvements or next major feature (e.g. Invoice redesign, full Payconiq integration)

Coding & Memory Rules (always follow)
- Always work on dedicated feature branches for new work
- Always test in Docker (`docker compose up -d --build`)
- Use oh-my-cursor Team Avatar agents (@toph, @iroh, @appa, @sokka, @escher, ...)
- Agents must update CHANGELOG.md and README.md after every significant change
- PROJECT_CONTEXT.md is the single source of truth
- Read this file FIRST in every session

Ready for your next request. Paste this block into any new Grok chat to continue with full context.