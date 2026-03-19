from django.db import migrations, models


ROLE_NORMALIZATION_MAP = {
    "Athlete": "athlete",
    "Coach": "coach",
    "Referee": "referee",
    "Official": "official",
    "Doctor": "doctor",
    "Physiotherapist": "physiotherapist",
    "athlete": "athlete",
    "coach": "coach",
    "referee": "referee",
    "official": "official",
    "doctor": "doctor",
    "physiotherapist": "physiotherapist",
    "volunteer": "volunteer",
    "staff": "staff",
    "media": "media",
    "fan": "fan",
}


def normalize_member_license_roles(apps, schema_editor):
    Member = apps.get_model("members", "Member")
    for member in Member.objects.all().only("id", "primary_license_role", "secondary_license_role"):
        primary_value = str(getattr(member, "primary_license_role", "") or "")
        secondary_value = str(getattr(member, "secondary_license_role", "") or "")
        normalized_primary = ROLE_NORMALIZATION_MAP.get(primary_value, primary_value)
        normalized_secondary = ROLE_NORMALIZATION_MAP.get(secondary_value, secondary_value)
        if (
            normalized_primary != primary_value
            or normalized_secondary != secondary_value
        ):
            member.primary_license_role = normalized_primary
            member.secondary_license_role = normalized_secondary
            member.save(update_fields=["primary_license_role", "secondary_license_role"])


class Migration(migrations.Migration):
    dependencies = [
        ("members", "0010_member_member_club_active_idx_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="member",
            name="primary_license_role",
            field=models.CharField(
                blank=True,
                choices=[
                    ("athlete", "Athlete"),
                    ("coach", "Coach"),
                    ("referee", "Referee"),
                    ("official", "Official"),
                    ("doctor", "Doctor"),
                    ("physiotherapist", "Physiotherapist"),
                    ("volunteer", "Volunteer"),
                    ("staff", "Staff"),
                    ("media", "Media"),
                    ("fan", "Fan"),
                ],
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name="member",
            name="secondary_license_role",
            field=models.CharField(
                blank=True,
                choices=[
                    ("athlete", "Athlete"),
                    ("coach", "Coach"),
                    ("referee", "Referee"),
                    ("official", "Official"),
                    ("doctor", "Doctor"),
                    ("physiotherapist", "Physiotherapist"),
                    ("volunteer", "Volunteer"),
                    ("staff", "Staff"),
                    ("media", "Media"),
                    ("fan", "Fan"),
                ],
                max_length=32,
            ),
        ),
        migrations.RunPython(
            normalize_member_license_roles,
            migrations.RunPython.noop,
        ),
    ]
