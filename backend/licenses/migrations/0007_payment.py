from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0006_license_price"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Payment",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("amount", models.DecimalField(decimal_places=2, default="0.00", max_digits=10)),
                ("currency", models.CharField(default="EUR", max_length=3)),
                (
                    "method",
                    models.CharField(
                        choices=[
                            ("card", "Card"),
                            ("bank_transfer", "Bank transfer"),
                            ("cash", "Cash"),
                            ("offline", "Offline"),
                            ("other", "Other"),
                        ],
                        default="offline",
                        max_length=20,
                    ),
                ),
                (
                    "provider",
                    models.CharField(
                        choices=[
                            ("stripe", "Stripe"),
                            ("payconiq", "Payconiq"),
                            ("paypal", "PayPal"),
                            ("manual", "Manual"),
                            ("other", "Other"),
                        ],
                        default="manual",
                        max_length=20,
                    ),
                ),
                ("reference", models.CharField(blank=True, max_length=255)),
                ("notes", models.TextField(blank=True)),
                ("paid_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="payments_recorded",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "invoice",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="payments",
                        to="licenses.invoice",
                    ),
                ),
                (
                    "order",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="payments",
                        to="licenses.order",
                    ),
                ),
            ],
            options={
                "ordering": ["-paid_at", "-created_at"],
            },
        ),
    ]
