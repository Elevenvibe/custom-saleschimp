"use client";

/**
 * /console/members — list teammates on the tenant's org + send/revoke invites.
 *
 * Reads members from /api/tenant/me (the existing customer surface)
 * and invites from /api/tenant/invites. Org admins get the invite form
 * + revoke buttons; org members get a read-only view.
 *
 * Role change + remove-member are queued in P3.4 — the gateway needs
 * tenant-side PATCH/DELETE on members first (today only super-admin can
 * touch the membership table directly).
 */

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";

type Member = {
  id: number;
  email: string;
  role: string;
  dograh_user_id: number | null;
  joined_at: string;
};

type Me = {
  user: { role: string };
  tenant: { id: number; name: string; slug: string };
  members: Member[];
};

type Invite = {
  id: number;
  email: string;
  role: string;
  state: "pending" | "accepted" | "expired";
  expires_at: string;
  created_at: string;
};

export default function MembersPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Invite is now an explicit user action via the "Invite team" button —
  // the always-visible form took up too much space on the centered layout.
  const [showInvite, setShowInvite] = useState(false);

  const reload = useCallback(() => {
    setError(null);
    api<Me>("/api/tenant/me").then(setMe).catch((e) => setError(e.message));
    api<Invite[]>("/api/tenant/invites?state=pending").then(setInvites).catch(() => {});
  }, []);
  useEffect(reload, [reload]);

  const isAdmin = me?.user.role === "org_admin" || me?.user.role === "owner";

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      </div>
    );
  }
  if (!me) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Members</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            People with access to {me.tenant.name}.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            onClick={() => setShowInvite(true)}
          >
            Invite team
          </button>
        )}
      </div>

      <section>
        <div className="mb-2 text-sm font-medium">
          Active ({me.members.length})
        </div>
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-center text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Joined</th>
              </tr>
            </thead>
            <tbody className="text-center">
              {me.members.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-4 py-2">{m.email}</td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs">
                      {m.role}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(m.joined_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {invites.length > 0 && (
        <section>
          <div className="mb-2 text-sm font-medium">
            Pending invites ({invites.length})
          </div>
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Expires</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id} className="border-t">
                    <td className="px-4 py-2">{i.email}</td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs">
                        {i.role}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(i.expires_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {isAdmin && (
                        <button
                          type="button"
                          className="text-xs text-destructive hover:underline"
                          onClick={async () => {
                            if (!confirm(`Revoke invite for ${i.email}?`)) return;
                            try {
                              await api(`/api/tenant/invites/${i.id}`, { method: "DELETE" });
                              reload();
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!isAdmin && (
        <div className="rounded-md border bg-muted/30 p-4 text-xs text-muted-foreground">
          Only org admins can invite or remove members. Ask an admin if you
          need someone added.
        </div>
      )}

      {showInvite && (
        <InviteDialog
          onClose={() => setShowInvite(false)}
          onInvited={() => {
            setShowInvite(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function InviteDialog({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("org_member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/tenant/invites", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setEmail("");
      onInvited();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-lg bg-card p-5 space-y-3 shadow-lg"
      >
        <div className="text-lg font-semibold">Invite a teammate</div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Email</label>
          <input
            type="email"
            className="mt-0.5 w-full rounded-md border px-3 py-2 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            required
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Role</label>
          <select
            className="mt-0.5 w-full rounded-md border px-3 py-2 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="org_member">Member</option>
            <option value="org_admin">Admin</option>
          </select>
        </div>
        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !email}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send invite"}
          </button>
        </div>
      </form>
    </div>
  );
}
