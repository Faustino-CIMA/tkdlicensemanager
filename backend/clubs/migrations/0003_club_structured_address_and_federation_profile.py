from django.db import migrations, models


def backfill_structured_club_addresses(apps, schema_editor):
    Club = apps.get_model("clubs", "Club")
    for club in Club.objects.all().iterator():
        updates = {}
        if not club.address_line1 and club.address:
            updates["address_line1"] = club.address
        if not club.locality and club.city:
            updates["locality"] = club.city
        if updates:
            Club.objects.filter(id=club.id).update(**updates)


def noop_reverse(apps, schema_editor):
    return


class Migration(migrations.Migration):
    dependencies = [
        ("clubs", "0002_club_max_admins"),
    ]

    operations = [
        migrations.AddField(
            model_name="club",
            name="address_line1",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="club",
            name="address_line2",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="club",
            name="locality",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="club",
            name="postal_code",
            field=models.CharField(blank=True, max_length=10),
        ),
        migrations.CreateModel(
            name="FederationProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(default="Luxembourg Taekwondo Federation", max_length=255)),
                ("address_line1", models.CharField(blank=True, max_length=255)),
                ("address_line2", models.CharField(blank=True, max_length=255)),
                ("postal_code", models.CharField(blank=True, max_length=10)),
                ("locality", models.CharField(blank=True, max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Federation profile",
                "verbose_name_plural": "Federation profile",
            },
        ),
        migrations.RunPython(backfill_structured_club_addresses, noop_reverse),
    ]
