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

import { api, ApiError, GATEWAY, getToken, type OrgSettings } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2, Upload } from "lucide-react";
import { useRef } from "react";

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
      <CompanyProfileCard data={data} onSaved={load} />
      <BrandingCard data={data} onSaved={load} />
      <ConcurrencyCard data={data} onSaved={load} />
      <PasswordCard />
      <EmailIntegrationCard />
      <AddonsCard />
      <AutoFallbackCard data={data} onSaved={load} />
      <DangerZone data={data} />
    </div>
  );
}

// ----- Email Integration (SMTP / IMAP) ------------------------------------
//
// One card with a tab-style toggle between SMTP (outbox) and IMAP (inbox)
// — same backend (/api/tenant/mailbox) as the super-admin platform
// mailbox; the only difference is the gateway derives scope='tenant' +
// scope_id from the JWT so a tenant can't write another tenant's row.
// Password field is intentionally empty on load; blank means "keep the
// existing password" — same convention as the super-admin tabs.

function EmailIntegrationCard() {
  const [kind, setKind] = useState<"smtp" | "imap">("smtp");
  return (
    <section className="rounded-lg border bg-card p-6 space-y-4">
      <div>
        <h2 className="text-sm font-medium">Email integration</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Connect a mailbox so your tickets and messages can be pulled
          and pushed via email. Not used for transactional notifications.
        </p>
      </div>
      <div className="inline-flex rounded-md border p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setKind("smtp")}
          className={`rounded px-3 py-1 ${kind === "smtp" ? "bg-primary text-primary-foreground" : ""}`}
        >
          SMTP (outbox)
        </button>
        <button
          type="button"
          onClick={() => setKind("imap")}
          className={`rounded px-3 py-1 ${kind === "imap" ? "bg-primary text-primary-foreground" : ""}`}
        >
          IMAP (inbox)
        </button>
      </div>
      <TenantMailboxForm kind={kind} />
    </section>
  );
}

type TenantMailboxOut = {
  smtp_active: boolean;
  imap_active: boolean;
  from_email: string | null;
  from_name: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  imap_host: string | null;
  imap_port: number | null;
  imap_username: string | null;
};

