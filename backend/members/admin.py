from django.contrib import admin

from .models import Member


@admin.register(Member)
class MemberAdmin(admin.ModelAdmin):
    list_display = ("first_name", "last_name", "sex", "is_active", "club")
    list_filter = ("sex", "is_active", "club")
    search_fields = ("first_name", "last_name")
