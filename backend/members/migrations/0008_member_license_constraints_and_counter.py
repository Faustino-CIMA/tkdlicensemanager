from django.db import migrations, models
from django.db.models import Count


def assert_unique_nonblank_member_license_ids(apps, schema_editor):
    Member = apps.get_model("members", "Member")

    duplicate_wt = list(
        Member.objects.exclude(wt_licenseid="")
        .values("wt_licenseid")
        .annotate(total=Count("id"))
        .filter(total__gt=1)
        .order_by("wt_licenseid")[:5]
    )
    duplicate_ltf = list(
        Member.objects.exclude(ltf_licenseid="")
        .values("ltf_licenseid")
        .annotate(total=Count("id"))
        .filter(total__gt=1)
        .order_by("ltf_licenseid")[:5]
    )

    if not duplicate_wt and not duplicate_ltf:
        return

    details = []
    if duplicate_wt:
        samples = ", ".join(
            f"{row['wt_licenseid']} ({row['total']})" for row in duplicate_wt
        )
        details.append(f"wt_licenseid duplicates: {samples}")
    if duplicate_ltf:
        samples = ", ".join(
            f"{row['ltf_licenseid']} ({row['total']})" for row in duplicate_ltf
        )
        details.append(f"ltf_licenseid duplicates: {samples}")

    raise RuntimeError(
        "Cannot apply members.0008 because duplicate non-empty member license IDs exist. "
        "Please clean duplicates manually, then re-run migrations. "
        + " | ".join(details)
    )


class Migration(migrations.Migration):
    dependencies = [
        ("members", "0007_member_license_roles"),
    ]

    operations = [
        migrations.RunPython(
            assert_unique_nonblank_member_license_ids,
            migrations.RunPython.noop,
        ),
        migrations.CreateModel(
            name="MemberLicenseIdCounter",
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
                (
                    "prefix",
                    models.CharField(
                        choices=[("LUX", "LUX"), ("LTF", "LTF")],
                        max_length=8,
                        unique=True,
                    ),
                ),
                ("next_value", models.PositiveBigIntegerField(default=1)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.AddConstraint(
            model_name="member",
            constraint=models.UniqueConstraint(
                fields=("wt_licenseid",),
                condition=~models.Q(wt_licenseid=""),
                name="member_unique_nonblank_wt_licenseid",
            ),
        ),
        migrations.AddConstraint(
            model_name="member",
            constraint=models.UniqueConstraint(
                fields=("ltf_licenseid",),
                condition=~models.Q(ltf_licenseid=""),
                name="member_unique_nonblank_ltf_licenseid",
            ),
        ),
    ]
