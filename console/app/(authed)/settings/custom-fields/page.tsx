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

type Option = { value: string; label: string };
type Field = {
  id: number;
  key: string;
  label: string;
  field_type: string;
  options: Option[];
  required: boolean;
  help_text: string | null;
  placeholder: string | null;
};
type Cfg = { fields: Field[]; values: Record<string, string | null> };

export default function CustomFieldsPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [vals, setVals] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Cfg>("/api/tenant/settings/custom-fields")
      .then((d) => {
        setCfg(d);
        const m: Record<number, string> = {};
        for (const f of d.fields) m[f.id] = d.values[String(f.id)] ?? "";
        setVals(m);
      })
      .catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);

  async function save() {
    if (!cfg) return;
    setBusy(true); setErr(null); setOk(null);
    try {
      const payload: Record<number, string | null> = {};
      for (const f of cfg.fields) payload[f.id] = vals[f.id] || null;
      await api("/api/tenant/settings/custom-fields", { method: "PUT", body: JSON.stringify({ values: payload }) });
      setOk("Saved.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (!cfg) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <header>
        <h1 className="text-xl font-semibold">Custom fields</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Extra fields your platform administrator added to your organization record. Fill them in to keep them aligned with your team.
        </p>
      </header>
      {cfg.fields.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 p-12 text-center text-sm text-muted-foreground">
          Your platform administrator hasn&apos;t added any custom fields for organizations yet.
        </div>
      ) : (
        <section className="space-y-4 rounded-lg border bg-card p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {cfg.fields.map((f) => (
              <div key={f.id} className={f.field_type === "textarea" || f.field_type === "multiselect" ? "sm:col-span-2" : undefined}>
                <Label>{f.label}{f.required && <span className="ml-0.5 text-destructive">*</span>}</Label>
                <Input
                  value={vals[f.id] ?? ""}
                  onChange={(e) => { setVals({ ...vals, [f.id]: e.target.value }); setOk(null); }}
                  placeholder={f.placeholder ?? ""}
                  type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : f.field_type === "email" ? "email" : f.field_type === "url" ? "url" : "text"}
                />
                {f.help_text && <p className="mt-0.5 text-xs text-muted-foreground">{f.help_text}</p>}
              </div>
            ))}
          </div>
          {err && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
          {ok && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>}
          <div className="flex justify-end"><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button></div>
        </section>
      )}
    </div>
  );
}
