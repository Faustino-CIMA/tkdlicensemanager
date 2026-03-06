from decimal import Decimal

from django.db import migrations


def apply_lp798_geometry_contract(apps, schema_editor):
    CardFormatPreset = apps.get_model("licenses", "CardFormatPreset")
    PaperProfile = apps.get_model("licenses", "PaperProfile")

    CardFormatPreset.objects.filter(code="3c").update(
        width_mm=Decimal("85.00"),
        height_mm=Decimal("55.00"),
    )
    PaperProfile.objects.filter(code="sigel-lp798").update(
        sheet_width_mm=Decimal("210.00"),
        sheet_height_mm=Decimal("297.00"),
        card_width_mm=Decimal("85.00"),
        card_height_mm=Decimal("55.00"),
        margin_top_mm=Decimal("10.00"),
        margin_bottom_mm=Decimal("12.00"),
        margin_left_mm=Decimal("15.00"),
        margin_right_mm=Decimal("15.00"),
        horizontal_gap_mm=Decimal("10.00"),
        vertical_gap_mm=Decimal("0.00"),
        columns=2,
        rows=5,
        slot_count=10,
    )


def reverse_lp798_geometry_contract(apps, schema_editor):
    CardFormatPreset = apps.get_model("licenses", "CardFormatPreset")
    PaperProfile = apps.get_model("licenses", "PaperProfile")

    CardFormatPreset.objects.filter(code="3c").update(
        width_mm=Decimal("85.60"),
        height_mm=Decimal("53.98"),
    )
    PaperProfile.objects.filter(code="sigel-lp798").update(
        sheet_width_mm=Decimal("210.00"),
        sheet_height_mm=Decimal("297.00"),
        card_width_mm=Decimal("85.60"),
        card_height_mm=Decimal("53.98"),
        margin_top_mm=Decimal("13.55"),
        margin_bottom_mm=Decimal("13.55"),
        margin_left_mm=Decimal("19.40"),
        margin_right_mm=Decimal("19.40"),
        horizontal_gap_mm=Decimal("0.00"),
        vertical_gap_mm=Decimal("0.00"),
        columns=2,
        rows=5,
        slot_count=10,
    )


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0026_printjob_side"),
    ]

    operations = [
        migrations.RunPython(
            apply_lp798_geometry_contract,
            reverse_lp798_geometry_contract,
        ),
    ]
