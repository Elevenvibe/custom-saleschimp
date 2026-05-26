"use client";

/**
 * Admin billing dashboard.
 *
 * Three jobs:
 *   1. Provider configuration health check at a glance.
 *   2. Per-tenant wallet roll-up (balance, recent activity, top spenders).
 *   3. Coupons CRUD + recent payment intents.
 *
 * The detail drilldown lives on /tenants/{id}/wallet (separate page,
 * future work) — this one is the cross-tenant overview.
 */

import { useEffect, useMemo, useState } from "react";

import {
  api,
  microsToUsd,
  type AdminCoupon,
  type AdminPaymentIntent,
  type AdminProviderInfo,
  type AdminWallet,
  type AutoReloadStatus,
  type Tenant,
} from "@/lib/api";
import { PageDescription, PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, RefreshCw } from "lucide-react";

type TenantsRes = { total: number; items: Tenant[] };

export default function AdminBillingPage() {
  const [providers, setProviders] = useState<AdminProviderInfo[] | null>(null);
  const [auto, setAuto] = useState<AutoReloadStatus | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [wallets, setWallets] = useState<Record<number, AdminWallet>>({});
  const [coupons, setCoupons] = useState<AdminCoupon[] | null>(null);
  const [intents, setIntents] = useState<AdminPaymentIntent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdjust, setShowAdjust] = useState<number | null>(null);
  const [showCoupon, setShowCoupon] = useState(false);

  function load() {
    api<AdminProviderInfo[]>("/api/admin/payments/providers").then(setProviders).catch(() => setProviders([]));
    api<AutoReloadStatus>("/api/admin/payments/auto-reload/status").then(setAuto).catch(() => {});
    api<TenantsRes>("/api/admin/tenants").then(async (r) => {
      setTenants(r.items);
      // Fetch wallets in parallel; failures are silent so a missing
      // wallet row (which auto-provisions on first hit) doesn't blow
      // up the whole dashboard.
      const entries = await Promise.allSettled(
        r.items.map(async (t) => {
          const w = await api<AdminWallet>(`/api/admin/tenants/${t.id}/wallet`);
          return [t.id, w] as const;
        }),
      );
      const out: Record<number, AdminWallet> = {};
      for (const e of entries) if (e.status === "fulfilled") out[e.value[0]] = e.value[1];
      setWallets(out);
    }).catch((e) => setError(e.message));
    api<AdminCoupon[]>("/api/admin/coupons").then(setCoupons).catch(() => setCoupons([]));
    api<AdminPaymentIntent[]>("/api/admin/payments/intents?limit=20").then(setIntents).catch(() => setIntents([]));
  }
  useEffect(load, []);

  const totalBalance = useMemo(
    () => Object.values(wallets).reduce((s, w) => s + w.balance_micros, 0),
    [wallets],
  );
  const topSpenders = useMemo(() => {
    if (!tenants) return [];
    return [...tenants]
      .map((t) => ({ tenant: t, wallet: wallets[t.id] }))
      .filter((r) => r.wallet)
      .sort((a, b) => (a.wallet?.balance_micros ?? 0) - (b.wallet?.balance_micros ?? 0))
      .slice(0, 5);
  }, [tenants, wallets]);

  return (
    <>
      <PageHeader
        title="Billing"
        action={
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        }
      />
      <div className="p-8 space-y-8">
        <PageDescription>
          Cross-tenant billing dashboard. Provider health, wallet roll-up, recent payment intents, and coupon management.
        </PageDescription>
        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

        {/* Provider configuration */}
        <section className="grid gap-4 md:grid-cols-3">
          {(providers ?? []).map((p) => (
            <div key={p.slug} className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium capitalize">{p.slug}</div>
                {p.is_default && <Badge>default</Badge>}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {p.configured ? "Configured — accepting top-ups." : "Not configured. Set the secret in env."}
              </div>
              <Badge variant={p.configured ? "default" : "secondary"} className="mt-2">
                {p.configured ? "Live" : "Off"}
              </Badge>
            </div>
          ))}
          <div className="rounded-lg border bg-card p-4">
            <div className="font-medium">Auto-reload sweep</div>
            <div className="mt-2 text-xs text-muted-foreground">
              {auto?.enabled ? `Every ${auto.interval_seconds}s` : "Disabled in config"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Last: {auto?.last_run_at ? new Date(auto.last_run_at).toLocaleString() : "—"}
              {" "}({auto?.last_checked ?? 0} checked, {auto?.last_reloaded ?? 0} reloaded)
            </div>
          </div>
        </section>

        {/* Top-line numbers */}
        <section className="grid gap-4 md:grid-cols-3">
          <Stat label="Total wallet balance" value={microsToUsd(totalBalance)} />
          <Stat label="Tenants with wallet" value={`${Object.keys(wallets).length} / ${tenants?.length ?? 0}`} />
          <Stat label="Active coupons" value={(coupons ?? []).filter((c) => c.active).length} />
        </section>

        {/* Top spenders */}
        <section className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-medium">Lowest balances (top spenders)</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Tenant</th>
                <th className="px-4 py-2 text-right">Balance</th>
                <th className="px-4 py-2 text-right">Credit limit</th>
                <th className="px-4 py-2">Auto-reload</th>
                <th className="px-4 py-2 w-24" />
              </tr>
            </thead>
            <tbody>
              {topSpenders.map((r) => (
                <tr key={r.tenant.id} className="border-t">
                  <td className="px-4 py-2">
                    <div className="font-medium">{r.tenant.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{r.tenant.slug}</div>
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${r.wallet!.balance_micros < 0 ? "text-destructive" : ""}`}>
                    {microsToUsd(r.wallet!.balance_micros)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{microsToUsd(r.wallet!.credit_limit_micros)}</td>
                  <td className="px-4 py-2">
                    {r.wallet!.auto_reload_enabled
                      ? <Badge>on @ {microsToUsd(r.wallet!.auto_reload_threshold_micros)}</Badge>
                      : <Badge variant="secondary">off</Badge>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setShowAdjust(r.tenant.id)}>Adjust</Button>
                  </td>
                </tr>
              ))}
              {topSpenders.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No wallets yet.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {/* Recent intents */}
        <section className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-medium">Recent payment intents</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Tenant</th>
                <th className="px-4 py-2">Provider</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Ref</th>
              </tr>
            </thead>
            <tbody>
              {intents?.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No payment intents yet.</td></tr>
              )}
              {intents?.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="px-4 py-2 text-xs">{new Date(i.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-xs">#{i.tenant_id}</td>
                  <td className="px-4 py-2"><Badge variant="secondary">{i.provider}</Badge></td>
                  <td className="px-4 py-2 text-right font-mono">${(i.amount_cents / 100).toFixed(2)}</td>
                  <td className="px-4 py-2">
                    <Badge variant={i.status === "succeeded" ? "default" : "secondary"}>{i.status}</Badge>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs truncate max-w-[200px]">{i.provider_ref}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Coupons */}
        <section className="rounded-lg border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h2 className="text-sm font-medium">Coupons</h2>
            <Button size="sm" onClick={() => setShowCoupon(true)}>
              <Plus className="size-4" /> New coupon
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Kind</th>
                <th className="px-4 py-2 text-right">Value</th>
                <th className="px-4 py-2">Scope</th>
                <th className="px-4 py-2">Uses</th>
                <th className="px-4 py-2">Active</th>
                <th className="px-4 py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {coupons?.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No coupons yet.</td></tr>
              )}
              {coupons?.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-2 font-mono">{c.code}</td>
                  <td className="px-4 py-2"><Badge variant="secondary">{c.kind}</Badge></td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {c.kind === "percentage"
                      ? `${(c.value_micros / 10_000).toFixed(2)}%`
                      : microsToUsd(c.value_micros)}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {c.scope_kind}{c.scope_value ? `:${c.scope_value}` : ""}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{c.uses_count}{c.max_uses ? `/${c.max_uses}` : ""}</td>
                  <td className="px-4 py-2">
                    <Badge variant={c.active ? "default" : "secondary"}>{c.active ? "yes" : "no"}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (!confirm(`Delete coupon ${c.code}?`)) return;
                        await api(`/api/admin/coupons/${c.id}`, { method: "DELETE" });
                        load();
                      }}
                    >
                      ×
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {showAdjust !== null && (
        <AdjustDialog
          tenantId={showAdjust}
          wallet={wallets[showAdjust]}
          onClose={() => setShowAdjust(null)}
          onSaved={() => { setShowAdjust(null); load(); }}
        />
      )}
      {showCoupon && (
        <CouponDialog onClose={() => setShowCoupon(false)} onSaved={() => { setShowCoupon(false); load(); }} />
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 font-heading text-2xl font-medium">{value}</div>
    </div>
  );
}

function AdjustDialog({
  tenantId,
  wallet,
  onClose,
  onSaved,
}: {
  tenantId: number;
  wallet: AdminWallet | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const usd = Number(amount);
      if (!Number.isFinite(usd) || usd === 0) throw new Error("amount must be non-zero");
      await api(`/api/admin/tenants/${tenantId}/wallet/adjust`, {
        method: "POST",
        body: JSON.stringify({
          delta_micros: Math.round(usd * 1_000_000),
          notes: notes || "manual adjustment",
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust wallet — tenant #{tenantId}</DialogTitle>
          <DialogDescription>
            Signed amount in USD — positive credits, negative debits. Strict no-negative is enforced
            unless the tenant has a credit limit set.
            {wallet && <> Current balance: <strong>{microsToUsd(wallet.balance_micros)}</strong>.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Amount (USD, can be negative)</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="-25.00" />
          </div>
          <div>
            <Label>Notes (required, lands in audit log)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="comp credit, dispute, ..." />
          </div>
        </div>
        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !amount || !notes}>{busy ? "Saving…" : "Adjust"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CouponDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percentage" | "fixed_micros">("fixed_micros");
  const [valueInput, setValueInput] = useState("");
  const [scopeKind, setScopeKind] = useState<"global" | "package">("global");
  const [scopeValue, setScopeValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const n = Number(valueInput);
      if (!Number.isFinite(n) || n <= 0) throw new Error("value must be > 0");
      // Percentage stored as bp*1000 (so 10% = 100_000 micros), fixed in USD micros.
      const value_micros = kind === "percentage" ? Math.round(n * 10_000) : Math.round(n * 1_000_000);
      const body: Record<string, unknown> = {
        code,
        kind,
        value_micros,
        scope_kind: scopeKind,
        scope_value: scopeKind === "package" ? scopeValue : null,
        active: true,
      };
      if (maxUses) body.max_uses = Number(maxUses);
      await api("/api/admin/coupons", { method: "POST", body: JSON.stringify(body) });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New coupon</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WELCOME10" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as "percentage" | "fixed_micros")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed_micros">Fixed amount (USD)</SelectItem>
                  <SelectItem value="percentage">Percentage of top-up</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{kind === "percentage" ? "Percent" : "Amount (USD)"}</Label>
              <Input value={valueInput} onChange={(e) => setValueInput(e.target.value)} placeholder={kind === "percentage" ? "10" : "5.00"} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Scope</Label>
              <Select value={scopeKind} onValueChange={(v) => setScopeKind(v as "global" | "package")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="package">Package slug</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scopeKind === "package" && (
              <div>
                <Label>Package slug</Label>
                <Input value={scopeValue} onChange={(e) => setScopeValue(e.target.value.toLowerCase())} placeholder="starter" />
              </div>
            )}
          </div>
          <div>
            <Label>Max uses (optional)</Label>
            <Input value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="100" />
          </div>
        </div>
        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !code || !valueInput}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
