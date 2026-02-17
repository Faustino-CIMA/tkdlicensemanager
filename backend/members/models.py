from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils.translation import gettext_lazy as _
from django.utils import timezone
from typing import TYPE_CHECKING, cast

from clubs.models import Club


class Member(models.Model):
    class Sex(models.TextChoices):
        MALE = "M", _("Male")
        FEMALE = "F", _("Female")

    class LicenseRole(models.TextChoices):
        ATHLETE = "athlete", _("Athlete")
        COACH = "coach", _("Coach")
        REFEREE = "referee", _("Referee")
        OFFICIAL = "official", _("Official")
        DOCTOR = "doctor", _("Doctor")
        PHYSIOTHERAPIST = "physiotherapist", _("Physiotherapist")

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="member_profile",
    )
    club = models.ForeignKey(Club, on_delete=models.PROTECT, related_name="members")
    first_name = models.CharField(max_length=150)
    last_name = models.CharField(max_length=150)
    sex = models.CharField(max_length=1, choices=Sex.choices, default=Sex.MALE)
    email = models.EmailField(blank=True)
    wt_licenseid = models.CharField(max_length=20, blank=True)
    ltf_licenseid = models.CharField(max_length=20, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    belt_rank = models.CharField(max_length=100, blank=True)
    primary_license_role = models.CharField(
        max_length=32,
        choices=LicenseRole.choices,
        blank=True,
    )
    secondary_license_role = models.CharField(
        max_length=32,
        choices=LicenseRole.choices,
        blank=True,
    )
    profile_picture_original = models.ImageField(
        upload_to="members/profile_pictures/original/",
        null=True,
        blank=True,
    )
    profile_picture_processed = models.ImageField(
        upload_to="members/profile_pictures/processed/",
        null=True,
        blank=True,
    )
    profile_picture_thumbnail = models.ImageField(
        upload_to="members/profile_pictures/thumbnails/",
        null=True,
        blank=True,
    )
    photo_edit_metadata = models.JSONField(default=dict, blank=True)
    photo_consent_attested_at = models.DateTimeField(null=True, blank=True)
    photo_consent_attested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="photo_consent_attestations",
    )
    is_active = models.BooleanField(default=True)  # type: ignore[call-arg]
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=models.Q(secondary_license_role="")
                | ~models.Q(primary_license_role=""),
                name="member_secondary_role_requires_primary",
            ),
            models.CheckConstraint(
                check=models.Q(primary_license_role="")
                | ~models.Q(primary_license_role=models.F("secondary_license_role")),
                name="member_primary_secondary_role_must_differ",
            ),
            models.UniqueConstraint(
                fields=["wt_licenseid"],
                condition=~models.Q(wt_licenseid=""),
                name="member_unique_nonblank_wt_licenseid",
            ),
            models.UniqueConstraint(
                fields=["ltf_licenseid"],
                condition=~models.Q(ltf_licenseid=""),
                name="member_unique_nonblank_ltf_licenseid",
            ),
        ]

    def save(self, *args, **kwargs):
        # Normalize names for consistent display/searching.
        first_name_value = str(self.first_name or "")
        if first_name_value:
            words = first_name_value.split()
            formatted_words = []
            for word in words:
                if "-" in word:
                    formatted_words.append(
                        "-".join(part.capitalize() for part in word.split("-"))
                    )
                else:
                    formatted_words.append(word.capitalize())
            self.first_name = " ".join(formatted_words)
        last_name_value = str(self.last_name or "")
        if last_name_value:
            words = last_name_value.split()
            formatted_words = []
            for word in words:
                if "-" in word:
                    formatted_words.append("-".join(part.upper() for part in word.split("-")))
                else:
                    formatted_words.append(word.upper())
            self.last_name = " ".join(formatted_words)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.first_name} {self.last_name}"


class MemberLicenseIdCounter(models.Model):
    class Prefix(models.TextChoices):
        LUX = "LUX", _("LUX")
        LTF = "LTF", _("LTF")

    prefix = models.CharField(max_length=8, choices=Prefix.choices, unique=True)
    next_value = models.PositiveBigIntegerField(default=1)  # type: ignore[call-arg]
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.prefix} -> {self.next_value}"


class GradePromotionHistory(models.Model):
    member = models.ForeignKey(
        Member, on_delete=models.CASCADE, related_name="grade_history"
    )
    club = models.ForeignKey(
        Club, on_delete=models.PROTECT, related_name="grade_history"
    )
    examiner_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="examined_grade_promotions",
    )
    from_grade = models.CharField(max_length=100, blank=True)
    to_grade = models.CharField(max_length=100)
    promotion_date = models.DateField(default=timezone.localdate)
    exam_date = models.DateField(null=True, blank=True)
    proof_ref = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-promotion_date", "-created_at"]
        indexes = [
            models.Index(fields=["member", "-promotion_date"]),
            models.Index(fields=["club", "-promotion_date"]),
        ]

    if TYPE_CHECKING:
        objects: models.Manager
        member_id: int | None
        club_id: int | None

    def clean(self):
        member_id = cast(int | None, getattr(self, "member_id", None))
        club_id = cast(int | None, getattr(self, "club_id", None))
        member_club_id = cast(
            int | None, getattr(getattr(self, "member", None), "club_id", None)
        )

        if (
            member_id
            and club_id
            and member_club_id is not None
            and member_club_id != club_id
        ):
            raise ValidationError(_("Member does not belong to this club."))
        if self.exam_date and self.exam_date > self.promotion_date:
            raise ValidationError(_("Exam date cannot be after promotion date."))
        if member_id and self._state.adding:
            latest = (
                GradePromotionHistory.objects.filter(member_id=member_id)
                .order_by("-promotion_date", "-created_at")
                .first()
            )
            if latest and self.promotion_date < latest.promotion_date:
                raise ValidationError(
                    _(
                        "Promotion date cannot be earlier than the latest recorded promotion date."
                    )
                )

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError(_("Grade promotion history is append-only."))
        self.full_clean()
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError(_("Grade promotion history is append-only."))

    def __str__(self):
        return f"{self.member} · {self.from_grade} -> {self.to_grade}"
