"use client";

import { useEffect, useState } from "react";

import { api, type PriceSyncRunRes, type PriceSyncStatus } from "@/lib/api";
import { PageDescription } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, RefreshCw } from "lucide-react";

export default function CronjobPage() {
  const [status, setStatus] = useState<PriceSyncStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRunResult, setLastRunResult] = useState<PriceSyncRunRes | null>(null);

  function load() {
    api<PriceSyncStatus>("/api/admin/price-sync/status").then(setStatus).catch((e) => setError(e.message));
  }
  useEffect(() => {
    load();
    // Refresh every 15s so the "last run" timestamp stays current without page reloads.
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  async function runNow() {
    setRunning(true);
    setError(null);
    try {
      const r = await api<PriceSyncRunRes>("/api/admin/price-sync/run", { method: "POST" });
      setLastRunResult(r);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Price sync cronjob</h2>
        <PageDescription>
          The gateway scans every active cost provider on an interval and idempotently upserts catalog reference
          prices for any <code className="font-mono">(variant, unit)</code> without a row. Existing manual prices are
          left alone.
        </PageDescription>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <section className="rounded-lg border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-medium">Status</div>
          <Button variant="ghost" size="sm" onClick={load} disabled={!status}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
        {!status && <div className="text-sm text-muted-foreground">Loading…</div>}
        {status && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Field
              label="Enabled"
              value={
                <Badge variant={status.enabled ? "default" : "secondary"}>
                  {status.enabled ? "yes" : "no — set GATEWAY_PRICE_SYNC_ENABLED=true"}
                </Badge>
              }
            />
            <Field
              label="Running"
              value={
                <Badge variant={status.running ? "default" : "secondary"}>
                  {status.running ? "yes" : "no"}
                </Badge>
              }
            />
            <Field label="Interval" value={`every ${status.interval_seconds}s`} />
            <Field
              label="Last run"
              value={status.last_run_at ? new Date(status.last_run_at).toLocaleString() : "—"}
            />
            <Field
              label="Providers scanned (last)"
              value={String(status.last_providers)}
            />
            <Field
              label="Last results"
              value={`upserted ${status.last_upserted} · skipped ${status.last_skipped}`}
            />
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card p-5 space-y-3">
        <div className="font-medium">Run now</div>
        <p className="text-sm text-muted-foreground">
          Trigger an iteration immediately without waiting for the next tick. Returns the per-iteration stats and
          refreshes the status block above.
        </p>
        <div className="flex items-center gap-3">
          <Button onClick={runNow} disabled={running}>
            <Play className={`h-4 w-4 ${running ? "animate-pulse" : ""}`} />
            {running ? "Running…" : "Run now"}
          </Button>
          {lastRunResult && (
            <div className="text-sm text-muted-foreground">
              Done — scanned {lastRunResult.providers} providers, upserted{" "}
              <span className="font-medium text-foreground">{lastRunResult.upserted}</span>, skipped{" "}
              {lastRunResult.skipped}.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-foreground">{value}</div>
    </div>
  );
}
