"use client";

import { useEffect, useState } from "react";
import { api, type AuditRow } from "@/lib/api";
import { PageDescription, PageHeader } from "@/components/PageHeader";

type AuditRes = { total: number; items: AuditRow[] };

export default function AuditPage() {
  const [data, setData] = useState<AuditRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterAction, setFilterAction] = useState("");
  const [filterActorKind, setFilterActorKind] = useState("");

  function load() {
    const qs = new URLSearchParams({ limit: "100" });
    if (filterAction) qs.set("action", filterAction);
    if (filterActorKind) qs.set("actor_kind", filterActorKind);
    api<AuditRes>(`/api/admin/audit?${qs}`).then(setData).catch((e) => setError(e.message));
  }
  useEffect(load, [filterAction, filterActorKind]);

  return (
    <>
      <PageHeader title="Audit log" />
      <div className="p-8 space-y-4">
        <PageDescription>All platform actions, newest first.</PageDescription>
        <div className="flex gap-3">
          <select className="input max-w-xs" value={filterActorKind} onChange={(e) => setFilterActorKind(e.target.value)}>
            <option value="">All actor kinds</option>
            <option value="platform">platform</option>
            <option value="tenant">tenant</option>
            <option value="system">system</option>
          </select>
          <input
            className="input max-w-xs"
            placeholder="action prefix, e.g. auth."
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
          />
        </div>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Actor</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Target</th>
                <th className="px-4 py-2">IP</th>
              </tr>
            </thead>
            <tbody>
              {!data && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>}
              {data?.items.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No rows</td></tr>}
              {data?.items.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-500">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2"><span className="pill-gray">{r.actor_kind}</span>{r.actor_user_id ? ` #${r.actor_user_id}` : ""}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-4 py-2 text-slate-500">{r.target_kind ? `${r.target_kind}#${r.target_id}` : "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{r.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && <div className="text-xs text-slate-500">Showing {data.items.length} of {data.total}</div>}
      </div>
    </>
  );
}
