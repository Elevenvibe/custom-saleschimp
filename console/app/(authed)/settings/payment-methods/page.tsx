"use client";

/**
 * Tenant payment methods (BYOK).
 *
 * Lists every provider the gateway supports; each card opens an inline form
 * for the provider's fields. Secrets are write-only — once saved, the form
 * shows a "has secret" hint and leaving the secret field blank keeps the
 * stored value. Coming-soon providers (Moniepoint NG) are flagged.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, CreditCard } from "lucide-react";

import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type FieldMeta = { key: string; label: string; secret: boolean; help?: string | null };
type Provider = {
  provider: string;
  label: string;
  envs: string[];
  fields: FieldMeta[];
  setup: string[];
  coming_soon: boolean;
  region: string | null;
  saved_env: string | null;
  enabled: boolean;
  has_secret: boolean;
  values: Record<string, string>;
};

export default function PaymentMethodsPage() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Provider[]>("/api/tenant/settings/payment-methods").then(setProviders).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  if (error) return <div className="p-8"><div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div></div>;
  if (!providers) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <PageHeader title="Payment methods" parents={[{ label: "Settings", href: "/settings" }]} />
      <header>
        <p className="text-sm text-muted-foreground">
          BYOK — bring your own keys. Connect any of the providers below to take
          payments under your own merchant accounts. Secrets are stored
          encrypted and never returned to the UI.
        </p>
      </header>
      {providers.map((p) => (
        <ProviderCard key={p.provider} p={p} onSaved={load} />
      ))}
    </div>
  );
}

function ProviderCard({ p, onSaved }: { p: Provider; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [env, setEnv] = useState<string>(p.saved_env ?? p.envs[0] ?? "live");
  const [enabled, setEnabled] = useState<boolean>(p.enabled);
  const [vals, setVals] = useState<Record<string, string>>({
    ...p.values,
    ...Object.fromEntries(p.fields.filter((f) => f.secret).map((f) => [f.key, ""])),
  });
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null); setOk(null);
    try {
      const r = await api<Provider>(`/api/tenant/settings/payment-methods/${p.provider}`, {
        method: "PUT",
        body: JSON.stringify({ environment: env, enabled, values: vals }),
      });
      // Clear secret inputs once saved.
      const next: Record<string, string> = { ...vals };
      for (const f of p.fields) if (f.secret) next[f.key] = "";
      setVals(next);
      setOk(r.has_secret ? "Saved — secret stored." : "Saved.");
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => !p.coming_soon && setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        disabled={p.coming_soon}
      >
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-muted"><CreditCard className="size-5" /></span>
          <div>
            <div className="flex items-center gap-2 font-medium">
              {p.label}
              {p.region && <Badge variant="secondary" className="text-[10px]">{p.region}</Badge>}
              {p.coming_soon && <Badge variant="secondary" className="text-[10px]">Coming soon</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">
              {p.coming_soon
                ? "Not yet available."
                : p.saved_env
                  ? `Configured — ${p.saved_env}${p.enabled ? " · active" : " · disabled"}`
                  : "Not configured"}
            </div>
          </div>
        </div>
        {!p.coming_soon && (
          <span className="text-xs text-muted-foreground">{open ? "Close" : "Configure"}</span>
        )}
      </button>

      {open && !p.coming_soon && (
        <div className="space-y-4 border-t px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Environment</Label>
              <Select value={env} onValueChange={setEnv}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {p.envs.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-end gap-2 text-sm pb-1.5">
              <input type="checkbox" className="size-4 accent-primary" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Enabled
            </label>
            {p.fields.map((f) => (
              <div key={f.key} className={f.secret ? "sm:col-span-2" : undefined}>
                <Label>{f.label}{f.secret && p.has_secret && <span className="ml-1 text-xs text-muted-foreground">(leave blank to keep)</span>}</Label>
                <Input
                  type={f.secret ? "password" : "text"}
                  placeholder={f.secret && p.has_secret ? "••••••••" : ""}
                  value={vals[f.key] ?? ""}
                  onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                />
                {f.help && <p className="mt-0.5 text-xs text-muted-foreground">{f.help}</p>}
              </div>
            ))}
          </div>

          {p.setup.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="mb-1 font-medium text-foreground">Setup</div>
              <ol className="list-decimal space-y-1 pl-4">
                {p.setup.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </div>
          )}

          {err && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
          {ok && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 flex items-center gap-2"><Check className="size-4" />{ok}</div>}
          <div className="flex justify-end">
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      )}
    </section>
  );
}
