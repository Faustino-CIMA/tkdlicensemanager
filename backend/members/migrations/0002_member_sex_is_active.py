from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("members", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="member",
            name="sex",
            field=models.CharField(choices=[("M", "Male"), ("F", "Female")], default="M", max_length=1),
        ),
        migrations.AddField(
            model_name="member",
            name="is_active",
            field=models.BooleanField(default=True),
        ),
    ]
