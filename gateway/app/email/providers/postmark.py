"""Postmark adapter using the transactional /email endpoint.

Auth: per-config server token (not the account-level token). Postmark requires
the From address to be on a verified Sender Signature or Domain — this is
the org's responsibility for tenant-scoped configs.
"""

from typing import Any

import httpx
import structlog

from app.email.providers.base import MailProvider, OutgoingMail, SendResult

log = structlog.get_logger()

# Postmark ErrorCodes worth naming in logs so the fix is obvious.
# https://postmarkapp.com/developer/api/overview#error-codes
_ERROR_HINTS = {
    300: "invalid email request (check From/To formatting)",
    400: "sender signature not found",
    401: "sender signature not confirmed",
    402: "invalid JSON",
    403: "incompatible JSON",
    405: "not allowed to send (account pending review)",
    406: "inactive recipient",
    412: "account is pending approval",
    300412: "from address not a confirmed sender signature/domain",
}


class PostmarkProvider(MailProvider):
    name = "postmark"

    def __init__(
        self,
        *,
        server_token: str,
        from_email: str,
        from_name: str | None = None,
    ):
        self._server_token = server_token
        self._from = f'"{from_name}" <{from_email}>' if from_name else from_email

    async def send(self, mail: OutgoingMail) -> SendResult:
        body: dict[str, Any] = {
            "From": self._from,
            "To": ",".join(mail.to),
            "Subject": mail.subject,
            "HtmlBody": mail.html,
            "MessageStream": "outbound",
        }
        if mail.text:
            body["TextBody"] = mail.text
        if mail.reply_to:
            body["ReplyTo"] = mail.reply_to
        if mail.cc:
            body["Cc"] = ",".join(mail.cc)
        if mail.bcc:
            body["Bcc"] = ",".join(mail.bcc)
        if mail.tags:
            # Postmark allows a single Tag string and arbitrary Metadata for
            # the rest — preserve tags as Metadata so nothing is lost.
            tag_items = list(mail.tags.items())
            body["Tag"] = tag_items[0][1] if tag_items else None
            body["Metadata"] = {k: v for k, v in mail.tags.items()}
        if mail.headers:
            body["Headers"] = [{"Name": k, "Value": v} for k, v in mail.headers.items()]

        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                "https://api.postmarkapp.com/email",
                json=body,
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "X-Postmark-Server-Token": self._server_token,
                },
            )
            if r.status_code >= 300:
                # Postmark returns {"ErrorCode": N, "Message": "..."} on
                # failure. Surface it before raising so the actual cause
                # (e.g. unverified sender signature) is visible in logs.
                detail: dict[str, Any] = {}
                try:
                    detail = r.json()
                except Exception:  # noqa: BLE001
                    detail = {"raw": r.text[:300]}
                code = detail.get("ErrorCode")
                log.warning(
                    "postmark.send_failed",
                    status=r.status_code,
                    error_code=code,
                    hint=_ERROR_HINTS.get(code, ""),
                    message=detail.get("Message"),
                    from_=self._from,
                )
                r.raise_for_status()
            data = r.json()

        return SendResult(
            provider=self.name,
            message_id=data.get("MessageID"),
            accepted=mail.to,
        )
