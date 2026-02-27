from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from clubs.models import Club

from .models import (
    CardFormatPreset,
    CardTemplate,
    CardTemplateVersion,
    PaperProfile,
    PrintJob,
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
                "total_items": 3,
                "metadata": {"trigger": "club-admin"},
            },
            format="json",
        )
        self.assertEqual(own_club_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(own_club_response.data["status"], PrintJob.Status.QUEUED)

        other_club_response = self.client.post(
            "/api/print-jobs/",
            {
                "club": self.other_club.id,
                "template_version": self.published_version.id,
                "paper_profile": self.paper_profile.id,
                "total_items": 1,
            },
            format="json",
        )
        self.assertEqual(other_club_response.status_code, status.HTTP_403_FORBIDDEN)

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
