from __future__ import annotations

from collections import defaultdict
from hashlib import sha256
import time
from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from .card_rendering import (
    CardRenderError,
    build_preview_data,
    build_sheet_slots,
    render_card_fragment_html,
    render_pdf_bytes_from_html,
)
from .models import FinanceAuditLog, PrintJob, PrintJobItem

UserModel = get_user_model()


def _audit_print_job(
    *,
    print_job: PrintJob,
    action: str,
    message: str,
    actor,
    metadata: dict[str, Any] | None = None,
) -> None:
    metadata_payload = {"print_job_id": print_job.id, **(metadata or {})}
    FinanceAuditLog.objects.create(
        action=f"print_job.{action}",
        message=message,
        actor=actor,
        club=print_job.club,
        metadata=metadata_payload,
    )


def _is_print_job_cancelled(print_job_id: int) -> bool:
    return PrintJob.objects.filter(id=print_job_id, status=PrintJob.Status.CANCELLED).exists()


def _raise_if_cancelled(print_job_id: int) -> None:
    if _is_print_job_cancelled(print_job_id):
        raise CardRenderError("Print job execution was cancelled.")


def _render_card_pages_html(preview_payloads: list[dict[str, Any]]) -> tuple[str, int]:
    if not preview_payloads:
        raise CardRenderError("Print job has no resolved preview payloads.")
    first_card_format = preview_payloads[0]["card_format"]
    width_mm = str(first_card_format["width_mm"])
    height_mm = str(first_card_format["height_mm"])

    pages_markup: list[str] = []
    for preview_payload in preview_payloads:
        card_format = preview_payload["card_format"]
        if str(card_format["width_mm"]) != width_mm or str(card_format["height_mm"]) != height_mm:
            raise CardRenderError("All print job items must share the same card dimensions.")
        pages_markup.append(
            '<div class="print-page">'
            f"{render_card_fragment_html(preview_payload)}"
            "</div>"
        )

    html = (
        "<!doctype html>"
        "<html><head><meta charset='utf-8'>"
        "<style>"
        f"@page {{ size: {width_mm}mm {height_mm}mm; margin: 0; }}"
        "html,body{margin:0;padding:0;}"
        "body{font-family:Inter,Arial,sans-serif;}"
        ".print-page{page-break-after:always;}"
        ".print-page:last-child{page-break-after:auto;}"
        "</style>"
        "</head><body>"
        f"{''.join(pages_markup)}"
        "</body></html>"
    )
    return html, len(pages_markup)


def _render_sheet_pages_html(
    *,
    print_job: PrintJob,
    preview_payloads: list[dict[str, Any]],
    ordered_items: list[PrintJobItem],
) -> tuple[str, int]:
    paper_profile = print_job.paper_profile
    if paper_profile is None:
        raise CardRenderError("Sheet rendering requires a paper profile.")
    if not preview_payloads:
        raise CardRenderError("Print job has no resolved preview payloads.")

    slot_layout, _ = build_sheet_slots(
        paper_profile=paper_profile,
        selected_slots=print_job.selected_slots or None,
    )
    slot_positions = {
        int(slot["slot_index"]): {
            "x_mm": str(slot["x_mm"]),
            "y_mm": str(slot["y_mm"]),
            "width_mm": str(slot["width_mm"]),
            "height_mm": str(slot["height_mm"]),
        }
        for slot in slot_layout
    }
    slot_count = int(paper_profile.slot_count)
    if slot_count <= 0:
        raise CardRenderError("Paper profile slot_count must be positive.")

    selected_slots = [int(slot) for slot in (print_job.selected_slots or [])]
    selected_set = set(selected_slots)
    page_slot_fragments: dict[int, dict[int, str]] = defaultdict(dict)
    for item, preview_payload in zip(ordered_items, preview_payloads):
        if item.slot_index is None:
            raise CardRenderError("Print job item is missing slot_index.")
        global_slot = int(item.slot_index)
        if selected_slots:
            if global_slot not in selected_set:
                raise CardRenderError(
                    f"Print job item slot {global_slot} is outside selected_slots."
                )
            page_index = 0
            local_slot = global_slot
        else:
            if global_slot < 0:
                raise CardRenderError("Print job item slot_index must be >= 0.")
            page_index = global_slot // slot_count
            local_slot = global_slot % slot_count
        page_slot_fragments[page_index][local_slot] = render_card_fragment_html(preview_payload)

    page_indexes = sorted(page_slot_fragments.keys())
    if not page_indexes:
        raise CardRenderError("No printable pages were produced for this print job.")

    slot_indices_to_draw = selected_slots if selected_slots else list(range(slot_count))
    page_markup: list[str] = []
    for page_index in page_indexes:
        page_items = page_slot_fragments[page_index]
        slots_markup: list[str] = []
        for slot_index in slot_indices_to_draw:
            position = slot_positions.get(slot_index)
            if position is None:
                raise CardRenderError(f"Slot index {slot_index} is unavailable in paper profile.")
            card_fragment = page_items.get(slot_index, "")
            slots_markup.append(
                "<div "
                "style=\"position:absolute;box-sizing:border-box;"
                f"left:{position['x_mm']}mm;top:{position['y_mm']}mm;"
                f"width:{position['width_mm']}mm;height:{position['height_mm']}mm;\">"
                f"{card_fragment}</div>"
            )
        page_markup.append(
            '<div class="print-page">'
            f"<div style=\"position:relative;width:{paper_profile.sheet_width_mm}mm;"
            f"height:{paper_profile.sheet_height_mm}mm;overflow:hidden;box-sizing:border-box;\">"
            f"{''.join(slots_markup)}"
            "</div>"
            "</div>"
        )

    html = (
        "<!doctype html>"
        "<html><head><meta charset='utf-8'>"
        "<style>"
        f"@page {{ size: {paper_profile.sheet_width_mm}mm {paper_profile.sheet_height_mm}mm; margin: 0; }}"
        "html,body{margin:0;padding:0;}"
        "body{font-family:Inter,Arial,sans-serif;}"
        ".print-page{page-break-after:always;}"
        ".print-page:last-child{page-break-after:auto;}"
        "</style>"
        "</head><body>"
        f"{''.join(page_markup)}"
        "</body></html>"
    )
    return html, len(page_markup)


