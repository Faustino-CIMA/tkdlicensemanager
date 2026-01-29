from rest_framework import permissions, status, viewsets
from rest_framework.response import Response

from .models import Club
from .serializers import ClubSerializer


class ClubViewSet(viewsets.ModelViewSet):
    serializer_class = ClubSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Club.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return Club.objects.none()
        if user.role == "nma_admin":
            return Club.objects.all()
        return (
            Club.objects.filter(admins=user)
            | Club.objects.filter(members__user=user)
        ).distinct()

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def destroy(self, request, *args, **kwargs):
        club = self.get_object()
        if club.members.exists():
            return Response(
                {"detail": "Club has members and cannot be deleted."},
                status=status.HTTP_409_CONFLICT,
            )
        if club.licenses.exists():
            return Response(
                {"detail": "Club has licenses and cannot be deleted."},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)
