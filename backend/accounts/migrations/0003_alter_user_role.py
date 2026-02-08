from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0002_normalize_nma_role"),
    ]

    operations = [
        migrations.AlterField(
            model_name="user",
            name="role",
            field=models.CharField(
                choices=[
                    ("ltf_admin", "LTF Admin"),
                    ("ltf_finance", "LTF Finance"),
                    ("club_admin", "Club Admin"),
                    ("coach", "Coach"),
                    ("member", "Member"),
                ],
                default="member",
                max_length=20,
            ),
        ),
    ]
