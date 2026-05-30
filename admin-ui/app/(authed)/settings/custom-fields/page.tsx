"use client";

/**
 * Settings → Custom fields (the field builder).
 *
 * Super-admins design fields scoped to a placement (entity) — tenant,
 * tenant user, workflow, or platform-wide. Each field has a type, optional
 * select options, required flag, help text + placeholder. Fields are
 * reorderable; consumers render them via the shared values API (see
 * components/CustomFields.tsx, wired into the tenant Profile tab).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  entity: string;
  key: string;
  label: string;
  field_type: string;
  options: Option[];
  required: boolean;
  help_text: string | null;
  placeholder: string | null;
  sort_order: number;
  active: boolean;
};
type Entity = { key: string; label: string };

const OPTION_TYPES = new Set(["select", "multiselect"]);

export default function CustomFieldsPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [fieldTypes, setFieldTypes] = useState<string[]>([]);
  const [entity, setEntity] = useState<string>("tenant");
  const [fields, setFields] = useState<CField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CField | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api<{ entities: Entity[]; field_types: string[] }>("/api/admin/custom-fields/entities")
      .then((d) => {
        setEntities(d.entities);
        setFieldTypes(d.field_types);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const load = useCallback(() => {
    api<CField[]>(`/api/admin/custom-fields?entity=${entity}`)
      .then(setFields)
      .catch((e) => setError((e as Error).message));
  }, [entity]);
  useEffect(load, [load]);

  async function remove(f: CField) {
    if (!confirm(`Delete field "${f.label}"? Existing values for this field will be removed.`)) return;
    try {
      await api(`/api/admin/custom-fields/${f.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function move(idx: number, dir: -1 | 1) {
    const next = [...fields];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setFields(next);
    try {
      await api("/api/admin/custom-fields/reorder", {
        method: "POST",
        body: JSON.stringify({ entity, ids: next.map((f) => f.id) }),
      });
    } catch (e) {
      setError((e as Error).message);
      load();
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Custom fields</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Design fields and attach them to a placement. Consumers render them
            wherever that placement appears.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" /> Add field
        </Button>
      </header>

      <div className="flex items-center gap-3">
        <Label className="text-sm">Placement</Label>
        <Select value={entity} onValueChange={setEntity}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {entities.map((e) => (
              <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Field</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Required</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Order / actions</th>
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No fields for this placement yet.
                </td>
              </tr>
            )}
            {fields.map((f, i) => (
              <tr key={f.id} className="border-t">
                <td className="px-4 py-2">
                  <div className="font-medium">{f.label}</div>
                  <code className="text-xs text-muted-foreground">{f.key}</code>
                  {f.help_text && <div className="text-xs text-muted-foreground">{f.help_text}</div>}
                </td>
                <td className="px-4 py-2">
                  <Badge variant="secondary">{f.field_type}</Badge>
                  {OPTION_TYPES.has(f.field_type) && (
                    <span className="ml-1 text-xs text-muted-foreground">({f.options.length})</span>
                  )}
                </td>
                <td className="px-4 py-2">{f.required ? "Yes" : "—"}</td>
                <td className="px-4 py-2">
                  <Badge variant={f.active ? "default" : "secondary"}>
                    {f.active ? "active" : "hidden"}
                  </Badge>
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" disabled={i === fields.length - 1} onClick={() => move(i, 1)} title="Move down">
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setEditing(f)} title="Edit">
                      <Pencil className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(f)} title="Delete">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <FieldDialog
          entity={entity}
          fieldTypes={fieldTypes}
          existing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function FieldDialog({
  entity,
  fieldTypes,
  existing,
  onClose,
  onSaved,
}: {
  entity: string;
  fieldTypes: string[];
  existing: CField | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(existing?.label ?? "");
  const [type, setType] = useState(existing?.field_type ?? "text");
  const [options, setOptions] = useState<Option[]>(existing?.options ?? []);
  const [required, setRequired] = useState(existing?.required ?? false);
  const [helpText, setHelpText] = useState(existing?.help_text ?? "");
  const [placeholder, setPlaceholder] = useState(existing?.placeholder ?? "");
  const [active, setActive] = useState(existing?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsOptions = useMemo(() => OPTION_TYPES.has(type), [type]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const cleanOpts = options
        .map((o) => ({ value: o.value.trim(), label: o.label.trim() || o.value.trim() }))
        .filter((o) => o.value);
      if (needsOptions && cleanOpts.length === 0) {
        throw new Error("Add at least one option for this field type.");
      }
      const payload = {
        label,
        field_type: type,
        options: needsOptions ? cleanOpts : [],
        required,
        help_text: helpText || null,
        placeholder: placeholder || null,
        active,
      };
      if (existing) {
        await api(`/api/admin/custom-fields/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await api("/api/admin/custom-fields", {
          method: "POST",
          body: JSON.stringify({ entity, ...payload }),
        });
      }
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit field" : "New field"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Account Manager" />
            {existing && <p className="mt-1 text-xs text-muted-foreground">Key: <code>{existing.key}</code> (immutable)</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fieldTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-4 pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={required} onChange={(e) => setRequired(e.target.checked)} />
                Required
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={active} onChange={(e) => setActive(e.target.checked)} />
                Active
              </label>
            </div>
          </div>

          {needsOptions && (
            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between">
                <Label>Options</Label>
                <Button variant="ghost" size="sm" onClick={() => setOptions([...options, { value: "", label: "" }])}>
                  <Plus className="size-3" /> Add option
                </Button>
              </div>
              <div className="space-y-2">
                {options.length === 0 && <p className="text-xs text-muted-foreground">No options yet.</p>}
                {options.map((o, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      className="flex-1"
                      placeholder="value"
                      value={o.value}
                      onChange={(e) => {
                        const next = [...options];
                        next[idx] = { ...next[idx], value: e.target.value };
                        setOptions(next);
                      }}
                    />
                    <Input
                      className="flex-1"
                      placeholder="label"
                      value={o.label}
                      onChange={(e) => {
                        const next = [...options];
                        next[idx] = { ...next[idx], label: e.target.value };
                        setOptions(next);
                      }}
                    />
                    <Button variant="ghost" size="icon" onClick={() => setOptions(options.filter((_, k) => k !== idx))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label>Placeholder</Label>
            <Input value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} />
          </div>
          <div>
            <Label>Help text</Label>
            <Input value={helpText} onChange={(e) => setHelpText(e.target.value)} />
          </div>

          {err && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || !label.trim()}>
            {busy ? "Saving…" : existing ? "Save changes" : "Create field"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
