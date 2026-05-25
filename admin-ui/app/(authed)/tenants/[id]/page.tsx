"use client";

import { use, useEffect, useState } from "react";
import { api, type AdminInvitesRes, type AdminInvite, type Tenant } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

type TenantDetail = {
  tenant: Tenant;
  members: { id: number; email: string; role: string; dograh_user_id: number | null; joined_at: string }[];
};

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<TenantDetail | null>(null);
  const [invites, setInvites] = useState<AdminInvitesRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    api<TenantDetail>(`/api/admin/tenants/${id}`).then(setData).catch((e) => setError(e.message));
    api<AdminInvitesRes>(`/api/admin/invites?tenant_id=${id}&state=all&limit=100`)
      .then(setInvites)
      .catch(() => {});
  }
  useEffect(reload, [id]);

  async function revokeInvite(inv: AdminInvite) {
    if (!confirm(`Revoke invite for ${inv.email}?`)) return;
    try {
      await api(`/api/admin/invites/${inv.id}`, { method: "DELETE" });
      reload();
    } catch (e) { setError((e as Error).message); }
  }

  async function setStatus(next: string) {
    setBusy(true);
    try {
      await api(`/api/admin/tenants/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: next }) });
      reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (error) return <div className="p-8"><div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div></div>;
  if (!data) return <div className="p-8 text-sm text-slate-500">Loading…</div>;

  const t = data.tenant;
  return (
    <>
      <PageHeader
        title={t.name}
        description={`Tenant #${t.id} · ${t.slug}`}
        action={
          <div className="flex gap-2">
            {t.status !== "active" && <button className="btn-secondary" disabled={busy} onClick={() => setStatus("active")}>Activate</button>}
            {t.status !== "suspended" && <button className="btn-secondary" disabled={busy} onClick={() => setStatus("suspended")}>Suspend</button>}
          </div>
        }
      />
      <div className="p-8 space-y-6">
        <section className="card card-pad">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Field label="Owner email" value={t.owner_email} />
            <Field label="Status" value={t.status} />
            <Field label="Dograh org id" value={t.dograh_org_id ?? "—"} />
            <Field label="Created" value={new Date(t.created_at).toLocaleString()} />
          </div>
        </section>
        <section>
          <div className="mb-3 text-sm font-medium text-slate-700">Members</div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Dograh user</th>
                  <th className="px-4 py-2">Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.members.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">No members</td></tr>}
                {data.members.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">{m.email}</td>
                    <td className="px-4 py-2"><span className="pill-gray">{m.role}</span></td>
                    <td className="px-4 py-2 text-slate-500">{m.dograh_user_id ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-500">{new Date(m.joined_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="mb-3 text-sm font-medium text-slate-700">Invites</div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">State</th>
                  <th className="px-4 py-2">Expires</th>
                  <th className="px-4 py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {!invites && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>}
                {invites?.items.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No invites yet.</td></tr>
                )}
                {invites?.items.map((i) => (
                  <tr key={i.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">{i.email}</td>
                    <td className="px-4 py-2"><Badge variant="secondary">{i.role}</Badge></td>
                    <td className="px-4 py-2">
                      <Badge variant={i.state === "accepted" ? "default" : i.state === "expired" ? "destructive" : "secondary"}>
                        {i.state}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-slate-500">{new Date(i.expires_at).toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">
                      {i.state !== "accepted" && (
                        <Button size="sm" variant="ghost" onClick={() => revokeInvite(i)} title="Revoke">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-slate-900">{value}</div>
    </div>
  );
}
