"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
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

type AppCfg = {
  date_format: string;
  time_format: "12h" | "24h";
  default_timezone: string;
  default_currency: string;
  language: string;
  datatable_rows: number;
  enable_employee_export: boolean;
};

export default function AppSettingsPage() {
  const [cfg, setCfg] = useState<AppCfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api<AppCfg>("/api/tenant/settings/app")
      .then(setCfg)
      .catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);

  function set<K extends keyof AppCfg>(k: K, v: AppCfg[K]) {
    if (!cfg) return;
    setCfg({ ...cfg, [k]: v });
    setOk(null);
  }

  async function save() {
    if (!cfg) return;
    setBusy(true); setErr(null); setOk(null);
    try {
      const updated = await api<AppCfg>("/api/tenant/settings/app", {
        method: "PUT",
        body: JSON.stringify(cfg),
      });
      setCfg(updated);
      setOk("Saved.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (!cfg) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <header>
        <h1 className="text-xl font-semibold">App settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Workspace defaults applied across your dashboards, tables and exports.
        </p>
      </header>
      <section className="grid gap-4 rounded-lg border bg-card p-6 sm:grid-cols-2">
        <div>
          <Label>Date format</Label>
          <Select value={cfg.date_format} onValueChange={(v) => set("date_format", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
              <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
              <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
              <SelectItem value="DD MMM YYYY">DD MMM YYYY</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Time format</Label>
          <Select value={cfg.time_format} onValueChange={(v) => set("time_format", v as "12h" | "24h")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="12h">12-hour (1:30 PM)</SelectItem>
              <SelectItem value="24h">24-hour (13:30)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Default timezone</Label>
          <Input value={cfg.default_timezone} onChange={(e) => set("default_timezone", e.target.value)} placeholder="UTC, Africa/Lagos, …" />
        </div>
        <div>
          <Label>Default currency</Label>
          <Input value={cfg.default_currency} onChange={(e) => set("default_currency", e.target.value.toUpperCase())} placeholder="USD" />
        </div>
        <div>
          <Label>Language</Label>
          <Select value={cfg.language} onValueChange={(v) => set("language", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Datatable rows per page</Label>
          <Input type="number" min={5} max={200} value={cfg.datatable_rows} onChange={(e) => set("datatable_rows", Number(e.target.value || 25))} />
        </div>
        <label className="sm:col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={cfg.enable_employee_export} onChange={(e) => set("enable_employee_export", e.target.checked)} />
          Allow employees to export data
        </label>
        {err && <div className="sm:col-span-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
        {ok && <div className="sm:col-span-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>}
        <div className="sm:col-span-2 flex justify-end">
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </section>
    </div>
  );
}
