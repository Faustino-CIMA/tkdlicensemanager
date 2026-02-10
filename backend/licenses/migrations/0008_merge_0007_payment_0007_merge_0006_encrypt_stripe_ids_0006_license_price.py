from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0007_merge_0006_encrypt_stripe_ids_0006_license_price"),
        ("licenses", "0007_payment"),
    ]

    operations = []
