.PHONY: test test-backend test-quick test-quick-local test-licenses test-accounts test-members migrate makemigrations healthcheck healthcheck-backend healthcheck-worker

COMPOSE ?= docker compose

test: test-backend

test-backend:
	$(COMPOSE) exec backend python manage.py test

healthcheck: healthcheck-backend healthcheck-worker

healthcheck-backend:
	$(COMPOSE) exec backend python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health/')"

healthcheck-worker:
	$(COMPOSE) exec worker celery -A config inspect ping

test-quick:
	$(COMPOSE) exec backend python manage.py test accounts members licenses

test-quick-local:
	python backend/manage.py test accounts members licenses

test-licenses:
	$(COMPOSE) exec backend python manage.py test licenses

test-accounts:
	$(COMPOSE) exec backend python manage.py test accounts

test-members:
	$(COMPOSE) exec backend python manage.py test members

migrate:
	$(COMPOSE) exec backend python manage.py migrate

makemigrations:
	python backend/manage.py makemigrations
