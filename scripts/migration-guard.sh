#!/usr/bin/env bash
set -euo pipefail

COMPOSE="${COMPOSE:-docker compose}"

echo "==> Checking for missing migration files"
$COMPOSE exec -T backend python manage.py makemigrations --check --dry-run

echo "==> Applying migrations"
$COMPOSE exec -T backend python manage.py migrate --noinput

echo "==> Ensuring there are no unapplied migrations"
$COMPOSE exec -T backend python manage.py migrate --check

echo "==> Running Django system checks"
$COMPOSE exec -T backend python manage.py check

echo "Migration guard passed."
