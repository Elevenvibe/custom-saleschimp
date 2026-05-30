"use client";

/**
 * CustomFields — renders + persists the admin-designed custom fields for a
 * given placement (entity) + record (entityId), via the shared values API.
 *
 * Drop it anywhere a record is shown (e.g. the tenant Profile tab) and it
 * fetches the active field definitions, renders the right input per type,
 * and saves through PUT /api/admin/custom-fields/values. Renders nothing
 * when no active fields exist for the placement, so hosts can mount it
 * unconditionally without an empty section appearing.
 */

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
type CField = {
  id: number;
  key: string;
  label: string;
  field_type: string;
  options: Option[];
  required: boolean;
  help_text: string | null;
  placeholder: string | null;
};
type ValuesOut = {
  entity: string;
  entity_id: string;
  fields: CField[];
  values: Record<string, string | null>;
};

export function CustomFields({
  entity,
  entityId,
  title = "Custom fields",
}: {
  entity: string;
  entityId: string | number;
  title?: string;
}) {
  const [data, setData] = useState<ValuesOut | null>(null);
  const [vals, setVals] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api<ValuesOut>(`/api/admin/custom-fields/values?entity=${entity}&entity_id=${entityId}`)
      .then((d) => {
        setData(d);
        const m: Record<number, string> = {};
        for (const f of d.fields) m[f.id] = d.values[String(f.id)] ?? "";
        setVals(m);
      })
      .catch((e) => setErr((e as Error).message));
  }, [entity, entityId]);
  useEffect(load, [load]);

  if (!data || data.fields.length === 0) return null;

  function set(id: number, v: string) {
    setVals((p) => ({ ...p, [id]: v }));
    setOk(null);
  }

  // multiselect helpers — value stored as JSON array string.
  function multi(id: number): string[] {
    try {
      const v = vals[id];
      return v ? (JSON.parse(v) as string[]) : [];
    } catch {
      return [];
    }
  }
  function toggleMulti(id: number, value: string, on: boolean) {
    const cur = new Set(multi(id));
    if (on) cur.add(value);
    else cur.delete(value);
    set(id, JSON.stringify([...cur]));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const payload: Record<number, string | null> = {};
      for (const f of data!.fields) payload[f.id] = vals[f.id] || null;
      await api("/api/admin/custom-fields/values", {
        method: "PUT",
        body: JSON.stringify({ entity, entity_id: String(entityId), values: payload }),
      });
      setOk("Saved.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {data.fields.map((f) => (
          <div key={f.id} className={f.field_type === "textarea" || f.field_type === "multiselect" ? "sm:col-span-2" : undefined}>
            <Label htmlFor={`cf-${f.id}`}>
              {f.label}
              {f.required && <span className="ml-0.5 text-destructive">*</span>}
            </Label>
            <FieldInput field={f} value={vals[f.id] ?? ""} onChange={(v) => set(f.id, v)} multi={multi} toggleMulti={toggleMulti} />
            {f.help_text && <p className="mt-0.5 text-xs text-muted-foreground">{f.help_text}</p>}
          </div>
        ))}
      </div>

      {err && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
      {ok && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>}
      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save custom fields"}</Button>
      </div>
    </section>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  multi,
  toggleMulti,
}: {
  field: CField;
  value: string;
  onChange: (v: string) => void;
  multi: (id: number) => string[];
  toggleMulti: (id: number, value: string, on: boolean) => void;
}) {
  const id = `cf-${field.id}`;
  switch (field.field_type) {
    case "textarea":
      return (
        <textarea
          id={id}
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          rows={3}
          value={value}
          placeholder={field.placeholder ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "boolean":
      return (
        <div className="mt-1">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={value === "true"}
              onChange={(e) => onChange(e.target.checked ? "true" : "false")}
            />
            {value === "true" ? "Yes" : "No"}
          </label>
        </div>
      );
    case "select":
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id}>
            <SelectValue placeholder={field.placeholder ?? "Select…"} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "multiselect": {
      const sel = new Set(multi(field.id));
      return (
        <div className="mt-1 flex flex-wrap gap-3">
          {field.options.map((o) => (
            <label key={o.value} className="inline-flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={sel.has(o.value)}
                onChange={(e) => toggleMulti(field.id, o.value, e.target.checked)}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case "number":
      return <Input id={id} type="number" value={value} placeholder={field.placeholder ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "date":
      return <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
    case "email":
      return <Input id={id} type="email" value={value} placeholder={field.placeholder ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "url":
      return <Input id={id} type="url" value={value} placeholder={field.placeholder ?? ""} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <Input id={id} value={value} placeholder={field.placeholder ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
}
