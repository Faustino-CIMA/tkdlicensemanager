from django.conf import settings
from django.template.loader import render_to_string


def send_resend_email(to_email, subject, html, text, attachments=None):
    if not settings.RESEND_API_KEY:
        return False, "missing_resend_api_key"
    try:
        import resend
    except ModuleNotFoundError:
        return False, "missing_resend_package"
    resend.api_key = settings.RESEND_API_KEY
    payload = {
        "from": settings.RESEND_FROM_EMAIL,
        "to": [to_email],
        "subject": subject,
    }
    if attachments:
        payload["attachments"] = attachments
    try:
        resend.Emails.send(
            {
                **payload,
                "html": html,
                "text": text,
            }
        )
    except Exception as error:
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
