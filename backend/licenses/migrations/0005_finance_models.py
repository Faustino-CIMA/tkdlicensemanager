import decimal

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

import licenses.models


class Migration(migrations.Migration):
    dependencies = [
        ("clubs", "0001_initial"),
        ("members", "0004_merge_0002_sex_0003_license_ids"),
        ("licenses", "0004_alter_license_license_type"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Order",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("order_number", models.CharField(default=licenses.models.generate_order_number, editable=False, max_length=20, unique=True)),
                ("status", models.CharField(choices=[("draft", "Draft"), ("pending", "Pending"), ("paid", "Paid"), ("cancelled", "Cancelled"), ("refunded", "Refunded")], default="draft", max_length=20)),
                ("currency", models.CharField(default="EUR", max_length=3)),
                ("subtotal", models.DecimalField(decimal_places=2, default=decimal.Decimal("0.00"), max_digits=10)),
                ("tax_total", models.DecimalField(decimal_places=2, default=decimal.Decimal("0.00"), max_digits=10)),
                ("total", models.DecimalField(decimal_places=2, default=decimal.Decimal("0.00"), max_digits=10)),
                ("stripe_payment_intent_id", models.CharField(blank=True, max_length=255)),
                ("stripe_checkout_session_id", models.CharField(blank=True, max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("club", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="orders", to="clubs.club")),
                ("member", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="orders", to="members.member")),
            ],
        ),
        migrations.CreateModel(
            name="Invoice",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("invoice_number", models.CharField(default=licenses.models.generate_invoice_number, editable=False, max_length=20, unique=True)),
                ("status", models.CharField(choices=[("draft", "Draft"), ("issued", "Issued"), ("paid", "Paid"), ("void", "Void")], default="draft", max_length=20)),
                ("currency", models.CharField(default="EUR", max_length=3)),
                ("subtotal", models.DecimalField(decimal_places=2, default=decimal.Decimal("0.00"), max_digits=10)),
                ("tax_total", models.DecimalField(decimal_places=2, default=decimal.Decimal("0.00"), max_digits=10)),
                ("total", models.DecimalField(decimal_places=2, default=decimal.Decimal("0.00"), max_digits=10)),
                ("stripe_invoice_id", models.CharField(blank=True, max_length=255)),
                ("stripe_customer_id", models.CharField(blank=True, max_length=255)),
                ("issued_at", models.DateTimeField(blank=True, null=True)),
                ("paid_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("club", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="invoices", to="clubs.club")),
                ("member", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="invoices", to="members.member")),
                ("order", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name="invoice", to="licenses.order")),
            ],
        ),
        migrations.CreateModel(
            name="FinanceAuditLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("action", models.CharField(max_length=100)),
                ("message", models.TextField(blank=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("actor", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="finance_audit_logs", to=settings.AUTH_USER_MODEL)),
                ("club", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="finance_logs", to="clubs.club")),
                ("invoice", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="audit_logs", to="licenses.invoice")),
                ("license", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="finance_logs", to="licenses.license")),
                ("member", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="finance_logs", to="members.member")),
                ("order", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="audit_logs", to="licenses.order")),
            ],
        ),
        migrations.CreateModel(
            name="OrderItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("price_snapshot", models.DecimalField(decimal_places=2, max_digits=10)),
                ("quantity", models.PositiveIntegerField(default=1)),
                ("license", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="order_items", to="licenses.license")),
                ("order", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="items", to="licenses.order")),
            ],
        ),
    ]
