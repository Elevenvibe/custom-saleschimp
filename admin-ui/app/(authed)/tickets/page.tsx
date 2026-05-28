"use client";

/**
 * /tickets — super-admin cross-tenant ticket inbox (Gmail-style).
 *
 * Two-pane layout inspired by shadcn's sidebar-09 (mail) example:
 *
 *   ┌──────── left inner sidebar ────────┐  ┌──── right detail pane ─────┐
 *   │ ▣ Filters (status / priority / q)  │  │ Subject                    │
 *   │ ────────────────────────────────── │  │ tenant · created_by ·      │
 *   │ Preamble cards                     │  │  status · priority · updt  │
 *   │   ┌────────────────────────────┐   │  │ ────────────────────────── │
 *   │   │ TenantName       12:04 PM  │   │  │ thread messages            │
 *   │   │ Re: Inbound webhook 502    │   │  │ reply box                  │
 *   │   │ • unread dot               │   │  │                            │
 *   │   └────────────────────────────┘   │  │                            │
 *   └────────────────────────────────────┘  └────────────────────────────┘
 *
 * Backend already supports the filter contract (status / priority /
 * tenant_id / q) from the previous slice; we just consume it. Opening
 * a ticket fires GET /api/admin/tickets/{id} which marks read_at server-
 * side, so the unread dot disappears on next list refresh.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, type Tenant } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Filter, Mail, Plus, Search } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RichEditor } from "@/components/RichEditor";
import { HtmlBody } from "@/components/HtmlBody";

type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
type TicketPriority = "low" | "normal" | "high" | "urgent";

type Ticket = {
  id: number;
  tenant_id: number;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  created_by_email: string;
  created_at: string;
  updated_at: string;
  unread?: boolean;
};

type TicketMessage = {
  id: number;
  ticket_id: number;
  author_kind: "tenant" | "platform";
  author_email: string;
  body: string;
  created_at: string;
};

type TicketDetail = { ticket: Ticket; messages: TicketMessage[] };

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [tenants, setTenants] = useState<Map<number, Tenant>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Filter state
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<TicketStatus | "all">("all");
  const [priority, setPriority] = useState<TicketPriority | "all">("all");
  const [tenantId, setTenantId] = useState<string>("all");

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // Tenants index for showing tenant names in preamble cards.
  useEffect(() => {
    api<{ items: Tenant[] }>("/api/admin/tenants?limit=500")
      .then((r) => {
        const m = new Map<number, Tenant>();
        for (const t of r.items) m.set(t.id, t);
        setTenants(m);
      })
      .catch(() => {});
  }, []);

  // Date-range filter state lives here (above qs) because the useMemo
  // below references these inside its deps array — JS TDZ would throw
  // if these were declared later in the function body.
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status !== "all") sp.set("status", status);
    if (priority !== "all") sp.set("priority", priority);
    if (tenantId !== "all") sp.set("tenant_id", tenantId);
    if (createdFrom) sp.set("created_from", createdFrom);
    if (createdTo) sp.set("created_to", createdTo);
    return sp.toString();
  }, [q, status, priority, tenantId, createdFrom, createdTo]);

  const reload = useCallback(() => {
    setError(null);
    api<Ticket[]>(`/api/admin/tickets${qs ? "?" + qs : ""}`)
      .then(setTickets)
      .catch((e) => setError((e as Error).message));
  }, [qs]);
  useEffect(reload, [reload]);

  // Deep-link via ?ticket=<id> — handy when the per-tenant page links here.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get("ticket");
    if (t) setSelectedId(Number(t));
  }, []);

  const unreadCount = (tickets ?? []).filter((t) => t.unread).length;
  // Funnel popover open-state + create-ticket dialog open-state. Date
  // inputs (createdFrom/createdTo) are declared above qs because qs's
  // deps array references them.
  const [showFilters, setShowFilters] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);
  const [showCreate, setShowCreate] = useState(false);
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
  const activeFilterCount =
    (status !== "all" ? 1 : 0) +
    (priority !== "all" ? 1 : 0) +
    (tenantId !== "all" ? 1 : 0) +
    (createdFrom ? 1 : 0) +
    (createdTo ? 1 : 0);

  return (
    <>
      {/* Custom header — search centered, Create button top-right.
          PageHeader replaced because the user asked for this Gmail-style
          layout that the standard chrome can't accommodate. */}
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
              <BreadcrumbPage>Tickets</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="mx-auto flex items-center gap-1.5">
          <div className="relative w-[280px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search subject…"
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
              <div className="absolute right-0 top-full z-30 mt-2 w-[320px] rounded-md border bg-popover p-4 shadow-lg space-y-3 text-sm">
                <div className="font-medium">Filters</div>
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as TicketStatus | "all")}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All status</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Priority</Label>
                  <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority | "all")}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All priority</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Tenant</Label>
                  <Select value={tenantId} onValueChange={setTenantId}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All tenants</SelectItem>
                      {Array.from(tenants.values()).map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">From date</Label>
                    <Input
                      type="date"
                      className="h-8 text-xs"
                      value={createdFrom}
                      onChange={(e) => setCreatedFrom(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">To date</Label>
                    <Input
                      type="date"
                      className="h-8 text-xs"
                      value={createdTo}
                      onChange={(e) => setCreatedTo(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-between pt-1">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:underline"
                    onClick={() => {
                      setStatus("all");
                      setPriority("all");
                      setTenantId("all");
                      setCreatedFrom("");
                      setCreatedTo("");
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
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" /> Create ticket
          </Button>
        </div>
      </header>
      <div className="flex h-[calc(100vh-3.5rem)]">
        {/* Left inner sidebar: filters + preamble cards. Filters stack
            consistently on a single column with uniform height so they
            don't go "weave-y" between the search row, the status/priority
            grid, and the tenant picker. */}
        <div className="w-[380px] shrink-0 border-r flex flex-col bg-muted/20">
          <div className="border-b p-4">
            {/* Search + per-field filters moved to the page header. Left
                pane keeps just the "Inbox" label + unread count so it
                doesn't compete with the preamble list for attention. */}
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Inbox</div>
              {unreadCount > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {unreadCount} unread
                </Badge>
              )}
            </div>
          </div>

          {/* Preamble list */}
          <div className="flex-1 overflow-y-auto">
            {!tickets ? (
              <div className="p-4 text-xs text-muted-foreground">Loading…</div>
            ) : tickets.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">
                No tickets match this filter.
              </div>
            ) : (
              tickets.map((t) => (
                <PreambleCard
                  key={t.id}
                  ticket={t}
                  tenantName={tenants.get(t.tenant_id)?.name ?? `Tenant #${t.tenant_id}`}
                  active={selectedId === t.id}
                  onClick={() => setSelectedId(t.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right pane: detail + thread */}
        <div className="flex-1 overflow-y-auto">
          {selectedId == null ? (
            <EmptyDetail />
          ) : (
            <TicketDetailPane
              ticketId={selectedId}
              tenantName={
                tickets?.find((t) => t.id === selectedId)
                  ? tenants.get(tickets!.find((t) => t.id === selectedId)!.tenant_id)?.name
                  : undefined
              }
              onChanged={reload}
            />
          )}
        </div>
      </div>

      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive shadow">
          {error}
        </div>
      )}

      {showCreate && (
        <CreateTicketDialog
          tenants={Array.from(tenants.values())}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function CreateTicketDialog({
  tenants,
  onClose,
  onCreated,
}: {
  tenants: Tenant[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [tenantId, setTenantId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId) {
      setError("Pick a tenant.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/tickets", {
        method: "POST",
        body: JSON.stringify({
          tenant_id: Number(tenantId),
          subject,
          body,
          priority,
        }),
      });
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* See ComposeDialog (email page) for why we preventDefault on
          the auto-focus events: Tiptap's contenteditable fights radix's
          focus trap and the whole form goes dead. */}
      <DialogContent
        className="sm:max-w-2xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Create ticket</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Tenant</Label>
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a tenant" />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} minLength={3} required />
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <RichEditor
              value={body}
              onChange={setBody}
              placeholder="What's the issue?"
              minHeight={180}
            />
          </div>
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !body.trim() || !tenantId}>
              {busy ? "Creating…" : "Create ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PreambleCard({
  ticket,
  tenantName,
  active,
  onClick,
}: {
  ticket: Ticket;
  tenantName: string;
  active: boolean;
  onClick: () => void;
}) {
  // Format: tenant top-left, time top-right, subject below — matches the
  // user's spec (gmail/outlook style). Unread = bold + dot.
  const t = new Date(ticket.updated_at);
  const isToday = new Date().toDateString() === t.toDateString();
  const timeStr = isToday
    ? t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : t.toLocaleDateString();
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
            ticket.unread ? "font-semibold text-foreground" : "text-muted-foreground"
          }`}
        >
          {tenantName}
        </div>
        <div className="text-[10px] text-muted-foreground shrink-0">{timeStr}</div>
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        {ticket.unread && (
          <span
            className="inline-block size-1.5 rounded-full bg-blue-500"
            aria-label="unread"
          />
        )}
        <div
          className={`truncate text-sm ${
            ticket.unread ? "font-semibold text-foreground" : "text-foreground/80"
          }`}
        >
          {ticket.subject}
        </div>
      </div>
    </button>
  );
}

function EmptyDetail() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
      <div className="text-center max-w-md">
        <Mail className="mx-auto h-10 w-10 opacity-30" />
        <div className="mt-3">Select a ticket from the inbox to read.</div>
      </div>
    </div>
  );
}

function TicketDetailPane({
  ticketId,
  tenantName,
  onChanged,
}: {
  ticketId: number;
  tenantName?: string;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // load() depends only on ticketId. We deliberately do NOT include
  // onChanged in the useCallback deps — its identity changes whenever
  // the parent re-fetches the list, which would re-fire load() in a
  // loop. Reading the latest onChanged via a ref keeps the call fresh
  // without re-triggering the effect.
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);
  const load = useCallback(() => {
    setError(null);
    api<TicketDetail>(`/api/admin/tickets/${ticketId}`)
      .then((d) => {
        setDetail(d);
        onChangedRef.current();
      })
      .catch((e) => setError((e as Error).message));
  }, [ticketId]);
  useEffect(load, [load]);

  async function submitReply(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/tickets/${ticketId}/reply`, {
        method: "POST",
        body: JSON.stringify({ body: reply }),
      });
      setReply("");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(next: TicketStatus) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/tickets/${ticketId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Error first — otherwise a 500 (e.g. naive-vs-aware datetime crash)
  // hides behind "Loading…" forever. User won't know what went wrong.
  if (error && !detail) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Failed to load ticket #{ticketId}: {error}
        </div>
      </div>
    );
  }
  if (!detail) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  const { ticket, messages } = detail;
  const closed = ticket.status === "closed";

  return (
    <div className="p-6 space-y-5">
      {/* Subject + meta block */}
      <div className="border-b pb-4">
        <h2 className="text-xl font-semibold">{ticket.subject}</h2>
        <div className="mt-3 grid grid-cols-2 gap-y-2 gap-x-6 text-xs text-muted-foreground sm:grid-cols-3">
          <Meta label="Tenant" value={tenantName ?? `#${ticket.tenant_id}`} />
          <Meta label="Created by" value={ticket.created_by_email} />
          <Meta label="Status" value={<StatusBadge status={ticket.status} />} />
          <Meta label="Priority" value={<PriorityBadge priority={ticket.priority} />} />
          <Meta label="Updated" value={new Date(ticket.updated_at).toLocaleString()} />
          <Meta label="Created" value={new Date(ticket.created_at).toLocaleString()} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {(["open", "in_progress", "resolved", "closed"] as TicketStatus[]).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={ticket.status === s ? "default" : "outline"}
              disabled={busy || ticket.status === s}
              onClick={() => setStatus(s)}
            >
              {s.replace("_", " ")}
            </Button>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="space-y-3">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-md border p-3 ${
              m.author_kind === "platform" ? "bg-blue-50 border-blue-200" : "bg-card"
            }`}
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div>
                <strong>{m.author_email}</strong>
                {m.author_kind === "platform" && " · Platform"}
              </div>
              <div>{new Date(m.created_at).toLocaleString()}</div>
            </div>
            <div className="mt-2">
              <HtmlBody html={m.body} className="text-sm" />
            </div>
          </div>
        ))}
      </div>

      {/* Reply */}
      {closed ? (
        <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          This ticket is closed. Re-open it to reply.
        </div>
      ) : (
        <form onSubmit={submitReply} className="space-y-2">
          <RichEditor
            value={reply}
            onChange={setReply}
            placeholder="Reply to the tenant…"
            minHeight={140}
          />
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !reply.trim()} size="sm">
              {busy ? "Sending…" : "Send reply"}
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

function StatusBadge({ status }: { status: TicketStatus }) {
  const variant: Record<TicketStatus, "default" | "secondary" | "destructive" | "outline"> = {
    open: "secondary",
    in_progress: "default",
    resolved: "outline",
    closed: "outline",
  };
  return (
    <Badge variant={variant[status]} className="text-[10px]">
      {status.replace("_", " ")}
    </Badge>
  );
}

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const cls =
    priority === "urgent"
      ? "bg-red-100 text-red-800"
      : priority === "high"
        ? "bg-orange-100 text-orange-800"
        : priority === "low"
          ? "bg-slate-100 text-slate-600"
          : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] ${cls}`}>
      {priority}
    </span>
  );
}
