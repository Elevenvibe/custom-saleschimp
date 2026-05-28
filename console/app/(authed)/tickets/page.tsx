"use client";

/**
 * /console/tickets — tenant's support inbox (Gmail-style).
 *
 * Same two-pane layout as the super-admin /tickets page:
 *   - Left: filters + preamble cards (the user's own tickets)
 *   - Right: subject + meta + thread + reply
 *
 * "New ticket" lives as a button at the top of the left pane so the
 * tenant can open one without leaving the inbox.
 *
 * Backed by /api/tenant/tickets — list / open / detail / reply.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { Inbox, Search } from "lucide-react";

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
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<TicketStatus | "all">("all");

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [qInput]);

  const reload = useCallback(() => {
    setError(null);
    const sp = new URLSearchParams();
    if (status !== "all") sp.set("status", status);
    const url = `/api/tenant/tickets${sp.toString() ? "?" + sp.toString() : ""}`;
    api<Ticket[]>(url)
      .then(setTickets)
      .catch((e) => setError((e as Error).message));
  }, [status]);
  useEffect(reload, [reload]);

  const filtered = useMemo(() => {
    if (!tickets) return [];
    return q
      ? tickets.filter((t) => t.subject.toLowerCase().includes(q))
      : tickets;
  }, [tickets, q]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Left inner sidebar */}
      <div className="w-[340px] shrink-0 border-r bg-muted/20 flex flex-col">
        <div className="border-b p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">My tickets</div>
            <button
              type="button"
              onClick={() => setShowNew(true)}
              className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground"
            >
              New ticket
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              className="w-full rounded-md border bg-background pl-7 pr-2 py-1.5 text-xs"
              placeholder="Search subject…"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
          </div>
          <select
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
            value={status}
            onChange={(e) => setStatus(e.target.value as TicketStatus | "all")}
          >
            <option value="all">All status</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div className="flex-1 overflow-y-auto">
          {!tickets ? (
            <div className="p-4 text-xs text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">
              No tickets {q ? "match this search" : "yet"}.
            </div>
          ) : (
            filtered.map((t) => (
              <PreambleCard
                key={t.id}
                ticket={t}
                active={selectedId === t.id}
                onClick={() => setSelectedId(t.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right pane */}
      <div className="flex-1 overflow-y-auto">
        {selectedId == null ? (
          <EmptyDetail />
        ) : (
          <TicketDetailPane ticketId={selectedId} onChanged={reload} />
        )}
      </div>

      {showNew && (
        <NewTicketDialog
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            reload();
          }}
        />
      )}

      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive shadow">
          {error}
        </div>
      )}
    </div>
  );
}

function PreambleCard({
  ticket,
  active,
  onClick,
}: {
  ticket: Ticket;
  active: boolean;
  onClick: () => void;
}) {
  const t = new Date(ticket.updated_at);
  const isToday = new Date().toDateString() === t.toDateString();
  const timeStr = isToday
    ? t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : t.toLocaleDateString();
  // Tenant-side: any platform reply marks the conversation as having
  // new content — surfaced by the status moving to in_progress + the
  // most-recent message author. Visual cue is bold text.
  const hasReply = ticket.status === "in_progress" || ticket.status === "resolved";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full border-b px-3 py-2 text-left text-xs transition hover:bg-muted/40 ${
        active ? "bg-primary/5" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className={hasReply ? "font-semibold text-foreground" : "text-muted-foreground"}>
          {ticket.status.replace("_", " ")}
        </div>
        <div className="text-[10px] text-muted-foreground shrink-0">{timeStr}</div>
      </div>
      <div className="mt-0.5 truncate text-sm font-medium text-foreground">
        {ticket.subject}
      </div>
    </button>
  );
}

function EmptyDetail() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
      <div className="text-center max-w-md">
        <Inbox className="mx-auto h-10 w-10 opacity-30" />
        <div className="mt-3">Select a ticket to read, or open a new one.</div>
      </div>
    </div>
  );
}

function TicketDetailPane({
  ticketId,
  onChanged,
}: {
  ticketId: number;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<TicketDetail>(`/api/tenant/tickets/${ticketId}`)
      .then(setDetail)
      .catch((e) => setError((e as Error).message));
  }, [ticketId]);
  useEffect(load, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/tenant/tickets/${ticketId}/reply`, {
        method: "POST",
        body: JSON.stringify({ body: reply }),
      });
      setReply("");
      load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  const { ticket, messages } = detail;
  const closed = ticket.status === "closed";

  return (
    <div className="p-6 space-y-5">
      <div className="border-b pb-4">
        <h2 className="text-xl font-semibold">{ticket.subject}</h2>
        <div className="mt-3 grid grid-cols-2 gap-y-2 gap-x-6 text-xs text-muted-foreground sm:grid-cols-3">
          <Meta label="Status" value={ticket.status.replace("_", " ")} />
          <Meta label="Priority" value={ticket.priority} />
          <Meta label="Updated" value={new Date(ticket.updated_at).toLocaleString()} />
          <Meta label="Created" value={new Date(ticket.created_at).toLocaleString()} />
          <Meta label="Created by" value={ticket.created_by_email} />
        </div>
      </div>

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
            <div className="mt-2 text-sm whitespace-pre-wrap">{m.body}</div>
          </div>
        ))}
      </div>

      {closed ? (
        <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          This ticket is closed. Open a new ticket if you need more help.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-2">
          <textarea
            className="w-full rounded-md border px-3 py-2 text-sm"
            rows={4}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write a reply…"
            required
          />
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy || !reply.trim()}
              className="rounded-md bg-primary px-4 py-2 text-xs text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send reply"}
            </button>
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

function NewTicketDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/tenant/tickets", {
        method: "POST",
        body: JSON.stringify({ subject, body, priority }),
      });
      onCreated();
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
        className="w-full max-w-lg rounded-lg bg-card p-5 space-y-3 shadow-lg"
      >
        <div className="text-lg font-semibold">New support ticket</div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Subject</label>
          <input
            className="mt-0.5 w-full rounded-md border px-3 py-2 text-sm"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            minLength={3}
            maxLength={200}
            required
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Priority</label>
          <select
            className="mt-0.5 w-full rounded-md border px-3 py-2 text-sm"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TicketPriority)}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Description</label>
          <textarea
            className="mt-0.5 w-full rounded-md border px-3 py-2 text-sm"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
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
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Creating…" : "Open ticket"}
          </button>
        </div>
      </form>
    </div>
  );
}
