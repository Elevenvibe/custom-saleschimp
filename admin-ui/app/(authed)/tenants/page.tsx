"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, type Tenant } from "@/lib/api";
import { PageDescription, PageHeader } from "@/components/PageHeader";

type TenantsRes = { total: number; items: Tenant[] };

type StatusFilter = "" | "active" | "suspended" | "cancelled" | "pending_verification" | "inactive";

// Filter state kept in one object so reload() reads a single source of
// truth. URL params would be nicer (back-button friendly) but the rest of
// the admin-ui doesn't bother with that, so keep it consistent.
type Filters = {
  q: string;
  status: StatusFilter;
  created_from: string;
  created_to: string;
};

const EMPTY_FILTERS: Filters = {
  q: "",
  status: "",
  created_from: "",
  created_to: "",
};

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "cancelled", label: "Cancelled" },
  { value: "pending_verification", label: "Pending verification" },
  // 'inactive' is a UI-only union of suspended+cancelled — gateway translates
  // it server-side. Handy chip for the common "everything not active" case.
  { value: "inactive", label: "Inactive (suspended + cancelled)" },
];

export default function TenantsPage() {
  const [data, setData] = useState<TenantsRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // Debounced search input — we type into `q` but defer the actual fetch
  // by 300ms so we're not hitting the gateway on every keystroke.
  const [qInput, setQInput] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, q: qInput.trim() })), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    if (filters.q) sp.set("q", filters.q);
    if (filters.status) sp.set("status", filters.status);
    if (filters.created_from) sp.set("created_from", filters.created_from);
    if (filters.created_to) sp.set("created_to", filters.created_to);
    const s = sp.toString();
    return s ? `?${s}` : "";
  }, [filters]);

  const reload = useCallback(() => {
    setError(null);
    api<TenantsRes>(`/api/admin/tenants${qs}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [qs]);

  useEffect(() => {
    reload();
  }, [reload]);

  const hasFilters =
    filters.q !== "" ||
    filters.status !== "" ||
    filters.created_from !== "" ||
    filters.created_to !== "";

  function clearAll() {
    setQInput("");
    setFilters(EMPTY_FILTERS);
  }

  return (
    <>
      <PageHeader
        title="Tenants"
        action={
          <button className="btn-primary" onClick={() => setShowNew(true)}>
            New tenant
          </button>
        }
      />
      <div className="p-8 space-y-4">
        <PageDescription>Customer organizations on the platform.</PageDescription>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {/* Filter bar — wraps so it stays usable on narrow screens. The
            inputs are intentionally compact; clicking "Clear" resets all of
            them without a separate confirm step. */}
        <div className="card card-pad">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="label">Search</label>
              <input
                className="input"
                placeholder="Name, slug, or owner email…"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
            </div>
            <div className="min-w-[180px]">
              <label className="label">Status</label>
              <select
                className="input"
                value={filters.status}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, status: e.target.value as StatusFilter }))
                }
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Created from</label>
              <input
                type="date"
                className="input"
                value={filters.created_from}
                onChange={(e) => setFilters((f) => ({ ...f, created_from: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Created to</label>
              <input
                type="date"
                className="input"
                value={filters.created_to}
                onChange={(e) => setFilters((f) => ({ ...f, created_to: e.target.value }))}
              />
            </div>
            {hasFilters && (
              <button type="button" className="btn-secondary" onClick={clearAll}>
                Clear
              </button>
            )}
          </div>
          {data && (
            <div className="mt-3 text-xs text-slate-500">
              {data.total === 0
                ? "No matches"
                : `${data.total} ${data.total === 1 ? "tenant" : "tenants"}${
                    hasFilters ? " match the filters" : ""
                  }`}
            </div>
          )}
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Slug</th>
                <th className="px-4 py-2">Owner</th>
                <th className="px-4 py-2">Dograh org</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {!data && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              )}
              {data?.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    {hasFilters
                      ? "No tenants match the current filters."
                      : "No tenants yet — create the first."}
                  </td>
                </tr>
              )}
              {data?.items.map((t) => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link href={`/tenants/${t.id}`} className="text-brand-600 hover:underline">
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{t.slug}</td>
                  <td className="px-4 py-2 text-slate-600">{t.owner_email}</td>
                  <td className="px-4 py-2 text-slate-600">{t.dograh_org_id ?? "—"}</td>
                  <td className="px-4 py-2">
                    <StatusPill status={t.status} />
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {new Date(t.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showNew && (
        <NewTenantDialog
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "active"
      ? "pill-green"
      : status === "suspended" || status === "cancelled"
        ? "pill-red"
        : "pill-amber";
  return <span className={cls}>{status}</span>;
}

function NewTenantDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify({ name, slug, owner_email: email }),
      });
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 p-4">
      <form onSubmit={submit} className="card w-full max-w-md card-pad space-y-4">
        <div className="text-lg font-semibold">New tenant</div>
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label">Slug</label>
          <input
            className="input"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            required
          />
        </div>
        <div>
          <label className="label">Owner email</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
