# LTF License Manager

Modern, secure Taekwondo license management for the Luxembourg Taekwondo Federation (LTF).

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
- View logs: `docker compose logs -f backend` (or `frontend`, `db`, `redis`, `worker`)
- Run a command inside a container: `docker compose exec backend python manage.py migrate`

What the services are:
- `frontend`: Next.js UI (accessible at `http://localhost:3000/`)
- `backend`: Django API (accessible at `http://localhost:8000/`)
- `db`: PostgreSQL database (data stored in a volume)
- `redis`: Redis message broker/cache
- `worker`: Celery background jobs (runs tasks like invoice emails)

Important volumes:
- `postgres_data`: keeps your database data between restarts.
- `redis_data`: keeps Redis data between restarts (AOF enabled).
- `backend/staticfiles`: stores collected static files from Django.
- `.cursor` bind‑mount: used for runtime debug logs (keep it if debugging is enabled).

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

Stripe + payments:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_API_VERSION` (default `2026-01-28.clover`)
- `STRIPE_CHECKOUT_SUCCESS_URL`
- `STRIPE_CHECKOUT_CANCEL_URL`

Email (Resend):
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

Celery + Redis:
- `CELERY_BROKER_URL` (default `redis://redis:6379/0`)
- `CELERY_RESULT_BACKEND` (default `redis://redis:6379/1`)
- `REDIS_URL` (used for general cache/queues)

## Finance Module Setup (Stripe + Webhooks + Celery)

Stripe configuration:
- Set `STRIPE_SECRET_KEY` and `STRIPE_API_VERSION` in `.env`.
- Set `STRIPE_WEBHOOK_SECRET` to the signing secret for your Stripe webhook endpoint.
- Ensure `STRIPE_CHECKOUT_SUCCESS_URL` and `STRIPE_CHECKOUT_CANCEL_URL` match your frontend URLs.
- Stripe processing requires consent: if member consent is missing, Club Admins must explicitly confirm consent when creating a checkout session.
- Finance access: LTF Finance has full access to orders/invoices/audit logs; LTF Admin can only perform fallback actions (confirm payment or activate licenses).

Webhook processing:
- The Stripe webhook endpoint expects a valid signature and then dispatches work to Celery.
- Make sure the `worker` service is running: `docker compose up -d worker`.

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

Celery + Redis:
- `CELERY_BROKER_URL` and `CELERY_RESULT_BACKEND` must point to Redis.
- Redis must be running for background jobs (invoice emails, webhook processing).

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
docker compose exec frontend npm test
```

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
- CSV import for clubs and members with mapping + preview
- GDPR endpoints: consent, data export, data delete
- i18n scaffolding (English + Luxembourgish)

## Contributing

- Use conventional commits: `feat:`, `fix:`, `docs:`, `chore:`

## Troubleshooting

- **Missing `.env`**: Create it from `.env.example` and ensure values are set.
- **Port conflicts**: Stop services using ports 3000/8000/5432/6379 or change ports in `docker-compose.yml`.
- **CORS errors**: Use the same host for frontend/backed (`localhost` or `127.0.0.1`) and align `FRONTEND_BASE_URL` + `NEXT_PUBLIC_API_URL`.
- **Debug log mount**: Docker mounts `.cursor/` into backend/worker for runtime debug logs. Keep it unless you remove debug logging.
- **Database not ready**: Wait for `docker compose ps` to show healthy, or restart with `docker compose restart db`.
- **Stuck migrations**: `docker compose down -v` to reset volumes (data loss), then `docker compose up --build`.
- **makemigrations permission denied in Docker**: run `python backend/manage.py makemigrations` locally or add the migration file in the repo, then run `docker compose exec backend python manage.py migrate`.