"use client";

import { useEffect, useState } from "react";

import {
  api,
  type CostProvider,
  type CostProviderPrice,
  type MarkupRule,
  type PriceUnit,
  type ProviderKind,
} from "@/lib/api";
import { PageDescription, PageHeader } from "@/components/PageHeader";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

const KINDS: ProviderKind[] = ["llm", "tts", "stt", "embedding", "telephony"];

const UNITS: PriceUnit[] = [
  "per_minute",
  "per_input_token",
  "per_output_token",
  "per_1k_tokens",
  "per_character",
  "per_1k_chars",
  "per_call",
  "per_request",
];

function microsToUsd(micros: number): string {
  const usd = micros / 1_000_000;
  // micros are millionths of a currency unit. Display with enough precision to
  // keep token prices legible without trailing zeros for fat ones.
  if (Math.abs(usd) >= 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(7)}`;
}

function microsToPct(micros: number): string {
  return `${(micros / 1_000_000).toFixed(2)}%`;
}

export default function CostCatalogPage() {
  const [providers, setProviders] = useState<CostProvider[] | null>(null);
  const [markup, setMarkup] = useState<MarkupRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNewProvider, setShowNewProvider] = useState(false);
  const [showNewMarkup, setShowNewMarkup] = useState(false);
  const [openProviderId, setOpenProviderId] = useState<number | null>(null);

  function loadProviders() {
    api<CostProvider[]>("/api/admin/cost-providers").then(setProviders).catch((e) => setError(e.message));
  }
  function loadMarkup() {
    api<MarkupRule[]>("/api/admin/markup-rules").then(setMarkup).catch(() => {});
  }
  useEffect(() => {
    loadProviders();
    loadMarkup();
  }, []);

  async function deleteProvider(id: number) {
    if (!confirm("Delete this provider and ALL its prices?")) return;
    try {
      await api(`/api/admin/cost-providers/${id}`, { method: "DELETE" });
      loadProviders();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deleteMarkup(id: number) {
    if (!confirm("Delete this markup rule?")) return;
    try {
      await api(`/api/admin/markup-rules/${id}`, { method: "DELETE" });
      loadMarkup();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Cost catalog"
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowNewMarkup(true)}>
              <Plus className="h-4 w-4" /> Markup rule
            </Button>
            <Button onClick={() => setShowNewProvider(true)}>
              <Plus className="h-4 w-4" /> Provider
            </Button>
          </div>
        }
      />
      <div className="p-8 space-y-8">
        <PageDescription>
          Per-provider unit pricing (LLM, TTS, STT, embedding, telephony) plus the markup rules that turn raw provider
          cost into the customer&apos;s billable rate. Money stored as micros (millionths of a currency unit) for
          sub-cent precision on per-token math.
        </PageDescription>

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}

        <section>
          <div className="mb-3 text-sm font-medium">Providers</div>
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 w-8" />
                  <th className="px-4 py-2">Kind</th>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Slug</th>
                  <th className="px-4 py-2">Currency</th>
                  <th className="px-4 py-2">Active</th>
                  <th className="px-4 py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {!providers && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {providers?.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No providers yet — add one.</td></tr>
                )}
                {providers?.map((p) => (
                  <ProviderRow
                    key={p.id}
                    provider={p}
                    open={openProviderId === p.id}
                    onToggle={() => setOpenProviderId(openProviderId === p.id ? null : p.id)}
                    onDelete={() => deleteProvider(p.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="mb-3 text-sm font-medium">Markup rules</div>
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Scope</th>
                  <th className="px-4 py-2">Kind</th>
                  <th className="px-4 py-2">Value</th>
                  <th className="px-4 py-2">Priority</th>
                  <th className="px-4 py-2">Active</th>
                  <th className="px-4 py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {!markup && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>}
                {markup?.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No markup rules — billing will charge raw provider cost only.</td></tr>
                )}
                {markup?.map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="px-4 py-2">
                      {m.scope_kind === "global" ? (
                        <Badge>global</Badge>
                      ) : (
                        <span className="text-xs"><Badge variant="secondary">{m.scope_kind}</Badge> {m.scope_value}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{m.markup_kind}</td>
                    <td className="px-4 py-2">
                      {m.markup_kind === "percentage" ? microsToPct(m.value_micros) : microsToUsd(m.value_micros) + " " + m.currency}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{m.priority}</td>
                    <td className="px-4 py-2">
                      <Badge variant={m.active ? "default" : "secondary"}>{m.active ? "yes" : "no"}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => deleteMarkup(m.id)} title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showNewProvider && (
        <NewProviderDialog
          onClose={() => setShowNewProvider(false)}
          onCreated={() => {
            setShowNewProvider(false);
            loadProviders();
          }}
        />
      )}
      {showNewMarkup && (
        <NewMarkupDialog
          onClose={() => setShowNewMarkup(false)}
          onCreated={() => {
            setShowNewMarkup(false);
            loadMarkup();
          }}
        />
      )}
    </>
  );
}

function ProviderRow({
  provider,
  open,
  onToggle,
  onDelete,
}: {
  provider: CostProvider;
  open: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <tr className="border-t hover:bg-muted/40 cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-2 text-muted-foreground">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </td>
        <td className="px-4 py-2"><Badge variant="secondary" className="font-mono">{provider.kind}</Badge></td>
        <td className="px-4 py-2 font-medium">{provider.name}</td>
        <td className="px-4 py-2 font-mono text-xs">{provider.slug}</td>
        <td className="px-4 py-2 text-muted-foreground">{provider.currency}</td>
        <td className="px-4 py-2">
          <Badge variant={provider.active ? "default" : "secondary"}>{provider.active ? "yes" : "no"}</Badge>
        </td>
        <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={onDelete} title="Delete">
            <Trash2 className="h-4 w-4" />
          </Button>
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/20">
          <td colSpan={7} className="px-6 py-3">
            <ProviderPrices providerId={provider.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function ProviderPrices({ providerId }: { providerId: number }) {
  const [prices, setPrices] = useState<CostProviderPrice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  function load() {
    api<CostProviderPrice[]>(`/api/admin/cost-providers/${providerId}/prices`)
      .then(setPrices)
      .catch((e) => setError(e.message));
  }
  useEffect(load, [providerId]);

  async function remove(id: number) {
    if (!confirm("Delete this price?")) return;
    try {
      await api(`/api/admin/cost-providers/${providerId}/prices/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prices</div>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4" /> Add price
        </Button>
      </div>
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="rounded border bg-background">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Unit</th>
              <th className="px-3 py-1.5">Variant</th>
              <th className="px-3 py-1.5">Price</th>
              <th className="px-3 py-1.5">Effective</th>
              <th className="px-3 py-1.5">Notes</th>
              <th className="px-3 py-1.5 w-12" />
            </tr>
          </thead>
          <tbody>
            {!prices && <tr><td colSpan={6} className="px-3 py-3 text-center text-muted-foreground">Loading…</td></tr>}
            {prices?.length === 0 && <tr><td colSpan={6} className="px-3 py-3 text-center text-muted-foreground">No prices configured.</td></tr>}
            {prices?.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-3 py-1.5 font-mono">{p.unit}</td>
                <td className="px-3 py-1.5">{p.variant ?? "—"}</td>
                <td className="px-3 py-1.5 font-mono">{microsToUsd(p.price_micros)} {p.currency}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{new Date(p.effective_at).toLocaleString()}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{p.notes ?? ""}</td>
                <td className="px-3 py-1.5 text-right">
                  <Button size="sm" variant="ghost" onClick={() => remove(p.id)} title="Delete">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showAdd && (
        <AddPriceDialog
          providerId={providerId}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function NewProviderDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [kind, setKind] = useState<ProviderKind>("llm");
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await api("/api/admin/cost-providers", {
        method: "POST",
        body: JSON.stringify({ kind, slug, name }),
      });
      onCreated();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New cost provider</DialogTitle>
          <DialogDescription>Add a vendor whose service contributes to call cost.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ProviderKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Slug (lowercase, dashes)</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="openai" />
          </div>
          <div>
            <Label>Display name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="OpenAI" />
          </div>
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !slug || !name}>{busy ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddPriceDialog({
  providerId,
  onClose,
  onCreated,
}: {
  providerId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [unit, setUnit] = useState<PriceUnit>("per_minute");
  const [variant, setVariant] = useState("");
  // Capture as decimal USD per unit, convert to micros on submit.
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const usd = Number(pricePerUnit);
      if (!Number.isFinite(usd) || usd < 0) throw new Error("price must be a positive number");
      const price_micros = Math.round(usd * 1_000_000);
      await api(`/api/admin/cost-providers/${providerId}/prices`, {
        method: "POST",
        body: JSON.stringify({
          unit,
          variant: variant || null,
          price_micros,
          notes: notes || null,
        }),
      });
      onCreated();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add price</DialogTitle>
          <DialogDescription>
            Enter the price in USD per unit (e.g. <code>0.18</code> for $0.18/min, or <code>0.0025</code> for
            $0.0025 per 1k tokens). Stored internally as micros.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Unit</Label>
            <Select value={unit} onValueChange={(v) => setUnit(v as PriceUnit)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Variant (optional)</Label>
            <Input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="gpt-4o" />
          </div>
          <div>
            <Label>Price (USD)</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={pricePerUnit}
              onChange={(e) => setPricePerUnit(e.target.value)}
              placeholder="0.18"
            />
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="$0.18/min outbound" />
          </div>
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !pricePerUnit}>{busy ? "Saving…" : "Add price"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewMarkupDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [scopeKind, setScopeKind] = useState<"global" | "kind" | "tenant">("global");
  const [scopeValue, setScopeValue] = useState("");
  const [markupKind, setMarkupKind] = useState<"percentage" | "fixed_per_minute" | "fixed_per_unit">("percentage");
  const [value, setValue] = useState("");
  const [priority, setPriority] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw new Error("value must be a positive number");
      // For percentage: input is 25 (meaning 25%); we store 25_000_000 micros.
      // For fixed_per_minute / fixed_per_unit: input is USD; we store usd * 1M.
      const value_micros =
        markupKind === "percentage" ? Math.round(n * 1_000_000) : Math.round(n * 1_000_000);
      await api("/api/admin/markup-rules", {
        method: "POST",
        body: JSON.stringify({
          scope_kind: scopeKind,
          scope_value: scopeKind === "global" ? null : scopeValue || null,
          markup_kind: markupKind,
          value_micros,
          priority,
        }),
      });
      onCreated();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New markup rule</DialogTitle>
          <DialogDescription>
            Markup applied on top of raw provider cost. Tenant scope beats kind beats global; within a scope, higher
            priority wins.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Scope</Label>
              <Select value={scopeKind} onValueChange={(v) => setScopeKind(v as "global" | "kind" | "tenant")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">global</SelectItem>
                  <SelectItem value="kind">kind</SelectItem>
                  <SelectItem value="tenant">tenant</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scopeKind !== "global" && (
              <div>
                <Label>{scopeKind === "kind" ? "Kind (llm/tts/…)" : "Tenant id"}</Label>
                <Input value={scopeValue} onChange={(e) => setScopeValue(e.target.value)} />
              </div>
            )}
          </div>
          <div>
            <Label>Markup kind</Label>
            <Select value={markupKind} onValueChange={(v) => setMarkupKind(v as "percentage" | "fixed_per_minute" | "fixed_per_unit")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">percentage (e.g. 25 = 25% on top of raw cost)</SelectItem>
                <SelectItem value="fixed_per_minute">fixed $ per minute</SelectItem>
                <SelectItem value="fixed_per_unit">fixed $ per unit (flat)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Value ({markupKind === "percentage" ? "%" : "$"})</Label>
            <Input type="text" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={markupKind === "percentage" ? "25" : "0.05"} />
          </div>
          <div>
            <Label>Priority</Label>
            <Input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value || 0))} />
          </div>
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !value}>{busy ? "Saving…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
