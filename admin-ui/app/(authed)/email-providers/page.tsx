"use client";

import { useEffect, useState } from "react";
import { api, type EmailProvider } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";

export default function EmailProvidersPage() {
  const [items, setItems] = useState<EmailProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<EmailProvider[]>("/api/admin/email-providers").then(setItems).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <PageHeader
        title="Email providers"
        description="Platform default + per-tenant overrides. Resend, SES, Postmark, or generic SMTP."
        action={<button className="btn-primary" disabled title="Per-provider CRUD lands in next admin batch">Configure provider</button>}
      />
      <div className="p-8 space-y-4">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          List view only for now. Per-provider config forms (Resend / SES / Postmark / SMTP) + test-send
          land in the next admin batch. Secrets are stored encrypted with the platform Fernet key.
        </div>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Scope</th>
                <th className="px-4 py-2">Provider</th>
                <th className="px-4 py-2">From</th>
                <th className="px-4 py-2">Active</th>
                <th className="px-4 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {!items && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>}
              {items?.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No providers configured — emails will fail to send.</td></tr>}
              {items?.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">{c.scope_kind === "platform" ? "platform" : `tenant #${c.scope_id}`}</td>
                  <td className="px-4 py-2 font-mono text-xs">{c.provider}</td>
                  <td className="px-4 py-2 text-slate-600">{c.from_name ? `${c.from_name} <${c.from_email}>` : c.from_email}</td>
                  <td className="px-4 py-2"><span className={c.is_active ? "pill-green" : "pill-gray"}>{c.is_active ? "yes" : "no"}</span></td>
                  <td className="px-4 py-2 text-slate-500">{new Date(c.updated_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
