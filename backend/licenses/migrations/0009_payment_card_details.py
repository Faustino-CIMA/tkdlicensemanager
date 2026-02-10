from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0008_merge_0007_payment_0007_merge_0006_encrypt_stripe_ids_0006_license_price"),
    ]

    operations = [
        migrations.AddField(
            model_name="payment",
            name="card_brand",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name="payment",
            name="card_last4",
            field=models.CharField(blank=True, max_length=4),
        ),
        migrations.AddField(
            model_name="payment",
            name="card_exp_month",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="payment",
            name="card_exp_year",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
    ]
