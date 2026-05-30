"use client";

/**
 * Settings → Seed Settings.
 *
 * Two tabs:
 *   Settings   demo tenant, demo reset interval, demo CRUD lock, source
 *              tenant new accounts derive seeded rows from.
 *   Seed Table  the catalog of tables (control + dograh) that get cloned
 *              when seeding. Toggle which ones participate; refresh
 *              re-introspects both DBs and picks up new tables.
 *
 * A background cron refreshes the catalog every hour, and a separate cron
 * resets the demo tenant on the configured interval.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, RotateCw, Sprout } from "lucide-react";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TenantRef = { id: number; name: string; slug: string };
type SnapshotCfg = {
  demo_enabled: boolean;
  demo_tenant_id: number | null;
  demo_reset_hours: number;
  demo_crud_enabled: boolean;
  seed_source_tenant_id: number | null;
  last_refresh_at: string | null;
  last_reset_at: string | null;
};
type Snapshot = {
  config: SnapshotCfg;
  tenants: TenantRef[];
  enabled_table_count: number;
  total_table_count: number;
};
type CatalogRow = {
  id: number;
  schema: string;
  name: string;
  scope_column: string;
  description: string | null;
  enabled: boolean;
  last_seen_at: string;
};

export default function SeedSettingsPage() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Snapshot>("/api/admin/seed")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      </div>
    );
  }
  if (!data) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <header>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Sprout className="size-5 text-primary" /> Seed Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pre-configure new tenants from a source tenant&apos;s rows, and run a
          self-resetting demo workspace. The catalog refreshes hourly so new
          feature tables show up automatically.
        </p>
      </header>

      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="tables">
            Seed Table
            <span className="ml-1 text-xs text-muted-foreground">
              ({data.enabled_table_count}/{data.total_table_count})
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="mt-4">
          <SettingsTab data={data} onSaved={load} />
        </TabsContent>
        <TabsContent value="tables" className="mt-4">
          <CatalogTab onChanged={load} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SettingsTab({ data, onSaved }: { data: Snapshot; onSaved: () => void }) {
  const [demoEnabled, setDemoEnabled] = useState(data.config.demo_enabled);
  const [demoTenant, setDemoTenant] = useState<string>(
    data.config.demo_tenant_id ? String(data.config.demo_tenant_id) : "",
  );
  const [resetHours, setResetHours] = useState<string>(String(data.config.demo_reset_hours));
  const [crudEnabled, setCrudEnabled] = useState(data.config.demo_crud_enabled);
  const [sourceTenant, setSourceTenant] = useState<string>(
    data.config.seed_source_tenant_id ? String(data.config.seed_source_tenant_id) : "",
  );
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const hours = Number(resetHours);
      if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
        throw new Error("Reset interval must be 1–168 hours.");
      }
      await api("/api/admin/seed", {
        method: "PUT",
        body: JSON.stringify({
          demo_enabled: demoEnabled,
          demo_tenant_id: demoEnabled ? Number(demoTenant) || null : null,
          demo_reset_hours: hours,
          demo_crud_enabled: crudEnabled,
          seed_source_tenant_id: sourceTenant ? Number(sourceTenant) : null,
        }),
      });
      setOk("Saved.");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resetNow() {
    if (!confirm("Reset the demo tenant now? Its data will be wiped and re-seeded.")) return;
    setResetBusy(true);
    setErr(null);
    setOk(null);
    try {
      const r = await api<{ wiped_control_tables?: number; reseeded?: { control_rows?: number } }>(
        "/api/admin/seed/reset-demo",
        { method: "POST" },
      );
      setOk(
        `Reset done — wiped ${r.wiped_control_tables ?? 0} table(s), re-seeded ${
          r.reseeded?.control_rows ?? 0
        } rows.`,
      );
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="text-sm font-medium">Source tenant</h2>
        <p className="text-xs text-muted-foreground">
          New tenants inherit enabled-catalog rows from this tenant when they
          become active. Leave empty to skip auto-seed.
        </p>
        <div>
          <Label>Seed from</Label>
          <Select value={sourceTenant} onValueChange={setSourceTenant}>
            <SelectTrigger>
              <SelectValue placeholder="— Choose a source tenant —" />
            </SelectTrigger>
            <SelectContent>
              {data.tenants.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.name} <span className="text-muted-foreground">({t.slug})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium">Demo mode</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              A self-resetting demo workspace for prospects. CRUD can be
              locked so visitors can browse but not change anything.
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={demoEnabled}
              onChange={(e) => { setDemoEnabled(e.target.checked); setOk(null); }}
            />
            <span className="relative inline-block h-5 w-9 rounded-full bg-muted transition peer-checked:bg-primary">
              <span className="absolute left-0.5 top-0.5 inline-block size-4 rounded-full bg-background transition peer-checked:translate-x-4" />
            </span>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Demo tenant</Label>
            <Select value={demoTenant} onValueChange={setDemoTenant}>
              <SelectTrigger>
                <SelectValue placeholder="— Choose a tenant —" />
              </SelectTrigger>
              <SelectContent>
                {data.tenants.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Reset interval (hours)</Label>
            <Input
              type="number"
              min={1}
              max={168}
              value={resetHours}
              onChange={(e) => setResetHours(e.target.value)}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={crudEnabled}
            onChange={(e) => { setCrudEnabled(e.target.checked); setOk(null); }}
          />
          Allow CRUD on the demo account
          <span className="text-xs text-muted-foreground">
            (when off, mutations on the demo workspace return 403)
          </span>
        </label>

        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <div>
            Last catalog refresh:{" "}
            {data.config.last_refresh_at
              ? new Date(data.config.last_refresh_at).toLocaleString()
              : "—"}
          </div>
          <div>
            Last demo reset:{" "}
            {data.config.last_reset_at
              ? new Date(data.config.last_reset_at).toLocaleString()
              : "—"}
          </div>
        </div>

        {err && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
        {ok && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={resetBusy || !data.config.demo_enabled} onClick={resetNow}>
            {resetBusy ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
            {resetBusy ? "Resetting…" : "Reset demo now"}
          </Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </section>
    </div>
  );
}

function CatalogTab({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<CatalogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "control" | "dograh">("all");

  const load = useCallback(() => {
    api<CatalogRow[]>("/api/admin/seed/tables")
      .then(setRows)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      await api("/api/admin/seed/refresh", { method: "POST" });
      load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function toggle(row: CatalogRow, enabled: boolean) {
    try {
      await api(`/api/admin/seed/tables/${row.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      setRows((p) => p?.map((r) => (r.id === row.id ? { ...r, enabled } : r)) ?? p);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const visible = useMemo(
    () => (rows ?? []).filter((r) => filter === "all" || r.schema === filter),
    [rows, filter],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Tables discovered in both databases. Enable a table to clone its rows
          for the active scope into a new tenant. Re-run refresh after a
          migration so new feature tables show up.
        </p>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All schemas</SelectItem>
              <SelectItem value="control">Control DB</SelectItem>
              <SelectItem value="dograh">Dograh DB</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" disabled={refreshing} onClick={refresh}>
            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Table</th>
              <th className="px-3 py-2">Schema</th>
              <th className="px-3 py-2">Scope column</th>
              <th className="px-3 py-2">Last seen</th>
              <th className="px-3 py-2 text-right">Enabled</th>
            </tr>
          </thead>
          <tbody>
            {!rows ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No tables — try Refresh.</td></tr>
            ) : (
              visible.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{r.name}</td>
                  <td className="px-3 py-2">
                    <Badge variant="secondary">{r.schema}</Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground"><code className="text-xs">{r.scope_column}</code></td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(r.last_seen_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={r.enabled}
                      onChange={(e) => toggle(r, e.target.checked)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
