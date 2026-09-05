from __future__ import annotations

import csv
import io
import json

from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import permissions, response, status, views
from rest_framework.authtoken.models import Token
from rest_framework.pagination import PageNumberPagination

from accounts.email_utils import build_password_reset_url, send_password_reset_email
from accounts.models import User

from .health import collect_health
from .i18n import (
    SUPPORTED_LOCALES,
    bust_i18n_cache,
    export_nested,
    merged_nested,
    namespace_summaries,
    translation_rows,
)
from .jobs import collect_jobs, retry_print_job
from .models import AuthEvent, AuthTokenMeta, OpsAuditLog, SecurityAlert, TranslationOverride
from .permissions import IsSuperuser
from .queries import QueryError, catalog_public, run_query
from .request_utils import client_ip, write_ops_audit
from .serializers import (
    AuthEventSerializer,
    OpsAuditLogSerializer,
    OpsUserSerializer,
    SecurityAlertSerializer,
)


class OpsPageNumberPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


class PublicI18nView(views.APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request, locale: str):
        safe = locale if locale in SUPPORTED_LOCALES else "en"
        return response.Response(merged_nested(safe))


class OpsOverviewView(views.APIView):
    permission_classes = [IsSuperuser]

    def get(self, request):
        minutes = int(getattr(settings, "OPS_SESSION_ONLINE_MINUTES", 15))
        since = timezone.now() - timedelta_minutes(minutes)
        online = Token.objects.filter(ops_meta__last_used_at__gte=since).count()
        open_alerts = SecurityAlert.objects.filter(status=SecurityAlert.Status.OPEN).count()
        failures_24h = AuthEvent.objects.filter(
            event_type=AuthEvent.EventType.LOGIN_FAILURE,
            created_at__gte=timezone.now() - timedelta_hours(24),
        ).count()
        health = collect_health()
        return response.Response(
            {
                "generated_at": timezone.now().isoformat(),
                "online_sessions": online,
                "open_alerts": open_alerts,
                "failed_logins_24h": failures_24h,
                "user_count": User.objects.count(),
                "superuser_count": User.objects.filter(is_superuser=True).count(),
                "health": health,
            }
        )


def timedelta_minutes(minutes: int):
    from datetime import timedelta

    return timedelta(minutes=minutes)


def timedelta_hours(hours: int):
    from datetime import timedelta

    return timedelta(hours=hours)


class OpsHealthView(views.APIView):
    permission_classes = [IsSuperuser]

    def get(self, request):
        return response.Response(collect_health())


class OpsSessionListView(views.APIView):
    permission_classes = [IsSuperuser]

    def get(self, request):
        minutes = int(request.query_params.get("minutes") or getattr(settings, "OPS_SESSION_ONLINE_MINUTES", 15))
        since = timezone.now() - timedelta_minutes(minutes)
        tokens = (
            Token.objects.select_related("user", "ops_meta")
            .filter(ops_meta__last_used_at__gte=since)
            .order_by("-ops_meta__last_used_at")
        )
        payload = []
        for token in tokens:
            meta: AuthTokenMeta | None = getattr(token, "ops_meta", None)
            payload.append(
                {
                    "token_key_suffix": token.key[-6:],
                    "user_id": token.user_id,
                    "username": token.user.username,
                    "role": token.user.role,
                    "is_superuser": token.user.is_superuser,
                    "last_used_at": meta.last_used_at.isoformat() if meta and meta.last_used_at else None,
                    "last_ip": meta.last_ip if meta else None,
                    "user_agent": meta.user_agent if meta else "",
                    "created": token.created.isoformat() if token.created else None,
                }
            )
        return response.Response({"minutes": minutes, "results": payload})


