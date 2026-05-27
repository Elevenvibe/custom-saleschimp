"use client";

/**
 * `/console` — dashboard landing for an authed tenant user.
 *
 * Today this is a thin "welcome + quick links" page. The richer dashboard
 * (active calls, recent spend, plan summary) comes in Step E follow-ups
 * as we migrate pages off app-ui.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Boxes, CreditCard, Sparkles, Wallet } from "lucide-react";

import { api, getToken } from "@/lib/api";

type WalletSummary = {
  tenant_id: number;
  balance_micros: number;
  currency: string;
};

function microsToUsd(m: number, d = 2) {
  const sign = m < 0 ? "-" : "";
  return `${sign}$${(Math.abs(m) / 1_000_000).toFixed(d)}`;
}

export default function DashboardPage() {
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Token is set by AuthGate at this point — safe to call /api/tenant/*.
    if (!getToken()) return;
    api<WalletSummary>("/api/tenant/wallet")
      .then(setWallet)
      .catch((e) => setError((e as Error).message));
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10 space-y-8">
      <div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
          <Sparkles className="size-3" /> Console
        </div>
        <h1 className="mt-1 text-2xl font-semibold">Welcome back</h1>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* Wallet quick-view */}
      <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-6">
        <div className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
          Current balance
        </div>
        <div className="mt-2 text-3xl font-semibold">
          {wallet ? microsToUsd(wallet.balance_micros) : "—"}
        </div>
        <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
          {wallet ? wallet.currency : "loading…"}
        </div>
        <Link
          href="/console/billing"
          className="mt-4 inline-block rounded-md border border-[color:var(--border)] px-3 py-1.5 text-sm hover:bg-[color:var(--muted)]"
        >
          Manage wallet →
        </Link>
      </section>

      {/* Quick links */}
      <section className="grid gap-3 md:grid-cols-3">
        <Tile href="/console/billing" icon={<Wallet className="size-4" />} title="Billing" body="Wallet, ledger, top-ups." />
        <Tile href="/console/billing/plans" icon={<CreditCard className="size-4" />} title="Plans" body="Switch tiers, pick intervals." />
        <Tile href="/console/marketplace" icon={<Boxes className="size-4" />} title="Marketplace" body="Browse + install plugins." />
      </section>
    </div>
  );
}

function Tile({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-4 hover:bg-[color:var(--muted)] transition"
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <div className="text-xs text-[color:var(--muted-foreground)]">{body}</div>
    </Link>
  );
}
