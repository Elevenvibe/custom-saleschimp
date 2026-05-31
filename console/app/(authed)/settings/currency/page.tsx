"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Cfg = {
  currency: string;
  apply_to_invoices: boolean;
  apply_to_leads: boolean;
  apply_to_clients: boolean;
};

export default function CurrencyPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Cfg>("/api/tenant/settings/currency").then(setCfg).catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);

  async function save() {
    if (!cfg) return;
    setBusy(true); setErr(null); setOk(null);
    try {
      const r = await api<Cfg>("/api/tenant/settings/currency", { method: "PUT", body: JSON.stringify(cfg) });
      setCfg(r); setOk("Saved.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (!cfg) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <PageHeader title="Currency" parents={[{ label: "Settings", href: "/settings" }]} />
      <header>
        <p className="text-sm text-muted-foreground">
          The currency the AI agent quotes in. When applied, it overrides the
          default on invoices, leads, and client records.
        </p>
      </header>
      <section className="space-y-4 rounded-lg border bg-card p-6">
        <div className="max-w-xs">
          <Label>AI agent currency</Label>
          <Input value={cfg.currency} onChange={(e) => { setCfg({ ...cfg, currency: e.target.value.toUpperCase() }); setOk(null); }} placeholder="USD" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Apply this currency to</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {([
              ["apply_to_invoices", "Invoices"],
              ["apply_to_leads", "Leads"],
              ["apply_to_clients", "Clients"],
            ] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={cfg[k]}
                  onChange={(e) => { setCfg({ ...cfg, [k]: e.target.checked }); setOk(null); }}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        {err && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
        {ok && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>}
        <div className="flex justify-end">
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </section>
    </div>
  );
}
