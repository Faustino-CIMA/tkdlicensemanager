from django.db import migrations


def backfill_missing_license_issued_at(apps, schema_editor):
    License = apps.get_model("licenses", "License")
    LicenseHistoryEvent = apps.get_model("licenses", "LicenseHistoryEvent")
    licenses = License.objects.filter(status="active", issued_at__isnull=True).iterator()
    for license_record in licenses:
        event = (
            LicenseHistoryEvent.objects.filter(
                license_id=license_record.id,
                status_after="active",
            )
            .order_by("event_at", "id")
            .first()
        )
        if event is None:
            event = (
                LicenseHistoryEvent.objects.filter(
                    license_id=license_record.id,
                    event_type="issued",
                )
                .order_by("event_at", "id")
                .first()
            )
        license_record.issued_at = event.event_at if event else license_record.created_at
        license_record.save(update_fields=["issued_at"])


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0032_income_ledger"),
    ]

    operations = [
        migrations.RunPython(backfill_missing_license_issued_at, migrations.RunPython.noop),
    ]
