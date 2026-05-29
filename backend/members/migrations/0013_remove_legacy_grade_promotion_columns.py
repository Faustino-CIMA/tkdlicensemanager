from django.db import migrations


class Migration(migrations.Migration):
    """Drop legacy columns left on dev DB from an abandoned branch schema."""

    dependencies = [
        ("members", "0012_gradepromotionhistory_created_by"),
    ]

    operations = [
        migrations.RunSQL(
            sql=[
                "ALTER TABLE members_gradepromotionhistory DROP CONSTRAINT IF EXISTS members_gradepromoti_created_by_id_5a53b0a5_fk_accounts_;",
                "ALTER TABLE members_gradepromotionhistory DROP COLUMN IF EXISTS created_by_id;",
                "ALTER TABLE members_gradepromotionhistory DROP COLUMN IF EXISTS promoting_organization;",
                "ALTER TABLE members_gradepromotionhistory DROP COLUMN IF EXISTS promoting_organization_other;",
            ],
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
