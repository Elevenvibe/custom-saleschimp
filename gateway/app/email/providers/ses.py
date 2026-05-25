"""Amazon SES adapter. Wired in P1; not implemented yet."""

from app.email.providers.base import MailProvider, OutgoingMail, SendResult


class SESProvider(MailProvider):
    name = "ses"

    def __init__(
        self,
        *,
        region: str,
        access_key_id: str,
        secret_access_key: str,
        from_email: str,
        from_name: str | None = None,
    ):
        self._region = region
        self._access_key_id = access_key_id
        self._secret_access_key = secret_access_key
        self._from_email = from_email
        self._from_name = from_name

    async def send(self, mail: OutgoingMail) -> SendResult:
        raise NotImplementedError(
            "SES adapter is stubbed; wire up boto3/aiobotocore in P1."
        )
