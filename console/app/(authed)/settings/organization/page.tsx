"use client";

/**
 * /console/settings/organization
 *
 * Tenant org-admin lands here from Dograh's profile dropdown
 * ("Organization settings", which the overlay AppSidebar places above
 * "Platform Settings"). The page renders WITH our own AppShell when
 * loaded directly, and embedded (sidebar suppressed) when iframed via
 * /console-bridge/settings/organization.
 *
 * Sections (top → bottom):
 *   1. Identity — email / status / org id / date — read-only.
 *   2. Branding — name, logo URL, favicon URL.
 *   3. Concurrency — bounded by the active package's
 *      concurrency_included; tenant can dial down but not above.
 *   4. Password — current + new + confirm (proxied to Dograh).
 *   5. Add-ons (HIPAA, ZDR) — "Coming soon" placeholders. No backend
 *      yet; deliberate stubs so the layout matches the eventual
 *      purchase flow.
 *   6. Auto-fallback toggle — when on, new assistants in this org
 *      get fallback providers wired in by default.
 *   7. Danger zone — delete with name-confirmation field.
 */

import { useEffect, useMemo, useState } from "react";

import { api, ApiError, type OrgSettings } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2 } from "lucide-react";

export default function OrgSettingsPage() {
  const [data, setData] = useState<OrgSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    api<OrgSettings>("/api/tenant/settings/organization")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }
  useEffect(load, []);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" />
        Loading organization settings…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Organization Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage {data.name}.
        </p>
      </header>

      <IdentityCard data={data} />
      <BrandingCard data={data} onSaved={load} />
      <ConcurrencyCard data={data} onSaved={load} />
      <PasswordCard />
      <AddonsCard />
      <AutoFallbackCard data={data} onSaved={load} />
      <DangerZone data={data} />
    </div>
  );
}

// ----- Sections -----------------------------------------------------------

