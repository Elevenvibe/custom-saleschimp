"use client";

/**
 * Customer billing landing page.
 *
 * Stitches together the P2.A3 surface in one screen:
 *   - balance card
 *   - 30-day usage line chart (inline SVG — no recharts dep)
 *   - top-up modal (Stripe Elements / Paystack redirect)
 *   - payment methods table
 *   - auto-reload settings
 *   - ledger / purchase history with CSV export
 *   - coupon redemption
 *
 * Most of the "client SDK" pieces are stubs that point at the gateway's
 * provider endpoints — connecting Stripe Elements / Paystack inline
 * proper happens once real keys are wired in. Until then the buttons
 * show the JSON the gateway returned so a smoke test is one click.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import {
  api,
  centsToUsd,
  type CouponRedeemResult,
  type LedgerRow,
  type MICROS_PER_UNIT as _MICROS,
  microsToUsd,
  type PaymentMethod,
  type ProviderInfo,
  type TopUpResult,
  type UsageDailyBucket,
  type UsageRow,
  type WalletRow,
  type WalletSummary,
} from "@/lib/api";
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
import { ArrowLeft, CreditCard, Download, Loader2, Sparkles, Trash2 } from "lucide-react";

import { StripeElementsHost } from "@/components/billing/StripeElementsHost";
import { PaystackInline } from "@/components/billing/PaystackInline";

// Bumped one digit per redeploy of stale cached cents → micros.
function makeRef(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const MICROS_PER_UNIT = 1_000_000;

export default function BillingPage() {
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  // Multi-currency list. The single `wallet` above is still the primary
  // (USD by default) — see the WalletCards section below for how we pick
  // which one drives the top-up / auto-reload buttons.
  const [wallets, setWallets] = useState<WalletRow[] | null>(null);
  const [topUpCurrency, setTopUpCurrency] = useState<string>("USD");
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [daily, setDaily] = useState<UsageDailyBucket[] | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showTopUp, setShowTopUp] = useState(false);
  const [showAutoReload, setShowAutoReload] = useState(false);
  const [showAddMethod, setShowAddMethod] = useState(false);

  function loadAll() {
    api<WalletSummary>("/api/tenant/wallet").then(setWallet).catch((e) => setError(e.message));
    api<WalletRow[]>("/api/tenant/wallets").then(setWallets).catch(() => setWallets([]));
    api<ProviderInfo[]>("/api/tenant/wallet/providers").then(setProviders).catch(() => setProviders([]));
    api<PaymentMethod[]>("/api/tenant/payment-methods").then(setMethods).catch(() => setMethods([]));
    api<UsageDailyBucket[]>("/api/tenant/usage/daily?days=30").then(setDaily).catch(() => setDaily([]));
    api<LedgerRow[]>("/api/tenant/wallet/ledger?limit=100").then(setLedger).catch(() => setLedger([]));
    api<UsageRow[]>("/api/tenant/usage?limit=100").then(setUsage).catch(() => setUsage([]));
  }
  useEffect(loadAll, []);

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      </div>
    );
  }
  if (!wallet) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  const defaultProvider = providers?.find((p) => p.is_default && p.configured)?.slug
    ?? providers?.find((p) => p.configured)?.slug
    ?? "stripe";
  const anyProviderConfigured = providers?.some((p) => p.configured) ?? false;

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-6 py-10 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="inline-flex items-center text-xs text-muted-foreground hover:underline">
            <ArrowLeft className="size-3 mr-1" /> Back to dashboard
          </Link>
          <h1 className="text-2xl font-semibold mt-2">Wallet &amp; billing</h1>
        </div>
        <Link href="/billing/plans">
          <Button variant="outline">Manage plan</Button>
        </Link>
      </div>

      {/* --- Balances + actions ---
          Multi-currency view: one card per (tenant, currency) wallet
          from /api/tenant/wallets. The primary card (USD by default —
          /api/tenant/wallet without ?currency=) owns the action
          buttons; non-primary cards get a Top-up Now shortcut that
          pre-fills the dialog with that currency. */}
      <section className="space-y-4">
        <WalletCards
          primary={wallet}
          wallets={wallets}
          onTopUp={(currency) => {
            setTopUpCurrency(currency);
            setShowTopUp(true);
          }}
          onAutoReload={() => setShowAutoReload(true)}
          onAddMethod={() => setShowAddMethod(true)}
          anyProviderConfigured={anyProviderConfigured}
        />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2 rounded-lg border bg-muted/30 p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Quick actions</div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { setTopUpCurrency(wallet.currency); setShowTopUp(true); }} disabled={!anyProviderConfigured}>
                Top up {wallet.currency}
              </Button>
              <Button variant="outline" onClick={() => setShowAutoReload(true)}>
                {wallet.auto_reload_enabled ? "Auto-reload: ON" : "Set up auto-reload"}
              </Button>
              <Button variant="outline" onClick={() => setShowAddMethod(true)} disabled={!anyProviderConfigured}>
                <CreditCard className="size-4" /> Add payment method
              </Button>
            </div>
            {!anyProviderConfigured && (
              <div className="mt-3 text-xs text-muted-foreground">
                No payment providers are configured on this deployment yet. Reach out to your admin to enable Stripe or Paystack.
              </div>
            )}
          </div>
          <CouponCard onRedeemed={loadAll} />
        </div>
      </section>

      {/* --- 30-day usage chart --- */}
      <section className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-medium">Last 30 days</h2>
            <div className="text-xs text-muted-foreground">Daily billed usage</div>
          </div>
          <div className="text-xs text-muted-foreground">
            Total: {microsToUsd(daily?.reduce((s, b) => s + b.billed_micros, 0) ?? 0)}
          </div>
        </div>
        <UsageChart buckets={daily ?? []} />
      </section>

      {/* --- Payment methods --- */}
      <section className="rounded-lg border bg-card p-6">
        <h2 className="text-sm font-medium mb-3">Payment methods</h2>
        {methods === null && <div className="text-sm text-muted-foreground">Loading…</div>}
        {methods?.length === 0 && (
          <div className="text-sm text-muted-foreground">No cards on file. Add one above to enable top-ups and auto-reload.</div>
        )}
        {methods && methods.length > 0 && (
          <div className="space-y-2">
            {methods.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">{m.provider}</Badge>
                  <span className="font-mono">{m.brand ?? "card"} •••• {m.last4 ?? "????"}</span>
                  {m.exp_month && m.exp_year && (
                    <span className="text-xs text-muted-foreground">
                      exp {String(m.exp_month).padStart(2, "0")}/{String(m.exp_year).slice(-2)}
                    </span>
                  )}
                  {m.is_default && <Badge>default</Badge>}
                </div>
                <div className="flex gap-2">
                  {!m.is_default && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await api(`/api/tenant/payment-methods/${m.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ is_default: true }),
                        });
                        loadAll();
                      }}
                    >
                      Make default
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!confirm("Revoke this card?")) return;
                      await api(`/api/tenant/payment-methods/${m.id}`, { method: "DELETE" });
                      loadAll();
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* --- Ledger / purchase history --- */}
      <section className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium">Activity</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => downloadLedgerCsv(ledger ?? [])}
            disabled={!ledger || ledger.length === 0}
          >
            <Download className="size-4" /> Export CSV
          </Button>
        </div>
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Balance after</th>
                <th className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {ledger?.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No activity yet.</td></tr>
              )}
              {ledger?.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 text-xs">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2"><Badge variant="secondary">{r.reason}</Badge></td>
                  <td className={`px-3 py-2 text-right font-mono ${r.delta_micros < 0 ? "text-destructive" : ""}`}>
                    {microsToUsd(r.delta_micros, 4)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{microsToUsd(r.balance_after_micros)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* --- Recent usage (Dograh extended reports) --- */}
      <section className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-medium">Recent usage</h2>
            <div className="text-xs text-muted-foreground">
              Extended Dograh reports — each row shows raw provider cost vs. what you were billed after markup.
            </div>
          </div>
        </div>
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Run</th>
                <th className="px-3 py-2 text-right">Duration</th>
                <th className="px-3 py-2 text-right">Raw</th>
                <th className="px-3 py-2 text-right">Markup</th>
                <th className="px-3 py-2 text-right">Billed</th>
              </tr>
            </thead>
            <tbody>
              {usage?.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No usage yet.</td></tr>
              )}
              {usage?.map((r) => {
                const breakdown = r.cost_breakdown as Record<string, unknown>;
                const durationS = typeof breakdown.duration_seconds === "number"
                  ? `${breakdown.duration_seconds}s`
                  : "—";
                const workflow = (breakdown.workflow_name as string) ?? r.external_ref;
                return (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2 text-xs">{new Date(r.occurred_at).toLocaleString()}</td>
                    <td className="px-3 py-2"><Badge variant="secondary">{r.kind}</Badge></td>
                    <td className="px-3 py-2 text-xs truncate max-w-[200px]" title={workflow}>{workflow}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{durationS}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{microsToUsd(r.raw_cost_micros, 4)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{microsToUsd(r.markup_micros, 4)}</td>
                    <td className="px-3 py-2 text-right font-mono">{microsToUsd(r.billed_micros, 4)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {showTopUp && (
        <TopUpDialog
          providers={providers ?? []}
          defaultProvider={defaultProvider}
          defaultCurrency={topUpCurrency || wallet.currency}
          onClose={() => setShowTopUp(false)}
          onDone={() => { setShowTopUp(false); loadAll(); }}
        />
      )}
      {showAutoReload && (
        <AutoReloadDialog
          wallet={wallet}
          methods={methods ?? []}
          onClose={() => setShowAutoReload(false)}
          onSaved={() => { setShowAutoReload(false); loadAll(); }}
        />
      )}
      {showAddMethod && (
        <AddMethodDialog
          providers={providers ?? []}
          defaultProvider={defaultProvider}
          onClose={() => setShowAddMethod(false)}
          onAdded={() => { setShowAddMethod(false); loadAll(); }}
        />
      )}
    </div>
  );
}

function CouponCard({ onRedeemed }: { onRedeemed: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CouponRedeemResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function redeem() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<CouponRedeemResult>("/api/tenant/wallet/coupons/redeem", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setResult(r);
      setCode("");
      onRedeemed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="size-4 text-muted-foreground" />
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Have a code?</div>
      </div>
      <div className="space-y-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="WELCOME10"
          maxLength={64}
        />
        <Button onClick={redeem} disabled={busy || !code} className="w-full">
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Redeem"}
        </Button>
      </div>
      {result && (
        <div className="mt-3 rounded-md bg-green-50 px-3 py-2 text-xs text-green-800">
          +{microsToUsd(result.value_applied_micros)} applied.
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
      )}
    </div>
  );
}

/** Tiny inline SVG line chart so we don't pull recharts for one chart.
 *  Y-axis is the per-day billed_micros. X-axis is positional — same order
 *  as the buckets array (the gateway returns ASC by day). */
function UsageChart({ buckets }: { buckets: UsageDailyBucket[] }) {
  if (buckets.length === 0) {
    return (
      <div className="text-center text-xs text-muted-foreground py-8">
        No usage in the last 30 days.
      </div>
    );
  }
  const width = 700;
  const height = 160;
  const pad = 24;
  const max = Math.max(1, ...buckets.map((b) => b.billed_micros));
  const dx = (width - pad * 2) / Math.max(1, buckets.length - 1);

  const pts = buckets.map((b, i) => {
    const x = pad + i * dx;
    const y = height - pad - ((b.billed_micros / max) * (height - pad * 2));
    return { x, y, b };
  });
  const path = pts.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(" ");
  const area = `${path} L${pts[pts.length - 1].x},${height - pad} L${pts[0].x},${height - pad} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-40">
      <path d={area} fill="currentColor" className="text-primary/10" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" className="text-primary" />
      {pts.map((p) => (
        <circle key={p.b.day} cx={p.x} cy={p.y} r="2.5" className="fill-primary">
          <title>{`${p.b.day}: ${microsToUsd(p.b.billed_micros, 4)} (${p.b.call_count} calls)`}</title>
        </circle>
      ))}
      <text x={pad} y={height - 4} fontSize="10" className="fill-muted-foreground">
        {buckets[0].day}
      </text>
      <text x={width - pad} y={height - 4} fontSize="10" textAnchor="end" className="fill-muted-foreground">
        {buckets[buckets.length - 1].day}
      </text>
    </svg>
  );
}

function downloadLedgerCsv(rows: LedgerRow[]) {
  const header = "id,when,reason,delta_usd,balance_after_usd,notes";
  const body = rows.map((r) =>
    [
      r.id,
      r.created_at,
      r.reason,
      (r.delta_micros / MICROS_PER_UNIT).toFixed(4),
      (r.balance_after_micros / MICROS_PER_UNIT).toFixed(4),
      JSON.stringify(r.notes ?? ""),
    ].join(","),
  ).join("\n");
  const blob = new Blob([`${header}\n${body}\n`], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ledger-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function TopUpDialog({
  providers,
  defaultProvider,
  defaultCurrency,
  onClose,
  onDone,
}: {
  providers: ProviderInfo[];
  defaultProvider: string;
  defaultCurrency: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("20.00");
  const [provider, setProvider] = useState(defaultProvider);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TopUpResult | null>(null);

  const configured = useMemo(
    () => providers.filter((p) => p.configured),
    [providers],
  );
  const providerInfo = configured.find((p) => p.slug === provider);

  async function startTopUp() {
    setBusy(true);
    setError(null);
    try {
      const usd = Number(amount);
      if (!Number.isFinite(usd) || usd < 1) throw new Error("Amount must be at least $1.00");
      const r = await api<TopUpResult>("/api/tenant/wallet/topup", {
        method: "POST",
        body: JSON.stringify({
          amount_cents: Math.round(usd * 100),
          currency,
          provider,
          idempotency_key: makeRef("topup"),
        }),
      });
      setResult(r);
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
          <DialogTitle>Top up wallet</DialogTitle>
          <DialogDescription>
            Funds land in your wallet as soon as the payment provider confirms via webhook.
          </DialogDescription>
        </DialogHeader>
        {!result && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label>Amount ({currency})</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="20.00"
                />
              </div>
              <div>
                <Label>Currency</Label>
                <Input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  maxLength={8}
                  placeholder="USD"
                />
              </div>
            </div>
            <div>
              <Label>Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {configured.map((p) => (
                    <SelectItem key={p.slug} value={p.slug}>
                      {p.slug}{p.is_default ? " (default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        {result && result.provider === "stripe" && result.client_secret && providerInfo?.publishable_key && (
          <StripeElementsHost
            publishableKey={providerInfo.publishable_key}
            clientSecret={result.client_secret}
            mode="payment"
            submitLabel={`Pay ${centsToUsd(result.amount_cents)}`}
            busyLabel="Confirming…"
            onCancel={onClose}
            onSuccess={() => onDone()}
          />
        )}
        {result && result.provider === "paystack" && providerInfo?.publishable_key && (
          <div className="space-y-2">
            <div className="rounded-md bg-muted px-3 py-2 text-sm">
              Click below to pay {centsToUsd(result.amount_cents)} via Paystack. The wallet credits once the webhook confirms.
            </div>
            <PaystackInline
              publicKey={providerInfo.publishable_key}
              amountCents={result.amount_cents}
              currency={result.currency}
              email={`tenant-${result.intent_id}@topup.invalid`}
              reference={result.provider_ref}
              onSuccess={() => onDone()}
              onCancel={onClose}
              label={`Pay ${centsToUsd(result.amount_cents)} with Paystack`}
            />
          </div>
        )}
        {result && result.provider === "paystack" && result.authorization_url && !providerInfo?.publishable_key && (
          <a href={result.authorization_url} target="_blank" rel="noopener noreferrer"
             className="block rounded-md bg-primary px-3 py-2 text-center text-sm text-primary-foreground hover:bg-primary/90">
            Continue to Paystack →
          </a>
        )}
        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <DialogFooter>
          {!result && <Button onClick={startTopUp} disabled={busy}>{busy ? "Starting…" : "Continue"}</Button>}
          {!result && <Button variant="ghost" onClick={onClose}>Cancel</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AutoReloadDialog({
  wallet,
  methods,
  onClose,
  onSaved,
}: {
  wallet: WalletSummary;
  methods: PaymentMethod[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(wallet.auto_reload_enabled);
  const [threshold, setThreshold] = useState(
    (wallet.auto_reload_threshold_micros / MICROS_PER_UNIT).toFixed(2),
  );
  const [amount, setAmount] = useState(
    (wallet.auto_reload_amount_micros / MICROS_PER_UNIT).toFixed(2),
  );
  const defaultPm = methods.find((m) => m.is_default);
  const [pmId, setPmId] = useState<number | null>(defaultPm?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/tenant/wallet/auto-reload", {
        method: "POST",
        body: JSON.stringify({
          enabled,
          threshold_micros: Math.round(Number(threshold) * MICROS_PER_UNIT),
          amount_micros: Math.round(Number(amount) * MICROS_PER_UNIT),
          payment_method_id: pmId,
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
          <DialogTitle>Auto-reload</DialogTitle>
          <DialogDescription>
            When your balance drops below the threshold, we&apos;ll charge your default card for the reload amount.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Threshold ($)</Label>
              <Input
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="5.00"
              />
            </div>
            <div>
              <Label>Reload amount ($)</Label>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="20.00"
              />
            </div>
          </div>
          <div>
            <Label>Payment method</Label>
            <Select
              value={pmId ? String(pmId) : ""}
              onValueChange={(v) => setPmId(v ? Number(v) : null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a card" />
              </SelectTrigger>
              <SelectContent>
                {methods.filter((m) => m.status === "active").map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.brand ?? "card"} •••• {m.last4 ?? "????"}
                    {m.is_default ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddMethodDialog({
  providers,
  defaultProvider,
  onClose,
  onAdded,
}: {
  providers: ProviderInfo[];
  defaultProvider: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [provider, setProvider] = useState(defaultProvider);
  const [error, setError] = useState<string | null>(null);
  // For Stripe we mint a SetupIntent on open. clientSecret stays null
  // until the gateway responds; the Elements component renders only
  // when we have both publishable + secret.
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  // Paystack "save card" flow runs a charge of 1 currency-unit and
  // promotes the resulting authorization. The reference is the
  // confirmation_token we pass to /payment-methods after Paystack
  // fires its inline success callback.
  const [paystackRef, setPaystackRef] = useState<string | null>(null);

  const configured = providers.filter((p) => p.configured);
  const providerInfo = configured.find((p) => p.slug === provider);

  // Kick off the per-provider flow as soon as the dialog opens with a
  // configured provider. Subsequent toggles run via ensureFlow() in the
  // <SelectTrigger onClick>.
  useEffect(() => {
    if (provider === "stripe" && providerInfo?.publishable_key && setupSecret === null && !setupBusy) {
      void startStripeSetup();
    } else if (provider === "paystack" && providerInfo?.publishable_key && paystackRef === null) {
      setPaystackRef(makeRef("paystack-setup"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, providerInfo?.publishable_key]);

  // Mint a Stripe SetupIntent the moment the dialog switches to stripe.
  // Cancel the previous secret so a provider toggle doesn't re-use a
  // stale SetupIntent.
  async function startStripeSetup() {
    setError(null);
    setSetupSecret(null);
    setSetupBusy(true);
    try {
      const r = await api<{ client_secret: string; id: string }>(
        "/api/tenant/payment-methods/setup-intent",
        { method: "POST", body: JSON.stringify({}) },
      );
      setSetupSecret(r.client_secret);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSetupBusy(false);
    }
  }

  async function registerToken(token: string) {
    setError(null);
    try {
      await api("/api/tenant/payment-methods", {
        method: "POST",
        body: JSON.stringify({
          provider,
          confirmation_token: token,
          make_default: true,
        }),
      });
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function ensureFlow() {
    if (provider === "stripe" && setupSecret === null && !setupBusy) {
      void startStripeSetup();
    }
    if (provider === "paystack" && paystackRef === null) {
      setPaystackRef(makeRef("paystack-setup"));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a payment method</DialogTitle>
          <DialogDescription>
            We never see your card. Stripe / Paystack collect it directly in their iframe / popup
            and hand us back a token we can store for future charges.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Provider</Label>
            <Select
              value={provider}
              onValueChange={(v) => {
                setProvider(v);
                setSetupSecret(null);
                setPaystackRef(null);
              }}
            >
              <SelectTrigger onClick={ensureFlow}><SelectValue /></SelectTrigger>
              <SelectContent>
                {configured.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.slug}{p.is_default ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {provider === "stripe" && providerInfo?.publishable_key && (
            <div>
              {setupBusy && (
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="size-3 animate-spin" /> Setting up secure card form…
                </div>
              )}
              {setupSecret && (
                <StripeElementsHost
                  publishableKey={providerInfo.publishable_key}
                  clientSecret={setupSecret}
                  mode="setup"
                  submitLabel="Save card"
                  busyLabel="Saving…"
                  onCancel={onClose}
                  onSuccess={({ id }) => {
                    void registerToken(id);
                  }}
                />
              )}
              {!setupSecret && !setupBusy && (
                <Button onClick={startStripeSetup}>Show card form</Button>
              )}
            </div>
          )}

          {provider === "paystack" && providerInfo?.publishable_key && paystackRef && (
            <div className="space-y-2">
              <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Paystack charges a 1-unit verification to save your card. The amount is automatically
                refunded; the card gets stored for future top-ups.
              </div>
              <PaystackInline
                publicKey={providerInfo.publishable_key}
                amountCents={100}
                currency="USD"
                email={`tenant@setup.invalid`}
                reference={paystackRef}
                onSuccess={(ref) => void registerToken(ref)}
                onCancel={onClose}
                label="Verify card with Paystack"
              />
            </div>
          )}

          {(!providerInfo?.publishable_key) && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {providerInfo
                ? "This provider has no publishable key on file — ask your admin to set it under Settings → Payment gateways."
                : "Pick a provider to continue."}
            </div>
          )}
        </div>
        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/** Per-currency balance cards.
 *
 *  The first card is the "primary" wallet (USD by default). It mirrors
 *  the shape we used pre-f5: large balance + currency label. Additional
 *  rows in `wallets` get rendered as smaller cards beside it; each has
 *  a quick Top up shortcut that pre-selects its currency.
 *
 *  If /api/tenant/wallets has more wallets than the primary one, we
 *  filter out the primary by currency match to avoid duplicating it
 *  in the row.
 */
function WalletCards({
  primary,
  wallets,
  onTopUp,
  onAutoReload: _onAutoReload,
  onAddMethod: _onAddMethod,
  anyProviderConfigured,
}: {
  primary: WalletSummary;
  wallets: WalletRow[] | null;
  onTopUp: (currency: string) => void;
  onAutoReload: () => void;
  onAddMethod: () => void;
  anyProviderConfigured: boolean;
}) {
  const extras = (wallets ?? []).filter((w) => w.currency !== primary.currency);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="md:col-span-1 rounded-lg border bg-card p-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Primary balance</div>
        <div className="mt-2 flex items-baseline gap-2">
          <div className="font-heading text-4xl font-medium">
            {microsToUsd(primary.balance_micros)}
          </div>
          <div className="text-sm text-muted-foreground">{primary.currency}</div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => onTopUp(primary.currency)}
          disabled={!anyProviderConfigured}
        >
          Top up {primary.currency}
        </Button>
      </div>
      {extras.map((w) => (
        <div key={w.currency} className="rounded-lg border bg-card p-6">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{w.currency} balance</div>
          <div className="mt-2 flex items-baseline gap-2">
            <div className="font-heading text-3xl font-medium">
              {microsToUsd(w.balance_micros)}
            </div>
            <div className="text-sm text-muted-foreground">{w.currency}</div>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {w.auto_reload_enabled ? "Auto-reload on" : "No auto-reload"}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => onTopUp(w.currency)}
            disabled={!anyProviderConfigured}
          >
            Top up {w.currency}
          </Button>
        </div>
      ))}
      {extras.length === 0 && (
        <div className="md:col-span-2 rounded-lg border border-dashed bg-muted/20 p-6 flex items-center text-xs text-muted-foreground">
          You only hold {primary.currency}. Open a wallet in another currency by topping up with that currency selected.
        </div>
      )}
    </div>
  );
}
