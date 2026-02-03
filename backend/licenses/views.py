from django.db.models.deletion import ProtectedError
from rest_framework import permissions, viewsets
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response
from rest_framework.status import HTTP_400_BAD_REQUEST

from accounts.permissions import IsNmaAdmin

from .models import License, LicenseType
from .serializers import LicenseSerializer, LicenseTypeSerializer


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


class LicenseTypeViewSet(viewsets.ModelViewSet):
    serializer_class = LicenseTypeSerializer
    queryset = LicenseType.objects.all().order_by("name")

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [permissions.IsAuthenticated()]
        return [IsNmaAdmin()]

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        try:
            self.perform_destroy(instance)
        except ProtectedError:
            return Response(
                {"detail": "This license type is in use and cannot be deleted."},
                status=HTTP_400_BAD_REQUEST,
            )
        return Response(status=204)
