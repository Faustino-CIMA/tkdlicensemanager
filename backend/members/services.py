from __future__ import annotations

from io import BytesIO
from pathlib import Path
import re
from typing import Any
from uuid import uuid4

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.db import OperationalError, ProgrammingError, transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from PIL import Image, ImageOps, UnidentifiedImageError

from .models import GradePromotionHistory, Member, MemberLicenseIdCounter

MIN_PRINT_WIDTH = 945
MIN_PRINT_HEIGHT = 1181
THUMBNAIL_WIDTH = 240
THUMBNAIL_HEIGHT = 300

ALLOWED_ORIGINAL_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif"}
ALLOWED_ORIGINAL_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/heic",
    "image/heif",
}
ALLOWED_PROCESSED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
ALLOWED_PROCESSED_CONTENT_TYPES = {"image/jpeg", "image/png"}


def add_grade_promotion(
    member: Member,
    *,
    to_grade: str,
    actor=None,
    promotion_date=None,
    exam_date=None,
    proof_ref: str = "",
    notes: str = "",
    created_by: str = "",
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
            created_by=str(created_by or "").strip(),
            metadata=metadata or {},
        )

        if sync_member and member.belt_rank != normalized_grade:
            member.belt_rank = normalized_grade
            member.save(update_fields=["belt_rank", "updated_at"])

    return history_record


def update_grade_promotion(
    history_record: GradePromotionHistory,
    *,
    to_grade: str | None = None,
    promotion_date=None,
    exam_date=None,
    proof_ref: str | None = None,
    notes: str | None = None,
    created_by: str | None = None,
    metadata: dict[str, Any] | None = None,
    sync_member: bool = True,
) -> GradePromotionHistory:
    normalized_grade = (
        str(to_grade).strip() if to_grade is not None else str(history_record.to_grade or "").strip()
    )
    if not normalized_grade:
        raise ValidationError("to_grade is required.")

    with transaction.atomic():
        if to_grade is not None:
            history_record.to_grade = normalized_grade
        if promotion_date is not None:
            history_record.promotion_date = promotion_date
        if exam_date is not None:
            history_record.exam_date = exam_date
        if proof_ref is not None:
            history_record.proof_ref = proof_ref
        if notes is not None:
            history_record.notes = notes
        if created_by is not None:
            history_record.created_by = str(created_by).strip()
        if metadata is not None:
            history_record.metadata = metadata

        history_record.full_clean()
        history_record.save()

        if sync_member:
            member = history_record.member
            latest = (
                GradePromotionHistory.objects.filter(member=member)
                .order_by("-promotion_date", "-created_at")
                .first()
            )
            if latest and latest.id == history_record.id and member.belt_rank != normalized_grade:
                member.belt_rank = normalized_grade
                member.save(update_fields=["belt_rank", "updated_at"])

    return history_record


def delete_grade_promotion(
    history_record: GradePromotionHistory,
    *,
    sync_member: bool = True,
) -> None:
    member = history_record.member
    with transaction.atomic():
        # QuerySet.delete() bypasses the append-only model.delete() guard so
        # club staff can correct mistaken grade entries from the Grades UI.
        GradePromotionHistory.objects.filter(pk=history_record.pk).delete()
        if sync_member:
            latest = (
                GradePromotionHistory.objects.filter(member=member)
                .order_by("-promotion_date", "-created_at")
                .first()
            )
            next_rank = str(latest.to_grade or "").strip() if latest else ""
            if member.belt_rank != next_rank:
                member.belt_rank = next_rank
                member.save(update_fields=["belt_rank", "updated_at"])


def _validate_upload_basics(
    uploaded_file,
    *,
    allowed_extensions: set[str],
    allowed_content_types: set[str],
    max_size_bytes: int,
    field_label: str,
) -> None:
    if not uploaded_file:
        raise ValidationError(_("%(field)s is required.") % {"field": field_label})

    file_name = str(getattr(uploaded_file, "name", "") or "")
    extension = Path(file_name).suffix.lower()
    if extension not in allowed_extensions:
        allowed = ", ".join(sorted(allowed_extensions))
        raise ValidationError(
            _("%(field)s extension is not supported. Allowed: %(allowed)s")
            % {"field": field_label, "allowed": allowed}
        )

    content_type = str(getattr(uploaded_file, "content_type", "") or "").lower()
    if content_type and content_type not in allowed_content_types:
        allowed_types = ", ".join(sorted(allowed_content_types))
        raise ValidationError(
            _("%(field)s content type is not supported. Allowed: %(allowed)s")
            % {"field": field_label, "allowed": allowed_types}
        )

    file_size = int(getattr(uploaded_file, "size", 0) or 0)
    if file_size <= 0:
        raise ValidationError(_("%(field)s is empty.") % {"field": field_label})
    if file_size > max_size_bytes:
        raise ValidationError(
            _("%(field)s exceeds max upload size of %(size)s bytes.")
            % {"field": field_label, "size": max_size_bytes}
        )


