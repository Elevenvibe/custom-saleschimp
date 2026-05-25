"use client";

import { useEffect, useState } from "react";
import { api, type InstalledPlugin } from "@/lib/api";
import { PageDescription, PageHeader } from "@/components/PageHeader";

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<InstalledPlugin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<InstalledPlugin[]>("/api/admin/plugins").then(setPlugins).catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <PageHeader title="Plugins" />
      <div className="p-8 space-y-4">
        <PageDescription>
          WordPress-style add-ons that extend Dograh. Drop plugin folders into <code className="font-mono">plugins/</code> and register here.
        </PageDescription>
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Plugin runtime ships in P3 (plugin discovery, backend orchestration, UI slot injection).
          For now this page lists rows in <code className="font-mono">installed_plugins</code> — empty until P3.
        </div>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Plugin id</th>
                <th className="px-4 py-2">Version</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Installed</th>
              </tr>
            </thead>
            <tbody>
              {!plugins && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>}
              {plugins?.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">No plugins installed</td></tr>}
              {plugins?.map((p) => (
                <tr key={p.plugin_id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-mono text-xs">{p.plugin_id}</td>
                  <td className="px-4 py-2">{p.version}</td>
                  <td className="px-4 py-2"><span className={p.status === "active" ? "pill-green" : "pill-gray"}>{p.status}</span></td>
                  <td className="px-4 py-2 text-slate-500">{new Date(p.installed_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
