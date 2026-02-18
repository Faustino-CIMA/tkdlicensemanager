from io import BytesIO
import json
import shutil
import tempfile
from datetime import date
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db.utils import ProgrammingError
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient
from PIL import Image

from accounts.models import User
from clubs.models import Club
from licenses.models import License, LicenseHistoryEvent, LicenseType

from .models import GradePromotionHistory, Member
from .services import add_grade_promotion


class MemberApiTests(TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp()
        self.media_override = override_settings(MEDIA_ROOT=self.media_root)
        self.media_override.enable()
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
        self.member_user = User.objects.create_user(
            username="member",
            password="pass12345",
            role=User.Roles.MEMBER,
        )
        self.finance_user = User.objects.create_user(
            username="finance",
            password="pass12345",
            role=User.Roles.LTF_FINANCE,
        )
        self.coach_user = User.objects.create_user(
            username="coach",
            password="pass12345",
            role=User.Roles.COACH,
        )

        self.club = Club.objects.create(
            name="Central Club",
            city="Luxembourg",
            address="10 Center Rd",
            created_by=self.ltf_admin,
        )
        self.club.admins.add(self.club_admin, self.coach_user)

        self.member = Member.objects.create(
            user=self.member_user,
            club=self.club,
            first_name="Mia",
            last_name="Lee",
        )
        self.inactive_member = Member.objects.create(
            club=self.club,
            first_name="Noah",
            last_name="Gray",
            is_active=False,
        )
        self.license_type = LicenseType.objects.create(
            name="Members Annual",
            code="members-annual",
        )

    def tearDown(self):
        self.media_override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)
        super().tearDown()

    def _make_test_image(
        self,
        name: str,
        *,
        width: int = 1400,
        height: int = 1800,
        image_format: str = "JPEG",
    ) -> SimpleUploadedFile:
        image = Image.new("RGB", (width, height), color=(200, 200, 200))
        payload = BytesIO()
        image.save(payload, format=image_format)
        payload.seek(0)
        content_type = "image/png" if image_format.upper() == "PNG" else "image/jpeg"
        return SimpleUploadedFile(name, payload.getvalue(), content_type=content_type)

    def test_member_sees_own_profile(self):
        self.client.force_authenticate(user=self.member_user)
        response = self.client.get("/api/members/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_club_admin_sees_club_members(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.get("/api/members/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 2)

    def test_coach_sees_club_members(self):
        self.client.force_authenticate(user=self.coach_user)
        response = self.client.get("/api/members/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)

    def test_ltf_admin_only_sees_active_members(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.get("/api/members/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {row["id"] for row in response.data}
        self.assertIn(self.member.id, ids)
        self.assertNotIn(self.inactive_member.id, ids)

    def test_ltf_finance_only_sees_active_members(self):
        self.client.force_authenticate(user=self.finance_user)
        response = self.client.get("/api/members/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {row["id"] for row in response.data}
        self.assertIn(self.member.id, ids)
        self.assertNotIn(self.inactive_member.id, ids)

    def test_ltf_admin_cannot_access_inactive_member_detail(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.get(f"/api/members/{self.inactive_member.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_ltf_finance_cannot_access_inactive_member_detail(self):
        self.client.force_authenticate(user=self.finance_user)
        response = self.client.get(f"/api/members/{self.inactive_member.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_ltf_admin_cannot_create_member(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            "/api/members/",
            {
                "club": self.club.id,
                "first_name": "Ari",
                "last_name": "Kim",
                "sex": "M",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_club_admin_create_member_auto_generates_ltf_licenseid_with_prefix(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            "/api/members/",
            {
                "club": self.club.id,
                "first_name": "Ari",
                "last_name": "Kim",
                "sex": "M",
                "ltf_license_prefix": "LUX",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        created_id = response.data["id"]
        created_member = Member.objects.get(id=created_id)
        self.assertTrue(created_member.ltf_licenseid.startswith("LUX-"))
        self.assertEqual(created_member.ltf_licenseid, response.data["ltf_licenseid"])

    def test_club_admin_create_member_auto_generates_ltf_licenseid_with_default_prefix(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            "/api/members/",
            {
                "club": self.club.id,
                "first_name": "Iris",
                "last_name": "Cole",
                "sex": "F",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        created_member = Member.objects.get(id=response.data["id"])
        self.assertTrue(created_member.ltf_licenseid.startswith("LTF-"))
        self.assertEqual(created_member.ltf_licenseid, response.data["ltf_licenseid"])

    def test_club_admin_create_member_falls_back_when_counter_table_missing(self):
        self.client.force_authenticate(user=self.club_admin)
        with patch(
            "members.services.MemberLicenseIdCounter.objects.select_for_update",
            side_effect=ProgrammingError("relation does not exist"),
        ):
            response = self.client.post(
                "/api/members/",
                {
                    "club": self.club.id,
                    "first_name": "Lina",
                    "last_name": "Vale",
                    "sex": "F",
                    "ltf_license_prefix": "LTF",
                },
                format="json",
            )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        created_member = Member.objects.get(id=response.data["id"])
        self.assertTrue(created_member.ltf_licenseid.startswith("LTF-"))

    def test_member_create_rejects_duplicate_wt_licenseid(self):
        self.member.wt_licenseid = "WT-0001"
        self.member.save(update_fields=["wt_licenseid", "updated_at"])
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            "/api/members/",
            {
                "club": self.club.id,
                "first_name": "Nina",
                "last_name": "Park",
                "sex": "F",
                "wt_licenseid": "wt-0001",
                "ltf_license_prefix": "LTF",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("wt_licenseid", response.data)

    def test_member_create_rejects_duplicate_ltf_licenseid(self):
        self.member.ltf_licenseid = "LTF-000001"
        self.member.save(update_fields=["ltf_licenseid", "updated_at"])
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            "/api/members/",
            {
                "club": self.club.id,
                "first_name": "Nina",
                "last_name": "Park",
                "sex": "F",
                "ltf_licenseid": "ltf-000001",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("ltf_licenseid", response.data)

    def test_ltf_admin_cannot_update_member(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.patch(
            f"/api/members/{self.member.id}/",
            {"belt_rank": "3rd Dan"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_ltf_admin_cannot_delete_member(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.delete(f"/api/members/{self.member.id}/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_ltf_admin_cannot_promote_grade(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            f"/api/members/{self.member.id}/promote-grade/",
            {"to_grade": "2nd Dan"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_ltf_admin_cannot_upload_profile_picture(self):
        self.member_user.give_consent()
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            f"/api/members/{self.member.id}/profile-picture/",
            {
                "processed_image": self._make_test_image("processed.jpg"),
                "photo_consent_confirmed": "true",
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_coach_can_patch_belt_rank(self):
        self.client.force_authenticate(user=self.coach_user)
        response = self.client.patch(
            f"/api/members/{self.member.id}/",
            {"belt_rank": "2nd Dan"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.member.refresh_from_db()
        self.assertEqual(self.member.belt_rank, "2nd Dan")

    def test_coach_cannot_patch_non_belt_fields(self):
        self.client.force_authenticate(user=self.coach_user)
        response = self.client.patch(
            f"/api/members/{self.member.id}/",
            {"first_name": "Updated"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.member.refresh_from_db()
        self.assertEqual(self.member.first_name, "Mia")

    def test_coach_cannot_toggle_member_status(self):
        self.client.force_authenticate(user=self.coach_user)
        response = self.client.patch(
            f"/api/members/{self.member.id}/",
            {"is_active": False},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.member.refresh_from_db()
        self.assertTrue(self.member.is_active)

    def test_club_admin_can_patch_member_license_roles(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.patch(
            f"/api/members/{self.member.id}/",
            {
                "primary_license_role": "athlete",
                "secondary_license_role": "coach",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.member.refresh_from_db()
        self.assertEqual(self.member.primary_license_role, "athlete")
        self.assertEqual(self.member.secondary_license_role, "coach")

    def test_member_update_rejects_secondary_role_without_primary(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.patch(
            f"/api/members/{self.member.id}/",
            {"secondary_license_role": "coach"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("secondary_license_role", response.data)

    def test_member_update_rejects_duplicate_primary_secondary_roles(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.patch(
            f"/api/members/{self.member.id}/",
            {
                "primary_license_role": "coach",
                "secondary_license_role": "coach",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("secondary_license_role", response.data)

    def test_coach_cannot_patch_member_license_roles(self):
        self.client.force_authenticate(user=self.coach_user)
        response = self.client.patch(
            f"/api/members/{self.member.id}/",
            {"primary_license_role": "athlete"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.member.refresh_from_db()
        self.assertEqual(self.member.primary_license_role, "")

    def test_coach_cannot_create_member(self):
        self.client.force_authenticate(user=self.coach_user)
        response = self.client.post(
            "/api/members/",
            {
                "club": self.club.id,
                "first_name": "Ari",
                "last_name": "Kim",
                "sex": "M",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_coach_cannot_delete_member(self):
        self.client.force_authenticate(user=self.coach_user)
        response = self.client.delete(f"/api/members/{self.member.id}/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_promote_grade_creates_history_and_syncs_member(self):
        self.member_user.give_consent()
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            f"/api/members/{self.member.id}/promote-grade/",
            {
                "to_grade": "2nd Dan",
                "promotion_date": "2026-06-01",
                "notes": "Strong exam",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.member.refresh_from_db()
        self.assertEqual(self.member.belt_rank, "2nd Dan")
        self.assertEqual(GradePromotionHistory.objects.filter(member=self.member).count(), 1)

    def test_member_can_view_own_history(self):
        license_record = License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
            year=2026,
            status=License.Status.PENDING,
        )
        LicenseHistoryEvent.objects.create(
            member=self.member,
            license=license_record,
            club=self.club,
            event_type=LicenseHistoryEvent.EventType.ISSUED,
            license_year=license_record.year,
            status_after=license_record.status,
            club_name_snapshot=self.club.name,
        )
        add_grade_promotion(self.member, to_grade="1st Dan", actor=self.club_admin)

        self.client.force_authenticate(user=self.member_user)
        response = self.client.get(f"/api/members/{self.member.id}/history/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["license_history"]), 1)
        self.assertEqual(len(response.data["grade_history"]), 1)

    def test_finance_history_only_financial_events(self):
        license_record = License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
            year=2026,
            status=License.Status.PENDING,
        )
        LicenseHistoryEvent.objects.create(
            member=self.member,
            license=license_record,
            club=self.club,
            event_type=LicenseHistoryEvent.EventType.ISSUED,
            license_year=license_record.year,
            status_after=license_record.status,
            club_name_snapshot=self.club.name,
        )
        order_license = License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
            year=2027,
            status=License.Status.PENDING,
        )
        from licenses.models import Order

        order = Order.objects.create(club=self.club, member=self.member)
        LicenseHistoryEvent.objects.create(
            member=self.member,
            license=order_license,
            club=self.club,
            order=order,
            event_type=LicenseHistoryEvent.EventType.ISSUED,
            license_year=order_license.year,
            status_after=order_license.status,
            club_name_snapshot=self.club.name,
        )

        self.client.force_authenticate(user=self.finance_user)
        response = self.client.get(f"/api/members/{self.member.id}/license-history/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)

    def test_finance_cannot_view_grade_history(self):
        self.client.force_authenticate(user=self.finance_user)
        response = self.client.get(f"/api/members/{self.member.id}/grade-history/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_member_upload_profile_picture_success(self):
        self.member_user.give_consent()
        self.client.force_authenticate(user=self.member_user)
        response = self.client.post(
            f"/api/members/{self.member.id}/profile-picture/",
            {
                "processed_image": self._make_test_image("processed.jpg"),
                "original_image": self._make_test_image("original.jpg"),
                "photo_edit_metadata": json.dumps({"source": "tests"}),
                "photo_consent_confirmed": "true",
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data["has_profile_picture"])

        get_response = self.client.get(f"/api/members/{self.member.id}/profile-picture/")
        self.assertEqual(get_response.status_code, status.HTTP_200_OK)
        self.assertTrue(get_response.data["has_profile_picture"])

        detail_response = self.client.get(f"/api/members/{self.member.id}/")
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertIn(
            f"/api/members/{self.member.id}/profile-picture/processed/",
            str(detail_response.data["profile_picture_url"]),
        )
        self.assertIn(
            f"/api/members/{self.member.id}/profile-picture/thumbnail/",
            str(detail_response.data["profile_picture_thumbnail_url"]),
        )

    def test_profile_picture_upload_tolerates_optional_storage_failures(self):
        from django.db.models.fields.files import FieldFile

        self.member_user.give_consent()
        self.client.force_authenticate(user=self.member_user)

        original_save = FieldFile.save

        def flaky_save(field_file, name, content, save=True):
            if field_file.field.name in {
                "profile_picture_original",
                "profile_picture_thumbnail",
            }:
                raise OSError("simulated optional storage failure")
            return original_save(field_file, name, content, save=save)

        with patch.object(FieldFile, "save", autospec=True, side_effect=flaky_save):
            response = self.client.post(
                f"/api/members/{self.member.id}/profile-picture/",
                {
                    "processed_image": self._make_test_image("processed.jpg"),
                    "original_image": self._make_test_image("original.jpg"),
                    "photo_edit_metadata": json.dumps({"source": "tests"}),
                    "photo_consent_confirmed": "true",
                },
                format="multipart",
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.member.refresh_from_db()
        self.assertTrue(bool(self.member.profile_picture_processed))
        self.assertFalse(bool(self.member.profile_picture_original))
        self.assertFalse(bool(self.member.profile_picture_thumbnail))
        self.assertTrue(self.member.photo_edit_metadata.get("original_storage_skipped"))
        self.assertTrue(self.member.photo_edit_metadata.get("thumbnail_storage_skipped"))

    def test_profile_picture_upload_requires_checkbox_consent(self):
        self.member_user.give_consent()
        self.client.force_authenticate(user=self.member_user)
        response = self.client.post(
            f"/api/members/{self.member.id}/profile-picture/",
            {
                "processed_image": self._make_test_image("processed.jpg"),
                "photo_consent_confirmed": "false",
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_profile_picture_upload_requires_member_consent(self):
        self.client.force_authenticate(user=self.member_user)
        response = self.client.post(
            f"/api/members/{self.member.id}/profile-picture/",
            {
                "processed_image": self._make_test_image("processed.jpg"),
                "photo_consent_confirmed": "true",
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_profile_picture_upload_rejects_too_small_resolution(self):
        self.member_user.give_consent()
        self.client.force_authenticate(user=self.member_user)
        response = self.client.post(
            f"/api/members/{self.member.id}/profile-picture/",
            {
                "processed_image": self._make_test_image(
                    "tiny.jpg", width=200, height=300
                ),
                "photo_consent_confirmed": "true",
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_finance_cannot_upload_profile_picture(self):
        self.member_user.give_consent()
        self.client.force_authenticate(user=self.finance_user)
        response = self.client.post(
            f"/api/members/{self.member.id}/profile-picture/",
            {
                "processed_image": self._make_test_image("processed.jpg"),
                "photo_consent_confirmed": "true",
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_club_admin_can_delete_member_profile_picture(self):
        self.member_user.give_consent()
        self.client.force_authenticate(user=self.club_admin)
        upload_response = self.client.post(
            f"/api/members/{self.member.id}/profile-picture/",
            {
                "processed_image": self._make_test_image("processed.jpg"),
                "photo_consent_confirmed": "true",
            },
            format="multipart",
        )
        self.assertEqual(upload_response.status_code, status.HTTP_201_CREATED)

        delete_response = self.client.delete(f"/api/members/{self.member.id}/profile-picture/")
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)
        self.member.refresh_from_db()
        self.assertFalse(self.member.profile_picture_processed)
        self.assertFalse(self.member.profile_picture_thumbnail)

    def test_profile_picture_download_returns_file(self):
        self.member_user.give_consent()
        self.client.force_authenticate(user=self.member_user)
        upload_response = self.client.post(
            f"/api/members/{self.member.id}/profile-picture/",
            {
                "processed_image": self._make_test_image("processed.jpg"),
                "photo_consent_confirmed": "true",
            },
            format="multipart",
        )
        self.assertEqual(upload_response.status_code, status.HTTP_201_CREATED)

        download_response = self.client.get(
            f"/api/members/{self.member.id}/profile-picture/download/"
        )
        self.assertEqual(download_response.status_code, status.HTTP_200_OK)
        self.assertIn("attachment", download_response.get("Content-Disposition", ""))

    def test_profile_picture_processed_and_thumbnail_endpoints_return_files(self):
        self.member_user.give_consent()
        self.client.force_authenticate(user=self.member_user)
        upload_response = self.client.post(
            f"/api/members/{self.member.id}/profile-picture/",
            {
                "processed_image": self._make_test_image("processed.jpg"),
                "photo_consent_confirmed": "true",
            },
            format="multipart",
        )
        self.assertEqual(upload_response.status_code, status.HTTP_201_CREATED)

        processed_response = self.client.get(
            f"/api/members/{self.member.id}/profile-picture/processed/"
        )
        self.assertEqual(processed_response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            str(processed_response.get("Content-Type", "")).startswith("image/")
        )
        self.assertNotIn(
            "attachment", str(processed_response.get("Content-Disposition", "")).lower()
        )

        thumbnail_response = self.client.get(
            f"/api/members/{self.member.id}/profile-picture/thumbnail/"
        )
        self.assertEqual(thumbnail_response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            str(thumbnail_response.get("Content-Type", "")).startswith("image/")
        )


class GradePromotionModelTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="ltf-admin-grade",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.club = Club.objects.create(
            name="Dojang",
            city="Luxembourg",
            address="Main Road",
            created_by=self.admin,
        )
        self.member = Member.objects.create(
            club=self.club,
            first_name="Yuna",
            last_name="Kim",
            belt_rank="8th Kup",
        )

    def test_grade_history_is_append_only(self):
        history = add_grade_promotion(self.member, to_grade="7th Kup", actor=self.admin)
        history.to_grade = "6th Kup"
        with self.assertRaises(ValidationError):
            history.save()

    def test_grade_history_must_be_chronological(self):
        add_grade_promotion(self.member, to_grade="7th Kup", actor=self.admin)
        with self.assertRaises(ValidationError):
            add_grade_promotion(
                self.member,
                to_grade="6th Kup",
                actor=self.admin,
                promotion_date=date(2000, 1, 1),
            )


class MemberImportTests(TestCase):
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
            name="North Club",
            city="Luxembourg",
            address="12 North Rd",
            created_by=self.ltf_admin,
        )
        self.club.admins.add(self.club_admin)

    def test_preview_requires_club_id(self):
        self.client.force_authenticate(user=self.club_admin)
        csv_data = "first_name,last_name\nAna,Ng\n"
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "members.csv"
        response = self.client.post(
            "/api/imports/members/preview/",
            {"file": file_obj},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_preview_club_admin_restricted(self):
        self.client.force_authenticate(user=self.club_admin)
        csv_data = "first_name,last_name\nAna,Ng\n"
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "members.csv"
        response = self.client.post(
            "/api/imports/members/preview/",
            {"file": file_obj, "club_id": self.club.id},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("headers", response.data)

    def test_confirm_creates_members(self):
        self.client.force_authenticate(user=self.ltf_admin)
        csv_data = "first_name,last_name,date_of_birth\nAna,Ng,2000-01-01\n"
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "members.csv"
        mapping = {
            "first_name": "first_name",
            "last_name": "last_name",
            "date_of_birth": "date_of_birth",
        }
        response = self.client.post(
            "/api/imports/members/confirm/",
            {
                "file": file_obj,
                "mapping": json.dumps(mapping),
                "club_id": self.club.id,
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Member.objects.count(), 1)

    def test_confirm_rejects_duplicate_ltf_licenseid(self):
        Member.objects.create(
            club=self.club,
            first_name="Existing",
            last_name="Member",
            ltf_licenseid="LTF-000777",
        )
        self.client.force_authenticate(user=self.ltf_admin)
        csv_data = "first_name,last_name,ltf_id\nAna,Ng,LTF-000777\n"
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "members_duplicate_ltf.csv"
        mapping = {
            "first_name": "first_name",
            "last_name": "last_name",
            "ltf_licenseid": "ltf_id",
        }
        response = self.client.post(
            "/api/imports/members/confirm/",
            {
                "file": file_obj,
                "mapping": json.dumps(mapping),
                "club_id": self.club.id,
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["created"], 0)
        self.assertEqual(len(response.data["errors"]), 1)
        self.assertIn("ltf_licenseid must be unique", response.data["errors"][0]["errors"])

    def test_preview_reports_invalid_license_role(self):
        self.client.force_authenticate(user=self.ltf_admin)
        csv_data = "first_name,last_name,primary_role\nAna,Ng,InvalidRole\n"
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "members_invalid_roles.csv"
        mapping = {
            "first_name": "first_name",
            "last_name": "last_name",
            "primary_license_role": "primary_role",
        }
        response = self.client.post(
            "/api/imports/members/preview/",
            {
                "file": file_obj,
                "mapping": json.dumps(mapping),
                "club_id": self.club.id,
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["rows"]), 1)
        self.assertTrue(response.data["rows"][0]["errors"])

    def test_confirm_creates_members_with_license_roles(self):
        self.client.force_authenticate(user=self.ltf_admin)
        csv_data = "first_name,last_name,primary_role,secondary_role\nAna,Ng,Athlete,Coach\n"
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "members_roles.csv"
        mapping = {
            "first_name": "first_name",
            "last_name": "last_name",
            "primary_license_role": "primary_role",
            "secondary_license_role": "secondary_role",
        }
        response = self.client.post(
            "/api/imports/members/confirm/",
            {
                "file": file_obj,
                "mapping": json.dumps(mapping),
                "club_id": self.club.id,
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        created = Member.objects.get(first_name="Ana", last_name="NG")
        self.assertEqual(created.primary_license_role, "athlete")
        self.assertEqual(created.secondary_license_role, "coach")
