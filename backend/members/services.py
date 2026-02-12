from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import uuid4

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from PIL import Image, ImageOps, UnidentifiedImageError

from .models import GradePromotionHistory, Member

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
    image.save(processed_stream, format="JPEG", quality=92, optimize=True)
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
    thumbnail.save(thumbnail_stream, format="JPEG", quality=88, optimize=True)
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

    processed_content, thumbnail_content, processed_details = _render_processed_outputs(
        processed_image
    )
    original_source = original_image or processed_image
    original_content = _to_original_content_file(original_source)

    metadata = {
        **(photo_edit_metadata or {}),
        **processed_details,
    }

    with transaction.atomic():
        if member.profile_picture_original:
            member.profile_picture_original.delete(save=False)
        if member.profile_picture_processed:
            member.profile_picture_processed.delete(save=False)
        if member.profile_picture_thumbnail:
            member.profile_picture_thumbnail.delete(save=False)

        member.profile_picture_original.save(original_content.name, original_content, save=False)
        member.profile_picture_processed.save(
            processed_content.name, processed_content, save=False
        )
        member.profile_picture_thumbnail.save(
            thumbnail_content.name, thumbnail_content, save=False
        )
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
