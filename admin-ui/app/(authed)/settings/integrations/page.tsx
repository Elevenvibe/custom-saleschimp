"use client";

/**
 * Settings → Integrations (super-admin).
 *
 * Platform-level Google Services config (one Google Cloud OAuth app) that
 * powers the tenant-facing integrations: Contacts import today, Calendar +
 * Docs agent tools next. Per-service toggles control which scopes tenants
 * consent to when they link their Google account. Secret write-only.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { api, GATEWAY } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Service = { key: string; label: string; description: string; scope: string; enabled: boolean };
type GoogleCfg = {
  enabled: boolean;
  client_id: string;
  callback_url: string;
  has_secret: boolean;
  services: Service[];
};

export default function IntegrationsPage() {
  const [cfg, setCfg] = useState<GoogleCfg | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<GoogleCfg>("/api/admin/integrations/google")
      .then(setCfg)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      </div>
    );
  }
  if (!cfg) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <header>
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect platform-level APIs that tenants link their own accounts
          against. Configure one Google Cloud OAuth app; tenants then connect
          Google and import contacts (Calendar + Docs agent tools next).
        </p>
      </header>
      <GoogleCard cfg={cfg} onSaved={load} />
    </div>
  );
}

function GoogleCard({ cfg, onSaved }: { cfg: GoogleCfg; onSaved: () => void }) {
  const recommended = `${GATEWAY}/api/tenant/integrations/google/link/callback`;
  const [enabled, setEnabled] = useState(cfg.enabled);
  const [clientId, setClientId] = useState(cfg.client_id);
  const [callbackUrl, setCallbackUrl] = useState(cfg.callback_url || recommended);
  const [secret, setSecret] = useState("");
  const [services, setServices] = useState<Record<string, boolean>>(
    Object.fromEntries(cfg.services.map((s) => [s.key, s.enabled])),
  );
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function save() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      await api("/api/admin/integrations/google", {
        method: "PUT",
        body: JSON.stringify({
          enabled,
          client_id: clientId,
          callback_url: callbackUrl,
          services,
          ...(secret ? { secret } : {}),
        }),
      });
      setOk("Saved.");
      setSecret("");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyCallback() {
    try {
      await navigator.clipboard.writeText(recommended);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">Google Services</h2>
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Google Cloud credentials <ExternalLink className="size-3" />
          </a>
        </div>
        <label className="inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={enabled}
            onChange={(e) => { setEnabled(e.target.checked); setOk(null); }}
          />
          <span className="relative inline-block h-5 w-9 rounded-full bg-muted transition peer-checked:bg-primary">
            <span className="absolute left-0.5 top-0.5 inline-block size-4 rounded-full bg-background transition peer-checked:translate-x-4" />
          </span>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>OAuth client ID</Label>
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxx.apps.googleusercontent.com" />
        </div>
        <div className="sm:col-span-2">
          <Label>{cfg.has_secret ? "Client secret (leave blank to keep)" : "Client secret"}</Label>
          <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••••" />
        </div>
        <div className="sm:col-span-2">
          <Label>Redirect / callback URL</Label>
          <Input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} />
        </div>
      </div>

      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Services</Label>
        <div className="mt-1 space-y-2">
          {cfg.services.map((s) => (
            <label key={s.key} className="flex items-start gap-2 rounded-md border p-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                checked={services[s.key] ?? s.enabled}
                onChange={(e) => setServices((p) => ({ ...p, [s.key]: e.target.checked }))}
              />
              <span>
                <span className="font-medium">{s.label}</span>
                <span className="block text-xs text-muted-foreground">{s.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">Setup</div>
        <ol className="list-decimal space-y-1 pl-4">
          <li>Create an OAuth 2.0 Client ID (type: Web application) in Google Cloud.</li>
          <li>
            Add this authorized redirect URI:
            <span className="ml-1 inline-flex items-center gap-1">
              <code className="rounded bg-background px-1">{recommended}</code>
              <button type="button" onClick={copyCallback} className="text-primary hover:underline">
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              </button>
            </span>
          </li>
          <li>Enable the People API (Contacts), and Calendar/Docs APIs if using those services.</li>
          <li>Paste the client ID + secret above, pick services, enable, and save.</li>
        </ol>
      </div>

      {err && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
      {ok && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>}
      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </section>
  );
}
