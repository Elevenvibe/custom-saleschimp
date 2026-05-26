"use client";

import { useEffect, useMemo, useState } from "react";

import {
  api,
  type AvailableModelsRes,
  type CostProvider,
  type CostProviderPrice,
  type Country,
  type CredentialsStatus,
  type IntegratedCatalog,
  type IntegratedProvider,
  type MarkupRule,
  type PriceUnit,
  type ProviderKind,
  type SyncPricesRes,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronDown,
  ChevronRight,
  KeyRound,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

const KINDS: { id: ProviderKind; label: string }[] = [
  { id: "llm", label: "LLM" },
  { id: "stt", label: "STT" },
  { id: "tts", label: "TTS" },
  { id: "embedding", label: "Embedding" },
  { id: "telephony", label: "Telephony" },
  { id: "phone_number", label: "Phone Number" },
];

const UNITS: PriceUnit[] = [
  "per_minute",
  "per_input_token",
  "per_output_token",
  "per_1k_tokens",
  "per_character",
  "per_1k_chars",
  "per_call",
  "per_request",
  "per_month",
];

const MICROS_PER_UNIT = 1_000_000;
const CUSTOM_SLUG = "__custom__";

function microsToUsd(micros: number, precision = 4): string {
  const usd = micros / MICROS_PER_UNIT;
  if (Math.abs(usd) >= 0.01 || usd === 0) return `$${usd.toFixed(precision)}`;
  return `$${usd.toFixed(7)}`;
}

function microsToPct(micros: number): string {
  return `${(micros / MICROS_PER_UNIT).toFixed(2)}%`;
}

/** Pick the markup rule that applies to a given provider kind for a USD billing run with no tenant override.
 *  Mirrors the gateway's resolver (global → no markup); kind/tenant overrides aren't visualized here yet
 *  because per-model rows don't know a tenant context. */
function resolveMarkup(kind: ProviderKind, rules: MarkupRule[] | null): MarkupRule | null {
  if (!rules) return null;
  const usdActive = rules.filter((r) => r.active && r.currency === "USD");
  const kindRule = usdActive
    .filter((r) => r.scope_kind === "kind" && r.scope_value === kind)
    .sort((a, b) => b.priority - a.priority)[0];
  if (kindRule) return kindRule;
  const globalRule = usdActive
    .filter((r) => r.scope_kind === "global")
    .sort((a, b) => b.priority - a.priority)[0];
  return globalRule ?? null;
}

function applyMarkup(rawMicros: number, rule: MarkupRule | null, quantityMinutes?: number): number {
  if (!rule) return 0;
  if (rule.markup_kind === "percentage") {
    return Math.round((rawMicros * rule.value_micros) / (100 * MICROS_PER_UNIT));
  }
  if (rule.markup_kind === "fixed_per_minute") {
    // Without a known minute count this is informational only — show the per-minute add-on.
    return Math.round(rule.value_micros * (quantityMinutes ?? 1));
  }
  // fixed_per_unit
  return rule.value_micros;
}

export default function CostCatalogPage() {
  const [providers, setProviders] = useState<CostProvider[] | null>(null);
  const [markup, setMarkup] = useState<MarkupRule[] | null>(null);
  const [catalog, setCatalog] = useState<IntegratedCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNewProvider, setShowNewProvider] = useState(false);
  const [showNewMarkup, setShowNewMarkup] = useState(false);
  const [activeTab, setActiveTab] = useState<ProviderKind>("llm");
  const [openProviderId, setOpenProviderId] = useState<number | null>(null);

  function loadProviders() {
    api<CostProvider[]>("/api/admin/cost-providers").then(setProviders).catch((e) => setError(e.message));
  }
  function loadMarkup() {
    api<MarkupRule[]>("/api/admin/markup-rules").then(setMarkup).catch(() => {});
  }
  function loadCatalog() {
    api<IntegratedCatalog>("/api/admin/cost-providers/integrated").then(setCatalog).catch(() => {});
  }
  useEffect(() => {
    loadProviders();
    loadMarkup();
    loadCatalog();
  }, []);

  const byKind = useMemo(() => {
    const m: Record<ProviderKind, CostProvider[]> = {
      llm: [], tts: [], stt: [], embedding: [], telephony: [], phone_number: [],
    };
    for (const p of providers ?? []) m[p.kind].push(p);
    return m;
  }, [providers]);

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
          Per-provider unit pricing organised by kind, plus the markup rules that turn raw provider cost into the
          customer&apos;s billable rate. Click a provider to see its models, the raw vendor price, and what we&apos;ll
          actually charge after markup.
        </PageDescription>

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}

        <section>
          <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as ProviderKind); setOpenProviderId(null); }}>
            <TabsList>
              {KINDS.map((k) => (
                <TabsTrigger key={k.id} value={k.id}>
                  {k.label}
                  <Badge variant="secondary" className="ml-2 px-1.5 py-0">
                    {byKind[k.id].length}
                  </Badge>
                </TabsTrigger>
              ))}
            </TabsList>
            {KINDS.map((k) => (
              <TabsContent key={k.id} value={k.id} className="mt-4">
                <ProviderTable
                  providers={byKind[k.id]}
                  loading={providers === null}
                  kind={k.id}
                  markup={resolveMarkup(k.id, markup)}
                  openProviderId={openProviderId}
                  onToggle={(id) => setOpenProviderId(openProviderId === id ? null : id)}
                  onDelete={deleteProvider}
                />
              </TabsContent>
            ))}
          </Tabs>
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
                {!markup && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
                )}
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
          catalog={catalog}
          defaultKind={activeTab}
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

