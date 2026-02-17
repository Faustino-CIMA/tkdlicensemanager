"""
Django settings for LTF License Manager.
"""

import base64
import hashlib
import json
import re
from pathlib import Path

from decouple import config

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config("DJANGO_SECRET_KEY", default="change-me")
DEBUG = config("DJANGO_DEBUG", cast=bool, default=False)
FRONTEND_BASE_URL = config("FRONTEND_BASE_URL", default="http://localhost:3000")
FRONTEND_DEFAULT_LOCALE = config("FRONTEND_DEFAULT_LOCALE", default="en")
def split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def split_regex_list(value: str) -> list[str]:
    raw = (value or "").strip()
    if not raw:
        return []

    # Preferred format for complex regex values in env: JSON array.
    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(item).strip() for item in parsed if str(item).strip()]
        except json.JSONDecodeError:
            pass

    # Also support semicolon-delimited regex values.
    if ";" in raw:
        return [item.strip() for item in raw.split(";") if item.strip()]

    # Backward-compatible fallback for legacy comma-delimited values.
    # Split only when the next token looks like an origin regex.
    return [
        item.strip()
        for item in re.split(r",(?=\s*\^?https?://)", raw)
        if item.strip()
    ]


def derive_fernet_key(secret: str) -> str:
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).decode("utf-8")

ALLOWED_HOSTS = split_csv(config("DJANGO_ALLOWED_HOSTS", default="localhost,127.0.0.1,[::1]"))
if DEBUG and config("DJANGO_ALLOW_ALL_HOSTS_IN_DEBUG", cast=bool, default=True):
    # In local development, allow LAN/mobile access even when host IP changes.
    ALLOWED_HOSTS = ["*"]

# Security hardening toggles (set via environment for production).
SECURE_SSL_REDIRECT = config("DJANGO_SECURE_SSL_REDIRECT", cast=bool, default=not DEBUG)
SESSION_COOKIE_SECURE = config("DJANGO_SESSION_COOKIE_SECURE", cast=bool, default=not DEBUG)
CSRF_COOKIE_SECURE = config("DJANGO_CSRF_COOKIE_SECURE", cast=bool, default=not DEBUG)
SECURE_HSTS_SECONDS = config(
    "DJANGO_SECURE_HSTS_SECONDS",
    cast=int,
    default=0 if DEBUG else 31536000,
)
SECURE_HSTS_INCLUDE_SUBDOMAINS = config(
    "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS",
    cast=bool,
    default=not DEBUG,
)
SECURE_HSTS_PRELOAD = config(
    "DJANGO_SECURE_HSTS_PRELOAD",
    cast=bool,
    default=not DEBUG,
)
SECURE_CONTENT_TYPE_NOSNIFF = config(
    "DJANGO_SECURE_CONTENT_TYPE_NOSNIFF",
    cast=bool,
    default=True,
)
X_FRAME_OPTIONS = config("DJANGO_X_FRAME_OPTIONS", default="DENY")
if config("DJANGO_SECURE_USE_X_FORWARDED_PROTO", cast=bool, default=False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")


INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.sites",
    "simple_history",
    "rest_framework",
    "rest_framework.authtoken",
    "drf_spectacular",
    "corsheaders",
    "django_filters",
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "accounts.apps.AccountsConfig",
    "clubs",
    "members",
    "licenses",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "simple_history.middleware.HistoryRequestMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": config("POSTGRES_DB", default="ltf_license_manager"),
        "USER": config("POSTGRES_USER", default="ltf_user"),
        "PASSWORD": config("POSTGRES_PASSWORD", default="ltf_password"),
        "HOST": config("POSTGRES_HOST", default="db"),
        "PORT": config("POSTGRES_PORT", default=5432, cast=int),
    }
}


AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en"
LANGUAGES = [
    ("en", "English"),
    ("lb", "Luxembourgish"),
]
TIME_ZONE = "Europe/Luxembourg"
USE_I18N = True
USE_TZ = True
LOCALE_PATHS = [BASE_DIR / "locale"]

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]
MEDIA_URL = config("MEDIA_URL", default="/media/")
MEDIA_ROOT = Path(config("MEDIA_ROOT", default=str(BASE_DIR / "media")))
DATA_UPLOAD_MAX_MEMORY_SIZE = config(
    "DATA_UPLOAD_MAX_MEMORY_SIZE", cast=int, default=10 * 1024 * 1024
)
FILE_UPLOAD_MAX_MEMORY_SIZE = config(
    "FILE_UPLOAD_MAX_MEMORY_SIZE", cast=int, default=10 * 1024 * 1024
)
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    }
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "accounts.User"
SITE_ID = 1

AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]

ACCOUNT_LOGIN_METHODS = {"username", "email"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "username*", "password1*", "password2*"]
ACCOUNT_EMAIL_VERIFICATION = "mandatory"
ACCOUNT_UNIQUE_EMAIL = True
ACCOUNT_ADAPTER = "accounts.adapter.CustomAccountAdapter"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
        "rest_framework.authentication.TokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "100/hour",
        "user": "1000/hour",
    },
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}


SPECTACULAR_SETTINGS = {
    "TITLE": "LTF License Manager API",
    "DESCRIPTION": "API for managing LTF Taekwondo licenses",
    "VERSION": "0.1.0",
}

CORS_ALLOWED_ORIGINS = split_csv(
    config(
        "CORS_ALLOWED_ORIGINS",
        default="http://localhost:3000,http://127.0.0.1:3000",
    )
)
CORS_ALLOWED_ORIGIN_REGEXES = split_regex_list(
    config(
        "CORS_ALLOWED_ORIGIN_REGEXES",
        default=(
            r"^https?://192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$;"
            r"^https?://10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$;"
            r"^https?://172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}(:\d+)?$"
        ),
    )
)
CSRF_TRUSTED_ORIGINS = split_csv(
    config(
        "CSRF_TRUSTED_ORIGINS",
        default="http://localhost:3000,http://127.0.0.1:3000",
    )
)

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
RESEND_API_KEY = config("RESEND_API_KEY", default="")
RESEND_FROM_EMAIL = config("RESEND_FROM_EMAIL", default="no-reply@ltf-license-manager.local")

FERNET_KEYS = split_csv(
    config("FERNET_KEYS", default=derive_fernet_key(SECRET_KEY))
)

CELERY_BROKER_URL = config("CELERY_BROKER_URL", default="redis://redis:6379/0")
CELERY_RESULT_BACKEND = config("CELERY_RESULT_BACKEND", default="redis://redis:6379/1")
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE
CELERY_BEAT_SCHEDULE_FILENAME = config(
    "CELERY_BEAT_SCHEDULE_FILENAME",
    default=str(MEDIA_ROOT / "celerybeat-schedule"),
)
CELERY_BEAT_SCHEDULE = {
    "reconcile-expired-licenses-daily": {
        "task": "licenses.tasks.reconcile_expired_licenses",
        "schedule": 60 * 60 * 24,
    },
    "activate-eligible-paid-licenses-hourly": {
        "task": "licenses.tasks.activate_eligible_paid_licenses",
        "schedule": 60 * 60,
    },
    "reconcile-pending-stripe-orders-every-minute": {
        "task": "licenses.tasks.reconcile_pending_stripe_orders",
        "schedule": 60,
    },
}

STRIPE_SECRET_KEY = config("STRIPE_SECRET_KEY", default="")
STRIPE_WEBHOOK_SECRET = config("STRIPE_WEBHOOK_SECRET", default="")
STRIPE_API_VERSION = config("STRIPE_API_VERSION", default="2026-01-28.clover")
STRIPE_CHECKOUT_SUCCESS_URL = config(
    "STRIPE_CHECKOUT_SUCCESS_URL",
    default=f"{FRONTEND_BASE_URL}/checkout/success",
)
STRIPE_CHECKOUT_CANCEL_URL = config(
    "STRIPE_CHECKOUT_CANCEL_URL",
    default=f"{FRONTEND_BASE_URL}/checkout/cancel",
)

PAYCONIQ_MODE = config("PAYCONIQ_MODE", default="mock")
PAYCONIQ_API_KEY = config("PAYCONIQ_API_KEY", default="")
PAYCONIQ_MERCHANT_ID = config("PAYCONIQ_MERCHANT_ID", default="")
PAYCONIQ_BASE_URL = config("PAYCONIQ_BASE_URL", default="https://payconiq.mock")

INVOICE_SEPA_BENEFICIARY = config("INVOICE_SEPA_BENEFICIARY", default="LTF License Manager")
INVOICE_SEPA_IBAN = config("INVOICE_SEPA_IBAN", default="")
INVOICE_SEPA_BIC = config("INVOICE_SEPA_BIC", default="")
INVOICE_SEPA_REMITTANCE_PREFIX = config("INVOICE_SEPA_REMITTANCE_PREFIX", default="Invoice")