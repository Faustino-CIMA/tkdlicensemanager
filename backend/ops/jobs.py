from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from licenses.models import ClubFeeBillingSchedule, PrintJob
from licenses.tasks import execute_print_job_task


def _safe_inspect():
    try:
        from config.celery import app

        inspector = app.control.inspect(timeout=2)
        return {
            "ping": inspector.ping() or {},
            "active": inspector.active() or {},
            "reserved": inspector.reserved() or {},
            "scheduled": inspector.scheduled() or {},
            "stats": inspector.stats() or {},
        }
    except Exception as exc:
        return {"error": str(exc)[:300]}


def collect_jobs() -> dict:
    cutoff = timezone.now() - timedelta(minutes=30)
    stuck = list(
        PrintJob.objects.filter(
            status__in=[PrintJob.Status.QUEUED, PrintJob.Status.RUNNING],
            updated_at__lt=cutoff,
        )
        .values("id", "job_number", "club_id", "status", "queued_at", "started_at", "updated_at", "error_detail")
        .order_by("updated_at")[:100]
    )
    failed_prints = list(
        PrintJob.objects.filter(status=PrintJob.Status.FAILED)
        .values("id", "job_number", "club_id", "status", "finished_at", "error_detail")
        .order_by("-finished_at")[:50]
    )
    schedules = list(
        ClubFeeBillingSchedule.objects.filter(is_active=True)
        .values(
            "id",
            "fee_type_id",
            "recurrence",
            "next_run_on",
            "last_run_on",
            "end_on",
            "all_active_clubs",
            "is_active",
        )
        .order_by("next_run_on")[:100]
    )
    return {
        "celery": _safe_inspect(),
        "stuck_print_jobs": stuck,
        "failed_print_jobs": failed_prints,
        "billing_schedules": schedules,
        "generated_at": timezone.now().isoformat(),
    }


def retry_print_job(print_job_id: int, actor_id: int | None = None) -> dict:
    job = PrintJob.objects.filter(pk=print_job_id).first()
    if job is None:
        raise ValueError("Print job not found.")
    execute_print_job_task.delay(print_job_id, actor_id)
    return {"id": job.id, "job_number": job.job_number, "queued": True}
