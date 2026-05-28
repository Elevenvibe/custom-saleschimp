"use client";

/**
 * /console/profile — the *user's* own profile, distinct from /settings/
 * organization which manages the org-level identity.
 *
 * Surfaces what `/api/tenant/me` already returns (email, role, org id)
 * plus the existing /settings/organization password endpoint so users
 * have one place to change their password without context-switching to
 * the org page. We deliberately do NOT duplicate the org branding/concur-
 * rency fields here — those stay on the Organization Settings page so
 * there's one canonical edit surface per concept.
 */

import { useEffect, useState } from "react";

import { api } from "@/lib/api";

// Inline rather than exported from lib/api so the rest of the console
// isn't tempted to use it — the shape only makes sense at this surface.
type Me = {
  user: { id: number | null; email: string | null; role: string; org_id: number | null };
  tenant: { id: number; name: string; slug: string };
  members: Array<{
    id: number;
    email: string;
    role: string;
    dograh_user_id: number | null;
    joined_at: string;
  }>;
};

export default function ProfilePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Me>("/api/tenant/me")
      .then(setMe)
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      </div>
    );
  }
  if (!me) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your personal account on {me.tenant.name}.
        </p>
      </div>

      <section className="rounded-lg border bg-card p-5">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <Field label="Email" value={me.user.email ?? "—"} />
          <Field label="Role" value={me.user.role} />
          <Field label="Organization" value={me.tenant.name} />
          <Field
            label="Organization slug"
            value={<code className="font-mono text-xs">{me.tenant.slug}</code>}
          />
        </div>
      </section>

      <ChangePasswordCard />

      <div className="rounded-md border bg-muted/30 p-4 text-xs text-muted-foreground">
        Looking for branding, concurrency caps, or the danger zone? Those live on the{" "}
        <a href="/console/settings/organization" className="underline">
          Organization settings
        </a>{" "}
        page.
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-foreground">{value}</div>
    </div>
  );
}

function ChangePasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (next !== confirm) {
      setError("New password and confirmation don't match.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/tenant/settings/organization/password", {
        method: "POST",
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      setOk("Password updated.");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border bg-card p-5 space-y-3">
      <div className="text-sm font-medium">Change password</div>
      <Field label="Current password" value={null} />
      <input
        type="password"
        className="w-full rounded-md border px-3 py-2 text-sm"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        autoComplete="current-password"
        required
      />
      <Field label="New password" value={null} />
      <input
        type="password"
        className="w-full rounded-md border px-3 py-2 text-sm"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        autoComplete="new-password"
        required
        minLength={8}
      />
      <Field label="Confirm new password" value={null} />
      <input
        type="password"
        className="w-full rounded-md border px-3 py-2 text-sm"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
        required
        minLength={8}
      />
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      {ok && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>
      )}
      <button
        type="submit"
        disabled={busy || !current || !next}
        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
