# License Card Rollout and Rollback Checklists

Use this checklist for production rollout of the License Card v2 feature set (dual-side template designer, simulation previews, print jobs, quick print, history).

## Rollout Checklist

- [ ] Confirm branch and revision are correct (`git rev-parse --short HEAD`).
- [ ] Confirm containers are healthy (`docker compose ps`).
- [ ] Apply migrations (`docker compose exec backend python manage.py migrate`).
- [ ] Recreate backend and worker so runtime processes load latest code and queue args:
  - `docker compose up -d --force-recreate backend worker`
- [ ] Verify backend health (`curl -fsS http://localhost:8000/api/health/`).
- [ ] Verify frontend health (`curl -fsS http://localhost:3000/ >/dev/null`).
- [ ] Verify API schema includes print-job and preview contracts (`curl -fsS http://localhost:8000/api/schema/`).
- [ ] Verify schema includes v2 dual-side/simulation contracts:
  - `/api/card-template-versions/{id}/preview-data/` with `side`
  - `/api/card-template-versions/{id}/preview-card-html/`
  - `/api/print-jobs/{id}/history/`
- [ ] Verify worker subscribes to print queue (`docker compose top worker` should include `-Q celery,print_jobs`).
- [ ] Run backend verification:
  - `docker compose exec backend python manage.py check`
  - `docker compose exec backend python manage.py test --keepdb --noinput licenses.test_cards`
- [ ] Run frontend verification:
  - `docker compose exec frontend npm run lint`
  - `docker compose exec frontend npm run build`
- [ ] Execute smoke print flow:
  - create draft print job
  - execute job
  - download PDF
  - open print-job history
- [ ] Execute designer v2 smoke:
  - create/update draft with `sides.front` and `sides.back`
  - publish and re-open to verify both sides are preserved
  - run front/back preview-data and front/back live simulation HTML
- [ ] Execute high-volume smoke (>= 50 cards) and confirm terminal `succeeded`.
- [ ] Monitor logs for 15 minutes:
  - `docker compose logs --since=15m backend worker`
- [ ] Confirm no P0/P1 incidents and approve GO.

## Rollback Checklist

- [ ] Record current revision for postmortem (`git rev-parse --short HEAD`).
- [ ] Switch to last known-good revision (`git checkout <known-good-sha>`).
- [ ] Rebuild/recreate app services:
  - `docker compose up -d --build --force-recreate backend frontend worker beat`
- [ ] Re-run health checks:
  - `curl -fsS http://localhost:8000/api/health/`
  - `curl -fsS http://localhost:3000/ >/dev/null`
- [ ] Validate worker queue binding (`docker compose top worker` includes `-Q celery,print_jobs`).
- [ ] Run backend sanity checks:
  - `docker compose exec backend python manage.py check`
  - `docker compose exec backend python manage.py test --keepdb --noinput licenses.test_cards.PrintJobExecutionPipelineTests`
- [ ] Run dual-side sanity checks:
  - `docker compose exec backend python manage.py test --keepdb --noinput licenses.test_cards.LicenseCardDesignerV2FoundationApiTests`
  - `docker compose exec backend python manage.py test --keepdb --noinput licenses.test_cards.LicenseCardPreviewApiTests`
- [ ] Validate print-job create/execute/download on a small sample.
- [ ] Announce rollback completion with reason, timestamp, and restored revision.

## Data Safety Notes

- Print job artifacts are retained unless pruned.
- Use artifact pruning only with explicit retention policy:
  - Dry run: `docker compose exec backend python manage.py prune_print_job_artifacts --days 30 --dry-run`
  - Apply: `docker compose exec backend python manage.py prune_print_job_artifacts --days 30`
