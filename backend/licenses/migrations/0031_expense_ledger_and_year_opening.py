from decimal import Decimal

from django.conf import settings
from django.db import migrations, models
import django.core.validators
import django.db.models.deletion


DEFAULT_CATEGORIES = [
    ("competitions", "Competitions & events", 10),
    ("travel", "Travel & accommodation", 20),
    ("equipment", "Equipment & uniforms", 30),
    ("insurance", "Insurance", 40),
    ("administration", "Administration & office", 50),
    ("it_software", "IT & software", 60),
    ("affiliations", "Memberships & affiliations", 70),
    ("education", "Training & education", 80),
    ("venues", "Venue rental", 90),
    ("bank_fees", "Bank charges", 100),
    ("other", "Other", 110),
]


def seed_expense_categories(apps, schema_editor):
    ExpenseCategory = apps.get_model("licenses", "ExpenseCategory")
    for code, name, sort_order in DEFAULT_CATEGORIES:
        ExpenseCategory.objects.get_or_create(
            code=code,
            defaults={"name": name, "sort_order": sort_order, "is_active": True},
        )


def unseed_expense_categories(apps, schema_editor):
    ExpenseCategory = apps.get_model("licenses", "ExpenseCategory")
    ExpenseCategory.objects.filter(code__in=[item[0] for item in DEFAULT_CATEGORIES]).delete()


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("clubs", "0005_rederive_luxembourg_bank_names"),
        ("licenses", "0030_backfill_missing_license_history"),
    ]

    operations = [
        migrations.CreateModel(
            name="ExpenseCategory",
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
            name="FinanceYearOpening",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("year", models.PositiveSmallIntegerField(unique=True)),
                (
                    "opening_cash",
                    models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12),
                ),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "updated_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="finance_year_openings_updated",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-year"]},
        ),
        migrations.CreateModel(
            name="Expense",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("expense_number", models.CharField(editable=False, max_length=20, unique=True)),
                ("description", models.CharField(max_length=255)),
                ("payee", models.CharField(blank=True, max_length=255)),
                (
                    "amount",
                    models.DecimalField(
                        decimal_places=2,
                        max_digits=10,
                        validators=[django.core.validators.MinValueValidator(Decimal("0.01"))],
                    ),
                ),
                ("currency", models.CharField(default="EUR", max_length=3)),
                ("expense_date", models.DateField()),
                ("due_date", models.DateField(blank=True, null=True)),
                ("paid_at", models.DateTimeField(blank=True, null=True)),
                (
                    "status",
                    models.CharField(
                        choices=[("recorded", "Recorded"), ("paid", "Paid"), ("void", "Void")],
                        default="recorded",
                        max_length=20,
                    ),
                ),
                (
                    "payment_method",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("card", "Card"),
                            ("bank_transfer", "Bank transfer"),
                            ("cash", "Cash"),
                            ("offline", "Offline"),
                            ("other", "Other"),
                        ],
                        max_length=20,
                    ),
                ),
                ("reference", models.CharField(blank=True, max_length=255)),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "category",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="expenses",
                        to="licenses.expensecategory",
                    ),
                ),
                (
                    "club",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="expenses",
                        to="clubs.club",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="expenses_recorded",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-expense_date", "-created_at"]},
        ),
        migrations.AddIndex(
            model_name="expense",
            index=models.Index(fields=["status", "-expense_date"], name="exp_status_date_idx"),
        ),
        migrations.AddIndex(
            model_name="expense",
            index=models.Index(fields=["category", "-expense_date"], name="exp_cat_date_idx"),
        ),
        migrations.AddIndex(
            model_name="expense",
            index=models.Index(fields=["-expense_date"], name="exp_date_idx"),
        ),
        migrations.RunPython(seed_expense_categories, unseed_expense_categories),
    ]
