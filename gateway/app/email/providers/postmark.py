"""Postmark adapter. Wired in P1; not implemented yet."""

from app.email.providers.base import MailProvider, OutgoingMail, SendResult


class PostmarkProvider(MailProvider):
    name = "postmark"

    def __init__(self, *, server_token: str, from_email: str, from_name: str | None = None):
        self._server_token = server_token
        self._from_email = from_email
        self._from_name = from_name

    async def send(self, mail: OutgoingMail) -> SendResult:
        raise NotImplementedError(
            "Postmark adapter is stubbed; wire up the REST API in P1."
        )
