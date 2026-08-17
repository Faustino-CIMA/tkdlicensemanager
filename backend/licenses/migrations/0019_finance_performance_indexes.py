from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0018_backfill_draft_invoices_to_issued"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="order",
            index=models.Index(
                fields=["status", "-updated_at"],
                name="ord_status_upd_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="order",
            index=models.Index(
                fields=["club", "-created_at"],
                name="ord_club_created_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="order",
            index=models.Index(
                fields=["member", "-created_at"],
                name="ord_member_created_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="invoice",
            index=models.Index(
                fields=["status", "-issued_at"],
                name="inv_status_issued_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="invoice",
            index=models.Index(
                fields=["club", "status", "-issued_at"],
                name="inv_club_status_iss_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="invoice",
            index=models.Index(
                fields=["-paid_at"],
                name="inv_paid_at_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="payment",
            index=models.Index(
                fields=["status", "-created_at"],
                name="pay_status_created_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="payment",
            index=models.Index(
                fields=["invoice", "-created_at"],
                name="pay_invoice_created_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="payment",
            index=models.Index(
                fields=["order", "-created_at"],
                name="pay_order_created_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="payment",
            index=models.Index(
                fields=["provider", "status", "-created_at"],
                name="pay_provider_status_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="financeauditlog",
            index=models.Index(
                fields=["-created_at"],
                name="finlog_created_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="financeauditlog",
            index=models.Index(
                fields=["action", "-created_at"],
                name="finlog_action_created_idx",
            ),
        ),
    ]
