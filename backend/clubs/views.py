from rest_framework import permissions, viewsets

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
