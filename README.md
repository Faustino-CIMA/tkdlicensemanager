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

- Role-based authentication (NMA admin, club admin, coach, member)
- Core models: Club, Member, License
- GDPR endpoints: consent, data export, data delete
- i18n scaffolding (English + Luxembourgish)

## Contributing

- Use conventional commits: `feat:`, `fix:`, `docs:`, `chore:`

## Troubleshooting

- **Missing `.env`**: Create it from `.env.example` and ensure values are set.
- **Port conflicts**: Stop services using ports 3000/8000/5432/6379 or change ports in `docker-compose.yml`.
- **CORS errors**: Use the same host for frontend/backed (`localhost` or `127.0.0.1`) and align `FRONTEND_BASE_URL` + `NEXT_PUBLIC_API_URL`.
- **Database not ready**: Wait for `docker compose ps` to show healthy, or restart with `docker compose restart db`.
- **Stuck migrations**: `docker compose down -v` to reset volumes (data loss), then `docker compose up --build`.