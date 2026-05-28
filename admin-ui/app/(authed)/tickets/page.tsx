"use client";

/**
 * /tickets — super-admin cross-tenant ticket inbox.
 *
 * Companion to the per-tenant Tickets tab on /tenants/[id]/page.tsx:
 * this view is "all tickets across all tenants" so support staff can
 * triage by status / priority / tenant without traversing a tenant
 * detail page first.
 *
 * The shadcn sidebar-09 layout the user asked for is queued for a
 * follow-up — installing CLI components inside the docker build
 * pipeline is a separate slice. Today this uses the same AppShell as
 * every other admin page; the sidebar entry is already in place so the
 * link lights up.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { api, type Tenant } from "@/lib/api";
import { PageDescription, PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";

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

const STATUS_OPTIONS: Array<{ value: TicketStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const PRIORITY_OPTIONS: Array<{ value: TicketPriority | ""; label: string }> = [
  { value: "", label: "All priorities" },
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<TicketStatus | "">("");
  const [priority, setPriority] = useState<TicketPriority | "">("");
  const [tenantId, setTenantId] = useState<string>("");

  // Debounce the search input so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // Tenants for the filter dropdown — small list so we just fetch all of
  // them once instead of building a typeahead.
  useEffect(() => {
    api<{ items: Tenant[] }>("/api/admin/tenants?limit=200")
      .then((r) => setTenants(r.items))
      .catch(() => {});
  }, []);

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status) sp.set("status", status);
    if (priority) sp.set("priority", priority);
    if (tenantId) sp.set("tenant_id", tenantId);
    const s = sp.toString();
    return s ? `?${s}` : "";
  }, [q, status, priority, tenantId]);

  const reload = useCallback(() => {
    setError(null);
    api<Ticket[]>(`/api/admin/tickets${qs}`)
      .then(setTickets)
      .catch((e) => setError((e as Error).message));
  }, [qs]);
  useEffect(reload, [reload]);

  const tenantNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of tenants) m.set(t.id, t.name);
    return m;
  }, [tenants]);

  const hasFilters = q !== "" || status !== "" || priority !== "" || tenantId !== "";
  function clearAll() {
    setQInput("");
    setQ("");
    setStatus("");
    setPriority("");
    setTenantId("");
  }

  return (
    <>
      <PageHeader title="Tickets" />
      <div className="p-8 space-y-4">
        <PageDescription>
          All support tickets across all tenants. Click a row to open the
          thread.
        </PageDescription>

        <div className="card card-pad">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="label">Search</label>
              <input
                className="input"
                placeholder="Subject or creator email…"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
            </div>
            <div className="min-w-[160px]">
              <label className="label">Tenant</label>
              <select
                className="input"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
              >
                <option value="">All tenants</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[160px]">
              <label className="label">Status</label>
              <select
                className="input"
                value={status}
                onChange={(e) => setStatus(e.target.value as TicketStatus | "")}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[160px]">
              <label className="label">Priority</label>
              <select
                className="input"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority | "")}
              >
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {hasFilters && (
              <button type="button" className="btn-secondary" onClick={clearAll}>
                Clear
              </button>
            )}
          </div>
          {tickets && (
            <div className="mt-3 text-xs text-muted-foreground">
              {tickets.length === 0
                ? "No tickets match the current filters"
                : `${tickets.length} ${tickets.length === 1 ? "ticket" : "tickets"}`}
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Subject</th>
                <th className="px-4 py-2">Tenant</th>
                <th className="px-4 py-2">Created by</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Priority</th>
                <th className="px-4 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {!tickets && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              )}
              {tickets?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    No tickets.
                  </td>
                </tr>
              )}
              {tickets?.map((t) => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link
                      href={`/tenants/${t.tenant_id}?tab=tickets&ticket=${t.id}`}
                      className="text-brand-600 hover:underline"
                    >
                      {t.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/tenants/${t.tenant_id}`}
                      className="text-slate-700 hover:underline"
                    >
                      {tenantNameById.get(t.tenant_id) ?? `#${t.tenant_id}`}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{t.created_by_email}</td>
                  <td className="px-4 py-2">
                    <Badge variant={statusVariant(t.status)}>{t.status.replace("_", " ")}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={priorityVariant(t.priority)}>{t.priority}</Badge>
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {new Date(t.updated_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function statusVariant(s: TicketStatus): "default" | "secondary" | "destructive" {
  if (s === "open") return "default";
  if (s === "closed") return "secondary";
  return "secondary";
}
function priorityVariant(p: TicketPriority): "default" | "secondary" | "destructive" {
  if (p === "urgent") return "destructive";
  if (p === "high") return "default";
  return "secondary";
}
