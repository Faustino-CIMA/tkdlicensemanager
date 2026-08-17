import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("members", "0005_gradepromotionhistory"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="member",
            name="photo_consent_attested_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="member",
            name="photo_edit_metadata",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="member",
            name="profile_picture_original",
            field=models.ImageField(
                blank=True, null=True, upload_to="members/profile_pictures/original/"
            ),
        ),
        migrations.AddField(
            model_name="member",
            name="profile_picture_processed",
            field=models.ImageField(
                blank=True, null=True, upload_to="members/profile_pictures/processed/"
            ),
        ),
        migrations.AddField(
            model_name="member",
            name="profile_picture_thumbnail",
            field=models.ImageField(
                blank=True, null=True, upload_to="members/profile_pictures/thumbnails/"
            ),
        ),
        migrations.AddField(
            model_name="member",
            name="photo_consent_attested_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="photo_consent_attestations",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
