from decimal import Decimal
from io import BytesIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from PIL import Image

from accounts.models import User
from clubs.models import Club
from members.models import Member

from .models import (
    CardFormatPreset,
    CardTemplate,
    CardTemplateVersion,
    FinanceAuditLog,
    License,
    LicenseType,
    PaperProfile,
    PrintJob,
    PrintJobItem,
)


def _sample_design_payload() -> dict:
    return {
        "elements": [
            {
                "id": "member-name",
                "type": "text",
                "x_mm": "2.00",
                "y_mm": "2.00",
                "width_mm": "40.00",
                "height_mm": "8.00",
                "text": "{{member.first_name}} {{member.last_name}}",
            }
        ],
        "metadata": {"unit": "mm"},
    }


def _sample_render_design_payload() -> dict:
    return {
        "elements": [
            {
                "id": "shape-bg",
                "type": "shape",
                "x_mm": "0.00",
                "y_mm": "0.00",
                "width_mm": "85.60",
                "height_mm": "53.98",
                "z_index": 0,
                "style": {
                    "background_color": "#f3f4f6",
                    "border_color": "#d1d5db",
                    "border_width_mm": "0.20",
                },
            },
            {
                "id": "member-name",
                "type": "text",
                "x_mm": "4.00",
                "y_mm": "4.00",
                "width_mm": "50.00",
                "height_mm": "8.00",
                "text": "{{member.full_name}}",
                "z_index": 3,
            },
            {
                "id": "member-photo",
                "type": "image",
                "x_mm": "62.00",
                "y_mm": "4.00",
                "width_mm": "20.00",
                "height_mm": "20.00",
                "source": "member.profile_picture_processed",
                "z_index": 2,
            },
            {
                "id": "license-barcode",
                "type": "barcode",
                "x_mm": "4.00",
                "y_mm": "43.00",
                "width_mm": "50.00",
                "height_mm": "8.00",
                "merge_field": "member.ltf_licenseid",
                "z_index": 4,
            },
            {
                "id": "license-qr",
                "type": "qr",
                "x_mm": "62.00",
                "y_mm": "28.00",
                "width_mm": "20.00",
                "height_mm": "20.00",
                "merge_field": "qr.validation_url",
                "z_index": 5,
            },
        ],
        "metadata": {"unit": "mm"},
    }


def _build_uploaded_png(name: str = "preview-photo.png") -> SimpleUploadedFile:
    buffer = BytesIO()
    image = Image.new("RGB", (32, 32), color=(16, 185, 129))
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")


class LicenseCardRoleAccessTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="cards-ltf-admin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.club_admin = User.objects.create_user(
            username="cards-club-admin",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )
        self.coach = User.objects.create_user(
            username="cards-coach",
            password="pass12345",
            role=User.Roles.COACH,
        )
        self.member_user = User.objects.create_user(
            username="cards-member",
            password="pass12345",
            role=User.Roles.MEMBER,
        )
        self.ltf_finance = User.objects.create_user(
            username="cards-finance",
            password="pass12345",
            role=User.Roles.LTF_FINANCE,
        )
        self.club = Club.objects.create(name="Cards Club", created_by=self.ltf_admin)
        self.club.admins.add(self.club_admin)
        self.other_club = Club.objects.create(name="Other Cards Club", created_by=self.ltf_admin)
        self.card_format = CardFormatPreset.objects.get(code="3c")
        self.paper_profile = PaperProfile.objects.get(code="sigel-lp798")
        self.template = CardTemplate.objects.create(
            name="Foundation Template",
            description="Base template for role tests",
            is_default=True,
            created_by=self.ltf_admin,
            updated_by=self.ltf_admin,
        )
        self.published_version = CardTemplateVersion.objects.create(
            template=self.template,
            version_number=1,
            status=CardTemplateVersion.Status.PUBLISHED,
            card_format=self.card_format,
            paper_profile=self.paper_profile,
            design_payload=_sample_design_payload(),
            created_by=self.ltf_admin,
            published_by=self.ltf_admin,
            published_at=timezone.now(),
        )
        self.draft_version = CardTemplateVersion.objects.create(
            template=self.template,
            version_number=2,
            status=CardTemplateVersion.Status.DRAFT,
            card_format=self.card_format,
            paper_profile=self.paper_profile,
            design_payload=_sample_design_payload(),
            created_by=self.ltf_admin,
        )
        self.license_type = LicenseType.objects.create(name="Role License", code="role-license")
        self.own_member = Member.objects.create(
            club=self.club,
            first_name="Own",
            last_name="Admin",
            ltf_licenseid="LTF-ROLE-OWN-001",
        )
        self.other_member = Member.objects.create(
            club=self.other_club,
            first_name="Other",
            last_name="Admin",
            ltf_licenseid="LTF-ROLE-OTHER-001",
        )
        self.own_license = License.objects.create(
            member=self.own_member,
            club=self.club,
            license_type=self.license_type,
            year=timezone.localdate().year,
            status=License.Status.ACTIVE,
        )
        self.other_license = License.objects.create(
            member=self.other_member,
            club=self.other_club,
            license_type=self.license_type,
            year=timezone.localdate().year,
            status=License.Status.ACTIVE,
        )

    def test_ltf_admin_has_full_template_and_version_access(self):
        self.client.force_authenticate(user=self.ltf_admin)
        create_template_response = self.client.post(
            "/api/card-templates/",
            {"name": "Admin Template", "description": "Managed by admin"},
            format="json",
        )
        self.assertEqual(create_template_response.status_code, status.HTTP_201_CREATED)

        create_version_response = self.client.post(
            "/api/card-template-versions/",
            {
                "template": self.template.id,
                "label": "Draft V3",
                "card_format": self.card_format.id,
                "paper_profile": self.paper_profile.id,
                "design_payload": _sample_design_payload(),
            },
            format="json",
        )
        self.assertEqual(create_version_response.status_code, status.HTTP_201_CREATED)

    def test_club_admin_is_read_only_for_templates_and_versions(self):
        self.client.force_authenticate(user=self.club_admin)
        list_templates_response = self.client.get("/api/card-templates/")
        self.assertEqual(list_templates_response.status_code, status.HTTP_200_OK)
        self.assertTrue(any(row["id"] == self.template.id for row in list_templates_response.data))

        list_versions_response = self.client.get(
            f"/api/card-template-versions/?template_id={self.template.id}"
        )
        self.assertEqual(list_versions_response.status_code, status.HTTP_200_OK)
        returned_ids = {row["id"] for row in list_versions_response.data}
        self.assertIn(self.published_version.id, returned_ids)
        self.assertNotIn(self.draft_version.id, returned_ids)

        create_template_response = self.client.post(
            "/api/card-templates/",
            {"name": "Club Admin Template"},
            format="json",
        )
        self.assertEqual(create_template_response.status_code, status.HTTP_403_FORBIDDEN)

        create_version_response = self.client.post(
            "/api/card-template-versions/",
            {
                "template": self.template.id,
                "card_format": self.card_format.id,
                "paper_profile": self.paper_profile.id,
                "design_payload": _sample_design_payload(),
            },
            format="json",
        )
        self.assertEqual(create_version_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_coach_member_finance_are_denied_template_access(self):
        for user in [self.coach, self.member_user, self.ltf_finance]:
            with self.subTest(role=user.role):
                self.client.force_authenticate(user=user)
                response = self.client.get("/api/card-templates/")
                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_paper_profile_and_merge_fields_access_matrix(self):
        self.client.force_authenticate(user=self.club_admin)
        list_profiles_response = self.client.get("/api/paper-profiles/")
        self.assertEqual(list_profiles_response.status_code, status.HTTP_200_OK)
        create_profile_response = self.client.post(
            "/api/paper-profiles/",
            {
                "code": "club-custom",
                "name": "Club Custom",
                "card_format": self.card_format.id,
                "sheet_width_mm": "210.00",
                "sheet_height_mm": "297.00",
                "card_width_mm": "85.60",
                "card_height_mm": "53.98",
                "margin_top_mm": "1.00",
                "margin_bottom_mm": "1.00",
                "margin_left_mm": "1.00",
                "margin_right_mm": "1.00",
                "horizontal_gap_mm": "0.00",
                "vertical_gap_mm": "0.00",
                "columns": 2,
                "rows": 5,
                "slot_count": 10,
            },
            format="json",
        )
        self.assertEqual(create_profile_response.status_code, status.HTTP_403_FORBIDDEN)

        merge_fields_response = self.client.get("/api/merge-fields/")
        self.assertEqual(merge_fields_response.status_code, status.HTTP_200_OK)
        self.assertTrue(any(item["key"] == "member.first_name" for item in merge_fields_response.data))

        for user in [self.coach, self.member_user, self.ltf_finance]:
            with self.subTest(role=user.role):
                self.client.force_authenticate(user=user)
                denied_response = self.client.get("/api/merge-fields/")
                self.assertEqual(denied_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_print_job_permissions(self):
        self.client.force_authenticate(user=self.club_admin)
        own_club_response = self.client.post(
            "/api/print-jobs/",
            {
                "club": self.club.id,
                "template_version": self.published_version.id,
                "paper_profile": self.paper_profile.id,
                "license_ids": [self.own_license.id],
                "selected_slots": [0],
                "metadata": {"trigger": "club-admin"},
            },
            format="json",
        )
        self.assertEqual(own_club_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(own_club_response.data["status"], PrintJob.Status.DRAFT)

        other_club_response = self.client.post(
            "/api/print-jobs/",
            {
                "club": self.other_club.id,
                "template_version": self.published_version.id,
                "paper_profile": self.paper_profile.id,
                "license_ids": [self.other_license.id],
            },
            format="json",
        )
        self.assertEqual(other_club_response.status_code, status.HTTP_403_FORBIDDEN)

        ltf_created_job = PrintJob.objects.create(
            club=self.other_club,
            template_version=self.published_version,
            paper_profile=self.paper_profile,
            total_items=1,
            requested_by=self.ltf_admin,
        )
        denied_retrieve = self.client.get(f"/api/print-jobs/{ltf_created_job.id}/")
        denied_execute = self.client.post(
            f"/api/print-jobs/{ltf_created_job.id}/execute/",
            {},
            format="json",
        )
        self.assertEqual(denied_retrieve.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(denied_execute.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.ltf_finance)
        denied_response = self.client.get("/api/print-jobs/")
        self.assertEqual(denied_response.status_code, status.HTTP_403_FORBIDDEN)


class LicenseCardVersionWorkflowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="cards-workflow-admin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.card_format = CardFormatPreset.objects.get(code="3c")
        self.paper_profile = PaperProfile.objects.get(code="sigel-lp798")
        self.template = CardTemplate.objects.create(
            name="Workflow Template",
            description="Template used for version workflow tests",
            created_by=self.ltf_admin,
            updated_by=self.ltf_admin,
        )
        self.client.force_authenticate(user=self.ltf_admin)

    def test_draft_publish_and_published_immutability(self):
        create_response = self.client.post(
            "/api/card-template-versions/",
            {
                "template": self.template.id,
                "label": "Draft V1",
                "card_format": self.card_format.id,
                "paper_profile": self.paper_profile.id,
                "design_payload": _sample_design_payload(),
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        version_id = create_response.data["id"]
        self.assertEqual(create_response.data["status"], CardTemplateVersion.Status.DRAFT)
        self.assertEqual(create_response.data["version_number"], 1)

        patch_response = self.client.patch(
            f"/api/card-template-versions/{version_id}/",
            {"label": "Draft V1.1"},
            format="json",
        )
        self.assertEqual(patch_response.status_code, status.HTTP_200_OK)

        publish_response = self.client.post(
            f"/api/card-template-versions/{version_id}/publish/",
            {},
            format="json",
        )
        self.assertEqual(publish_response.status_code, status.HTTP_200_OK)
        self.assertEqual(publish_response.data["status"], CardTemplateVersion.Status.PUBLISHED)

        immutable_patch_response = self.client.patch(
            f"/api/card-template-versions/{version_id}/",
            {"label": "Should fail"},
            format="json",
        )
        self.assertEqual(immutable_patch_response.status_code, status.HTTP_400_BAD_REQUEST)

        publish_again_response = self.client.post(
            f"/api/card-template-versions/{version_id}/publish/",
            {},
            format="json",
        )
        self.assertEqual(publish_again_response.status_code, status.HTTP_200_OK)
        self.assertEqual(publish_again_response.data["status"], CardTemplateVersion.Status.PUBLISHED)

    def test_clone_save_as_new_template(self):
        source_version = CardTemplateVersion.objects.create(
            template=self.template,
            version_number=1,
            label="Source Published",
            status=CardTemplateVersion.Status.PUBLISHED,
            card_format=self.card_format,
            paper_profile=self.paper_profile,
            design_payload=_sample_design_payload(),
            created_by=self.ltf_admin,
            published_by=self.ltf_admin,
            published_at=timezone.now(),
        )
        self.assertIsNotNone(source_version.id)

        clone_response = self.client.post(
            f"/api/card-templates/{self.template.id}/clone/",
            {"name": "Workflow Template Copy", "source_version_id": source_version.id},
            format="json",
        )
        self.assertEqual(clone_response.status_code, status.HTTP_201_CREATED)
        cloned_template_id = clone_response.data["id"]
        self.assertNotEqual(cloned_template_id, self.template.id)

        cloned_template = CardTemplate.objects.get(id=cloned_template_id)
        cloned_version = cloned_template.versions.get(version_number=1)
        self.assertEqual(cloned_version.status, CardTemplateVersion.Status.DRAFT)
        self.assertEqual(cloned_version.card_format_id, source_version.card_format_id)
        self.assertEqual(cloned_version.paper_profile_id, source_version.paper_profile_id)
        self.assertEqual(cloned_version.design_payload, source_version.design_payload)

    def test_set_default_template_action(self):
        first_template = CardTemplate.objects.create(
            name="Default A",
            is_default=True,
            created_by=self.ltf_admin,
            updated_by=self.ltf_admin,
        )
        second_template = CardTemplate.objects.create(
            name="Default B",
            is_default=False,
            created_by=self.ltf_admin,
            updated_by=self.ltf_admin,
        )
        self.assertTrue(first_template.is_default)
        response = self.client.post(
            f"/api/card-templates/{second_template.id}/set-default/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        first_template.refresh_from_db()
        second_template.refresh_from_db()
        self.assertFalse(first_template.is_default)
        self.assertTrue(second_template.is_default)


class LicenseCardValidationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="cards-validation-admin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.client.force_authenticate(user=self.ltf_admin)
        self.card_format = CardFormatPreset.objects.get(code="3c")
        self.paper_profile = PaperProfile.objects.get(code="sigel-lp798")
        self.template = CardTemplate.objects.create(
            name="Validation Template",
            created_by=self.ltf_admin,
            updated_by=self.ltf_admin,
        )

    def test_reject_non_positive_mm_values(self):
        response = self.client.post(
            "/api/paper-profiles/",
            {
                "code": "invalid-mm",
                "name": "Invalid MM",
                "card_format": self.card_format.id,
                "sheet_width_mm": "0.00",
                "sheet_height_mm": "297.00",
                "card_width_mm": "85.60",
                "card_height_mm": "53.98",
                "margin_top_mm": "1.00",
                "margin_bottom_mm": "1.00",
                "margin_left_mm": "1.00",
                "margin_right_mm": "1.00",
                "horizontal_gap_mm": "0.00",
                "vertical_gap_mm": "0.00",
                "columns": 2,
                "rows": 5,
                "slot_count": 10,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_unknown_merge_field_key(self):
        response = self.client.post(
            "/api/card-template-versions/",
            {
                "template": self.template.id,
                "label": "Invalid merge field",
                "card_format": self.card_format.id,
                "paper_profile": self.paper_profile.id,
                "design_payload": {
                    "elements": [
                        {
                            "id": "bad-merge",
                            "type": "text",
                            "x_mm": "1.00",
                            "y_mm": "1.00",
                            "width_mm": "30.00",
                            "height_mm": "8.00",
                            "text": "{{member.unknown_key}}",
                        }
                    ]
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Unknown merge field", str(response.data))

    def test_reject_out_of_bounds_coordinates(self):
        response = self.client.post(
            "/api/card-template-versions/",
            {
                "template": self.template.id,
                "label": "Out of bounds",
                "card_format": self.card_format.id,
                "paper_profile": self.paper_profile.id,
                "design_payload": {
                    "elements": [
                        {
                            "id": "too-wide",
                            "type": "text",
                            "x_mm": "80.00",
                            "y_mm": "1.00",
                            "width_mm": "20.00",
                            "height_mm": "8.00",
                            "text": "{{member.first_name}}",
                        }
                    ]
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("exceeds canvas width bounds", str(response.data))

    def test_seed_presets_exist(self):
        format_codes = set(CardFormatPreset.objects.values_list("code", flat=True))
        self.assertIn("3c", format_codes)
        self.assertIn("din-a6", format_codes)
        self.assertIn("custom", format_codes)

        profile = PaperProfile.objects.filter(code="sigel-lp798").first()
        self.assertIsNotNone(profile)
        self.assertEqual(profile.slot_count, 10)
        self.assertEqual(profile.card_width_mm, Decimal("85.60"))


class LicenseCardPreviewApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="cards-preview-admin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.club_admin = User.objects.create_user(
            username="cards-preview-club-admin",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )
        self.coach = User.objects.create_user(
            username="cards-preview-coach",
            password="pass12345",
            role=User.Roles.COACH,
        )
        self.member_user = User.objects.create_user(
            username="cards-preview-member",
            password="pass12345",
            role=User.Roles.MEMBER,
        )
        self.ltf_finance = User.objects.create_user(
            username="cards-preview-finance",
            password="pass12345",
            role=User.Roles.LTF_FINANCE,
        )
        self.club = Club.objects.create(name="Preview Club", created_by=self.ltf_admin)
        self.club.admins.add(self.club_admin)
        self.member = Member.objects.create(
            club=self.club,
            first_name="Preview",
            last_name="Member",
            ltf_licenseid="LTF-PREVIEW-001",
        )
        self.member.profile_picture_processed = _build_uploaded_png()
        self.member.save(update_fields=["profile_picture_processed", "updated_at"])
        self.license_type = LicenseType.objects.create(name="Preview Annual", code="preview-annual")
        self.license = License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
            year=timezone.localdate().year,
            status=License.Status.ACTIVE,
        )
        self.card_format = CardFormatPreset.objects.get(code="3c")
        self.paper_profile = PaperProfile.objects.get(code="sigel-lp798")
        self.template = CardTemplate.objects.create(
            name="Preview Template",
            created_by=self.ltf_admin,
            updated_by=self.ltf_admin,
        )
        self.template_version = CardTemplateVersion.objects.create(
            template=self.template,
            version_number=1,
            status=CardTemplateVersion.Status.DRAFT,
            card_format=self.card_format,
            paper_profile=self.paper_profile,
            design_payload=_sample_render_design_payload(),
            created_by=self.ltf_admin,
        )
        self.preview_data_url = f"/api/card-template-versions/{self.template_version.id}/preview-data/"
        self.preview_card_pdf_url = (
            f"/api/card-template-versions/{self.template_version.id}/preview-card-pdf/"
        )
        self.preview_sheet_pdf_url = (
            f"/api/card-template-versions/{self.template_version.id}/preview-sheet-pdf/"
        )

    def test_preview_data_returns_deterministic_resolved_layout(self):
        self.client.force_authenticate(user=self.ltf_admin)
        payload = {
            "member_id": self.member.id,
            "license_id": self.license.id,
            "include_bleed_guide": True,
            "include_safe_area_guide": True,
            "bleed_mm": "2.00",
            "safe_area_mm": "3.00",
            "paper_profile_id": self.paper_profile.id,
            "selected_slots": [0, 3, 9],
        }
        first_response = self.client.post(self.preview_data_url, payload, format="json")
        second_response = self.client.post(self.preview_data_url, payload, format="json")

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(first_response.data, second_response.data)
        self.assertEqual(first_response.data["template_version_id"], self.template_version.id)
        self.assertEqual(first_response.data["selected_slots"], [0, 3, 9])
        self.assertEqual(len(first_response.data["slots"]), 10)

        elements = first_response.data["elements"]
        self.assertEqual([item["id"] for item in elements], sorted(
            [item["id"] for item in elements],
            key=lambda _id: next(
                element["render_order"] for element in elements if element["id"] == _id
            ),
        ))
        text_element = next(item for item in elements if item["id"] == "member-name")
        self.assertEqual(text_element["resolved_text"], "Preview MEMBER")
        image_element = next(item for item in elements if item["id"] == "member-photo")
        self.assertTrue(image_element["resolved_source"].startswith("data:image/"))
        qr_element = next(item for item in elements if item["id"] == "license-qr")
        self.assertTrue(qr_element["resolved_value"])
        self.assertTrue(qr_element["qr_data_uri"].startswith("data:image/png;base64,"))

    def test_preview_card_pdf_returns_pdf_bytes(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            self.preview_card_pdf_url,
            {
                "member_id": self.member.id,
                "license_id": self.license.id,
                "include_bleed_guide": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertIn("card-preview", response["Content-Disposition"])
        self.assertTrue(response.content.startswith(b"%PDF"))

    def test_preview_sheet_pdf_returns_pdf_bytes(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            self.preview_sheet_pdf_url,
            {
                "member_id": self.member.id,
                "license_id": self.license.id,
                "paper_profile_id": self.paper_profile.id,
                "selected_slots": [0, 5, 9],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertIn("sheet-preview", response["Content-Disposition"])
        self.assertTrue(response.content.startswith(b"%PDF"))

    def test_preview_sheet_rejects_out_of_range_slots(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            self.preview_sheet_pdf_url,
            {
                "member_id": self.member.id,
                "license_id": self.license.id,
                "paper_profile_id": self.paper_profile.id,
                "selected_slots": [10],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("out-of-range", str(response.data["detail"]).lower())

    def test_preview_rejects_unknown_merge_token_in_stored_payload(self):
        self.template_version.design_payload = {
            "elements": [
                {
                    "id": "broken",
                    "type": "text",
                    "x_mm": "2.00",
                    "y_mm": "2.00",
                    "width_mm": "20.00",
                    "height_mm": "6.00",
                    "text": "{{member.unknown_merge_key}}",
                }
            ]
        }
        self.template_version.save(update_fields=["design_payload", "updated_at"])
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            self.preview_data_url,
            {"member_id": self.member.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("unknown merge field", str(response.data["detail"]).lower())

    def test_preview_endpoints_are_ltf_admin_only(self):
        payload = {"member_id": self.member.id, "license_id": self.license.id}
        for user in [self.club_admin, self.coach, self.member_user, self.ltf_finance]:
            with self.subTest(role=user.role):
                self.client.force_authenticate(user=user)
                data_response = self.client.post(self.preview_data_url, payload, format="json")
                card_pdf_response = self.client.post(
                    self.preview_card_pdf_url,
                    payload,
                    format="json",
                )
                sheet_pdf_response = self.client.post(
                    self.preview_sheet_pdf_url,
                    {
                        **payload,
                        "paper_profile_id": self.paper_profile.id,
                        "selected_slots": [0, 1],
                    },
                    format="json",
                )
                self.assertEqual(data_response.status_code, status.HTTP_403_FORBIDDEN)
                self.assertEqual(card_pdf_response.status_code, status.HTTP_403_FORBIDDEN)
                self.assertEqual(sheet_pdf_response.status_code, status.HTTP_403_FORBIDDEN)


@override_settings(CELERY_TASK_ALWAYS_EAGER=True, CELERY_TASK_EAGER_PROPAGATES=True)
class PrintJobExecutionPipelineTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="cards-print-admin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.club_admin = User.objects.create_user(
            username="cards-print-club-admin",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )
        self.other_club_admin = User.objects.create_user(
            username="cards-print-other-club-admin",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )
        self.coach = User.objects.create_user(
            username="cards-print-coach",
            password="pass12345",
            role=User.Roles.COACH,
        )
        self.member_user = User.objects.create_user(
            username="cards-print-member",
            password="pass12345",
            role=User.Roles.MEMBER,
        )
        self.ltf_finance = User.objects.create_user(
            username="cards-print-finance",
            password="pass12345",
            role=User.Roles.LTF_FINANCE,
        )

        self.club = Club.objects.create(name="Print Club", created_by=self.ltf_admin)
        self.club.admins.add(self.club_admin)
        self.other_club = Club.objects.create(name="Other Print Club", created_by=self.ltf_admin)
        self.other_club.admins.add(self.other_club_admin)

        self.license_type = LicenseType.objects.create(name="Print Annual", code="print-annual")
        self.member_one = Member.objects.create(
            club=self.club,
            first_name="Print",
            last_name="One",
            ltf_licenseid="LTF-PRINT-001",
        )
        self.member_two = Member.objects.create(
            club=self.club,
            first_name="Print",
            last_name="Two",
            ltf_licenseid="LTF-PRINT-002",
        )
        self.other_member = Member.objects.create(
            club=self.other_club,
            first_name="Other",
            last_name="Print",
            ltf_licenseid="LTF-PRINT-003",
        )
        self.license_one = License.objects.create(
            member=self.member_one,
            club=self.club,
            license_type=self.license_type,
            year=timezone.localdate().year,
            status=License.Status.ACTIVE,
        )
        self.license_two = License.objects.create(
            member=self.member_two,
            club=self.club,
            license_type=self.license_type,
            year=timezone.localdate().year,
            status=License.Status.ACTIVE,
        )
        self.other_license = License.objects.create(
            member=self.other_member,
            club=self.other_club,
            license_type=self.license_type,
            year=timezone.localdate().year,
            status=License.Status.ACTIVE,
        )

        self.card_format = CardFormatPreset.objects.get(code="3c")
        self.paper_profile = PaperProfile.objects.get(code="sigel-lp798")
        self.template = CardTemplate.objects.create(
            name="Print Pipeline Template",
            created_by=self.ltf_admin,
            updated_by=self.ltf_admin,
        )
        self.template_version = CardTemplateVersion.objects.create(
            template=self.template,
            version_number=1,
            status=CardTemplateVersion.Status.PUBLISHED,
            card_format=self.card_format,
            paper_profile=self.paper_profile,
            design_payload=_sample_render_design_payload(),
            created_by=self.ltf_admin,
            published_by=self.ltf_admin,
            published_at=timezone.now(),
        )

    def _create_print_job(self, *, user, payload: dict) -> dict:
        self.client.force_authenticate(user=user)
        response = self.client.post("/api/print-jobs/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        return response.data

    def test_create_execute_and_download_pdf_artifact(self):
        created_job = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.club.id,
                "template_version": self.template_version.id,
                "paper_profile": self.paper_profile.id,
                "license_ids": [self.license_one.id, self.license_two.id],
                "selected_slots": [1, 3],
                "include_bleed_guide": True,
                "include_safe_area_guide": True,
                "metadata": {"reason": "batch-print"},
            },
        )
        job_id = created_job["id"]
        self.assertEqual(created_job["status"], PrintJob.Status.DRAFT)
        self.assertEqual(created_job["total_items"], 2)
        self.assertEqual([row["slot_index"] for row in created_job["items"]], [1, 3])

        self.client.force_authenticate(user=self.ltf_admin)
        execute_response = self.client.post(
            f"/api/print-jobs/{job_id}/execute/",
            {},
            format="json",
        )
        self.assertIn(execute_response.status_code, {status.HTTP_200_OK, status.HTTP_202_ACCEPTED})

        retrieve_response = self.client.get(f"/api/print-jobs/{job_id}/")
        self.assertEqual(retrieve_response.status_code, status.HTTP_200_OK)
        self.assertEqual(retrieve_response.data["status"], PrintJob.Status.SUCCEEDED)
        self.assertTrue(retrieve_response.data["artifact_pdf"])
        self.assertEqual(retrieve_response.data["execution_metadata"]["selected_slots"], [1, 3])

        pdf_response = self.client.get(f"/api/print-jobs/{job_id}/pdf/")
        self.assertEqual(pdf_response.status_code, status.HTTP_200_OK)
        self.assertEqual(pdf_response["Content-Type"], "application/pdf")
        pdf_bytes = b"".join(pdf_response.streaming_content)
        self.assertTrue(pdf_bytes.startswith(b"%PDF"))

        self.assertTrue(FinanceAuditLog.objects.filter(action="print_job.created").exists())
        self.assertTrue(FinanceAuditLog.objects.filter(action="print_job.succeeded").exists())

    def test_execute_is_idempotent_after_success(self):
        created_job = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.club.id,
                "template_version": self.template_version.id,
                "paper_profile": self.paper_profile.id,
                "license_ids": [self.license_one.id],
            },
        )
        job_id = created_job["id"]
        self.client.force_authenticate(user=self.ltf_admin)
        first_execute = self.client.post(
            f"/api/print-jobs/{job_id}/execute/",
            {},
            format="json",
        )
        self.assertIn(first_execute.status_code, {status.HTTP_200_OK, status.HTTP_202_ACCEPTED})
        first_state = PrintJob.objects.get(id=job_id)
        self.assertEqual(first_state.status, PrintJob.Status.SUCCEEDED)
        attempts_after_first_run = int(first_state.execution_attempts)

        second_execute = self.client.post(
            f"/api/print-jobs/{job_id}/execute/",
            {},
            format="json",
        )
        self.assertEqual(second_execute.status_code, status.HTTP_200_OK)
        final_state = PrintJob.objects.get(id=job_id)
        self.assertEqual(final_state.status, PrintJob.Status.SUCCEEDED)
        self.assertEqual(int(final_state.execution_attempts), attempts_after_first_run)

    def test_create_rejects_insufficient_partial_sheet_slots(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            "/api/print-jobs/",
            {
                "club": self.club.id,
                "template_version": self.template_version.id,
                "paper_profile": self.paper_profile.id,
                "license_ids": [self.license_one.id, self.license_two.id],
                "selected_slots": [0],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("selected slots", str(response.data).lower())

    def test_retry_after_failed_execution(self):
        created_job = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.club.id,
                "template_version": self.template_version.id,
                "paper_profile": self.paper_profile.id,
                "license_ids": [self.license_one.id],
                "selected_slots": [0],
            },
        )
        job_id = created_job["id"]
        print_job = PrintJob.objects.get(id=job_id)
        print_job.selected_slots = [99]
        print_job.save(update_fields=["selected_slots", "updated_at"])

        self.client.force_authenticate(user=self.ltf_admin)
        execute_response = self.client.post(
            f"/api/print-jobs/{job_id}/execute/",
            {},
            format="json",
        )
        self.assertIn(execute_response.status_code, {status.HTTP_200_OK, status.HTTP_202_ACCEPTED})
        failed_state = PrintJob.objects.get(id=job_id)
        self.assertEqual(failed_state.status, PrintJob.Status.FAILED)
        self.assertTrue(failed_state.error_detail)

        failed_state.selected_slots = [0]
        failed_state.save(update_fields=["selected_slots", "updated_at"])
        retry_response = self.client.post(
            f"/api/print-jobs/{job_id}/retry/",
            {},
            format="json",
        )
        self.assertIn(retry_response.status_code, {status.HTTP_200_OK, status.HTTP_202_ACCEPTED})
        final_state = PrintJob.objects.get(id=job_id)
        self.assertEqual(final_state.status, PrintJob.Status.SUCCEEDED)

    def test_cancel_then_retry_flow(self):
        created_job = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.club.id,
                "template_version": self.template_version.id,
                "paper_profile": self.paper_profile.id,
                "member_ids": [self.member_one.id],
            },
        )
        job_id = created_job["id"]

        self.client.force_authenticate(user=self.ltf_admin)
        cancel_response = self.client.post(
            f"/api/print-jobs/{job_id}/cancel/",
            {},
            format="json",
        )
        self.assertEqual(cancel_response.status_code, status.HTTP_200_OK)
        self.assertEqual(cancel_response.data["status"], PrintJob.Status.CANCELLED)

        execute_after_cancel = self.client.post(
            f"/api/print-jobs/{job_id}/execute/",
            {},
            format="json",
        )
        self.assertEqual(execute_after_cancel.status_code, status.HTTP_400_BAD_REQUEST)

        retry_response = self.client.post(
            f"/api/print-jobs/{job_id}/retry/",
            {},
            format="json",
        )
        self.assertIn(retry_response.status_code, {status.HTTP_200_OK, status.HTTP_202_ACCEPTED})
        final_state = PrintJob.objects.get(id=job_id)
        self.assertEqual(final_state.status, PrintJob.Status.SUCCEEDED)

    def test_permission_matrix_for_print_job_execution(self):
        created_job = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.club.id,
                "template_version": self.template_version.id,
                "paper_profile": self.paper_profile.id,
                "license_ids": [self.license_one.id],
            },
        )
        job_id = created_job["id"]

        self.client.force_authenticate(user=self.club_admin)
        own_execute = self.client.post(
            f"/api/print-jobs/{job_id}/execute/",
            {},
            format="json",
        )
        self.assertIn(own_execute.status_code, {status.HTTP_200_OK, status.HTTP_202_ACCEPTED})

        other_job = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.other_club.id,
                "template_version": self.template_version.id,
                "paper_profile": self.paper_profile.id,
                "license_ids": [self.other_license.id],
            },
        )
        other_job_id = other_job["id"]
        self.client.force_authenticate(user=self.club_admin)
        denied_other_retrieve = self.client.get(f"/api/print-jobs/{other_job_id}/")
        denied_other_execute = self.client.post(
            f"/api/print-jobs/{other_job_id}/execute/",
            {},
            format="json",
        )
        self.assertEqual(denied_other_retrieve.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(denied_other_execute.status_code, status.HTTP_403_FORBIDDEN)

        for user in [self.coach, self.member_user, self.ltf_finance]:
            with self.subTest(role=user.role):
                self.client.force_authenticate(user=user)
                denied_list = self.client.get("/api/print-jobs/")
                denied_create = self.client.post(
                    "/api/print-jobs/",
                    {
                        "club": self.club.id,
                        "template_version": self.template_version.id,
                        "paper_profile": self.paper_profile.id,
                        "license_ids": [self.license_one.id],
                    },
                    format="json",
                )
                self.assertEqual(denied_list.status_code, status.HTTP_403_FORBIDDEN)
                self.assertEqual(denied_create.status_code, status.HTTP_403_FORBIDDEN)

    def test_print_job_items_marked_as_printed_after_success(self):
        created_job = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.club.id,
                "template_version": self.template_version.id,
                "paper_profile": self.paper_profile.id,
                "license_ids": [self.license_one.id, self.license_two.id],
            },
        )
        job_id = created_job["id"]
        self.client.force_authenticate(user=self.ltf_admin)
        self.client.post(f"/api/print-jobs/{job_id}/execute/", {}, format="json")

        statuses = list(
            PrintJobItem.objects.filter(print_job_id=job_id).values_list("status", flat=True)
        )
        self.assertTrue(statuses)
        self.assertTrue(all(item_status == PrintJobItem.Status.PRINTED for item_status in statuses))
