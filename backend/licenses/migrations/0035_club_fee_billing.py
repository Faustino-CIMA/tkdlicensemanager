from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0034_club_fee_types"),
        ("clubs", "0009_club_active_and_language"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name="orderitem",
            name="license",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="order_items",
                to="licenses.license",
            ),
        ),
        migrations.AddField(
            model_name="orderitem",
            name="description",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="orderitem",
            name="fee_type",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="order_items",
                to="licenses.clubfeetype",
            ),
        ),
        migrations.CreateModel(
            name="ClubFeeBillingSchedule",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "recurrence",
                    models.CharField(
                        choices=[("monthly", "Monthly"), ("annual", "Annual")],
                        max_length=20,
                    ),
                ),
                ("next_run_on", models.DateField()),
                ("end_on", models.DateField(blank=True, null=True)),
                ("last_run_on", models.DateField(blank=True, null=True)),
                ("all_active_clubs", models.BooleanField(default=True)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="club_fee_billing_schedules",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "fee_type",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="billing_schedules",
                        to="licenses.clubfeetype",
                    ),
                ),
                (
                    "clubs",
                    models.ManyToManyField(
                        blank=True,
                        related_name="fee_billing_schedules",
                        to="clubs.club",
                    ),
                ),
            ],
            options={
                "ordering": ["next_run_on", "id"],
            },
        ),
    ]