class OpsSessionRevokeView(views.APIView):
    permission_classes = [IsSuperuser]

    def post(self, request, user_id: int):
        deleted, _ = Token.objects.filter(user_id=user_id).delete()
        write_ops_audit(
            request,
            action="session_revoke",
            target_type="user",
            target_id=user_id,
            message=f"Revoked {deleted} token(s).",
        )
        AuthEvent.objects.create(
            event_type=AuthEvent.EventType.TOKEN_REVOKED,
            username_attempted="",
            user_id=user_id,
            ip=client_ip(request),
            metadata={"deleted": deleted, "by": request.user.username},
        )
        return response.Response({"deleted": deleted})


class OpsAuthEventListView(views.APIView):
    permission_classes = [IsSuperuser]

    def get(self, request):
        qs = AuthEvent.objects.select_related("user").all()
        event_type = request.query_params.get("event_type")
        if event_type:
            qs = qs.filter(event_type=event_type)
        paginator = OpsPageNumberPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        serializer = AuthEventSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)


class OpsAlertListView(views.APIView):
    permission_classes = [IsSuperuser]

    def get(self, request):
        qs = SecurityAlert.objects.select_related("related_user").all()
        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        paginator = OpsPageNumberPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        serializer = SecurityAlertSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)


class OpsAlertUpdateView(views.APIView):
    permission_classes = [IsSuperuser]

    def post(self, request, alert_id: int):
        alert = SecurityAlert.objects.filter(pk=alert_id).first()
        if alert is None:
            return response.Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        next_status = str(request.data.get("status") or "").strip()
        if next_status not in {SecurityAlert.Status.ACK, SecurityAlert.Status.RESOLVED, SecurityAlert.Status.OPEN}:
            return response.Response({"detail": "Invalid status."}, status=status.HTTP_400_BAD_REQUEST)
        alert.status = next_status
        if next_status == SecurityAlert.Status.RESOLVED:
            alert.resolved_at = timezone.now()
            alert.resolved_by = request.user
        elif next_status == SecurityAlert.Status.OPEN:
            alert.resolved_at = None
            alert.resolved_by = None
        alert.save()
        write_ops_audit(
            request,
            action="alert_update",
            target_type="security_alert",
            target_id=alert.id,
            message=f"Set status to {next_status}.",
        )
        return response.Response(SecurityAlertSerializer(alert).data)


class OpsUserListView(views.APIView):
    permission_classes = [IsSuperuser]

    def get(self, request):
        qs = User.objects.all().order_by("username")
        search = (request.query_params.get("q") or "").strip()
        if search:
            qs = qs.filter(
                models_q_username_or_email(search)
            )
        role = request.query_params.get("role")
        if role:
            qs = qs.filter(role=role)
        if request.query_params.get("is_active") == "true":
            qs = qs.filter(is_active=True)
        elif request.query_params.get("is_active") == "false":
            qs = qs.filter(is_active=False)
        if request.query_params.get("is_superuser") == "true":
            qs = qs.filter(is_superuser=True)
        elif request.query_params.get("is_superuser") == "false":
            qs = qs.filter(is_superuser=False)
        if request.query_params.get("is_email_verified") == "true":
            qs = qs.filter(is_email_verified=True)
        elif request.query_params.get("is_email_verified") == "false":
            qs = qs.filter(is_email_verified=False)
        paginator = OpsPageNumberPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(OpsUserSerializer(page, many=True).data)


def models_q_username_or_email(search: str):
    from django.db.models import Q

    return Q(username__icontains=search) | Q(email__icontains=search) | Q(first_name__icontains=search) | Q(last_name__icontains=search)


