# LTF License Manager - Permanent Project Memory
Last updated: 2026-02-27

## Current Stack (locked)
- Backend: Django 6+ + DRF + PostgreSQL 18+
- Frontend: Next.js 16+ (App Router) + React + TypeScript + **Material Design 3 (@mui/material)**
- Database: PostgreSQL 18+
- Other: Redis + Celery (staggered schedules), Docker + docker-compose + Dokploy deployment
- i18n: next-intl (EN/LU)
- Security: GDPR-first (consent, minimization, rights, export/delete), OWASP, django-simple-history
- Documentation: Comprehensive README + code comments + drf-spectacular API docs
- CI/CD: GitHub Actions CI active (backend migrate/check/test + frontend lint/build)

## Major Features & Status (from transcripts)
- Multi-role system (LTF Admin, LTF Finance (strict), Club Admin, Coach, Member) — completed
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

## Key Decisions
- Material Design 3 is the only UI framework
- Club Admin payments do NOT require extra consent prompt
- Batch orders create ONE Order + ONE Invoice (grouped)
- Stripe uses invoice_number as reference (not order_number)
- All history is immutable and audited
- Docker containers run with host UID/GID + .cursor bind-mount for debugging

## Current Open / Next Priorities (update after every milestone)
- Gather real Payconiq sandbox credentials and run first live sandbox verification
- Any remaining Dokploy stability tweaks
- License Card Step 4/5 integration (print jobs execution + final production print pipeline)

## Coding & Memory Rules (always follow)
- Explain ALL JS/TS in extreme beginner detail
- Small, testable steps with tests at every stage
- Conventional commits
- Update this file after every major feature
- Read this file FIRST in every session

---
Update this file after every significant milestone.