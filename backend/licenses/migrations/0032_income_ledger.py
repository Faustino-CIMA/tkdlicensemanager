from decimal import Decimal

from django.conf import settings
from django.db import migrations, models
import django.core.validators
import django.db.models.deletion


DEFAULT_CATEGORIES = [
    ("subsidies", "Government subsidies", 10),
    ("grants", "Grants", 20),
    ("donations", "Donations", 30),
    ("sponsoring", "Sponsoring", 40),
    ("events", "Event income", 50),
    ("other", "Other income", 60),
]


def seed_income_categories(apps, schema_editor):
    IncomeCategory = apps.get_model("licenses", "IncomeCategory")
    for code, name, sort_order in DEFAULT_CATEGORIES:
        IncomeCategory.objects.get_or_create(
            code=code,
            defaults={"name": name, "sort_order": sort_order, "is_active": True},
        )


def unseed_income_categories(apps, schema_editor):
    IncomeCategory = apps.get_model("licenses", "IncomeCategory")
    IncomeCategory.objects.filter(code__in=[item[0] for item in DEFAULT_CATEGORIES]).delete()


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("clubs", "0005_rederive_luxembourg_bank_names"),
        ("licenses", "0031_expense_ledger_and_year_opening"),
    ]

    operations = [
        migrations.CreateModel(
            name="IncomeCategory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=100, unique=True)),
                ("code", models.SlugField(max_length=50, unique=True)),
                ("sort_order", models.PositiveSmallIntegerField(default=100)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["sort_order", "name"]},
        ),
        migrations.CreateModel(
            name="Income",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("income_number", models.CharField(editable=False, max_length=20, unique=True)),
                ("description", models.CharField(max_length=255)),
                ("payer", models.CharField(blank=True, max_length=255)),
                (
                    "amount",
                    models.DecimalField(
                        decimal_places=2,
                        max_digits=10,
                        validators=[django.core.validators.MinValueValidator(Decimal("0.01"))],
                    ),
                ),
                ("currency", models.CharField(default="EUR", max_length=3)),
                ("income_date", models.DateField()),
                ("received_at", models.DateTimeField(blank=True, null=True)),
                (
                    "status",
                    models.CharField(
                        choices=[("received", "Received"), ("void", "Void")],
                        default="received",
                        max_length=20,
                    ),
                ),
                ("payment_method", models.CharField(blank=True, max_length=20)),
                ("reference", models.CharField(blank=True, max_length=255)),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "category",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="incomes",
                        to="licenses.incomecategory",
                    ),
                ),
                (
                    "club",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="incomes",
                        to="clubs.club",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="incomes_recorded",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-income_date", "-created_at"]},
        ),
        migrations.AddIndex(
            model_name="income",
            index=models.Index(fields=["status", "-income_date"], name="inc_status_date_idx"),
        ),
        migrations.AddIndex(
            model_name="income",
            index=models.Index(fields=["category", "-income_date"], name="inc_cat_date_idx"),
        ),
        migrations.AddIndex(
            model_name="income",
            index=models.Index(fields=["-income_date"], name="inc_date_idx"),
        ),
        migrations.RunPython(seed_income_categories, unseed_income_categories),
    ]
