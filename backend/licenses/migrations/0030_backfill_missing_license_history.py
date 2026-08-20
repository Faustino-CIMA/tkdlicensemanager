from django.db import migrations


def backfill_missing_license_history(apps, schema_editor):
    License = apps.get_model("licenses", "License")
    LicenseHistoryEvent = apps.get_model("licenses", "LicenseHistoryEvent")
    licenses = (
        License.objects.filter(history_events__isnull=True)
        .select_related("member", "club")
        .iterator()
    )
    events = []
    for license_record in licenses:
        reason = (
            "License ordered (pending)."
            if license_record.status == "pending"
            else "License created."
        )
        events.append(
            LicenseHistoryEvent(
                member=license_record.member,
                license=license_record,
                club=license_record.club,
                event_type="issued",
                event_at=license_record.created_at,
                reason=reason,
                metadata={"source": "backfill_missing_license_history"},
                license_year=license_record.year,
                status_before="",
                status_after=license_record.status,
                club_name_snapshot=license_record.club.name,
            )
        )
        if len(events) >= 500:
            LicenseHistoryEvent.objects.bulk_create(events)
            events = []
    if events:
        LicenseHistoryEvent.objects.bulk_create(events)


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0029_printerprofile_created_by"),
    ]

    operations = [
        migrations.RunPython(backfill_missing_license_history, migrations.RunPython.noop),
    ]
