from django.db import migrations
from licenses import fields


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0005_finance_models"),
    ]

    operations = [
        migrations.AlterField(
            model_name="order",
            name="stripe_payment_intent_id",
            field=fields.EncryptedCharField(blank=True, max_length=255),
        ),
        migrations.AlterField(
            model_name="order",
            name="stripe_checkout_session_id",
            field=fields.EncryptedCharField(blank=True, max_length=255),
        ),
        migrations.AlterField(
            model_name="invoice",
            name="stripe_invoice_id",
            field=fields.EncryptedCharField(blank=True, max_length=255),
        ),
        migrations.AlterField(
            model_name="invoice",
            name="stripe_customer_id",
            field=fields.EncryptedCharField(blank=True, max_length=255),
        ),
    ]