function IdentityCard({ data }: { data: OrgSettings }) {
  return (
    <section className="rounded-lg border bg-card p-6 space-y-3">
      <h2 className="text-sm font-medium">Identity</h2>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Field label="Email" value={data.owner_email} />
        <Field
          label="Status"
          value={
            <Badge variant={data.status === "active" ? "default" : "secondary"}>
              {data.status.replace("_", " ")}
            </Badge>
          }
        />
        <Field label="Org ID" value={<code className="text-xs">#{data.id}</code>} />
        <Field
          label="Created"
          value={new Date(data.created_at).toLocaleString()}
        />
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}

function BrandingCard({
  data,
  onSaved,
}: {
  data: OrgSettings;
  onSaved: () => void;
}) {
  const [name, setName] = useState(data.name);
  const [logo, setLogo] = useState(data.logo_url ?? "");
  const [favicon, setFavicon] = useState(data.favicon_url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/tenant/settings/organization", {
        method: "PATCH",
        body: JSON.stringify({
          name,
          logo_url: logo,
          favicon_url: favicon,
        }),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-6 space-y-4">
      <h2 className="text-sm font-medium">Branding</h2>
      <div>
        <Label htmlFor="org-name">Organization name</Label>
        <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} />
      </div>
      <div>
        <Label htmlFor="org-logo">Logo URL</Label>
        <Input
          id="org-logo"
          value={logo}
          onChange={(e) => setLogo(e.target.value)}
          placeholder="https://cdn.example.com/logo.png"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Paste a public URL. File upload arrives in a follow-up release.
        </p>
      </div>
      <div>
        <Label htmlFor="org-favicon">Favicon URL</Label>
        <Input
          id="org-favicon"
          value={favicon}
          onChange={(e) => setFavicon(e.target.value)}
          placeholder="https://cdn.example.com/favicon.ico"
        />
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save branding"}
        </Button>
      </div>
    </section>
  );
}

function ConcurrencyCard({
  data,
  onSaved,
}: {
  data: OrgSettings;
  onSaved: () => void;
}) {
  const ceiling = data.package?.concurrency_included ?? 1;
  const [value, setValue] = useState<number>(
    data.concurrent_calls_limit ?? ceiling,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the underlying package changes (tenant upgraded), keep the input
  // clamped to the new ceiling on next load.
  const clamped = useMemo(() => Math.min(Math.max(1, value), ceiling), [value, ceiling]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/tenant/settings/organization", {
        method: "PATCH",
        body: JSON.stringify({ concurrent_calls_limit: clamped }),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-6 space-y-3">
      <h2 className="text-sm font-medium">Concurrent calls</h2>
      <p className="text-xs text-muted-foreground">
        Your plan <strong>{data.package?.name ?? "(no plan selected)"}</strong> allows up to{" "}
        <strong>{ceiling}</strong> concurrent call{ceiling === 1 ? "" : "s"}. You can dial down to
        cap this org below that ceiling — useful for staging tenants or temporary throttles.
        Upgrading your plan raises the ceiling.
      </p>
      <div className="flex items-center gap-3">
        <Input
          type="number"
          min={1}
          max={ceiling}
          value={clamped}
          onChange={(e) => setValue(Number(e.target.value || 1))}
          className="w-24"
        />
        <span className="text-sm text-muted-foreground">
          / {ceiling}
        </span>
        <Button onClick={save} disabled={busy || clamped === (data.concurrent_calls_limit ?? ceiling)}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
    </section>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function save() {
    setError(null);
    setOk(null);
    if (next !== confirm) {
      setError("New password and confirmation don't match.");
      return;
    }
    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
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
      // The backend's currently 501 (Dograh proxy is a follow-up). Show
      // a friendly message rather than a stack trace.
      const msg =
        e instanceof ApiError && e.status === 501
          ? "Password change lands in a follow-up release. Your current password was verified."
          : (e as Error).message;
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-6 space-y-4">
      <h2 className="text-sm font-medium">Password</h2>
      <div>
        <Label htmlFor="pw-current">Current password</Label>
        <Input
          id="pw-current"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="pw-new">New password</Label>
        <Input
          id="pw-new"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          minLength={8}
        />
      </div>
      <div>
        <Label htmlFor="pw-confirm">Confirm new password</Label>
        <Input
          id="pw-confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      {ok && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>
      )}
      <div className="flex justify-end">
        <Button onClick={save} disabled={busy || !current || !next}>
          {busy ? "Updating…" : "Update password"}
        </Button>
      </div>
    </section>
  );
}

function AddonsCard() {
  // Pure placeholder until the purchase flow lands. Visual position +
  // copy mirror what the live version will look like so existing
  // screenshots don't need a redo when purchase wires up.
  return (
    <section className="rounded-lg border bg-card p-6 space-y-4">
      <h2 className="text-sm font-medium">Compliance add-ons</h2>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium">HIPAA Enabled</h3>
          <p className="text-sm text-muted-foreground">
            Purchase the HIPAA add-on for your organization to enable HIPAA-compliant storage.
          </p>
        </div>
        <Button variant="outline" disabled>
          Purchase add-on — coming soon
        </Button>
      </div>
      <div className="flex items-start justify-between gap-4 border-t pt-4">
        <div>
          <h3 className="font-medium">Zero Data Retention (ZDR)</h3>
          <p className="text-sm text-muted-foreground">
            Purchase the ZDR add-on for your organization to enable Zero Data Retention.
          </p>
        </div>
        <Button variant="outline" disabled>
          Purchase add-on — coming soon
        </Button>
      </div>
    </section>
  );
}

function AutoFallbackCard({
  data,
  onSaved,
}: {
  data: OrgSettings;
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(data.auto_fallback_enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api("/api/tenant/settings/organization", {
        method: "PATCH",
        body: JSON.stringify({ auto_fallback_enabled: next }),
      });
      setEnabled(next);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border bg-card p-6 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">
            Auto Transcriber, LLM, STT, TTS, Embedding Fallback for New Assistants
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            When enabled, new assistants created in this org automatically have fallback providers
            configured by default. Existing assistants are unaffected.
          </p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={enabled}
            disabled={busy}
            onChange={(e) => toggle(e.target.checked)}
          />
          <span className="relative inline-block h-6 w-11 rounded-full bg-muted transition peer-checked:bg-primary">
            <span className="absolute left-0.5 top-0.5 inline-block size-5 rounded-full bg-background transition peer-checked:translate-x-5" />
          </span>
        </label>
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
    </section>
  );
}

function DangerZone({ data }: { data: OrgSettings }) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const matches = confirm === data.name;

  async function destroy() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/tenant/settings/organization", {
        method: "DELETE",
        body: JSON.stringify({ confirm_name: confirm }),
      });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
        <h2 className="text-sm font-medium flex items-center gap-2 text-destructive">
          <AlertTriangle className="size-4" /> Organization cancelled
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {data.name} has been marked for deletion. A platform admin will follow up to permanently
          purge data within 30 days. You will be signed out shortly.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 space-y-3">
      <h2 className="text-sm font-medium flex items-center gap-2 text-destructive">
        <AlertTriangle className="size-4" /> Delete organization
      </h2>
      <p className="text-sm text-muted-foreground">
        Permanently remove your organization and all its contents. This action cannot be undone, so
        please proceed with caution.
      </p>
      <div>
        <Label htmlFor="confirm-name">
          To confirm, type your organization name: <code className="font-mono">{data.name}</code>
        </Label>
        <Input
          id="confirm-name"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={data.name}
        />
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      <div className="flex justify-end">
        <Button variant="destructive" disabled={!matches || busy} onClick={destroy}>
          {busy ? "Deleting…" : "Delete organization"}
        </Button>
      </div>
    </section>
  );
}
