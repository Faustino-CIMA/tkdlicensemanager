import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0015_cleanup_default_paid_license_type"),
    ]

    operations = [
        migrations.AlterField(
            model_name="historicallicense",
            name="license_type",
            field=models.ForeignKey(
                blank=True,
                db_constraint=False,
                null=True,
                on_delete=django.db.models.deletion.DO_NOTHING,
                related_name="+",
                to="licenses.licensetype",
            ),
        ),
    ]
