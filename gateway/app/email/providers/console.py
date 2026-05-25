"""Console email provider.

Used in local dev as a fallback when no platform provider is configured.
Logs the rendered email to stdout instead of sending it. Verification links
and invite links are visible in the gateway's logs, which is enough to test
end-to-end without touching Resend/SES/Postmark/SMTP.
"""

import structlog

from app.email.providers.base import MailProvider, OutgoingMail, SendResult

log = structlog.get_logger()


class ConsoleProvider(MailProvider):
    name = "console"

    def __init__(self, from_email: str = "noreply@local", from_name: str | None = None):
        self._from = f"{from_name} <{from_email}>" if from_name else from_email

    async def send(self, mail: OutgoingMail) -> SendResult:
        log.warning(
            "email.console.sent",
            sender=self._from,
            to=mail.to,
            subject=mail.subject,
            # Text body is more useful in logs than html.
            body=mail.text or mail.html,
        )
        return SendResult(provider=self.name, message_id=None, accepted=mail.to)
