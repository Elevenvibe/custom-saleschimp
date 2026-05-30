"use client";

/**
 * Settings → Social login.
 *
 * Per-provider OAuth config (Google, Facebook, LinkedIn, X) — client/app id,
 * secret (write-only), redirect/callback URL, enabled — plus setup
 * instructions and the exact redirect URI to register with each provider.
 *
 * Once enabled + configured, "Continue with …" buttons appear on the login
 * pages (admin-ui + console). Social login signs in EXISTING accounts only
 * (matched by verified email); it never creates accounts.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { api, GATEWAY } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Provider = {
  provider: string;
  name: string;
  enabled: boolean;
  client_id: string;
  callback_url: string;
  has_secret: boolean;
  scopes: string;
  setup_url: string;
  returns_email: boolean;
};

export default function SocialLoginPage() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ providers: Provider[] }>("/api/admin/social-login")
      .then((d) => setProviders(d.providers))
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
  if (!providers) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <header>
        <h1 className="text-xl font-semibold">Social login</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Let users sign in with Google, Facebook, LinkedIn, or X. Enabled
          providers show a button on the login pages. Sign-in matches an
          existing account by email — it never creates accounts.
        </p>
      </header>

      {providers.map((p) => (
        <ProviderCard key={p.provider} p={p} onSaved={load} />
      ))}
    </div>
  );
}

function ProviderCard({ p, onSaved }: { p: Provider; onSaved: () => void }) {
  const recommended = `${GATEWAY}/api/auth/social/${p.provider}/callback`;
  const [enabled, setEnabled] = useState(p.enabled);
  const [clientId, setClientId] = useState(p.client_id);
  const [callbackUrl, setCallbackUrl] = useState(p.callback_url || recommended);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function save() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      await api(`/api/admin/social-login/${p.provider}`, {
        method: "PUT",
        body: JSON.stringify({
          enabled,
          client_id: clientId,
          callback_url: callbackUrl,
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
          <h2 className="flex items-center gap-2 text-sm font-medium">
            {p.name}
            {!p.returns_email && (
              <Badge variant="secondary" className="text-[10px]">email may be unavailable</Badge>
            )}
          </h2>
          <a
            href={p.setup_url}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Register an app <ExternalLink className="size-3" />
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
          <Label>Client / App ID</Label>
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="your-client-id" />
        </div>
        <div className="sm:col-span-2">
          <Label>{p.has_secret ? "Client secret (leave blank to keep)" : "Client secret"}</Label>
          <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••••" />
        </div>
        <div className="sm:col-span-2">
          <Label>Redirect / callback URL</Label>
          <Input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} />
        </div>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">Setup</div>
        <ol className="list-decimal space-y-1 pl-4">
          <li>Register an OAuth app with {p.name} (link above).</li>
          <li>
            Add this exact redirect URI to the app:
            <span className="ml-1 inline-flex items-center gap-1">
              <code className="rounded bg-background px-1">{recommended}</code>
              <button type="button" onClick={copyCallback} className="text-primary hover:underline">
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              </button>
            </span>
          </li>
          <li>Request scopes: <code className="rounded bg-background px-1">{p.scopes}</code></li>
          <li>Paste the Client ID + secret above, set the callback to match, enable, and save.</li>
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
