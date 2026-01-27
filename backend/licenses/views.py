from rest_framework import permissions, viewsets

from .models import License
from .serializers import LicenseSerializer


class LicenseViewSet(viewsets.ModelViewSet):
    serializer_class = LicenseSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return License.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return License.objects.none()
        if user.role == "nma_admin":
            return License.objects.all()
        if user.role in ["club_admin", "coach"]:
            return License.objects.filter(club__admins=user)
        return License.objects.filter(member__user=user)
