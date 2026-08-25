import base64
import logging
from email.utils import parseaddr

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)

_PLACEHOLDER_KEYS = {"", "replace-me", "changeme", "change-me"}


def resend_is_configured() -> bool:
    return str(getattr(settings, "RESEND_API_KEY", "") or "").strip().lower() not in _PLACEHOLDER_KEYS


def _from_header() -> str:
    raw = str(getattr(settings, "RESEND_FROM_EMAIL", "") or "").strip()
    name, addr = parseaddr(raw)
    if addr:
        return f"{name} <{addr}>" if name else addr
    return raw or "no-reply@localhost"


def send_resend_email(to_email, subject, html, text, attachments=None):
    if not to_email:
        return False, "missing_recipient"
    if resend_is_configured():
        return _send_via_resend(to_email, subject, html, text, attachments)
    return _send_via_django(to_email, subject, html, text, attachments)


def _send_via_resend(to_email, subject, html, text, attachments=None):
    try:
        import resend
    except ModuleNotFoundError:
        return False, "missing_resend_package"
    resend.api_key = settings.RESEND_API_KEY
    payload = {
        "from": _from_header(),
        "to": [to_email],
        "subject": subject,
        "html": html,
        "text": text,
    }
    if attachments:
        payload["attachments"] = attachments
    try:
        resend.Emails.send(payload)
    except Exception as error:
        logger.warning("Resend email failed: %s", error)
        return False, str(error)
    return True, ""


def _send_via_django(to_email, subject, html, text, attachments=None):
    try:
        message = EmailMultiAlternatives(
            subject=subject,
            body=text or "",
            from_email=_from_header(),
            to=[to_email],
        )
        if html:
            message.attach_alternative(html, "text/html")
        for item in attachments or []:
            filename = item.get("filename") or "attachment"
            content = item.get("content") or b""
            if isinstance(content, str):
                content = base64.b64decode(content)
            mimetype = item.get("mimetype") or item.get("content_type") or "application/pdf"
            message.attach(filename, content, mimetype)
        message.send()
    except Exception as error:
        logger.warning("SMTP/console email failed: %s", error)
        return False, str(error)
    return True, ""


def send_club_admin_welcome_email(user, club, reset_url):
    subject = f"You are a Club Admin for {club.name}"
    context = {
        "user": user,
        "club": club,
        "reset_url": reset_url,
    }
    html = render_to_string("account/email/club_admin_welcome.html", context)
    text = render_to_string("account/email/club_admin_welcome.txt", context)
    return send_resend_email(user.email, subject, html, text)


def send_password_reset_email(user, reset_url):
    subject = "Reset your LTF License Manager password"
    context = {"user": user, "reset_url": reset_url}
    html = render_to_string("account/email/password_reset.html", context)
    text = render_to_string("account/email/password_reset.txt", context)
    return send_resend_email(user.email, subject, html, text)
