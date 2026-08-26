import base64
import logging
from email.utils import parseaddr
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

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


def build_password_reset_url(user, locale: str) -> str:
    token = PasswordResetTokenGenerator().make_token(user)
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    query = urlencode(
        {
            "uid": uid,
            "token": token,
            "username": user.username or "",
        }
    )
    return f"{settings.FRONTEND_BASE_URL}/{locale}/reset-password?{query}"


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


def _club_admin_emails(club) -> list[str]:
    emails = []
    seen = set()
    for email in club.admins.exclude(email="").values_list("email", flat=True):
        normalized = str(email or "").strip()
        key = normalized.lower()
        if normalized and key not in seen:
            seen.add(key)
            emails.append(normalized)
    return emails


def _ltf_admin_emails() -> list[str]:
    from accounts.models import User

    emails = []
    seen = set()
    for email in User.objects.filter(role=User.Roles.LTF_ADMIN).exclude(email="").values_list(
        "email", flat=True
    ):
        normalized = str(email or "").strip()
        key = normalized.lower()
        if normalized and key not in seen:
            seen.add(key)
            emails.append(normalized)
    return emails


def _member_display_name(member) -> str:
    return f"{member.first_name} {member.last_name}".strip() or f"Member #{member.id}"


def _transfer_club_url(locale: str) -> str:
    return f"{settings.FRONTEND_BASE_URL}/{locale}/dashboard/club/transfers#requests"


def _transfer_ltf_url(locale: str) -> str:
    return f"{settings.FRONTEND_BASE_URL}/{locale}/dashboard/ltf/member-transfers"


def send_member_transfer_request_email(transfer, locale: str | None = None):
    locale_code = locale or settings.FRONTEND_DEFAULT_LOCALE
    context = {
        "member_name": _member_display_name(transfer.member),
        "from_club": transfer.from_club.name,
        "to_club": transfer.to_club.name,
        "fee_amount": transfer.fee_amount,
        "fee_currency": transfer.fee_currency,
        "has_fee": transfer.fee_amount > 0,
        "note": transfer.note or "",
        "action_url": _transfer_club_url(locale_code),
    }
    subject = f"Member transfer request: {_member_display_name(transfer.member)}"
    html = render_to_string("account/email/member_transfer_request.html", context)
    text = render_to_string("account/email/member_transfer_request.txt", context)
    sent_any = False
    last_error = ""
    for email in _club_admin_emails(transfer.to_club):
        ok, error = send_resend_email(email, subject, html, text)
        sent_any = sent_any or ok
        if error:
            last_error = error
    return sent_any, last_error


def send_member_transfer_fee_notice(transfer, locale: str | None = None):
    locale_code = locale or settings.FRONTEND_DEFAULT_LOCALE
    context = {
        "member_name": _member_display_name(transfer.member),
        "from_club": transfer.from_club.name,
        "to_club": transfer.to_club.name,
        "fee_amount": transfer.fee_amount,
        "fee_currency": transfer.fee_currency,
        "action_url": _transfer_ltf_url(locale_code),
    }
    subject = (
        f"Transfer fee notice: {_member_display_name(transfer.member)} "
        f"({transfer.fee_amount} {transfer.fee_currency})"
    )
    html = render_to_string("account/email/member_transfer_fee_notice.html", context)
    text = render_to_string("account/email/member_transfer_fee_notice.txt", context)
    sent_any = False
    last_error = ""
    for email in _ltf_admin_emails():
        ok, error = send_resend_email(email, subject, html, text)
        sent_any = sent_any or ok
        if error:
            last_error = error
    return sent_any, last_error


def send_member_transfer_status_email(transfer, *, kind: str, locale: str | None = None):
    locale_code = locale or settings.FRONTEND_DEFAULT_LOCALE
    context = {
        "member_name": _member_display_name(transfer.member),
        "from_club": transfer.from_club.name,
        "to_club": transfer.to_club.name,
        "kind": kind,
        "action_url": _transfer_club_url(locale_code),
    }
    subject = f"Member transfer {kind}: {_member_display_name(transfer.member)}"
    html = render_to_string("account/email/member_transfer_status.html", context)
    text = render_to_string("account/email/member_transfer_status.txt", context)
    recipients = _club_admin_emails(transfer.from_club)
    if kind != "cancelled":
        for email in _club_admin_emails(transfer.to_club):
            if email not in recipients:
                recipients.append(email)
    sent_any = False
    last_error = ""
    for email in recipients:
        ok, error = send_resend_email(email, subject, html, text)
        sent_any = sent_any or ok
        if error:
            last_error = error
    return sent_any, last_error


def send_password_reset_email(user, reset_url):
    subject = "Reset your LTF License Manager password"
    context = {"user": user, "reset_url": reset_url}
    html = render_to_string("account/email/password_reset.html", context)
    text = render_to_string("account/email/password_reset.txt", context)
    return send_resend_email(user.email, subject, html, text)
