from io import BytesIO
import json
import shutil
import tempfile
from datetime import date

from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient
from PIL import Image

from accounts.models import User
from clubs.models import Club
from licenses.models import License, LicenseHistoryEvent

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

        self.club = Club.objects.create(
            name="Central Club",
            city="Luxembourg",
            address="10 Center Rd",
            created_by=self.ltf_admin,
        )
        self.club.admins.add(self.club_admin)

        self.member = Member.objects.create(
            user=self.member_user,
            club=self.club,
            first_name="Mia",
            last_name="Lee",
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
        self.assertEqual(len(response.data), 1)

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
