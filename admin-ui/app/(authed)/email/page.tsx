"use client";

/**
 * /email — super-admin platform mailbox.
 *
 * Header layout (matches the user's spec):
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ ◀ [breadcrumb]      ┃ search bar (centered)        ┃           │
 *   └────────────────────────────────────────────────────────────────┘
 *   ┌── left ─────────────────┐  ┌── right ──────────────────────────┐
 *   │ [Inbox ▾]    [Compose ✎]│  │ subject + meta + sanitised body   │
 *   │ ───────────────────────  │  │ reply (WYSIWYG)                    │
 *   │ preamble cards          │  │                                    │
 *   └────────────────────────┘  └────────────────────────────────────┘
 *
 * Folder dropdown ⇒ /api/admin/mail?folder=INBOX|SENT|SPAM|UPDATES
 * The fetcher currently only writes to INBOX + SENT; SPAM/UPDATES are
 * placeholders for the next slice (multi-folder IMAP pull).
 *
 * Compose / Reply use the WYSIWYG (tiptap) editor; messages render
 * through HtmlBody which DOMPurify-sanitises before injecting.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RichEditor } from "@/components/RichEditor";
import { HtmlBody } from "@/components/HtmlBody";
import {
  ChevronDown,
  Inbox,
  Mail,
  PenSquare,
  Search,
  Send,
  Settings as SettingsIcon,
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
    api<MailMessage[]>(`/api/admin/mail?folder=${folder}`)
      .then((rows) => {
        setMessages(rows);
        // Switching folders should reset the right pane to "nothing
        // selected" — otherwise a previously-selected ID may not exist
        // in the new folder and the detail pane shows a stale error.
        if (selectedId != null && !rows.find((m) => m.id === selectedId)) {
          setSelectedId(null);
        }
      })
      .catch((e) => setError((e as Error).message));
    // selectedId omitted on purpose — including it would re-fetch the
    // list every time the selection changes. We only want reload on
    // folder change + manual triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);
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
  const currentFolder = FOLDERS.find((f) => f.value === folder)!;

  return (
    <>
      {/* Custom header — search lives center stage instead of a normal
          PageHeader. Keeping sidebar trigger + breadcrumb left so the
          rest of the app's chrome is consistent. */}
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink>Communication</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Email</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="mx-auto flex-1 max-w-xl">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search mail…"
              className="h-9 pl-9"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
          </div>
        </div>
        <div className="w-[120px]">{/* spacer to balance the breadcrumb side */}</div>
      </header>

      <div className="flex h-[calc(100vh-3.5rem)]">
        {/* Left: folder dropdown + compose + preamble list */}
        <div className="w-[380px] shrink-0 border-r bg-muted/20 flex flex-col">
          <div className="border-b p-4">
            <div className="flex items-center justify-between gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold hover:bg-muted/40"
                  >
                    {currentFolder.icon}
                    {currentFolder.label}
                    {folder === "INBOX" && unreadCount > 0 && (
                      <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
                        {unreadCount}
                      </Badge>
                    )}
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {FOLDERS.map((f) => (
                    <DropdownMenuItem
                      key={f.value}
                      onClick={() => {
                        setFolder(f.value);
                        setSelectedId(null);
                      }}
                      className="gap-2"
                    >
                      {f.icon}
                      {f.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                onClick={() => setShowCompose(true)}
                disabled={!mailbox?.smtp_active}
                title={
                  mailbox?.smtp_active
                    ? "Compose new message"
                    : "Configure SMTP under Settings → Email providers → SMTP"
                }
              >
                <PenSquare className="h-3.5 w-3.5" /> Compose
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!messages ? (
              <div className="p-4 text-xs text-muted-foreground">Loading…</div>
            ) : !configured && folder === "INBOX" ? (
              <EmptyConfigPrompt mailbox={mailbox} />
            ) : filtered.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">
                {q
                  ? "No messages match this search."
                  : folder === "INBOX"
                    ? "Inbox is empty. The fetcher runs every 60s."
                    : folder === "SENT"
                      ? "No sent mail yet."
                      : `No messages in ${currentFolder.label}. (Multi-folder IMAP pull is queued in a follow-up; only INBOX is currently fetched.)`}
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
    api<MailMessage>(`/api/admin/mail/${id}`)
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
            <Button type="submit" size="sm" disabled={busy || !reply.trim()}>
              <Send className="h-3.5 w-3.5" /> {busy ? "Sending…" : "Send"}
            </Button>
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
      await api("/api/admin/mail/send", {
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>To</Label>
            <Input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com, another@example.com"
              required
            />
          </div>
          <div>
            <Label>Subject</Label>
            <Input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Body</Label>
            <RichEditor
              value={body}
              onChange={setBody}
              placeholder="Write your message…"
              minHeight={220}
            />
          </div>
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !body.trim()}>
              <Send className="h-3.5 w-3.5" /> {busy ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
