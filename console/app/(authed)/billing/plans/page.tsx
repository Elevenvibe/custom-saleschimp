"use client";

/**
 * /console/billing/plans — pick or upgrade your plan.
 *
 * Ported from app-ui/app/(authed)/billing/plans/page.tsx. Reads the visible
 * package list from /api/tenant/plans, lets the org_admin select one, and
 * surfaces a Contact Sales button for `contact_sales=true` plans (the
 * gateway rejects self-select on those by design).
 */

import { useEffect, useState } from "react";

import { api, type Plan, type PlansRes } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, MessageCircle, Sparkles } from "lucide-react";

const MICROS_PER_UNIT = 1_000_000;

function fmtCurrency(cents: number, currency: string): string {
  return `${currency} $${(cents / 100).toFixed(2)}`;
}

function fmtMicrosPerUnit(micros: number, unit: string): string {
  if (micros === 0) return "free";
  return `$${(micros / MICROS_PER_UNIT).toFixed(4)}/${unit}`;
}

const INTERVAL_SHORT: Record<string, string> = {
  monthly: "mo",
  annual: "yr",
  usage: "use",
  per_sec: "sec",
  per_min: "min",
  per_hour: "hr",
  per_day: "day",
  per_week: "wk",
};

export default function ConsolePlansPage() {
  const [data, setData] = useState<PlansRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<number | null>(null);

  function load() {
    setError(null);
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
    <div className="mx-auto max-w-5xl px-8 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Sparkles className="size-6" /> Plans
        </h1>
        <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
          Bundled minutes include every provider used during a call (LLM, TTS, STT, telephony).
          Overage cost applies once you exceed the bundle.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {!data && <div className="text-sm text-[color:var(--muted-foreground)]">Loading plans…</div>}

      {data && data.plans.length === 0 && (
        <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--card)] p-8 text-center text-sm text-[color:var(--muted-foreground)]">
          No plans published yet. Contact your admin.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {data?.plans.map((p) => {
          const current = data.current_plan_id === p.id;
          const unit = INTERVAL_SHORT[p.billing_period] ?? p.billing_period;
          return (
            <div
              key={p.id}
              className={`rounded-lg border p-6 ${
                current
                  ? "border-[color:var(--primary)] bg-[color:var(--primary)]/5"
                  : "border-[color:var(--border)] bg-[color:var(--card)]"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-lg font-semibold">{p.name}</div>
                  <div className="text-xs font-mono text-[color:var(--muted-foreground)]">
                    {p.slug}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant={p.kind === "annual" ? "default" : "secondary"}>{p.kind}</Badge>
                  {current && (
                    <Badge>
                      <CheckCircle2 className="size-3" /> Current
                    </Badge>
                  )}
                </div>
              </div>

              {p.description && (
                <p className="mt-3 text-sm text-[color:var(--muted-foreground)]">{p.description}</p>
              )}

              <div className="mt-4 space-y-1 text-sm">
                <div>
                  <span className="font-semibold">
                    {p.usage_only || p.contact_sales
                      ? "—"
                      : `${fmtCurrency(p.monthly_price_cents, p.currency)}/${unit}`}
                  </span>
                </div>
                <div className="text-xs text-[color:var(--muted-foreground)]">
                  {p.bundled_minutes > 0
                    ? `${p.bundled_minutes.toLocaleString()} ${unit} bundled · `
                    : ""}
                  Overage {fmtMicrosPerUnit(p.overage_per_minute_micros, unit)}
                </div>
                {p.concurrency_included > 0 && (
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    {p.concurrency_included} concurrent call{p.concurrency_included === 1 ? "" : "s"}
                  </div>
                )}
                {p.allowed_provider_kinds.length > 0 && (
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    Providers: {p.allowed_provider_kinds.join(", ")}
                  </div>
                )}
              </div>

              <div className="mt-5">
                {p.contact_sales ? (
                  <Button variant="outline" onClick={() => select(p)} className="w-full">
                    <MessageCircle className="size-4" /> Contact Sales
                  </Button>
                ) : (
                  <Button
                    onClick={() => select(p)}
                    disabled={current || selectingId === p.id}
                    className="w-full"
                    variant={current ? "outline" : "default"}
                  >
                    {current ? "Current plan" : selectingId === p.id ? "Switching…" : "Choose plan"}
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
