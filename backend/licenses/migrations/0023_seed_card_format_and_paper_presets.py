from decimal import Decimal

from django.db import migrations


def seed_presets(apps, schema_editor):
    CardFormatPreset = apps.get_model("licenses", "CardFormatPreset")
    PaperProfile = apps.get_model("licenses", "PaperProfile")

    three_c, _ = CardFormatPreset.objects.update_or_create(
        code="3c",
        defaults={
            "name": "3C",
            "description": "Standard card format similar to ID-1 (credit-card size).",
            "width_mm": Decimal("85.60"),
            "height_mm": Decimal("53.98"),
            "is_custom": False,
            "is_active": True,
        },
    )
    CardFormatPreset.objects.update_or_create(
        code="din-a6",
        defaults={
            "name": "DIN A6",
            "description": "DIN A6 format card/certificate profile.",
            "width_mm": Decimal("148.00"),
            "height_mm": Decimal("105.00"),
            "is_custom": False,
            "is_active": True,
        },
    )
    CardFormatPreset.objects.update_or_create(
        code="custom",
        defaults={
            "name": "Custom",
            "description": "User-defined dimensions.",
            "width_mm": Decimal("85.60"),
            "height_mm": Decimal("53.98"),
            "is_custom": True,
            "is_active": True,
        },
    )

    PaperProfile.objects.update_or_create(
        code="sigel-lp798",
        defaults={
            "name": "Sigel LP798",
            "description": "A4 sheet with 10 card slots (2x5), card geometry in millimeters.",
            "card_format_id": three_c.id,
            "sheet_width_mm": Decimal("210.00"),
            "sheet_height_mm": Decimal("297.00"),
            "card_width_mm": Decimal("85.60"),
            "card_height_mm": Decimal("53.98"),
            "margin_top_mm": Decimal("13.55"),
            "margin_bottom_mm": Decimal("13.55"),
            "margin_left_mm": Decimal("19.40"),
            "margin_right_mm": Decimal("19.40"),
            "horizontal_gap_mm": Decimal("0.00"),
            "vertical_gap_mm": Decimal("0.00"),
            "columns": 2,
            "rows": 5,
            "slot_count": 10,
            "is_preset": True,
            "is_active": True,
        },
    )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0022_cardformatpreset_cardtemplate_paperprofile_and_more"),
    ]

    operations = [
        migrations.RunPython(seed_presets, noop_reverse),
    ]
