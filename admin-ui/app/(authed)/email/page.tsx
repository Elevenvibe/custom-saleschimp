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
  Filter,
  Inbox,
  Mail,
  MailOpen,
  PenSquare,
  Search,
  Send,
  Settings as SettingsIcon,
  ShieldAlert,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useRef } from "react";

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
  // Funnel filter state (read/unread + date range). Empty strings on the
  // date inputs mean "no constraint"; cleared via the Reset button in
  // the popover.
  const [unreadFilter, setUnreadFilter] = useState<"all" | "unread" | "read">("all");
  const [receivedFrom, setReceivedFrom] = useState("");
  const [receivedTo, setReceivedTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);

  // Click-outside to close the filter popover. Listening on mousedown
  // (not click) so the dropdown closes before any button it shadows
  // gets a chance to fire on the same gesture.
  useEffect(() => {
    if (!showFilters) return;
    function onDown(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilters(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showFilters]);

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
    const sp = new URLSearchParams();
    sp.set("folder", folder);
    if (unreadFilter === "unread") sp.set("unread", "true");
    else if (unreadFilter === "read") sp.set("unread", "false");
    if (receivedFrom) sp.set("received_from", receivedFrom);
    if (receivedTo) sp.set("received_to", receivedTo);
    api<MailMessage[]>(`/api/admin/mail?${sp.toString()}`)
      .then((rows) => {
        setMessages(rows);
        if (selectedId != null && !rows.find((m) => m.id === selectedId)) {
          setSelectedId(null);
        }
      })
      .catch((e) => setError((e as Error).message));
    // selectedId omitted on purpose — including it would re-fetch the
    // list every time the selection changes. We only want reload on
    // filter changes + manual triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, unreadFilter, receivedFrom, receivedTo]);
  useEffect(reload, [reload]);

  const activeFilterCount =
    (unreadFilter !== "all" ? 1 : 0) +
    (receivedFrom ? 1 : 0) +
    (receivedTo ? 1 : 0);

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

  // ----- Multi-select + bulk actions (delete / mark read / mark unread) ----
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }
  // Clear selection whenever the visible set changes (folder/filter/search).
  useEffect(() => {
    setSelectedIds(new Set());
  }, [folder, unreadFilter, receivedFrom, receivedTo, q]);

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((m) => selectedIds.has(m.id));

  async function runAction(
    action: "delete" | "mark_read" | "mark_unread",
    ids: number[],
  ) {
    if (ids.length === 0) return;
    if (action === "delete" && !confirm(`Delete ${ids.length} message${ids.length > 1 ? "s" : ""}?`)) {
      return;
    }
    setError(null);
    try {
      await api("/api/admin/mail/actions", {
        method: "POST",
        body: JSON.stringify({ ids, action }),
      });
      if (action === "delete" && selectedId != null && ids.includes(selectedId)) {
        setSelectedId(null);
      }
      clearSelection();
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

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
        {/* Center column: narrower search + funnel filter. max-w-sm
            instead of max-w-xl so the header doesn't feel "all search". */}
        <div className="mx-auto flex items-center gap-1.5">
          <div className="relative w-[280px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search mail…"
              className="h-9 pl-8"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
          </div>
          <div ref={filterRef} className="relative">
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 relative"
              onClick={() => setShowFilters((s) => !s)}
              title="Filter"
            >
              <Filter className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            {showFilters && (
              <div className="absolute right-0 top-full z-30 mt-2 w-[300px] rounded-md border bg-popover p-4 shadow-lg space-y-3 text-sm">
                <div className="font-medium">Filters</div>
                <div>
                  <Label className="text-xs">Read state</Label>
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
                    <Label className="text-xs">From date</Label>
                    <Input
                      type="date"
                      className="h-8 text-xs"
                      value={receivedFrom}
                      onChange={(e) => setReceivedFrom(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">To date</Label>
                    <Input
                      type="date"
                      className="h-8 text-xs"
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
                  <Button size="sm" onClick={() => setShowFilters(false)}>
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="ml-auto">
          {/* Always clickable — user reported the disabled state was
              opaque ("compose can't be clicked"). The dialog now opens
              regardless and surfaces a friendly inline warning if SMTP
              isn't configured, so the user understands the gate. */}
          <Button
            size="sm"
            onClick={() => setShowCompose(true)}
            title="Compose new message"
          >
            <PenSquare className="h-3.5 w-3.5" /> Compose
          </Button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-3.5rem)]">
        {/* Left: folder dropdown + compose + preamble list */}
        <div className="w-[380px] shrink-0 border-r bg-muted/20 flex flex-col">
          <div className="border-b p-4">
            {/* Compose moved to the page header (top-right) so the left
                pane is solely for folder + list. */}
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
          </div>

          {/* Select-all + bulk actions (delete / mark read / mark unread). */}
          <div className="flex items-center gap-1 border-b px-3 py-1.5 text-xs">
            <input
              type="checkbox"
              aria-label="Select all"
              className="size-3.5 cursor-pointer accent-primary"
              checked={allVisibleSelected}
              ref={(el) => {
                if (el) el.indeterminate = selectedIds.size > 0 && !allVisibleSelected;
              }}
              onChange={(e) => {
                if (e.target.checked) setSelectedIds(new Set(filtered.map((m) => m.id)));
                else clearSelection();
              }}
            />
            {selectedIds.size === 0 ? (
              <span className="ml-1 text-muted-foreground">Select</span>
            ) : (
              <div className="ml-1 flex items-center gap-0.5">
                <span className="mr-1 text-muted-foreground">{selectedIds.size} selected</span>
                <button
                  type="button"
                  title="Mark read"
                  className="rounded p-1 hover:bg-muted"
                  onClick={() => runAction("mark_read", [...selectedIds])}
                >
                  <MailOpen className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Mark unread"
                  className="rounded p-1 hover:bg-muted"
                  onClick={() => runAction("mark_unread", [...selectedIds])}
                >
                  <Mail className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Delete"
                  className="rounded p-1 text-destructive hover:bg-destructive/10"
                  onClick={() => runAction("delete", [...selectedIds])}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Clear selection"
                  className="rounded p-1 hover:bg-muted"
                  onClick={clearSelection}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
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
                  selected={selectedIds.has(m.id)}
                  onToggleSelect={() => toggleSelect(m.id)}
                  onClick={() => setSelectedId(m.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right pane — min-w-0 lets this flex child shrink so a wide email
            body wraps/scrolls WITHIN the pane instead of pushing the whole
            page wider (the reported overlap). overflow-hidden clips any
            stray wide child; HtmlBody itself also clamps content. */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {selectedId == null ? (
            <EmptyDetail configured={!!configured} />
          ) : (
            <MailDetailPane
              id={selectedId}
              onChanged={reload}
              onAction={(action) => runAction(action, [selectedId])}
            />
          )}
        </div>
      </div>

      {showCompose && (
        <ComposeDialog
          smtpActive={!!mailbox?.smtp_active}
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
  selected,
  onToggleSelect,
  onClick,
}: {
  message: MailMessage;
  active: boolean;
  selected: boolean;
  onToggleSelect: () => void;
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
  // Row is a flex (checkbox + button) rather than a single <button> so the
  // multi-select checkbox isn't nested inside a button (invalid HTML).
  return (
    <div
      className={`flex items-start gap-2 border-b px-3 py-2 transition hover:bg-muted/40 ${
        selected ? "bg-primary/10" : active ? "bg-primary/5" : ""
      }`}
    >
      <input
        type="checkbox"
        aria-label="Select message"
        className="mt-1 size-3.5 shrink-0 cursor-pointer accent-primary"
        checked={selected}
        onChange={onToggleSelect}
      />
      <button type="button" onClick={onClick} className="min-w-0 flex-1 text-left text-xs">
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
            <span className="inline-block size-1.5 shrink-0 rounded-full bg-blue-500" />
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
    </div>
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

function MailDetailPane({
  id,
  onChanged,
  onAction,
}: {
  id: number;
  onChanged: () => void;
  onAction: (action: "delete" | "mark_read" | "mark_unread") => void;
}) {
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
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 break-words text-xl font-semibold">
            {m.subject || "(no subject)"}
          </h2>
          {/* Per-message read/unread + delete actions. */}
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={m.read_at ? "Mark as unread" : "Mark as read"}
              onClick={() => onAction(m.read_at ? "mark_unread" : "mark_read")}
            >
              {m.read_at ? <Mail className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:bg-destructive/10"
              title="Delete"
              onClick={() => onAction("delete")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-y-1 gap-x-6 text-xs text-muted-foreground sm:grid-cols-3">
          <Meta label="From" value={m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email} />
          <Meta label="To" value={m.to_emails.join(", ") || "—"} />
          <Meta label="Direction" value={<Badge variant="secondary">{m.direction}</Badge>} />
          <Meta label="Received" value={new Date(m.received_at).toLocaleString()} />
        </div>
      </div>

      {/* overflow-hidden + min-w-0 so a wide body never escapes the card. */}
      <div className="min-w-0 overflow-hidden rounded-md border bg-card p-4">
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

function ComposeDialog({
  onClose,
  onSent,
  smtpActive,
}: {
  onClose: () => void;
  onSent: () => void;
  smtpActive: boolean;
}) {
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
      {/* onOpenAutoFocus prevented: radix Dialog defaults to focusing
          the first focusable element (and re-asserting that focus on
          interaction), which fights Tiptap's contenteditable and ends
          up freezing the form — clicks into the inputs and the editor
          stop registering. Disabling auto-focus + auto-restore lets
          the user click into any field freely. */}
      <DialogContent
        className="sm:max-w-2xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
        </DialogHeader>
        {!smtpActive && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            SMTP isn&apos;t configured yet. You can draft the message, but Send will fail until you set credentials under{" "}
            <span className="font-medium">Settings → Email providers → SMTP</span>.
          </div>
        )}
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
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide">{label}</div>
      <div className="mt-0.5 break-words text-sm text-foreground">{value}</div>
    </div>
  );
}
