# LTF License Manager

Modern, secure Taekwondo license management for the Luxembourg Taekwondo Federation (LTF).

## Release Notes

- See `CHANGELOG.md` for user-facing and technical release notes.

## Prerequisites

Required:
- Git
- Docker Desktop (Windows/macOS) or Docker Engine (Linux)
- Docker Compose v2 (`docker compose` command)

Download links:
- Git (Windows): https://git-scm.com/download/win
- Git (macOS): https://git-scm.com/download/mac
- Docker Desktop (Windows): https://www.docker.com/products/docker-desktop/
- Docker Desktop (macOS): https://www.docker.com/products/docker-desktop/

Optional for local (non-Docker) development:
- Python 3.12+
- Node 20+

Windows (WSL) notes:
- Use WSL2 with a Linux distro (Ubuntu recommended).
- Install Docker Desktop and enable WSL integration.

Quick install scripts (optional):
- Windows: `scripts/install-prereqs.bat`
- macOS: `scripts/install-prereqs-macos.sh`
- Linux: `scripts/install-prereqs-linux.sh`

## Quick Start (Docker-first)

1. Clone the repo and enter the folder:

```
git clone https://github.com/Faustino-CIMA/tkdlicensemanager.git
cd tkdlicensemanager
```

2. Copy env template and adjust if needed:

```
cp .env.example .env
```

3. Build and start all services (production-like containers):

```
docker compose up --build
```

4. Apply migrations:

```
docker compose exec backend python manage.py migrate
```

5. Create Django superuser (admin login):

```
docker compose exec backend python manage.py createsuperuser
```

6. Open:
- Backend API: `http://localhost:8000/`
- Swagger docs: `http://localhost:8000/api/docs/`
- Frontend: `http://localhost:3000/`

## Docker Notes (beginner-friendly)

Docker runs each part of the app in its own isolated container, so you do not have to install Python, Node, Postgres, or Redis on your machine. The `docker-compose.yml` file is the recipe that tells Docker which containers to start, how they talk to each other, and which ports are exposed on your laptop.

Key ideas (plain English):
- A **container** is a mini‑computer with just the app and its dependencies.
- **Images** are the blueprints, **containers** are running copies.
- **Ports** are how you access a container from your browser (for example `3000` for the frontend).
- **Volumes** store data on your machine so it is not lost when containers restart.

Common Docker commands you will use:
- Start everything: `docker compose up --build`
- Stop everything: `docker compose down`
- See running containers: `docker compose ps`
- View logs: `docker compose logs -f backend` (or `frontend`, `db`, `redis`, `worker`, `beat`)
- Run a command inside a container: `docker compose exec backend python manage.py migrate`

Traefik routing (optional):
- Base `docker-compose.yml` is Traefik-agnostic (safe for Dockploy without external network coupling).
- Use Traefik labels via override file when needed:
```
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

PgBouncer pooling (optional):
- Use the PgBouncer override to add a pooled Postgres hop for backend/worker/beat.
- Startup command:
```
docker compose -f docker-compose.yml -f docker-compose.pgbouncer.yml up -d --build
```
- This profile switches Django DB host to `pgbouncer` and sets `DJANGO_DB_CONN_MAX_AGE=0`.

What the services are:
- `frontend`: Next.js UI (accessible at `http://localhost:3000/`)
- `backend`: Django API (accessible at `http://localhost:8000/`)
- `db`: PostgreSQL database (data stored in a volume)
- `redis`: Redis message broker/cache
- `worker`: Celery background jobs (runs tasks like invoice emails)
- `beat`: Celery scheduler (runs periodic jobs like license expiry reconciliation)

Important volumes:
- `postgres_data`: keeps your database data between restarts.
- `redis_data`: keeps Redis data between restarts (AOF enabled).
- `staticfiles_data`: stores collected static files from Django.
- `mediafiles_data`: stores uploaded member media files (profile pictures).
- `.cursor` bind‑mount: used for runtime debug logs (keep it if debugging is enabled).

Compose user mapping (Linux):
- `LOCAL_UID` and `LOCAL_GID` map container user permissions to your host user.
- Defaults are `1000:1000`; if your host user is different, set both in `.env`.

If Docker fails to start:
- Reboot Docker Desktop (Windows/macOS) or restart the Docker daemon (Linux).
- Check port conflicts (see Troubleshooting below).

## Screenshots