def _open_processed_image(processed_image):
    try:
        if hasattr(processed_image, "seek"):
            processed_image.seek(0)
        with Image.open(processed_image) as img:
            normalized = ImageOps.exif_transpose(img)
            if normalized.mode not in {"RGB", "RGBA"}:
                normalized = normalized.convert("RGB")
            return normalized.copy()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValidationError(_("Processed image is not a valid JPEG/PNG file.")) from exc


def _to_original_content_file(original_image) -> ContentFile:
    if hasattr(original_image, "seek"):
        original_image.seek(0)
    file_bytes = original_image.read()
    if not file_bytes:
        raise ValidationError(_("Original image payload is empty."))
    extension = Path(str(getattr(original_image, "name", "") or "")).suffix.lower() or ".jpg"
    generated_name = f"{uuid4().hex}{extension}"
    return ContentFile(file_bytes, name=generated_name)


def _save_jpeg_with_optimize_fallback(
    image: Image.Image, target_stream: BytesIO, *, quality: int
) -> None:
    try:
        image.save(target_stream, format="JPEG", quality=quality, optimize=True)
    except OSError:
        # Some encoders/images can fail when optimize=True; retry without optimization.
        target_stream.seek(0)
        target_stream.truncate(0)
        image.save(target_stream, format="JPEG", quality=quality, optimize=False)


