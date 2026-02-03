from django.db import migrations, models
import django.db.models.deletion

import licenses.models


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0002_alter_license_member_on_delete"),
    ]

    operations = [
        migrations.CreateModel(
            name="LicenseType",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=100, unique=True)),
                ("code", models.SlugField(max_length=50, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.AddField(
            model_name="license",
            name="license_type",
            field=models.ForeignKey(
                default=licenses.models.get_default_license_type,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="licenses",
                to="licenses.licensetype",
            ),
            preserve_default=False,
        ),
    ]
