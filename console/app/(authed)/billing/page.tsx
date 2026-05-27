"use client";

/**
 * /console/billing — full wallet, multi-currency, embed-backed top-up.
 *
 * This is the ported equivalent of app-ui/app/(authed)/billing/page.tsx,
 * with the same sub-components living under console/components/ instead
 * of app-ui/components/billing/. Trimmed in two places:
 *   - 30-day usage chart is omitted; the daily data isn't critical for
 *     parity and the inline SVG can come in a follow-up commit.
 *   - The auto-reload dialog is omitted; auto-reload settings live on
 *     the wallet model and tenants can be toggled from the admin
 *     drilldown until the dialog ports over.
 *
 * Everything else is here: multi-currency cards, ledger, payment methods,
 * Stripe Elements top-up, Paystack inline top-up, coupon redemption,
 * "Add a card" flow via SetupIntent.
 */

import { useEffect, useMemo, useState } from "react";

import {
  api,
  centsToUsd,
  type CouponRedeemResult,
  type LedgerRow,
  makeRef,
  microsToUsd,
  type PaymentMethod,
  type ProviderInfo,
  type TopUpResult,
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
import { StripeElementsHost } from "@/components/StripeElementsHost";
import { PaystackInline } from "@/components/PaystackInline";
import { CreditCard, Loader2, Sparkles, Trash2 } from "lucide-react";

export default function ConsoleBillingPage() {
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [wallets, setWallets] = useState<WalletRow[] | null>(null);
  const [topUpCurrency, setTopUpCurrency] = useState<string>("USD");
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showTopUp, setShowTopUp] = useState(false);
  const [showAddMethod, setShowAddMethod] = useState(false);

  function loadAll() {
    api<WalletSummary>("/api/tenant/wallet").then(setWallet).catch((e) => setError(e.message));
    api<WalletRow[]>("/api/tenant/wallets").then(setWallets).catch(() => setWallets([]));
    api<ProviderInfo[]>("/api/tenant/wallet/providers").then(setProviders).catch(() => setProviders([]));
    api<PaymentMethod[]>("/api/tenant/payment-methods").then(setMethods).catch(() => setMethods([]));
    api<LedgerRow[]>("/api/tenant/wallet/ledger?limit=50").then(setLedger).catch(() => setLedger([]));
  }
  useEffect(loadAll, []);

  if (!wallet) {
    return (
      <div className="p-8 text-sm text-[color:var(--muted-foreground)]">Loading wallet…</div>
    );
  }

  const defaultProvider =
    providers?.find((p) => p.is_default && p.configured)?.slug
    ?? providers?.find((p) => p.configured)?.slug
    ?? "stripe";
  const anyProviderConfigured = providers?.some((p) => p.configured) ?? false;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Wallet &amp; Billing</h1>
        <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
          Top up, watch your spend, manage payment methods.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* Balances per currency + quick actions */}
      <section className="space-y-4">
        <WalletCards
          primary={wallet}
          wallets={wallets}
          onTopUp={(currency) => {
            setTopUpCurrency(currency);
            setShowTopUp(true);
          }}
          anyProviderConfigured={anyProviderConfigured}
        />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--muted)]/30 p-4">
            <div className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)] mb-2">
              Quick actions
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  setTopUpCurrency(wallet.currency);
                  setShowTopUp(true);
                }}
                disabled={!anyProviderConfigured}
              >
                Top up {wallet.currency}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowAddMethod(true)}
                disabled={!anyProviderConfigured}
              >
                <CreditCard className="size-4" /> Add payment method
              </Button>
            </div>
            {!anyProviderConfigured && (
              <div className="mt-3 text-xs text-[color:var(--muted-foreground)]">
                No payment providers configured yet. Ask your admin to set Stripe / Paystack keys.
              </div>
            )}
          </div>
          <CouponCard onRedeemed={loadAll} />
        </div>
      </section>

      {/* Payment methods */}
      <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-6">
        <h2 className="text-sm font-medium mb-3">Payment methods</h2>
        {methods === null && (
          <div className="text-sm text-[color:var(--muted-foreground)]">Loading…</div>
        )}
        {methods?.length === 0 && (
          <div className="text-sm text-[color:var(--muted-foreground)]">
            No cards on file. Add one above to enable top-ups.
          </div>
        )}
        {methods && methods.length > 0 && (
          <div className="space-y-2">
            {methods.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-md border border-[color:var(--border)] bg-[color:var(--background)] px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">{m.provider}</Badge>
                  <span className="font-mono">
                    {m.brand ?? "card"} •••• {m.last4 ?? "????"}
                  </span>
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

      {/* Ledger */}
      <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[color:var(--border)] text-sm font-medium">
          Recent activity
        </div>
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--muted)] text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">Reason</th>
              <th className="px-4 py-2 text-right">Amount</th>
              <th className="px-4 py-2 text-right">Balance after</th>
              <th className="px-4 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {ledger?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[color:var(--muted-foreground)]">
                  No activity yet.
                </td>
              </tr>
            )}
            {ledger?.map((r) => (
              <tr key={r.id} className="border-t border-[color:var(--border)]">
                <td className="px-4 py-2 text-xs">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-4 py-2">
                  <Badge variant="secondary">{r.reason}</Badge>
                </td>
                <td
                  className={`px-4 py-2 text-right font-mono text-xs ${r.delta_micros < 0 ? "text-red-700" : ""}`}
                >
                  {microsToUsd(r.delta_micros, 4)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {microsToUsd(r.balance_after_micros)}
                </td>
                <td className="px-4 py-2 text-xs text-[color:var(--muted-foreground)]">
                  {r.notes ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {showTopUp && (
        <TopUpDialog
          providers={providers ?? []}
          defaultProvider={defaultProvider}
          defaultCurrency={topUpCurrency || wallet.currency}
          onClose={() => setShowTopUp(false)}
          onDone={() => {
            setShowTopUp(false);
            loadAll();
          }}
        />
      )}
      {showAddMethod && (
        <AddMethodDialog
          providers={providers ?? []}
          defaultProvider={defaultProvider}
          onClose={() => setShowAddMethod(false)}
          onAdded={() => {
            setShowAddMethod(false);
            loadAll();
          }}
        />
      )}
    </div>
  );
}

// ---------------- helpers ----------------

function WalletCards({
  primary,
  wallets,
  onTopUp,
  anyProviderConfigured,
}: {
  primary: WalletSummary;
  wallets: WalletRow[] | null;
  onTopUp: (currency: string) => void;
  anyProviderConfigured: boolean;
}) {
  const extras = (wallets ?? []).filter((w) => w.currency !== primary.currency);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="md:col-span-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-6">
        <div className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
          Primary balance
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <div className="text-4xl font-semibold">{microsToUsd(primary.balance_micros)}</div>
          <div className="text-sm text-[color:var(--muted-foreground)]">{primary.currency}</div>
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
        <div
          key={w.currency}
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-6"
        >
          <div className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
            {w.currency} balance
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <div className="text-3xl font-semibold">{microsToUsd(w.balance_micros)}</div>
            <div className="text-sm text-[color:var(--muted-foreground)]">{w.currency}</div>
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
        <div className="md:col-span-2 rounded-lg border border-dashed border-[color:var(--border)] bg-[color:var(--muted)]/20 p-6 flex items-center text-xs text-[color:var(--muted-foreground)]">
          You only hold {primary.currency}. Open a wallet in another currency by topping up with that
          currency selected.
        </div>
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
    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-6">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="size-4 text-[color:var(--muted-foreground)]" />
        <div className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
          Have a code?
        </div>
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
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}
    </div>
  );
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

  const configured = useMemo(() => providers.filter((p) => p.configured), [providers]);
  const providerInfo = configured.find((p) => p.slug === provider);

  async function startTopUp() {
    setBusy(true);
    setError(null);
    try {
      const usd = Number(amount);
      if (!Number.isFinite(usd) || usd < 1) throw new Error("Amount must be at least 1.00");
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
                />
              </div>
            </div>
            <div>
              <Label>Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {configured.map((p) => (
                    <SelectItem key={p.slug} value={p.slug}>
                      {p.slug}
                      {p.is_default ? " (default)" : ""}
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
            <div className="rounded-md bg-[color:var(--muted)] px-3 py-2 text-sm">
              Click below to pay {centsToUsd(result.amount_cents)} via Paystack.
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
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        <DialogFooter>
          {!result && (
            <Button onClick={startTopUp} disabled={busy}>
              {busy ? "Starting…" : "Continue"}
            </Button>
          )}
          {!result && (
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          )}
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
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [paystackRef, setPaystackRef] = useState<string | null>(null);

  const configured = providers.filter((p) => p.configured);
  const providerInfo = configured.find((p) => p.slug === provider);

  useEffect(() => {
    if (provider === "stripe" && providerInfo?.publishable_key && setupSecret === null && !setupBusy) {
      void startStripeSetup();
    } else if (provider === "paystack" && providerInfo?.publishable_key && paystackRef === null) {
      setPaystackRef(makeRef("paystack-setup"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, providerInfo?.publishable_key]);

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

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a payment method</DialogTitle>
          <DialogDescription>
            Card data goes directly to Stripe / Paystack — never to our server.
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
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {configured.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.slug}
                    {p.is_default ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {provider === "stripe" && providerInfo?.publishable_key && (
            <div>
              {setupBusy && (
                <div className="text-xs text-[color:var(--muted-foreground)] flex items-center gap-2">
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
              <div className="rounded-md bg-[color:var(--muted)] px-3 py-2 text-xs text-[color:var(--muted-foreground)]">
                Paystack charges a 1-unit verification to save your card. The amount is automatically refunded.
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

          {!providerInfo?.publishable_key && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {providerInfo
                ? "This provider has no publishable key on file — ask your admin to set it."
                : "Pick a provider to continue."}
            </div>
          )}
        </div>
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
