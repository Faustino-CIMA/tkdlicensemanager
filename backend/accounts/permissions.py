from rest_framework.permissions import BasePermission


class IsNmaAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == "nma_admin"


class IsClubAdminOrCoach(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role in ["club_admin", "coach"]


class IsClubAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == "club_admin"


class IsNmaAdminOrClubAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role in ["nma_admin", "club_admin"]
