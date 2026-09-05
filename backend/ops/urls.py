from django.urls import path

from . import views

urlpatterns = [
    path("overview/", views.OpsOverviewView.as_view(), name="ops-overview"),
    path("health/", views.OpsHealthView.as_view(), name="ops-health"),
    path("sessions/", views.OpsSessionListView.as_view(), name="ops-sessions"),
    path(
        "sessions/<int:user_id>/revoke/",
        views.OpsSessionRevokeView.as_view(),
        name="ops-session-revoke",
    ),
    path("auth-events/", views.OpsAuthEventListView.as_view(), name="ops-auth-events"),
    path("alerts/", views.OpsAlertListView.as_view(), name="ops-alerts"),
    path("alerts/<int:alert_id>/", views.OpsAlertUpdateView.as_view(), name="ops-alert-update"),
    path("users/", views.OpsUserListView.as_view(), name="ops-users"),
    path("users/<int:user_id>/", views.OpsUserActionView.as_view(), name="ops-user-action"),
    path("queries/", views.OpsQueryCatalogView.as_view(), name="ops-query-catalog"),
    path("queries/<str:query_id>/run/", views.OpsQueryRunView.as_view(), name="ops-query-run"),
    path("queries/<str:query_id>/csv/", views.OpsQueryCsvView.as_view(), name="ops-query-csv"),
    path("translations/", views.OpsTranslationListView.as_view(), name="ops-translations"),
    path("translations/batch/", views.OpsTranslationBatchView.as_view(), name="ops-translations-batch"),
    path("translations/meta/", views.OpsTranslationMetaView.as_view(), name="ops-translations-meta"),
    path(
        "translations/export/<str:locale>/",
        views.OpsTranslationExportView.as_view(),
        name="ops-translations-export",
    ),
    path("jobs/", views.OpsJobsView.as_view(), name="ops-jobs"),
    path(
        "jobs/print-jobs/<int:print_job_id>/retry/",
        views.OpsPrintJobRetryView.as_view(),
        name="ops-print-job-retry",
    ),
    path("audit/", views.OpsAuditListView.as_view(), name="ops-audit"),
    path("audit/<int:log_id>/", views.OpsAuditDetailView.as_view(), name="ops-audit-detail"),
]
