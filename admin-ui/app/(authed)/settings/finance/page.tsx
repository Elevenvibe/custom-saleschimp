"use client";

/**
 * Settings → Finance — tax rate configuration.
 *
 * A named tax-rate catalog (VAT / GST / Sales Tax, …) with rate %, optional
 * region, inclusive/exclusive, enabled, and a single default. CRUD against
 * /api/admin/finance/tax-rates.
 */

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";

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

type TaxRate = {
  id: number;
  name: string;
  rate: number;
  region: string | null;
  inclusive: boolean;
  enabled: boolean;
  is_default: boolean;
};

export default function FinanceSettingsPage() {
  const [rates, setRates] = useState<TaxRate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaxRate | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api<TaxRate[]>("/api/admin/finance/tax-rates")
      .then(setRates)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  async function remove(t: TaxRate) {
    if (!confirm(`Delete tax rate "${t.name}"?`)) return;
    try {
      await api(`/api/admin/finance/tax-rates/${t.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function makeDefault(t: TaxRate) {
    try {
      await api(`/api/admin/finance/tax-rates/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_default: true }),
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure the tax rates the platform applies to billing.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" /> Add tax rate
        </Button>
      </header>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <section className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Rate</th>
              <th className="px-4 py-2">Region</th>
              <th className="px-4 py-2">Pricing</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!rates ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
            ) : rates.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No tax rates yet.</td></tr>
            ) : (
              rates.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2 font-medium">
                      {t.name}
                      {t.is_default && <Badge className="text-[10px]">default</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-2">{t.rate}%</td>
                  <td className="px-4 py-2 text-muted-foreground">{t.region ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{t.inclusive ? "Inclusive" : "Added on top"}</td>
                  <td className="px-4 py-2">
                    <Badge variant={t.enabled ? "default" : "secondary"}>{t.enabled ? "enabled" : "disabled"}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {!t.is_default && (
                        <Button variant="ghost" size="icon" onClick={() => makeDefault(t)} title="Set as default">
                          <Star className="size-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => setEditing(t)} title="Edit">
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(t)} title="Delete">
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {(creating || editing) && (
        <TaxRateDialog
          existing={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function TaxRateDialog({
  existing,
  onClose,
  onSaved,
}: {
  existing: TaxRate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [rate, setRate] = useState<string>(existing ? String(existing.rate) : "");
  const [region, setRegion] = useState(existing?.region ?? "");
  const [inclusive, setInclusive] = useState(existing?.inclusive ?? false);
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [isDefault, setIsDefault] = useState(existing?.is_default ?? false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const rateNum = Number(rate);
      if (Number.isNaN(rateNum) || rateNum < 0 || rateNum > 100) {
        throw new Error("Rate must be a number between 0 and 100.");
      }
      const payload = {
        name,
        rate: rateNum,
        region: region || null,
        inclusive,
        enabled,
        is_default: isDefault,
      };
      if (existing) {
        await api(`/api/admin/finance/tax-rates/${existing.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api("/api/admin/finance/tax-rates", { method: "POST", body: JSON.stringify(payload) });
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit tax rate" : "New tax rate"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="VAT" />
            </div>
            <div>
              <Label>Rate (%)</Label>
              <Input type="number" step="0.001" min={0} max={100} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="20" />
            </div>
          </div>
          <div>
            <Label>Region (optional)</Label>
            <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="UK, EU, US-CA…" />
          </div>
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} />
              Prices include tax
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              Default
            </label>
          </div>
          {err && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || !name.trim() || rate === ""}>
            {busy ? "Saving…" : existing ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
