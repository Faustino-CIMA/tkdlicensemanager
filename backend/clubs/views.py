from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import permissions, status, viewsets
from rest_framework.exceptions import ValidationError

import mimetypes
from pathlib import Path

from accounts.permissions import (
    IsLtfAdmin,
    IsLtfAdminOrClubAdmin,
    IsLtfFinanceOrLtfAdmin,
)
from config.pagination import OptionalPaginationListMixin
from django.db import transaction
from django.db.models import Count
from django.http import FileResponse

from members.models import Member

from .admin_assignment import (
    AdminAssignmentError,
    assign_club_admin,
    build_assignment_board,
    remove_club_admin,
    search_assignment_members,
)

from .models import BrandingAsset, Club, FederationProfile
from .serializers import (
    BrandingAssetCreateSerializer,
    BrandingAssetSerializer,
    BrandingAssetUpdateSerializer,
    ClubSerializer,
    FederationProfileSerializer,
)


def _stream_branding_asset_file(asset: BrandingAsset, *, missing_detail: str):
    if not asset.file:
        return Response({"detail": missing_detail}, status=status.HTTP_404_NOT_FOUND)
    try:
        asset.file.open("rb")
    except FileNotFoundError:
        return Response({"detail": missing_detail}, status=status.HTTP_404_NOT_FOUND)
    response_name = Path(str(asset.file.name or "")).name or f"asset-{asset.id}"
    content_type = mimetypes.guess_type(response_name)[0] or "application/octet-stream"
    return FileResponse(
        asset.file,
        as_attachment=False,
        filename=response_name,
        content_type=content_type,
    )


def _clear_other_selected_logos(selected_logo: BrandingAsset) -> None:
    filters = {
        "scope_type": selected_logo.scope_type,
        "asset_type": selected_logo.asset_type,
        "usage_type": selected_logo.usage_type,
        "is_selected": True,
    }
    if selected_logo.scope_type == BrandingAsset.ScopeType.CLUB:
        filters["club_id"] = selected_logo.club_id
    else:
        filters["federation_profile_id"] = selected_logo.federation_profile_id
    BrandingAsset.objects.filter(**filters).exclude(pk=selected_logo.pk).update(
        is_selected=False
    )


def _set_logo_selected(logo: BrandingAsset, *, selected: bool) -> None:
    if not selected:
        if logo.is_selected:
            logo.is_selected = False
            logo.save(update_fields=["is_selected", "updated_at"])
        return
    _clear_other_selected_logos(logo)
    if not logo.is_selected:
        logo.is_selected = True
        logo.save(update_fields=["is_selected", "updated_at"])


