"""Generic SMTP adapter using aiosmtplib.

Supports STARTTLS (port 587) and implicit TLS (port 465). For plain port 25
set use_tls=False.
"""

from email.message import EmailMessage

import aiosmtplib

from app.email.providers.base import MailProvider, OutgoingMail, SendResult


class SMTPProvider(MailProvider):
    name = "smtp"

    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: str | None,
        password: str | None,
        use_tls: bool,
        from_email: str,
        from_name: str | None = None,
    ):
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._use_tls = use_tls
        self._from_email = from_email
        self._from = f"{from_name} <{from_email}>" if from_name else from_email

    async def send(self, mail: OutgoingMail) -> SendResult:
        msg = EmailMessage()
        msg["From"] = self._from
        msg["To"] = ", ".join(mail.to)
        msg["Subject"] = mail.subject
        if mail.reply_to:
            msg["Reply-To"] = mail.reply_to
        if mail.cc:
            msg["Cc"] = ", ".join(mail.cc)
        for k, v in (mail.headers or {}).items():
            msg[k] = v

        if mail.text:
            msg.set_content(mail.text)
            msg.add_alternative(mail.html, subtype="html")
        else:
            msg.set_content(mail.html, subtype="html")

        # Recipients includes Bcc but doesn't get exposed in headers.
        recipients = [*mail.to, *(mail.cc or []), *(mail.bcc or [])]

        # Port 465 = implicit TLS; port 587 = STARTTLS; everything else honors use_tls.
        use_implicit_tls = self._use_tls and self._port == 465
        use_starttls = self._use_tls and self._port != 465

        result = await aiosmtplib.send(
            msg,
            recipients=recipients,
            hostname=self._host,
            port=self._port,
            username=self._username,
            password=self._password,
            start_tls=use_starttls,
            use_tls=use_implicit_tls,
        )
        # aiosmtplib.send returns (response_dict, message) where the message
        # already has a Message-ID set; surface that for traceability.
        return SendResult(
            provider=self.name,
            message_id=msg.get("Message-ID"),
            accepted=mail.to,
        )
