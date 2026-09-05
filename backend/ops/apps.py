from django.apps import AppConfig


class OpsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "ops"
    verbose_name = "Ops console"

    def ready(self):
        from . import signals  # noqa: F401
