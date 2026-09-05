from django.test import TestCase, override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from accounts.models import User
from allauth.account.models import EmailAddress

from .i18n import flatten_messages, unflatten_messages
from .models import AuthEvent, OpsAuditLog, SecurityAlert, TranslationOverride


class OpsAuthTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.member = User.objects.create_user(
            username="clubmember",
            email="member@example.com",
            password="pass12345",
            role=User.Roles.MEMBER,
        )
        EmailAddress.objects.create(
            user=self.member, email=self.member.email, verified=True, primary=True
        )
        self.ltf_admin = User.objects.create_user(
            username="ltfadmin",
            email="ltf@example.com",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        EmailAddress.objects.create(
            user=self.ltf_admin, email=self.ltf_admin.email, verified=True, primary=True
        )
        self.superuser = User.objects.create_superuser(
            username="opsroot",
            email="ops@example.com",
            password="pass12345",
        )

    def _login(self, username, password="pass12345"):
        return self.client.post(
            "/api/auth/login/",
            {"username": username, "password": password},
            format="json",
        )

    def test_superuser_can_login_without_verified_email(self):
        response = self._login("opsroot")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["user"]["is_superuser"])
        self.assertTrue(
            AuthEvent.objects.filter(
                event_type=AuthEvent.EventType.LOGIN_SUCCESS, username_attempted="opsroot"
            ).exists()
        )

    def test_me_includes_is_superuser(self):
        token = Token.objects.create(user=self.superuser)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["is_superuser"])

    def test_failed_login_writes_event(self):
        response = self._login("clubmember", password="wrong-password")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(
            AuthEvent.objects.filter(
                event_type=AuthEvent.EventType.LOGIN_FAILURE, username_attempted="clubmember"
            ).exists()
        )

    @override_settings(OPS_LOCKOUT_FAILURES=3, OPS_LOCKOUT_WINDOW_MINUTES=15)
    def test_lockout_after_repeated_failures(self):
        for _ in range(3):
            self._login("clubmember", password="wrong-password")
        self.assertTrue(
            SecurityAlert.objects.filter(code="brute_force_username", status=SecurityAlert.Status.OPEN).exists()
        )
        locked = self._login("clubmember", password="pass12345")
        self.assertEqual(locked.status_code, 400)
        self.assertTrue(
            AuthEvent.objects.filter(event_type=AuthEvent.EventType.LOCKOUT).exists()
        )

    def test_ltf_admin_cannot_access_ops(self):
        token = Token.objects.create(user=self.ltf_admin)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        response = self.client.get("/api/ops/overview/")
        self.assertEqual(response.status_code, 403)

    def test_superuser_can_access_ops(self):
        token = Token.objects.create(user=self.superuser)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        response = self.client.get("/api/ops/overview/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("health", response.data)

    def test_logout_deletes_token_and_records_event(self):
        login = self._login("opsroot")
        token_key = login.data["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token_key}")
        response = self.client.post("/api/auth/logout/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Token.objects.filter(key=token_key).exists())
        self.assertTrue(
            AuthEvent.objects.filter(
                event_type=AuthEvent.EventType.LOGOUT, username_attempted="opsroot"
            ).exists()
        )

    def test_cannot_revoke_last_superuser(self):
        token = Token.objects.create(user=self.superuser)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        response = self.client.post(
            f"/api/ops/users/{self.superuser.id}/",
            {"action": "revoke_superuser"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.superuser.refresh_from_db()
        self.assertTrue(self.superuser.is_superuser)

    def test_unknown_query_404(self):
        token = Token.objects.create(user=self.superuser)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        response = self.client.post("/api/ops/queries/not-a-query/run/", {"params": {}}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_catalog_query_runs_and_audits(self):
        token = Token.objects.create(user=self.superuser)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        response = self.client.post(
            "/api/ops/queries/accounts_hygiene/run/",
            {"params": {}},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("columns", response.data)
        self.assertTrue(OpsAuditLog.objects.filter(action="query_run", target_id="accounts_hygiene").exists())

    def test_translation_page_returns_full_namespace_in_source_order(self):
        token = Token.objects.create(user=self.superuser)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        response = self.client.get("/api/ops/translations/?namespace=Auth")
        self.assertEqual(response.status_code, 200)
        keys = [row["key"] for row in response.data["results"]]
        self.assertIn("Auth.loginTitle", keys)
        self.assertLess(keys.index("Auth.loginTitle"), keys.index("Auth.loginSubtitle"))
        self.assertTrue(all(row["namespace"] == "Auth" for row in response.data["results"]))
        self.assertGreaterEqual(response.data["count"], 10)

    def test_translation_meta_lists_pages(self):
        token = Token.objects.create(user=self.superuser)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        response = self.client.get("/api/ops/translations/meta/")
        self.assertEqual(response.status_code, 200)
        ids = [page["id"] for page in response.data["pages"]]
        self.assertIn("ClubAdmin", ids)
        self.assertIn("Auth", ids)

    def test_translation_batch_save(self):
        token = Token.objects.create(user=self.superuser)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        response = self.client.post(
            "/api/ops/translations/batch/",
            {
                "namespace": "Auth",
                "changes": [
                    {"locale": "lb", "key": "Auth.loginTitle", "value": "Aloggen (ops)"},
                    {"locale": "en", "key": "Auth.loginSubtitle", "value": "Ops subtitle"},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["saved"], 2)
        export = self.client.get("/api/ops/translations/export/lb/")
        self.assertIn("Aloggen (ops)", export.content.decode("utf-8"))

    def test_translation_override_export(self):
        token = Token.objects.create(user=self.superuser)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        TranslationOverride.objects.create(locale="lb", key="Auth.loginTitle", value="OPS LOGIN")
        response = self.client.get("/api/ops/translations/export/lb/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("OPS LOGIN", response.content.decode("utf-8"))

    def test_public_i18n_allows_anonymous(self):
        from django.core.cache import cache

        TranslationOverride.objects.create(locale="en", key="Auth.loginTitle", value="Ops Sign in")
        cache.delete("ops:i18n:en")
        response = self.client.get("/api/i18n/en/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data.get("Auth", {}).get("loginTitle"), "Ops Sign in")


class I18nHelperTests(TestCase):
    def test_flatten_roundtrip(self):
        nested = {"Auth": {"loginTitle": "Sign in"}, "Home": {"title": "LTF"}}
        flat = flatten_messages(nested)
        self.assertEqual(flat["Auth.loginTitle"], "Sign in")
        self.assertEqual(unflatten_messages(flat)["Home"]["title"], "LTF")
