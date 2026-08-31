from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("clubs", "0007_club_email"),
    ]

    operations = [
        migrations.AddField(
            model_name="federationprofile",
            name="club_tourist_transfer_threshold",
            field=models.PositiveIntegerField(
                default=3,
                help_text="Members with this many or more completed club changes are flagged as potential club tourists. No restrictions are applied.",
            ),
        ),
    ]
