"use client";

/**
 * Settings → Cronjobs.
 *
 * Each background loop in the gateway renders as its own card with:
 *   - enabled / running flags
 *   - interval (env-driven)
 *   - last run timestamp + per-loop stats
 *   - "Run now" button to fire one iteration immediately
 *
 * Adding a new cron = drop another <CronCard endpoint=…> below — the
 * card is generic enough to render whatever JSON the status endpoint
 * returns, just by passing the field list.
 */

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { PageDescription } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, RefreshCw } from "lucide-react";

export default function CronjobPage() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Cronjobs</h2>
        <PageDescription>
          Background loops the gateway runs on a schedule. Intervals
          are env-driven (<code className="font-mono">GATEWAY_*_INTERVAL_SECONDS</code>);
          status reflects the live state of each loop.
        </PageDescription>
      </div>

      <CronCard
        title="Price sync"
        description="Scans every active cost provider and idempotently upserts catalog reference prices. Manual rows are left alone."
        statusUrl="/api/admin/price-sync/status"
        runUrl="/api/admin/price-sync/run"
        envFlag="GATEWAY_PRICE_SYNC_ENABLED"
        fields={[
          { key: "interval_seconds", label: "Interval", fmt: (v) => `every ${v}s` },
          { key: "last_run_at", label: "Last run", fmt: fmtTimestamp },
          { key: "last_providers", label: "Providers scanned (last)" },
          {
            key: "last_upserted",
            label: "Last results",
            fmt: (_v, s) => `upserted ${s.last_upserted} · skipped ${s.last_skipped}`,
          },
        ]}
      />

      <CronCard
        title="Mail fetcher"
        description="Pulls UNSEEN messages from every mailbox_configs row with imap_active=true via aioimaplib. Default 60s — pulls once a minute. Configure mailboxes under Settings → Email providers → IMAP."
        statusUrl="/api/admin/mail-cron/status"
        runUrl="/api/admin/mail-cron/run"
        envFlag="GATEWAY_MAIL_FETCHER_ENABLED"
        fields={[
          { key: "interval_seconds", label: "Interval", fmt: (v) => `every ${v}s` },
          { key: "last_run_at", label: "Last run", fmt: fmtTimestamp },
          { key: "last_fetched", label: "Messages fetched (last)" },
          { key: "last_errors", label: "Errors (last)" },
        ]}
      />
    </div>
  );
}

type FieldDef = {
  key: string;
  label: string;
  fmt?: (value: unknown, all: Record<string, unknown>) => string;
};

function CronCard({
  title,
  description,
  statusUrl,
  runUrl,
  envFlag,
  fields,
}: {
  title: string;
  description: string;
  statusUrl: string;
  runUrl: string;
  envFlag: string;
  fields: FieldDef[];
}) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    api<Record<string, unknown>>(statusUrl)
      .then(setStatus)
      .catch((e) => setError((e as Error).message));
  }
  useEffect(() => {
    load();
    // 15s auto-refresh so "last run" stays current without manual reloads.
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusUrl]);

  async function runNow() {
    setRunning(true);
    setError(null);
    try {
      await api(runUrl, { method: "POST" });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const enabled = status?.["enabled"] as boolean | undefined;
  const isRunning = status?.["running"] as boolean | undefined;

  return (
    <section className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-medium">{title}</div>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button onClick={runNow} disabled={running} size="sm">
            <Play className={`h-4 w-4 ${running ? "animate-pulse" : ""}`} />
            {running ? "Running…" : "Run now"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      {!status && !error && <div className="text-sm text-muted-foreground">Loading…</div>}
      {status && (
        <div className="grid grid-cols-2 gap-4 text-sm">
          <Field
            label="Enabled"
            value={
              <Badge variant={enabled ? "default" : "secondary"}>
                {enabled ? "yes" : `no — set ${envFlag}=true`}
              </Badge>
            }
          />
          <Field
            label="Running"
            value={
              <Badge variant={isRunning ? "default" : "secondary"}>
                {isRunning ? "yes" : "no"}
              </Badge>
            }
          />
          {fields.map((f) => {
            const value = status[f.key];
            const text = f.fmt ? f.fmt(value, status) : String(value ?? "—");
            return <Field key={f.key} label={f.label} value={text} />;
          })}
        </div>
      )}
    </section>
  );
}

function fmtTimestamp(v: unknown): string {
  if (!v || typeof v !== "string") return "—";
  return new Date(v).toLocaleString();
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-foreground">{value}</div>
    </div>
  );
}
