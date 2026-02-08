from datetime import date
import hashlib
import hmac
import json
import time
from unittest.mock import patch
from decimal import Decimal

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from clubs.models import Club
from members.models import Member

from .models import FinanceAuditLog, Invoice, License, LicenseType, Order, OrderItem


class LicenseModelTests(TestCase):
    def test_license_dates_default_to_calendar_year(self):
        admin = User.objects.create_user(
            username="admin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        club = Club.objects.create(name="Elite Club", created_by=admin)
        member = Member.objects.create(
            club=club,
            first_name="Kai",
            last_name="Zhang",
        )

        license_record = License.objects.create(member=member, club=club, year=2026)

        self.assertEqual(license_record.start_date, date(2026, 1, 1))
        self.assertEqual(license_record.end_date, date(2026, 12, 31))


class MemberDeletionCascadeTests(TestCase):
    def test_member_delete_cascades_licenses(self):
        admin = User.objects.create_user(
            username="admin2",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        club = Club.objects.create(name="Cascade Club", created_by=admin)
        member = Member.objects.create(
            club=club,
            first_name="Lina",
            last_name="Meyer",
        )
        License.objects.create(member=member, club=club, year=2026)

        member.delete()

        self.assertEqual(License.objects.count(), 0)


class LicenseTypeApiTests(TestCase):
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

    def test_ltf_admin_can_create_license_type(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            "/api/license-types/", {"name": "Premium"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["name"], "Premium")

    def test_non_ltf_cannot_create_license_type(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post("/api/license-types/", {"name": "Free"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_authenticated_user_can_list_license_types(self):
        LicenseType.objects.create(name="Standard", code="standard")
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.get("/api/license-types/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = {item["name"] for item in response.data}
        self.assertIn("Standard", names)

    def test_delete_blocked_when_in_use(self):
        self.client.force_authenticate(user=self.ltf_admin)
        license_type, _ = LicenseType.objects.get_or_create(
            name="Paid", defaults={"code": "paid"}
        )
        club = Club.objects.create(name="Locked Club", created_by=self.ltf_admin)
        member = Member.objects.create(club=club, first_name="Dina", last_name="Lopez")
        License.objects.create(member=member, club=club, year=2026, license_type=license_type)

        response = self.client.delete(f"/api/license-types/{license_type.id}/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class FinanceModelTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="financeadmin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.club = Club.objects.create(name="Finance Club", created_by=self.admin)
        self.member = Member.objects.create(
            club=self.club,
            first_name="Maya",
            last_name="Rossi",
        )
        self.license_record = License.objects.create(
            member=self.member,
            club=self.club,
            year=2026,
        )

    def test_order_and_invoice_defaults(self):
        order = Order.objects.create(
            club=self.club,
            member=self.member,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
        )
        self.assertEqual(order.currency, "EUR")
        self.assertTrue(order.order_number.startswith("ORD-"))

        invoice = Invoice.objects.create(
            order=order,
            club=self.club,
            member=self.member,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
        )
        self.assertEqual(invoice.currency, "EUR")
        self.assertTrue(invoice.invoice_number.startswith("INV-"))

    def test_order_number_is_unique(self):
        order_one = Order.objects.create(club=self.club, member=self.member)
        order_two = Order.objects.create(club=self.club, member=self.member)
        self.assertNotEqual(order_one.order_number, order_two.order_number)

    def test_order_item_price_snapshot_and_quantity(self):
        order = Order.objects.create(club=self.club, member=self.member)
        item = OrderItem.objects.create(
            order=order,
            license=self.license_record,
            price_snapshot=Decimal("30.00"),
            quantity=2,
        )
        self.assertEqual(item.price_snapshot, Decimal("30.00"))
        self.assertEqual(item.quantity, 2)

    def test_finance_audit_log_links(self):
        order = Order.objects.create(club=self.club, member=self.member)
        invoice = Invoice.objects.create(
            order=order,
            club=self.club,
            member=self.member,
            total=Decimal("30.00"),
        )
        log = FinanceAuditLog.objects.create(
            action="invoice.created",
            actor=self.admin,
            club=self.club,
            member=self.member,
            license=self.license_record,
            order=order,
            invoice=invoice,
            message="Created invoice for member",
        )
        self.assertEqual(log.order, order)
        self.assertEqual(log.invoice, invoice)


class OrderApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="ltfadmin2",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.ltf_finance = User.objects.create_user(
            username="ltffinance",
            password="pass12345",
            role=User.Roles.LTF_FINANCE,
        )
        self.club_admin = User.objects.create_user(
            username="clubadmin2",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )
        self.club = Club.objects.create(name="Orders Club", created_by=self.ltf_admin)
        self.member = Member.objects.create(
            club=self.club,
            first_name="Ria",
            last_name="Bauer",
        )

    def _order_payload(self):
        return {
            "club": self.club.id,
            "member": self.member.id,
            "currency": "EUR",
            "tax_total": "5.00",
            "items": [
                {
                    "year": 2026,
                    "price_snapshot": "30.00",
                    "quantity": 1,
                }
            ],
        }

    def test_finance_can_create_order(self):
        self.client.force_authenticate(user=self.ltf_finance)
        response = self.client.post("/api/orders/", self._order_payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["status"], Order.Status.PENDING)
        self.assertIsNotNone(response.data.get("invoice"))
        order_id = response.data["id"]
        self.assertTrue(
            FinanceAuditLog.objects.filter(order_id=order_id, action="order.created").exists()
        )
        self.assertTrue(
            FinanceAuditLog.objects.filter(order_id=order_id, action="invoice.created").exists()
        )
        self.assertTrue(
            FinanceAuditLog.objects.filter(order_id=order_id, action="licenses.created").exists()
        )

    def test_non_finance_cannot_create_order(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post("/api/orders/", self._order_payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_batch_create_orders(self):
        self.client.force_authenticate(user=self.ltf_finance)
        payload = [self._order_payload(), self._order_payload()]
        response = self.client.post("/api/orders/batch/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(response.data), 2)

    def test_confirm_payment_allows_admin_fallback(self):
        self.client.force_authenticate(user=self.ltf_finance)
        create_response = self.client.post(
            "/api/orders/", self._order_payload(), format="json"
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        order_id = create_response.data["id"]
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post(
            f"/api/orders/{order_id}/confirm-payment/",
            {
                "stripe_payment_intent_id": "pi_admin_fallback",
                "club_admin_consent_confirmed": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_confirm_payment_transitions_statuses(self):
        self.client.force_authenticate(user=self.ltf_finance)
        create_response = self.client.post(
            "/api/orders/", self._order_payload(), format="json"
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        order_id = create_response.data["id"]
        response = self.client.post(
            f"/api/orders/{order_id}/confirm-payment/",
            {"stripe_payment_intent_id": "pi_123", "club_admin_consent_confirmed": True},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        order = Order.objects.get(id=order_id)
        self.assertEqual(order.status, Order.Status.PAID)
        self.assertEqual(order.invoice.status, Invoice.Status.PAID)

        licenses = License.objects.filter(order_items__order=order).distinct()
        self.assertTrue(licenses.exists())
        for license_record in licenses:
            self.assertEqual(license_record.status, License.Status.ACTIVE)
            self.assertIsNotNone(license_record.issued_at)
            self.assertLessEqual(license_record.issued_at, timezone.now())
        self.assertTrue(
            FinanceAuditLog.objects.filter(order_id=order_id, action="order.paid").exists()
        )

    def test_ltf_admin_cannot_list_orders(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.get("/api/orders/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_ltf_finance_can_list_orders(self):
        self.client.force_authenticate(user=self.ltf_finance)
        response = self.client.get("/api/orders/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_ltf_admin_cannot_list_invoices(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.get("/api/invoices/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_ltf_admin_cannot_list_audit_logs(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.get("/api/finance-audit-logs/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_confirm_payment_requires_consent_confirmation(self):
        self.client.force_authenticate(user=self.ltf_finance)
        order = Order.objects.create(
            club=self.club,
            member=self.member,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
        )
        response = self.client.post(
            f"/api/orders/{order.id}/confirm-payment/",
            {"stripe_payment_intent_id": "pi_no_consent"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    @patch("licenses.views.stripe.checkout.Session.create")
    def test_checkout_requires_consent(self, session_create_mock):
        member_user = User.objects.create_user(
            username="member1",
            password="pass12345",
            role=User.Roles.MEMBER,
        )
        self.member.user = member_user
        self.member.save(update_fields=["user"])
        order = Order.objects.create(
            club=self.club,
            member=self.member,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
        )
        self.client.force_authenticate(user=self.ltf_finance)
        response = self.client.post(
            f"/api/orders/{order.id}/create-checkout-session/", {}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        session_create_mock.assert_not_called()

    def test_confirm_payment_requires_consent(self):
        member_user = User.objects.create_user(
            username="member2",
            password="pass12345",
            role=User.Roles.MEMBER,
        )
        self.member.user = member_user
        self.member.save(update_fields=["user"])
        self.client.force_authenticate(user=self.ltf_finance)
        create_response = self.client.post(
            "/api/orders/", self._order_payload(), format="json"
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        order_id = create_response.data["id"]
        response = self.client.post(
            f"/api/orders/{order_id}/confirm-payment/",
            {"stripe_payment_intent_id": "pi_123"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_activate_licenses_allows_admin(self):
        self.client.force_authenticate(user=self.ltf_finance)
        create_response = self.client.post(
            "/api/orders/", self._order_payload(), format="json"
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        order_id = create_response.data["id"]
        self.client.force_authenticate(user=self.ltf_admin)
        order = Order.objects.get(id=order_id)
        order.status = Order.Status.PAID
        order.save(update_fields=["status"])
        response = self.client.post(
            f"/api/orders/{order_id}/activate-licenses/", {}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        order = Order.objects.get(id=order_id)
        licenses = License.objects.filter(order_items__order=order).distinct()
        self.assertTrue(licenses.exists())
        for license_record in licenses:
            self.assertEqual(license_record.status, License.Status.ACTIVE)

    def test_activate_licenses_blocks_when_unpaid(self):
        self.client.force_authenticate(user=self.ltf_finance)
        create_response = self.client.post(
            "/api/orders/", self._order_payload(), format="json"
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        order_id = create_response.data["id"]
        response = self.client.post(
            f"/api/orders/{order_id}/activate-licenses/", {}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ClubOrderCheckoutTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="ltfadmin4",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.club_admin = User.objects.create_user(
            username="clubadmin3",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )
        self.club = Club.objects.create(name="Club Checkout", created_by=self.ltf_admin)
        self.club.admins.add(self.club_admin)
        self.member = Member.objects.create(
            club=self.club,
            first_name="Nora",
            last_name="Klein",
        )
        self.license_record = License.objects.create(
            member=self.member,
            club=self.club,
            year=2026,
        )
        self.order = Order.objects.create(
            club=self.club,
            member=self.member,
            status=Order.Status.PENDING,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
        )
        OrderItem.objects.create(
            order=self.order,
            license=self.license_record,
            price_snapshot=Decimal("30.00"),
            quantity=1,
        )

    @patch("licenses.views.stripe.checkout.Session.create")
    def test_club_checkout_requires_consent_confirmation(self, session_create_mock):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            f"/api/club-orders/{self.order.id}/create-checkout-session/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        session_create_mock.assert_not_called()

        session_create_mock.reset_mock()
        session_create_mock.return_value = type(
            "Session",
            (),
            {"id": "cs_test_123", "url": "https://stripe.test/session", "payment_intent": "pi_test"},
        )()
        response = self.client.post(
            f"/api/club-orders/{self.order.id}/create-checkout-session/",
            {"club_admin_consent_confirmed": True},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class StripeWebhookSignatureTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="ltfadmin3",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.member_user = User.objects.create_user(
            username="member-consent",
            password="pass12345",
            role=User.Roles.MEMBER,
        )
        self.member_user.give_consent()
        self.club = Club.objects.create(name="Webhook Club", created_by=self.ltf_admin)
        self.member = Member.objects.create(
            club=self.club,
            first_name="Lena",
            last_name="Fox",
            user=self.member_user,
        )
        self.order = Order.objects.create(
            club=self.club,
            member=self.member,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
        )

    def _sign_payload(self, payload: str, secret: str) -> str:
        timestamp = int(time.time())
        signed_payload = f"{timestamp}.{payload}"
        signature = hmac.new(
            secret.encode("utf-8"),
            signed_payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return f"t={timestamp},v1={signature}"

    @override_settings(STRIPE_WEBHOOK_SECRET="whsec_test")
    def test_webhook_rejects_invalid_signature(self):
        payload = json.dumps(
            {
                "type": "payment_intent.succeeded",
                "data": {"object": {"metadata": {"order_id": str(self.order.id)}}},
            }
        )
        response = self.client.post(
            "/api/stripe/webhook/",
            data=payload,
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="t=123,v1=invalid",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(
        STRIPE_WEBHOOK_SECRET="whsec_test",
        CELERY_TASK_ALWAYS_EAGER=True,
        CELERY_TASK_EAGER_PROPAGATES=True,
    )
    def test_webhook_accepts_valid_signature(self):
        payload = json.dumps(
            {
                "type": "payment_intent.succeeded",
                "data": {
                    "object": {
                        "id": "pi_test_123",
                        "metadata": {"order_id": str(self.order.id)},
                    }
                },
            }
        )
        signature = self._sign_payload(payload, "whsec_test")
        response = self.client.post(
            "/api/stripe/webhook/",
            data=payload,
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE=signature,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.Status.PAID)
        self.assertTrue(
            FinanceAuditLog.objects.filter(order=self.order, action="order.paid").exists()
        )

    @override_settings(
        STRIPE_WEBHOOK_SECRET="whsec_test",
        CELERY_TASK_ALWAYS_EAGER=True,
        CELERY_TASK_EAGER_PROPAGATES=True,
    )
    def test_webhook_blocks_without_consent(self):
        no_consent_user = User.objects.create_user(
            username="member-no-consent",
            password="pass12345",
            role=User.Roles.MEMBER,
        )
        member = Member.objects.create(
            club=self.club,
            first_name="No",
            last_name="Consent",
            user=no_consent_user,
        )
        order = Order.objects.create(
            club=self.club,
            member=member,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
        )
        payload = json.dumps(
            {
                "type": "payment_intent.succeeded",
                "data": {
                    "object": {
                        "id": "pi_test_999",
                        "metadata": {"order_id": str(order.id)},
                    }
                },
            }
        )
        signature = self._sign_payload(payload, "whsec_test")
        response = self.client.post(
            "/api/stripe/webhook/",
            data=payload,
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE=signature,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            FinanceAuditLog.objects.filter(order=order, action="order.payment_blocked").exists()
        )

