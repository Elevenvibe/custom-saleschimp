"use client";

import { useEffect, useState } from "react";
import { api, type Package } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";

export default function PackagesPage() {
  const [packages, setPackages] = useState<Package[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Package[]>("/api/admin/packages").then(setPackages).catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <PageHeader
        title="Packages"
        description="Subscription tiers — bundle plugins + limits for tenants"
        action={<button className="btn-primary" disabled title="CRUD lands in next admin batch">New package</button>}
      />
      <div className="p-8">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Slug</th>
                <th className="px-4 py-2">Price</th>
                <th className="px-4 py-2">Plugins</th>
                <th className="px-4 py-2">Limits</th>
              </tr>
            </thead>
            <tbody>
              {!packages && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>}
              {packages?.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  No packages defined yet. Package CRUD ships in the next admin batch.
                </td></tr>
              )}
              {packages?.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium">{p.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{p.slug}</td>
                  <td className="px-4 py-2">${(p.monthly_price_cents / 100).toFixed(2)}/mo</td>
                  <td className="px-4 py-2 font-mono text-xs">{p.plugins.join(", ") || "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{JSON.stringify(p.limits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
