from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("members", "0002_member_sex_is_active"),
        ("members", "0003_member_license_ids"),
    ]

    operations = []
