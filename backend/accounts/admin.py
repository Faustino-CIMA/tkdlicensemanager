from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (
        (
            "LTF",
            {
                "fields": (
                    "role",
                    "is_email_verified",
                    "consent_given",
                    "consent_given_at",
                )
            },
        ),
    )
    list_display = (
        "username",
        "email",
        "role",
        "is_email_verified",
        "consent_given",
        "is_staff",
    )
