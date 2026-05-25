"use client";

import { useEffect, useState } from "react";
import { api, type Dashboard } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Dashboard>("/api/admin/dashboard").then(setData).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <PageHeader title="Dashboard" description="Platform-wide snapshot" />
      <div className="p-8 space-y-6">
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        {!data && !error && <div className="text-sm text-slate-500">Loading…</div>}
        {data && (
          <>
            <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Tenants" value={data.counts.tenants} />
              <Stat label="Platform users" value={data.counts.platform_users} />
              <Stat label="Packages" value={data.counts.packages} />
              <Stat label="Installed plugins" value={data.counts.installed_plugins} />
            </section>
            <section>
              <div className="mb-3 text-sm font-medium text-slate-700">Recent activity</div>
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
                    {data.recent_audit.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No activity yet</td></tr>
                    )}
                    {data.recent_audit.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 text-slate-500">{new Date(r.created_at).toLocaleString()}</td>
                        <td className="px-4 py-2"><span className="pill-gray">{r.actor_kind}</span></td>
                        <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                        <td className="px-4 py-2 text-slate-500">{r.target_kind ? `${r.target_kind}#${r.target_id}` : "—"}</td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-500">{r.ip ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card card-pad">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}