def _resolve_item_slots(print_job: PrintJob, ordered_items: list[PrintJobItem]) -> None:
    selected_slots = [int(slot) for slot in (print_job.selected_slots or [])]
    if len(set(selected_slots)) != len(selected_slots):
        raise CardRenderError("selected_slots must not contain duplicates.")
    if print_job.paper_profile is None and selected_slots:
        raise CardRenderError("selected_slots requires a paper profile.")

    if print_job.paper_profile is not None:
        slot_count = int(print_job.paper_profile.slot_count)
        invalid_slots = [slot for slot in selected_slots if slot < 0 or slot >= slot_count]
        if invalid_slots:
            raise CardRenderError(
                "selected_slots contains out-of-range index(es): "
                + ", ".join(str(slot) for slot in invalid_slots)
            )

    if selected_slots and len(ordered_items) > len(selected_slots):
        raise CardRenderError("Not enough selected slots for all print job items.")

    for index, item in enumerate(ordered_items):
        if item.member_id and item.member and item.member.club_id != print_job.club_id:
            raise CardRenderError(f"Member {item.member_id} does not belong to print job club.")
        if item.license_id and item.license and item.license.club_id != print_job.club_id:
            raise CardRenderError(f"License {item.license_id} does not belong to print job club.")
        if item.license_id and item.member_id and item.license and item.license.member_id != item.member_id:
            raise CardRenderError(f"License {item.license_id} does not match item member.")

        expected_slot = selected_slots[index] if selected_slots else index
        if item.slot_index != expected_slot:
            item.slot_index = expected_slot
            item.save(update_fields=["slot_index", "updated_at"])