def _render_processed_outputs(processed_image) -> tuple[ContentFile, ContentFile, dict[str, int]]:
    image = _open_processed_image(processed_image)
    width, height = image.size
    if width < MIN_PRINT_WIDTH or height < MIN_PRINT_HEIGHT:
        raise ValidationError(
            _(
                "Processed image resolution is too small. Minimum is %(width)sx%(height)s px."
            )
            % {"width": MIN_PRINT_WIDTH, "height": MIN_PRINT_HEIGHT}
        )

    if image.mode == "RGBA":
        flattened = Image.new("RGB", image.size, (255, 255, 255))
        flattened.paste(image, mask=image.split()[3])
        image = flattened
    elif image.mode != "RGB":
        image = image.convert("RGB")

    processed_stream = BytesIO()
    _save_jpeg_with_optimize_fallback(image, processed_stream, quality=92)
    processed_stream.seek(0)
    processed_content = ContentFile(
        processed_stream.getvalue(), name=f"{uuid4().hex}.jpg"
    )

    thumbnail = ImageOps.fit(
        image,
        (THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )
    thumbnail_stream = BytesIO()
    _save_jpeg_with_optimize_fallback(thumbnail, thumbnail_stream, quality=88)
    thumbnail_stream.seek(0)
    thumbnail_content = ContentFile(
        thumbnail_stream.getvalue(), name=f"{uuid4().hex}.jpg"
    )

    details = {
        "processed_width": width,
        "processed_height": height,
        "thumbnail_width": THUMBNAIL_WIDTH,
        "thumbnail_height": THUMBNAIL_HEIGHT,
    }
    return processed_content, thumbnail_content, details


def process_member_profile_picture(
    member: Member,
    *,
    processed_image,
    original_image=None,
    photo_edit_metadata: dict[str, Any] | None = None,
    actor=None,
) -> Member:
    max_size_bytes = int(getattr(settings, "FILE_UPLOAD_MAX_MEMORY_SIZE", 10 * 1024 * 1024))
    _validate_upload_basics(
        processed_image,
        allowed_extensions=ALLOWED_PROCESSED_EXTENSIONS,
        allowed_content_types=ALLOWED_PROCESSED_CONTENT_TYPES,
        max_size_bytes=max_size_bytes,
        field_label="processed_image",
    )
    if original_image is not None:
        _validate_upload_basics(
            original_image,
            allowed_extensions=ALLOWED_ORIGINAL_EXTENSIONS,
            allowed_content_types=ALLOWED_ORIGINAL_CONTENT_TYPES,
            max_size_bytes=max_size_bytes,
            field_label="original_image",
        )

    try:
        processed_content, thumbnail_content, processed_details = _render_processed_outputs(
            processed_image
        )
        original_source = original_image or processed_image
        original_content = _to_original_content_file(original_source)
    except OSError as exc:
        raise ValidationError(_("Unable to process uploaded image data.")) from exc

    metadata = {
        **(photo_edit_metadata or {}),
        **processed_details,
    }

    with transaction.atomic():
        if member.profile_picture_original:
            try:
                member.profile_picture_original.delete(save=False)
            except OSError:
                pass
        if member.profile_picture_processed:
            try:
                member.profile_picture_processed.delete(save=False)
            except OSError:
                pass
        if member.profile_picture_thumbnail:
            try:
                member.profile_picture_thumbnail.delete(save=False)
            except OSError:
                pass

        # Processed image is required for the feature to work.
        try:
            member.profile_picture_processed.save(
                processed_content.name, processed_content, save=False
            )
        except OSError as exc:
            raise ValidationError(
                _("Unable to store profile picture in server media storage.")
            ) from exc

        # Original and thumbnail are best-effort enhancements.
        try:
            member.profile_picture_original.save(original_content.name, original_content, save=False)
        except OSError:
            member.profile_picture_original = None
            metadata["original_storage_skipped"] = True
        try:
            member.profile_picture_thumbnail.save(
                thumbnail_content.name, thumbnail_content, save=False
            )
        except OSError:
            member.profile_picture_thumbnail = None
            metadata["thumbnail_storage_skipped"] = True

        member.photo_edit_metadata = metadata
        member.photo_consent_attested_at = timezone.now()
        member.photo_consent_attested_by = actor if actor and actor.is_authenticated else None
        member.save(
            update_fields=[
                "profile_picture_original",
                "profile_picture_processed",
                "profile_picture_thumbnail",
                "photo_edit_metadata",
                "photo_consent_attested_at",
                "photo_consent_attested_by",
                "updated_at",
            ]
        )
    return member


def clear_member_profile_picture(
    member: Member, *, clear_consent_attestation: bool = False
) -> Member:
    if member.profile_picture_original:
        member.profile_picture_original.delete(save=False)
    if member.profile_picture_processed:
        member.profile_picture_processed.delete(save=False)
    if member.profile_picture_thumbnail:
        member.profile_picture_thumbnail.delete(save=False)

    member.profile_picture_original = None
    member.profile_picture_processed = None
    member.profile_picture_thumbnail = None
    member.photo_edit_metadata = {}
    if clear_consent_attestation:
        member.photo_consent_attested_at = None
        member.photo_consent_attested_by = None

    update_fields = [
        "profile_picture_original",
        "profile_picture_processed",
        "profile_picture_thumbnail",
        "photo_edit_metadata",
        "updated_at",
    ]
    if clear_consent_attestation:
        update_fields.extend(["photo_consent_attested_at", "photo_consent_attested_by"])
    member.save(update_fields=update_fields)
    return member


LTF_LICENSE_ID_MIN_DIGITS = 4


def format_ltf_license_id(*, prefix: str, serial: int) -> str:
    return f"{prefix}-{str(serial).zfill(LTF_LICENSE_ID_MIN_DIGITS)}"


def _used_ltf_license_serials(prefix: str) -> set[int]:
    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$")
    used: set[int] = set()
    for existing_value in (
        Member.objects.filter(ltf_licenseid__startswith=f"{prefix}-")
        .values_list("ltf_licenseid", flat=True)
        .iterator()
    ):
        normalized = str(existing_value or "").strip().upper()
        match = pattern.match(normalized)
        if match:
            used.add(int(match.group(1)))
    return used


def _next_available_ltf_license_id(*, prefix: str, start_value: int) -> tuple[str, int]:
    used_serials = _used_ltf_license_serials(prefix)
    next_value = max(int(start_value), 1)
    while next_value in used_serials:
        next_value += 1
    return format_ltf_license_id(prefix=prefix, serial=next_value), next_value


def generate_next_ltf_license_id(*, prefix: str) -> str:
    normalized_prefix = str(prefix or "").strip().upper()
    allowed_prefixes = {
        MemberLicenseIdCounter.Prefix.LTF,
        MemberLicenseIdCounter.Prefix.LUX,
    }
    if normalized_prefix not in allowed_prefixes:
        raise ValidationError(_("Invalid LTF license ID prefix."))

    try:
        with transaction.atomic():
            counter, _ = (
                MemberLicenseIdCounter.objects.select_for_update()
                .get_or_create(
                    prefix=normalized_prefix,
                    defaults={"next_value": 1},
                )
            )
            candidate, next_value = _next_available_ltf_license_id(
                prefix=normalized_prefix,
                start_value=int(counter.next_value),
            )
            counter.next_value = next_value + 1
            counter.save(update_fields=["next_value", "updated_at"])
        return candidate
    except (ProgrammingError, OperationalError):
        # Fallback for environments where the counter table migration is not yet applied.
        return _generate_next_ltf_license_id_without_counter(prefix=normalized_prefix)


def _generate_next_ltf_license_id_without_counter(*, prefix: str) -> str:
    candidate, _next_value = _next_available_ltf_license_id(prefix=prefix, start_value=1)
    return candidate


LTF_LICENSE_IMPORT_SOURCE_PREFIX = "LUX-"
LTF_LICENSE_IMPORT_TARGET_PREFIX = "LTF-"


def apply_ltf_license_id_import_prefix(value: str, *, enabled: bool) -> tuple[str, bool]:
    """Rewrite LUX- to LTF- on LTF license IDs only. WT IDs must not use this helper."""
    normalized = str(value or "").strip().upper()
    if not enabled or not normalized:
        return normalized, False
    if not normalized.startswith(LTF_LICENSE_IMPORT_SOURCE_PREFIX):
        return normalized, False
    rewritten = LTF_LICENSE_IMPORT_TARGET_PREFIX + normalized[len(LTF_LICENSE_IMPORT_SOURCE_PREFIX) :]
    return rewritten, rewritten != normalized


def is_ltf_license_prefix_rewrite_enabled() -> bool:
    from clubs.models import FederationProfile

    profile = FederationProfile.objects.filter(pk=1).first()
    return bool(profile and profile.rewrite_lux_prefix_on_member_import)


def ltf_license_prefix_rewrite_policy(*, rewritten_count: int = 0) -> dict[str, Any]:
    return {
        "enabled": is_ltf_license_prefix_rewrite_enabled(),
        "source_prefix": LTF_LICENSE_IMPORT_SOURCE_PREFIX,
        "target_prefix": LTF_LICENSE_IMPORT_TARGET_PREFIX,
        "rewritten_count": rewritten_count,
    }


def _bump_ltf_counter_after_prefix_rewrite(rewritten_ids: list[str]) -> None:
    pattern = re.compile(rf"^{re.escape(LTF_LICENSE_IMPORT_TARGET_PREFIX[:-1])}-(\d+)$")
    max_seen = 0
    for value in rewritten_ids:
        match = pattern.match(str(value or "").strip().upper())
        if not match:
            continue
        max_seen = max(max_seen, int(match.group(1)))
    if max_seen <= 0:
        return
    try:
        with transaction.atomic():
            counter, _ = MemberLicenseIdCounter.objects.select_for_update().get_or_create(
                prefix=MemberLicenseIdCounter.Prefix.LTF,
                defaults={"next_value": 1},
            )
            if int(counter.next_value) <= max_seen:
                counter.next_value = max_seen + 1
                counter.save(update_fields=["next_value", "updated_at"])
    except (ProgrammingError, OperationalError):
        return


def rewrite_existing_lux_ltf_license_ids(*, apply: bool) -> dict[str, Any]:
    occupied: dict[str, int] = {}
    for member_id, raw_value in (
        Member.objects.exclude(ltf_licenseid="")
        .values_list("id", "ltf_licenseid")
        .iterator()
    ):
        normalized = str(raw_value or "").strip().upper()
        if normalized:
            occupied[normalized] = member_id

    candidates: list[tuple[int, str, str]] = []
    conflicts: list[dict[str, Any]] = []
    for member_id, raw_value in (
        Member.objects.exclude(ltf_licenseid="")
        .values_list("id", "ltf_licenseid")
        .iterator()
    ):
        current = str(raw_value or "").strip().upper()
        if not current.startswith(LTF_LICENSE_IMPORT_SOURCE_PREFIX):
            continue
        target = (
            LTF_LICENSE_IMPORT_TARGET_PREFIX + current[len(LTF_LICENSE_IMPORT_SOURCE_PREFIX) :]
        )
        occupant_id = occupied.get(target)
        if occupant_id and occupant_id != member_id:
            conflicts.append(
                {
                    "member_id": member_id,
                    "current": current,
                    "target": target,
                }
            )
            continue
        candidates.append((member_id, current, target))
        occupied[target] = member_id

    rewritten = 0
    if apply and candidates:
        with transaction.atomic():
            member_by_id = {
                member.id: member
                for member in Member.objects.filter(id__in=[item[0] for item in candidates])
            }
            rewritten_ids: list[str] = []
            for member_id, _current, target in candidates:
                member = member_by_id.get(member_id)
                if not member:
                    continue
                member.ltf_licenseid = target
                member.save(update_fields=["ltf_licenseid", "updated_at"])
                rewritten_ids.append(target)
                rewritten += 1
            _bump_ltf_counter_after_prefix_rewrite(rewritten_ids)

    return {
        "source_prefix": LTF_LICENSE_IMPORT_SOURCE_PREFIX,
        "target_prefix": LTF_LICENSE_IMPORT_TARGET_PREFIX,
        "candidate_count": len(candidates),
        "conflict_count": len(conflicts),
        "rewritten": rewritten,
        "conflicts": conflicts[:50],
    }
