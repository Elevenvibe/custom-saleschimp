"use client";

/**
 * /console/observe/metrics — tenant-side metrics overview.
 *
 * KPI cards (wallet balance, 30-day call count, 30-day spend) plus a
 * lightweight daily bar chart of calls over the last 30 days. All data
 * comes from existing customer endpoints — no new gateway work needed:
 *   - /api/tenant/wallet         → balance + recent spend totals
 *   - /api/tenant/usage/daily    → daily bucket of call count + cost
 *
 * A full dashboard (success-rate, avg duration, per-workflow breakdown)
 * comes in P3.4 once the gateway exposes per-workflow rollups; for now
 * we keep the surface focused on the numbers tenants ask for most.
 */

import { useEffect, useMemo, useState } from "react";

import { api, type UsageDailyBucket, type WalletSummary } from "@/lib/api";

export default function MetricsPage() {
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [daily, setDaily] = useState<UsageDailyBucket[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<WalletSummary>("/api/tenant/wallet")
      .then(setWallet)
      .catch((e) => setError((e as Error).message));
    api<UsageDailyBucket[]>("/api/tenant/usage/daily?days=30")
      .then(setDaily)
      .catch(() => {});
  }, []);

  // The daily endpoint returns billed_micros (1 USD = 1_000_000 micros)
  // and call_count. We surface "spend" in cents to match the wallet card.
  const totals = useMemo(() => {
    let calls = 0;
    let micros = 0;
    for (const d of daily) {
      calls += d.call_count ?? 0;
      micros += d.billed_micros ?? 0;
    }
    return { calls, cents: Math.round(micros / 10_000) };
  }, [daily]);

  const maxCalls = useMemo(
    () => daily.reduce((acc, d) => Math.max(acc, d.call_count ?? 0), 0),
    [daily],
  );

  if (error && !wallet) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Metrics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Last 30 days of voice activity.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard
          label="Wallet balance"
          value={
            wallet
              ? (wallet.balance_micros / 1_000_000).toLocaleString(undefined, {
                  style: "currency",
                  currency: wallet.currency || "USD",
                })
              : "Loading…"
          }
        />
        <KpiCard label="Calls (30d)" value={totals.calls.toLocaleString()} />
        <KpiCard
          label="Spend (30d)"
          value={(totals.cents / 100).toLocaleString(undefined, {
            style: "currency",
            currency: wallet?.currency || "USD",
          })}
        />
      </div>

      <section className="rounded-lg border bg-card p-5">
        <div className="mb-3 text-sm font-medium">Calls per day</div>
        {daily.length === 0 ? (
          <div className="text-sm text-muted-foreground">No call activity in the window.</div>
        ) : (
          <div className="flex items-end gap-1 h-32">
            {daily.map((d) => {
              const h = maxCalls > 0 ? Math.round(((d.call_count ?? 0) / maxCalls) * 100) : 0;
              return (
                <div
                  key={d.day}
                  className="flex-1 flex flex-col items-center gap-1"
                  title={`${d.day}: ${d.call_count ?? 0} calls`}
                >
                  <div
                    className="w-full rounded-sm bg-primary/70"
                    style={{ height: `${h}%`, minHeight: d.call_count ? "2px" : "0" }}
                  />
                </div>
              );
            })}
          </div>
        )}
        {daily.length > 0 && (
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
            <span>{daily[0]?.day}</span>
            <span>{daily[daily.length - 1]?.day}</span>
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
