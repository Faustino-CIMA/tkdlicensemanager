from io import BytesIO
import json

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from licenses.models import License
from members.models import Member

from .models import Club


class ClubApiTests(TestCase):
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

        self.club = Club.objects.create(
            name="Main Club",
            city="Luxembourg",
            address="1 Main St",
            created_by=self.nma_admin,
        )
        self.club.admins.add(self.club_admin)

    def test_nma_admin_sees_all_clubs(self):
        self.client.force_authenticate(user=self.nma_admin)
        response = self.client.get("/api/clubs/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_club_admin_sees_own_club(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.get("/api/clubs/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_cannot_delete_club_with_members(self):
        member = Member.objects.create(
            club=self.club,
            first_name="Ana",
            last_name="Weber",
        )
        self.client.force_authenticate(user=self.nma_admin)
        response = self.client.delete(f"/api/clubs/{self.club.id}/")
        self.assertEqual(response.status_code, 409)
        self.assertIn("members", response.data.get("detail", "").lower())
        member.refresh_from_db()

    def test_cannot_delete_club_with_licenses(self):
        member = Member.objects.create(
            club=self.club,
            first_name="Jon",
            last_name="Schmitt",
        )
        License.objects.create(member=member, club=self.club, year=2026)
        self.client.force_authenticate(user=self.nma_admin)
        response = self.client.delete(f"/api/clubs/{self.club.id}/")
        self.assertEqual(response.status_code, 409)
        self.assertTrue(
            "members" in response.data.get("detail", "").lower()
            or "licenses" in response.data.get("detail", "").lower()
        )


class ClubImportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.nma_admin = User.objects.create_user(
            username="nmaadmin",
            password="pass12345",
            role=User.Roles.NMA_ADMIN,
        )

    def test_preview_requires_auth(self):
        response = self.client.post("/api/imports/clubs/preview/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_preview_returns_headers(self):
        self.client.force_authenticate(user=self.nma_admin)
        csv_data = "name,city,address\nClub A,Lux,Main St\n"
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "clubs.csv"
        response = self.client.post(
            "/api/imports/clubs/preview/",
            {"file": file_obj},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("headers", response.data)

    def test_confirm_creates_clubs(self):
        self.client.force_authenticate(user=self.nma_admin)
        csv_data = "name,city,address\nClub A,Lux,Main St\nClub B,,\n"
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "clubs.csv"
        mapping = {"name": "name", "city": "city", "address": "address"}
        response = self.client.post(
            "/api/imports/clubs/confirm/",
            {"file": file_obj, "mapping": json.dumps(mapping)},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Club.objects.count(), 2)
