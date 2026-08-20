from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("clubs", "0005_rederive_luxembourg_bank_names"),
    ]

    operations = [
        migrations.AddField(
            model_name="federationprofile",
            name="rewrite_lux_prefix_on_member_import",
            field=models.BooleanField(default=False),
        ),
    ]
