from io import BytesIO
import json

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from licenses.models import License
from members.models import Member

from .models import Club, FederationProfile


class ClubApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="ltfadmin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
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
            created_by=self.ltf_admin,
        )
        self.club.admins.add(self.club_admin)

    def test_ltf_admin_sees_all_clubs(self):
        self.client.force_authenticate(user=self.ltf_admin)
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
        self.client.force_authenticate(user=self.ltf_admin)
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
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.delete(f"/api/clubs/{self.club.id}/")
        self.assertEqual(response.status_code, 409)
        self.assertTrue(
            "members" in response.data.get("detail", "").lower()
            or "licenses" in response.data.get("detail", "").lower()
        )

    def test_update_club_structured_address_syncs_legacy_fields(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.patch(
            f"/api/clubs/{self.club.id}/",
            {
                "address_line1": "12 Rue de la Gare",
                "address_line2": "Bureau 4",
                "postal_code": "1234",
                "locality": "Luxembourg",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.club.refresh_from_db()
        self.assertEqual(self.club.address_line1, "12 Rue de la Gare")
        self.assertEqual(self.club.address_line2, "Bureau 4")
        self.assertEqual(self.club.postal_code, "1234")
        self.assertEqual(self.club.locality, "Luxembourg")
        self.assertEqual(self.club.address, "12 Rue de la Gare")
        self.assertEqual(self.club.city, "Luxembourg")

    def test_update_club_rejects_invalid_luxembourg_postal_code(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.patch(
            f"/api/clubs/{self.club.id}/",
            {
                "postal_code": "123",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("postal_code", response.data)


class ClubImportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="ltfadmin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )

    def test_preview_requires_auth(self):
        response = self.client.post("/api/imports/clubs/preview/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_preview_returns_headers(self):
        self.client.force_authenticate(user=self.ltf_admin)
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
        self.client.force_authenticate(user=self.ltf_admin)
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
        created = Club.objects.order_by("id").first()
        self.assertEqual(created.address_line1, "Main St")
        self.assertEqual(created.locality, "Lux")

    def test_confirm_creates_clubs_with_structured_address_columns(self):
        self.client.force_authenticate(user=self.ltf_admin)
        csv_data = (
            "name,address_line1,address_line2,postal_code,locality\n"
            "Club C,14 Rue de Test,Hall B,2345,Esch\n"
        )
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "clubs_structured.csv"
        mapping = {
            "name": "name",
            "address_line1": "address_line1",
            "address_line2": "address_line2",
            "postal_code": "postal_code",
            "locality": "locality",
        }
        response = self.client.post(
            "/api/imports/clubs/confirm/",
            {"file": file_obj, "mapping": json.dumps(mapping)},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        created = Club.objects.get(name="Club C")
        self.assertEqual(created.address_line1, "14 Rue de Test")
        self.assertEqual(created.address_line2, "Hall B")
        self.assertEqual(created.postal_code, "2345")
        self.assertEqual(created.locality, "Esch")


class ClubAdminManagementTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="ltfadmin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.member_user = User.objects.create_user(
            username="memberuser",
            password="pass12345",
            role=User.Roles.MEMBER,
        )
        self.club = Club.objects.create(
            name="Admin Club",
            city="Luxembourg",
            address="1 Admin Rd",
            created_by=self.ltf_admin,
            max_admins=1,
        )
        Member.objects.create(
            user=self.member_user,
            club=self.club,
            first_name="Lina",
            last_name="Muller",
        )

    def test_add_admin_respects_limit(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            f"/api/clubs/{self.club.id}/add_admin/",
            {"user_id": self.member_user.id},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.club.refresh_from_db()
        self.assertEqual(self.club.admins.count(), 1)
        self.member_user.refresh_from_db()
        self.assertEqual(self.member_user.role, User.Roles.CLUB_ADMIN)

        other_user = User.objects.create_user(
            username="membertwo",
            password="pass12345",
            role=User.Roles.MEMBER,
        )
        Member.objects.create(
            user=other_user,
            club=self.club,
            first_name="Kai",
            last_name="Schmidt",
        )
        response = self.client.post(
            f"/api/clubs/{self.club.id}/add_admin/",
            {"user_id": other_user.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_remove_admin_resets_role(self):
        self.client.force_authenticate(user=self.ltf_admin)
        self.client.post(
            f"/api/clubs/{self.club.id}/add_admin/",
            {"user_id": self.member_user.id},
            format="json",
        )
        response = self.client.post(
            f"/api/clubs/{self.club.id}/remove_admin/",
            {"user_id": self.member_user.id},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.member_user.refresh_from_db()
        self.assertEqual(self.member_user.role, User.Roles.MEMBER)

    def test_set_max_admins(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.patch(
            f"/api/clubs/{self.club.id}/set_max_admins/",
            {"max_admins": 5},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.club.refresh_from_db()
        self.assertEqual(self.club.max_admins, 5)


class FederationProfileApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="fed-ltf-admin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.ltf_finance = User.objects.create_user(
            username="fed-ltf-finance",
            password="pass12345",
            role=User.Roles.LTF_FINANCE,
        )
        self.club_admin = User.objects.create_user(
            username="fed-club-admin",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )

    def test_get_creates_singleton_profile_for_ltf_admin(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.get("/api/federation-profile/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["id"], 1)
        self.assertEqual(FederationProfile.objects.count(), 1)

    def test_ltf_finance_can_read_federation_profile(self):
        self.client.force_authenticate(user=self.ltf_finance)
        response = self.client.get("/api/federation-profile/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_ltf_finance_cannot_patch_federation_profile(self):
        self.client.force_authenticate(user=self.ltf_finance)
        response = self.client.patch(
            "/api/federation-profile/",
            {"name": "Blocked"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_ltf_admin_can_patch_federation_profile(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.patch(
            "/api/federation-profile/",
            {
                "name": "LTF Federation",
                "address_line1": "3 Rue du Sport",
                "postal_code": "1111",
                "locality": "Luxembourg",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        profile = FederationProfile.objects.get(pk=1)
        self.assertEqual(profile.name, "LTF Federation")
        self.assertEqual(profile.postal_code, "1111")

    def test_club_admin_cannot_read_federation_profile(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.get("/api/federation-profile/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
