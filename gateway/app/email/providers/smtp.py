"""Generic SMTP adapter. Wired in P1; not implemented yet."""

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
        self._from_name = from_name

    async def send(self, mail: OutgoingMail) -> SendResult:
        raise NotImplementedError(
            "SMTP adapter is stubbed; wire up aiosmtplib in P1."
        )
