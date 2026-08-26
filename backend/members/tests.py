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

from .models import GradePromotionHistory, Member, MemberLicenseIdCounter
from .services import add_grade_promotion, delete_grade_promotion, generate_next_ltf_license_id


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

    def test_member_detail_includes_current_pending_license(self):
        License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
            year=2026,
            status=License.Status.PENDING,
        )
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.get(f"/api/members/{self.member.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        current_licenses = response.data["current_licenses"]
        self.assertEqual(len(current_licenses), 1)
        self.assertEqual(current_licenses[0]["status"], License.Status.PENDING)
        self.assertEqual(current_licenses[0]["year"], 2026)
        self.assertEqual(current_licenses[0]["license_type_name"], self.license_type.name)

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

    def test_ltf_admin_can_filter_members_by_issue(self):
        licensed_member = Member.objects.create(
            club=self.club,
            first_name="Pat",
            last_name="Licensed",
            ltf_licenseid="LTF-900",
            is_active=True,
        )
        License.objects.create(
            member=licensed_member,
            club=self.club,
            license_type=self.license_type,
            year=2026,
            status=License.Status.ACTIVE,
        )
        pending_member = Member.objects.create(
            club=self.club,
            first_name="Quinn",
            last_name="Pending",
            ltf_licenseid="LTF-901",
            is_active=True,
        )
        License.objects.create(
            member=pending_member,
            club=self.club,
            license_type=self.license_type,
            year=2026,
            status=License.Status.PENDING,
        )
        self.client.force_authenticate(user=self.ltf_admin)

        no_license = self.client.get("/api/members/", {"issue": "no_valid_license"})
        self.assertEqual(no_license.status_code, status.HTTP_200_OK)
        no_license_ids = {row["id"] for row in no_license.data}
        self.assertEqual(no_license_ids, {self.member.id})

        missing_id = self.client.get("/api/members/", {"issue": "missing_ltf_licenseid"})
        self.assertEqual(missing_id.status_code, status.HTTP_200_OK)
        missing_ids = {row["id"] for row in missing_id.data}
        self.assertEqual(missing_ids, {self.member.id})
        self.assertNotIn(self.inactive_member.id, missing_ids)

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
        self.assertEqual(created_member.ltf_licenseid, "LUX-0001")
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
        self.assertEqual(created_member.ltf_licenseid, "LTF-0001")
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
        self.assertEqual(created_member.ltf_licenseid, "LTF-0001")

    def test_generated_ltf_licenseid_expands_beyond_four_digits(self):
        MemberLicenseIdCounter.objects.create(prefix="LTF", next_value=10000)
        generated = generate_next_ltf_license_id(prefix="LTF")
        self.assertEqual(generated, "LTF-10000")

    def test_generated_ltf_licenseid_skips_existing_six_digit_equivalent(self):
        Member.objects.create(
            club=self.club,
            first_name="Old",
            last_name="Serial",
            ltf_licenseid="LTF-000001",
        )
        generated = generate_next_ltf_license_id(prefix="LTF")
        self.assertEqual(generated, "LTF-0002")

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

    def test_club_admin_can_patch_member_with_new_license_roles(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.patch(
            f"/api/members/{self.member.id}/",
            {
                "primary_license_role": "volunteer",
                "secondary_license_role": "staff",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.member.refresh_from_db()
        self.assertEqual(self.member.primary_license_role, "volunteer")
        self.assertEqual(self.member.secondary_license_role, "staff")

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

    def test_promote_grade_stores_created_by(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            f"/api/members/{self.member.id}/promote-grade/",
            {
                "to_grade": "3rd Dan",
                "promotion_date": "2026-07-01",
                "created_by": "LTF",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["created_by"], "LTF")

    def test_update_grade_history(self):
        self.client.force_authenticate(user=self.club_admin)
        create_response = self.client.post(
            f"/api/members/{self.member.id}/promote-grade/",
            {"to_grade": "2nd Dan", "created_by": "Club"},
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        history_id = create_response.data["id"]
        update_response = self.client.patch(
            f"/api/members/{self.member.id}/grade-history/{history_id}/",
            {"to_grade": "3rd Dan", "created_by": "Other Federation"},
            format="json",
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        self.assertEqual(update_response.data["to_grade"], "3rd Dan")
        self.assertEqual(update_response.data["created_by"], "Other Federation")
        self.member.refresh_from_db()
        self.assertEqual(self.member.belt_rank, "3rd Dan")

    def test_promote_grade_rejects_unofficial_grade(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            f"/api/members/{self.member.id}/promote-grade/",
            {"to_grade": "DAN 1"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("to_grade", response.data)
        self.member.refresh_from_db()
        self.assertNotEqual(self.member.belt_rank, "DAN 1")

    def test_delete_grade_history_resyncs_member_belt_rank(self):
        self.client.force_authenticate(user=self.club_admin)
        first = self.client.post(
            f"/api/members/{self.member.id}/promote-grade/",
            {"to_grade": "2nd Dan", "promotion_date": "2026-06-01"},
            format="json",
        )
        second = self.client.post(
            f"/api/members/{self.member.id}/promote-grade/",
            {"to_grade": "3rd Dan", "promotion_date": "2026-07-01"},
            format="json",
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        delete_response = self.client.delete(
            f"/api/members/{self.member.id}/grade-history/{second.data['id']}/"
        )
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(
            GradePromotionHistory.objects.filter(id=second.data["id"]).exists()
        )
        self.member.refresh_from_db()
        self.assertEqual(self.member.belt_rank, "2nd Dan")

    def test_delete_last_grade_history_clears_member_belt_rank(self):
        self.client.force_authenticate(user=self.club_admin)
        create_response = self.client.post(
            f"/api/members/{self.member.id}/promote-grade/",
            {"to_grade": "2nd Dan"},
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        delete_response = self.client.delete(
            f"/api/members/{self.member.id}/grade-history/{create_response.data['id']}/"
        )
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)
        self.member.refresh_from_db()
        self.assertEqual(self.member.belt_rank, "")

    def test_ltf_admin_cannot_delete_grade_history(self):
        self.client.force_authenticate(user=self.club_admin)
        create_response = self.client.post(
            f"/api/members/{self.member.id}/promote-grade/",
            {"to_grade": "2nd Dan"},
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.delete(
            f"/api/members/{self.member.id}/grade-history/{create_response.data['id']}/"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_member_update_rejects_unofficial_belt_rank(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.patch(
            f"/api/members/{self.member.id}/",
            {"belt_rank": "DAN 1"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("belt_rank", response.data)

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

    def test_grade_history_allows_updates(self):
        history = add_grade_promotion(self.member, to_grade="7th Kup", actor=self.admin)
        history.to_grade = "6th Kup"
        history.created_by = "Club"
        history.save()
        history.refresh_from_db()
        self.assertEqual(history.to_grade, "6th Kup")
        self.assertEqual(history.created_by, "Club")

    def test_grade_history_still_blocks_direct_delete(self):
        history = add_grade_promotion(self.member, to_grade="7th Kup", actor=self.admin)
        with self.assertRaises(ValidationError):
            history.delete()

    def test_delete_grade_promotion_service_removes_entry(self):
        first = add_grade_promotion(self.member, to_grade="7th Kup", actor=self.admin)
        second = add_grade_promotion(self.member, to_grade="6th Kup", actor=self.admin)
        delete_grade_promotion(second)
        self.assertFalse(GradePromotionHistory.objects.filter(id=second.id).exists())
        self.assertTrue(GradePromotionHistory.objects.filter(id=first.id).exists())
        self.member.refresh_from_db()
        self.assertEqual(self.member.belt_rank, "7th Kup")

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

    def test_confirm_creates_members_with_new_license_roles(self):
        self.client.force_authenticate(user=self.ltf_admin)
        csv_data = "first_name,last_name,primary_role,secondary_role\nBen,Kay,Volunteer,Media\n"
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "members_roles_new.csv"
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
        created = Member.objects.get(first_name="Ben", last_name="KAY")
        self.assertEqual(created.primary_license_role, "volunteer")
        self.assertEqual(created.secondary_license_role, "media")

    def test_confirm_applies_row_overrides_for_invalid_csv_roles(self):
        self.client.force_authenticate(user=self.ltf_admin)
        csv_data = "first_name,last_name,primary_role,secondary_role\nAna,Ng,BadRole,AlsoBad\n"
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "members_invalid_roles_override.csv"
        mapping = {
            "first_name": "first_name",
            "last_name": "last_name",
            "primary_license_role": "primary_role",
            "secondary_license_role": "secondary_role",
        }
        row_overrides = {
            "1": {
                "primary_license_role": "athlete",
                "secondary_license_role": "coach",
            }
        }
        response = self.client.post(
            "/api/imports/members/confirm/",
            {
                "file": file_obj,
                "mapping": json.dumps(mapping),
                "club_id": self.club.id,
                "actions": json.dumps([{"row_index": 1, "action": "create"}]),
                "row_overrides": json.dumps(row_overrides),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(response.data["errors"], [])
        created = Member.objects.get(first_name="Ana", last_name="NG")
        self.assertEqual(created.primary_license_role, "athlete")
        self.assertEqual(created.secondary_license_role, "coach")

    def test_confirm_applies_row_overrides_array_payload(self):
        self.client.force_authenticate(user=self.ltf_admin)
        csv_data = "first_name,last_name,primary_role,secondary_role\nBen,Kay,Athlete,BadSecondary\n"
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "members_invalid_secondary_override.csv"
        mapping = {
            "first_name": "first_name",
            "last_name": "last_name",
            "primary_license_role": "primary_role",
            "secondary_license_role": "secondary_role",
        }
        row_overrides = [
            {
                "row_index": 1,
                "primary_license_role": "athlete",
                "secondary_license_role": "",
            }
        ]
        response = self.client.post(
            "/api/imports/members/confirm/",
            {
                "file": file_obj,
                "mapping": json.dumps(mapping),
                "club_id": self.club.id,
                "actions": json.dumps([{"row_index": 1, "action": "create"}]),
                "row_overrides": json.dumps(row_overrides),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(response.data["errors"], [])
        created = Member.objects.get(first_name="Ben", last_name="KAY")
        self.assertEqual(created.primary_license_role, "athlete")
        self.assertEqual(created.secondary_license_role, "")

    def test_import_rewrites_ltf_prefix_when_enabled_and_leaves_wt_untouched(self):
        from clubs.models import FederationProfile

        FederationProfile.objects.create(pk=1, rewrite_lux_prefix_on_member_import=True)
        self.client.force_authenticate(user=self.club_admin)
        csv_data = "first_name,last_name,member_id\nAna,Ng,LUX-000321\n"
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "members_prefix.csv"
        mapping = {
            "first_name": "first_name",
            "last_name": "last_name",
            "wt_licenseid": "member_id",
            "ltf_licenseid": "member_id",
        }
        preview = self.client.post(
            "/api/imports/members/preview/",
            {
                "file": file_obj,
                "mapping": json.dumps(mapping),
                "club_id": self.club.id,
            },
            format="multipart",
        )
        self.assertEqual(preview.status_code, status.HTTP_200_OK)
        self.assertTrue(preview.data["ltf_license_prefix_rewrite"]["enabled"])
        self.assertEqual(preview.data["rows"][0]["data"]["wt_licenseid"], "LUX-000321")
        self.assertEqual(preview.data["rows"][0]["data"]["ltf_licenseid"], "LTF-000321")
        self.assertEqual(preview.data["ltf_license_prefix_rewrite"]["rewritten_count"], 1)

        file_obj.seek(0)
        confirm = self.client.post(
            "/api/imports/members/confirm/",
            {
                "file": file_obj,
                "mapping": json.dumps(mapping),
                "club_id": self.club.id,
            },
            format="multipart",
        )
        self.assertEqual(confirm.status_code, status.HTTP_200_OK)
        self.assertEqual(confirm.data["created"], 1)
        member = Member.objects.get(first_name="Ana", last_name="NG")
        self.assertEqual(member.wt_licenseid, "LUX-000321")
        self.assertEqual(member.ltf_licenseid, "LTF-000321")

    def test_import_keeps_lux_prefix_when_rewrite_disabled(self):
        self.client.force_authenticate(user=self.club_admin)
        csv_data = "first_name,last_name,member_id\nAna,Ng,LUX-000321\n"
        file_obj = BytesIO(csv_data.encode("utf-8"))
        file_obj.name = "members_prefix_off.csv"
        mapping = {
            "first_name": "first_name",
            "last_name": "last_name",
            "wt_licenseid": "member_id",
            "ltf_licenseid": "member_id",
        }
        confirm = self.client.post(
            "/api/imports/members/confirm/",
            {
                "file": file_obj,
                "mapping": json.dumps(mapping),
                "club_id": self.club.id,
            },
            format="multipart",
        )
        self.assertEqual(confirm.status_code, status.HTTP_200_OK)
        self.assertFalse(confirm.data["ltf_license_prefix_rewrite"]["enabled"])
        member = Member.objects.get(first_name="Ana", last_name="NG")
        self.assertEqual(member.wt_licenseid, "LUX-000321")
        self.assertEqual(member.ltf_licenseid, "LUX-000321")


class LtfLicensePrefixRewriteTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="prefixadmin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.club_admin = User.objects.create_user(
            username="prefixclub",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )
        self.club = Club.objects.create(name="Prefix Club", created_by=self.ltf_admin)
        self.club.admins.add(self.club_admin)

    def test_club_admin_cannot_enable_import_rewrite(self):
        from clubs.models import FederationProfile

        FederationProfile.objects.create(pk=1, rewrite_lux_prefix_on_member_import=False)
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.patch(
            "/api/federation-profile/",
            {"rewrite_lux_prefix_on_member_import": True},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_ltf_admin_can_rewrite_existing_ltf_ids_and_skip_conflicts(self):
        Member.objects.create(
            club=self.club,
            first_name="Mia",
            last_name="Lux",
            wt_licenseid="LUX-000111",
            ltf_licenseid="LUX-000111",
        )
        Member.objects.create(
            club=self.club,
            first_name="Leo",
            last_name="Taken",
            wt_licenseid="LUX-000222",
            ltf_licenseid="LTF-000111",
        )
        Member.objects.create(
            club=self.club,
            first_name="Noa",
            last_name="Ok",
            wt_licenseid="LUX-000333",
            ltf_licenseid="LUX-000333",
        )
        self.client.force_authenticate(user=self.ltf_admin)
        preview = self.client.get("/api/members/ltf-license-prefix-rewrite/")
        self.assertEqual(preview.status_code, status.HTTP_200_OK)
        self.assertEqual(preview.data["candidate_count"], 1)
        self.assertEqual(preview.data["conflict_count"], 1)

        apply_response = self.client.post("/api/members/ltf-license-prefix-rewrite/")
        self.assertEqual(apply_response.status_code, status.HTTP_200_OK)
        self.assertEqual(apply_response.data["rewritten"], 1)
        mia = Member.objects.get(first_name="Mia")
        leo = Member.objects.get(first_name="Leo")
        noa = Member.objects.get(first_name="Noa")
        self.assertEqual(mia.ltf_licenseid, "LUX-000111")
        self.assertEqual(mia.wt_licenseid, "LUX-000111")
        self.assertEqual(leo.ltf_licenseid, "LTF-000111")
        self.assertEqual(noa.ltf_licenseid, "LTF-000333")
        self.assertEqual(noa.wt_licenseid, "LUX-000333")

    def test_club_admin_cannot_rewrite_existing_ltf_ids(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post("/api/members/ltf-license-prefix-rewrite/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


@override_settings(
    RESEND_API_KEY="replace-me",
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
)
class MemberTransferApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="transfer-ltf",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
            email="ltf.transfer@example.com",
        )
        self.source_admin = User.objects.create_user(
            username="source-admin",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
            email="source.admin@example.com",
        )
        self.dest_admin = User.objects.create_user(
            username="dest-admin",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
            email="dest.admin@example.com",
        )
        self.source_club = Club.objects.create(
            name="Source Club",
            city="Luxembourg",
            created_by=self.ltf_admin,
        )
        self.dest_club = Club.objects.create(
            name="Dest Club",
            city="Esch",
            created_by=self.ltf_admin,
        )
        self.source_club.admins.add(self.source_admin)
        self.dest_club.admins.add(self.dest_admin)
        self.athlete = Member.objects.create(
            club=self.source_club,
            first_name="Alex",
            last_name="Moved",
            email="alex.moved@example.com",
        )
        self.license_type = LicenseType.objects.create(name="Transfer Paid", code="transfer-paid")
        self.license = License.objects.create(
            member=self.athlete,
            club=self.source_club,
            license_type=self.license_type,
            year=2026,
            status=License.Status.ACTIVE,
        )

    def test_club_admin_can_create_free_transfer_and_destination_completes_it(self):
        self.client.force_authenticate(user=self.source_admin)
        from django.core import mail
        from django.test import override_settings

        with override_settings(
            RESEND_API_KEY="replace-me",
            EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        ):
            created = self.client.post(
                "/api/member-transfers/",
                {
                    "member_id": self.athlete.id,
                    "to_club_id": self.dest_club.id,
                    "fee_amount": "0",
                    "note": "Please take Alex.",
                    "locale": "en",
                },
                format="json",
            )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data["status"], "pending")
        self.assertFalse(created.data["has_fee"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("dest.admin@example.com", mail.outbox[0].to)

        transfer_id = created.data["id"]
        self.client.force_authenticate(user=self.dest_admin)
        with override_settings(
            RESEND_API_KEY="replace-me",
            EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        ):
            accepted = self.client.post(
                f"/api/member-transfers/{transfer_id}/accept/",
                {"locale": "en"},
                format="json",
            )
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.data["status"], "completed")
        self.athlete.refresh_from_db()
        self.license.refresh_from_db()
        self.assertEqual(self.athlete.club_id, self.dest_club.id)
        self.assertEqual(self.license.club_id, self.dest_club.id)

    def test_fee_transfer_notifies_ltf_admin(self):
        self.client.force_authenticate(user=self.source_admin)
        from django.core import mail
        from django.test import override_settings

        with override_settings(
            RESEND_API_KEY="replace-me",
            EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        ):
            created = self.client.post(
                "/api/member-transfers/",
                {
                    "member_id": self.athlete.id,
                    "to_club_id": self.dest_club.id,
                    "fee_amount": "150.00",
                    "locale": "en",
                },
                format="json",
            )
        self.assertEqual(created.status_code, 201)
        self.assertTrue(created.data["has_fee"])
        self.assertTrue(created.data["ltf_notified"])
        recipients = [address for message in mail.outbox for address in message.to]
        self.assertIn("dest.admin@example.com", recipients)
        self.assertIn("ltf.transfer@example.com", recipients)

    def test_cannot_transfer_source_club_admin(self):
        admin_member = Member.objects.create(
            user=self.source_admin,
            club=self.source_club,
            first_name="Source",
            last_name="Admin",
        )
        self.client.force_authenticate(user=self.source_admin)
        response = self.client.post(
            "/api/member-transfers/",
            {"member_id": admin_member.id, "to_club_id": self.dest_club.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "member_is_club_admin")

    def test_destination_can_message_and_source_can_cancel(self):
        self.client.force_authenticate(user=self.source_admin)
        created = self.client.post(
            "/api/member-transfers/",
            {"member_id": self.athlete.id, "to_club_id": self.dest_club.id},
            format="json",
        )
        transfer_id = created.data["id"]
        self.client.force_authenticate(user=self.dest_admin)
        messaged = self.client.post(
            f"/api/member-transfers/{transfer_id}/messages/",
            {"body": "Can we make this free?"},
            format="json",
        )
        self.assertEqual(messaged.status_code, 201)
        self.assertEqual(len(messaged.data["messages"]), 1)
        self.client.force_authenticate(user=self.source_admin)
        cancelled = self.client.post(f"/api/member-transfers/{transfer_id}/cancel/", {}, format="json")
        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(cancelled.data["status"], "cancelled")
        self.athlete.refresh_from_db()
        self.assertEqual(self.athlete.club_id, self.source_club.id)

