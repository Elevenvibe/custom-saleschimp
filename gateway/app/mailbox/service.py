"""IMAP fetcher + SMTP sender for the Email feature.

Two halves of the same mail surface (Communication → Email):

  fetch_one(scope_kind, scope_id)
      Connects to IMAP with the stored credentials, walks UIDs strictly
      greater than max(uid_int) for this scope, downloads each message
      (headers + plain-text body), and inserts into mail_messages with
      direction='inbound'. UID-based dedupe via the unique constraint
      means re-running is idempotent; we never re-fetch the same
      message even if the worker crashes mid-batch.

  send_one(scope_kind, scope_id, to, subject, body, in_reply_to=None)
      Builds an RFC 5322 message, sends via aiosmtplib using the stored
      SMTP creds, and persists an outbound row in mail_messages so the
      Email UI's thread view stays unified.

Both functions are stand-alone (no module state) so they can be called
from the background loop OR from a request handler (e.g. the Send
button). The loop in cron.py just calls fetch_one for each active
scope on each tick.

Connection errors are logged and swallowed so one tenant's broken
mailbox doesn't poison the whole fetch cycle.
"""

from __future__ import annotations

import asyncio
import email
import email.policy
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import getaddresses, parsedate_to_datetime
from typing import Any

import aioimaplib
import aiosmtplib
import structlog
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.email.crypto import decrypt_dict
from app.mailbox.mail_message import MailMessage
from app.mailbox.models import MailboxConfig

log = structlog.get_logger()


# ---- helpers -----------------------------------------------------------


def _parse_address(value: str | None) -> tuple[str, str | None]:
    """Parse a single 'Name <email@host>' header into (email, name)."""
    if not value:
        return ("", None)
    parsed = getaddresses([value])
    if not parsed:
        return (value, None)
    name, addr = parsed[0]
    return (addr or value, name or None)


def _parse_address_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [addr for _, addr in getaddresses([value]) if addr]


def _extract_plain_body(msg: EmailMessage) -> str:
    """Pull a best-effort plain-text body out of an email.message.

    walk() handles both single-part and multipart MIME. We prefer
    text/plain; fall back to text/html stripped to text if no plain
    part exists (rare in 2026 but worth covering)."""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            if ctype == "text/plain":
                try:
                    return part.get_content()
                except Exception:
                    return part.get_payload(decode=True).decode(errors="replace")
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                try:
                    raw = part.get_content()
                except Exception:
                    raw = part.get_payload(decode=True).decode(errors="replace")
                # Cheap HTML strip — good enough for a list preview; the
                # full-fidelity render comes later when we add the HTML
                # pane.
                import re

                return re.sub(r"<[^>]+>", "", raw)
        return ""
    try:
        return msg.get_content()
    except Exception:
        payload = msg.get_payload(decode=True)
        if isinstance(payload, bytes):
            return payload.decode(errors="replace")
        return str(payload or "")


# ---- IMAP fetch --------------------------------------------------------


