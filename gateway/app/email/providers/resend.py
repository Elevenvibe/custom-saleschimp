from typing import Any

import httpx

from app.email.providers.base import MailProvider, OutgoingMail, SendResult


class ResendProvider(MailProvider):
    name = "resend"

    def __init__(self, *, api_key: str, from_email: str, from_name: str | None = None):
        self._api_key = api_key
        self._from = f"{from_name} <{from_email}>" if from_name else from_email

    async def send(self, mail: OutgoingMail) -> SendResult:
        body: dict[str, Any] = {
            "from": self._from,
            "to": mail.to,
            "subject": mail.subject,
            "html": mail.html,
        }
        if mail.text:
            body["text"] = mail.text
        if mail.reply_to:
            body["reply_to"] = mail.reply_to
        if mail.cc:
            body["cc"] = mail.cc
        if mail.bcc:
            body["bcc"] = mail.bcc
        if mail.headers:
            body["headers"] = mail.headers
        if mail.tags:
            body["tags"] = [{"name": k, "value": v} for k, v in mail.tags.items()]

        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                "https://api.resend.com/emails",
                json=body,
                headers={"Authorization": f"Bearer {self._api_key}"},
            )
            r.raise_for_status()
            data = r.json()

        return SendResult(provider=self.name, message_id=data.get("id"), accepted=mail.to)
