from django.contrib import admin

from .models import GradePromotionHistory, Member


@admin.register(Member)
class MemberAdmin(admin.ModelAdmin):
    list_display = (
        "first_name",
        "last_name",
        "sex",
        "is_active",
        "club",
        "has_profile_picture",
        "photo_consent_attested_at",
    )
    list_filter = ("sex", "is_active", "club")
    search_fields = ("first_name", "last_name")
    readonly_fields = ("photo_consent_attested_at", "photo_consent_attested_by")

    @admin.display(boolean=True, description="Photo")
    def has_profile_picture(self, obj: Member) -> bool:
        return bool(obj.profile_picture_processed or obj.profile_picture_original)


@admin.register(GradePromotionHistory)
class GradePromotionHistoryAdmin(admin.ModelAdmin):
    list_display = ("member", "from_grade", "to_grade", "promotion_date", "club")
    list_filter = ("promotion_date", "club")
    search_fields = ("member__first_name", "member__last_name", "from_grade", "to_grade")
    readonly_fields = (
        "member",
        "club",
        "examiner_user",
        "from_grade",
        "to_grade",
        "promotion_date",
        "exam_date",
        "proof_ref",
        "notes",
        "metadata",
        "created_at",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
