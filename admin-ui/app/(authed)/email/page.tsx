"use client";

/**
 * /email — super-admin platform mailbox (Gmail-style).
 *
 * Backed by:
 *   GET  /api/admin/mailbox       (config status)
 *   GET  /api/admin/mail          (list inbound + outbound by received_at desc)
 *   GET  /api/admin/mail/{id}     (detail, marks read)
 *   POST /api/admin/mail/send     (SMTP send via aiosmtplib)
 *
 * IMAP fetcher is the gateway's mail_fetcher_loop (app/mailbox/cron.py)
 * — runs every 60s by default, pulls UNSEEN messages, stores them as
 * mail_messages rows with direction='inbound'. This page just renders
 * what's already in the DB.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Inbox, Search, Send, Settings as SettingsIcon } from "lucide-react";

type MailboxOut = {
  smtp_active: boolean;
  imap_active: boolean;
  from_email: string | null;
};

type MailMessage = {
  id: number;
  direction: "inbound" | "outbound";
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  subject: string;
  body_text: string;
  received_at: string;
  read_at: string | null;
  in_reply_to: string | null;
  message_id: string | null;
  unread: boolean;
};

export default function EmailPage() {
  const [mailbox, setMailbox] = useState<MailboxOut | null>(null);
  const [messages, setMessages] = useState<MailMessage[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    api<MailboxOut>("/api/admin/mailbox")
      .then(setMailbox)
      .catch((e) => setError((e as Error).message));
  }, []);

  const reload = useCallback(() => {
    api<MailMessage[]>("/api/admin/mail")
      .then(setMessages)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(reload, [reload]);

  const filtered = useMemo(() => {
    if (!messages) return [];
    return q
      ? messages.filter(
          (m) =>
            m.subject.toLowerCase().includes(q) ||
            m.from_email.toLowerCase().includes(q),
        )
      : messages;
  }, [messages, q]);

  const configured = mailbox?.imap_active || mailbox?.smtp_active;
  const unreadCount = (messages ?? []).filter((m) => m.unread).length;

  return (
    <>
      <PageHeader title="Email" parents={[{ label: "Communication" }]} />
      <div className="flex h-[calc(100vh-3.5rem)]">
        {/* Left: filters + preamble list */}
        <div className="w-[380px] shrink-0 border-r bg-muted/20 flex flex-col">
          <div className="border-b p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold flex items-center gap-2">
                <Inbox className="h-4 w-4" /> Inbox
              </div>
              {unreadCount > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {unreadCount} unread
                </Badge>
              )}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search…"
                className="h-9 pl-8 text-xs"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!messages ? (
              <div className="p-4 text-xs text-muted-foreground">Loading…</div>
            ) : !configured ? (
              <EmptyConfigPrompt mailbox={mailbox} />
            ) : filtered.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">
                {q ? "No messages match this search." : "Inbox is empty. The fetcher runs every 60s."}
              </div>
            ) : (
              filtered.map((m) => (
                <PreambleCard
                  key={m.id}
                  message={m}
                  active={selectedId === m.id}
                  onClick={() => setSelectedId(m.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right pane */}
        <div className="flex-1 overflow-y-auto">
          {selectedId == null ? (
            <EmptyDetail configured={!!configured} />
          ) : (
            <MailDetailPane id={selectedId} onChanged={reload} />
          )}
        </div>
      </div>

      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive shadow">
          {error}
        </div>
      )}
    </>
  );
}

function PreambleCard({
  message,
  active,
  onClick,
}: {
  message: MailMessage;
  active: boolean;
  onClick: () => void;
}) {
  const t = new Date(message.received_at);
  const isToday = new Date().toDateString() === t.toDateString();
  const timeStr = isToday
    ? t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : t.toLocaleDateString();
  const who =
    message.direction === "outbound"
      ? `→ ${message.to_emails[0] ?? "—"}`
      : message.from_name || message.from_email;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full border-b px-3 py-2 text-left text-xs transition hover:bg-muted/40 ${
        active ? "bg-primary/5" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div
          className={`truncate ${
            message.unread ? "font-semibold text-foreground" : "text-muted-foreground"
          }`}
        >
          {who}
        </div>
        <div className="text-[10px] text-muted-foreground shrink-0">{timeStr}</div>
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        {message.unread && (
          <span className="inline-block size-1.5 rounded-full bg-blue-500" />
        )}
        <div
          className={`truncate text-sm ${
            message.unread ? "font-semibold text-foreground" : "text-foreground/80"
          }`}
        >
          {message.subject || "(no subject)"}
        </div>
      </div>
    </button>
  );
}

