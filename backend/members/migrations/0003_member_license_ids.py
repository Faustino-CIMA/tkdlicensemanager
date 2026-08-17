from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("members", "0002_member_email"),
    ]

    operations = [
        migrations.AddField(
            model_name="member",
            name="wt_licenseid",
            field=models.CharField(blank=True, max_length=20),
        ),
        migrations.AddField(
            model_name="member",
            name="ltf_licenseid",
            field=models.CharField(blank=True, max_length=20),
        ),
    ]
