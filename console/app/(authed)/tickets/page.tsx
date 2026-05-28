"use client";

/**
 * /console/tickets — tenant's support inbox.
 *
 * List of tickets opened by the tenant + a "New ticket" form. Clicking
 * a row drills into /console/tickets/[id] (next slice) for the thread
 * view. For now the row expands inline to keep the surface lean.
 *
 * Backed by GET / POST / GET-detail / POST-reply on /api/tenant/tickets.
 */

import { Fragment, useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";

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

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const reload = useCallback(() => {
    setError(null);
    api<Ticket[]>("/api/tenant/tickets")
      .then(setTickets)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(reload, [reload]);

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Support tickets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a ticket and the platform team will get back to you.
          </p>
        </div>
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          onClick={() => setShowNew(true)}
        >
          New ticket
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {!tickets ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : tickets.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          No tickets yet. Click <span className="font-medium">New ticket</span> to open your first.
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Subject</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Priority</th>
                <th className="px-4 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <Fragment key={t.id}>
                  <tr
                    className="border-t cursor-pointer hover:bg-muted/30"
                    onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                  >
                    <td className="px-4 py-2 font-medium">{t.subject}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-2">
                      <PriorityBadge priority={t.priority} />
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(t.updated_at).toLocaleString()}
                    </td>
                  </tr>
                  {expandedId === t.id && (
                    <tr className="border-t bg-muted/10">
                      <td colSpan={4} className="px-4 py-4">
                        <TicketThread ticketId={t.id} onReplied={reload} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewTicketDialog
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: TicketStatus }) {
  const cls =
    status === "open"
      ? "bg-amber-100 text-amber-800"
      : status === "in_progress"
        ? "bg-blue-100 text-blue-800"
        : status === "resolved"
          ? "bg-emerald-100 text-emerald-800"
          : "bg-slate-200 text-slate-700";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs ${cls}`}>
      {status.replace("_", " ")}
    </span>
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
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs ${cls}`}>
      {priority}
    </span>
  );
}

function TicketThread({ ticketId, onReplied }: { ticketId: number; onReplied: () => void }) {
  const [detail, setDetail] = useState<{ ticket: Ticket; messages: TicketMessage[] } | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ ticket: Ticket; messages: TicketMessage[] }>(`/api/tenant/tickets/${ticketId}`)
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
      onReplied();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return <div className="text-sm text-muted-foreground">Loading thread…</div>;
  const closed = detail.ticket.status === "closed";

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {detail.messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-md border p-3 ${
              m.author_kind === "platform" ? "bg-blue-50 border-blue-200" : "bg-card"
            }`}
          >
            <div className="text-xs text-muted-foreground">
              <strong>{m.author_email}</strong> · {new Date(m.created_at).toLocaleString()}
              {m.author_kind === "platform" && " · Platform team"}
            </div>
            <div className="mt-1 text-sm whitespace-pre-wrap">{m.body}</div>
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
            rows={3}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write a reply…"
            required
          />
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}
          <button
            type="submit"
            disabled={busy || !reply.trim()}
            className="rounded-md bg-primary px-4 py-2 text-xs text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send reply"}
          </button>
        </form>
      )}
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
      <form onSubmit={submit} className="w-full max-w-lg rounded-lg bg-card p-5 space-y-3 shadow-lg">
        <div className="text-lg font-semibold">New support ticket</div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Subject</label>
          <input
            className="mt-0.5 w-full rounded-md border px-3 py-2 text-sm"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Short summary"
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
            placeholder="Steps to reproduce, what you expected, what happened…"
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