class OpsUserActionView(views.APIView):
    permission_classes = [IsSuperuser]

    def post(self, request, user_id: int):
        user = User.objects.filter(pk=user_id).first()
        if user is None:
            return response.Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        action = str(request.data.get("action") or "").strip()
        if action == "disable":
            if user.is_superuser and User.objects.filter(is_superuser=True, is_active=True).count() <= 1:
                return response.Response(
                    {"detail": "Cannot disable the last superuser."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            user.is_active = False
            user.save(update_fields=["is_active"])
            Token.objects.filter(user=user).delete()
        elif action == "enable":
            user.is_active = True
            user.save(update_fields=["is_active"])
        elif action == "revoke_tokens":
            Token.objects.filter(user=user).delete()
        elif action == "grant_superuser":
            user.is_superuser = True
            user.is_staff = True
            user.save(update_fields=["is_superuser", "is_staff"])
        elif action == "revoke_superuser":
            if User.objects.filter(is_superuser=True, is_active=True).exclude(pk=user.pk).count() == 0:
                return response.Response(
                    {"detail": "Cannot revoke the last superuser."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            user.is_superuser = False
            user.save(update_fields=["is_superuser"])
        elif action == "send_password_reset":
            locale = str(request.data.get("locale") or getattr(settings, "FRONTEND_DEFAULT_LOCALE", "en"))
            reset_url = build_password_reset_url(user, locale)
            send_password_reset_email(user, reset_url)
            AuthEvent.objects.create(
                event_type=AuthEvent.EventType.PASSWORD_RESET,
                username_attempted=user.username,
                user=user,
                ip=client_ip(request),
                metadata={"by": request.user.username},
            )
        else:
            return response.Response({"detail": "Unknown action."}, status=status.HTTP_400_BAD_REQUEST)
        write_ops_audit(
            request,
            action=f"user_{action}",
            target_type="user",
            target_id=user.id,
            message=f"{action} on {user.username}",
        )
        return response.Response(OpsUserSerializer(user).data)


class OpsQueryCatalogView(views.APIView):
    permission_classes = [IsSuperuser]

    def get(self, request):
        return response.Response({"results": catalog_public()})


class OpsQueryRunView(views.APIView):
    permission_classes = [IsSuperuser]

    def post(self, request, query_id: str):
        params = request.data.get("params") or {}
        if not isinstance(params, dict):
            return response.Response({"detail": "params must be an object."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = run_query(query_id, params)
        except QueryError as exc:
            return response.Response({"detail": exc.message}, status=exc.status_code)
        write_ops_audit(
            request,
            action="query_run",
            target_type="query",
            target_id=query_id,
            message=f"Ran query {query_id} ({result['row_count']} rows).",
            metadata={"params": params},
        )
        return response.Response(result)


class OpsQueryCsvView(views.APIView):
    permission_classes = [IsSuperuser]

    def post(self, request, query_id: str):
        params = request.data.get("params") or {}
        if not isinstance(params, dict):
            return response.Response({"detail": "params must be an object."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = run_query(query_id, params)
        except QueryError as exc:
            return response.Response({"detail": exc.message}, status=exc.status_code)
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(result["columns"])
        for row in result["rows"]:
            writer.writerow([row.get(col, "") for col in result["columns"]])
        write_ops_audit(
            request,
            action="query_csv",
            target_type="query",
            target_id=query_id,
            message=f"Exported query {query_id}.",
        )
        payload = buffer.getvalue()
        resp = HttpResponse(payload, content_type="text/csv")
        resp["Content-Disposition"] = f'attachment; filename="{query_id}.csv"'
        return resp


def _save_translation_override(request, locale: str, key: str, value: str):
    override, _created = TranslationOverride.objects.update_or_create(
        locale=locale,
        key=key,
        defaults={"value": value, "updated_by": request.user},
    )
    bust_i18n_cache(locale)
    return override


class OpsTranslationListView(views.APIView):
    permission_classes = [IsSuperuser]

    def get(self, request):
        query = request.query_params.get("q") or ""
        namespace = request.query_params.get("namespace") or ""
        missing_only = request.query_params.get("missing") == "1"
        rows = translation_rows(query=query, namespace=namespace, missing_only=missing_only)
        if namespace:
            return response.Response(
                {
                    "count": len(rows),
                    "namespace": namespace,
                    "results": rows,
                }
            )
        paginator = OpsPageNumberPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        return paginator.get_paginated_response(page)

    def post(self, request):
        locale = str(request.data.get("locale") or "").strip()
        key = str(request.data.get("key") or "").strip()
        value = request.data.get("value")
        if locale not in SUPPORTED_LOCALES:
            return response.Response({"detail": "Unsupported locale."}, status=status.HTTP_400_BAD_REQUEST)
        if not key:
            return response.Response({"detail": "key is required."}, status=status.HTTP_400_BAD_REQUEST)
        if value is None:
            return response.Response({"detail": "value is required."}, status=status.HTTP_400_BAD_REQUEST)
        override = _save_translation_override(request, locale, key, str(value))
        write_ops_audit(
            request,
            action="translation_save",
            target_type="translation",
            target_id=f"{locale}:{key}",
            message=f"Updated {locale} {key}",
        )
        return response.Response(
            {
                "locale": override.locale,
                "key": override.key,
                "value": override.value,
                "updated_at": override.updated_at.isoformat(),
            }
        )


class OpsTranslationBatchView(views.APIView):
    permission_classes = [IsSuperuser]

    def post(self, request):
        changes = request.data.get("changes") or []
        if not isinstance(changes, list) or not changes:
            return response.Response({"detail": "changes must be a non-empty list."}, status=status.HTTP_400_BAD_REQUEST)
        if len(changes) > 500:
            return response.Response({"detail": "At most 500 changes per save."}, status=status.HTTP_400_BAD_REQUEST)
        saved = 0
        for item in changes:
            if not isinstance(item, dict):
                continue
            locale = str(item.get("locale") or "").strip()
            key = str(item.get("key") or "").strip()
            if locale not in SUPPORTED_LOCALES or not key or "value" not in item:
                continue
            _save_translation_override(request, locale, key, str(item.get("value") or ""))
            saved += 1
        write_ops_audit(
            request,
            action="translation_batch_save",
            target_type="translation",
            target_id=str(request.data.get("namespace") or ""),
            message=f"Saved {saved} translation string(s).",
            metadata={"saved": saved, "namespace": request.data.get("namespace")},
        )
        return response.Response({"saved": saved})


class OpsTranslationMetaView(views.APIView):
    permission_classes = [IsSuperuser]

    def get(self, request):
        return response.Response(
            {
                "locales": list(SUPPORTED_LOCALES),
                "pages": namespace_summaries(),
            }
        )


class OpsTranslationExportView(views.APIView):
    permission_classes = [IsSuperuser]

    def get(self, request, locale: str):
        if locale not in SUPPORTED_LOCALES:
            return response.Response({"detail": "Unsupported locale."}, status=status.HTTP_400_BAD_REQUEST)
        payload = json.dumps(export_nested(locale), ensure_ascii=False, indent=2) + "\n"
        write_ops_audit(
            request,
            action="translation_export",
            target_type="translation",
            target_id=locale,
            message=f"Exported {locale}.json",
        )
        resp = HttpResponse(payload, content_type="application/json")
        resp["Content-Disposition"] = f'attachment; filename="{locale}.json"'
        return resp


class OpsJobsView(views.APIView):
    permission_classes = [IsSuperuser]

    def get(self, request):
        return response.Response(collect_jobs())


class OpsPrintJobRetryView(views.APIView):
    permission_classes = [IsSuperuser]

    def post(self, request, print_job_id: int):
        try:
            result = retry_print_job(print_job_id, actor_id=request.user.id)
        except ValueError as exc:
            return response.Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        write_ops_audit(
            request,
            action="print_job_retry",
            target_type="print_job",
            target_id=print_job_id,
            message=f"Retried print job {result.get('job_number')}.",
        )
        return response.Response(result)


class OpsAuditListView(views.APIView):
    permission_classes = [IsSuperuser]

    def get(self, request):
        qs = OpsAuditLog.objects.select_related("actor").all()
        action = request.query_params.get("action")
        if action:
            qs = qs.filter(action=action)
        paginator = OpsPageNumberPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(OpsAuditLogSerializer(page, many=True).data)


class OpsAuditDetailView(views.APIView):
    permission_classes = [IsSuperuser]

    def get(self, request, log_id: int):
        item = OpsAuditLog.objects.select_related("actor").filter(pk=log_id).first()
        if item is None:
            return response.Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return response.Response(OpsAuditLogSerializer(item).data)
