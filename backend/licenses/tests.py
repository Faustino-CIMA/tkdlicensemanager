from datetime import date, timedelta
import hashlib
import hmac
import json
import time
from unittest.mock import patch
from decimal import Decimal
from urllib.error import URLError

from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from clubs.models import Club
from members.models import Member

from .models import (
    FinanceAuditLog,
    Invoice,
    License,
    LicenseHistoryEvent,
    LicensePrice,
    LicenseType,
    LicenseTypePolicy,
    Order,
    OrderItem,
    Payment,
)
from .pdf_utils import build_invoice_context
from .services import apply_payment_and_activate
from .tasks import (
    activate_eligible_paid_licenses,
    reconcile_expired_licenses,
    reconcile_pending_stripe_orders,
)


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
        license_type = LicenseType.objects.create(name="Model Annual", code="model-annual")
        license_record = License.objects.create(
            member=member,
            club=club,
            license_type=license_type,
            year=2026,
        )

        self.assertEqual(license_record.start_date, date(2026, 1, 1))
        self.assertEqual(license_record.end_date, date(2026, 12, 31))

    def test_license_simple_history_created(self):
        admin = User.objects.create_user(
            username="historyadmin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        club = Club.objects.create(name="History Club", created_by=admin)
        member = Member.objects.create(club=club, first_name="Ana", last_name="Park")
        license_type = LicenseType.objects.create(
            name="History Annual",
            code="history-annual",
        )
        license_record = License.objects.create(
            member=member,
            club=club,
            license_type=license_type,
            year=2027,
        )
        license_record.status = License.Status.ACTIVE
        license_record.save(update_fields=["status", "updated_at"])

        self.assertGreaterEqual(license_record.history.count(), 2)

    def test_license_history_event_is_immutable(self):
        admin = User.objects.create_user(
            username="immutadmin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        club = Club.objects.create(name="Immutable Club", created_by=admin)
        member = Member.objects.create(club=club, first_name="Noah", last_name="Stone")
        license_type = LicenseType.objects.create(
            name="Immutable Annual",
            code="immutable-annual",
        )
        license_record = License.objects.create(
            member=member,
            club=club,
            license_type=license_type,
            year=2028,
        )
        event = LicenseHistoryEvent.objects.create(
            member=member,
            license=license_record,
            club=club,
            actor=admin,
            event_type=LicenseHistoryEvent.EventType.ISSUED,
            license_year=license_record.year,
            status_after=license_record.status,
            club_name_snapshot=club.name,
        )

        event.reason = "updated"
        with self.assertRaises(ValidationError):
            event.save()
        with self.assertRaises(ValidationError):
            event.delete()


class LicenseHistoryTaskTests(TestCase):
    def test_reconcile_expired_licenses_creates_events(self):
        admin = User.objects.create_user(
            username="expiryadmin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        club = Club.objects.create(name="Expiry Club", created_by=admin)
        member = Member.objects.create(club=club, first_name="Mila", last_name="Fox")
        license_type = LicenseType.objects.create(name="Expiry Annual", code="expiry-annual")
        old_license = License.objects.create(
            member=member,
            club=club,
            license_type=license_type,
            year=2024,
        )
        old_license.status = License.Status.ACTIVE
        old_license.end_date = date(2024, 12, 31)
        old_license.save(update_fields=["status", "end_date", "updated_at"])

        expired_count = reconcile_expired_licenses()
        old_license.refresh_from_db()

        self.assertEqual(expired_count, 1)
        self.assertEqual(old_license.status, License.Status.EXPIRED)
        self.assertTrue(
            LicenseHistoryEvent.objects.filter(
                license=old_license, event_type=LicenseHistoryEvent.EventType.EXPIRED
            ).exists()
        )


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
        license_type = LicenseType.objects.create(
            name="Cascade Annual",
            code="cascade-annual",
        )
        License.objects.create(
            member=member,
            club=club,
            license_type=license_type,
            year=2026,
        )

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
        self.ltf_finance = User.objects.create_user(
            username="ltffinance-license-type",
            password="pass12345",
            role=User.Roles.LTF_FINANCE,
        )
        self.club_admin = User.objects.create_user(
            username="clubadmin",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )

    def test_ltf_finance_can_create_license_type(self):
        self.client.force_authenticate(user=self.ltf_finance)
        response = self.client.post(
            "/api/license-types/", {"name": "Premium"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["name"], "Premium")

    def test_ltf_finance_can_set_initial_price_on_create(self):
        self.client.force_authenticate(user=self.ltf_finance)
        response = self.client.post(
            "/api/license-types/",
            {
                "name": "WithPrice",
                "initial_price_amount": "45.00",
                "initial_price_currency": "EUR",
                "initial_price_effective_from": "2026-01-01",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        license_type_id = response.data["id"]
        self.assertTrue(
            LicensePrice.objects.filter(
                license_type_id=license_type_id,
                amount=Decimal("45.00"),
                currency="EUR",
                effective_from=date(2026, 1, 1),
            ).exists()
        )

    def test_ltf_finance_can_set_free_initial_price(self):
        self.client.force_authenticate(user=self.ltf_finance)
        response = self.client.post(
            "/api/license-types/",
            {
                "name": "FreeTier",
                "initial_price_amount": "0.00",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        license_type_id = response.data["id"]
        self.assertTrue(
            LicensePrice.objects.filter(
                license_type_id=license_type_id,
                amount=Decimal("0.00"),
            ).exists()
        )

    def test_ltf_admin_cannot_create_license_type(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.post("/api/license-types/", {"name": "AdminType"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

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
        self.client.force_authenticate(user=self.ltf_finance)
        license_type = LicenseType.objects.create(name="In Use", code="in-use")
        club = Club.objects.create(name="Locked Club", created_by=self.ltf_admin)
        member = Member.objects.create(club=club, first_name="Dina", last_name="Lopez")
        License.objects.create(member=member, club=club, year=2026, license_type=license_type)

        response = self.client.delete(f"/api/license-types/{license_type.id}/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_ltf_finance_can_update_policy(self):
        license_type = LicenseType.objects.create(name="Windowed", code="windowed")
        self.client.force_authenticate(user=self.ltf_finance)
        response = self.client.patch(
            f"/api/license-types/{license_type.id}/policy/",
            {
                "allow_current_year_order": False,
                "allow_next_year_preorder": True,
                "next_start_month": 9,
                "next_start_day": 1,
                "next_end_month": 12,
                "next_end_day": 31,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        policy = LicenseTypePolicy.objects.get(license_type=license_type)
        self.assertFalse(policy.allow_current_year_order)
        self.assertTrue(policy.allow_next_year_preorder)

    def test_ltf_admin_cannot_update_policy(self):
        license_type = LicenseType.objects.create(name="Locked", code="locked")
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.patch(
            f"/api/license-types/{license_type.id}/policy/",
            {"allow_current_year_order": False},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class LicenseApiPermissionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="license_ltf_admin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.club_admin = User.objects.create_user(
            username="license_club_admin",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )
        self.club = Club.objects.create(name="License Club", created_by=self.ltf_admin)
        self.club.admins.add(self.club_admin)
        self.member = Member.objects.create(
            club=self.club,
            first_name="Lio",
            last_name="Kraus",
        )
        self.license_type = LicenseType.objects.create(name="Annual", code="annual")
        self.license_record = License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
            year=2026,
            status=License.Status.PENDING,
        )

    def _payload(self):
        return {
            "member": self.member.id,
            "club": self.club.id,
            "license_type": self.license_type.id,
            "year": 2027,
            "status": License.Status.PENDING,
        }

    def test_club_admin_can_list_licenses(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.get("/api/licenses/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        returned_ids = {item["id"] for item in response.data}
        self.assertIn(self.license_record.id, returned_ids)

    def test_club_admin_cannot_create_license(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post("/api/licenses/", self._payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_club_admin_cannot_update_license(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.patch(
            f"/api/licenses/{self.license_record.id}/",
            {"status": License.Status.ACTIVE},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_club_admin_cannot_delete_license(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.delete(f"/api/licenses/{self.license_record.id}/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_ltf_admin_can_create_update_and_delete_license(self):
        self.client.force_authenticate(user=self.ltf_admin)
        create_response = self.client.post("/api/licenses/", self._payload(), format="json")
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        created_license_id = create_response.data["id"]

        update_response = self.client.patch(
            f"/api/licenses/{created_license_id}/",
            {"status": License.Status.ACTIVE},
            format="json",
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        self.assertEqual(update_response.data["status"], License.Status.ACTIVE)

        delete_response = self.client.delete(f"/api/licenses/{created_license_id}/")
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)


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
        self.license_type = LicenseType.objects.create(
            name="Finance Annual",
            code="finance-annual",
        )
        self.license_record = License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
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
        self.license_type = LicenseType.objects.create(
            name="Orders Annual",
            code="orders-annual",
        )

    def _order_payload(self):
        return {
            "club": self.club.id,
            "member": self.member.id,
            "currency": "EUR",
            "tax_total": "5.00",
            "items": [
                {
                    "license_type": self.license_type.id,
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
        order = Order.objects.select_related("invoice").get(id=order_id)
        self.assertEqual(order.invoice.status, Invoice.Status.ISSUED)
        self.assertIsNotNone(order.invoice.issued_at)
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
        payment = Payment.objects.filter(order=order).order_by("-created_at").first()
        self.assertIsNotNone(payment)
        self.assertEqual(payment.status, Payment.Status.PAID)
        self.assertEqual(payment.provider, Payment.Provider.STRIPE)
        self.assertEqual(payment.method, Payment.Method.CARD)
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

    def test_ltf_finance_order_list_uses_lightweight_serializer(self):
        self.client.force_authenticate(user=self.ltf_finance)
        create_response = self.client.post(
            "/api/orders/", self._order_payload(), format="json"
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)

        response = self.client.get("/api/orders/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(response.data), 1)
        row = response.data[0]
        self.assertIn("item_quantity", row)
        self.assertNotIn("items", row)
        self.assertNotIn("stripe_payment_intent_id", row)

    def test_ltf_finance_invoice_list_uses_lightweight_serializer(self):
        self.client.force_authenticate(user=self.ltf_finance)
        create_response = self.client.post(
            "/api/orders/", self._order_payload(), format="json"
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)

        response = self.client.get("/api/invoices/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(response.data), 1)
        row = response.data[0]
        self.assertIn("item_quantity", row)
        self.assertNotIn("stripe_invoice_id", row)
        self.assertNotIn("stripe_customer_id", row)

    def test_ltf_admin_cannot_list_invoices(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.get("/api/invoices/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_ltf_admin_cannot_list_audit_logs(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.get("/api/finance-audit-logs/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_ltf_finance_audit_logs_support_search_and_optional_pagination(self):
        self.client.force_authenticate(user=self.ltf_finance)
        FinanceAuditLog.objects.create(
            action="order.alpha",
            message="alpha marker",
            actor=self.ltf_finance,
            club=self.club,
        )
        FinanceAuditLog.objects.create(
            action="invoice.beta",
            message="beta marker",
            actor=self.ltf_finance,
            club=self.club,
        )

        response = self.client.get("/api/finance-audit-logs/?q=alpha")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsInstance(response.data, list)
        self.assertTrue(any(row["action"] == "order.alpha" for row in response.data))
        self.assertFalse(any(row["action"] == "invoice.beta" for row in response.data))

        paged_response = self.client.get("/api/finance-audit-logs/?q=alpha&page=1&page_size=1")
        self.assertEqual(paged_response.status_code, status.HTTP_200_OK)
        self.assertIn("results", paged_response.data)
        self.assertEqual(paged_response.data["count"], 1)
        self.assertEqual(len(paged_response.data["results"]), 1)
        self.assertEqual(paged_response.data["results"][0]["action"], "order.alpha")

    def test_confirm_payment_allows_stripe_without_consent_confirmation(self):
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
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PAID)

    def test_confirm_payment_manual_does_not_require_consent(self):
        self.client.force_authenticate(user=self.ltf_finance)
        create_response = self.client.post(
            "/api/orders/", self._order_payload(), format="json"
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        order_id = create_response.data["id"]
        response = self.client.post(
            f"/api/orders/{order_id}/confirm-payment/",
            {
                "payment_method": "bank_transfer",
                "payment_provider": "manual",
                "payment_reference": "BANK-REF-001",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        order = Order.objects.get(id=order_id)
        payment = Payment.objects.filter(order=order).order_by("-created_at").first()
        self.assertIsNotNone(payment)
        self.assertEqual(payment.status, Payment.Status.PAID)
        self.assertEqual(payment.provider, Payment.Provider.MANUAL)
        self.assertEqual(payment.method, Payment.Method.BANK_TRANSFER)

    @patch("licenses.views.stripe.checkout.Session.create")
    def test_checkout_allows_member_without_consent(self, session_create_mock):
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
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        session_create_mock.assert_called_once()

    def test_confirm_payment_allows_member_without_consent(self):
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
        self.assertEqual(response.status_code, status.HTTP_200_OK)

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


class LicenseOrderingPolicyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="policy_ltf_admin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.ltf_finance = User.objects.create_user(
            username="policy_ltf_finance",
            password="pass12345",
            role=User.Roles.LTF_FINANCE,
        )
        self.club_admin = User.objects.create_user(
            username="policy_club_admin",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )
        self.club = Club.objects.create(name="Policy Club", created_by=self.ltf_admin)
        self.club.admins.add(self.club_admin)
        self.member = Member.objects.create(
            club=self.club,
            first_name="Iva",
            last_name="Muller",
        )
        self.license_type = LicenseType.objects.create(name="Policy Annual", code="policy-annual")
        self.policy = LicenseTypePolicy.objects.create(license_type=self.license_type)
        LicensePrice.objects.create(
            license_type=self.license_type,
            amount=Decimal("30.00"),
            currency="EUR",
            effective_from=timezone.localdate(),
            created_by=self.ltf_finance,
        )

    def _club_batch_payload(self, year: int):
        return {
            "club": self.club.id,
            "license_type": self.license_type.id,
            "member_ids": [self.member.id],
            "year": year,
            "quantity": 1,
            "tax_total": "0.00",
        }

    def _club_eligibility_payload(self, year: int):
        return {
            "club": self.club.id,
            "member_ids": [self.member.id],
            "year": year,
        }

    def test_club_batch_rejects_when_current_year_window_disabled(self):
        self.policy.allow_current_year_order = False
        self.policy.save(update_fields=["allow_current_year_order", "updated_at"])
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            "/api/club-orders/batch/",
            self._club_batch_payload(year=timezone.localdate().year),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_club_eligibility_returns_filtered_license_types(self):
        self.policy.allow_current_year_order = False
        self.policy.save(update_fields=["allow_current_year_order", "updated_at"])

        eligible_type = LicenseType.objects.create(name="Window Open", code="window-open")
        LicensePrice.objects.create(
            license_type=eligible_type,
            amount=Decimal("20.00"),
            currency="EUR",
            effective_from=timezone.localdate(),
            created_by=self.ltf_finance,
        )

        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            "/api/club-orders/eligibility/",
            self._club_eligibility_payload(year=timezone.localdate().year),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        eligible_ids = {item["id"] for item in response.data["eligible_license_types"]}
        self.assertIn(eligible_type.id, eligible_ids)
        self.assertNotIn(self.license_type.id, eligible_ids)

        ineligible = next(
            item for item in response.data["ineligible_license_types"] if item["id"] == self.license_type.id
        )
        reason_codes = {reason["code"] for reason in ineligible["reason_counts"]}
        self.assertIn("current_year_disabled", reason_codes)
        self.assertIn("ineligible_members", ineligible)
        self.assertEqual(len(ineligible["ineligible_members"]), 1)
        self.assertEqual(ineligible["ineligible_members"][0]["member_id"], self.member.id)
        self.assertEqual(
            ineligible["ineligible_members"][0]["reason_code"], "current_year_disabled"
        )

    def test_club_eligibility_flags_license_type_without_active_price(self):
        missing_price_type = LicenseType.objects.create(
            name="Future Price Type",
            code="future-price-type",
        )
        LicensePrice.objects.create(
            license_type=missing_price_type,
            amount=Decimal("99.00"),
            currency="EUR",
            effective_from=timezone.localdate() + timedelta(days=30),
            created_by=self.ltf_finance,
        )

        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            "/api/club-orders/eligibility/",
            self._club_eligibility_payload(year=timezone.localdate().year),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ineligible = next(
            item
            for item in response.data["ineligible_license_types"]
            if item["id"] == missing_price_type.id
        )
        reason_codes = {reason["code"] for reason in ineligible["reason_counts"]}
        self.assertIn("no_active_price", reason_codes)
        self.assertIn("ineligible_members", ineligible)
        self.assertEqual(len(ineligible["ineligible_members"]), 1)
        self.assertEqual(ineligible["ineligible_members"][0]["member_id"], self.member.id)
        self.assertEqual(ineligible["ineligible_members"][0]["reason_code"], "no_active_price")

    def test_club_eligibility_exposes_duplicate_member_details(self):
        existing_license = License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
            year=timezone.localdate().year,
            status=License.Status.ACTIVE,
        )
        self.assertIsNotNone(existing_license.id)

        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            "/api/club-orders/eligibility/",
            self._club_eligibility_payload(year=timezone.localdate().year),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ineligible = next(
            item for item in response.data["ineligible_license_types"] if item["id"] == self.license_type.id
        )
        duplicate_members = [
            item
            for item in ineligible["ineligible_members"]
            if item["reason_code"] == "duplicate_pending_or_active"
        ]
        self.assertEqual(len(duplicate_members), 1)
        self.assertEqual(duplicate_members[0]["member_id"], self.member.id)

    def test_club_batch_allows_next_year_when_preorder_enabled(self):
        self.policy.allow_current_year_order = False
        self.policy.allow_next_year_preorder = True
        self.policy.next_start_month = 1
        self.policy.next_start_day = 1
        self.policy.next_end_month = 12
        self.policy.next_end_day = 31
        self.policy.save(
            update_fields=[
                "allow_current_year_order",
                "allow_next_year_preorder",
                "next_start_month",
                "next_start_day",
                "next_end_month",
                "next_end_day",
                "updated_at",
            ]
        )
        self.client.force_authenticate(user=self.club_admin)
        next_year = timezone.localdate().year + 1
        response = self.client.post(
            "/api/club-orders/batch/",
            self._club_batch_payload(year=next_year),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        order = Order.objects.select_related("invoice").get(id=response.data["id"])
        self.assertEqual(order.invoice.status, Invoice.Status.ISSUED)
        self.assertIsNotNone(order.invoice.issued_at)
        created_license = License.objects.filter(
            club=self.club, member=self.member, year=next_year
        ).first()
        self.assertIsNotNone(created_license)
        self.assertEqual(created_license.license_type_id, self.license_type.id)

    def test_finance_order_rejects_when_current_year_window_disabled(self):
        self.policy.allow_current_year_order = False
        self.policy.save(update_fields=["allow_current_year_order", "updated_at"])
        self.client.force_authenticate(user=self.ltf_finance)
        response = self.client.post(
            "/api/orders/",
            {
                "club": self.club.id,
                "member": self.member.id,
                "currency": "EUR",
                "tax_total": "0.00",
                "items": [
                    {
                        "license_type": self.license_type.id,
                        "year": timezone.localdate().year,
                        "price_snapshot": "30.00",
                        "quantity": 1,
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_club_batch_allows_free_price_license_type(self):
        LicensePrice.objects.create(
            license_type=self.license_type,
            amount=Decimal("0.00"),
            currency="EUR",
            effective_from=timezone.localdate(),
            created_by=self.ltf_finance,
        )
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            "/api/club-orders/batch/",
            self._club_batch_payload(year=timezone.localdate().year),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        order = Order.objects.get(id=response.data["id"])
        self.assertEqual(order.subtotal, Decimal("0.00"))
        self.assertEqual(order.total, Decimal("0.00"))
        self.assertEqual(order.invoice.status, Invoice.Status.ISSUED)
        self.assertIsNotNone(order.invoice.issued_at)


class LicenseActivationRulesTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="activation_ltf_admin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.ltf_finance = User.objects.create_user(
            username="activation_ltf_finance",
            password="pass12345",
            role=User.Roles.LTF_FINANCE,
        )
        self.club = Club.objects.create(name="Activation Club", created_by=self.ltf_admin)
        self.member = Member.objects.create(
            club=self.club,
            first_name="Nia",
            last_name="Roy",
        )
        self.license_type = LicenseType.objects.create(name="Activation Annual", code="activation-annual")

    def _create_paid_order_for_license(self, license_record: License):
        order = Order.objects.create(
            club=license_record.club,
            member=license_record.member,
            status=Order.Status.PAID,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
        )
        invoice = Invoice.objects.create(
            order=order,
            club=license_record.club,
            member=license_record.member,
            status=Invoice.Status.PAID,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
            issued_at=timezone.now(),
            paid_at=timezone.now(),
        )
        OrderItem.objects.create(
            order=order,
            license=license_record,
            price_snapshot=Decimal("30.00"),
            quantity=1,
        )
        return order, invoice

    def _create_pending_order_for_license(self, license_record: License):
        order = Order.objects.create(
            club=license_record.club,
            member=license_record.member,
            status=Order.Status.PENDING,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
        )
        invoice = Invoice.objects.create(
            order=order,
            club=license_record.club,
            member=license_record.member,
            status=Invoice.Status.DRAFT,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
            issued_at=timezone.now(),
        )
        OrderItem.objects.create(
            order=order,
            license=license_record,
            price_snapshot=Decimal("30.00"),
            quantity=1,
        )
        return order, invoice

    def test_active_license_constraint_blocks_second_active_license(self):
        current_year = timezone.localdate().year
        License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
            year=current_year,
            status=License.Status.ACTIVE,
        )
        with self.assertRaises(IntegrityError):
            License.objects.create(
                member=self.member,
                club=self.club,
                license_type=self.license_type,
                year=current_year + 1,
                status=License.Status.ACTIVE,
            )

    def test_payment_activation_defers_future_license(self):
        future_year = timezone.localdate().year + 1
        license_record = License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
            year=future_year,
            status=License.Status.PENDING,
            start_date=date(future_year, 1, 1),
            end_date=date(future_year, 12, 31),
        )
        order = Order.objects.create(
            club=self.club,
            member=self.member,
            status=Order.Status.PENDING,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
        )
        Invoice.objects.create(
            order=order,
            club=self.club,
            member=self.member,
            status=Invoice.Status.DRAFT,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
        )
        OrderItem.objects.create(
            order=order,
            license=license_record,
            price_snapshot=Decimal("30.00"),
            quantity=1,
        )

        apply_payment_and_activate(
            order,
            actor=self.ltf_finance,
            payment_details={
                "payment_method": "bank_transfer",
                "payment_provider": "manual",
                "payment_reference": "BANK-REF-42",
            },
        )
        order.refresh_from_db()
        license_record.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PAID)
        self.assertEqual(order.invoice.status, Invoice.Status.PAID)
        self.assertEqual(license_record.status, License.Status.PENDING)

    def test_activate_eligible_paid_licenses_task_activates_pending(self):
        today = timezone.localdate()
        license_record = License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
            year=today.year,
            status=License.Status.PENDING,
            start_date=today,
            end_date=today + timedelta(days=30),
        )
        self._create_paid_order_for_license(license_record)
        activated_count = activate_eligible_paid_licenses()
        license_record.refresh_from_db()
        self.assertEqual(activated_count, 1)
        self.assertEqual(license_record.status, License.Status.ACTIVE)

    def test_activate_eligible_paid_licenses_respects_existing_active_license(self):
        today = timezone.localdate()
        License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
            year=today.year,
            status=License.Status.ACTIVE,
            start_date=today - timedelta(days=1),
            end_date=today + timedelta(days=30),
        )
        pending_license = License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
            year=today.year + 1,
            status=License.Status.PENDING,
            start_date=today,
            end_date=today + timedelta(days=30),
        )
        self._create_paid_order_for_license(pending_license)
        activated_count = activate_eligible_paid_licenses()
        pending_license.refresh_from_db()
        self.assertEqual(activated_count, 0)
        self.assertEqual(pending_license.status, License.Status.PENDING)

    @patch("licenses.tasks.stripe.PaymentIntent.retrieve")
    def test_reconcile_pending_stripe_orders_uses_payment_intent(self, payment_intent_mock):
        today = timezone.localdate()
        license_record = License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
            year=today.year,
            status=License.Status.PENDING,
            start_date=today,
            end_date=today + timedelta(days=30),
        )
        order, _invoice = self._create_pending_order_for_license(license_record)
        order.stripe_payment_intent_id = "pi_reconcile_123"
        order.save(update_fields=["stripe_payment_intent_id", "updated_at"])

        payment_intent_mock.return_value = {
            "id": "pi_reconcile_123",
            "status": "succeeded",
            "customer": "cus_reconcile_123",
            "charges": {
                "data": [
                    {
                        "payment_method_details": {
                            "card": {
                                "brand": "visa",
                                "last4": "4242",
                                "exp_month": 12,
                                "exp_year": 2030,
                            }
                        }
                    }
                ]
            },
        }

        processed_count = reconcile_pending_stripe_orders()
        self.assertEqual(processed_count, 1)

        order.refresh_from_db()
        license_record.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PAID)
        self.assertEqual(order.invoice.status, Invoice.Status.PAID)
        self.assertEqual(license_record.status, License.Status.ACTIVE)
        self.assertEqual(order.invoice.stripe_customer_id, "cus_reconcile_123")

        payment = Payment.objects.filter(order=order).order_by("-created_at").first()
        self.assertIsNotNone(payment)
        self.assertEqual(payment.status, Payment.Status.PAID)
        self.assertEqual(payment.provider, Payment.Provider.STRIPE)
        self.assertEqual(payment.method, Payment.Method.CARD)

    @patch("licenses.tasks.stripe.PaymentIntent.retrieve")
    def test_reconcile_pending_stripe_orders_reuses_payment_intent_lookup(
        self, payment_intent_mock
    ):
        today = timezone.localdate()
        second_member = Member.objects.create(
            club=self.club,
            first_name="Ivy",
            last_name="Stone",
        )
        first_license = License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
            year=today.year,
            status=License.Status.PENDING,
            start_date=today,
            end_date=today + timedelta(days=30),
        )
        second_license = License.objects.create(
            member=second_member,
            club=self.club,
            license_type=self.license_type,
            year=today.year,
            status=License.Status.PENDING,
            start_date=today,
            end_date=today + timedelta(days=30),
        )

        first_order, _ = self._create_pending_order_for_license(first_license)
        second_order, _ = self._create_pending_order_for_license(second_license)
        for order in (first_order, second_order):
            order.stripe_payment_intent_id = "pi_reconcile_shared"
            order.save(update_fields=["stripe_payment_intent_id", "updated_at"])

        payment_intent_mock.return_value = {
            "id": "pi_reconcile_shared",
            "status": "succeeded",
            "customer": "cus_reconcile_shared",
            "charges": {
                "data": [
                    {
                        "payment_method_details": {
                            "card": {
                                "brand": "visa",
                                "last4": "4242",
                                "exp_month": 12,
                                "exp_year": 2030,
                            }
                        }
                    }
                ]
            },
        }

        processed_count = reconcile_pending_stripe_orders()
        self.assertEqual(processed_count, 2)
        self.assertEqual(payment_intent_mock.call_count, 1)

    @patch("licenses.tasks.stripe.PaymentIntent.retrieve")
    @patch("licenses.tasks.stripe.checkout.Session.retrieve")
    def test_reconcile_pending_stripe_orders_uses_checkout_session(
        self,
        session_mock,
        payment_intent_mock,
    ):
        today = timezone.localdate()
        license_record = License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
            year=today.year,
            status=License.Status.PENDING,
            start_date=today,
            end_date=today + timedelta(days=30),
        )
        order, _invoice = self._create_pending_order_for_license(license_record)
        order.stripe_checkout_session_id = "cs_reconcile_123"
        order.save(update_fields=["stripe_checkout_session_id", "updated_at"])

        session_mock.return_value = {
            "id": "cs_reconcile_123",
            "payment_status": "paid",
            "customer": "cus_checkout_123",
            "payment_intent": "pi_from_checkout_123",
        }
        payment_intent_mock.return_value = {
            "id": "pi_from_checkout_123",
            "status": "succeeded",
            "customer": "cus_checkout_123",
            "charges": {
                "data": [
                    {
                        "payment_method_details": {
                            "card": {
                                "brand": "mastercard",
                                "last4": "4444",
                                "exp_month": 8,
                                "exp_year": 2032,
                            }
                        }
                    }
                ]
            },
        }

        processed_count = reconcile_pending_stripe_orders()
        self.assertEqual(processed_count, 1)

        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PAID)
        self.assertEqual(order.stripe_payment_intent_id, "pi_from_checkout_123")
        self.assertEqual(order.invoice.stripe_customer_id, "cus_checkout_123")


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
        self.license_type = LicenseType.objects.create(
            name="Checkout Annual",
            code="checkout-annual",
        )
        self.license_record = License.objects.create(
            member=self.member,
            club=self.club,
            license_type=self.license_type,
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
        session_create_mock.return_value = type(
            "Session",
            (),
            {"id": "cs_test_123", "url": "https://stripe.test/session", "payment_intent": "pi_test"},
        )()
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            f"/api/club-orders/{self.order.id}/create-checkout-session/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_club_order_list_uses_lightweight_serializer(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.get("/api/club-orders/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(response.data), 1)
        row = response.data[0]
        self.assertIn("item_quantity", row)
        self.assertNotIn("items", row)
        self.assertNotIn("stripe_payment_intent_id", row)


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
        self.invoice = Invoice.objects.create(
            order=self.order,
            club=self.club,
            member=self.member,
            status=Invoice.Status.DRAFT,
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
        payment = Payment.objects.filter(order=self.order).order_by("-created_at").first()
        self.assertIsNotNone(payment)
        self.assertEqual(payment.status, Payment.Status.PAID)
        self.assertEqual(payment.provider, Payment.Provider.STRIPE)
        self.assertEqual(payment.method, Payment.Method.CARD)
        self.assertTrue(
            FinanceAuditLog.objects.filter(order=self.order, action="order.paid").exists()
        )

    @override_settings(
        STRIPE_WEBHOOK_SECRET="whsec_test",
        CELERY_TASK_ALWAYS_EAGER=True,
        CELERY_TASK_EAGER_PROPAGATES=True,
    )
    def test_webhook_allows_processing_without_consent(self):
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
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PAID)
        self.assertFalse(
            FinanceAuditLog.objects.filter(order=order, action="order.payment_blocked").exists()
        )
        self.assertTrue(
            FinanceAuditLog.objects.filter(order=order, action="order.paid").exists()
        )


class PayconiqPaymentTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="ltfadmin-payconiq",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.club_admin = User.objects.create_user(
            username="clubadmin-payconiq",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )
        self.other_club_admin = User.objects.create_user(
            username="clubadmin-other",
            password="pass12345",
            role=User.Roles.CLUB_ADMIN,
        )
        self.club = Club.objects.create(name="Payconiq Club", created_by=self.ltf_admin)
        self.club.admins.add(self.club_admin)
        self.member = Member.objects.create(
            club=self.club,
            first_name="Pay",
            last_name="Coniq",
        )
        self.order = Order.objects.create(
            club=self.club,
            member=self.member,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
        )
        self.invoice = Invoice.objects.create(
            order=self.order,
            club=self.club,
            member=self.member,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
        )

    def _http_response(self, payload):
        class MockHttpResponse:
            def __init__(self, body):
                self._body = body.encode("utf-8")

            def read(self):
                return self._body

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_val, exc_tb):
                return False

        return MockHttpResponse(json.dumps(payload))

    @override_settings(PAYCONIQ_MODE="mock", PAYCONIQ_BASE_URL="https://payconiq.mock")
    def test_club_admin_can_create_payconiq_payment(self):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            "/api/payconiq/create/",
            {"invoice_id": self.invoice.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["provider"], "payconiq")
        self.assertTrue(response.data["payconiq_payment_url"].startswith("https://payconiq.mock"))
        self.assertTrue(
            FinanceAuditLog.objects.filter(order=self.order, action="payconiq.created").exists()
        )

    @override_settings(
        PAYCONIQ_MODE="aggregator",
        PAYCONIQ_API_KEY="sandbox_api_key",
        PAYCONIQ_MERCHANT_ID="merchant_sandbox_123",
        PAYCONIQ_BASE_URL="https://sandbox-aggregator.example.test",
        PAYCONIQ_CREATE_PATH="/v1/payments",
        PAYCONIQ_STATUS_PATH="/v1/payments/{payment_id}",
        PAYCONIQ_TIMEOUT_SECONDS=5,
        PAYCONIQ_AUTH_SCHEME="Bearer",
    )
    @patch("licenses.payconiq.urlopen")
    def test_aggregator_create_payment_success(self, urlopen_mock):
        urlopen_mock.return_value = self._http_response(
            {
                "id": "agg_payment_123",
                "checkout_url": "https://pay.example.test/checkout/agg_payment_123",
                "status": "created",
            }
        )
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            "/api/payconiq/create/",
            {"invoice_id": self.invoice.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["provider"], "payconiq")
        self.assertEqual(response.data["payconiq_status"], "PENDING")
        self.assertEqual(response.data["payconiq_payment_id"], "agg_payment_123")
        self.assertEqual(
            response.data["payconiq_payment_url"],
            "https://pay.example.test/checkout/agg_payment_123",
        )

        request_obj = urlopen_mock.call_args.args[0]
        self.assertEqual(
            request_obj.full_url, "https://sandbox-aggregator.example.test/v1/payments"
        )
        header_map = {key.lower(): value for key, value in request_obj.header_items()}
        self.assertEqual(header_map.get("authorization"), "Bearer sandbox_api_key")
        self.assertEqual(header_map.get("x-merchant-id"), "merchant_sandbox_123")

        request_payload = json.loads(request_obj.data.decode("utf-8"))
        self.assertEqual(request_payload["reference"], self.invoice.invoice_number)
        self.assertEqual(request_payload["currency"], "EUR")
        self.assertEqual(request_payload["amount"], "30.00")

    @override_settings(
        PAYCONIQ_MODE="aggregator",
        PAYCONIQ_API_KEY="sandbox_api_key",
        PAYCONIQ_MERCHANT_ID="merchant_sandbox_123",
        PAYCONIQ_BASE_URL="https://sandbox-aggregator.example.test",
        PAYCONIQ_CREATE_PATH="/v1/payments",
        PAYCONIQ_STATUS_PATH="/v1/payments/{payment_id}",
    )
    @patch("licenses.payconiq.urlopen")
    def test_aggregator_status_paid_is_idempotent(self, urlopen_mock):
        urlopen_mock.side_effect = [
            self._http_response(
                {
                    "id": "agg_payment_456",
                    "checkout_url": "https://pay.example.test/checkout/agg_payment_456",
                    "status": "open",
                }
            ),
            self._http_response({"id": "agg_payment_456", "status": "succeeded"}),
            self._http_response({"id": "agg_payment_456", "status": "succeeded"}),
        ]
        self.client.force_authenticate(user=self.club_admin)
        create_response = self.client.post(
            "/api/payconiq/create/",
            {"invoice_id": self.invoice.id},
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        payment_id = create_response.data["id"]

        first_status_response = self.client.get(f"/api/payconiq/{payment_id}/status/")
        second_status_response = self.client.get(f"/api/payconiq/{payment_id}/status/")
        self.assertEqual(first_status_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_status_response.status_code, status.HTTP_200_OK)
        self.assertEqual(first_status_response.data["payconiq_status"], "PAID")
        self.assertEqual(second_status_response.data["payconiq_status"], "PAID")
        self.assertEqual(first_status_response.data["status"], Payment.Status.PAID)
        self.assertEqual(second_status_response.data["status"], Payment.Status.PAID)

        self.order.refresh_from_db()
        self.invoice.refresh_from_db()
        self.assertEqual(self.order.status, Order.Status.PAID)
        self.assertEqual(self.invoice.status, Invoice.Status.PAID)
        self.assertEqual(
            Payment.objects.filter(order=self.order, provider=Payment.Provider.PAYCONIQ).count(),
            1,
        )
        self.assertEqual(
            FinanceAuditLog.objects.filter(order=self.order, action="order.paid").count(),
            1,
        )

    @override_settings(
        PAYCONIQ_MODE="aggregator",
        PAYCONIQ_API_KEY="secret_api_key",
        PAYCONIQ_MERCHANT_ID="merchant_sandbox_123",
        PAYCONIQ_BASE_URL="https://sandbox-aggregator.example.test",
        PAYCONIQ_CREATE_PATH="/v1/payments",
    )
    @patch("licenses.payconiq.urlopen", side_effect=URLError("connection refused"))
    def test_aggregator_create_payment_returns_sanitized_provider_error(self, urlopen_mock):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            "/api/payconiq/create/",
            {"invoice_id": self.invoice.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)
        self.assertIn("unavailable", response.data["detail"].lower())
        self.assertNotIn("secret_api_key", response.data["detail"])
        urlopen_mock.assert_called_once()

    @override_settings(
        PAYCONIQ_MODE="aggregator",
        PAYCONIQ_API_KEY="",
        PAYCONIQ_MERCHANT_ID="",
        PAYCONIQ_BASE_URL="https://sandbox-aggregator.example.test",
        PAYCONIQ_CREATE_PATH="/v1/payments",
    )
    @patch("licenses.payconiq.urlopen")
    def test_aggregator_create_payment_requires_credentials(self, urlopen_mock):
        self.client.force_authenticate(user=self.club_admin)
        response = self.client.post(
            "/api/payconiq/create/",
            {"invoice_id": self.invoice.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertIn("configuration is incomplete", response.data["detail"].lower())
        urlopen_mock.assert_not_called()

    @override_settings(PAYCONIQ_MODE="mock")
    def test_club_admin_blocked_for_other_club(self):
        other_club = Club.objects.create(name="Other Club", created_by=self.ltf_admin)
        other_member = Member.objects.create(
            club=other_club,
            first_name="Other",
            last_name="Club",
        )
        other_order = Order.objects.create(
            club=other_club,
            member=other_member,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
        )
        other_invoice = Invoice.objects.create(
            order=other_order,
            club=other_club,
            member=other_member,
            subtotal=Decimal("25.00"),
            tax_total=Decimal("5.00"),
            total=Decimal("30.00"),
        )

        self.client.force_authenticate(user=self.other_club_admin)
        response = self.client.post(
            "/api/payconiq/create/",
            {"invoice_id": other_invoice.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(PAYCONIQ_MODE="mock")
    def test_payconiq_status_endpoint(self):
        self.client.force_authenticate(user=self.club_admin)
        create_response = self.client.post(
            "/api/payconiq/create/",
            {"invoice_id": self.invoice.id},
            format="json",
        )
        payment_id = create_response.data["id"]
        status_response = self.client.get(f"/api/payconiq/{payment_id}/status/")
        self.assertEqual(status_response.status_code, status.HTTP_200_OK)
        self.assertEqual(status_response.data["payconiq_status"], "PENDING")

    @override_settings(PAYCONIQ_MODE="mock")
    @patch("licenses.views.get_status", return_value="PAID")
    def test_payconiq_status_paid_finalizes_order_and_invoice(self, status_mock):
        self.client.force_authenticate(user=self.club_admin)
        create_response = self.client.post(
            "/api/payconiq/create/",
            {"invoice_id": self.invoice.id},
            format="json",
        )
        payment_id = create_response.data["id"]

        status_response = self.client.get(f"/api/payconiq/{payment_id}/status/")
        self.assertEqual(status_response.status_code, status.HTTP_200_OK)
        self.assertEqual(status_response.data["payconiq_status"], "PAID")
        self.assertEqual(status_response.data["status"], Payment.Status.PAID)

        self.order.refresh_from_db()
        self.invoice.refresh_from_db()
        self.assertEqual(self.order.status, Order.Status.PAID)
        self.assertEqual(self.invoice.status, Invoice.Status.PAID)
        self.assertIsNotNone(self.invoice.paid_at)
        self.assertTrue(
            FinanceAuditLog.objects.filter(order=self.order, action="order.paid").exists()
        )

    @override_settings(
        PAYCONIQ_MODE="mock",
        INVOICE_SEPA_BENEFICIARY="LTF License Manager",
        INVOICE_SEPA_IBAN="LU123000000000000000",
        INVOICE_SEPA_BIC="TESTBIC",
        INVOICE_SEPA_REMITTANCE_PREFIX="Invoice",
    )
    def test_invoice_context_contains_qr_payloads(self):
        self.client.force_authenticate(user=self.club_admin)
        self.client.post(
            "/api/payconiq/create/",
            {"invoice_id": self.invoice.id},
            format="json",
        )
        context = build_invoice_context(self.invoice)
        self.assertTrue(context["payconiq_qr"])
        self.assertTrue(context["sepa_qr"])


class OverviewApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ltf_admin = User.objects.create_user(
            username="overview-ltf-admin",
            password="pass12345",
            role=User.Roles.LTF_ADMIN,
        )
        self.ltf_finance = User.objects.create_user(
            username="overview-ltf-finance",
            password="pass12345",
            role=User.Roles.LTF_FINANCE,
        )

        self.club_one = Club.objects.create(name="Overview Club A", created_by=self.ltf_admin)
        self.club_two = Club.objects.create(name="Overview Club B", created_by=self.ltf_admin)
        self.club_one.admins.add(self.ltf_admin)

        self.member_active_with_id = Member.objects.create(
            club=self.club_one,
            first_name="Ari",
            last_name="One",
            ltf_licenseid="LTF-100",
            is_active=True,
        )
        self.member_active_missing_id = Member.objects.create(
            club=self.club_one,
            first_name="Bea",
            last_name="Two",
            ltf_licenseid="",
            is_active=True,
        )
        Member.objects.create(
            club=self.club_two,
            first_name="Cid",
            last_name="Three",
            ltf_licenseid="LTF-200",
            is_active=False,
        )

        self.license_type_paid = LicenseType.objects.create(name="Overview Paid", code="overview-paid")
        self.license_type_special = LicenseType.objects.create(
            name="Overview Special",
            code="overview-special",
        )
        LicensePrice.objects.create(
            license_type=self.license_type_paid,
            amount=Decimal("30.00"),
            currency="EUR",
            effective_from=timezone.localdate() - timedelta(days=1),
            created_by=self.ltf_finance,
        )
        LicensePrice.objects.create(
            license_type=self.license_type_special,
            amount=Decimal("45.00"),
            currency="EUR",
            effective_from=timezone.localdate() + timedelta(days=30),
            created_by=self.ltf_finance,
        )

        self.license_active = License.objects.create(
            member=self.member_active_with_id,
            club=self.club_one,
            license_type=self.license_type_paid,
            year=timezone.localdate().year,
            status=License.Status.ACTIVE,
            start_date=timezone.localdate() - timedelta(days=10),
            end_date=timezone.localdate() + timedelta(days=10),
        )
        self.license_pending = License.objects.create(
            member=self.member_active_with_id,
            club=self.club_one,
            license_type=self.license_type_paid,
            year=timezone.localdate().year + 1,
            status=License.Status.PENDING,
        )
        License.objects.create(
            member=self.member_active_missing_id,
            club=self.club_one,
            license_type=self.license_type_paid,
            year=timezone.localdate().year - 1,
            status=License.Status.EXPIRED,
        )
        License.objects.create(
            member=self.member_active_missing_id,
            club=self.club_one,
            license_type=self.license_type_paid,
            year=timezone.localdate().year - 2,
            status=License.Status.REVOKED,
        )

        self.order_draft = Order.objects.create(
            club=self.club_one,
            member=self.member_active_with_id,
            status=Order.Status.DRAFT,
            currency="EUR",
            subtotal=Decimal("30.00"),
            total=Decimal("30.00"),
        )
        self.order_pending = Order.objects.create(
            club=self.club_one,
            member=self.member_active_with_id,
            status=Order.Status.PENDING,
            currency="EUR",
            subtotal=Decimal("30.00"),
            total=Decimal("30.00"),
        )
        self.order_paid = Order.objects.create(
            club=self.club_one,
            member=self.member_active_with_id,
            status=Order.Status.PAID,
            currency="EUR",
            subtotal=Decimal("30.00"),
            total=Decimal("30.00"),
        )
        self.order_cancelled = Order.objects.create(
            club=self.club_one,
            member=self.member_active_with_id,
            status=Order.Status.CANCELLED,
            currency="EUR",
            subtotal=Decimal("30.00"),
            total=Decimal("30.00"),
        )
        self.order_refunded = Order.objects.create(
            club=self.club_one,
            member=self.member_active_with_id,
            status=Order.Status.REFUNDED,
            currency="EUR",
            subtotal=Decimal("30.00"),
            total=Decimal("30.00"),
        )
        OrderItem.objects.create(
            order=self.order_paid,
            license=self.license_pending,
            price_snapshot=Decimal("30.00"),
            quantity=1,
        )

        self.invoice_issued_old = Invoice.objects.create(
            order=self.order_draft,
            club=self.club_one,
            member=self.member_active_with_id,
            status=Invoice.Status.ISSUED,
            currency="EUR",
            subtotal=Decimal("30.00"),
            total=Decimal("30.00"),
            issued_at=timezone.now() - timedelta(days=8),
        )
        self.invoice_paid = Invoice.objects.create(
            order=self.order_paid,
            club=self.club_one,
            member=self.member_active_with_id,
            status=Invoice.Status.PAID,
            currency="EUR",
            subtotal=Decimal("30.00"),
            total=Decimal("30.00"),
            paid_at=timezone.now(),
        )
        Invoice.objects.create(
            order=self.order_pending,
            club=self.club_one,
            member=self.member_active_with_id,
            status=Invoice.Status.DRAFT,
            currency="EUR",
            subtotal=Decimal("30.00"),
            total=Decimal("30.00"),
        )
        Invoice.objects.create(
            order=self.order_cancelled,
            club=self.club_one,
            member=self.member_active_with_id,
            status=Invoice.Status.VOID,
            currency="EUR",
            subtotal=Decimal("30.00"),
            total=Decimal("30.00"),
        )

        Payment.objects.create(
            invoice=self.invoice_paid,
            order=self.order_paid,
            amount=Decimal("30.00"),
            currency="EUR",
            status=Payment.Status.PAID,
            paid_at=timezone.now(),
            created_by=self.ltf_finance,
        )
        Payment.objects.create(
            invoice=self.invoice_issued_old,
            order=self.order_draft,
            amount=Decimal("30.00"),
            currency="EUR",
            status=Payment.Status.FAILED,
            created_by=self.ltf_finance,
        )

        FinanceAuditLog.objects.create(
            action="invoice.created",
            message="Overview test event",
            actor=self.ltf_finance,
            club=self.club_one,
            order=self.order_draft,
            invoice=self.invoice_issued_old,
        )

    def test_ltf_admin_overview_requires_ltf_admin_role(self):
        self.client.force_authenticate(user=self.ltf_finance)
        response = self.client.get("/api/dashboard/overview/ltf-admin/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_ltf_admin_overview_hides_finance_fields(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.get("/api/dashboard/overview/ltf-admin/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("cards", response.data)
        self.assertNotIn("currency", response.data)
        self.assertNotIn("recent_activity", response.data)
        self.assertEqual(response.data["cards"]["total_clubs"], 2)
        self.assertEqual(response.data["cards"]["active_members"], 2)
        self.assertEqual(response.data["cards"]["active_licenses"], 1)

    def test_ltf_finance_overview_requires_ltf_finance_role(self):
        self.client.force_authenticate(user=self.ltf_admin)
        response = self.client.get("/api/dashboard/overview/ltf-finance/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_ltf_finance_overview_contains_finance_metrics(self):
        self.client.force_authenticate(user=self.ltf_finance)
        response = self.client.get("/api/dashboard/overview/ltf-finance/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["cards"]["received_orders"], 2)
        self.assertEqual(response.data["cards"]["delivered_orders"], 1)
        self.assertEqual(response.data["cards"]["cancelled_orders"], 2)
        self.assertGreaterEqual(
            response.data["cards"]["pricing_coverage"]["missing_active_price"],
            1,
        )
        self.assertTrue(
            any(
                item["key"] == "license_types_without_active_price"
                for item in response.data["action_queue"]
            )
        )

