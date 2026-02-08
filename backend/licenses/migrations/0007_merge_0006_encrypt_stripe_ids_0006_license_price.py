from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0006_encrypt_stripe_ids"),
        ("licenses", "0006_license_price"),
    ]

    operations = []
