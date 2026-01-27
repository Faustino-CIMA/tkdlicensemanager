from allauth.account.models import EmailAddress, EmailConfirmationHMAC
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import User


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
from django.test import TestCase

# Create your tests here.
