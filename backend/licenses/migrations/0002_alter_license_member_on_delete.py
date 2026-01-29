from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="license",
            name="member",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="licenses",
                to="members.member",
            ),
        ),
    ]