Docker Desktop (containers running):
![Docker Desktop showing ltf-license-manager containers running](docs/screenshots/docker-desktop-containers.png)
_Caption: Docker Desktop shows all services running (backend, frontend, db, redis, worker)._

Terminal (Compose start + status):
![Terminal output showing docker compose up and docker compose ps](docs/screenshots/docker-compose-terminal.png)
_Caption: Example terminal output for building and checking running containers._

Browser (Frontend + API docs):
![Browser showing local frontend and Swagger API docs](docs/screenshots/localhost-ui-and-api-docs.png)
_Caption: Frontend UI on port 3000 and Swagger API docs on port 8000._

## Project Structure

```
/backend   Django + DRF API
/frontend  Next.js App Router UI
/infra     Infra-related files (placeholder)
```

## Environment Variables

See `.env.example` for required settings.
Note: `.env.example` is tracked in git, `.env` is ignored.

Key value for email verification links:
- `FRONTEND_BASE_URL` (default `http://localhost:3000`)
- `FRONTEND_DEFAULT_LOCALE` (default `en`)

Media uploads (profile pictures):
- `MEDIA_URL` (default `/media/`)
- `MEDIA_ROOT` (default `/app/media` in Docker)
- `DATA_UPLOAD_MAX_MEMORY_SIZE` (default `10485760` bytes / 10 MB)
- `FILE_UPLOAD_MAX_MEMORY_SIZE` (default `10485760` bytes / 10 MB)

Stripe + payments:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_API_VERSION` (default `2026-01-28.clover`)
- `STRIPE_CHECKOUT_SUCCESS_URL`
- `STRIPE_CHECKOUT_CANCEL_URL`

Payconiq (dev/test):
- `PAYCONIQ_MODE` (default `mock`)
- `PAYCONIQ_API_KEY`
- `PAYCONIQ_MERCHANT_ID`
- `PAYCONIQ_BASE_URL`

SEPA (invoice QR):
- `INVOICE_SEPA_BENEFICIARY`
- `INVOICE_SEPA_IBAN`
- `INVOICE_SEPA_BIC`
- `INVOICE_SEPA_REMITTANCE_PREFIX`

Email (Resend):
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

Celery + Redis:
- `CELERY_BROKER_URL` (default `redis://redis:6379/0`)
- `CELERY_RESULT_BACKEND` (default `redis://redis:6379/1`)
- `REDIS_URL` (used for general cache/queues)

Performance:
- `DJANGO_DB_CONN_MAX_AGE` (default `60`)
- `DJANGO_DB_CONN_HEALTH_CHECKS` (default `True`)
- `DJANGO_DB_CONNECT_TIMEOUT` (default `5`)
- `DJANGO_DB_STATEMENT_TIMEOUT_MS` (default `15000`)
- `DJANGO_DB_USE_PGBOUNCER` (default `False`; when `True`, startup `statement_timeout` option is skipped for PgBouncer compatibility)
- `POSTGRES_MAX_CONNECTIONS` (default `300`, container-level Postgres setting)
- `POSTGRES_SHARED_BUFFERS` (default `256MB`)
- `POSTGRES_EFFECTIVE_CACHE_SIZE` (default `768MB`)
- `POSTGRES_WORK_MEM` (default `8MB`)
- `POSTGRES_MAINTENANCE_WORK_MEM` (default `64MB`)
- `POSTGRES_LOG_MIN_DURATION_STATEMENT_MS` (default `750`, logs slow SQL statements in Postgres container logs)
- `DJANGO_CACHE_URL` (optional; set to Redis for shared cache across Gunicorn workers)
- `GUNICORN_WORKERS` (default `4`)
- `GUNICORN_THREADS` (default `2`)
- `GUNICORN_TIMEOUT` (default `120`)
- `API_PAGINATION_DEFAULT_PAGE_SIZE` (default `50`, used when `page` is requested)
- `API_PAGINATION_MAX_PAGE_SIZE` (default `200`)
- `PGBOUNCER_POOL_MODE` (default `transaction`, when using PgBouncer override)
- `PGBOUNCER_MAX_CLIENT_CONN` (default `500`)
- `PGBOUNCER_DEFAULT_POOL_SIZE` (default `50`)
- `PGBOUNCER_RESERVE_POOL_SIZE` (default `10`)
- `DASHBOARD_OVERVIEW_CACHE_TTL_SECONDS` (default `20`, short server-side cache for overview endpoints)
- `STRIPE_RECONCILE_BATCH_LIMIT` (default `100`, limits per-run Stripe reconciliation workload)

