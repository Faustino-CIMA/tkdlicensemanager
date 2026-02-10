from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from .models import GradePromotionHistory, Member


def add_grade_promotion(
    member: Member,
    *,
    to_grade: str,
    actor=None,
    promotion_date=None,
    exam_date=None,
    proof_ref: str = "",
    notes: str = "",
    metadata: dict[str, Any] | None = None,
    from_grade: str | None = None,
    sync_member: bool = True,
) -> GradePromotionHistory:
    normalized_grade = str(to_grade or "").strip()
    if not normalized_grade:
        raise ValidationError("to_grade is required.")

    current_grade = str(member.belt_rank or "").strip()
    source_grade = current_grade if from_grade is None else str(from_grade).strip()
    if source_grade == normalized_grade:
        raise ValidationError("to_grade must differ from current grade.")

    with transaction.atomic():
        history_record = GradePromotionHistory.objects.create(
            member=member,
            club=member.club,
            examiner_user=actor if actor and actor.is_authenticated else None,
            from_grade=source_grade,
            to_grade=normalized_grade,
            promotion_date=promotion_date or timezone.localdate(),
            exam_date=exam_date,
            proof_ref=proof_ref,
            notes=notes,
            metadata=metadata or {},
        )

        if sync_member and member.belt_rank != normalized_grade:
            member.belt_rank = normalized_grade
            member.save(update_fields=["belt_rank", "updated_at"])

    return history_record
