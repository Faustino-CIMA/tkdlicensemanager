from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("clubs", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="club",
            name="max_admins",
            field=models.PositiveIntegerField(default=10),
        ),
    ]
