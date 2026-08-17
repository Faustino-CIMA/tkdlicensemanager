from django.db import migrations, models
import django.db.models.deletion

import licenses.models


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0003_license_type"),
    ]

    operations = [
        migrations.AlterField(
            model_name="license",
            name="license_type",
            field=models.ForeignKey(
                default=licenses.models.get_default_license_type,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="licenses",
                to="licenses.licensetype",
            ),
        ),
    ]