class ClubViewSet(OptionalPaginationListMixin, viewsets.ModelViewSet):
    serializer_class = ClubSerializer
    permission_classes = [permissions.IsAuthenticated]

    def _can_manage_club(self, user, club: Club) -> bool:
        if not user or not user.is_authenticated:
            return False
        if user.role == "ltf_admin":
            return True
        if user.role == "club_admin" and club.admins.filter(id=user.id).exists():
            return True
        return False

    def get_permissions(self):
        if self.action == "logo_content":
            return [permissions.AllowAny()]
        if self.action in ["create", "destroy"]:
            return [IsLtfAdmin()]
        if self.action in ["update", "partial_update"]:
            return [IsLtfAdminOrClubAdmin()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Club.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return Club.objects.none()
        # For mutations where object-level rules apply, fetch the club first
        # and authorize explicitly in the handler to return 403 (not 404).
        if self.action in ["update", "partial_update"]:
            return Club.objects.all()
        if self.action in ["logos", "logo_detail"] and self.request.method in [
            "POST",
            "PATCH",
            "DELETE",
        ]:
            return Club.objects.all()
        if user.role in ["ltf_admin", "ltf_finance"]:
            queryset = Club.objects.all()
        elif user.role == "club_admin":
            queryset = Club.objects.filter(admins=user).distinct()
        elif user.role == "coach":
            queryset = Club.objects.filter(members__user=user).distinct()
        else:
            queryset = (
                Club.objects.filter(admins=user)
                | Club.objects.filter(members__user=user)
            ).distinct()

        if self.action == "list":
            issue = (self.request.query_params.get("issue") or "").strip()
            if issue == "no_admin":
                queryset = queryset.annotate(admin_count=Count("admins")).filter(admin_count=0)
        return queryset

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

    def update(self, request, *args, **kwargs):
        club = self.get_object()
        if not self._can_manage_club(request.user, club):
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        club = self.get_object()
        if not self._can_manage_club(request.user, club):
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)

    @action(detail=False, methods=["get"], permission_classes=[permissions.IsAuthenticated])
    def admin_assignment(self, request):
        if request.user.role != "ltf_admin":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        return Response(build_assignment_board())

    @action(
        detail=False,
        methods=["get"],
        url_path="admin_assignment_members",
        permission_classes=[permissions.IsAuthenticated],
    )
    def admin_assignment_members(self, request):
        if request.user.role != "ltf_admin":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        licensed_raw = str(request.query_params.get("licensed_only", "true")).strip().lower()
        licensed_only = licensed_raw not in {"0", "false", "no"}
        return Response(
            search_assignment_members(
                query=request.query_params.get("q", ""),
                club_id=request.query_params.get("club_id"),
                licensed_only=licensed_only,
                limit=request.query_params.get("limit", 25),
            )
        )

    @action(detail=True, methods=["get"], permission_classes=[permissions.IsAuthenticated])
    def admins(self, request, pk=None):
        club = self.get_object()
        if request.user.role != "ltf_admin":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        admins = club.admins.all().values("id", "username", "email")
        return Response(
            {
                "admins": list(admins),
                "max_admins": club.max_admins,
                "current_admins": club.admins.count(),
            }
        )

    @action(detail=True, methods=["get"], permission_classes=[permissions.IsAuthenticated])
    def eligible_members(self, request, pk=None):
        club = self.get_object()
        if request.user.role != "ltf_admin":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        queryset = (
            Member.objects.filter(user__isnull=True)
            | Member.objects.filter(user__isnull=False).exclude(user__in=club.admins.all())
        )
        queryset = queryset.select_related("user", "club").order_by("last_name", "first_name")
        data = [
            {
                "id": member.id,
                "label": f"{member.first_name} {member.last_name} · {member.club.name}",
                "first_name": member.first_name,
                "last_name": member.last_name,
                "email": member.email or "",
                "club_name": member.club.name,
            }
            for member in queryset
        ]
        return Response({"eligible": data})

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def add_admin(self, request, pk=None):
        club = self.get_object()
        if request.user.role != "ltf_admin":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        try:
            payload = assign_club_admin(
                club,
                member_id=request.data.get("member_id"),
                user_id=request.data.get("user_id"),
                email=request.data.get("email"),
                locale=request.data.get("locale"),
            )
        except AdminAssignmentError as error:
            return Response(error.payload, status=error.status_code)
        return Response(payload)

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def remove_admin(self, request, pk=None):
        club = self.get_object()
        if request.user.role != "ltf_admin":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        try:
            payload = remove_club_admin(club, request.data.get("user_id"))
        except AdminAssignmentError as error:
            return Response(error.payload, status=error.status_code)
        return Response(payload)

    @action(detail=True, methods=["patch"], permission_classes=[permissions.IsAuthenticated])
    def set_max_admins(self, request, pk=None):
        club = self.get_object()
        if request.user.role != "ltf_admin":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        try:
            max_admins = int(request.data.get("max_admins"))
        except (TypeError, ValueError):
            return Response({"detail": "max_admins must be an integer."}, status=status.HTTP_400_BAD_REQUEST)
        if max_admins < 1:
            return Response({"detail": "max_admins must be at least 1."}, status=status.HTTP_400_BAD_REQUEST)
        if max_admins < club.admins.count():
            return Response(
                {"detail": "max_admins cannot be lower than current admin count."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        club.max_admins = max_admins
        club.save(update_fields=["max_admins"])
        return Response({"detail": "Max admins updated.", "max_admins": club.max_admins})

    @action(
        detail=True,
        methods=["get", "post"],
        permission_classes=[permissions.IsAuthenticated],
        parser_classes=[MultiPartParser, FormParser],
    )
    def logos(self, request, pk=None):
        club = self.get_object()
        queryset = BrandingAsset.objects.filter(
            scope_type=BrandingAsset.ScopeType.CLUB,
            club=club,
            asset_type=BrandingAsset.AssetType.LOGO,
        ).order_by("usage_type", "-is_selected", "-created_at")
        if request.method == "GET":
            serializer = BrandingAssetSerializer(
                queryset,
                many=True,
                context={"request": request},
            )
            return Response({"logos": serializer.data}, status=status.HTTP_200_OK)

        if not self._can_manage_club(request.user, club):
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)

        create_serializer = BrandingAssetCreateSerializer(data=request.data)
        create_serializer.is_valid(raise_exception=True)
        requested_selected = bool(create_serializer.validated_data.get("is_selected", False))
        try:
            with transaction.atomic():
                logo = BrandingAsset.objects.create(
                    scope_type=BrandingAsset.ScopeType.CLUB,
                    club=club,
                    asset_type=BrandingAsset.AssetType.LOGO,
                    usage_type=create_serializer.validated_data["usage_type"],
                    label=create_serializer.validated_data.get("label", ""),
                    file=create_serializer.validated_data["file"],
                    uploaded_by=request.user,
                    is_selected=False,
                )
                already_selected = queryset.filter(
                    usage_type=logo.usage_type,
                    is_selected=True,
                ).exists()
                if requested_selected or not already_selected:
                    _set_logo_selected(logo, selected=True)
        except OSError as exc:
            raise ValidationError(
                {"detail": "Unable to store logo file in server media storage."}
            ) from exc

        response_serializer = BrandingAssetSerializer(
            logo,
            context={"request": request},
        )
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=["patch", "delete"],
        permission_classes=[permissions.IsAuthenticated],
        url_path=r"logos/(?P<logo_id>\d+)",
    )
    def logo_detail(self, request, pk=None, logo_id=None):
        club = self.get_object()
        logo = BrandingAsset.objects.filter(
            pk=logo_id,
            scope_type=BrandingAsset.ScopeType.CLUB,
            club=club,
            asset_type=BrandingAsset.AssetType.LOGO,
        ).first()
        if not logo:
            return Response({"detail": "Logo not found."}, status=status.HTTP_404_NOT_FOUND)

        if not self._can_manage_club(request.user, club):
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)

        if request.method == "DELETE":
            try:
                logo.file.delete(save=False)
            except Exception:
                pass
            logo.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        update_serializer = BrandingAssetUpdateSerializer(data=request.data, partial=True)
        update_serializer.is_valid(raise_exception=True)
        validated = dict(update_serializer.validated_data)
        requested_selected = validated.pop("is_selected", None)
        with transaction.atomic():
            if "usage_type" in validated and logo.is_selected:
                logo.is_selected = False
            for field, value in validated.items():
                setattr(logo, field, value)
            logo.save()
            if requested_selected is True:
                _set_logo_selected(logo, selected=True)
            elif requested_selected is False:
                _set_logo_selected(logo, selected=False)
            else:
                has_other_selected = BrandingAsset.objects.filter(
                    scope_type=BrandingAsset.ScopeType.CLUB,
                    club=club,
                    asset_type=BrandingAsset.AssetType.LOGO,
                    usage_type=logo.usage_type,
                    is_selected=True,
                ).exclude(pk=logo.pk).exists()
                if logo.is_selected:
                    _set_logo_selected(logo, selected=True)
                elif not has_other_selected:
                    _set_logo_selected(logo, selected=True)
        response_serializer = BrandingAssetSerializer(
            logo,
            context={"request": request},
        )
        return Response(response_serializer.data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=["get"],
        permission_classes=[permissions.AllowAny],
        url_path=r"logos/(?P<logo_id>\d+)/content",
    )
    def logo_content(self, request, pk=None, logo_id=None):
        logo = BrandingAsset.objects.filter(
            pk=logo_id,
            scope_type=BrandingAsset.ScopeType.CLUB,
            club_id=pk,
            asset_type=BrandingAsset.AssetType.LOGO,
        ).first()
        if not logo:
            return Response({"detail": "Logo not found."}, status=status.HTTP_404_NOT_FOUND)
        return _stream_branding_asset_file(logo, missing_detail="Logo file is missing.")


