import json
from io import BytesIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from licenses.models import License, LicenseType
from members.models import Member

from .models import BrandingAsset, Club, FederationProfile


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

    def test_ltf_admin_can_filter_clubs_without_admin(self):
        club_without_admin = Club.objects.create(
            name="No Admin Club",
            city="Esch",
            address="2 Side St",
            created_by=self.ltf_admin,
        )
        self.client.force_authenticate(user=self.ltf_admin)
        all_response = self.client.get("/api/clubs/")
        self.assertEqual(all_response.status_code, 200)
        self.assertEqual(len(all_response.data), 2)

        filtered = self.client.get("/api/clubs/", {"issue": "no_admin"})
        self.assertEqual(filtered.status_code, 200)
        ids = {row["id"] for row in filtered.data}
        self.assertEqual(ids, {club_without_admin.id})

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
        license_type = LicenseType.objects.create(
            name="Club Lock Annual",
            code="club-lock-annual",
        )
        License.objects.create(
            member=member,
            club=self.club,
            license_type=license_type,
            year=2026,
        )
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

    def _logo_file(self, name: str = "logo.png") -> SimpleUploadedFile:
        return SimpleUploadedFile(
            name,
            (
                b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
                b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0bIDATx\x9cc``\x00\x00"
                b"\x00\x03\x00\x01h&Y\r\x00\x00\x00\x00IEND\xaeB`\x82"
            ),
            content_type="image/png",
        )

    def test_ltf_admin_can_manage_club_logos(self):
        self.client.force_authenticate(user=self.ltf_admin)
        create_response = self.client.post(
            f"/api/clubs/{self.club.id}/logos/",
            {
                "file": self._logo_file(),
                "usage_type": "general",
                "label": "Main logo",
                "is_selected": True,
            },
            format="multipart",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        logo_id = create_response.data["id"]

        list_response = self.client.get(f"/api/clubs/{self.club.id}/logos/")
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(list_response.data["logos"]), 1)

        patch_response = self.client.patch(
            f"/api/clubs/{self.club.id}/logos/{logo_id}/",
            {"usage_type": "invoice", "is_selected": True},
            format="json",
        )
        self.assertEqual(patch_response.status_code, status.HTTP_200_OK)
        self.assertEqual(patch_response.data["usage_type"], "invoice")

        content_response = self.client.get(
            f"/api/clubs/{self.club.id}/logos/{logo_id}/content/"
        )
        self.assertEqual(content_response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            str(content_response.get("Content-Type", "")).startswith("image/")
        )

        delete_response = self.client.delete(
            f"/api/clubs/{self.club.id}/logos/{logo_id}/"
        )
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)

    def test_club_admin_can_manage_own_club_logos(self):
        self.client.force_authenticate(user=self.club_admin)
        create_response = self.client.post(
            f"/api/clubs/{self.club.id}/logos/",
            {
                "file": self._logo_file(),
                "usage_type": "general",
                "label": "Club admin logo",
                "is_selected": True,
            },
            format="multipart",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        logo_id = create_response.data["id"]

        patch_response = self.client.patch(
            f"/api/clubs/{self.club.id}/logos/{logo_id}/",
            {"usage_type": "invoice", "is_selected": True},
            format="json",
        )
        self.assertEqual(patch_response.status_code, status.HTTP_200_OK)
        self.assertEqual(patch_response.data["usage_type"], "invoice")

        delete_response = self.client.delete(
            f"/api/clubs/{self.club.id}/logos/{logo_id}/"
        )
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)

    def test_non_ltf_admin_cannot_modify_club_logos(self):
        member_user = User.objects.create_user(
            username="member-logo",
            password="pass12345",
            role=User.Roles.MEMBER,
        )
        self.client.force_authenticate(user=member_user)
        create_response = self.client.post(
            f"/api/clubs/{self.club.id}/logos/",
            {
                "file": self._logo_file(),
                "usage_type": "general",
            },
            format="multipart",
        )
        self.assertEqual(create_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_update_club_iban_sets_bank_name(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.patch(
            f"/api/clubs/{self.club.id}/",
            {
                "iban": "LU28 0019 4006 4475 0000",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.club.refresh_from_db()
        self.assertEqual(self.club.iban, "LU280019400644750000")
        self.assertEqual(self.club.bank_name, "Spuerkeess (BCEE)")

    def test_club_email_is_writable_and_used_for_notifications(self):
        self.client.force_authenticate(user=self.ltf_admin)
        self.club_admin.email = "admin@example.com"
        self.club_admin.save(update_fields=["email"])
        self.assertEqual(self.club.notification_emails(), ["admin@example.com"])

        response = self.client.patch(
            f"/api/clubs/{self.club.id}/",
            {"email": " club@example.com "},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.club.refresh_from_db()
        self.assertEqual(self.club.email, "club@example.com")
        self.assertEqual(self.club.notification_emails(), ["club@example.com"])

    def test_club_admin_can_patch_own_club_iban(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.patch(
            f"/api/clubs/{self.club.id}/",
            {
                "iban": "LU28 0019 4006 4475 0000",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.club.refresh_from_db()
        self.assertEqual(self.club.iban, "LU280019400644750000")
        self.assertEqual(self.club.bank_name, "Spuerkeess (BCEE)")

    def test_club_admin_cannot_patch_other_club(self):
        other_club = Club.objects.create(
            name="Other Club",
            city="Esch",
            created_by=self.ltf_admin,
        )
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.patch(
            f"/api/clubs/{other_club.id}/",
            {"city": "Differdange"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_update_club_rejects_invalid_iban(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.patch(
            f"/api/clubs/{self.club.id}/",
            {
                "iban": "NOT_VALID",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("iban", response.data)


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
            "name,address_line1,address_line2,postal_code,locality,iban\n"
            "Club C,14 Rue de Test,Hall B,2345,Esch,LU280019400644750000\n"
        )
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "clubs_structured.csv"
        mapping = {
            "name": "name",
            "address_line1": "address_line1",
            "address_line2": "address_line2",
            "postal_code": "postal_code",
            "locality": "locality",
            "iban": "iban",
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
        self.assertEqual(created.iban, "LU280019400644750000")
        self.assertEqual(created.bank_name, "Spuerkeess (BCEE)")


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

    def test_add_admin_does_not_name_match_unrelated_user(self):
        self.club.max_admins = 5
        self.club.save(update_fields=["max_admins"])
        stranger = User.objects.create_user(
            username="stranger",
            password="pass12345",
            role=User.Roles.MEMBER,
            first_name="Kai",
            last_name="Schmidt",
        )
        candidate = Member.objects.create(
            club=self.club,
            first_name="Kai",
            last_name="Schmidt",
            email="kai.schmidt@example.com",
        )
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            f"/api/clubs/{self.club.id}/add_admin/",
            {"member_id": candidate.id},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        candidate.refresh_from_db()
        stranger.refresh_from_db()
        self.assertNotEqual(candidate.user_id, stranger.id)
        self.assertEqual(stranger.role, User.Roles.MEMBER)
        self.assertTrue(self.club.admins.filter(id=candidate.user_id).exists())
        self.assertTrue(response.data["created_user"])
        self.assertFalse(response.data["linked_existing_user"])

    def test_add_admin_requires_email_when_creating_user(self):
        self.club.max_admins = 5
        self.club.save(update_fields=["max_admins"])
        candidate = Member.objects.create(
            club=self.club,
            first_name="No",
            last_name="Email",
        )
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            f"/api/clubs/{self.club.id}/add_admin/",
            {"member_id": candidate.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "email_required")

        response = self.client.post(
            f"/api/clubs/{self.club.id}/add_admin/",
            {"member_id": candidate.id, "email": "no.email@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        candidate.refresh_from_db()
        self.assertEqual(candidate.email, "no.email@example.com")
        self.assertIsNotNone(candidate.user_id)
        self.assertEqual(candidate.user.email, "no.email@example.com")

    def test_add_admin_links_existing_same_name_admin_on_club(self):
        self.club.max_admins = 5
        self.club.save(update_fields=["max_admins"])
        existing = User.objects.create_user(
            username="jschwitz",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
            first_name="Jenna",
            last_name="SCHWITZ",
        )
        self.club.admins.add(existing)
        member = Member.objects.create(
            club=self.club,
            first_name="Jenna",
            last_name="SCHWITZ",
        )
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            f"/api/clubs/{self.club.id}/add_admin/",
            {"member_id": member.id, "email": "jenna@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        member.refresh_from_db()
        self.assertEqual(member.user_id, existing.id)
        self.assertTrue(response.data["linked_existing_user"])
        self.assertFalse(response.data["created_user"])
        self.assertEqual(self.club.admins.count(), 1)

    def test_add_admin_does_not_demote_ltf_admin(self):
        self.club.max_admins = 5
        self.club.save(update_fields=["max_admins"])
        officer = User.objects.create_user(
            username="officer",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
            email="officer@example.com",
        )
        member = Member.objects.create(
            user=officer,
            club=self.club,
            first_name="Pat",
            last_name="Officer",
            email="officer@example.com",
        )
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            f"/api/clubs/{self.club.id}/add_admin/",
            {"member_id": member.id},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        officer.refresh_from_db()
        self.assertEqual(officer.role, User.Roles.LTF_ADMIN)
        self.assertTrue(self.club.admins.filter(id=officer.id).exists())

    def test_admin_assignment_board_payload(self):
        self.client.force_authenticate(user=self.ltf_admin)
        license_type = LicenseType.objects.create(name="Paid Board", code="paid-board")
        licensed = Member.objects.create(
            club=self.club,
            first_name="Licensed",
            last_name="Athlete",
            email="licensed@example.com",
        )
        License.objects.create(
            member=licensed,
            club=self.club,
            license_type=license_type,
            year=2026,
            status=License.Status.ACTIVE,
        )
        response = self.client.get("/api/clubs/admin_assignment/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("clubs", response.data)
        self.assertIn("admins", response.data)
        self.assertNotIn("members", response.data)
        club_row = next(item for item in response.data["clubs"] if item["id"] == self.club.id)
        self.assertEqual(club_row["admin_count"], 0)

        empty = self.client.get("/api/clubs/admin_assignment_members/")
        self.assertEqual(empty.status_code, 200)
        self.assertEqual(empty.data["members"], [])

        by_club = self.client.get(
            "/api/clubs/admin_assignment_members/",
            {"club_id": self.club.id, "licensed_only": "true"},
        )
        self.assertEqual(by_club.status_code, 200)
        self.assertEqual(len(by_club.data["members"]), 1)
        self.assertTrue(by_club.data["members"][0]["has_valid_license"])
        self.assertEqual(by_club.data["members"][0]["id"], licensed.id)

        by_name = self.client.get(
            "/api/clubs/admin_assignment_members/",
            {"q": "Licensed Athlete", "licensed_only": "true"},
        )
        self.assertEqual(by_name.status_code, 200)
        self.assertEqual(by_name.data["members"][0]["id"], licensed.id)

        too_short = self.client.get(
            "/api/clubs/admin_assignment_members/",
            {"q": "L", "licensed_only": "true"},
        )
        self.assertEqual(too_short.status_code, 200)
        self.assertEqual(too_short.data["members"], [])
        self.assertFalse(too_short.data["truncated"])

        unlicensed = self.client.get(
            "/api/clubs/admin_assignment_members/",
            {"club_id": self.club.id, "licensed_only": "false"},
        )
        self.assertEqual(unlicensed.status_code, 200)
        member_ids = {item["id"] for item in unlicensed.data["members"]}
        self.assertIn(licensed.id, member_ids)
        self.assertGreaterEqual(len(member_ids), 2)

        capped = self.client.get(
            "/api/clubs/admin_assignment_members/",
            {"club_id": self.club.id, "licensed_only": "false", "limit": 100},
        )
        self.assertLessEqual(capped.data["limit"], 25)

    def test_admin_assignment_member_search_truncates(self):
        self.client.force_authenticate(user=self.ltf_admin)
        license_type = LicenseType.objects.create(name="Paid Search Cap", code="paid-search-cap")
        for index in range(26):
            member = Member.objects.create(
                club=self.club,
                first_name=f"Search{index:02d}",
                last_name="Cap",
                email=f"search{index:02d}@example.com",
            )
            License.objects.create(
                member=member,
                club=self.club,
                license_type=license_type,
                year=2026,
                status=License.Status.ACTIVE,
            )
        response = self.client.get(
            "/api/clubs/admin_assignment_members/",
            {"club_id": self.club.id, "licensed_only": "true"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["members"]), 25)
        self.assertGreaterEqual(response.data["total"], 26)
        self.assertTrue(response.data["truncated"])
        self.assertEqual(response.data["limit"], 25)

    def test_add_admin_sends_welcome_email_without_resend(self):
        self.club.max_admins = 5
        self.club.save(update_fields=["max_admins"])
        candidate = Member.objects.create(
            club=self.club,
            first_name="Mail",
            last_name="Tester",
            email="mail.tester@example.com",
        )
        self.client.force_authenticate(user=self.ltf_admin)
        from django.core import mail
        from django.test import override_settings

        with override_settings(
            RESEND_API_KEY="replace-me",
            EMAIL_HOST="",
            EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        ):
            response = self.client.post(
                f"/api/clubs/{self.club.id}/add_admin/",
                {"member_id": candidate.id, "locale": "en"},
                format="json",
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["created_user"])
        self.assertTrue(response.data["email_sent"])
        self.assertTrue(response.data["reset_url"])
        self.assertIn(f"username={response.data['username']}", response.data["reset_url"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("mail.tester@example.com", mail.outbox[0].to)
        self.assertIn("reset-password", mail.outbox[0].body)
        self.assertIn(f"username={response.data['username']}", mail.outbox[0].body)

    def test_admin_assignment_forbidden_for_club_admin(self):
        club_admin = User.objects.create_user(
            username="clubadmin-board",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )
        self.club.admins.add(club_admin)
        self.client.force_authenticate(user=club_admin)
        response = self.client.get("/api/clubs/admin_assignment/")
        self.assertEqual(response.status_code, 403)
        members = self.client.get("/api/clubs/admin_assignment_members/")
        self.assertEqual(members.status_code, 403)


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

    def test_ltf_admin_can_patch_club_tourist_threshold(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.patch(
            "/api/federation-profile/",
            {"club_tourist_transfer_threshold": 4},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        profile = FederationProfile.objects.get(pk=1)
        self.assertEqual(profile.club_tourist_transfer_threshold, 4)

    def test_ltf_admin_patch_iban_sets_bank_name(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.patch(
            "/api/federation-profile/",
            {"iban": "LU28 0019 4006 4475 0000"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        profile = FederationProfile.objects.get(pk=1)
        self.assertEqual(profile.iban, "LU280019400644750000")
        self.assertEqual(profile.bank_name, "Spuerkeess (BCEE)")

    def test_ltf_admin_patch_rejects_invalid_iban(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.patch(
            "/api/federation-profile/",
            {"iban": "BAD_IBAN"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("iban", response.data)

    def test_club_admin_cannot_read_federation_profile(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.get("/api/federation-profile/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def _logo_file(self, name: str = "federation-logo.png") -> SimpleUploadedFile:
        return SimpleUploadedFile(
            name,
            (
                b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
                b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0bIDATx\x9cc``\x00\x00"
                b"\x00\x03\x00\x01h&Y\r\x00\x00\x00\x00IEND\xaeB`\x82"
            ),
            content_type="image/png",
        )

    def test_ltf_admin_can_patch_federation_iban_and_derives_bank_name(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.patch(
            "/api/federation-profile/",
            {
                "iban": "LU280019400644750000",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["bank_name"], "Spuerkeess (BCEE)")

    def test_ltf_admin_patch_federation_rejects_invalid_iban(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.patch(
            "/api/federation-profile/",
            {"iban": "LU000000000000000000"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("iban", response.data)

    def test_ltf_admin_can_manage_federation_logos(self):
        self.client.force_authenticate(user=self.ltf_admin)
        create_response = self.client.post(
            "/api/federation-profile/logos/",
            {
                "file": self._logo_file(),
                "usage_type": "invoice",
                "label": "Invoice logo",
                "is_selected": True,
            },
            format="multipart",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        logo_id = create_response.data["id"]

        list_response = self.client.get("/api/federation-profile/logos/")
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(list_response.data["logos"]), 1)

        patch_response = self.client.patch(
            f"/api/federation-profile/logos/{logo_id}/",
            {"label": "Invoice logo v2", "is_selected": True},
            format="json",
        )
        self.assertEqual(patch_response.status_code, status.HTTP_200_OK)
        self.assertEqual(patch_response.data["label"], "Invoice logo v2")

        content_response = self.client.get(
            f"/api/federation-profile/logos/{logo_id}/content/"
        )
        self.assertEqual(content_response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            str(content_response.get("Content-Type", "")).startswith("image/")
        )

        delete_response = self.client.delete(
            f"/api/federation-profile/logos/{logo_id}/"
        )
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)

    def test_ltf_finance_can_read_but_cannot_modify_federation_logos(self):
        self.client.force_authenticate(user=self.ltf_admin)
        create_response = self.client.post(
            "/api/federation-profile/logos/",
            {
                "file": self._logo_file(),
                "usage_type": "general",
            },
            format="multipart",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)

        self.client.force_authenticate(user=self.ltf_finance)
        list_response = self.client.get("/api/federation-profile/logos/")
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        logo_id = list_response.data["logos"][0]["id"]

        patch_response = self.client.patch(
            f"/api/federation-profile/logos/{logo_id}/",
            {"is_selected": True},
            format="json",
        )
        self.assertEqual(patch_response.status_code, status.HTTP_403_FORBIDDEN)


class BrandingAssetApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="brand-ltf-admin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.ltf_finance = User.objects.create_user(
            username="brand-ltf-finance",
            password="pass12345",
            role=User.Roles.LTF_FINANCE,
        )
        self.club_admin = User.objects.create_user(
            username="brand-club-admin",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )
        self.member_user = User.objects.create_user(
            username="brand-member",
            password="pass12345",
            role=User.Roles.MEMBER,
        )
        self.club = Club.objects.create(
            name="Brand Club",
            city="Luxembourg",
            address="1 Brand Street",
            created_by=self.ltf_admin,
        )
        self.club.admins.add(self.club_admin)

    def _make_logo(self, name: str = "logo.png") -> SimpleUploadedFile:
        return SimpleUploadedFile(name, b"fake-image-bytes", content_type="image/png")

    def test_ltf_admin_can_upload_and_select_club_logos(self):
        self.client.force_authenticate(user=self.ltf_admin)
        first_response = self.client.post(
            f"/api/clubs/{self.club.id}/logos/",
            {"file": self._make_logo("first.png"), "usage_type": "invoice"},
            format="multipart",
        )
        self.assertEqual(first_response.status_code, status.HTTP_201_CREATED)
        first_logo_id = first_response.data["id"]
        self.assertTrue(first_response.data["is_selected"])

        second_response = self.client.post(
            f"/api/clubs/{self.club.id}/logos/",
            {
                "file": self._make_logo("second.png"),
                "usage_type": "invoice",
                "is_selected": True,
            },
            format="multipart",
        )
        self.assertEqual(second_response.status_code, status.HTTP_201_CREATED)
        second_logo_id = second_response.data["id"]

        first_logo = BrandingAsset.objects.get(id=first_logo_id)
        second_logo = BrandingAsset.objects.get(id=second_logo_id)
        self.assertFalse(first_logo.is_selected)
        self.assertTrue(second_logo.is_selected)

        list_response = self.client.get(f"/api/clubs/{self.club.id}/logos/")
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(list_response.data["logos"]), 2)

        content_response = self.client.get(
            f"/api/clubs/{self.club.id}/logos/{second_logo_id}/content/"
        )
        self.assertEqual(content_response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            str(content_response.get("Content-Type", "")).startswith("image/")
        )

    def test_non_ltf_admin_cannot_modify_club_logos(self):
        self.client.force_authenticate(user=self.member_user)
        response = self.client.post(
            f"/api/clubs/{self.club.id}/logos/",
            {"file": self._make_logo()},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_ltf_admin_can_manage_federation_logos(self):
        self.client.force_authenticate(user=self.ltf_admin)
        create_response = self.client.post(
            "/api/federation-profile/logos/",
            {"file": self._make_logo("fed.png"), "usage_type": "general"},
            format="multipart",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        logo_id = create_response.data["id"]

        patch_response = self.client.patch(
            f"/api/federation-profile/logos/{logo_id}/",
            {"is_selected": True, "label": "Primary federation logo"},
            format="json",
        )
        self.assertEqual(patch_response.status_code, status.HTTP_200_OK)
        self.assertTrue(patch_response.data["is_selected"])
        self.assertEqual(patch_response.data["label"], "Primary federation logo")

        list_response = self.client.get("/api/federation-profile/logos/")
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(list_response.data["logos"]), 1)

        content_response = self.client.get(
            f"/api/federation-profile/logos/{logo_id}/content/"
        )
        self.assertEqual(content_response.status_code, status.HTTP_200_OK)

        delete_response = self.client.delete(f"/api/federation-profile/logos/{logo_id}/")
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)

    def test_ltf_finance_can_read_but_not_modify_federation_logos(self):
        self.client.force_authenticate(user=self.ltf_admin)
        self.client.post(
            "/api/federation-profile/logos/",
            {"file": self._make_logo("fed.png"), "usage_type": "general"},
            format="multipart",
        )
        self.client.force_authenticate(user=self.ltf_finance)
        get_response = self.client.get("/api/federation-profile/logos/")
        self.assertEqual(get_response.status_code, status.HTTP_200_OK)
        post_response = self.client.post(
            "/api/federation-profile/logos/",
            {"file": self._make_logo("forbidden.png")},
            format="multipart",
        )
        self.assertEqual(post_response.status_code, status.HTTP_403_FORBIDDEN)


class LuxembourgIbanBankLookupTests(TestCase):
    def test_three_digit_bank_code_identifies_spuerkeess_not_post(self):
        from .banking import derive_bank_name_from_iban

        # Official LU IBAN example: bank code 001, account starts with 9.
        self.assertEqual(
            derive_bank_name_from_iban("LU28 0019 4006 4475 0000"),
            "Spuerkeess (BCEE)",
        )

    def test_post_luxembourg_uses_code_111(self):
        from .banking import derive_bank_name_from_iban

        self.assertEqual(
            derive_bank_name_from_iban("LU391110000000000001"),
            "POST Luxembourg",
        )

    def test_legacy_post_code_019_still_recognized(self):
        from .banking import derive_bank_name_from_iban

        self.assertEqual(
            derive_bank_name_from_iban("LU660194006447500000"),
            "POST Luxembourg",
        )

    def test_banque_de_luxembourg_code_008(self):
        from .banking import derive_bank_name_from_iban

        self.assertEqual(
            derive_bank_name_from_iban("LU440080000000000001"),
            "Banque de Luxembourg",
        )
