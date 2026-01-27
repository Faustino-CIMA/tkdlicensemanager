from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class User(AbstractUser):
    class Roles(models.TextChoices):
        NMA_ADMIN = "nma_admin", "NMA Admin"
        CLUB_ADMIN = "club_admin", "Club Admin"
        COACH = "coach", "Coach"
        MEMBER = "member", "Member"

    role = models.CharField(
        max_length=20,
        choices=Roles.choices,
        default=Roles.MEMBER,
    )
    is_email_verified = models.BooleanField(default=False)
    consent_given = models.BooleanField(default=False)
    consent_given_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def give_consent(self):
        self.consent_given = True
        self.consent_given_at = timezone.now()
        self.save(update_fields=["consent_given", "consent_given_at"])

    def revoke_consent(self):
        self.consent_given = False
        self.consent_given_at = None
        self.save(update_fields=["consent_given", "consent_given_at"])
