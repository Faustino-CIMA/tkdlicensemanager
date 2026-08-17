from __future__ import annotations

from pathlib import Path

from django.core.files import File
from django.core.management.base import BaseCommand
from django.db import transaction

from licenses.models import CardFontAsset

FONT_DIR = Path(__file__).resolve().parents[2] / "print_fonts"

PRINT_FONTS = (
    {
        "source_key": "source-sans-3-400",
        "name": "Source Sans 3 Regular",
        "family": "Source Sans 3",
        "weight": 400,
        "file": "SourceSans3-Regular.ttf",
    },
    {
        "source_key": "source-sans-3-700",
        "name": "Source Sans 3 Bold",
        "family": "Source Sans 3",
        "weight": 700,
        "file": "SourceSans3-Bold.ttf",
    },
    {
        "source_key": "source-serif-4-400",
        "name": "Source Serif 4 Regular",
        "family": "Source Serif 4",
        "weight": 400,
        "file": "SourceSerif4-Regular.ttf",
    },
    {
        "source_key": "source-serif-4-700",
        "name": "Source Serif 4 Bold",
        "family": "Source Serif 4",
        "weight": 700,
        "file": "SourceSerif4-Bold.ttf",
    },
    {
        "source_key": "ibm-plex-mono-400",
        "name": "IBM Plex Mono Regular",
        "family": "IBM Plex Mono",
        "weight": 400,
        "file": "IBMPlexMono-Regular.ttf",
    },
    {
        "source_key": "ibm-plex-mono-700",
        "name": "IBM Plex Mono Bold",
        "family": "IBM Plex Mono",
        "weight": 700,
        "file": "IBMPlexMono-Bold.ttf",
    },
    {
        "source_key": "barlow-condensed-400",
        "name": "Barlow Condensed Regular",
        "family": "Barlow Condensed",
        "weight": 400,
        "file": "BarlowCondensed-Regular.ttf",
    },
    {
        "source_key": "barlow-condensed-700",
        "name": "Barlow Condensed Bold",
        "family": "Barlow Condensed",
        "weight": 700,
        "file": "BarlowCondensed-Bold.ttf",
    },
    {
        "source_key": "inter-400",
        "name": "Inter Regular",
        "family": "Inter",
        "weight": 400,
        "file": "Inter-Regular.ttf",
    },
    {
        "source_key": "inter-700",
        "name": "Inter Bold",
        "family": "Inter",
        "weight": 700,
        "file": "Inter-Bold.ttf",
    },
    {
        "source_key": "noto-sans-400",
        "name": "Noto Sans Regular",
        "family": "Noto Sans",
        "weight": 400,
        "file": "NotoSans-Regular.ttf",
    },
    {
        "source_key": "noto-sans-700",
        "name": "Noto Sans Bold",
        "family": "Noto Sans",
        "weight": 700,
        "file": "NotoSans-Bold.ttf",
    },
)


def _is_static_ttf(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size < 10_000:
        return False
    header = path.read_bytes()[:4]
    return header == b"\x00\x01\x00\x00"


class Command(BaseCommand):
    help = "Seed built-in static TTF faces used by the license-card designer and print path."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Replace the file on an existing built-in font with the same source_key.",
        )

    def handle(self, *args, **options):
        force = bool(options["force"])
        created = 0
        updated = 0
        skipped = 0

        for spec in PRINT_FONTS:
            font_path = FONT_DIR / spec["file"]
            if not _is_static_ttf(font_path):
                self.stdout.write(self.style.WARNING(f"Skipping missing or non-static TTF: {font_path.name}"))
                skipped += 1
                continue

            metadata = {
                "builtin": True,
                "source_key": spec["source_key"],
                "family": spec["family"],
                "weight": spec["weight"],
                "style": "normal",
            }
            existing = CardFontAsset.objects.filter(metadata__source_key=spec["source_key"]).first()
            if existing and not force:
                skipped += 1
                continue

            with font_path.open("rb") as handle:
                django_file = File(handle, name=font_path.name)
                with transaction.atomic():
                    if existing:
                        existing.name = spec["name"]
                        existing.is_active = True
                        existing.metadata = metadata
                        existing.file.save(font_path.name, django_file, save=True)
                        updated += 1
                    else:
                        asset = CardFontAsset(
                            name=spec["name"],
                            is_active=True,
                            metadata=metadata,
                        )
                        asset.file.save(font_path.name, django_file, save=True)
                        created += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Print fonts seeded: created={created} updated={updated} skipped={skipped}"
            )
        )
