# LTF License Manager

Modern, secure Taekwondo license management for the Luxembourg Taekwondo Federation (LTF).

## Prerequisites

- Docker + Docker Compose
- Git

Optional for local (non-Docker) development:
- Python 3.12+
- Node 20+

## Quick Start (Docker-first)

1. Copy env template and adjust if needed:

```
cp .env.example .env
```

2. Build and start all services:

```
docker compose up --build
```

3. Apply migrations:

```
docker compose exec backend python manage.py migrate
```

4. Create Django superuser (admin login):

```
docker compose exec backend python manage.py createsuperuser
```

5. Open:
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

## Tests

Backend:

```
docker compose exec backend python manage.py test
```

Frontend:

```
docker compose exec frontend npm test
```

## MVP Features (current)

- Role-based authentication (NMA admin, club admin, coach, member)
- Core models: Club, Member, License
- GDPR endpoints: consent, data export, data delete
- i18n scaffolding (English + Luxembourgish)

## Contributing

- Use conventional commits: `feat:`, `fix:`, `docs:`, `chore:`