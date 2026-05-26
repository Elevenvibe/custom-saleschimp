"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { api, type Plan, type PlansRes } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, MessageCircle, Sparkles } from "lucide-react";

const MICROS_PER_UNIT = 1_000_000;

function fmtCurrency(cents: number, currency: string): string {
  return `${currency} $${(cents / 100).toFixed(2)}`;
}

function fmtMicrosPerMin(micros: number): string {
  if (micros === 0) return "free";
  return `$${(micros / MICROS_PER_UNIT).toFixed(4)}/min`;
}

export default function PlansPage() {
  const [data, setData] = useState<PlansRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<number | null>(null);

  function load() {
    api<PlansRes>("/api/tenant/plans").then(setData).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function select(plan: Plan) {
    if (plan.contact_sales) {
      window.location.href = `mailto:sales@mysaleschimp.com?subject=${encodeURIComponent(
        `Interested in ${plan.name}`,
      )}`;
      return;
    }
    setSelectingId(plan.id);
    setError(null);
    try {
      const r = await api<PlansRes>("/api/tenant/me/plan", {
        method: "POST",
        body: JSON.stringify({ package_id: plan.id }),
      });
      setData(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSelectingId(null);
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex aspect-square size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </div>
          <div>
            <div className="text-lg font-semibold">Plans</div>
            <div className="text-sm text-muted-foreground">
              Bundled minutes include every provider used during a call (LLM, TTS, STT, telephony). Overage cost
              applies once you exceed the bundle.
            </div>
          </div>
        </div>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Dashboard
        </Link>
      </div>

      {error && (
        <div className="mb-6 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      {!data && <div className="text-sm text-muted-foreground">Loading plans…</div>}
      {data && data.plans.length === 0 && (
        <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">
          No plans available yet. Your platform admin will publish them shortly.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data?.plans.map((p) => {
          const isCurrent = data.current_plan_id === p.id;
          const isAnnualContactSales = p.contact_sales;
          return (
            <div
              key={p.id}
              className={`flex flex-col rounded-lg border bg-card p-6 ${
                isCurrent ? "border-primary shadow-sm" : ""
              }`}
            >
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <div className="text-lg font-semibold">{p.name}</div>
                  <Badge variant={p.kind === "annual" ? "default" : "secondary"} className="mt-1">
                    {p.kind.toUpperCase()}
                  </Badge>
                  {isCurrent && (
                    <Badge variant="outline" className="ml-1 mt-1 border-primary text-primary">
                      <CheckCircle2 className="mr-1 size-3" /> Current
                    </Badge>
                  )}
                </div>
              </div>

              {p.description && (
                <div className="mb-4 text-sm text-muted-foreground">{p.description}</div>
              )}

              <div className="mb-4">
                {isAnnualContactSales ? (
                  <div className="text-2xl font-semibold">Custom</div>
                ) : (
                  <div className="flex items-baseline gap-1">
                    <div className="text-3xl font-semibold">
                      {fmtCurrency(p.monthly_price_cents, p.currency)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      / {p.billing_period === "annual" ? "year" : "month"}
                    </div>
                  </div>
                )}
              </div>

              <ul className="mb-6 space-y-1.5 text-sm">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary" />
                  <span>
                    <strong>{p.bundled_minutes.toLocaleString()}</strong> bundled minutes
                    {p.billing_period === "annual" ? " / year" : " / month"}
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary" />
                  <span>
                    Overage:{" "}
                    {isAnnualContactSales ? "custom" : fmtMicrosPerMin(p.overage_per_minute_micros)}
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary" />
                  <span>
                    Concurrency:{" "}
                    {p.concurrency_included > 0
                      ? `${p.concurrency_included} included`
                      : isAnnualContactSales
                      ? "custom"
                      : "pay-per-use"}
                  </span>
                </li>
                {p.plugins.length > 0 && (
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-primary" />
                    <span>{p.plugins.length} plugins included</span>
                  </li>
                )}
              </ul>

              <div className="mt-auto">
                {isAnnualContactSales ? (
                  <Button variant="default" className="w-full" onClick={() => select(p)}>
                    <MessageCircle className="size-4" /> Contact sales
                  </Button>
                ) : isCurrent ? (
                  <Button variant="outline" className="w-full" disabled>
                    Current plan
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    className="w-full"
                    onClick={() => select(p)}
                    disabled={selectingId === p.id}
                  >
                    {selectingId === p.id ? "Selecting…" : `Select ${p.name}`}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
