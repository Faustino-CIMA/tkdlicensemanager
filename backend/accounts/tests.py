from allauth.account.models import EmailAddress, EmailConfirmationHMAC
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory
from rest_framework.test import APIClient

from clubs.models import Club
from licenses.models import License, LicenseHistoryEvent
from members.models import GradePromotionHistory, Member
from .models import User
from .permissions import IsLtfFinance, IsLtfFinanceOrLtfAdmin


class UserModelTests(TestCase):
    def test_default_role_is_member(self):
        user = User.objects.create_user(username="testuser", password="pass12345")
        self.assertEqual(user.role, User.Roles.MEMBER)

    def test_give_and_revoke_consent(self):
        user = User.objects.create_user(username="consentuser", password="pass12345")

        user.give_consent()
        self.assertTrue(user.consent_given)
        self.assertIsNotNone(user.consent_given_at)

        consent_time = user.consent_given_at
        self.assertLessEqual(consent_time, timezone.now())

        user.revoke_consent()
        self.assertFalse(user.consent_given)
        self.assertIsNone(user.consent_given_at)


class AuthApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="verifyme",
            email="verify@example.com",
            password="pass12345",
        )
        self.admin = User.objects.create_user(
            username="adminhistory",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.club = Club.objects.create(name="Export Club", created_by=self.admin)
        self.member = Member.objects.create(
            user=self.user,
            club=self.club,
            first_name="Mia",
            last_name="Stone",
            belt_rank="4th Kup",
        )

    def test_login_requires_verified_email(self):
        response = self.client.post(
            "/api/auth/login/",
            {"username": "verifyme", "password": "pass12345"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_login_succeeds_with_verified_email(self):
        EmailAddress.objects.create(
            user=self.user, email=self.user.email, verified=True, primary=True
        )
        response = self.client.post(
            "/api/auth/login/",
            {"username": "verifyme", "password": "pass12345"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("token", response.data)

    def test_resend_verification(self):
        EmailAddress.objects.create(
            user=self.user, email=self.user.email, verified=False, primary=True
        )
        response = self.client.post(
            "/api/auth/resend-verification/",
            {"email": self.user.email},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def test_verify_email_with_key(self):
        email_address = EmailAddress.objects.create(
            user=self.user, email=self.user.email, verified=False, primary=True
        )
        key = EmailConfirmationHMAC(email_address).key
        response = self.client.post(
            "/api/auth/verify-email/",
            {"key": key},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        email_address.refresh_from_db()
        self.assertTrue(email_address.verified)

    def test_data_export_contains_history_payloads(self):
        license_record = License.objects.create(member=self.member, club=self.club, year=2026)
        LicenseHistoryEvent.objects.create(
            member=self.member,
            license=license_record,
            club=self.club,
            event_type=LicenseHistoryEvent.EventType.ISSUED,
            license_year=license_record.year,
            status_after=license_record.status,
            club_name_snapshot=self.club.name,
        )
        GradePromotionHistory.objects.create(
            member=self.member,
            club=self.club,
            examiner_user=self.admin,
            from_grade="4th Kup",
            to_grade="3rd Kup",
        )
        self.client.force_authenticate(user=self.user)
        response = self.client.get("/api/auth/data-export/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("license_history", response.data)
        self.assertIn("grade_history", response.data)
        self.assertEqual(len(response.data["license_history"]), 1)
        self.assertEqual(len(response.data["grade_history"]), 1)

    def test_data_delete_anonymizes_grade_history_notes(self):
        GradePromotionHistory.objects.create(
            member=self.member,
            club=self.club,
            examiner_user=self.admin,
            from_grade="4th Kup",
            to_grade="3rd Kup",
            notes="Contains personal context",
            proof_ref="file://proof",
        )
        self.client.force_authenticate(user=self.user)
        response = self.client.delete("/api/auth/data-delete/")
        self.assertEqual(response.status_code, 200)
        grade_record = GradePromotionHistory.objects.first()
        self.assertIsNotNone(grade_record)
        assert grade_record is not None
        self.assertEqual(grade_record.notes, "")
        self.assertEqual(grade_record.proof_ref, "")


class FinancePermissionTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.permission = IsLtfFinance()
        self.permission_with_admin = IsLtfFinanceOrLtfAdmin()

    def _request_for_user(self, user):
        request = self.factory.get("/api/finance/")
        request.user = user
        return request

    def test_ltf_finance_allowed(self):
        user = User.objects.create_user(username="finance", password="pass12345")
        user.role = User.Roles.LTF_FINANCE
        user.save(update_fields=["role"])
        request = self._request_for_user(user)
        self.assertTrue(self.permission.has_permission(request, None))
        self.assertTrue(self.permission_with_admin.has_permission(request, None))

    def test_ltf_admin_allowed_in_fallback(self):
        user = User.objects.create_user(username="admin", password="pass12345")
        user.role = User.Roles.LTF_ADMIN
        user.save(update_fields=["role"])
        request = self._request_for_user(user)
        self.assertFalse(self.permission.has_permission(request, None))
        self.assertTrue(self.permission_with_admin.has_permission(request, None))

    def test_non_finance_roles_denied(self):
        roles = [User.Roles.CLUB_ADMIN, User.Roles.COACH, User.Roles.MEMBER]
        for index, role in enumerate(roles, start=1):
            user = User.objects.create_user(username=f"role{index}", password="pass12345")
            user.role = role
            user.save(update_fields=["role"])
            request = self._request_for_user(user)
            self.assertFalse(self.permission.has_permission(request, None))
            self.assertFalse(self.permission_with_admin.has_permission(request, None))