Encryption:
- `FERNET_KEYS` (optional, comma-separated keys for encrypted finance fields)
- If not set, the app derives one key from `DJANGO_SECRET_KEY` for local/dev.

## Finance Module Setup (Stripe + Webhooks + Celery)

Stripe configuration:
- Set `STRIPE_SECRET_KEY` and `STRIPE_API_VERSION` in `.env`.
- Set `STRIPE_WEBHOOK_SECRET` to the signing secret for your Stripe webhook endpoint.
- Ensure `STRIPE_CHECKOUT_SUCCESS_URL` and `STRIPE_CHECKOUT_CANCEL_URL` match your frontend URLs.
- Stripe processing requires consent: if member consent is missing, Club Admins must explicitly confirm consent when creating a checkout session.
- Finance access: LTF Finance has full access to orders/invoices/audit logs; LTF Admin can only perform fallback actions (confirm payment or activate licenses).

Payconiq (dev/test):
- Set `PAYCONIQ_MODE=mock` and `PAYCONIQ_BASE_URL` for local testing.
- Use the Club Admin invoice page to generate a Payconiq payment link.
- The printable invoice includes both Payconiq and SEPA QR codes (SEPA requires the `INVOICE_SEPA_*` fields).

Webhook processing:
- The Stripe webhook endpoint expects a valid signature and then dispatches work to Celery.
- Make sure the `worker` and `beat` services are running: `docker compose up -d worker beat`.

Stripe CLI testing (optional):
- Install Stripe CLI: https://stripe.com/docs/stripe-cli
- Login: `stripe login`
- Forward webhooks to local backend:
```
stripe listen --forward-to localhost:8000/api/stripe/webhook/
```
- Trigger a test event:
```
stripe trigger checkout.session.completed
```

Finance API quick reference:
- `POST /api/stripe/webhook/` (Stripe events; signature required)
- `GET /api/payments/` (LTF Finance, read-only; supports `invoice_id`/`order_id` filters)
- `POST /api/payconiq/create/` (create Payconiq payment)
- `GET /api/payconiq/{id}/status/` (refresh Payconiq status)
- `GET /api/invoices/{id}/pdf/` (invoice PDF)
- `GET /api/license-prices/` and `POST /api/license-prices/` (LTF Finance/Admin)
- `GET /api/club-orders/` and `GET /api/club-invoices/` (Club Admin scoped endpoints)

Celery + Redis:
- `CELERY_BROKER_URL` and `CELERY_RESULT_BACKEND` must point to Redis.
- Redis must be running for background jobs (invoice emails, webhook processing).
- `beat` runs periodic jobs (for example daily expired-license reconciliation).

## Migrations and Role Rename Notes

If you have existing users from earlier versions:
- A legacy role value `nma_admin` is automatically normalized to `ltf_admin` by a migration.
- Run migrations after upgrading: `docker compose exec backend python manage.py migrate`.
- After migrating, verify any admin/finance users still have the correct role in the admin UI.

Recommended host alignment (prevents CORS errors):
- Keep frontend and backend on the same host (use either `localhost` or `127.0.0.1` consistently).
- Example `.env` values:

```
FRONTEND_BASE_URL=http://127.0.0.1:3000
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

Ports used:
- `3000` (Frontend)
- `8000` (Backend API)
- `5432` (PostgreSQL)
- `6379` (Redis)

## Local Development (optional)

Backend:

```
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Frontend:

```
cd frontend
npm install
npm run dev
```

Note: Local dev uses the Next.js dev server and Django dev server. Docker compose uses production-style `gunicorn` and `next start`.

## Tests

Backend:

```
docker compose exec backend python manage.py test
```

Frontend:

```
cd frontend
npm test -- --runInBand
```

Profile picture focused frontend tests:

```
cd frontend
npm test -- --runInBand src/components/profile-photo/profile-photo-manager.test.tsx src/lib/club-admin-api.test.ts
```

or in Docker:

```
docker compose run --rm frontend npm test -- --runInBand
```

## History Tracking API (License + Grade)

Member history endpoints:
- `GET /api/members/{id}/history/` (combined license + grade history)
- `GET /api/members/{id}/license-history/`
- `GET /api/members/{id}/grade-history/`
- `POST /api/members/{id}/promote-grade/` (LTF Admin / Club Admin / Coach)