function TenantMailboxForm({ kind }: { kind: "smtp" | "imap" }) {
  const [mailbox, setMailbox] = useState<TenantMailboxOut | null>(null);
  const [host, setHost] = useState("");
  const [port, setPort] = useState<number>(kind === "smtp" ? 587 : 993);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [secure, setSecure] = useState(true);
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function load() {
    api<TenantMailboxOut>("/api/tenant/mailbox")
      .then((m) => {
        setMailbox(m);
        if (kind === "smtp") {
          setHost(m.smtp_host ?? "");
          setPort(m.smtp_port ?? 587);
          setUsername(m.smtp_username ?? "");
        } else {
          setHost(m.imap_host ?? "");
          setPort(m.imap_port ?? 993);
          setUsername(m.imap_username ?? "");
        }
        setFromEmail(m.from_email ?? "");
        setFromName(m.from_name ?? "");
      })
      .catch(() => {});
  }
  useEffect(load, [kind]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const body: Record<string, unknown> = {
        from_email: fromEmail || null,
        from_name: fromName || null,
      };
      const block: Record<string, unknown> = { host, port, username };
      if (password) block.password = password;
      if (kind === "smtp") {
        block.use_tls = secure;
        if (password) body.smtp = block;
        body.smtp_active = true;
      } else {
        block.use_ssl = secure;
        if (password) body.imap = block;
        body.imap_active = true;
      }
      const hasStored = kind === "smtp" ? Boolean(mailbox?.smtp_host) : Boolean(mailbox?.imap_host);
      if (!password && !hasStored) {
        throw new Error("Password is required to save new credentials.");
      }
      await api("/api/tenant/mailbox", { method: "PUT", body: JSON.stringify(body) });
      setOk("Saved.");
      setPassword("");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const active = kind === "smtp" ? mailbox?.smtp_active : mailbox?.imap_active;

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="rounded-md border bg-muted/30 px-3 py-2 flex items-center justify-between text-xs">
        <span>Status</span>
        <Badge variant={active ? "default" : "secondary"}>
          {active ? "active" : "not configured"}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="col-span-2">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Host</label>
          <input
            className="mt-0.5 w-full rounded-md border px-3 py-2"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder={kind === "smtp" ? "smtp.example.com" : "imap.example.com"}
            required
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Port</label>
          <input
            type="number"
            className="mt-0.5 w-full rounded-md border px-3 py-2"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            required
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            {kind === "smtp" ? "Use TLS" : "Use SSL"}
          </label>
          <select
            className="mt-0.5 w-full rounded-md border bg-background px-3 py-2"
            value={secure ? "true" : "false"}
            onChange={(e) => setSecure(e.target.value === "true")}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Username</label>
          <input
            className="mt-0.5 w-full rounded-md border px-3 py-2"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className="col-span-2">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">
            Password {(kind === "smtp" ? mailbox?.smtp_host : mailbox?.imap_host) && <span>(leave blank to keep current)</span>}
          </label>
          <input
            type="password"
            className="mt-0.5 w-full rounded-md border px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">From email</label>
          <input
            type="email"
            className="mt-0.5 w-full rounded-md border px-3 py-2"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            placeholder="support@yourdomain.com"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">From name</label>
          <input
            className="mt-0.5 w-full rounded-md border px-3 py-2"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
          />
        </div>
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      {ok && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
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

// ----- Company profile -----------------------------------------------------
//
// Editable company contact + address details (migration 0024). Mirrors the
// super-admin tenant Profile tab; PATCHes the same /settings/organization
// endpoint so a single canonical row backs both surfaces.

function CompanyProfileCard({
  data,
  onSaved,
}: {
  data: OrgSettings;
  onSaved: () => void;
}) {
  type ProfileForm = {
    company_phone: string;
    website: string;
    industry: string;
    company_size: string;
    country: string;
    address: string;
    city: string;
    state: string;
    zip_code: string;
    about: string;
  };
  const initial = (): ProfileForm => ({
    company_phone: data.company_phone ?? "",
    website: data.website ?? "",
    industry: data.industry ?? "",
    company_size: data.company_size ?? "",
    country: data.country ?? "",
    address: data.address ?? "",
    city: data.city ?? "",
    state: data.state ?? "",
    zip_code: data.zip_code ?? "",
    about: data.about ?? "",
  });
  const [form, setForm] = useState<ProfileForm>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function set<K extends keyof ProfileForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    setOk(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api("/api/tenant/settings/organization", {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      setOk("Profile saved.");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const text = (
    k: keyof ProfileForm,
    label: string,
    opts: { placeholder?: string; type?: string } = {},
  ) => (
    <div>
      <Label htmlFor={`cp-${k}`}>{label}</Label>
      <Input
        id={`cp-${k}`}
        type={opts.type ?? "text"}
        value={form[k]}
        onChange={(e) => set(k, e.target.value)}
        placeholder={opts.placeholder}
      />
    </div>
  );

  return (
    <section className="rounded-lg border bg-card p-6 space-y-4">
      <div>
        <h2 className="text-sm font-medium">Company profile</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Contact and address details for {data.name}. Shown to your platform
          administrator and used to pre-fill billing where applicable.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {text("company_phone", "Phone", { type: "tel", placeholder: "+1 555 000 1234" })}
        {text("website", "Website", { placeholder: "https://acme.com" })}
        {text("industry", "Industry", { placeholder: "SaaS" })}
        {text("company_size", "Company size", { placeholder: "11–50" })}
        {text("country", "Country", { placeholder: "United States" })}
        {text("address", "Address", { placeholder: "123 Market St" })}
        {text("city", "City", { placeholder: "San Francisco" })}
        {text("state", "State / region", { placeholder: "CA" })}
        {text("zip_code", "ZIP / postal code", { placeholder: "94105" })}
      </div>
      <div>
        <Label htmlFor="cp-about">About</Label>
        <textarea
          id="cp-about"
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          rows={4}
          value={form.about}
          onChange={(e) => set("about", e.target.value)}
          placeholder="Short description of your organization."
        />
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      {ok && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>
      )}
      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </section>
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
      <BrandingAssetField
        id="org-logo"
        label="Logo"
        kind="logo"
        value={logo}
        onChange={setLogo}
        onUploaded={onSaved}
        placeholder="https://cdn.example.com/logo.png"
      />
      <BrandingAssetField
        id="org-favicon"
        label="Favicon"
        kind="favicon"
        value={favicon}
        onChange={setFavicon}
        onUploaded={onSaved}
        placeholder="https://cdn.example.com/favicon.ico"
      />
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


/**
 * Hybrid URL-input + file-upload field for branding assets.
 *
 * Two ways to set a logo or favicon:
 *   1. Paste a public URL (works for already-hosted assets — e.g. a
 *      brand CDN). Saves on the next "Save branding" click.
 *   2. Click Upload, pick a file, the browser POSTs a multipart form
 *      to /api/tenant/settings/organization/branding. The gateway
 *      stores the file in MinIO under tenants/<id>/<kind>-<ts>.<ext>
 *      with a public-read bucket policy, then persists the URL on
 *      the tenant row. We mirror the returned URL into the input so
 *      the parent component sees it for the eventual PATCH (and the
 *      preview below updates immediately).
 *
 * MAX 2 MB; accepted types limited to png / jpeg / webp / svg / ico.
 * Validation happens server-side in storage.branding; UI keeps the
 * accept attribute aligned so OS-level pickers filter correctly.
 */
function BrandingAssetField({
  id,
  label,
  kind,
  value,
  onChange,
  onUploaded,
  placeholder,
}: {
  id: string;
  label: string;
  kind: "logo" | "favicon";
  value: string;
  onChange: (v: string) => void;
  onUploaded: () => void;
  placeholder: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      // We bypass api() here because it forces JSON; the multipart
      // upload needs the browser to set Content-Type with the boundary
      // itself. Manually attach the Bearer token via getToken().
      const token = getToken();
      const res = await fetch(`${GATEWAY}/api/tenant/settings/organization/branding`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      if (!res.ok) {
        const text = await res.text();
        let detail = text;
        try {
          const body = JSON.parse(text);
          detail = body?.detail ?? text;
        } catch {
          // body wasn't JSON — use raw text.
        }
        throw new Error(detail || `upload failed (${res.status})`);
      }
      const body = (await res.json()) as { url: string };
      onChange(body.url);
      onUploaded();
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {uploading ? "Uploading…" : "Upload"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Paste a public URL or upload a file (max 2 MB, PNG / JPEG / WEBP / SVG / ICO).
      </p>
      {value && (
        <div className="mt-2 inline-flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1">
          {/* Live preview — handy for confirming the upload landed. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt={`${label} preview`}
            className="h-8 w-auto max-w-32 object-contain"
          />
          <span className="text-xs text-muted-foreground">preview</span>
        </div>
      )}
      {uploadError && (
        <div className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {uploadError}
        </div>
      )}
    </div>
  );
}
