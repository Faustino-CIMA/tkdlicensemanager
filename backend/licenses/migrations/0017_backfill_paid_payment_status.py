from django.db import migrations


def backfill_paid_payment_status(apps, schema_editor):
    Payment = apps.get_model("licenses", "Payment")

    paid_invoices_qs = Payment.objects.filter(
        status="pending",
        invoice__status="paid",
    ).select_related("invoice")
    for payment in paid_invoices_qs.iterator(chunk_size=500):
        update_fields = ["status"]
        payment.status = "paid"
        if payment.paid_at is None and payment.invoice and payment.invoice.paid_at is not None:
            payment.paid_at = payment.invoice.paid_at
            update_fields.append("paid_at")
        payment.save(update_fields=update_fields)

    paid_orders_qs = Payment.objects.filter(
        status="pending",
        order__status="paid",
    ).select_related("invoice")
    for payment in paid_orders_qs.iterator(chunk_size=500):
        update_fields = ["status"]
        payment.status = "paid"
        if payment.paid_at is None and payment.invoice and payment.invoice.paid_at is not None:
            payment.paid_at = payment.invoice.paid_at
            update_fields.append("paid_at")
        payment.save(update_fields=update_fields)


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0016_alter_historicallicense_license_type"),
    ]

    operations = [
        migrations.RunPython(
            backfill_paid_payment_status,
            migrations.RunPython.noop,
        )
    ]
