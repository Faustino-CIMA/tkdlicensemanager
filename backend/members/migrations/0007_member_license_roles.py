from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("members", "0006_member_profile_picture_fields"),
    ]

    operations = [
        migrations.AddField(
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
                ],
                max_length=32,
            ),
        ),
        migrations.AddField(
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
                ],
                max_length=32,
            ),
        ),
        migrations.AddConstraint(
            model_name="member",
            constraint=models.CheckConstraint(
                check=models.Q(secondary_license_role="")
                | ~models.Q(primary_license_role=""),
                name="member_secondary_role_requires_primary",
            ),
        ),
        migrations.AddConstraint(
            model_name="member",
            constraint=models.CheckConstraint(
                check=~(
                    ~models.Q(primary_license_role="")
                    & models.Q(primary_license_role=models.F("secondary_license_role"))
                ),
                name="member_primary_secondary_role_must_differ",
            ),
        ),
    ]
