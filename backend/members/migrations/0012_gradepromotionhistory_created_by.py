from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("members", "0011_expand_member_license_roles"),
    ]

    operations = [
        migrations.AddField(
            model_name="gradepromotionhistory",
            name="created_by",
            field=models.CharField(blank=True, max_length=255),
        ),
    ]
