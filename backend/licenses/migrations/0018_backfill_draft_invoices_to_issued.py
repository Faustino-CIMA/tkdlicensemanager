from django.db import migrations


def backfill_draft_invoices_to_issued(apps, schema_editor):
    Invoice = apps.get_model("licenses", "Invoice")
    queryset = Invoice.objects.filter(
        status="draft",
        order__status__in=["draft", "pending"],
    )
    for invoice in queryset.iterator(chunk_size=500):
        update_fields = ["status"]
        invoice.status = "issued"
        if invoice.issued_at is None:
            invoice.issued_at = invoice.created_at
            update_fields.append("issued_at")
        invoice.save(update_fields=update_fields)


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0017_backfill_paid_payment_status"),
    ]

    operations = [
        migrations.RunPython(
            backfill_draft_invoices_to_issued,
            migrations.RunPython.noop,
        )
    ]
