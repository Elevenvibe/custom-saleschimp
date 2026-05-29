"use client";

/**
 * /console/suspended — full-screen suspension takeover.
 *
 * Lives in the (public) group so there's no AppShell sidebar — a suspended
 * org gets a focused, branded "account suspended" screen, not the normal
 * chrome. It only calls allowlisted endpoints (suspension-info + the
 * suspension ticket), so it loads fine while the rest of /api/tenant/* is
 * blocked by the gateway middleware.
 *
 * If the org turns out NOT to be suspended (e.g. just unsuspended), it
 * sends the user back into the app.
 */

import { useCallback, useEffect, useState } from "react";

import { api, getToken } from "@/lib/api";
import { ShieldAlert, Send, Loader2 } from "lucide-react";

type SuspensionInfo = {
  status: string;
  suspended: boolean;
  subject: string | null;
  reason: string | null;
  suspended_at: string | null;
  ticket_id: number | null;
  org_name: string;
  logo_url: string | null;
};

type TicketMessage = {
  id: number;
  author_kind: "tenant" | "platform";
  author_email: string;
  body: string;
  created_at: string;
};
type TicketDetail = {
  ticket: { id: number; subject: string; status: string };
  messages: TicketMessage[];
};

const RESOLUTION_STEPS = [
  "Read the suspension reason and category below.",
  "Reply to the support ticket with any questions or required information.",
  "Resolve the underlying issue (e.g. settle an overdue invoice).",
  "Our team will review and restore access — you'll be notified by email.",
];

export default function SuspendedPage() {
  const [info, setInfo] = useState<SuspensionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      setError("Please sign in to view your account status.");
      return;
    }
    api<SuspensionInfo>("/api/tenant/suspension-info")
      .then((d) => {
        setInfo(d);
        // No longer suspended → back into the app.
        if (!d.suspended && typeof window !== "undefined") {
          window.location.href = "/console";
        }
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-4">
        {/* Branding */}
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          {info?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={info.logo_url} alt={info.org_name} className="h-7 w-auto object-contain" />
          ) : null}
          <span>{info?.org_name ?? "Your organization"}</span>
        </div>

        {/* Banner */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <ShieldAlert className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold">Account suspended</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Access to your workspace has been temporarily restricted.
              </p>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}

          {info && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Category" value={info.subject ?? "—"} />
              <Field
                label="Date suspended"
                value={info.suspended_at ? new Date(info.suspended_at).toLocaleString() : "—"}
              />
              <div className="sm:col-span-2">
                <Field label="Reason" value={info.reason ?? "No reason provided."} />
              </div>
            </div>
          )}

          {/* Resolution steps */}
          <div className="mt-6">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              How to restore access
            </div>
            <ol className="mt-2 space-y-1.5 text-sm">
              {RESOLUTION_STEPS.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary">
                    {i + 1}
                  </span>
                  <span className="text-muted-foreground">{s}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Support ticket thread */}
        {info?.ticket_id ? (
          <SuspensionTicket ticketId={info.ticket_id} />
        ) : info ? (
          <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
            No support ticket is linked to this suspension. Please contact support directly.
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words text-sm text-foreground">{value}</div>
    </div>
  );
}

function SuspensionTicket({ ticketId }: { ticketId: number }) {
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

  async function send(e: React.FormEvent) {
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Loading conversation…</div>
    );
  }
  const closed = detail.ticket.status === "closed";

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
      <div className="text-sm font-medium">Support conversation</div>
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {detail.messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-md border p-3 ${m.author_kind === "platform" ? "bg-blue-50 border-blue-200" : "bg-muted/30"}`}
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{m.author_kind === "platform" ? "Support team" : m.author_email}</span>
              <span>{new Date(m.created_at).toLocaleString()}</span>
            </div>
            <div className="mt-1 whitespace-pre-wrap break-words text-sm">{m.body}</div>
          </div>
        ))}
      </div>
      {closed ? (
        <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          This ticket is closed.
        </div>
      ) : (
        <form onSubmit={send} className="space-y-2">
          <textarea
            className="w-full rounded-md border px-3 py-2 text-sm"
            rows={4}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Reply to support…"
            required
          />
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy || !reply.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              <Send className="size-3.5" /> {busy ? "Sending…" : "Send reply"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
