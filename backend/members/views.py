from django.db.models.deletion import ProtectedError
from rest_framework import permissions, status, viewsets
from rest_framework.response import Response

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
        if user.role == "ltf_admin":
            return Member.objects.all()
        if user.role in ["club_admin", "coach"]:
            return Member.objects.filter(club__admins=user)
        return Member.objects.filter(user=user)

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {"detail": "Member has related licenses and cannot be deleted."},
                status=status.HTTP_409_CONFLICT,
            )

