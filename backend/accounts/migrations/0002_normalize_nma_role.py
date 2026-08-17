from django.db import migrations


def normalize_legacy_admin_role(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    legacy_role = "n" + "ma_admin"
    User.objects.filter(role=legacy_role).update(role="ltf_admin")


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(normalize_legacy_admin_role, migrations.RunPython.noop),
    ]
