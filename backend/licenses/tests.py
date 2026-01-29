from datetime import date

from django.test import TestCase

from accounts.models import User
from clubs.models import Club
from members.models import Member

from .models import License


class LicenseModelTests(TestCase):
    def test_license_dates_default_to_calendar_year(self):
        admin = User.objects.create_user(
            username="admin",
            password="pass12345",
            role=User.Roles.NMA_ADMIN,
        )
        club = Club.objects.create(name="Elite Club", created_by=admin)
        member = Member.objects.create(
            club=club,
            first_name="Kai",
            last_name="Zhang",
        )

        license_record = License.objects.create(member=member, club=club, year=2026)

        self.assertEqual(license_record.start_date, date(2026, 1, 1))
        self.assertEqual(license_record.end_date, date(2026, 12, 31))


class MemberDeletionCascadeTests(TestCase):
    def test_member_delete_cascades_licenses(self):
        admin = User.objects.create_user(
            username="admin2",
            password="pass12345",
            role=User.Roles.NMA_ADMIN,
        )
        club = Club.objects.create(name="Cascade Club", created_by=admin)
        member = Member.objects.create(
            club=club,
            first_name="Lina",
            last_name="Meyer",
        )
        License.objects.create(member=member, club=club, year=2026)

        member.delete()

        self.assertEqual(License.objects.count(), 0)
