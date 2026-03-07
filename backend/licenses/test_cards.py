from datetime import date, timedelta
from decimal import Decimal
from io import BytesIO, StringIO
from pathlib import Path
import tempfile
from unittest.mock import patch

from django.core.cache import cache
from django.core.management import call_command
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
    CardFontAsset,
    CardImageAsset,
    CardTemplate,
    CardTemplateVersion,
    FinanceAuditLog,
    License,
    LicenseType,
    PaperProfile,
    PrintJob,
    PrintJobItem,
)
from .print_jobs import execute_print_job_now
from .tasks import execute_print_job_task


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
                "width_mm": "85.00",
                "height_mm": "55.00",
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


def _sample_v2_advanced_design_payload(*, font_asset_id: int, image_asset_id: int) -> dict:
    return {
        "schema_version": "v2",
        "layers": [
            {
                "id": "advanced-text",
                "kind": "text",
                "x": "4.00",
                "y": "4.00",
                "width": "50.00",
                "height": "10.00",
                "content": "{{member.full_name}}",
                "rotation_deg": "2.00",
                "styles": {
                    "font_asset_id": font_asset_id,
                    "font_family": "Fallback Sans",
                    "font_size_mm": "4.20",
                    "color": "#0f172a",
                    "font_weight": "700",
                    "italic": True,
                    "line_height": "1.15",
                    "text_align": "center",
                    "shadow_color": "rgba(0,0,0,0.35)",
                    "shadow_offset_x_mm": "0.20",
                    "shadow_offset_y_mm": "0.20",
                    "shadow_blur_mm": "0.20",
                    "stroke_color": "#ffffff",
                    "stroke_width_mm": "0.10",
                    "transform_origin": "top left",
                },
            },
            {
                "id": "advanced-image",
                "kind": "image",
                "x": "60.00",
                "y": "4.00",
                "width": "20.00",
                "height": "20.00",
                "styles": {
                    "image_asset_id": image_asset_id,
                    "object_fit": "cover",
                    "border_color": "#1d4ed8",
                    "border_width_mm": "0.25",
                    "radius_top_left_mm": "1.00",
                    "radius_top_right_mm": "2.00",
                    "radius_bottom_right_mm": "3.00",
                    "radius_bottom_left_mm": "4.00",
                },
            },
            {
                "id": "advanced-shape",
                "kind": "shape",
                "x": "4.00",
                "y": "18.00",
                "width": "20.00",
                "height": "20.00",
                "styles": {
                    "shape_kind": "star",
                    "fill_gradient_start": "#ef4444",
                    "fill_gradient_end": "#3b82f6",
                    "fill_gradient_angle_deg": "45",
                    "stroke_color": "#1f2937",
                    "stroke_width_mm": "0.25",
                    "border_style": "dashed",
                },
            },
            {
                "id": "advanced-qr",
                "kind": "qr",
                "x": "60.00",
                "y": "30.00",
                "width": "20.00",
                "height": "20.00",
                "styles": {
                    "data_mode": "multi_merge",
                    "merge_fields": ["member.ltf_licenseid", "license.year"],
                    "separator": "|",
                    "foreground_color": "#111827",
                    "background_color": "#ffffff",
                    "quiet_zone_modules": 2,
                },
            },
        ],
        "metadata": {"unit": "mm"},
        "canvas": {"unit": "mm"},
    }


def _sample_dual_side_design_payload() -> dict:
    return {
        "schema_version": "v2",
        "sides": {
            "front": {
                "elements": [
                    {
                        "id": "front-name",
                        "type": "text",
                        "x_mm": "4.00",
                        "y_mm": "4.00",
                        "width_mm": "50.00",
                        "height_mm": "8.00",
                        "text": "FRONT {{member.full_name}}",
                    }
                ],
                "background": {"color": "#ffffff"},
            },
            "back": {
                "elements": [
                    {
                        "id": "back-name",
                        "type": "text",
                        "x_mm": "4.00",
                        "y_mm": "4.00",
                        "width_mm": "50.00",
                        "height_mm": "8.00",
                        "text": "BACK {{member.full_name}}",
                    }
                ],
                "background": {"color": "#f8fafc"},
            },
        },
        "metadata": {"unit": "mm"},
    }


def _build_uploaded_png(name: str = "preview-photo.png") -> SimpleUploadedFile:
    buffer = BytesIO()
    image = Image.new("RGB", (32, 32), color=(16, 185, 129))
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")


def _build_uploaded_font(name: str = "preview-font.ttf") -> SimpleUploadedFile:
    # Minimal deterministic fake payload for extension/size validation tests.
    return SimpleUploadedFile(
        name,
        b"\x00\x01\x00\x00fake-font-binary",
        content_type="font/ttf",
    )


