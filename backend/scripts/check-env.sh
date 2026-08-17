#!/usr/bin/env sh
# Validate required env vars for backend/worker/beat (e.g. DJANGO_SECRET_KEY).
# Exit 1 if unset; warn if still default "change-me".
set -e
if [ -z "${DJANGO_SECRET_KEY}" ]; then
  echo "Error: DJANGO_SECRET_KEY is not set."
  exit 1
fi
if [ "${DJANGO_SECRET_KEY}" = "change-me" ]; then
  echo "Warning: DJANGO_SECRET_KEY is still the default 'change-me'. Set a strong secret in production."
fi
