**LTF Taekwondo License Manager — Master Summary (March 2026)**
Last updated: 2026-03-21

Current main branch state:
- Version: v0.3.8 (annotated tag v0.3.8 created and pushed)
- Printer Profiles feature fully merged and live (v0.3.6)
- Docker infrastructure cleanup completed and released

Current working branch: main

Current Stack (locked) — Updated 2026-03-21:
- Backend: python:3.13-slim-bookworm + Django 6.0.3 + DRF 3.16.1 + PostgreSQL 18
- Frontend: Next.js 16.2.0 (App Router) + React 19.2.3 + TypeScript 5.9.3
- Runtime: Python 3.13 + Node 20
- Cache/Queue: Redis 8.4 + Celery 5.6.2
- Key improvements: procps + net-tools installed, removed all .cursor bind mounts and chown commands, stable healthchecks, resolved long-standing ownership corruption

Rules we follow:
- Always work on dedicated feature branches for new work
- Always test in Docker (`docker compose up -d --build`)
- Use oh-my-cursor Team Avatar agents (@toph, @iroh, @appa, @sokka, ...)
- PROJECT_CONTEXT.md is the single source of truth

Major Features & Status (from transcripts)
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
- Payconiq backend supports both mock and production-ready aggregator mode with stable API contracts — completed
- License Card Designer v2.1 + smart printing pipeline — completed
- Printer Profiles (user-owned + Club/LTF Admin flows, offsets only in final PDF) — completed
- Release v0.3.6 (2026-03-19): Printer Profiles merged to main
- Release v0.3.8 (2026-03-21): Docker infrastructure cleanup (python:3.13-slim-bookworm base image, procps + net-tools, removed risky chown logic and .cursor mounts, stable healthchecks, resolved ownership corruption) — merged to main, tag v0.3.8 created and pushed

Key Decisions
- Club Admin payments do NOT require extra consent prompt
- Batch orders create ONE Order + ONE Invoice (grouped)
- Stripe uses invoice_number as reference (not order_number)
- All history is immutable and audited
- Docker: Use stable base images with explicit diagnostic tools; never mount .cursor into containers; avoid broad recursive chown in entrypoints

Current Open / Next Priorities (update after every milestone)
- Post-merge Dokploy smoke test on v0.3.8
- Gather real Payconiq sandbox credentials and run first live verification
- Post-rollout observation on production (print queue, printer-profile offset correctness, artifact retention)

Next phase: General improvements or next major feature (e.g. Invoice redesign, full Payconiq integration)

Ready for your next request. Paste this block into any new Grok chat to continue with full context.