Role access:
- Member: own history only
- Club Admin / Coach: own-club members
- LTF Admin: all members
- LTF Finance: financially relevant license history only (order/payment-linked), grade history denied

GDPR notes:
- `GET /api/auth/data-export/` now includes `license_history`, `grade_history`, and `profile_photo`
- `DELETE /api/auth/data-delete/` anonymizes grade history free text/proof fields and clears stored profile picture files before user deletion

Audit + immutability:
- `License` uses `django-simple-history` (`HistoricalLicense`) for field-level change history
- `LicenseHistoryEvent` and `GradePromotionHistory` are append-only business timelines

## Profile Picture Upload + Editing

Backend endpoints:
- `GET /api/members/{id}/profile-picture/` (current image metadata + URLs)
- `POST /api/members/{id}/profile-picture/` (multipart upload)
- `DELETE /api/members/{id}/profile-picture/`
- `GET /api/members/{id}/profile-picture/download/`

Role access:
- Member: own profile picture
- Club Admin: own-club members
- LTF Admin: all members
- LTF Finance: read-only (no upload/delete)

Validation + processing:
- Accepted upload inputs: JPEG, PNG, HEIC/HEIF (input), max 10 MB by default
- Processed output is sanitized and stored as JPEG with thumbnail generation
- Minimum processed resolution: `945x1181` (8x10 print-ready target)
- Explicit photo consent checkbox is required on upload
- If a member account exists, user-level consent must be granted before photo storage

Frontend UX:
- Drag-and-drop upload, file picker, and camera capture (`accept=\"image/*\" capture`)
- Fixed 8:10 crop with zoom/drag and live preview
- Optional client-side background removal + solid color replacement
- Library note: npm alias is used so imports stay `@imgly/background-removal-js` while resolving to IMGLY's published package

GDPR:
- `GET /api/auth/data-export/` now includes `profile_photo` metadata and download reference
- `DELETE /api/auth/data-delete/` clears stored profile picture files and metadata before user deletion

## Verify Install

Check services:
```
docker compose ps
```

Quick smoke checks:
```
curl http://localhost:8000/api/schema/
curl http://localhost:3000/
```

## MVP Features (current)

- Role-based authentication (LTF admin, LTF finance, club admin, coach, member)
- Core models: Club, Member, License, LicenseType
- Email verification + password reset flow
- Club admin management (LTF assigns, limits per club)
- License type management (LTF-managed)
- Finance module: orders, invoices, Stripe checkout, audit logs (finance-only access)
- License history timeline (immutable events + django-simple-history)
- Grade promotion history timeline with member current grade sync
- Profile picture upload/edit flow (drag-drop, camera, 8:10 crop, optional client-side background removal)
- CSV import for clubs and members with mapping + preview
- GDPR endpoints: consent, data export, data delete
- i18n scaffolding (English + Luxembourgish)

## Contributing

- Use conventional commits: `feat:`, `fix:`, `docs:`, `chore:`

## Troubleshooting

- **Missing `.env`**: Create it from `.env.example` and ensure values are set.
- **Port conflicts**: Stop services using ports 3000/8000/5432/6379 or change ports in `docker-compose.yml`.
- **LAN/mobile login issues (`DisallowedHost` / CORS)**: for local dev, keep `DJANGO_ALLOW_ALL_HOSTS_IN_DEBUG=True` and restart backend. Frontend API requests now remap loopback API URLs (`localhost`/`127.0.0.1`) to the browser hostname, so phone access via `http://<your-lan-ip>:3000` can call `http://<your-lan-ip>:8000` without hardcoding IPs. If using `CORS_ALLOWED_ORIGIN_REGEXES`, separate multiple patterns with semicolons (`;`) or use a JSON array.
- **Debug log mount**: Docker mounts `.cursor/` into backend/worker for runtime debug logs. Keep it unless you remove debug logging.
- **Database not ready**: Wait for `docker compose ps` to show healthy, or restart with `docker compose restart db`.
- **Stuck migrations**: `docker compose down -v` to reset volumes (data loss), then `docker compose up --build`.
- **Celery Beat schedule file**: `backend/celerybeat-schedule` is generated locally; keep it out of git.
- **makemigrations permission denied in Docker**: run `python backend/manage.py makemigrations` locally or add the migration file in the repo, then run `docker compose exec backend python manage.py migrate`.
- **`traefik-public` network not found**: either create it manually (`docker network create traefik-public`) or deploy with base compose only (without `docker-compose.traefik.yml`) and use Dockploy domain routing UI.