function EmptyConfigPrompt({ mailbox }: { mailbox: MailboxOut | null }) {
  return (
    <div className="p-4 space-y-3 text-xs text-muted-foreground">
      <div>
        Configure IMAP + SMTP to start pulling and sending mail.
      </div>
      <div className="rounded-md border bg-card p-3">
        <div className="flex items-center justify-between">
          <span>IMAP (inbox)</span>
          <span className={mailbox?.imap_active ? "text-emerald-600" : "text-amber-600"}>
            {mailbox?.imap_active ? "active" : "not configured"}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span>SMTP (outbox)</span>
          <span className={mailbox?.smtp_active ? "text-emerald-600" : "text-amber-600"}>
            {mailbox?.smtp_active ? "active" : "not configured"}
          </span>
        </div>
      </div>
      <Link href="/settings/email-providers?tab=imap">
        <Button size="sm" variant="outline" className="w-full">
          <SettingsIcon className="h-3.5 w-3.5" /> Configure
        </Button>
      </Link>
    </div>
  );
}

function EmptyDetail({ configured }: { configured: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
      <div className="text-center max-w-md">
        <Inbox className="mx-auto h-10 w-10 opacity-30" />
        <div className="mt-3">
          {configured
            ? "Pick a message from the inbox to read."
            : "Configure IMAP + SMTP to start pulling and sending mail."}
        </div>
      </div>
    </div>
  );
}

function MailDetailPane({ id, onChanged }: { id: number; onChanged: () => void }) {
  const [m, setM] = useState<MailMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setError(null);
    setM(null);
    api<MailMessage>(`/api/admin/mail/${id}`)
      .then((d) => {
        setM(d);
        onChanged();
      })
      .catch((e) => setError((e as Error).message));
    // onChanged intentionally omitted from deps — its identity changes
    // each parent reload which would refire this effect in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!m) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/mail/send", {
        method: "POST",
        body: JSON.stringify({
          to: [m.from_email],
          subject: m.subject.startsWith("Re: ") ? m.subject : `Re: ${m.subject}`,
          body: reply,
          in_reply_to: m.message_id,
        }),
      });
      setReply("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !m) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      </div>
    );
  }
  if (!m) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-5">
      <div className="border-b pb-4">
        <h2 className="text-xl font-semibold">{m.subject || "(no subject)"}</h2>
        <div className="mt-2 grid grid-cols-2 gap-y-1 gap-x-6 text-xs text-muted-foreground sm:grid-cols-3">
          <Meta label="From" value={m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email} />
          <Meta label="To" value={m.to_emails.join(", ") || "—"} />
          <Meta label="Direction" value={<Badge variant="secondary">{m.direction}</Badge>} />
          <Meta label="Received" value={new Date(m.received_at).toLocaleString()} />
        </div>
      </div>

      <div className="rounded-md border bg-card p-4 text-sm whitespace-pre-wrap">
        {m.body_text || <span className="text-muted-foreground italic">(empty body)</span>}
      </div>

      {m.direction === "inbound" && (
        <form onSubmit={sendReply} className="space-y-2 border-t pt-4">
          <div className="text-sm font-medium">Reply</div>
          <textarea
            className="w-full rounded-md border px-3 py-2 text-sm"
            rows={4}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={`Reply to ${m.from_email}…`}
            required
          />
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !reply.trim()}>
              <Send className="h-3.5 w-3.5" /> {busy ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide">{label}</div>
      <div className="mt-0.5 text-sm text-foreground">{value}</div>
    </div>
  );
}