def execute_print_job_now(*, print_job_id: int, actor_id: int | None = None) -> PrintJob:
    actor = UserModel.objects.filter(id=actor_id).first() if actor_id else None
    attempt_started_monotonic = time.monotonic()
    attempt_started_at = timezone.now()

    with transaction.atomic():
        print_job = PrintJob.objects.select_for_update().get(id=print_job_id)
        if print_job.status == PrintJob.Status.CANCELLED:
            return print_job
        if print_job.status == PrintJob.Status.SUCCEEDED and print_job.artifact_pdf:
            return print_job

        print_job.status = PrintJob.Status.RUNNING
        print_job.started_at = print_job.started_at or timezone.now()
        print_job.finished_at = None
        print_job.cancelled_at = None
        print_job.error_detail = ""
        print_job.last_error_at = None
        print_job.execution_attempts = int(print_job.execution_attempts) + 1
        if actor and print_job.executed_by_id is None:
            print_job.executed_by = actor
        queue_wait_ms = None
        if print_job.queued_at is not None:
            queue_wait_ms = int(
                max(0.0, (attempt_started_at - print_job.queued_at).total_seconds()) * 1000
            )
        print_job.execution_metadata = {
            **dict(print_job.execution_metadata or {}),
            "last_attempt_started_at": attempt_started_at.isoformat(),
            "last_attempt_status": "running",
            "queue_wait_ms": queue_wait_ms,
            "execution_attempt": int(print_job.execution_attempts),
        }
        print_job.save(
            update_fields=[
                "status",
                "started_at",
                "finished_at",
                "cancelled_at",
                "error_detail",
                "last_error_at",
                "execution_attempts",
                "executed_by",
                "execution_metadata",
                "updated_at",
            ]
        )
        print_job.items.update(status=PrintJobItem.Status.PENDING)
        _audit_print_job(
            print_job=print_job,
            action="running",
            message="Print job execution started.",
            actor=actor,
            metadata={"execution_attempt": int(print_job.execution_attempts)},
        )

    try:
        print_job = (
            PrintJob.objects.select_related("club", "template_version", "template_version__card_format", "paper_profile")
            .prefetch_related("items__member", "items__license")
            .get(id=print_job_id)
        )
        ordered_items = list(
            print_job.items.select_related("member", "license").order_by("id")
        )
        if not ordered_items:
            raise CardRenderError("Print job has no items to render.")

        _resolve_item_slots(print_job, ordered_items)
        preview_payloads: list[dict[str, Any]] = []
        for item in sorted(ordered_items, key=lambda current: (int(current.slot_index or 0), current.id)):
            _raise_if_cancelled(print_job_id)
            preview_payloads.append(
                build_preview_data(
                    template_version=print_job.template_version,
                    member_id=item.member_id,
                    license_id=item.license_id,
                    club_id=print_job.club_id,
                    include_bleed_guide=bool(print_job.include_bleed_guide),
                    include_safe_area_guide=bool(print_job.include_safe_area_guide),
                    bleed_mm=print_job.bleed_mm,
                    safe_area_mm=print_job.safe_area_mm,
                )
            )

        _raise_if_cancelled(print_job_id)
        if print_job.paper_profile is None:
            html, page_count = _render_card_pages_html(preview_payloads)
        else:
            html, page_count = _render_sheet_pages_html(
                print_job=print_job,
                preview_payloads=preview_payloads,
                ordered_items=sorted(
                    ordered_items, key=lambda current: (int(current.slot_index or 0), current.id)
                ),
            )
        _raise_if_cancelled(print_job_id)
        pdf_bytes = render_pdf_bytes_from_html(
            html,
            base_url=str(settings.FRONTEND_BASE_URL).rstrip("/") + "/",
        )
    except Exception as exc:
        detail = exc.detail if isinstance(exc, CardRenderError) else str(exc)
        failure_at = timezone.now()
        duration_ms = int(max(0.0, time.monotonic() - attempt_started_monotonic) * 1000)
        with transaction.atomic():
            print_job = PrintJob.objects.select_for_update().select_related("club").get(id=print_job_id)
            if print_job.status == PrintJob.Status.CANCELLED:
                return print_job
            print_job.status = PrintJob.Status.FAILED
            print_job.finished_at = failure_at
            print_job.error_detail = str(detail)[:4000]
            print_job.last_error_at = failure_at
            print_job.execution_metadata = {
                **dict(print_job.execution_metadata or {}),
                "last_attempt_finished_at": failure_at.isoformat(),
                "last_attempt_duration_ms": duration_ms,
                "last_attempt_status": "failed",
            }
            print_job.save(
                update_fields=[
                    "status",
                    "finished_at",
                    "error_detail",
                    "last_error_at",
                    "execution_metadata",
                    "updated_at",
                ]
            )
            print_job.items.update(status=PrintJobItem.Status.FAILED)
            _audit_print_job(
                print_job=print_job,
                action="failed",
                message="Print job execution failed.",
                actor=actor,
                metadata={"detail": str(detail)[:1000]},
            )
        return print_job

    with transaction.atomic():
        print_job = PrintJob.objects.select_for_update().select_related("club").get(id=print_job_id)
        if print_job.status == PrintJob.Status.CANCELLED:
            return print_job
        if print_job.status == PrintJob.Status.SUCCEEDED and print_job.artifact_pdf:
            return print_job

        completed_at = timezone.now()
        duration_ms = int(max(0.0, time.monotonic() - attempt_started_monotonic) * 1000)
        artifact_name = f"{print_job.job_number.lower()}-{timezone.now().strftime('%Y%m%d%H%M%S')}.pdf"
        if print_job.artifact_pdf:
            print_job.artifact_pdf.delete(save=False)
        print_job.artifact_pdf.save(artifact_name, ContentFile(pdf_bytes), save=False)
        print_job.artifact_size_bytes = len(pdf_bytes)
        print_job.artifact_sha256 = sha256(pdf_bytes).hexdigest()
        print_job.execution_metadata = {
            **dict(print_job.execution_metadata or {}),
            "rendered_items": len(preview_payloads),
            "page_count": page_count,
            "selected_slots": [int(slot) for slot in (print_job.selected_slots or [])],
            "completed_at": completed_at.isoformat(),
            "last_attempt_finished_at": completed_at.isoformat(),
            "last_attempt_duration_ms": duration_ms,
            "last_attempt_status": "succeeded",
        }
        print_job.status = PrintJob.Status.SUCCEEDED
        print_job.finished_at = completed_at
        print_job.error_detail = ""
        print_job.last_error_at = None
        print_job.save(
            update_fields=[
                "artifact_pdf",
                "artifact_size_bytes",
                "artifact_sha256",
                "execution_metadata",
                "status",
                "finished_at",
                "error_detail",
                "last_error_at",
                "updated_at",
            ]
        )
        print_job.items.update(status=PrintJobItem.Status.PRINTED)
        _audit_print_job(
            print_job=print_job,
            action="succeeded",
            message="Print job execution finished successfully.",
            actor=actor,
            metadata={
                "rendered_items": len(preview_payloads),
                "page_count": page_count,
                "artifact_size_bytes": len(pdf_bytes),
            },
        )
    return print_job