function ProviderTable({
  providers,
  loading,
  kind,
  markup,
  openProviderId,
  onToggle,
  onDelete,
}: {
  providers: CostProvider[];
  loading: boolean;
  kind: ProviderKind;
  markup: MarkupRule | null;
  openProviderId: number | null;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 w-8" />
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Slug</th>
            <th className="px-4 py-2">Currency</th>
            <th className="px-4 py-2">Active</th>
            <th className="px-4 py-2 w-16" />
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
          )}
          {!loading && providers.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                No {kind} providers yet. Click <span className="font-medium">Provider</span> above to add one.
              </td>
            </tr>
          )}
          {providers.map((p) => (
            <ProviderRow
              key={p.id}
              provider={p}
              markup={markup}
              open={openProviderId === p.id}
              onToggle={() => onToggle(p.id)}
              onDelete={() => onDelete(p.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProviderRow({
  provider,
  markup,
  open,
  onToggle,
  onDelete,
}: {
  provider: CostProvider;
  markup: MarkupRule | null;
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
          <td colSpan={6} className="px-6 py-3">
            <ProviderModels provider={provider} markup={markup} />
          </td>
        </tr>
      )}
    </>
  );
}

function ProviderModels({
  provider,
  markup,
}: {
  provider: CostProvider;
  markup: MarkupRule | null;
}) {
  const [prices, setPrices] = useState<CostProviderPrice[] | null>(null);
  const [creds, setCreds] = useState<CredentialsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showCreds, setShowCreds] = useState(false);

  function loadPrices() {
    api<CostProviderPrice[]>(`/api/admin/cost-providers/${provider.id}/prices`)
      .then(setPrices)
      .catch((e) => setError(e.message));
  }
  function loadCreds() {
    api<CredentialsStatus>(`/api/admin/cost-providers/${provider.id}/credentials`)
      .then(setCreds)
      .catch(() => {});
  }
  useEffect(() => {
    loadPrices();
    loadCreds();
  }, [provider.id]);

  async function remove(id: number) {
    if (!confirm("Delete this model price?")) return;
    try {
      await api(`/api/admin/cost-providers/${provider.id}/prices/${id}`, { method: "DELETE" });
      loadPrices();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function sync() {
    setSyncing(true);
    setSyncSummary(null);
    setError(null);
    try {
      const r = await api<SyncPricesRes>(`/api/admin/cost-providers/${provider.id}/sync-prices`, {
        method: "POST",
      });
      setSyncSummary(`Synced ${r.upserted} new prices · ${r.skipped} already existed.`);
      loadPrices();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const markupSummary = markup
    ? markup.markup_kind === "percentage"
      ? `+${microsToPct(markup.value_micros)} (${markup.scope_kind})`
      : `+${microsToUsd(markup.value_micros)} per ${markup.markup_kind === "fixed_per_minute" ? "min" : "unit"} (${markup.scope_kind})`
    : "no markup configured";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium uppercase tracking-wide">Models</span>{" "}
          · markup applied to <code className="font-mono">{provider.kind}</code>:{" "}
          <span className="font-mono">{markupSummary}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowCreds(true)}>
            <KeyRound className="h-4 w-4" />
            {creds?.configured ? "Update API key" : "Configure API key"}
            {creds?.configured && <Badge variant="secondary" className="ml-1 px-1.5 py-0">set</Badge>}
          </Button>
          <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> Sync prices
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" />{" "}
            {provider.kind === "telephony" || provider.kind === "phone_number"
              ? "Add countries"
              : "Add model"}
          </Button>
        </div>
      </div>
      {syncSummary && (
        <div className="rounded-md bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">{syncSummary}</div>
      )}
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="rounded border bg-background">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">
                {provider.kind === "telephony" || provider.kind === "phone_number"
                  ? "Country"
                  : "Model (variant)"}
              </th>
              <th className="px-3 py-1.5">Unit</th>
              <th className="px-3 py-1.5">Original cost</th>
              <th className="px-3 py-1.5">Markup</th>
              <th className="px-3 py-1.5">Effective</th>
              <th className="px-3 py-1.5">Notes</th>
              <th className="px-3 py-1.5 w-12" />
            </tr>
          </thead>
          <tbody>
            {!prices && <tr><td colSpan={7} className="px-3 py-3 text-center text-muted-foreground">Loading…</td></tr>}
            {prices?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">
                  {provider.kind === "telephony" ? (
                    <>No destinations priced yet — try <span className="font-medium">Sync prices</span> to seed the catalog defaults, or <span className="font-medium">Add countries</span>.</>
                  ) : provider.kind === "phone_number" ? (
                    <>No phone-number countries priced yet — try <span className="font-medium">Sync prices</span> to seed the catalog defaults, or <span className="font-medium">Add countries</span>.</>
                  ) : (
                    <>No models priced yet — try <span className="font-medium">Sync prices</span> to seed from the integrated catalog, or <span className="font-medium">Add model</span> for a custom one.</>
                  )}
                </td>
              </tr>
            )}
            {prices?.map((p) => {
              const m = applyMarkup(p.price_micros, markup);
              return (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-1.5 font-mono">{p.variant ?? "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{p.unit}</td>
                  <td className="px-3 py-1.5 font-mono">{microsToUsd(p.price_micros)}</td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">
                    {markup ? `+${microsToUsd(m)}` : "—"}
                  </td>
                  <td className="px-3 py-1.5 font-mono font-medium">{microsToUsd(p.price_micros + m)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{p.notes ?? ""}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Button size="sm" variant="ghost" onClick={() => remove(p.id)} title="Delete">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showAdd && (
        <AddPriceDialog
          provider={provider}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            loadPrices();
          }}
        />
      )}
      {showCreds && (
        <CredentialsDialog
          provider={provider}
          configured={creds?.configured ?? false}
          onClose={() => setShowCreds(false)}
          onSaved={() => {
            setShowCreds(false);
            loadCreds();
          }}
        />
      )}
    </div>
  );
}

function CredentialsDialog({
  provider,
  configured,
  onClose,
  onSaved,
}: {
  provider: CostProvider;
  configured: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/cost-providers/${provider.id}/credentials`, {
        method: "PUT",
        body: JSON.stringify({ api_key: apiKey }),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!confirm("Remove stored credentials for this provider?")) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/cost-providers/${provider.id}/credentials`, { method: "DELETE" });
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
          <DialogTitle>{provider.name} credentials</DialogTitle>
          <DialogDescription>
            Stored Fernet-encrypted in the Control DB. Used to fetch the live model list when adding prices.
            Live-fetch adapter exists for OpenAI-compatible vendors (openai, groq, cerebras); others fall back to
            the integrated catalog.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>API key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={configured ? "•••• (replace existing)" : "sk-…"}
              autoComplete="off"
            />
          </div>
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          {configured && (
            <Button variant="ghost" onClick={clear} disabled={busy} className="mr-auto text-destructive">
              Remove
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !apiKey}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewProviderDialog({
  catalog,
  defaultKind,
  onClose,
  onCreated,
}: {
  catalog: IntegratedCatalog | null;
  defaultKind: ProviderKind;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [kind, setKind] = useState<ProviderKind>(defaultKind);
  const [pickedSlug, setPickedSlug] = useState<string>("");
  const [customSlug, setCustomSlug] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options: IntegratedProvider[] = catalog?.[kind] ?? [];
  const isCustom = pickedSlug === CUSTOM_SLUG;

  // When kind changes, reset the picked provider.
  useEffect(() => {
    setPickedSlug("");
    setName("");
    setCustomSlug("");
  }, [kind]);

  // Auto-populate name when an integrated provider is picked.
  useEffect(() => {
    if (!isCustom && pickedSlug) {
      const found = options.find((o) => o.slug === pickedSlug);
      if (found) setName(found.name);
    }
  }, [pickedSlug, isCustom, options]);

  const effectiveSlug = isCustom
    ? customSlug.toLowerCase().replace(/[^a-z0-9-]/g, "-")
    : pickedSlug;

  async function submit() {
    setBusy(true); setError(null);
    try {
      if (!effectiveSlug) throw new Error("pick a provider");
      if (!name) throw new Error("display name required");
      await api("/api/admin/cost-providers", {
        method: "POST",
        body: JSON.stringify({ kind, slug: effectiveSlug, name }),
      });
      onCreated();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New cost provider</DialogTitle>
          <DialogDescription>
            Pick the provider from the Dograh-integrated list. New integrations show up here
            automatically when the gateway updates its catalog.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ProviderKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Provider</Label>
            <Select value={pickedSlug} onValueChange={setPickedSlug}>
              <SelectTrigger>
                <SelectValue placeholder={options.length ? "Pick an integrated provider…" : "No integrated providers for this kind"} />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.slug} value={o.slug}>
                    {o.name} <span className="text-muted-foreground">({o.slug})</span>
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_SLUG}>Other (custom slug)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isCustom && (
            <div>
              <Label>Slug</Label>
              <Input
                value={customSlug}
                onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                placeholder="my-vendor"
              />
            </div>
          )}
          <div>
            <Label>Display name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {!isCustom && pickedSlug && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Slug: <code className="font-mono">{effectiveSlug}</code>.{" "}
              Suggested models — you&apos;ll add prices for them after creating the provider:
              <ul className="ml-4 mt-1 list-disc">
                {options.find((o) => o.slug === pickedSlug)?.models.slice(0, 6).map((m) => (
                  <li key={m.variant}><code className="font-mono">{m.variant}</code> — {m.label}</li>
                ))}
              </ul>
            </div>
          )}
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !effectiveSlug || !name}>{busy ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddPriceDialog({
  provider,
  onClose,
  onCreated,
}: {
  provider: CostProvider;
  onClose: () => void;
  onCreated: () => void;
}) {
  // Telephony + phone_number both use a country multi-select with a single
  // price applied to every pick. Different unit (per_minute vs per_month) but
  // the dialog shape is identical, so route both through AddCountryDialog.
  if (provider.kind === "telephony" || provider.kind === "phone_number") {
    return <AddCountryDialog provider={provider} onClose={onClose} onCreated={onCreated} />;
  }
  // Available models come from /available-models — live fetch when creds are
  // configured for an OpenAI-compatible adapter, catalog otherwise. Always
  // scoped to THIS provider's slug.
  const [available, setAvailable] = useState<AvailableModelsRes | null>(null);
  const [availableError, setAvailableError] = useState<string | null>(null);
  const [unit, setUnit] = useState<PriceUnit>("per_minute");
  const [variant, setVariant] = useState("");
  const [customVariant, setCustomVariant] = useState("");
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AvailableModelsRes>(`/api/admin/cost-providers/${provider.id}/available-models`)
      .then((r) => {
        setAvailable(r);
        // Default unit to something sensible for the kind.
        const defaults: Record<ProviderKind, PriceUnit> = {
          llm: "per_1k_tokens",
          embedding: "per_1k_tokens",
          tts: "per_1k_chars",
          stt: "per_minute",
          telephony: "per_minute",
          phone_number: "per_month",
        };
        setUnit(defaults[provider.kind]);
      })
      .catch((e) => setAvailableError(e.message));
  }, [provider.id, provider.kind]);

  const models = available?.models ?? [];
  const isCustomVariant = variant === CUSTOM_SLUG;
  const effectiveVariant = isCustomVariant ? customVariant || null : variant || null;

  async function submit() {
    setBusy(true); setError(null);
    try {
      const usd = Number(pricePerUnit);
      if (!Number.isFinite(usd) || usd < 0) throw new Error("price must be a positive number");
      const price_micros = Math.round(usd * MICROS_PER_UNIT);
      await api(`/api/admin/cost-providers/${provider.id}/prices`, {
        method: "POST",
        body: JSON.stringify({
          unit,
          variant: effectiveVariant,
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
          <DialogTitle>Add model price for {provider.name}</DialogTitle>
          <DialogDescription>
            Pick the model and enter the vendor&apos;s price in USD per unit. Models come from{" "}
            {available?.source === "live" ? (
              <span><Badge variant="default" className="px-1.5 py-0">live</Badge> {provider.name}&apos;s API.</span>
            ) : (
              <span><Badge variant="secondary" className="px-1.5 py-0">catalog</Badge> the integrated catalog.</span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {availableError && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Couldn&apos;t load models: {availableError}
            </div>
          )}
          {available?.notes && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {available.notes}
            </div>
          )}
          <div>
            <Label>Model</Label>
            <Select value={variant} onValueChange={setVariant}>
              <SelectTrigger>
                <SelectValue placeholder={available ? "Pick a model…" : "Loading…"} />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.variant} value={m.variant}>
                    {m.label ?? m.variant}{" "}
                    {m.label && m.label !== m.variant && (
                      <span className="text-muted-foreground">({m.variant})</span>
                    )}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_SLUG}>Other (custom variant)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isCustomVariant && (
            <div>
              <Label>Variant name</Label>
              <Input
                value={customVariant}
                onChange={(e) => setCustomVariant(e.target.value)}
                placeholder="my-model-id"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
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
              <Label>Price (USD)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={pricePerUnit}
                onChange={(e) => setPricePerUnit(e.target.value)}
                placeholder="0.18"
              />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. $2.50 per 1M input tokens" />
          </div>
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !pricePerUnit || !effectiveVariant}>
            {busy ? "Saving…" : "Add price"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddCountryDialog({
  provider,
  onClose,
  onCreated,
}: {
  provider: CostProvider;
  onClose: () => void;
  onCreated: () => void;
}) {
  // telephony → per_minute; phone_number → per_month. Drives the price input
  // label, the existing-row dedupe filter, and the POST body.
  const unit: PriceUnit = provider.kind === "phone_number" ? "per_month" : "per_minute";
  const priceLabel = unit === "per_month" ? "Price per month (USD)" : "Price per minute (USD)";
  const pricePlaceholder = unit === "per_month" ? "1.15" : "0.014";
  const itemNoun = provider.kind === "phone_number" ? "number" : "destination";

  const [countries, setCountries] = useState<Country[] | null>(null);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [pricePerMinUsd, setPricePerMinUsd] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    // ISO countries from the gateway.
    api<Country[]>("/api/admin/cost-providers/countries").then(setCountries).catch((e) => setError(e.message));
    // Existing priced countries for this provider — gray them out / mark "added"
    // so the admin doesn't double-insert.
    api<CostProviderPrice[]>(`/api/admin/cost-providers/${provider.id}/prices`)
      .then((rows) => {
        setExisting(new Set(rows.filter((r) => r.unit === unit && r.variant).map((r) => r.variant!)));
      })
      .catch(() => {});
  }, [provider.id, unit]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = countries ?? [];
    if (!q) return all;
    return all.filter((c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  }, [countries, search]);

  function toggle(code: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function selectAllFiltered() {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const c of filtered) if (!existing.has(c.code)) next.add(c.code);
      return next;
    });
  }

  function clearSelection() {
    setPicked(new Set());
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const usd = Number(pricePerMinUsd);
      if (!Number.isFinite(usd) || usd < 0) throw new Error("price must be a positive number");
      const price_micros = Math.round(usd * MICROS_PER_UNIT);
      const codes = [...picked];
      if (codes.length === 0) throw new Error("pick at least one country");

      setProgress({ done: 0, total: codes.length });
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        // skip ones that already have a row at the dialog's unit
        if (existing.has(code)) {
          setProgress({ done: i + 1, total: codes.length });
          continue;
        }
        await api(`/api/admin/cost-providers/${provider.id}/prices`, {
          method: "POST",
          body: JSON.stringify({
            unit,
            variant: code,
            price_micros,
            notes: notes || null,
          }),
        });
        setProgress({ done: i + 1, total: codes.length });
      }
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {provider.kind === "phone_number"
              ? `Add phone number countries for ${provider.name}`
              : `Add destinations for ${provider.name}`}
          </DialogTitle>
          <DialogDescription>
            {provider.kind === "phone_number"
              ? "Phone numbers are rented monthly per country. Pick the countries you want to enable and set the monthly price for all of them. Already-priced countries are marked"
              : "Telephony is priced per destination country, not per model. Pick the countries you want to enable and set a single per-minute rate that applies to all of them. Already-priced countries are marked"}
            <Badge variant="secondary" className="mx-1 px-1.5 py-0">added</Badge> and skipped on submit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{priceLabel}</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={pricePerMinUsd}
                onChange={(e) => setPricePerMinUsd(e.target.value)}
                placeholder={pricePlaceholder}
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={provider.kind === "phone_number" ? "e.g. local DIDs" : "e.g. outbound long-distance"}
              />
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>Countries ({picked.size} selected)</Label>
              <div className="space-x-2 text-xs">
                <button type="button" className="underline" onClick={selectAllFiltered}>Select all visible</button>
                <button type="button" className="underline" onClick={clearSelection}>Clear</button>
              </div>
            </div>
            <Input
              placeholder="Search country name or ISO code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="mt-2 max-h-72 overflow-y-auto rounded border bg-background">
              {!countries && (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">Loading countries…</div>
              )}
              {countries && filtered.length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">No matches.</div>
              )}
              {filtered.map((c) => {
                const isExisting = existing.has(c.code);
                const isPicked = picked.has(c.code);
                return (
                  <label
                    key={c.code}
                    className={`flex cursor-pointer items-center gap-2 border-t px-3 py-1.5 text-sm hover:bg-muted/40 ${
                      isExisting ? "opacity-60" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isPicked || isExisting}
                      disabled={isExisting}
                      onChange={() => toggle(c.code)}
                    />
                    <span className="font-mono text-xs text-muted-foreground w-8">{c.code}</span>
                    <span className="flex-1">{c.name}</span>
                    {isExisting && <Badge variant="secondary" className="px-1.5 py-0">added</Badge>}
                  </label>
                );
              })}
            </div>
          </div>
          {progress && (
            <div className="rounded-md border bg-muted/40 px-3 py-1.5 text-xs">
              Inserting {progress.done}/{progress.total}…
            </div>
          )}
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !pricePerMinUsd || picked.size === 0}>
            {busy ? "Adding…" : `Add ${picked.size} ${itemNoun}${picked.size === 1 ? "" : "s"}`}
          </Button>
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
      const value_micros = Math.round(n * MICROS_PER_UNIT);
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
            Markup applied on top of raw provider cost. Tenant beats kind beats global; within a scope, higher
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
            {scopeKind === "kind" && (
              <div>
                <Label>Provider kind</Label>
                <Select value={scopeValue} onValueChange={setScopeValue}>
                  <SelectTrigger><SelectValue placeholder="Pick a kind…" /></SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {scopeKind === "tenant" && (
              <div>
                <Label>Tenant id</Label>
                <Input value={scopeValue} onChange={(e) => setScopeValue(e.target.value)} placeholder="14" />
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
