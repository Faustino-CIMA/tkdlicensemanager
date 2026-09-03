from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0033_backfill_license_issued_at"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ClubFeeType",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=100, unique=True)),
                ("code", models.SlugField(max_length=50, unique=True)),
                ("description", models.TextField(blank=True)),
                (
                    "cadence",
                    models.CharField(
                        choices=[
                            ("one_off", "One-off"),
                            ("annual", "Annual"),
                            ("per_member", "Per member"),
                            ("per_event", "Per event"),
                        ],
                        default="one_off",
                        max_length=20,
                    ),
                ),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["name"],
            },
        ),
        migrations.CreateModel(
            name="ClubFeePrice",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("amount", models.DecimalField(decimal_places=2, max_digits=10)),
                ("currency", models.CharField(default="EUR", max_length=3)),
                ("effective_from", models.DateField(default=django.utils.timezone.localdate)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="club_fee_prices",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "fee_type",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="prices",
                        to="licenses.clubfeetype",
                    ),
                ),
            ],
            options={
                "ordering": ["-effective_from", "-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="clubfeeprice",
            index=models.Index(
                fields=["fee_type", "-effective_from", "-created_at"],
                name="clubfee_type_eff_created_idx",
            ),
        ),
    ]
