from datetime import date

from django.db import models

from clubs.models import Club
from members.models import Member


class License(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACTIVE = "active", "Active"
        EXPIRED = "expired", "Expired"

    member = models.ForeignKey(Member, on_delete=models.PROTECT, related_name="licenses")
    club = models.ForeignKey(Club, on_delete=models.PROTECT, related_name="licenses")
    year = models.PositiveIntegerField()
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    issued_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if not self.start_date or not self.end_date:
            self.start_date = date(self.year, 1, 1)
            self.end_date = date(self.year, 12, 31)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.member} - {self.year}"
