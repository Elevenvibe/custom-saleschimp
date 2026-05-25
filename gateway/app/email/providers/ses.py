"""Amazon SES adapter using aioboto3.

Sends via the SES v2 API (`SendEmail`). Credentials are configured per-config
(scoped: platform default or per-tenant override), never via the EC2 instance
profile — that would silently use the platform's IAM role for tenant mail.
"""

from typing import Any

import aioboto3

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
        self._from = f"{from_name} <{from_email}>" if from_name else from_email
        self._session = aioboto3.Session(
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name=region,
        )

    async def send(self, mail: OutgoingMail) -> SendResult:
        body: dict[str, Any] = {"Html": {"Data": mail.html, "Charset": "UTF-8"}}
        if mail.text:
            body["Text"] = {"Data": mail.text, "Charset": "UTF-8"}

        destination = {"ToAddresses": mail.to}
        if mail.cc:
            destination["CcAddresses"] = mail.cc
        if mail.bcc:
            destination["BccAddresses"] = mail.bcc

        request: dict[str, Any] = {
            "FromEmailAddress": self._from,
            "Destination": destination,
            "Content": {
                "Simple": {
                    "Subject": {"Data": mail.subject, "Charset": "UTF-8"},
                    "Body": body,
                }
            },
        }
        if mail.reply_to:
            request["ReplyToAddresses"] = [mail.reply_to]
        if mail.tags:
            # SES requires Name+Value pairs; values must be ASCII and short.
            request["EmailTags"] = [{"Name": k, "Value": v} for k, v in mail.tags.items()]

        async with self._session.client("sesv2") as ses:
            r = await ses.send_email(**request)

        return SendResult(
            provider=self.name,
            message_id=r.get("MessageId"),
            accepted=mail.to,
        )
