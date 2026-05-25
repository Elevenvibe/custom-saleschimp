"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type Tenant } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";

type TenantsRes = { total: number; items: Tenant[] };

export default function TenantsPage() {
  const [data, setData] = useState<TenantsRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  function reload() {
    api<TenantsRes>("/api/admin/tenants").then(setData).catch((e) => setError(e.message));
  }
  useEffect(reload, []);

  return (
    <>
      <PageHeader
        title="Tenants"
        description="Customer organizations on the platform"
        action={
          <button className="btn-primary" onClick={() => setShowNew(true)}>
            New tenant
          </button>
        }
      />
      <div className="p-8">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
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
              {!data && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>}
              {data?.items.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No tenants yet — create the first.</td></tr>
              )}
              {data?.items.map((t) => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2"><Link href={`/tenants/${t.id}`} className="text-brand-600 hover:underline">{t.name}</Link></td>
                  <td className="px-4 py-2 font-mono text-xs">{t.slug}</td>
                  <td className="px-4 py-2 text-slate-600">{t.owner_email}</td>
                  <td className="px-4 py-2 text-slate-600">{t.dograh_org_id ?? "—"}</td>
                  <td className="px-4 py-2"><StatusPill status={t.status} /></td>
                  <td className="px-4 py-2 text-slate-500">{new Date(t.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showNew && <NewTenantDialog onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); reload(); }} />}
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "active" ? "pill-green" :
    status === "suspended" || status === "cancelled" ? "pill-red" :
    "pill-amber";
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
    setBusy(true); setError(null);
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
          <input className="input" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} required />
        </div>
        <div>
          <label className="label">Owner email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
        </div>
      </form>
    </div>
  );
}