async def fetch_one(session: AsyncSession, mailbox: MailboxConfig) -> dict[str, int]:
    """Pull new inbound messages for one mailbox.

    Returns a small stats dict {fetched: N, errors: N} so the cron
    can log a meaningful summary per tick.
    """
    stats = {"fetched": 0, "errors": 0}
    if not mailbox.imap_active or not mailbox.imap_config_encrypted:
        return stats
    try:
        creds = decrypt_dict(mailbox.imap_config_encrypted)
    except Exception as e:
        log.warning("mailbox.imap.decrypt_failed", scope_kind=mailbox.scope_kind, error=str(e))
        stats["errors"] += 1
        return stats

    host = creds.get("host")
    port = int(creds.get("port") or 993)
    username = creds.get("username")
    password = creds.get("password")
    use_ssl = bool(creds.get("use_ssl", True))
    if not (host and username and password):
        return stats

    # Find highest UID we've already stored for this scope so we only
    # fetch newer messages. Restart-safe — losing the worker mid-batch
    # just means we re-pull what was in flight.
    max_uid = (
        await session.execute(
            select(func.max(MailMessage.uid_int)).where(
                MailMessage.scope_kind == mailbox.scope_kind,
                MailMessage.scope_id == mailbox.scope_id,
                MailMessage.direction == "inbound",
            )
        )
    ).scalar() or 0

    client: aioimaplib.IMAP4_SSL | aioimaplib.IMAP4 | None = None
    try:
        if use_ssl:
            client = aioimaplib.IMAP4_SSL(host=host, port=port, timeout=20)
        else:
            client = aioimaplib.IMAP4(host=host, port=port, timeout=20)
        await client.wait_hello_from_server()
        await client.login(username, password)
        await client.select("INBOX")
        # UID range: max_uid+1 to *. Empty/"OK" with no IDs means nothing
        # new. The server returns space-separated UIDs in the response
        # data line.
        resp = await client.uid_search(f"UID {max_uid + 1}:*")
        if resp.result != "OK" or not resp.lines:
            return stats
        # First line is the UID list. aioimaplib returns bytes.
        first = resp.lines[0]
        if isinstance(first, bytes):
            first = first.decode()
        uids = [int(u) for u in first.split() if u.isdigit() and int(u) > max_uid]
        for uid in uids:
            try:
                fetched = await client.uid("FETCH", str(uid), "(RFC822)")
                if fetched.result != "OK":
                    stats["errors"] += 1
                    continue
                # aioimaplib gives back (literal-length, payload) pairs;
                # the payload bytes are the second line.
                raw: bytes | None = None
                for line in fetched.lines:
                    if isinstance(line, bytes) and line.startswith(b"From "):
                        # rare — server returned a mbox-style line
                        raw = line
                        break
                    if isinstance(line, (bytes, bytearray)) and len(line) > 100:
                        raw = bytes(line)
                        break
                if raw is None:
                    # Fall back to whichever line is biggest
                    candidates = [l for l in fetched.lines if isinstance(l, (bytes, bytearray))]
                    if not candidates:
                        stats["errors"] += 1
                        continue
                    raw = bytes(max(candidates, key=len))
                msg = email.message_from_bytes(raw, policy=email.policy.default)
                from_email, from_name = _parse_address(msg.get("From"))
                to_emails = _parse_address_list(msg.get("To"))
                subject = (msg.get("Subject") or "").strip()
                message_id = (msg.get("Message-ID") or "").strip() or None
                in_reply_to = (msg.get("In-Reply-To") or "").strip() or None
                date_hdr = msg.get("Date")
                try:
                    received_at = (
                        parsedate_to_datetime(date_hdr) if date_hdr else datetime.now(timezone.utc)
                    )
                except Exception:
                    received_at = datetime.now(timezone.utc)
                if received_at.tzinfo is None:
                    received_at = received_at.replace(tzinfo=timezone.utc)

                body = _extract_plain_body(msg)
                # Truncate aggressively — list previews + thread view
                # only need a few KB. Full source can be re-fetched if
                # we ever need it.
                if len(body) > 20_000:
                    body = body[:20_000] + "\n…(truncated)"

                row = MailMessage(
                    scope_kind=mailbox.scope_kind,
                    scope_id=mailbox.scope_id,
                    direction="inbound",
                    uid_int=uid,
                    message_id=message_id,
                    in_reply_to=in_reply_to,
                    from_email=from_email[:320],
                    from_name=(from_name or "")[:255] or None,
                    to_emails=to_emails,
                    subject=subject[:500],
                    body_text=body,
                    received_at=received_at,
                    folder="INBOX",
                )
                session.add(row)
                try:
                    await session.flush()
                    stats["fetched"] += 1
                except IntegrityError:
                    # Already inserted in a previous run that crashed
                    # before commit. Roll back this row and continue.
                    await session.rollback()
            except Exception as e:
                stats["errors"] += 1
                log.warning(
                    "mailbox.imap.fetch_message_failed",
                    scope_kind=mailbox.scope_kind,
                    uid=uid,
                    error=str(e),
                )
        await session.commit()
    except Exception as e:
        stats["errors"] += 1
        log.warning(
            "mailbox.imap.session_failed",
            scope_kind=mailbox.scope_kind,
            error=str(e),
        )
    finally:
        if client is not None:
            try:
                await client.logout()
            except Exception:
                pass
    return stats


# ---- SMTP send ---------------------------------------------------------


async def send_one(
    session: AsyncSession,
    mailbox: MailboxConfig,
    *,
    to: list[str],
    subject: str,
    body: str,
    in_reply_to: str | None = None,
    sender_override: str | None = None,
) -> MailMessage:
    """Send an email via the mailbox's configured SMTP creds and persist
    an outbound row so the Email UI thread view can show it."""
    if not mailbox.smtp_active or not mailbox.smtp_config_encrypted:
        raise RuntimeError("SMTP is not configured for this mailbox.")
    try:
        creds = decrypt_dict(mailbox.smtp_config_encrypted)
    except Exception as e:
        raise RuntimeError(f"SMTP credential decrypt failed: {e}") from e

    host = creds.get("host")
    port = int(creds.get("port") or 587)
    username = creds.get("username")
    password = creds.get("password")
    use_tls = bool(creds.get("use_tls", True))
    if not (host and username and password):
        raise RuntimeError("SMTP credentials are incomplete.")

    from_email = sender_override or mailbox.from_email or username
    from_name = mailbox.from_name
    sender_header = f"{from_name} <{from_email}>" if from_name else from_email

    msg = EmailMessage()
    msg["From"] = sender_header
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = in_reply_to
    msg.set_content(body)

    # aiosmtplib auto-selects STARTTLS vs implicit TLS based on the
    # port + the start_tls flag.
    await aiosmtplib.send(
        msg,
        hostname=host,
        port=port,
        username=username,
        password=password,
        start_tls=use_tls and port != 465,
        use_tls=port == 465,
        timeout=20,
    )

    row = MailMessage(
        scope_kind=mailbox.scope_kind,
        scope_id=mailbox.scope_id,
        direction="outbound",
        uid_int=None,
        message_id=msg.get("Message-ID"),
        in_reply_to=in_reply_to,
        from_email=from_email,
        from_name=from_name,
        to_emails=to,
        subject=subject[:500],
        body_text=body,
        received_at=datetime.now(timezone.utc),
        read_at=datetime.now(timezone.utc),  # we authored it; mark read
        folder="SENT",
    )
    session.add(row)
    await session.flush()
    await session.commit()
    return row
