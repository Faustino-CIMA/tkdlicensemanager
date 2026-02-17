from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0013_licenseprice_license_type"),
    ]

    operations = [
        migrations.AlterField(
            model_name="license",
            name="license_type",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="licenses",
                to="licenses.licensetype",
            ),
        ),
        migrations.AlterField(
            model_name="licenseprice",
            name="license_type",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="prices",
                to="licenses.licensetype",
            ),
        ),
    ]
