from django.db import migrations


def remove_unused_default_paid_license_type(apps, schema_editor):
    LicenseType = apps.get_model("licenses", "LicenseType")
    License = apps.get_model("licenses", "License")
    LicensePrice = apps.get_model("licenses", "LicensePrice")

    paid_license_type = LicenseType.objects.filter(code="paid").first()
    if paid_license_type is None:
        return

    has_licenses = License.objects.filter(license_type_id=paid_license_type.id).exists()
    has_prices = LicensePrice.objects.filter(license_type_id=paid_license_type.id).exists()
    if not has_licenses and not has_prices:
        paid_license_type.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0014_remove_license_type_defaults"),
    ]

    operations = [
        migrations.RunPython(
            remove_unused_default_paid_license_type,
            migrations.RunPython.noop,
        )
    ]
