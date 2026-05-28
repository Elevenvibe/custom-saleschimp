"use client";

/**
 * /console/email — tenant-side mailbox.
 *
 * Mirrors admin /email (Gmail two-pane + folder dropdown + funnel
 * filter + Compose top-right + WYSIWYG body) but scoped to the tenant
 * via /api/tenant/mail. The tenant's mailbox is configured under
 * /console/settings/organization → Email integration.
 *
 * Sidebar surfacing: this lives under the Account / Communication
 * group in the Dograh-overlay AppSidebar; clicking it iframes the
 * page via /console-bridge/email.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import { RichEditor } from "@/components/RichEditor";
import { HtmlBody } from "@/components/HtmlBody";
import {
  ChevronDown,
  Filter,
  Inbox,
  Mail,
  PenSquare,
  Search,
  Send,
  ShieldAlert,
  Tag,
} from "lucide-react";

type Folder = "INBOX" | "SENT" | "SPAM" | "UPDATES";

const FOLDERS: { value: Folder; label: string; icon: React.ReactNode }[] = [
  { value: "INBOX", label: "Inbox", icon: <Inbox className="h-3.5 w-3.5" /> },
  { value: "SENT", label: "Sent", icon: <Send className="h-3.5 w-3.5" /> },
  { value: "UPDATES", label: "Updates", icon: <Tag className="h-3.5 w-3.5" /> },
  { value: "SPAM", label: "Spam", icon: <ShieldAlert className="h-3.5 w-3.5" /> },
];

type MailboxOut = {
  smtp_active: boolean;
  imap_active: boolean;
  from_email: string | null;
};

type MailMessage = {
  id: number;
  direction: "inbound" | "outbound";
  folder: string;
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
  const [folder, setFolder] = useState<Folder>("INBOX");
  const [messages, setMessages] = useState<MailMessage[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [showCompose, setShowCompose] = useState(false);
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const folderRef = useRef<HTMLDivElement | null>(null);
  // Funnel filter state — same shape as admin Email
  const [unreadFilter, setUnreadFilter] = useState<"all" | "unread" | "read">("all");
  const [receivedFrom, setReceivedFrom] = useState("");
  const [receivedTo, setReceivedTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    api<MailboxOut>("/api/tenant/mailbox")
      .then(setMailbox)
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    if (!showFilters && !showFolderMenu) return;
    function onDown(e: MouseEvent) {
      if (showFilters && filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilters(false);
      }
      if (showFolderMenu && folderRef.current && !folderRef.current.contains(e.target as Node)) {
        setShowFolderMenu(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showFilters, showFolderMenu]);

  const reload = useCallback(() => {
    const sp = new URLSearchParams();
    sp.set("folder", folder);
    if (unreadFilter === "unread") sp.set("unread", "true");
    else if (unreadFilter === "read") sp.set("unread", "false");
    if (receivedFrom) sp.set("received_from", receivedFrom);
    if (receivedTo) sp.set("received_to", receivedTo);
    api<MailMessage[]>(`/api/tenant/mail?${sp.toString()}`)
      .then((rows) => {
        setMessages(rows);
        if (selectedId != null && !rows.find((m) => m.id === selectedId)) {
          setSelectedId(null);
        }
      })
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, unreadFilter, receivedFrom, receivedTo]);
  useEffect(reload, [reload]);

  const filtered = useMemo(() => {
    if (!messages) return [];
    return q
      ? messages.filter(
          (m) =>
            m.subject.toLowerCase().includes(q) || m.from_email.toLowerCase().includes(q),
        )
      : messages;
  }, [messages, q]);

  const configured = mailbox?.imap_active || mailbox?.smtp_active;
  const unreadCount = (messages ?? []).filter((m) => m.unread).length;
  const currentFolder = FOLDERS.find((f) => f.value === folder)!;
  const activeFilterCount =
    (unreadFilter !== "all" ? 1 : 0) + (receivedFrom ? 1 : 0) + (receivedTo ? 1 : 0);

  return (
    <>
      {/* Compact header — search centered, Compose top-right. We can't
          rely on a PageHeader here because the console (when iframed by
          Dograh) already has the parent chrome; this is the inner Gmail-
          style chrome scoped to the email page. */}
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
        <div className="text-sm font-medium">Email</div>
        <div className="mx-auto flex items-center gap-1.5">
          <div className="relative w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search mail…"
              className="h-9 w-full rounded-md border bg-background pl-8 pr-2 text-sm"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
          </div>
          <div ref={filterRef} className="relative">
            <button
              type="button"
              onClick={() => setShowFilters((s) => !s)}
              title="Filter"
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-muted/40"
            >
              <Filter className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {showFilters && (
              <div className="absolute right-0 top-full z-30 mt-2 w-[300px] rounded-md border bg-popover p-4 shadow-lg space-y-3 text-sm">
                <div className="font-medium">Filters</div>
                <div>
                  <div className="text-xs">Read state</div>
                  <div className="mt-1 inline-flex rounded-md border p-0.5">
                    {(["all", "unread", "read"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setUnreadFilter(v)}
                        className={`rounded px-2 py-1 text-xs capitalize ${
                          unreadFilter === v ? "bg-primary text-primary-foreground" : ""
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs">From date</div>
                    <input
                      type="date"
                      className="mt-0.5 h-8 w-full rounded-md border px-2 text-xs"
                      value={receivedFrom}
                      onChange={(e) => setReceivedFrom(e.target.value)}
                    />
                  </div>
                  <div>
                    <div className="text-xs">To date</div>
                    <input
                      type="date"
                      className="mt-0.5 h-8 w-full rounded-md border px-2 text-xs"
                      value={receivedTo}
                      onChange={(e) => setReceivedTo(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-between pt-1">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:underline"
                    onClick={() => {
                      setUnreadFilter("all");
                      setReceivedFrom("");
                      setReceivedTo("");
                    }}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFilters(false)}
                    className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => setShowCompose(true)}
            disabled={!mailbox?.smtp_active}
            title={
              mailbox?.smtp_active
                ? "Compose new message"
                : "Configure SMTP under Organization settings → Email integration → SMTP"
            }
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            <PenSquare className="h-3.5 w-3.5" /> Compose
          </button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-3.5rem)]">
        {/* Left: folder dropdown + preamble list */}
        <div className="w-[340px] shrink-0 border-r bg-muted/20 flex flex-col">
          <div className="border-b p-4">
            <div ref={folderRef} className="relative inline-block">
              <button
                type="button"
                onClick={() => setShowFolderMenu((s) => !s)}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold hover:bg-muted/40"
              >
                {currentFolder.icon}
                {currentFolder.label}
                {folder === "INBOX" && unreadCount > 0 && (
                  <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                    {unreadCount}
                  </span>
                )}
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </button>
              {showFolderMenu && (
                <div className="absolute left-0 top-full z-30 mt-1 w-[180px] rounded-md border bg-popover p-1 shadow-lg">
                  {FOLDERS.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => {
                        setFolder(f.value);
                        setSelectedId(null);
                        setShowFolderMenu(false);
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/40"
                    >
                      {f.icon}
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!messages ? (
              <div className="p-4 text-xs text-muted-foreground">Loading…</div>
            ) : !configured && folder === "INBOX" ? (
              <ConfigPrompt mailbox={mailbox} />
            ) : filtered.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">
                {q
                  ? "No messages match this search."
                  : folder === "INBOX"
                    ? "Inbox is empty."
                    : folder === "SENT"
                      ? "No sent mail yet."
                      : `No messages in ${currentFolder.label}.`}
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

      {showCompose && (
        <ComposeDialog
          onClose={() => setShowCompose(false)}
          onSent={() => {
            setShowCompose(false);
            setFolder("SENT");
            reload();
          }}
        />
      )}

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
        <div className={`truncate ${message.unread ? "font-semibold" : "text-muted-foreground"}`}>
          {who}
        </div>
        <div className="text-[10px] text-muted-foreground shrink-0">{timeStr}</div>
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        {message.unread && <span className="inline-block size-1.5 rounded-full bg-blue-500" />}
        <div className={`truncate text-sm ${message.unread ? "font-semibold" : "text-foreground/80"}`}>
          {message.subject || "(no subject)"}
        </div>
      </div>
    </button>
  );
}

function ConfigPrompt({ mailbox }: { mailbox: MailboxOut | null }) {
  return (
    <div className="p-4 space-y-3 text-xs text-muted-foreground">
      <div>Configure IMAP + SMTP to start pulling and sending mail.</div>
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
      <a
        href="/console/settings/organization"
        className="block rounded-md border px-3 py-1.5 text-center text-xs hover:bg-muted/40"
      >
        Configure in Organization settings
      </a>
    </div>
  );
}

function EmptyDetail({ configured }: { configured: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
      <div className="text-center max-w-md">
        <Mail className="mx-auto h-10 w-10 opacity-30" />
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
    api<MailMessage>(`/api/tenant/mail/${id}`)
      .then((d) => {
        setM(d);
        onChanged();
      })
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!m) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/tenant/mail/send", {
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
          <Meta label="Direction" value={m.direction} />
          <Meta label="Received" value={new Date(m.received_at).toLocaleString()} />
        </div>
      </div>

      <div className="rounded-md border bg-card p-4">
        {m.body_text ? (
          <HtmlBody html={m.body_text} />
        ) : (
          <span className="text-sm text-muted-foreground italic">(empty body)</span>
        )}
      </div>

      {m.direction === "inbound" && (
        <form onSubmit={sendReply} className="space-y-2 border-t pt-4">
          <div className="text-sm font-medium">Reply</div>
          <RichEditor
            value={reply}
            onChange={setReply}
            placeholder={`Reply to ${m.from_email}…`}
            minHeight={140}
          />
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy || !reply.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" /> {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ComposeDialog({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const recipients = to
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (recipients.length === 0) throw new Error("Add at least one recipient.");
      await api("/api/tenant/mail/send", {
        method: "POST",
        body: JSON.stringify({ to: recipients, subject, body }),
      });
      onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-2xl rounded-lg bg-card p-5 space-y-3 shadow-lg"
      >
        <div className="text-lg font-semibold">New message</div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">To</label>
          <input
            type="text"
            className="mt-0.5 w-full rounded-md border px-3 py-2 text-sm"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com, another@example.com"
            required
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Subject</label>
          <input
            type="text"
            className="mt-0.5 w-full rounded-md border px-3 py-2 text-sm"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Body</label>
          <div className="mt-0.5">
            <RichEditor
              value={body}
              onChange={setBody}
              placeholder="Write your message…"
              minHeight={220}
            />
          </div>
        </div>
        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border px-4 py-2 text-sm"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !body.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" /> {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
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
