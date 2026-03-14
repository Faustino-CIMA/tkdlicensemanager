#!/usr/bin/env sh
# Remove common build/cache artifacts (Python, Next.js, ESLint, etc.)
set -e
cd "$(dirname "$0")/.."
echo "Cleaning project caches and build artifacts..."
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find . -type f -name "*.pyc" -delete 2>/dev/null || true
find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
rm -rf backend/.pytest_cache 2>/dev/null || true
rm -rf frontend/.next 2>/dev/null || true
rm -rf frontend/.eslintcache 2>/dev/null || true
rm -rf frontend/out 2>/dev/null || true
echo "Done."
