"use client";

import { useEffect, useState } from "react";
import { api, type PlatformUser } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";

export default function PlatformUsersPage() {
  const [users, setUsers] = useState<PlatformUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  function reload() {
    api<PlatformUser[]>("/api/admin/platform-users").then(setUsers).catch((e) => setError(e.message));
  }
  useEffect(reload, []);

  return (
    <>
      <PageHeader
        title="Platform users"
        description="Super-admins and staff that operate the SalesChimp platform"
        action={<button className="btn-primary" onClick={() => setShowNew(true)}>Add user</button>}
      />
      <div className="p-8">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Last login</th>
                <th className="px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {!users && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>}
              {users?.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">{u.email}</td>
                  <td className="px-4 py-2">
                    <span className={u.role === "super_admin" ? "pill-green" : "pill-gray"}>{u.role}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}</td>
                  <td className="px-4 py-2 text-slate-500">{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showNew && <NewUserDialog onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); reload(); }} />}
    </>
  );
}

function NewUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("super_admin_staff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api("/api/admin/platform-users", { method: "POST", body: JSON.stringify({ email, password, role }) });
      onCreated();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 p-4">
      <form onSubmit={submit} className="card w-full max-w-md card-pad space-y-4">
        <div className="text-lg font-semibold">Add platform user</div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label">Password (≥12 chars)</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} required />
        </div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="super_admin_staff">super_admin_staff</option>
            <option value="super_admin">super_admin</option>
          </select>
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
