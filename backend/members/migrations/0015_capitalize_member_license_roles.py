from django.db import migrations, models


ROLE_CAPITALIZATION_MAP = {
    "athlete": "Athlete",
    "Athlete": "Athlete",
    "coach": "Coach",
    "Coach": "Coach",
    "referee": "Referee",
    "Referee": "Referee",
    "official": "Official",
    "Official": "Official",
    "doctor": "Doctor",
    "Doctor": "Doctor",
    "physiotherapist": "Physiotherapist",
    "Physiotherapist": "Physiotherapist",
    "volunteer": "Volunteer",
    "Volunteer": "Volunteer",
    "staff": "Staff",
    "Staff": "Staff",
    "media": "Media",
    "Media": "Media",
    "fan": "Fan",
    "Fan": "Fan",
}

ROLE_LOWERCASE_MAP = {
    capitalized: lowercase
    for lowercase, capitalized in ROLE_CAPITALIZATION_MAP.items()
    if lowercase[:1].islower()
}

LICENSE_ROLE_CHOICES = [
    ("Athlete", "Athlete"),
    ("Coach", "Coach"),
    ("Referee", "Referee"),
    ("Official", "Official"),
    ("Doctor", "Doctor"),
    ("Physiotherapist", "Physiotherapist"),
    ("Volunteer", "Volunteer"),
    ("Staff", "Staff"),
    ("Media", "Media"),
    ("Fan", "Fan"),
]


def _normalize_roles(apps, mapping):
    Member = apps.get_model("members", "Member")
    for member in Member.objects.all().only("id", "primary_license_role", "secondary_license_role"):
        primary_value = str(getattr(member, "primary_license_role", "") or "")
        secondary_value = str(getattr(member, "secondary_license_role", "") or "")
        normalized_primary = mapping.get(primary_value, primary_value)
        if primary_value and normalized_primary == primary_value:
            normalized_primary = mapping.get(primary_value.lower(), primary_value)
        normalized_secondary = mapping.get(secondary_value, secondary_value)
        if secondary_value and normalized_secondary == secondary_value:
            normalized_secondary = mapping.get(secondary_value.lower(), secondary_value)
        if (
            normalized_primary != primary_value
            or normalized_secondary != secondary_value
        ):
            member.primary_license_role = normalized_primary
            member.secondary_license_role = normalized_secondary
            member.save(update_fields=["primary_license_role", "secondary_license_role"])


def capitalize_member_license_roles(apps, schema_editor):
    _normalize_roles(apps, ROLE_CAPITALIZATION_MAP)


def lowercase_member_license_roles(apps, schema_editor):
    _normalize_roles(apps, ROLE_LOWERCASE_MAP)


class Migration(migrations.Migration):
    dependencies = [
        ("members", "0014_membertransfer"),
    ]

    operations = [
        migrations.RunPython(
            capitalize_member_license_roles,
            lowercase_member_license_roles,
        ),
        migrations.AlterField(
            model_name="member",
            name="primary_license_role",
            field=models.CharField(
                blank=True,
                choices=LICENSE_ROLE_CHOICES,
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name="member",
            name="secondary_license_role",
            field=models.CharField(
                blank=True,
                choices=LICENSE_ROLE_CHOICES,
                max_length=32,
            ),
        ),
    ]
