from __future__ import annotations

from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from licenses.models import FinanceAuditLog, PrintJob


class Command(BaseCommand):
    help = "Prune old print-job PDF artifacts while preserving job metadata and audit trail."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=30,
            help="Delete artifacts for jobs finished more than N days ago.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report candidates without deleting files.",
        )

    def handle(self, *args, **options):
        days = int(options["days"])
        dry_run = bool(options["dry_run"])
        if days < 1:
            raise CommandError("--days must be >= 1.")

        cutoff = timezone.now() - timedelta(days=days)
        candidates = (
            PrintJob.objects.select_related("club")
            .filter(
                finished_at__lt=cutoff,
                artifact_size_bytes__gt=0,
            )
            .exclude(artifact_pdf="")
            .order_by("id")
        )

        total_count = 0
        total_size_bytes = 0
        pruned_count = 0
        pruned_size_bytes = 0

        for print_job in candidates.iterator():
            total_count += 1
            artifact_size = int(print_job.artifact_size_bytes or 0)
            total_size_bytes += artifact_size

            if dry_run:
                self.stdout.write(
                    f"[dry-run] job={print_job.job_number} id={print_job.id} "
                    f"size_bytes={artifact_size} finished_at={print_job.finished_at.isoformat()}"
                )
                continue

            with transaction.atomic():
                locked_job = PrintJob.objects.select_for_update().select_related("club").get(id=print_job.id)
                if not locked_job.artifact_pdf or not locked_job.artifact_size_bytes:
                    continue
                current_artifact_size = int(locked_job.artifact_size_bytes or 0)
                locked_job.artifact_pdf.delete(save=False)
                locked_job.artifact_pdf = ""
                locked_job.artifact_size_bytes = 0
                locked_job.artifact_sha256 = ""
                locked_job.execution_metadata = {
                    **dict(locked_job.execution_metadata or {}),
                    "artifact_pruned_at": timezone.now().isoformat(),
                    "artifact_pruned_days_threshold": days,
                }
                locked_job.save(
                    update_fields=[
                        "artifact_pdf",
                        "artifact_size_bytes",
                        "artifact_sha256",
                        "execution_metadata",
                        "updated_at",
                    ]
                )
                FinanceAuditLog.objects.create(
                    action="print_job.artifact_pruned",
                    message="Print job PDF artifact pruned.",
                    actor=None,
                    club=locked_job.club,
                    metadata={
                        "print_job_id": locked_job.id,
                        "days_threshold": days,
                        "artifact_size_bytes": current_artifact_size,
                    },
                )
                pruned_count += 1
                pruned_size_bytes += current_artifact_size

        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f"Dry run complete: {total_count} candidate(s), {total_size_bytes} total bytes."
                )
            )
            return

        self.stdout.write(
            self.style.SUCCESS(
                f"Pruned {pruned_count} artifact(s) freeing {pruned_size_bytes} bytes "
                f"(scanned {total_count} candidate(s))."
            )
        )
