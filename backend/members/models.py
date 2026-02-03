from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from clubs.models import Club


class Member(models.Model):
    class Sex(models.TextChoices):
        MALE = "M", _("Male")
        FEMALE = "F", _("Female")

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
    is_active = models.BooleanField(default=True)  # type: ignore[call-arg]
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

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
