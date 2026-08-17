from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("licenses", "0020_license_lic_member_year_idx_and_more"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="license",
            index=models.Index(
                fields=["club", "year", "status"],
                name="lic_club_year_st_idx",
            ),
        ),
    ]
