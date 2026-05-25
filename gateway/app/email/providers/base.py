from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class OutgoingMail:
    to: list[str]
    subject: str
    html: str
    text: str | None = None
    reply_to: str | None = None
    cc: list[str] = field(default_factory=list)
    bcc: list[str] = field(default_factory=list)
    headers: dict[str, str] = field(default_factory=dict)
    tags: dict[str, str] = field(default_factory=dict)


@dataclass
class SendResult:
    provider: str
    message_id: str | None
    accepted: list[str]


class MailProvider(Protocol):
    """All providers (Resend, SES, Postmark, SMTP) implement this."""

    name: str

    async def send(self, mail: OutgoingMail) -> SendResult: ...
