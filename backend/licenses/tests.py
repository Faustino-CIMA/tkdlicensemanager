from datetime import date

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from clubs.models import Club
from members.models import Member

from .models import License, LicenseType


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


class LicenseTypeApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.nma_admin = User.objects.create_user(
            username="nmaadmin",
            password="pass12345",
            role=User.Roles.NMA_ADMIN,
        )
        self.club_admin = User.objects.create_user(
            username="clubadmin",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )

    def test_nma_admin_can_create_license_type(self):
        self.client.force_authenticate(user=self.nma_admin)
        response = self.client.post("/api/license-types/", {"name": "Paid"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["name"], "Paid")

    def test_non_nma_cannot_create_license_type(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post("/api/license-types/", {"name": "Free"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_authenticated_user_can_list_license_types(self):
        LicenseType.objects.create(name="Paid", code="paid")
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.get("/api/license-types/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)

    def test_delete_blocked_when_in_use(self):
        self.client.force_authenticate(user=self.nma_admin)
        license_type = LicenseType.objects.create(name="Paid", code="paid")
        club = Club.objects.create(name="Locked Club", created_by=self.nma_admin)
        member = Member.objects.create(club=club, first_name="Dina", last_name="Lopez")
        License.objects.create(member=member, club=club, year=2026, license_type=license_type)

        response = self.client.delete(f"/api/license-types/{license_type.id}/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
