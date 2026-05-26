"use client";

/**
 * Per-tenant wallet drilldown.
 *
 * The cross-tenant /billing page only shows balance + top spenders;
 * this page is for "I need to see everything that touched tenant N's
 * money": full ledger, every usage_record, every payment_intent,
 * inline controls for adjust + credit-limit.
 */

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import {
  api,
  microsToUsd,
  type AdminCoupon as _Coupon,
  type AdminPaymentIntent,
  type AdminWallet,
  type LedgerRow,
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
import { ArrowLeft, Download, RefreshCw, ShieldCheck } from "lucide-react";

type UsageRow = {
  id: number;
  tenant_id: number;
  external_ref: string;
  kind: string;
  unit: string;
  quantity_micros: number;
  billed_micros: number;
  currency: string;
  occurred_at: string;
};

export default function TenantWalletDrilldown({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const tenantId = Number(id);

  const [wallet, setWallet] = useState<AdminWallet | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [intents, setIntents] = useState<AdminPaymentIntent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showLimit, setShowLimit] = useState(false);

  function load() {
    setError(null);
    api<AdminWallet>(`/api/admin/tenants/${tenantId}/wallet`).then(setWallet).catch((e) => setError(e.message));
    api<LedgerRow[]>(`/api/admin/tenants/${tenantId}/wallet/ledger?limit=200`).then(setLedger).catch(() => setLedger([]));
    api<UsageRow[]>(`/api/admin/tenants/${tenantId}/usage?limit=100`).then(setUsage).catch(() => setUsage([]));
    api<AdminPaymentIntent[]>(`/api/admin/tenants/${tenantId}/payment-intents?limit=50`).then(setIntents).catch(() => setIntents([]));
  }
  useEffect(load, [tenantId]);

  const ledgerStats = useMemo(() => {
    if (!ledger) return { credits: 0, charges: 0 };
    let credits = 0;
    let charges = 0;
    for (const r of ledger) {
      if (r.delta_micros > 0) credits += r.delta_micros;
      else charges += -r.delta_micros;
    }
    return { credits, charges };
  }, [ledger]);

  return (
    <>
      <PageHeader
        title={`Tenant #${tenantId} — wallet`}
        action={
          <div className="flex gap-2">
            <Link href={`/tenants/${tenantId}`}>
              <Button variant="ghost" size="sm">
                <ArrowLeft className="size-4" /> Back to tenant
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={load}>
              <RefreshCw className="size-4" /> Refresh
            </Button>
          </div>
        }
      />
      <div className="p-8 space-y-6">
        <PageDescription>
          Everything that moved money for this tenant. Adjustments and credit-limit changes land in audit_log with the
          actor super-admin id.
        </PageDescription>

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}

        {/* --- Balance + controls --- */}
        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-lg border bg-card p-4 md:col-span-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Current balance</div>
            <div className="mt-2 font-heading text-3xl font-medium">
              {wallet ? microsToUsd(wallet.balance_micros) : "—"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {wallet ? `${wallet.currency} · credit limit ${microsToUsd(wallet.credit_limit_micros)}` : ""}
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => setShowAdjust(true)} disabled={!wallet}>Adjust balance</Button>
              <Button size="sm" variant="outline" onClick={() => setShowLimit(true)} disabled={!wallet}>
                <ShieldCheck className="size-4" /> Credit limit
              </Button>
            </div>
          </div>
          <Stat label="Total credits" value={microsToUsd(ledgerStats.credits)} />
          <Stat label="Total charges" value={microsToUsd(ledgerStats.charges)} />
        </section>

        {/* --- Auto-reload status --- */}
        {wallet?.auto_reload_enabled && (
          <section className="rounded-lg border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Auto-reload</div>
            <div className="mt-1 text-sm">
              When balance drops below <strong>{microsToUsd(wallet.auto_reload_threshold_micros)}</strong>, charge{" "}
              <strong>{microsToUsd(wallet.auto_reload_amount_micros)}</strong>
              {wallet.auto_reload_payment_method_id
                ? <> on method #{wallet.auto_reload_payment_method_id}.</>
                : <> (no method set — won&apos;t fire).</>}
            </div>
          </section>
        )}

        {/* --- Payment intents --- */}
        <section className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-medium">Payment intents</h2>
            <span className="text-xs text-muted-foreground">{intents?.length ?? 0}</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Provider</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Ref</th>
              </tr>
            </thead>
            <tbody>
              {intents?.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No payment intents yet.</td></tr>
              )}
              {intents?.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="px-4 py-2 text-xs">{new Date(i.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2"><Badge variant="secondary">{i.provider}</Badge></td>
                  <td className="px-4 py-2 text-right font-mono">${(i.amount_cents / 100).toFixed(2)}</td>
                  <td className="px-4 py-2">
                    <Badge variant={i.status === "succeeded" ? "default" : "secondary"}>{i.status}</Badge>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs truncate max-w-[280px]" title={i.provider_ref}>
                    {i.provider_ref}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* --- Ledger --- */}
        <section className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-medium">Ledger</h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => downloadLedgerCsv(tenantId, ledger ?? [])}
              disabled={!ledger || ledger.length === 0}
            >
              <Download className="size-4" /> Export CSV
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2 text-right">Δ</th>
                <th className="px-4 py-2 text-right">Balance after</th>
                <th className="px-4 py-2">Ref</th>
                <th className="px-4 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {ledger?.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No ledger rows.</td></tr>
              )}
              {ledger?.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-2 text-xs">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2"><Badge variant="secondary">{r.reason}</Badge></td>
                  <td className={`px-4 py-2 text-right font-mono ${r.delta_micros < 0 ? "text-destructive" : ""}`}>
                    {microsToUsd(r.delta_micros, 4)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{microsToUsd(r.balance_after_micros)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.ref_kind ? `${r.ref_kind}:${r.ref_id}` : "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground truncate max-w-[280px]">{r.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* --- Usage --- */}
        <section className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-medium">Usage records</h2>
            <span className="text-xs text-muted-foreground">{usage?.length ?? 0}</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Kind</th>
                <th className="px-4 py-2 font-mono">External ref</th>
                <th className="px-4 py-2 text-right">Quantity</th>
                <th className="px-4 py-2 text-right">Billed</th>
              </tr>
            </thead>
            <tbody>
              {usage?.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No usage records.</td></tr>
              )}
              {usage?.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-2 text-xs">{new Date(r.occurred_at).toLocaleString()}</td>
                  <td className="px-4 py-2"><Badge variant="secondary">{r.kind}</Badge></td>
                  <td className="px-4 py-2 font-mono text-xs">{r.external_ref}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {(r.quantity_micros / 1_000_000).toFixed(2)} {r.unit}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{microsToUsd(r.billed_micros, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {showAdjust && wallet && (
        <AdjustDialog
          tenantId={tenantId}
          wallet={wallet}
          onClose={() => setShowAdjust(false)}
          onSaved={() => { setShowAdjust(false); load(); }}
        />
      )}
      {showLimit && wallet && (
        <CreditLimitDialog
          tenantId={tenantId}
          wallet={wallet}
          onClose={() => setShowLimit(false)}
          onSaved={() => { setShowLimit(false); load(); }}
        />
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 font-heading text-xl font-medium">{value}</div>
    </div>
  );
}

function downloadLedgerCsv(tenantId: number, rows: LedgerRow[]) {
  const header = "id,when,reason,delta_usd,balance_after_usd,ref_kind,ref_id,notes";
  const body = rows
    .map((r) =>
      [
        r.id,
        r.created_at,
        r.reason,
        (r.delta_micros / 1_000_000).toFixed(4),
        (r.balance_after_micros / 1_000_000).toFixed(4),
        r.ref_kind ?? "",
        r.ref_id ?? "",
        JSON.stringify(r.notes ?? ""),
      ].join(","),
    )
    .join("\n");
  const blob = new Blob([`${header}\n${body}\n`], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tenant-${tenantId}-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function AdjustDialog({
  tenantId,
  wallet,
  onClose,
  onSaved,
}: {
  tenantId: number;
  wallet: AdminWallet;
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
          <DialogTitle>Adjust balance</DialogTitle>
          <DialogDescription>
            Signed USD — positive credits, negative debits. Current balance{" "}
            <strong>{microsToUsd(wallet.balance_micros)}</strong>. Credit limit{" "}
            <strong>{microsToUsd(wallet.credit_limit_micros)}</strong>; debits below that are rejected.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Amount (USD)</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="-25.00" />
          </div>
          <div>
            <Label>Notes (audit log)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="comp credit, dispute, ..." />
          </div>
        </div>
        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !amount || !notes}>{busy ? "Saving…" : "Apply"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreditLimitDialog({
  tenantId,
  wallet,
  onClose,
  onSaved,
}: {
  tenantId: number;
  wallet: AdminWallet;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [usd, setUsd] = useState((wallet.credit_limit_micros / 1_000_000).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const n = Number(usd);
      if (!Number.isFinite(n) || n < 0) throw new Error("must be a non-negative number");
      await api(`/api/admin/tenants/${tenantId}/wallet/credit-limit`, {
        method: "POST",
        body: JSON.stringify({ credit_limit_micros: Math.round(n * 1_000_000) }),
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
          <DialogTitle>Credit limit</DialogTitle>
          <DialogDescription>
            How far below zero this tenant is allowed to go. Default 0 (strict no-negative). Use for invoiced /
            enterprise tenants who you bill separately.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label>Limit (USD)</Label>
          <Input value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="0.00" />
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