class FederationProfileView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsLtfFinanceOrLtfAdmin]

    def _get_profile(self) -> FederationProfile:
        profile, _ = FederationProfile.objects.get_or_create(
            pk=1,
            defaults={
                "name": "Luxembourg Taekwondo Federation",
            },
        )
        return profile

    def get(self, request):
        serializer = FederationProfileSerializer(self._get_profile())
        return Response(serializer.data, status=status.HTTP_200_OK)

    def patch(self, request):
        if request.user.role != "ltf_admin":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        profile = self._get_profile()
        serializer = FederationProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)


class FederationProfileLogoListView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsLtfFinanceOrLtfAdmin]
    parser_classes = [MultiPartParser, FormParser]

    def _get_profile(self) -> FederationProfile:
        profile, _ = FederationProfile.objects.get_or_create(
            pk=1,
            defaults={"name": "Luxembourg Taekwondo Federation"},
        )
        return profile

    def get(self, request):
        profile = self._get_profile()
        queryset = BrandingAsset.objects.filter(
            scope_type=BrandingAsset.ScopeType.FEDERATION,
            federation_profile=profile,
            asset_type=BrandingAsset.AssetType.LOGO,
        ).order_by("usage_type", "-is_selected", "-created_at")
        serializer = BrandingAssetSerializer(
            queryset,
            many=True,
            context={"request": request},
        )
        return Response({"logos": serializer.data}, status=status.HTTP_200_OK)

    def post(self, request):
        if request.user.role != "ltf_admin":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        profile = self._get_profile()
        create_serializer = BrandingAssetCreateSerializer(data=request.data)
        create_serializer.is_valid(raise_exception=True)

        queryset = BrandingAsset.objects.filter(
            scope_type=BrandingAsset.ScopeType.FEDERATION,
            federation_profile=profile,
            asset_type=BrandingAsset.AssetType.LOGO,
        )
        requested_selected = bool(create_serializer.validated_data.get("is_selected", False))
        try:
            with transaction.atomic():
                logo = BrandingAsset.objects.create(
                    scope_type=BrandingAsset.ScopeType.FEDERATION,
                    federation_profile=profile,
                    asset_type=BrandingAsset.AssetType.LOGO,
                    usage_type=create_serializer.validated_data["usage_type"],
                    label=create_serializer.validated_data.get("label", ""),
                    file=create_serializer.validated_data["file"],
                    uploaded_by=request.user,
                    is_selected=False,
                )
                already_selected = queryset.filter(
                    usage_type=logo.usage_type,
                    is_selected=True,
                ).exists()
                if requested_selected or not already_selected:
                    _set_logo_selected(logo, selected=True)
        except OSError as exc:
            raise ValidationError(
                {"detail": "Unable to store logo file in server media storage."}
            ) from exc

        serializer = BrandingAssetSerializer(
            logo,
            context={"request": request},
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class FederationProfileLogoDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsLtfFinanceOrLtfAdmin]

    def _get_logo(self, logo_id: int | str) -> BrandingAsset | None:
        return BrandingAsset.objects.filter(
            pk=logo_id,
            scope_type=BrandingAsset.ScopeType.FEDERATION,
            asset_type=BrandingAsset.AssetType.LOGO,
        ).first()

    def patch(self, request, logo_id: int):
        logo = self._get_logo(logo_id)
        if not logo:
            return Response({"detail": "Logo not found."}, status=status.HTTP_404_NOT_FOUND)
        if request.user.role != "ltf_admin":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        update_serializer = BrandingAssetUpdateSerializer(data=request.data, partial=True)
        update_serializer.is_valid(raise_exception=True)
        validated = dict(update_serializer.validated_data)
        requested_selected = validated.pop("is_selected", None)
        with transaction.atomic():
            if "usage_type" in validated and logo.is_selected:
                logo.is_selected = False
            for field, value in validated.items():
                setattr(logo, field, value)
            logo.save()
            if requested_selected is True:
                _set_logo_selected(logo, selected=True)
            elif requested_selected is False:
                _set_logo_selected(logo, selected=False)
            else:
                has_other_selected = BrandingAsset.objects.filter(
                    scope_type=BrandingAsset.ScopeType.FEDERATION,
                    federation_profile_id=logo.federation_profile_id,
                    asset_type=BrandingAsset.AssetType.LOGO,
                    usage_type=logo.usage_type,
                    is_selected=True,
                ).exclude(pk=logo.pk).exists()
                if logo.is_selected:
                    _set_logo_selected(logo, selected=True)
                elif not has_other_selected:
                    _set_logo_selected(logo, selected=True)
        serializer = BrandingAssetSerializer(
            logo,
            context={"request": request},
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request, logo_id: int):
        logo = self._get_logo(logo_id)
        if not logo:
            return Response({"detail": "Logo not found."}, status=status.HTTP_404_NOT_FOUND)
        if request.user.role != "ltf_admin":
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)
        try:
            logo.file.delete(save=False)
        except Exception:
            pass
        logo.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class FederationProfileLogoContentView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, logo_id: int):
        logo = BrandingAsset.objects.filter(
            pk=logo_id,
            scope_type=BrandingAsset.ScopeType.FEDERATION,
            asset_type=BrandingAsset.AssetType.LOGO,
        ).first()
        if not logo:
            return Response({"detail": "Logo not found."}, status=status.HTTP_404_NOT_FOUND)
        return _stream_branding_asset_file(logo, missing_detail="Logo file is missing.")
