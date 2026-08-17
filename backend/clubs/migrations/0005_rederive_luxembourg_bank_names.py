from django.db import migrations

from clubs.banking import derive_bank_name_from_iban, normalize_iban


def _rederive_bank_names(apps, schema_editor):
    Club = apps.get_model("clubs", "Club")
    FederationProfile = apps.get_model("clubs", "FederationProfile")

    for club in Club.objects.exclude(iban="").iterator():
        normalized = normalize_iban(getattr(club, "iban", ""))
        bank_name = derive_bank_name_from_iban(normalized)
        if club.iban != normalized or club.bank_name != bank_name:
            club.iban = normalized
            club.bank_name = bank_name
            club.save(update_fields=["iban", "bank_name"])

    for profile in FederationProfile.objects.exclude(iban="").iterator():
        normalized = normalize_iban(getattr(profile, "iban", ""))
        bank_name = derive_bank_name_from_iban(normalized)
        if profile.iban != normalized or profile.bank_name != bank_name:
            profile.iban = normalized
            profile.bank_name = bank_name
            profile.save(update_fields=["iban", "bank_name"])


def _noop(apps, schema_editor):
    return None


class Migration(migrations.Migration):
    dependencies = [
        ("clubs", "0004_club_banking_and_branding_assets"),
    ]

    operations = [
        migrations.RunPython(_rederive_bank_names, _noop),
    ]
