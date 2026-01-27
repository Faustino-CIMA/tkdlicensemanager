from rest_framework import permissions, viewsets

from .models import Member
from .serializers import MemberSerializer


class MemberViewSet(viewsets.ModelViewSet):
    serializer_class = MemberSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Member.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return Member.objects.none()
        if user.role == "nma_admin":
            return Member.objects.all()
        if user.role in ["club_admin", "coach"]:
            return Member.objects.filter(club__admins=user)
        return Member.objects.filter(user=user)
