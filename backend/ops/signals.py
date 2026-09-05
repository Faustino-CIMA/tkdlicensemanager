from django.contrib.auth.signals import user_logged_in
from django.dispatch import receiver


@receiver(user_logged_in)
def on_django_session_login(sender, request, user, **kwargs):
    path = ""
    if request is not None:
        path = getattr(request, "path", "") or ""
    if "/admin/" not in path:
        return
    from .detectors import record_django_admin_login

    record_django_admin_login(request, user)
