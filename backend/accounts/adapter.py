from urllib.parse import urlencode, urlsplit, urlunsplit

from allauth.account.adapter import DefaultAccountAdapter
from django.conf import settings


class CustomAccountAdapter(DefaultAccountAdapter):
    def get_email_confirmation_url(self, request, emailconfirmation):
        locale = self._get_locale(request)
        base_url = settings.FRONTEND_BASE_URL.rstrip("/")
        key = emailconfirmation.key
        path = f"/{locale}/verify-email"
        query = urlencode({"key": key, "locale": locale})
        return f"{base_url}{path}?{query}"

    def _get_locale(self, request):
        if request is None:
            return settings.FRONTEND_DEFAULT_LOCALE

        locale = getattr(request, "confirmation_locale", None)
        if not locale:
            locale = request.GET.get("locale")
        if not locale:
            locale = getattr(request, "LANGUAGE_CODE", None)

        return locale or settings.FRONTEND_DEFAULT_LOCALE
