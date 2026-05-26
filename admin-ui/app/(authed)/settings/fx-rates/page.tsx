"use client";

/**
 * FX rates CRUD.
 *
 * The wallet layer is multi-currency since f4 — tenants can hold a
 * balance per (tenant, currency). FX rates here drive conversion
 * when usage_records are denominated in one currency but charged
 * against a wallet in another (and for any future place that needs
 * cross-currency math).
 *
 * Rates are stored as `rate_micros` = micros of the quote currency
 * per 1 base. Same convention as everything else in the money stack,
 * so the converter is integer math.
 */

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { PageDescription } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, RefreshCw, Trash2 } from "lucide-react";

type FxRate = {
  id: number;
  base_currency: string;
  quote_currency: string;
  rate_micros: number;
  source: string;
  fetched_at: string;
};

export default function FxRatesPage() {
  const [rates, setRates] = useState<FxRate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  function load() {
    api<FxRate[]>("/api/admin/fx-rates").then(setRates).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function remove(r: FxRate) {
    if (!confirm(`Delete ${r.base_currency}→${r.quote_currency}?`)) return;
    try {
      await api(`/api/admin/fx-rates/${r.base_currency}/${r.quote_currency}`, {
        method: "DELETE",
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="p-8 space-y-6">
      <PageDescription>
        Currency conversion table. Stored as <code>rate_micros</code> = (quote_currency micros per 1
        base_currency). USD↔USD is seeded automatically. The customer wallet stack converts at
        charge time using these rates; updates take effect within 60s via the cache TTL.
      </PageDescription>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="size-4" /> New rate
        </Button>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Pair</th>
              <th className="px-4 py-2 text-right">Rate</th>
              <th className="px-4 py-2">Source</th>
              <th className="px-4 py-2">Updated</th>
              <th className="px-4 py-2 w-16" />
            </tr>
          </thead>
          <tbody>
            {!rates && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {rates?.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No rates. Add one above.</td></tr>
            )}
            {rates?.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-4 py-2 font-mono">
                  {r.base_currency} → {r.quote_currency}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {(r.rate_micros / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </td>
                <td className="px-4 py-2"><Badge variant="secondary">{r.source}</Badge></td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {new Date(r.fetched_at).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right">
                  {!(r.base_currency === "USD" && r.quote_currency === "USD") && (
                    <Button size="sm" variant="ghost" onClick={() => remove(r)}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <AddDialog onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />
      )}
    </div>
  );
}

function AddDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [base, setBase] = useState("USD");
  const [quote, setQuote] = useState("");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const n = Number(rate);
      if (!Number.isFinite(n) || n <= 0) throw new Error("rate must be positive");
      await api("/api/admin/fx-rates", {
        method: "PUT",
        body: JSON.stringify({
          base_currency: base.toUpperCase(),
          quote_currency: quote.toUpperCase(),
          rate_micros: Math.round(n * 1_000_000),
          source: "manual",
        }),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New FX rate</DialogTitle>
          <DialogDescription>
            Enter the human-readable rate (e.g. <code>1500</code> for USD→NGN). We store it as micros
            internally. Set just one direction — the converter handles the inverse on its own.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Base</Label>
              <Input value={base} onChange={(e) => setBase(e.target.value.toUpperCase())} placeholder="USD" maxLength={8} />
            </div>
            <div>
              <Label>Quote</Label>
              <Input value={quote} onChange={(e) => setQuote(e.target.value.toUpperCase())} placeholder="NGN" maxLength={8} />
            </div>
          </div>
          <div>
            <Label>Rate (1 base = ? quote)</Label>
            <Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="1500" />
          </div>
        </div>
        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !base || !quote || !rate}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
