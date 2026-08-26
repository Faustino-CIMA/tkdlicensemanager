from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("clubs", "0007_club_email"),
        ("members", "0013_remove_legacy_grade_promotion_columns"),
    ]

    operations = [
        migrations.CreateModel(
            name="MemberTransfer",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("status", models.CharField(choices=[("pending", "Pending"), ("completed", "Completed"), ("rejected", "Rejected"), ("cancelled", "Cancelled")], default="pending", max_length=20)),
                ("fee_amount", models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ("fee_currency", models.CharField(default="EUR", max_length=3)),
                ("note", models.TextField(blank=True)),
                ("ltf_notified", models.BooleanField(default=False)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "decided_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="decided_member_transfers",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "from_club",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="outgoing_member_transfers",
                        to="clubs.club",
                    ),
                ),
                (
                    "initiated_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="initiated_member_transfers",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "member",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="transfers",
                        to="members.member",
                    ),
                ),
                (
                    "to_club",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="incoming_member_transfers",
                        to="clubs.club",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="MemberTransferMessage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("body", models.TextField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "author",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="member_transfer_messages",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "transfer",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="messages",
                        to="members.membertransfer",
                    ),
                ),
            ],
            options={
                "ordering": ["created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="membertransfer",
            index=models.Index(fields=["status", "-created_at"], name="mtr_status_created_idx"),
        ),
        migrations.AddIndex(
            model_name="membertransfer",
            index=models.Index(fields=["from_club", "status"], name="mtr_from_status_idx"),
        ),
        migrations.AddIndex(
            model_name="membertransfer",
            index=models.Index(fields=["to_club", "status"], name="mtr_to_status_idx"),
        ),
        migrations.AddConstraint(
            model_name="membertransfer",
            constraint=models.UniqueConstraint(
                condition=models.Q(status="pending"),
                fields=("member",),
                name="unique_pending_member_transfer",
            ),
        ),
        migrations.AddConstraint(
            model_name="membertransfer",
            constraint=models.CheckConstraint(
                condition=~models.Q(from_club=models.F("to_club")),
                name="member_transfer_clubs_must_differ",
            ),
        ),
    ]