def _build_uploaded_svg(
    name: str = "preview-asset.svg",
    payload: str | None = None,
) -> SimpleUploadedFile:
    svg_payload = payload or (
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'>"
        "<rect x='1' y='1' width='8' height='8' fill='#22c55e' stroke='#14532d' "
        "stroke-width='0.5'/>"
        "</svg>"
    )
    return SimpleUploadedFile(
        name,
        svg_payload.encode("utf-8"),
        content_type="image/svg+xml",
    )


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
                "card_width_mm": "85.00",
                "card_height_mm": "55.00",
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
                "card_width_mm": "85.00",
                "card_height_mm": "55.00",
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

    def test_accepts_v2_payload_and_normalizes_schema(self):
        response = self.client.post(
            "/api/card-template-versions/",
            {
                "template": self.template.id,
                "label": "V2 payload",
                "card_format": self.card_format.id,
                "paper_profile": self.paper_profile.id,
                "design_payload": {
                    "schema_version": "v2",
                    "layers": [
                        {
                            "id": "v2-text",
                            "kind": "text",
                            "x": "2.00",
                            "y": "2.00",
                            "width": "35.00",
                            "height": "8.00",
                            "content": "{{member.first_name}}",
                            "styles": {
                                "font_family": "Inter",
                                "letter_spacing_mm": "0.15",
                                "text_align": "left",
                            },
                        }
                    ],
                    "canvas": {"unit": "mm"},
                    "metadata": {"source": "test-v2"},
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        payload = response.data["design_payload"]
        self.assertEqual(payload["schema_version"], 2)
        self.assertIn("elements", payload)
        self.assertEqual(payload["elements"][0]["type"], "text")
        self.assertEqual(payload["elements"][0]["x_mm"], "2.00")
        self.assertEqual(payload["elements"][0]["text"], "{{member.first_name}}")

    def test_accepts_dual_side_payload_and_maps_front_to_legacy_elements(self):
        response = self.client.post(
            "/api/card-template-versions/",
            {
                "template": self.template.id,
                "label": "Dual side payload",
                "card_format": self.card_format.id,
                "paper_profile": self.paper_profile.id,
                "design_payload": _sample_dual_side_design_payload(),
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        payload = response.data["design_payload"]
        self.assertIn("sides", payload)
        self.assertIn("front", payload["sides"])
        self.assertIn("back", payload["sides"])
        self.assertEqual(payload["elements"][0]["id"], "front-name")
        self.assertEqual(payload["sides"]["back"]["elements"][0]["id"], "back-name")

    def test_accepts_distinct_per_corner_radius_values(self):
        response = self.client.post(
            "/api/card-template-versions/",
            {
                "template": self.template.id,
                "label": "Per-corner radius payload",
                "card_format": self.card_format.id,
                "paper_profile": self.paper_profile.id,
                "design_payload": {
                    "elements": [
                        {
                            "id": "shape-corners",
                            "type": "shape",
                            "x_mm": "3.00",
                            "y_mm": "3.00",
                            "width_mm": "22.00",
                            "height_mm": "12.00",
                            "style": {
                                "shape_kind": "rectangle",
                                "radius_top_left_mm": "0.00",
                                "radius_top_right_mm": "1.50",
                                "radius_bottom_right_mm": "3.00",
                                "radius_bottom_left_mm": "5.00",
                            },
                        },
                        {
                            "id": "image-corners",
                            "type": "image",
                            "x_mm": "30.00",
                            "y_mm": "3.00",
                            "width_mm": "20.00",
                            "height_mm": "12.00",
                            "source": "https://example.com/test.png",
                            "style": {
                                "radius_top_left_mm": "0.00",
                                "radius_top_right_mm": "1.50",
                                "radius_bottom_right_mm": "3.00",
                                "radius_bottom_left_mm": "5.00",
                            },
                        },
                    ]
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        shape_style = response.data["design_payload"]["elements"][0]["style"]
        image_style = response.data["design_payload"]["elements"][1]["style"]
        self.assertEqual(shape_style["radius_top_left_mm"], "0.00")
        self.assertEqual(shape_style["radius_top_right_mm"], "1.50")
        self.assertEqual(shape_style["radius_bottom_right_mm"], "3.00")
        self.assertEqual(shape_style["radius_bottom_left_mm"], "5.00")
        self.assertEqual(image_style["radius_top_left_mm"], "0.00")
        self.assertEqual(image_style["radius_top_right_mm"], "1.50")
        self.assertEqual(image_style["radius_bottom_right_mm"], "3.00")
        self.assertEqual(image_style["radius_bottom_left_mm"], "5.00")

    def test_accepts_shape_gradient_canonical_object(self):
        response = self.client.post(
            "/api/card-template-versions/",
            {
                "template": self.template.id,
                "label": "Gradient object",
                "card_format": self.card_format.id,
                "paper_profile": self.paper_profile.id,
                "design_payload": {
                    "elements": [
                        {
                            "id": "shape-gradient-object",
                            "type": "shape",
                            "x_mm": "5.00",
                            "y_mm": "5.00",
                            "width_mm": "25.00",
                            "height_mm": "12.00",
                            "style": {
                                "shape_kind": "rectangle",
                                "fill_gradient": {
                                    "start_color": "#ef4444",
                                    "end_color": "#3b82f6",
                                    "angle_deg": "40",
                                },
                            },
                        }
                    ]
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        saved_style = response.data["design_payload"]["elements"][0]["style"]
        self.assertIsInstance(saved_style.get("fill_gradient"), dict)
        self.assertEqual(saved_style["fill_gradient"]["start_color"], "#ef4444")
        self.assertEqual(saved_style["fill_gradient"]["end_color"], "#3b82f6")

    def test_accepts_shape_gradient_legacy_boolean_with_legacy_keys(self):
        response = self.client.post(
            "/api/card-template-versions/",
            {
                "template": self.template.id,
                "label": "Gradient legacy boolean",
                "card_format": self.card_format.id,
                "paper_profile": self.paper_profile.id,
                "design_payload": {
                    "elements": [
                        {
                            "id": "shape-gradient-legacy",
                            "type": "shape",
                            "x_mm": "5.00",
                            "y_mm": "5.00",
                            "width_mm": "25.00",
                            "height_mm": "12.00",
                            "style": {
                                "shape_kind": "rectangle",
                                "fill_gradient": True,
                                "fill_gradient_start": "#f97316",
                                "fill_gradient_end": "#22c55e",
                                "fill_gradient_angle_deg": "125",
                            },
                        }
                    ]
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        saved_style = response.data["design_payload"]["elements"][0]["style"]
        self.assertIsInstance(saved_style.get("fill_gradient"), dict)
        self.assertEqual(saved_style["fill_gradient"]["start_color"], "#f97316")
        self.assertEqual(saved_style["fill_gradient"]["end_color"], "#22c55e")
        self.assertEqual(saved_style["fill_gradient"]["angle_deg"], "125.00")

    def test_accepts_shape_gradient_legacy_split_keys_without_object(self):
        response = self.client.post(
            "/api/card-template-versions/",
            {
                "template": self.template.id,
                "label": "Gradient legacy split keys",
                "card_format": self.card_format.id,
                "paper_profile": self.paper_profile.id,
                "design_payload": {
                    "elements": [
                        {
                            "id": "shape-gradient-legacy-keys",
                            "type": "shape",
                            "x_mm": "5.00",
                            "y_mm": "5.00",
                            "width_mm": "25.00",
                            "height_mm": "12.00",
                            "style": {
                                "shape_kind": "rectangle",
                                "fill_gradient_start": "#f97316",
                                "fill_gradient_end": "#22c55e",
                                "fill_gradient_angle_deg": "125",
                            },
                        }
                    ]
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        saved_style = response.data["design_payload"]["elements"][0]["style"]
        self.assertNotIn("fill_gradient", saved_style)
        self.assertEqual(saved_style["fill_gradient_start"], "#f97316")
        self.assertEqual(saved_style["fill_gradient_end"], "#22c55e")

    def test_rejects_shape_gradient_invalid_type(self):
        response = self.client.post(
            "/api/card-template-versions/",
            {
                "template": self.template.id,
                "label": "Gradient invalid type",
                "card_format": self.card_format.id,
                "paper_profile": self.paper_profile.id,
                "design_payload": {
                    "elements": [
                        {
                            "id": "shape-gradient-invalid",
                            "type": "shape",
                            "x_mm": "5.00",
                            "y_mm": "5.00",
                            "width_mm": "25.00",
                            "height_mm": "12.00",
                            "style": {
                                "shape_kind": "rectangle",
                                "fill_gradient": "yes",
                            },
                        }
                    ]
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("fill_gradient", str(response.data))

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
        lp798_format = CardFormatPreset.objects.get(code="3c")
        self.assertEqual(lp798_format.width_mm, Decimal("85.00"))
        self.assertEqual(lp798_format.height_mm, Decimal("55.00"))

        profile = PaperProfile.objects.filter(code="sigel-lp798").first()
        self.assertIsNotNone(profile)
        self.assertEqual(profile.slot_count, 10)
        self.assertEqual(profile.card_width_mm, Decimal("85.00"))
        self.assertEqual(profile.card_height_mm, Decimal("55.00"))
        self.assertEqual(profile.margin_left_mm, Decimal("15.00"))
        self.assertEqual(profile.margin_right_mm, Decimal("15.00"))
        self.assertEqual(profile.margin_top_mm, Decimal("10.00"))
        self.assertEqual(profile.margin_bottom_mm, Decimal("12.00"))
        self.assertEqual(profile.horizontal_gap_mm, Decimal("10.00"))
        self.assertEqual(profile.vertical_gap_mm, Decimal("0.00"))
        self.assertEqual(profile.card_corner_radius_mm, Decimal("3.18"))


class LicenseCardDesignerV2FoundationApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="cards-v2-admin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.club_admin = User.objects.create_user(
            username="cards-v2-club-admin",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )
        self.club = Club.objects.create(name="V2 Foundation Club", created_by=self.ltf_admin)
        self.club.admins.add(self.club_admin)

        self.card_format = CardFormatPreset.objects.get(code="3c")
        self.paper_profile = PaperProfile.objects.get(code="sigel-lp798")
        self.default_template = CardTemplate.objects.create(
            name="V2 Default Template",
            is_default=True,
            is_active=True,
            created_by=self.ltf_admin,
            updated_by=self.ltf_admin,
        )
        self.fallback_template = CardTemplate.objects.create(
            name="V2 Fallback Template",
            is_default=False,
            is_active=True,
            created_by=self.ltf_admin,
            updated_by=self.ltf_admin,
        )
        self.default_template_version = CardTemplateVersion.objects.create(
            template=self.default_template,
            version_number=1,
            status=CardTemplateVersion.Status.PUBLISHED,
            card_format=self.card_format,
            paper_profile=self.paper_profile,
            design_payload=_sample_design_payload(),
            created_by=self.ltf_admin,
            published_by=self.ltf_admin,
            published_at=timezone.now(),
        )
        CardTemplateVersion.objects.create(
            template=self.fallback_template,
            version_number=1,
            status=CardTemplateVersion.Status.PUBLISHED,
            card_format=self.card_format,
            paper_profile=self.paper_profile,
            design_payload=_sample_design_payload(),
            created_by=self.ltf_admin,
            published_by=self.ltf_admin,
            published_at=timezone.now(),
        )

        self.member = Member.objects.create(
            club=self.club,
            first_name="Lookup",
            last_name="Member",
            ltf_licenseid="LTF-V2-001",
        )
        self.license_type = LicenseType.objects.create(name="Lookup License", code="lookup-license")
        self.license = License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
            year=timezone.localdate().year,
            status=License.Status.ACTIVE,
        )

    def _create_template_with_version(self, *, name: str) -> tuple[CardTemplate, CardTemplateVersion]:
        template = CardTemplate.objects.create(
            name=name,
            is_default=False,
            is_active=True,
            created_by=self.ltf_admin,
            updated_by=self.ltf_admin,
        )
        version = CardTemplateVersion.objects.create(
            template=template,
            version_number=1,
            status=CardTemplateVersion.Status.PUBLISHED,
            card_format=self.card_format,
            paper_profile=self.paper_profile,
            design_payload=_sample_design_payload(),
            created_by=self.ltf_admin,
            published_by=self.ltf_admin,
            published_at=timezone.now(),
        )
        return template, version

    def test_safe_delete_requires_exact_name_confirmation(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            f"/api/card-templates/{self.default_template.id}/delete/",
            {"confirm_name": "Wrong Name", "mode": "soft"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("confirm_name", response.data)

    def test_safe_delete_hard_for_unreferenced_template(self):
        template, _ = self._create_template_with_version(name="Hard Delete Template")
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            f"/api/card-templates/{template.id}/delete/",
            {"confirm_name": template.name, "mode": "hard"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["applied_mode"], "hard")
        self.assertTrue(response.data["deleted"])
        self.assertFalse(CardTemplate.objects.filter(id=template.id).exists())
        self.assertTrue(
            FinanceAuditLog.objects.filter(
                action="card_template.deleted_hard",
                metadata__template_id=template.id,
            ).exists()
        )

    def test_safe_delete_auto_soft_for_referenced_template(self):
        template, version = self._create_template_with_version(name="Referenced Template")
        PrintJob.objects.create(
            club=self.club,
            template_version=version,
            paper_profile=self.paper_profile,
            total_items=1,
            requested_by=self.ltf_admin,
        )
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            f"/api/card-templates/{template.id}/delete/",
            {"confirm_name": template.name, "mode": "auto"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["applied_mode"], "soft")
        self.assertTrue(response.data["referenced_by_print_jobs"])
        template.refresh_from_db()
        self.assertFalse(template.is_active)

    def test_safe_delete_hard_rejected_for_referenced_template_and_audited(self):
        template, version = self._create_template_with_version(name="Referenced Hard Reject")
        PrintJob.objects.create(
            club=self.club,
            template_version=version,
            paper_profile=self.paper_profile,
            total_items=1,
            requested_by=self.ltf_admin,
        )
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            f"/api/card-templates/{template.id}/delete/",
            {"confirm_name": template.name, "mode": "hard"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(CardTemplate.objects.filter(id=template.id).exists())
        self.assertTrue(
            FinanceAuditLog.objects.filter(
                action="card_template.delete_rejected_referenced",
                metadata__template_id=template.id,
            ).exists()
        )

    def test_safe_delete_auto_soft_for_default_reassigns_default(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            f"/api/card-templates/{self.default_template.id}/delete/",
            {"confirm_name": self.default_template.name, "mode": "auto"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["applied_mode"], "soft")
        self.default_template.refresh_from_db()
        self.fallback_template.refresh_from_db()
        self.assertFalse(self.default_template.is_active)
        self.assertFalse(self.default_template.is_default)
        self.assertTrue(self.fallback_template.is_default)
        self.assertEqual(response.data["reassigned_default_template_id"], self.fallback_template.id)

    def test_safe_delete_permissions_and_legacy_delete_blocked(self):
        self.client.force_authenticate(user=self.club_admin)
        forbidden_response = self.client.post(
            f"/api/card-templates/{self.default_template.id}/delete/",
            {"confirm_name": self.default_template.name, "mode": "soft"},
            format="json",
        )
        self.assertEqual(forbidden_response.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.ltf_admin)
        blocked_response = self.client.delete(f"/api/card-templates/{self.default_template.id}/")
        self.assertEqual(blocked_response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_asset_upload_endpoints_and_validation(self):
        with tempfile.TemporaryDirectory() as temp_media_root:
            with self.settings(MEDIA_ROOT=temp_media_root):
                self.client.force_authenticate(user=self.ltf_admin)
                font_response = self.client.post(
                    "/api/card-font-assets/",
                    {
                        "name": "Inter Regular",
                        "file": _build_uploaded_font("inter-regular.ttf"),
                    },
                    format="multipart",
                )
                self.assertEqual(font_response.status_code, status.HTTP_201_CREATED)
                self.assertEqual(CardFontAsset.objects.count(), 1)
                self.assertTrue(bool(font_response.data.get("is_active")))
                self.assertTrue(CardFontAsset.objects.get(id=font_response.data["id"]).is_active)

                image_response = self.client.post(
                    "/api/card-image-assets/",
                    {
                        "name": "Logo Sample",
                        "image": _build_uploaded_png("logo-sample.png"),
                    },
                    format="multipart",
                )
                self.assertEqual(image_response.status_code, status.HTTP_201_CREATED)
                self.assertEqual(CardImageAsset.objects.count(), 1)
                self.assertTrue(bool(image_response.data.get("is_active")))
                self.assertTrue(CardImageAsset.objects.get(id=image_response.data["id"]).is_active)

                explicit_inactive_image_response = self.client.post(
                    "/api/card-image-assets/",
                    {
                        "name": "Logo Explicit Inactive",
                        "image": _build_uploaded_png("logo-explicit-inactive.png"),
                        "is_active": "false",
                    },
                    format="multipart",
                )
                self.assertEqual(explicit_inactive_image_response.status_code, status.HTTP_201_CREATED)
                explicit_inactive_image = CardImageAsset.objects.get(
                    id=explicit_inactive_image_response.data["id"]
                )
                self.assertFalse(explicit_inactive_image.is_active)

                invalid_font_response = self.client.post(
                    "/api/card-font-assets/",
                    {
                        "name": "Invalid Font",
                        "file": _build_uploaded_font("invalid-font.txt"),
                    },
                    format="multipart",
                )
                self.assertEqual(invalid_font_response.status_code, status.HTTP_400_BAD_REQUEST)

                missing_font_file_response = self.client.post(
                    "/api/card-font-assets/",
                    {"name": "Missing Font File"},
                    format="multipart",
                )
                self.assertEqual(
                    missing_font_file_response.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )
                self.assertIn("file", missing_font_file_response.data)

                wrong_font_key_response = self.client.post(
                    "/api/card-font-assets/",
                    {
                        "name": "Wrong Font Key",
                        "image": _build_uploaded_png("wrong-font-key.png"),
                    },
                    format="multipart",
                )
                self.assertEqual(
                    wrong_font_key_response.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )
                self.assertIn("file", wrong_font_key_response.data)

                missing_image_file_response = self.client.post(
                    "/api/card-image-assets/",
                    {"name": "Missing Image File"},
                    format="multipart",
                )
                self.assertEqual(
                    missing_image_file_response.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )
                self.assertIn("image", missing_image_file_response.data)

                wrong_image_key_response = self.client.post(
                    "/api/card-image-assets/",
                    {
                        "name": "Wrong Image Key",
                        "file": _build_uploaded_font("wrong-image-key.ttf"),
                    },
                    format="multipart",
                )
                self.assertEqual(
                    wrong_image_key_response.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )
                self.assertIn("image", wrong_image_key_response.data)

        self.client.force_authenticate(user=self.club_admin)
        denied_response = self.client.post(
            "/api/card-image-assets/",
            {"name": "Denied", "image": _build_uploaded_png("denied.png")},
            format="multipart",
        )
        self.assertEqual(denied_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_svg_upload_sanitizes_malicious_payload_before_storage(self):
        malicious_svg = (
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10' onload='alert(1)'>"
            "<script>alert('x')</script>"
            "<a href='javascript:alert(2)'><rect x='1' y='1' width='8' height='8' "
            "fill='#22c55e'/></a>"
            "</svg>"
        )
        with tempfile.TemporaryDirectory() as temp_media_root:
            with self.settings(MEDIA_ROOT=temp_media_root):
                self.client.force_authenticate(user=self.ltf_admin)
                response = self.client.post(
                    "/api/card-image-assets/",
                    {
                        "name": "Sanitized SVG",
                        "image": _build_uploaded_svg("sanitized.svg", payload=malicious_svg),
                    },
                    format="multipart",
                )
                self.assertEqual(response.status_code, status.HTTP_201_CREATED)
                image_asset = CardImageAsset.objects.get(id=response.data["id"])
                with image_asset.image.open("rb") as image_stream:
                    stored_payload = image_stream.read().decode("utf-8")
                lowered_payload = stored_payload.lower()
                self.assertIn("<svg", lowered_payload)
                self.assertNotIn("<script", lowered_payload)
                self.assertNotIn("onload=", lowered_payload)
                self.assertNotIn("javascript:", lowered_payload)
                self.assertNotIn("href=", lowered_payload)

    def test_svg_upload_rejects_malformed_non_text_payload(self):
        malformed_payload = SimpleUploadedFile(
            "broken.svg",
            b"\xff\xfe\x00\x00\x01\x02",
            content_type="image/svg+xml",
        )
        with tempfile.TemporaryDirectory() as temp_media_root:
            with self.settings(MEDIA_ROOT=temp_media_root):
                self.client.force_authenticate(user=self.ltf_admin)
                response = self.client.post(
                    "/api/card-image-assets/",
                    {"name": "Broken SVG", "image": malformed_payload},
                    format="multipart",
                )
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertIn("image", response.data)
                self.assertIn("SVG payload", str(response.data["image"][0]))

    def test_raster_image_upload_remains_supported_after_svg_hardening(self):
        with tempfile.TemporaryDirectory() as temp_media_root:
            with self.settings(MEDIA_ROOT=temp_media_root):
                self.client.force_authenticate(user=self.ltf_admin)
                response = self.client.post(
                    "/api/card-image-assets/",
                    {
                        "name": "Raster PNG",
                        "image": _build_uploaded_png("raster.png"),
                    },
                    format="multipart",
                )
                self.assertEqual(response.status_code, status.HTTP_201_CREATED)
                image_asset = CardImageAsset.objects.get(id=response.data["id"])
                with image_asset.image.open("rb") as image_stream:
                    stored_payload = image_stream.read()
                self.assertTrue(stored_payload.startswith(b"\x89PNG\r\n\x1a\n"))

    def test_lookup_endpoints_return_frontend_friendly_payload(self):
        self.client.force_authenticate(user=self.ltf_admin)

        members_response = self.client.get(
            "/api/card-designer/lookups/members/",
            {"q": "Lookup", "limit": 5},
        )
        self.assertEqual(members_response.status_code, status.HTTP_200_OK)
        self.assertTrue(members_response.data)
        self.assertSetEqual(set(members_response.data[0].keys()), {"id", "label", "subtitle"})

        licenses_response = self.client.get(
            "/api/card-designer/lookups/licenses/",
            {"q": "Lookup", "limit": 5},
        )
        self.assertEqual(licenses_response.status_code, status.HTTP_200_OK)
        self.assertTrue(licenses_response.data)
        self.assertSetEqual(set(licenses_response.data[0].keys()), {"id", "label", "subtitle"})

        clubs_response = self.client.get(
            "/api/card-designer/lookups/clubs/",
            {"q": "Foundation", "limit": 5},
        )
        self.assertEqual(clubs_response.status_code, status.HTTP_200_OK)
        self.assertTrue(clubs_response.data)
        self.assertSetEqual(set(clubs_response.data[0].keys()), {"id", "label", "subtitle"})

    def test_lookup_endpoints_are_ltf_admin_only(self):
        self.client.force_authenticate(user=self.club_admin)
        for path in (
            "/api/card-designer/lookups/members/",
            "/api/card-designer/lookups/licenses/",
            "/api/card-designer/lookups/clubs/",
        ):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_merge_field_registry_contains_v2_foundation_keys(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.get("/api/merge-fields/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        keys = {item["key"] for item in response.data}
        self.assertIn("member.age", keys)
        self.assertIn("license.validity_badge", keys)
        self.assertIn("club.logo_print_url", keys)
        self.assertIn("primary_license_role", keys)
        self.assertIn("secondary_license_role", keys)


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
        self.preview_card_html_url = (
            f"/api/card-template-versions/{self.template_version.id}/preview-card-html/"
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

    def test_preview_data_and_simulation_use_ltf_date_format_and_role_merge_fields(self):
        self.member.date_of_birth = date(2016, 11, 9)
        self.member.primary_license_role = Member.LicenseRole.ATHLETE
        self.member.secondary_license_role = Member.LicenseRole.COACH
        self.member.save(
            update_fields=[
                "date_of_birth",
                "primary_license_role",
                "secondary_license_role",
                "updated_at",
            ]
        )
        self.license.start_date = date(2016, 1, 9)
        self.license.end_date = date(2016, 11, 9)
        self.license.save(update_fields=["start_date", "end_date", "updated_at"])
        self.template_version.design_payload = {
            "elements": [
                {
                    "id": "dob-text",
                    "type": "text",
                    "x_mm": "4.00",
                    "y_mm": "4.00",
                    "width_mm": "76.00",
                    "height_mm": "6.00",
                    "text": "DOB {{member.date_of_birth}}",
                },
                {
                    "id": "start-text",
                    "type": "text",
                    "x_mm": "4.00",
                    "y_mm": "12.00",
                    "width_mm": "76.00",
                    "height_mm": "6.00",
                    "text": "START {{license.start_date}}",
                },
                {
                    "id": "end-text",
                    "type": "text",
                    "x_mm": "4.00",
                    "y_mm": "20.00",
                    "width_mm": "76.00",
                    "height_mm": "6.00",
                    "text": "END {{license.end_date}}",
                },
                {
                    "id": "primary-role-text",
                    "type": "text",
                    "x_mm": "4.00",
                    "y_mm": "28.00",
                    "width_mm": "76.00",
                    "height_mm": "6.00",
                    "text": "PRIMARY {{primary_license_role}}",
                },
                {
                    "id": "secondary-role-text",
                    "type": "text",
                    "x_mm": "4.00",
                    "y_mm": "36.00",
                    "width_mm": "76.00",
                    "height_mm": "6.00",
                    "text": "SECONDARY {{secondary_license_role}}",
                },
            ],
            "metadata": {"unit": "mm"},
        }
        self.template_version.save(update_fields=["design_payload", "updated_at"])
        self.client.force_authenticate(user=self.ltf_admin)
        payload = {"member_id": self.member.id, "license_id": self.license.id}

        preview_data_response = self.client.post(self.preview_data_url, payload, format="json")
        self.assertEqual(preview_data_response.status_code, status.HTTP_200_OK)
        context = preview_data_response.data["context"]
        self.assertEqual(context["member.date_of_birth"], "09 Nov 2016")
        self.assertEqual(context["license.start_date"], "09 Jan 2016")
        self.assertEqual(context["license.end_date"], "09 Nov 2016")
        self.assertEqual(context["primary_license_role"], "athlete")
        self.assertEqual(context["secondary_license_role"], "coach")

        resolved_by_id = {
            element["id"]: element["resolved_text"]
            for element in preview_data_response.data["elements"]
            if "resolved_text" in element
        }
        self.assertEqual(resolved_by_id["dob-text"], "DOB 09 Nov 2016")
        self.assertEqual(resolved_by_id["start-text"], "START 09 Jan 2016")
        self.assertEqual(resolved_by_id["end-text"], "END 09 Nov 2016")
        self.assertEqual(resolved_by_id["primary-role-text"], "PRIMARY athlete")
        self.assertEqual(resolved_by_id["secondary-role-text"], "SECONDARY coach")

        preview_html_response = self.client.post(self.preview_card_html_url, payload, format="json")
        self.assertEqual(preview_html_response.status_code, status.HTTP_200_OK)
        self.assertIn("DOB 09 Nov 2016", preview_html_response.data["html"])
        self.assertIn("START 09 Jan 2016", preview_html_response.data["html"])
        self.assertIn("END 09 Nov 2016", preview_html_response.data["html"])
        self.assertIn("PRIMARY athlete", preview_html_response.data["html"])
        self.assertIn("SECONDARY coach", preview_html_response.data["html"])

    def test_preview_card_pdf_receives_ltf_date_formatted_context(self):
        self.member.date_of_birth = date(2016, 11, 9)
        self.member.save(update_fields=["date_of_birth", "updated_at"])
        self.license.start_date = date(2016, 1, 9)
        self.license.end_date = date(2016, 11, 9)
        self.license.save(update_fields=["start_date", "end_date", "updated_at"])
        self.client.force_authenticate(user=self.ltf_admin)
        with patch("licenses.card_views.render_card_pdf_bytes", return_value=b"%PDF-1.4\n") as render_pdf_mock:
            response = self.client.post(
                self.preview_card_pdf_url,
                {"member_id": self.member.id, "license_id": self.license.id},
                format="json",
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/pdf")
        preview_payload = render_pdf_mock.call_args.args[0]
        self.assertEqual(preview_payload["context"]["member.date_of_birth"], "09 Nov 2016")
        self.assertEqual(preview_payload["context"]["license.start_date"], "09 Jan 2016")
        self.assertEqual(preview_payload["context"]["license.end_date"], "09 Nov 2016")

    def test_preview_data_preserves_equal_z_index_input_order(self):
        self.template_version.design_payload = {
            "elements": [
                {
                    "id": "z-second",
                    "type": "text",
                    "x_mm": "4.00",
                    "y_mm": "4.00",
                    "width_mm": "30.00",
                    "height_mm": "8.00",
                    "text": "second",
                    "z_index": 1,
                },
                {
                    "id": "z-first",
                    "type": "text",
                    "x_mm": "4.00",
                    "y_mm": "14.00",
                    "width_mm": "30.00",
                    "height_mm": "8.00",
                    "text": "first",
                    "z_index": 1,
                },
            ]
        }
        self.template_version.save(update_fields=["design_payload", "updated_at"])
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            self.preview_data_url,
            {"member_id": self.member.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rendered_ids = [element["id"] for element in response.data["elements"]]
        self.assertEqual(rendered_ids[:2], ["z-second", "z-first"])

    def test_preview_data_renders_v2_styles_with_assets_and_qr_multi_merge(self):
        with tempfile.TemporaryDirectory() as temp_media_root:
            with self.settings(MEDIA_ROOT=temp_media_root):
                font_asset = CardFontAsset.objects.create(
                    name="Preview Font",
                    file=_build_uploaded_font("preview-font.ttf"),
                    created_by=self.ltf_admin,
                )
                image_asset = CardImageAsset.objects.create(
                    name="Preview Image",
                    image=_build_uploaded_png("preview-image.png"),
                    created_by=self.ltf_admin,
                )
                self.template_version.design_payload = _sample_v2_advanced_design_payload(
                    font_asset_id=font_asset.id,
                    image_asset_id=image_asset.id,
                )
                self.template_version.save(update_fields=["design_payload", "updated_at"])

                self.client.force_authenticate(user=self.ltf_admin)
                response = self.client.post(
                    self.preview_data_url,
                    {
                        "member_id": self.member.id,
                        "license_id": self.license.id,
                        "paper_profile_id": self.paper_profile.id,
                        "selected_slots": [0, 1, 2, 3],
                    },
                    format="json",
                )
                self.assertEqual(response.status_code, status.HTTP_200_OK)
                self.assertEqual(response.data["schema_version"], 2)

                render_metadata = response.data["render_metadata"]
                self.assertIn(font_asset.id, render_metadata["font_assets"]["requested_ids"])
                self.assertIn(font_asset.id, render_metadata["font_assets"]["resolved_ids"])
                self.assertIn(image_asset.id, render_metadata["image_assets"]["requested_ids"])
                self.assertIn(image_asset.id, render_metadata["image_assets"]["resolved_ids"])
                self.assertTrue(render_metadata["font_assets"]["embedded_faces"])

                text_element = next(
                    item for item in response.data["elements"] if item["id"] == "advanced-text"
                )
                self.assertEqual(text_element["resolved_text"], "Preview MEMBER")
                self.assertEqual(text_element["resolved_font"]["status"], "embedded")
                self.assertEqual(text_element["transform_origin"], "top left")

                image_element = next(
                    item for item in response.data["elements"] if item["id"] == "advanced-image"
                )
                self.assertEqual(
                    image_element["resolved_source_meta"]["resolved_via"], "style.image_asset_id"
                )
                self.assertTrue(image_element["resolved_source"].startswith("data:image/"))

                shape_element = next(
                    item for item in response.data["elements"] if item["id"] == "advanced-shape"
                )
                self.assertEqual(shape_element["shape_kind"], "star")

                qr_element = next(item for item in response.data["elements"] if item["id"] == "advanced-qr")
                self.assertEqual(qr_element["qr_mode"], "multi_merge")
                self.assertEqual(qr_element["resolved_value"], f"{self.member.ltf_licenseid}|{self.license.year}")
                self.assertTrue(qr_element["qr_data_uri"].startswith("data:image/png;base64,"))

    def test_preview_data_missing_font_asset_falls_back_without_error(self):
        self.template_version.design_payload = {
            "elements": [
                {
                    "id": "text-fallback",
                    "type": "text",
                    "x_mm": "2.00",
                    "y_mm": "2.00",
                    "width_mm": "30.00",
                    "height_mm": "8.00",
                    "text": "{{member.first_name}}",
                    "style": {
                        "font_asset_id": 999999,
                        "font_family": "Fallback Sans",
                    },
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
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        text_element = response.data["elements"][0]
        self.assertEqual(text_element["resolved_font"]["status"], "missing")
        self.assertEqual(text_element["resolved_font"]["font_family"], "Fallback Sans")

    def test_preview_data_blocks_unsafe_image_source_scheme(self):
        self.template_version.design_payload = {
            "elements": [
                {
                    "id": "unsafe-source-image",
                    "type": "image",
                    "x_mm": "5.00",
                    "y_mm": "5.00",
                    "width_mm": "25.00",
                    "height_mm": "20.00",
                    "source": "javascript:alert(1)",
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
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        image_element = response.data["elements"][0]
        self.assertEqual(image_element["resolved_source"], "")

    def test_preview_endpoints_work_with_sanitized_svg_asset(self):
        with tempfile.TemporaryDirectory() as temp_media_root:
            with self.settings(MEDIA_ROOT=temp_media_root):
                self.client.force_authenticate(user=self.ltf_admin)
                upload_response = self.client.post(
                    "/api/card-image-assets/",
                    {
                        "name": "Preview SVG",
                        "image": _build_uploaded_svg("preview-safe.svg"),
                    },
                    format="multipart",
                )
                self.assertEqual(upload_response.status_code, status.HTTP_201_CREATED)
                image_asset_id = upload_response.data["id"]
                self.template_version.design_payload = {
                    "elements": [
                        {
                            "id": "svg-asset-image",
                            "type": "image",
                            "x_mm": "10.00",
                            "y_mm": "10.00",
                            "width_mm": "25.00",
                            "height_mm": "20.00",
                            "style": {
                                "image_asset_id": image_asset_id,
                            },
                        }
                    ]
                }
                self.template_version.save(update_fields=["design_payload", "updated_at"])

                preview_data_response = self.client.post(
                    self.preview_data_url,
                    {"member_id": self.member.id},
                    format="json",
                )
                self.assertEqual(preview_data_response.status_code, status.HTTP_200_OK)

                preview_html_response = self.client.post(
                    self.preview_card_html_url,
                    {"member_id": self.member.id},
                    format="json",
                )
                self.assertEqual(preview_html_response.status_code, status.HTTP_200_OK)

                preview_pdf_response = self.client.post(
                    self.preview_card_pdf_url,
                    {"member_id": self.member.id},
                    format="json",
                )
                self.assertEqual(preview_pdf_response.status_code, status.HTTP_200_OK)
                self.assertEqual(preview_pdf_response["Content-Type"], "application/pdf")
                self.assertTrue(preview_pdf_response.content.startswith(b"%PDF"))

    def test_preview_data_explicit_image_asset_id_does_not_fallback_to_member_photo(self):
        self.template_version.design_payload = {
            "elements": [
                {
                    "id": "strict-image-asset",
                    "type": "image",
                    "x_mm": "10.00",
                    "y_mm": "10.00",
                    "width_mm": "24.00",
                    "height_mm": "18.00",
                    "merge_field": "member.profile_picture_processed",
                    "source": "member.profile_picture_processed",
                    "style": {"image_asset_id": 999999},
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
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        image_element = response.data["elements"][0]
        self.assertEqual(image_element["resolved_source"], "")
        self.assertEqual(
            image_element["resolved_source_meta"]["resolved_via"],
            "style.image_asset_id",
        )
        self.assertEqual(image_element["resolved_source_meta"]["status"], "missing")
        self.assertEqual(image_element["resolved_source_meta"]["asset_status"], "missing")

    def test_preview_data_multi_image_active_and_inactive_assets_keep_explicit_priority(self):
        with tempfile.TemporaryDirectory() as temp_media_root:
            with self.settings(MEDIA_ROOT=temp_media_root):
                active_asset = CardImageAsset.objects.create(
                    name="Active Asset PNG",
                    image=_build_uploaded_png("active-asset.png"),
                    created_by=self.ltf_admin,
                )
                inactive_asset = CardImageAsset.objects.create(
                    name="Inactive Asset SVG",
                    image=_build_uploaded_svg("inactive-asset.svg"),
                    created_by=self.ltf_admin,
                    is_active=False,
                )
                self.template_version.design_payload = {
                    "elements": [
                        {
                            "id": "asset-image-active",
                            "type": "image",
                            "x_mm": "8.00",
                            "y_mm": "8.00",
                            "width_mm": "20.00",
                            "height_mm": "20.00",
                            "source": "member.profile_picture_processed",
                            "style": {"image_asset_id": active_asset.id},
                        },
                        {
                            "id": "asset-image-inactive",
                            "type": "image",
                            "x_mm": "34.00",
                            "y_mm": "8.00",
                            "width_mm": "20.00",
                            "height_mm": "20.00",
                            "merge_field": "member.profile_picture_processed",
                            "source": "member.profile_picture_processed",
                            "style": {"image_asset_id": inactive_asset.id},
                        },
                    ]
                }
                self.template_version.save(update_fields=["design_payload", "updated_at"])
                self.client.force_authenticate(user=self.ltf_admin)

                preview_data_response = self.client.post(
                    self.preview_data_url,
                    {"member_id": self.member.id},
                    format="json",
                )
                self.assertEqual(preview_data_response.status_code, status.HTTP_200_OK)
                elements_by_id = {
                    element["id"]: element for element in preview_data_response.data["elements"]
                }

                active_element = elements_by_id["asset-image-active"]
                self.assertTrue(str(active_element["resolved_source"]).strip())
                self.assertEqual(
                    active_element["resolved_source_meta"]["resolved_via"],
                    "style.image_asset_id",
                )
                self.assertEqual(active_element["resolved_source_meta"]["status"], "resolved")
                self.assertEqual(
                    active_element["resolved_source_meta"]["asset_status"],
                    "resolved",
                )
                self.assertEqual(
                    active_element["resolved_source_meta"]["image_asset_id"],
                    active_asset.id,
                )

                inactive_element = elements_by_id["asset-image-inactive"]
                self.assertEqual(inactive_element["resolved_source"], "")
                self.assertEqual(
                    inactive_element["resolved_source_meta"]["resolved_via"],
                    "style.image_asset_id",
                )
                self.assertEqual(inactive_element["resolved_source_meta"]["status"], "inactive")
                self.assertEqual(
                    inactive_element["resolved_source_meta"]["asset_status"],
                    "inactive",
                )
                self.assertEqual(
                    inactive_element["resolved_source_meta"]["image_asset_id"],
                    inactive_asset.id,
                )

                image_metadata = preview_data_response.data["render_metadata"]["image_assets"]
                self.assertIn(active_asset.id, image_metadata["resolved_ids"])
                self.assertNotIn(inactive_asset.id, image_metadata["resolved_ids"])
                self.assertIn(inactive_asset.id, image_metadata["unavailable_ids"])
                self.assertNotIn(inactive_asset.id, image_metadata["missing_ids"])

    def test_preview_and_simulation_resolve_multiple_image_assets_including_svg(self):
        with tempfile.TemporaryDirectory() as temp_media_root:
            with self.settings(MEDIA_ROOT=temp_media_root):
                png_asset = CardImageAsset.objects.create(
                    name="Preview Asset PNG",
                    image=_build_uploaded_png("preview-asset-one.png"),
                    created_by=self.ltf_admin,
                )
                svg_asset = CardImageAsset.objects.create(
                    name="Preview Asset SVG",
                    image=_build_uploaded_svg("preview-asset-two.svg"),
                    created_by=self.ltf_admin,
                )
                self.template_version.design_payload = {
                    "elements": [
                        {
                            "id": "asset-image-png",
                            "type": "image",
                            "x_mm": "8.00",
                            "y_mm": "8.00",
                            "width_mm": "20.00",
                            "height_mm": "20.00",
                            "source": "member.profile_picture_processed",
                            "style": {"image_asset_id": png_asset.id},
                        },
                        {
                            "id": "asset-image-svg",
                            "type": "image",
                            "x_mm": "34.00",
                            "y_mm": "8.00",
                            "width_mm": "20.00",
                            "height_mm": "20.00",
                            "merge_field": "member.profile_picture_processed",
                            "style": {"image_asset_id": svg_asset.id},
                        },
                    ]
                }
                self.template_version.save(update_fields=["design_payload", "updated_at"])
                self.client.force_authenticate(user=self.ltf_admin)

                preview_data_response = self.client.post(
                    self.preview_data_url,
                    {"member_id": self.member.id},
                    format="json",
                )
                self.assertEqual(preview_data_response.status_code, status.HTTP_200_OK)
                elements_by_id = {
                    element["id"]: element for element in preview_data_response.data["elements"]
                }
                png_element = elements_by_id["asset-image-png"]
                svg_element = elements_by_id["asset-image-svg"]
                for element, expected_asset_id in (
                    (png_element, png_asset.id),
                    (svg_element, svg_asset.id),
                ):
                    self.assertEqual(
                        element["resolved_source_meta"]["resolved_via"],
                        "style.image_asset_id",
                    )
                    self.assertEqual(element["resolved_source_meta"]["status"], "resolved")
                    self.assertEqual(
                        element["resolved_source_meta"]["image_asset_id"],
                        expected_asset_id,
                    )
                    self.assertTrue(str(element["resolved_source"]).strip())
                self.assertTrue(
                    str(svg_element["resolved_source"]).startswith("data:image/svg+xml;base64,")
                )
                self.assertIn(
                    png_asset.id,
                    preview_data_response.data["render_metadata"]["image_assets"]["resolved_ids"],
                )
                self.assertIn(
                    svg_asset.id,
                    preview_data_response.data["render_metadata"]["image_assets"]["resolved_ids"],
                )

                preview_html_response = self.client.post(
                    self.preview_card_html_url,
                    {"member_id": self.member.id},
                    format="json",
                )
                self.assertEqual(preview_html_response.status_code, status.HTTP_200_OK)
                self.assertIn("data:image/svg+xml;base64,", preview_html_response.data["html"])

                preview_pdf_response = self.client.post(
                    self.preview_card_pdf_url,
                    {"member_id": self.member.id},
                    format="json",
                )
                self.assertEqual(preview_pdf_response.status_code, status.HTTP_200_OK)
                self.assertEqual(preview_pdf_response["Content-Type"], "application/pdf")
                self.assertTrue(preview_pdf_response.content.startswith(b"%PDF"))

    def test_qr_custom_mode_supports_tokenized_custom_payload(self):
        self.template_version.design_payload = {
            "schema_version": "v2",
            "layers": [
                {
                    "id": "qr-custom",
                    "kind": "qr",
                    "x": "5.00",
                    "y": "5.00",
                    "width": "20.00",
                    "height": "20.00",
                    "styles": {
                        "data_mode": "custom",
                        "custom_data": "LTF|{{member.ltf_licenseid}}|{{license.year}}",
                    },
                }
            ],
        }
        self.template_version.save(update_fields=["design_payload", "updated_at"])

        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            self.preview_data_url,
            {"member_id": self.member.id, "license_id": self.license.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        qr_element = response.data["elements"][0]
        self.assertEqual(qr_element["id"], "qr-custom")
        self.assertEqual(qr_element["qr_mode"], "custom")
        self.assertEqual(qr_element["resolved_value"], f"LTF|{self.member.ltf_licenseid}|{self.license.year}")

    def test_preview_data_legacy_payload_defaults_to_front_side(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            self.preview_data_url,
            {"member_id": self.member.id, "license_id": self.license.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["active_side"], "front")
        self.assertEqual(response.data["available_sides"], ["front"])
        self.assertIn("front", response.data["side_summary"])
        self.assertIn("back", response.data["side_summary"])
        self.assertEqual(response.data["side_summary"]["back"]["element_count"], 0)

    def test_preview_data_dual_side_supports_front_and_back_selection(self):
        self.template_version.design_payload = _sample_dual_side_design_payload()
        self.template_version.save(update_fields=["design_payload", "updated_at"])
        self.client.force_authenticate(user=self.ltf_admin)

        front_response = self.client.post(
            self.preview_data_url,
            {"member_id": self.member.id, "license_id": self.license.id, "side": "front"},
            format="json",
        )
        back_response = self.client.post(
            self.preview_data_url,
            {"member_id": self.member.id, "license_id": self.license.id, "side": "back"},
            format="json",
        )
        self.assertEqual(front_response.status_code, status.HTTP_200_OK)
        self.assertEqual(back_response.status_code, status.HTTP_200_OK)

        self.assertEqual(front_response.data["active_side"], "front")
        self.assertEqual(back_response.data["active_side"], "back")
        self.assertIn("back", back_response.data["available_sides"])

        front_text = next(
            item["resolved_text"] for item in front_response.data["elements"] if item["id"] == "front-name"
        )
        back_text = next(
            item["resolved_text"] for item in back_response.data["elements"] if item["id"] == "back-name"
        )
        self.assertTrue(front_text.startswith("FRONT "))
        self.assertTrue(back_text.startswith("BACK "))

    def test_preview_request_rejects_invalid_side(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            self.preview_data_url,
            {"member_id": self.member.id, "side": "left"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("side", response.data)

    def test_preview_card_html_returns_simulation_payload(self):
        self.template_version.design_payload = _sample_dual_side_design_payload()
        self.template_version.save(update_fields=["design_payload", "updated_at"])
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            self.preview_card_html_url,
            {"member_id": self.member.id, "license_id": self.license.id, "side": "back"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["active_side"], "back")
        self.assertIn("back", response.data["available_sides"])
        self.assertIn('class="card-canvas"', response.data["html"])
        self.assertIn("html,body{margin:0;padding:0;}", response.data["css"])
        self.assertNotIn("card-simulation-root", response.data["html"])
        self.assertNotIn("--card-simulation-scale", response.data["css"])

    def test_preview_refresh_override_is_deterministic_for_multiple_elements(self):
        self.client.force_authenticate(user=self.ltf_admin)
        override_a = {
            "elements": [
                {
                    "id": "refresh-a-1",
                    "type": "text",
                    "x_mm": "4.00",
                    "y_mm": "4.00",
                    "width_mm": "70.00",
                    "height_mm": "8.00",
                    "text": "A1 {{member.first_name}}",
                    "style": {"font_size_mm": "3.10"},
                },
                {
                    "id": "refresh-a-2",
                    "type": "text",
                    "x_mm": "4.00",
                    "y_mm": "14.00",
                    "width_mm": "70.00",
                    "height_mm": "8.00",
                    "text": "A2 {{member.last_name}}",
                    "style": {"font_size_mm": "3.10"},
                },
            ]
        }
        override_b = {
            "elements": [
                {
                    "id": "refresh-b-1",
                    "type": "text",
                    "x_mm": "4.00",
                    "y_mm": "4.00",
                    "width_mm": "70.00",
                    "height_mm": "8.00",
                    "text": "B1 {{member.first_name}}",
                    "style": {"font_size_mm": "5.20"},
                },
                {
                    "id": "refresh-b-2",
                    "type": "text",
                    "x_mm": "4.00",
                    "y_mm": "14.00",
                    "width_mm": "70.00",
                    "height_mm": "8.00",
                    "text": "B2 {{member.last_name}}",
                    "style": {"font_size_mm": "5.20"},
                },
            ]
        }
        request_base = {"member_id": self.member.id, "license_id": self.license.id}

        first_response = self.client.post(
            self.preview_card_html_url,
            {**request_base, "design_payload": override_a},
            format="json",
        )
        second_response = self.client.post(
            self.preview_card_html_url,
            {**request_base, "design_payload": override_b},
            format="json",
        )
        third_response = self.client.post(
            self.preview_card_html_url,
            {**request_base, "design_payload": override_a},
            format="json",
        )

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(third_response.status_code, status.HTTP_200_OK)
        self.assertIn("A1 Preview", first_response.data["html"])
        self.assertIn("A2 MEMBER", first_response.data["html"])
        self.assertNotIn("B1 Preview", first_response.data["html"])
        self.assertIn("B1 Preview", second_response.data["html"])
        self.assertIn("B2 MEMBER", second_response.data["html"])
        self.assertNotIn("A1 Preview", second_response.data["html"])
        self.assertEqual(first_response.data["html"], third_response.data["html"])
        self.assertEqual(first_response.data["css"], third_response.data["css"])

        self.template_version.refresh_from_db()
        stored_elements = self.template_version.design_payload.get("elements") or []
        stored_ids = [str(element.get("id")) for element in stored_elements]
        self.assertIn("shape-bg", stored_ids)
        self.assertNotIn("refresh-a-1", stored_ids)
        self.assertNotIn("refresh-b-1", stored_ids)

    def test_preview_simulation_and_pdf_share_font_size_and_positioning_css(self):
        self.client.force_authenticate(user=self.ltf_admin)
        design_override = {
            "elements": [
                {
                    "id": "font-parity",
                    "type": "text",
                    "x_mm": "4.00",
                    "y_mm": "4.00",
                    "width_mm": "72.00",
                    "height_mm": "10.00",
                    "text": "PARITY {{member.first_name}}",
                    "style": {"font_size_mm": "4.37"},
                }
            ]
        }
        request_payload = {
            "member_id": self.member.id,
            "license_id": self.license.id,
            "design_payload": design_override,
        }

        html_response = self.client.post(self.preview_card_html_url, request_payload, format="json")
        self.assertEqual(html_response.status_code, status.HTTP_200_OK)
        self.assertIn("font-size:4.37mm;", html_response.data["html"])
        self.assertIn("left:4.00mm;top:4.00mm;width:72.00mm;height:10.00mm;", html_response.data["html"])
        self.assertIn("PARITY Preview", html_response.data["html"])
        self.assertNotIn("card-simulation-root", html_response.data["html"])

        with patch("licenses.card_rendering._render_pdf", return_value=b"%PDF-1.4\n") as render_pdf_mock:
            pdf_response = self.client.post(
                self.preview_card_pdf_url,
                request_payload,
                format="json",
            )
        self.assertEqual(pdf_response.status_code, status.HTTP_200_OK)
        self.assertEqual(pdf_response["Content-Type"], "application/pdf")

        rendered_pdf_html = str(render_pdf_mock.call_args.args[0])
        self.assertIn("font-size:4.37mm;", rendered_pdf_html)
        self.assertIn("left:4.00mm;top:4.00mm;width:72.00mm;height:10.00mm;", rendered_pdf_html)
        self.assertIn("PARITY Preview", rendered_pdf_html)
        body_start = rendered_pdf_html.find("<body>")
        body_end = rendered_pdf_html.rfind("</body>")
        self.assertGreaterEqual(body_start, 0)
        self.assertGreater(body_end, body_start)
        rendered_pdf_body_fragment = rendered_pdf_html[body_start + len("<body>") : body_end]
        self.assertEqual(html_response.data["html"], rendered_pdf_body_fragment)

        expected_page_rule = (
            "@page { size: "
            f"{Decimal(str(self.card_format.width_mm)).quantize(Decimal('0.01'))}mm "
            f"{Decimal(str(self.card_format.height_mm)).quantize(Decimal('0.01'))}mm; margin: 0; }}"
        )
        self.assertIn(expected_page_rule + html_response.data["css"], rendered_pdf_html)

    def test_preview_rejects_non_object_design_payload_override(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            self.preview_card_html_url,
            {
                "member_id": self.member.id,
                "design_payload": ["invalid", "override"],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("design_payload", response.data)

    def test_preview_card_html_renders_distinct_per_corner_radius_values(self):
        self.template_version.design_payload = {
            "elements": [
                {
                    "id": "shape-corners",
                    "type": "shape",
                    "x_mm": "3.00",
                    "y_mm": "3.00",
                    "width_mm": "24.00",
                    "height_mm": "14.00",
                    "style": {
                        "shape_kind": "rectangle",
                        "fill_color": "#cbd5e1",
                        "radius_top_left_mm": "0.00",
                        "radius_top_right_mm": "1.50",
                        "radius_bottom_right_mm": "3.00",
                        "radius_bottom_left_mm": "5.00",
                    },
                },
                {
                    "id": "image-corners",
                    "type": "image",
                    "x_mm": "32.00",
                    "y_mm": "3.00",
                    "width_mm": "24.00",
                    "height_mm": "14.00",
                    "source": "member.profile_picture_processed",
                    "style": {
                        "radius_top_left_mm": "0.00",
                        "radius_top_right_mm": "1.50",
                        "radius_bottom_right_mm": "3.00",
                        "radius_bottom_left_mm": "5.00",
                    },
                },
            ]
        }
        self.template_version.save(update_fields=["design_payload", "updated_at"])
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            self.preview_card_html_url,
            {"member_id": self.member.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        radius_css = "border-radius:0.00mm 1.50mm 3.00mm 5.00mm;"
        self.assertIn(radius_css, response.data["html"])
        self.assertGreaterEqual(response.data["html"].count(radius_css), 2)

    def test_preview_card_html_legacy_global_radius_remains_valid(self):
        self.template_version.design_payload = {
            "elements": [
                {
                    "id": "shape-global-radius",
                    "type": "shape",
                    "x_mm": "3.00",
                    "y_mm": "3.00",
                    "width_mm": "24.00",
                    "height_mm": "14.00",
                    "style": {
                        "shape_kind": "rectangle",
                        "fill_color": "#cbd5e1",
                        "border_radius_mm": "2.50",
                    },
                },
                {
                    "id": "image-global-radius",
                    "type": "image",
                    "x_mm": "32.00",
                    "y_mm": "3.00",
                    "width_mm": "24.00",
                    "height_mm": "14.00",
                    "source": "member.profile_picture_processed",
                    "style": {
                        "border_radius_mm": "2.50",
                    },
                },
            ]
        }
        self.template_version.save(update_fields=["design_payload", "updated_at"])
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            self.preview_card_html_url,
            {"member_id": self.member.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("border-radius:2.50mm;", response.data["html"])

    def test_preview_card_pdf_supports_back_side(self):
        self.template_version.design_payload = _sample_dual_side_design_payload()
        self.template_version.save(update_fields=["design_payload", "updated_at"])
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            self.preview_card_pdf_url,
            {"member_id": self.member.id, "license_id": self.license.id, "side": "back"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertTrue(response.content.startswith(b"%PDF"))

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

    def test_lp798_geometry_contract_and_bounds(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            self.preview_data_url,
            {
                "member_id": self.member.id,
                "license_id": self.license.id,
                "paper_profile_id": self.paper_profile.id,
                "selected_slots": [0, 9],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["paper_profile"]["code"], "sigel-lp798")
        self.assertEqual(response.data["card_format"]["width_mm"], "85.00")
        self.assertEqual(response.data["card_format"]["height_mm"], "55.00")
        self.assertEqual(response.data["paper_profile"]["card_width_mm"], "85.00")
        self.assertEqual(response.data["paper_profile"]["card_height_mm"], "55.00")
        self.assertEqual(response.data["paper_profile"]["margin_left_mm"], "15.00")
        self.assertEqual(response.data["paper_profile"]["margin_right_mm"], "15.00")
        self.assertEqual(response.data["paper_profile"]["margin_top_mm"], "10.00")
        self.assertEqual(response.data["paper_profile"]["margin_bottom_mm"], "12.00")
        self.assertEqual(response.data["paper_profile"]["horizontal_gap_mm"], "10.00")
        self.assertEqual(response.data["paper_profile"]["vertical_gap_mm"], "0.00")
        self.assertEqual(response.data["paper_profile"]["card_corner_radius_mm"], "3.18")
        slots = response.data["slots"]
        self.assertEqual(len(slots), 10)

        slot_0 = next(slot for slot in slots if slot["slot_index"] == 0)
        slot_1 = next(slot for slot in slots if slot["slot_index"] == 1)
        slot_9 = next(slot for slot in slots if slot["slot_index"] == 9)
        self.assertEqual(slot_0["x_mm"], "15.00")
        self.assertEqual(slot_0["y_mm"], "10.00")
        self.assertEqual(slot_0["x_end_mm"], "100.00")
        self.assertEqual(slot_0["y_end_mm"], "65.00")
        self.assertEqual(slot_1["x_mm"], "110.00")
        self.assertEqual(slot_1["y_mm"], "10.00")
        self.assertEqual(slot_1["x_end_mm"], "195.00")
        self.assertEqual(slot_1["y_end_mm"], "65.00")
        self.assertEqual(slot_9["x_mm"], "110.00")
        self.assertEqual(slot_9["y_mm"], "230.00")
        self.assertEqual(slot_9["x_end_mm"], "195.00")
        self.assertEqual(slot_9["y_end_mm"], "285.00")

        self.assertTrue(response.data["layout_metadata"]["within_sheet_bounds"])
        self.assertEqual(response.data["layout_metadata"]["max_x_mm"], "195.00")
        self.assertEqual(response.data["layout_metadata"]["max_y_mm"], "285.00")
        for slot in slots:
            self.assertLessEqual(Decimal(slot["x_end_mm"]), Decimal("210.00"))
            self.assertLessEqual(Decimal(slot["y_end_mm"]), Decimal("297.00"))

    def test_lp798_guides_do_not_change_slot_geometry(self):
        self.client.force_authenticate(user=self.ltf_admin)
        base_payload = {
            "member_id": self.member.id,
            "license_id": self.license.id,
            "paper_profile_id": self.paper_profile.id,
            "selected_slots": [0, 1, 9],
        }
        base_response = self.client.post(self.preview_data_url, base_payload, format="json")
        guided_response = self.client.post(
            self.preview_data_url,
            {
                **base_payload,
                "include_bleed_guide": True,
                "include_safe_area_guide": True,
                "bleed_mm": "2.00",
                "safe_area_mm": "3.00",
            },
            format="json",
        )
        self.assertEqual(base_response.status_code, status.HTTP_200_OK)
        self.assertEqual(guided_response.status_code, status.HTTP_200_OK)
        self.assertEqual(base_response.data["slots"], guided_response.data["slots"])
        self.assertEqual(
            base_response.data["layout_metadata"],
            guided_response.data["layout_metadata"],
        )

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
                card_html_response = self.client.post(
                    self.preview_card_html_url,
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
                self.assertEqual(card_html_response.status_code, status.HTTP_403_FORBIDDEN)
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

    def _create_published_template_version(
        self,
        *,
        design_payload: dict,
        paper_profile: PaperProfile | None,
    ) -> CardTemplateVersion:
        template = CardTemplate.objects.create(
            name=f"Print Pipeline Variant {CardTemplate.objects.count() + 1}",
            created_by=self.ltf_admin,
            updated_by=self.ltf_admin,
        )
        return CardTemplateVersion.objects.create(
            template=template,
            version_number=1,
            status=CardTemplateVersion.Status.PUBLISHED,
            card_format=self.card_format,
            paper_profile=paper_profile,
            design_payload=design_payload,
            created_by=self.ltf_admin,
            published_by=self.ltf_admin,
            published_at=timezone.now(),
        )

    def test_create_print_job_side_defaults_for_single_and_dual_side_templates(self):
        single_side_job = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.club.id,
                "template_version": self.template_version.id,
                "member_ids": [self.member_one.id],
            },
        )
        self.assertEqual(single_side_job["side"], PrintJob.Side.FRONT)

        dual_side_version = self._create_published_template_version(
            design_payload=_sample_dual_side_design_payload(),
            paper_profile=self.paper_profile,
        )
        dual_side_job = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.club.id,
                "template_version": dual_side_version.id,
                "member_ids": [self.member_one.id],
            },
        )
        self.assertEqual(dual_side_job["side"], PrintJob.Side.BOTH)

    def test_execute_honors_front_back_and_both_side_selection(self):
        dual_side_version = self._create_published_template_version(
            design_payload=_sample_dual_side_design_payload(),
            paper_profile=None,
        )

        test_cases = (
            (
                PrintJob.Side.FRONT,
                ["FRONT Print ONE"],
                ["BACK Print ONE"],
                ["front"],
            ),
            (
                PrintJob.Side.BACK,
                ["BACK Print ONE"],
                ["FRONT Print ONE"],
                ["back"],
            ),
            (
                PrintJob.Side.BOTH,
                ["FRONT Print ONE", "BACK Print ONE"],
                [],
                ["front", "back"],
            ),
        )
        for side, expected_fragments, forbidden_fragments, expected_render_sides in test_cases:
            with self.subTest(side=side):
                created_job = self._create_print_job(
                    user=self.ltf_admin,
                    payload={
                        "club": self.club.id,
                        "template_version": dual_side_version.id,
                        "member_ids": [self.member_one.id],
                        "side": side,
                    },
                )
                job_id = created_job["id"]
                self.client.force_authenticate(user=self.ltf_admin)
                with patch(
                    "licenses.print_jobs.render_pdf_bytes_from_html",
                    return_value=b"%PDF-1.4\n",
                ) as render_pdf_mock:
                    execute_response = self.client.post(
                        f"/api/print-jobs/{job_id}/execute/",
                        {},
                        format="json",
                    )
                    self.assertIn(
                        execute_response.status_code,
                        {status.HTTP_200_OK, status.HTTP_202_ACCEPTED},
                    )

                rendered_html = str(render_pdf_mock.call_args.args[0])
                for expected_fragment in expected_fragments:
                    self.assertIn(expected_fragment, rendered_html)
                for forbidden_fragment in forbidden_fragments:
                    self.assertNotIn(forbidden_fragment, rendered_html)

                final_state = PrintJob.objects.get(id=job_id)
                self.assertEqual(final_state.side, side)
                self.assertEqual(
                    final_state.execution_metadata.get("render_sides"),
                    expected_render_sides,
                )

    def test_print_execution_uses_ltf_date_format_and_role_merge_fields(self):
        self.member_one.date_of_birth = date(2016, 11, 9)
        self.member_one.primary_license_role = Member.LicenseRole.ATHLETE
        self.member_one.secondary_license_role = Member.LicenseRole.COACH
        self.member_one.save(
            update_fields=[
                "date_of_birth",
                "primary_license_role",
                "secondary_license_role",
                "updated_at",
            ]
        )
        self.license_one.start_date = date(2016, 1, 9)
        self.license_one.end_date = date(2016, 11, 9)
        self.license_one.save(update_fields=["start_date", "end_date", "updated_at"])
        template_version = self._create_published_template_version(
            design_payload={
                "elements": [
                    {
                        "id": "print-dob",
                        "type": "text",
                        "x_mm": "4.00",
                        "y_mm": "4.00",
                        "width_mm": "70.00",
                        "height_mm": "6.00",
                        "text": "DOB {{member.date_of_birth}}",
                    },
                    {
                        "id": "print-start",
                        "type": "text",
                        "x_mm": "4.00",
                        "y_mm": "12.00",
                        "width_mm": "70.00",
                        "height_mm": "6.00",
                        "text": "START {{license.start_date}}",
                    },
                    {
                        "id": "print-end",
                        "type": "text",
                        "x_mm": "4.00",
                        "y_mm": "20.00",
                        "width_mm": "70.00",
                        "height_mm": "6.00",
                        "text": "END {{license.end_date}}",
                    },
                    {
                        "id": "print-primary-role",
                        "type": "text",
                        "x_mm": "4.00",
                        "y_mm": "28.00",
                        "width_mm": "70.00",
                        "height_mm": "6.00",
                        "text": "PRIMARY {{primary_license_role}}",
                    },
                    {
                        "id": "print-secondary-role",
                        "type": "text",
                        "x_mm": "4.00",
                        "y_mm": "36.00",
                        "width_mm": "70.00",
                        "height_mm": "6.00",
                        "text": "SECONDARY {{secondary_license_role}}",
                    },
                ]
            },
            paper_profile=None,
        )
        created_job = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.club.id,
                "template_version": template_version.id,
                "license_ids": [self.license_one.id],
                "side": PrintJob.Side.FRONT,
            },
        )
        job_id = created_job["id"]
        self.client.force_authenticate(user=self.ltf_admin)
        with patch(
            "licenses.print_jobs.render_pdf_bytes_from_html",
            return_value=b"%PDF-1.4\n",
        ) as render_pdf_mock:
            execute_response = self.client.post(
                f"/api/print-jobs/{job_id}/execute/",
                {},
                format="json",
            )
        self.assertIn(
            execute_response.status_code,
            {status.HTTP_200_OK, status.HTTP_202_ACCEPTED},
        )

        rendered_html = str(render_pdf_mock.call_args.args[0])
        self.assertIn("DOB 09 Nov 2016", rendered_html)
        self.assertIn("START 09 Jan 2016", rendered_html)
        self.assertIn("END 09 Nov 2016", rendered_html)
        self.assertIn("PRIMARY athlete", rendered_html)
        self.assertIn("SECONDARY coach", rendered_html)

    def test_enqueue_failure_moves_job_to_failed_with_retryable_state(self):
        created_job = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.club.id,
                "template_version": self.template_version.id,
                "license_ids": [self.license_one.id],
            },
        )
        job_id = created_job["id"]
        self.client.force_authenticate(user=self.ltf_admin)

        with patch(
            "licenses.card_views.execute_print_job_task.apply_async",
            side_effect=RuntimeError("broker unavailable"),
        ):
            execute_response = self.client.post(
                f"/api/print-jobs/{job_id}/execute/",
                {},
                format="json",
            )
        self.assertEqual(execute_response.status_code, status.HTTP_400_BAD_REQUEST)

        failed_job = PrintJob.objects.get(id=job_id)
        self.assertEqual(failed_job.status, PrintJob.Status.FAILED)
        self.assertIn("broker unavailable", failed_job.error_detail)
        self.assertIsNotNone(failed_job.last_error_at)
        self.assertEqual(
            failed_job.execution_metadata.get("last_dispatch_error"),
            "broker unavailable",
        )
        self.assertTrue(
            FinanceAuditLog.objects.filter(
                action="print_job.execute_queued_dispatch_failed",
                metadata__print_job_id=job_id,
            ).exists()
        )

        retry_response = self.client.post(
            f"/api/print-jobs/{job_id}/retry/",
            {},
            format="json",
        )
        self.assertIn(
            retry_response.status_code,
            {status.HTTP_200_OK, status.HTTP_202_ACCEPTED},
        )
        succeeded_job = PrintJob.objects.get(id=job_id)
        self.assertEqual(succeeded_job.status, PrintJob.Status.SUCCEEDED)

    def test_execute_print_job_now_short_circuits_duplicate_running_job(self):
        created_job = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.club.id,
                "template_version": self.template_version.id,
                "license_ids": [self.license_one.id],
            },
        )
        job_id = created_job["id"]
        running_started_at = timezone.now()
        PrintJob.objects.filter(id=job_id).update(
            status=PrintJob.Status.RUNNING,
            started_at=running_started_at,
            execution_attempts=3,
        )
        with patch("licenses.print_jobs.build_preview_data") as preview_builder:
            execute_print_job_now(print_job_id=job_id, actor_id=self.ltf_admin.id)
        preview_builder.assert_not_called()

        running_job = PrintJob.objects.get(id=job_id)
        self.assertEqual(running_job.status, PrintJob.Status.RUNNING)
        self.assertEqual(int(running_job.execution_attempts), 3)
        self.assertEqual(running_job.started_at, running_started_at)
        self.assertTrue(
            FinanceAuditLog.objects.filter(
                action="print_job.duplicate_ignored_running",
                metadata__print_job_id=job_id,
            ).exists()
        )

    def test_execute_print_job_task_ignores_duplicate_lock(self):
        created_job = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.club.id,
                "template_version": self.template_version.id,
                "license_ids": [self.license_one.id],
            },
        )
        job_id = created_job["id"]
        lock_key = f"print_job:execute:lock:{job_id}"
        cache.set(lock_key, "1", timeout=60)
        try:
            with patch("licenses.tasks.execute_print_job_now") as execute_now_mock:
                execute_print_job_task(job_id, self.ltf_admin.id)
            execute_now_mock.assert_not_called()
        finally:
            cache.delete(lock_key)

        self.assertTrue(
            FinanceAuditLog.objects.filter(
                action="print_job.task_duplicate_ignored",
                metadata__print_job_id=job_id,
            ).exists()
        )

    @override_settings(
        BACKEND_BASE_URL="http://backend.local",
        FRONTEND_BASE_URL="http://frontend.local",
    )
    def test_print_worker_absolutizes_relative_asset_urls(self):
        relative_source_version = self._create_published_template_version(
            design_payload={
                "elements": [
                    {
                        "id": "relative-image",
                        "type": "image",
                        "x_mm": "2.00",
                        "y_mm": "2.00",
                        "width_mm": "20.00",
                        "height_mm": "20.00",
                        "source": "/media/cards/example.png",
                    }
                ]
            },
            paper_profile=None,
        )
        self.client.force_authenticate(user=self.ltf_admin)

        preview_response = self.client.post(
            f"/api/card-template-versions/{relative_source_version.id}/preview-data/",
            {"member_id": self.member_one.id},
            format="json",
        )
        self.assertEqual(preview_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            preview_response.data["elements"][0]["resolved_source"],
            "http://testserver/media/cards/example.png",
        )

        created_job = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.club.id,
                "template_version": relative_source_version.id,
                "member_ids": [self.member_one.id],
                "side": PrintJob.Side.FRONT,
            },
        )
        job_id = created_job["id"]
        with patch(
            "licenses.print_jobs.render_pdf_bytes_from_html",
            return_value=b"%PDF-1.4\n",
        ) as render_pdf_mock:
            execute_response = self.client.post(
                f"/api/print-jobs/{job_id}/execute/",
                {},
                format="json",
            )
        self.assertIn(
            execute_response.status_code,
            {status.HTTP_200_OK, status.HTTP_202_ACCEPTED},
        )
        rendered_html = str(render_pdf_mock.call_args.args[0])
        self.assertIn('src="http://backend.local/media/cards/example.png"', rendered_html)
        self.assertNotIn('src="/media/cards/example.png"', rendered_html)
        self.assertEqual(
            render_pdf_mock.call_args.kwargs.get("base_url"),
            "http://backend.local/",
        )

    def test_print_execution_resolves_multiple_image_assets_without_profile_fallback(self):
        with tempfile.TemporaryDirectory() as temp_media_root:
            with self.settings(MEDIA_ROOT=temp_media_root):
                self.member_one.profile_picture_processed = _build_uploaded_png(
                    "print-member-profile.png"
                )
                self.member_one.save(update_fields=["profile_picture_processed", "updated_at"])
                png_asset = CardImageAsset.objects.create(
                    name="Print Asset PNG",
                    image=_build_uploaded_png("print-asset-one.png"),
                    created_by=self.ltf_admin,
                )
                svg_asset = CardImageAsset.objects.create(
                    name="Print Asset SVG",
                    image=_build_uploaded_svg("print-asset-two.svg"),
                    created_by=self.ltf_admin,
                )
                template_version = self._create_published_template_version(
                    design_payload={
                        "elements": [
                            {
                                "id": "print-asset-png",
                                "type": "image",
                                "x_mm": "4.00",
                                "y_mm": "4.00",
                                "width_mm": "20.00",
                                "height_mm": "20.00",
                                "source": "member.profile_picture_processed",
                                "style": {"image_asset_id": png_asset.id},
                            },
                            {
                                "id": "print-asset-svg",
                                "type": "image",
                                "x_mm": "28.00",
                                "y_mm": "4.00",
                                "width_mm": "20.00",
                                "height_mm": "20.00",
                                "merge_field": "member.profile_picture_processed",
                                "style": {"image_asset_id": svg_asset.id},
                            },
                        ]
                    },
                    paper_profile=None,
                )
                created_job = self._create_print_job(
                    user=self.ltf_admin,
                    payload={
                        "club": self.club.id,
                        "template_version": template_version.id,
                        "member_ids": [self.member_one.id],
                        "side": PrintJob.Side.FRONT,
                    },
                )
                job_id = created_job["id"]
                captured_preview_payloads: list[dict] = []

                import licenses.print_jobs as print_jobs_module

                original_build_preview_data = print_jobs_module.build_preview_data

                def _capture_preview_payload(*args, **kwargs):
                    payload = original_build_preview_data(*args, **kwargs)
                    captured_preview_payloads.append(payload)
                    return payload

                self.client.force_authenticate(user=self.ltf_admin)
                with patch(
                    "licenses.print_jobs.build_preview_data",
                    side_effect=_capture_preview_payload,
                ):
                    with patch(
                        "licenses.print_jobs.render_pdf_bytes_from_html",
                        return_value=b"%PDF-1.4\n",
                    ) as render_pdf_mock:
                        execute_response = self.client.post(
                            f"/api/print-jobs/{job_id}/execute/",
                            {},
                            format="json",
                        )
                self.assertIn(
                    execute_response.status_code,
                    {status.HTTP_200_OK, status.HTTP_202_ACCEPTED},
                )
                self.assertTrue(captured_preview_payloads)

                image_elements = {
                    element["id"]: element
                    for element in captured_preview_payloads[0]["elements"]
                    if element["type"] == "image"
                }
                self.assertIn("print-asset-png", image_elements)
                self.assertIn("print-asset-svg", image_elements)
                for element_id, expected_asset_id in (
                    ("print-asset-png", png_asset.id),
                    ("print-asset-svg", svg_asset.id),
                ):
                    element = image_elements[element_id]
                    self.assertEqual(
                        element["resolved_source_meta"]["resolved_via"],
                        "style.image_asset_id",
                    )
                    self.assertEqual(element["resolved_source_meta"]["status"], "resolved")
                    self.assertEqual(
                        element["resolved_source_meta"]["image_asset_id"],
                        expected_asset_id,
                    )
                    self.assertTrue(str(element["resolved_source"]).strip())
                self.assertTrue(
                    str(image_elements["print-asset-svg"]["resolved_source"]).startswith(
                        "data:image/svg+xml;base64,"
                    )
                )

                rendered_html = str(render_pdf_mock.call_args.args[0])
                self.assertIn("data:image/svg+xml;base64,", rendered_html)
                self.assertNotIn(">No image<", rendered_html)

    def test_pdf_endpoint_returns_404_when_artifact_file_missing(self):
        with tempfile.TemporaryDirectory() as temp_media_root:
            with self.settings(MEDIA_ROOT=temp_media_root):
                created_job = self._create_print_job(
                    user=self.ltf_admin,
                    payload={
                        "club": self.club.id,
                        "template_version": self.template_version.id,
                        "license_ids": [self.license_one.id],
                    },
                )
                job_id = created_job["id"]
                self.client.force_authenticate(user=self.ltf_admin)
                with patch(
                    "licenses.print_jobs.render_pdf_bytes_from_html",
                    return_value=b"%PDF-1.4\n",
                ):
                    self.client.post(
                        f"/api/print-jobs/{job_id}/execute/",
                        {},
                        format="json",
                    )

                print_job = PrintJob.objects.get(id=job_id)
                artifact_path = Path(print_job.artifact_pdf.path)
                self.assertTrue(artifact_path.exists())
                artifact_path.unlink()

                pdf_response = self.client.get(f"/api/print-jobs/{job_id}/pdf/")
                self.assertEqual(pdf_response.status_code, status.HTTP_404_NOT_FOUND)
                self.assertIn(
                    "artifact file is unavailable",
                    str(pdf_response.data["detail"]).lower(),
                )
                self.assertTrue(
                    FinanceAuditLog.objects.filter(
                        action="print_job.pdf_missing_artifact",
                        metadata__print_job_id=job_id,
                    ).exists()
                )

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

    def test_sheet_execution_layout_metadata_matches_preview_geometry(self):
        self.client.force_authenticate(user=self.ltf_admin)
        preview_response = self.client.post(
            f"/api/card-template-versions/{self.template_version.id}/preview-data/",
            {
                "member_id": self.member_one.id,
                "license_id": self.license_one.id,
                "paper_profile_id": self.paper_profile.id,
                "selected_slots": [0],
            },
            format="json",
        )
        self.assertEqual(preview_response.status_code, status.HTTP_200_OK)

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

        self.client.force_authenticate(user=self.ltf_admin)
        with patch(
            "licenses.print_jobs.render_pdf_bytes_from_html",
            return_value=b"%PDF-1.4\n",
        ):
            execute_response = self.client.post(
                f"/api/print-jobs/{job_id}/execute/",
                {},
                format="json",
            )
        self.assertIn(execute_response.status_code, {status.HTTP_200_OK, status.HTTP_202_ACCEPTED})

        final_state = PrintJob.objects.get(id=job_id)
        self.assertEqual(
            final_state.execution_metadata.get("sheet_layout_metadata"),
            preview_response.data["layout_metadata"],
        )

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

    def test_print_job_history_endpoint_returns_audit_events(self):
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
        self.client.post(f"/api/print-jobs/{job_id}/execute/", {}, format="json")
        self.client.get(f"/api/print-jobs/{job_id}/pdf/")

        history_response = self.client.get(f"/api/print-jobs/{job_id}/history/")
        self.assertEqual(history_response.status_code, status.HTTP_200_OK)
        self.assertTrue(history_response.data)
        first_event = history_response.data[0]
        self.assertIn("id", first_event)
        self.assertIn("action", first_event)
        self.assertIn("message", first_event)
        self.assertIn("actor", first_event)
        self.assertIn("metadata", first_event)
        self.assertIn("created_at", first_event)
        self.assertTrue(all(row["action"].startswith("print_job.") for row in history_response.data))

        self.client.force_authenticate(user=self.club_admin)
        own_history_response = self.client.get(f"/api/print-jobs/{job_id}/history/")
        self.assertEqual(own_history_response.status_code, status.HTTP_200_OK)

        other_job = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.other_club.id,
                "template_version": self.template_version.id,
                "paper_profile": self.paper_profile.id,
                "license_ids": [self.other_license.id],
            },
        )
        self.client.force_authenticate(user=self.club_admin)
        denied_history_response = self.client.get(f"/api/print-jobs/{other_job['id']}/history/")
        self.assertEqual(denied_history_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_print_job_list_filtering_and_pagination(self):
        created_draft = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.club.id,
                "template_version": self.template_version.id,
                "paper_profile": self.paper_profile.id,
                "member_ids": [self.member_one.id],
            },
        )
        created_succeeded = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.club.id,
                "template_version": self.template_version.id,
                "paper_profile": self.paper_profile.id,
                "license_ids": [self.license_one.id],
            },
        )
        created_other = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.other_club.id,
                "template_version": self.template_version.id,
                "paper_profile": self.paper_profile.id,
                "license_ids": [self.other_license.id],
            },
        )
        self.client.force_authenticate(user=self.ltf_admin)
        self.client.post(
            f"/api/print-jobs/{created_succeeded['id']}/execute/",
            {},
            format="json",
        )
        PrintJob.objects.filter(id=created_other["id"]).update(status=PrintJob.Status.FAILED)

        succeeded_job = PrintJob.objects.get(id=created_succeeded["id"])
        self.assertEqual(succeeded_job.status, PrintJob.Status.SUCCEEDED)

        status_filtered_response = self.client.get(
            "/api/print-jobs/",
            {"status": PrintJob.Status.SUCCEEDED},
        )
        self.assertEqual(status_filtered_response.status_code, status.HTTP_200_OK)
        status_filtered_ids = {row["id"] for row in status_filtered_response.data}
        self.assertIn(created_succeeded["id"], status_filtered_ids)
        self.assertNotIn(created_draft["id"], status_filtered_ids)

        club_filtered_response = self.client.get("/api/print-jobs/", {"club_id": self.club.id})
        self.assertEqual(club_filtered_response.status_code, status.HTTP_200_OK)
        self.assertTrue(all(row["club"] == self.club.id for row in club_filtered_response.data))

        template_filtered_response = self.client.get(
            "/api/print-jobs/",
            {"template_version_id": self.template_version.id},
        )
        self.assertEqual(template_filtered_response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            all(row["template_version"] == self.template_version.id for row in template_filtered_response.data)
        )

        requested_by_response = self.client.get(
            "/api/print-jobs/",
            {"requested_by_id": self.ltf_admin.id},
        )
        self.assertEqual(requested_by_response.status_code, status.HTTP_200_OK)
        self.assertTrue(all(row["requested_by"] == self.ltf_admin.id for row in requested_by_response.data))

        date_anchor = timezone.now()
        PrintJob.objects.filter(id=created_succeeded["id"]).update(created_at=date_anchor)
        date_range_response = self.client.get(
            "/api/print-jobs/",
            {
                "created_from": (date_anchor - timedelta(minutes=1)).isoformat(),
                "created_to": (date_anchor + timedelta(minutes=1)).isoformat(),
            },
        )
        self.assertEqual(date_range_response.status_code, status.HTTP_200_OK)
        self.assertTrue(any(row["id"] == created_succeeded["id"] for row in date_range_response.data))

        search_token = created_succeeded["job_number"][-6:]
        search_response = self.client.get("/api/print-jobs/", {"q": search_token})
        self.assertEqual(search_response.status_code, status.HTTP_200_OK)
        self.assertTrue(any(row["id"] == created_succeeded["id"] for row in search_response.data))

        paginated_response = self.client.get("/api/print-jobs/", {"page": 1, "page_size": 1})
        self.assertEqual(paginated_response.status_code, status.HTTP_200_OK)
        self.assertIn("results", paginated_response.data)
        self.assertEqual(len(paginated_response.data["results"]), 1)

        self.client.force_authenticate(user=self.club_admin)
        scoped_response = self.client.get("/api/print-jobs/", {"club_id": self.other_club.id})
        self.assertEqual(scoped_response.status_code, status.HTTP_200_OK)
        self.assertFalse(any(row["club"] == self.other_club.id for row in scoped_response.data))

    def test_pdf_download_records_audit_event(self):
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
        self.client.post(f"/api/print-jobs/{job_id}/execute/", {}, format="json")

        response = self.client.get(f"/api/print-jobs/{job_id}/pdf/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            FinanceAuditLog.objects.filter(
                action="print_job.pdf_downloaded",
                metadata__print_job_id=job_id,
            ).exists()
        )

    def test_guarded_transition_audit_events_are_recorded(self):
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
        self.client.post(f"/api/print-jobs/{job_id}/cancel/", {}, format="json")
        execute_response = self.client.post(
            f"/api/print-jobs/{job_id}/execute/",
            {},
            format="json",
        )
        self.assertEqual(execute_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(
            FinanceAuditLog.objects.filter(
                action="print_job.execute_rejected_cancelled",
                metadata__print_job_id=job_id,
            ).exists()
        )

        draft_job = self._create_print_job(
            user=self.ltf_admin,
            payload={
                "club": self.club.id,
                "template_version": self.template_version.id,
                "paper_profile": self.paper_profile.id,
                "member_ids": [self.member_two.id],
            },
        )
        retry_response = self.client.post(
            f"/api/print-jobs/{draft_job['id']}/retry/",
            {},
            format="json",
        )
        self.assertEqual(retry_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(
            FinanceAuditLog.objects.filter(
                action="print_job.retry_queued_rejected_invalid_status",
                metadata__print_job_id=draft_job["id"],
            ).exists()
        )

    def test_execution_stops_when_job_cancelled_during_processing(self):
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

        import licenses.print_jobs as print_jobs_module

        original_build_preview_data = print_jobs_module.build_preview_data
        cancel_marker = {"cancelled": False}

        def _cancel_mid_execution(*args, **kwargs):
            result = original_build_preview_data(*args, **kwargs)
            if not cancel_marker["cancelled"]:
                PrintJob.objects.filter(id=job_id).update(
                    status=PrintJob.Status.CANCELLED,
                    cancelled_at=timezone.now(),
                    finished_at=timezone.now(),
                )
                cancel_marker["cancelled"] = True
            return result

        with patch("licenses.print_jobs.build_preview_data", side_effect=_cancel_mid_execution):
            execute_response = self.client.post(
                f"/api/print-jobs/{job_id}/execute/",
                {},
                format="json",
            )
            self.assertIn(execute_response.status_code, {status.HTTP_200_OK, status.HTTP_202_ACCEPTED})

        cancelled_job = PrintJob.objects.get(id=job_id)
        self.assertEqual(cancelled_job.status, PrintJob.Status.CANCELLED)
        self.assertFalse(bool(cancelled_job.artifact_pdf))

    def test_prune_print_job_artifacts_command(self):
        with tempfile.TemporaryDirectory() as temp_media_root:
            with self.settings(MEDIA_ROOT=temp_media_root):
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
                self.client.post(f"/api/print-jobs/{job_id}/execute/", {}, format="json")
                print_job = PrintJob.objects.get(id=job_id)
                artifact_path = Path(print_job.artifact_pdf.path)
                self.assertTrue(artifact_path.exists())
                print_job.finished_at = timezone.now() - timedelta(days=45)
                print_job.save(update_fields=["finished_at", "updated_at"])

                dry_run_stdout = StringIO()
                call_command(
                    "prune_print_job_artifacts",
                    "--days",
                    "30",
                    "--dry-run",
                    stdout=dry_run_stdout,
                )
                print_job.refresh_from_db()
                self.assertTrue(bool(print_job.artifact_pdf))
                self.assertTrue(artifact_path.exists())
                self.assertIn("Dry run complete", dry_run_stdout.getvalue())

                run_stdout = StringIO()
                call_command(
                    "prune_print_job_artifacts",
                    "--days",
                    "30",
                    stdout=run_stdout,
                )
                print_job.refresh_from_db()
                self.assertFalse(bool(print_job.artifact_pdf))
                self.assertEqual(print_job.artifact_size_bytes, 0)
                self.assertEqual(print_job.artifact_sha256, "")
                self.assertFalse(artifact_path.exists())
                self.assertTrue(
                    FinanceAuditLog.objects.filter(
                        action="print_job.artifact_pruned",
                        metadata__print_job_id=job_id,
                    ).exists()
                )
