from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("clubs", "0008_federationprofile_club_tourist_transfer_threshold"),
    ]

    operations = [
        migrations.AddField(
            model_name="club",
            name="is_active",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="club",
            name="communication_language",
            field=models.CharField(default="en", max_length=10),
        ),
    ]
