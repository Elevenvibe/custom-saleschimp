"use client";

import { useEffect, useMemo, useState } from "react";

import {
  api,
  type BillingPeriod,
  type Country,
  type MarkupRule,
  type Package,
  type PackageKind,
  type ProviderKind,
} from "@/lib/api";
import { PageDescription, PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Check, ChevronsUpDown, Pencil, Plus, Search, Trash2, X } from "lucide-react";

const MICROS_PER_UNIT = 1_000_000;

/** UI-side mapping from billing interval → short label used in field labels.
 *  This is the single source of truth — bump the BillingPeriod literal in
 *  lib/api.ts AND this table at the same time. */
const INTERVAL_LABELS: Record<BillingPeriod, { unit: string; short: string }> = {
  monthly: { unit: "month", short: "mo" },
  annual: { unit: "year", short: "yr" },
  usage: { unit: "usage", short: "use" },
  per_sec: { unit: "second", short: "sec" },
  per_min: { unit: "minute", short: "min" },
  per_hour: { unit: "hour", short: "hr" },
  per_day: { unit: "day", short: "day" },
  per_week: { unit: "week", short: "wk" },
};

/** Provider kinds the package can gate on. Mirrors gateway's ProviderKindLit. */
const PROVIDER_KIND_OPTIONS: { value: ProviderKind; label: string }[] = [
  { value: "llm", label: "LLM" },
  { value: "tts", label: "TTS" },
  { value: "stt", label: "STT" },
  { value: "embedding", label: "Embedding" },
  { value: "telephony", label: "Telephony" },
  { value: "phone_number", label: "Phone Number" },
];

function microsToUsd(micros: number, digits = 4): string {
  return `$${(micros / MICROS_PER_UNIT).toFixed(digits)}`;
}

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function PackagesPage() {
  const [packages, setPackages] = useState<Package[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Package | "new" | null>(null);

  function load() {
    api<Package[]>("/api/admin/packages").then(setPackages).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function remove(p: Package) {
    if (!confirm(`Delete the "${p.name}" package?`)) return;
    try {
      await api(`/api/admin/packages/${p.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Packages"
        action={<Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> New package</Button>}
      />
      <div className="p-8 space-y-4">
        <PageDescription>
          Subscription tiers customers can pick on the Plans page. Each package picks a billing interval
          (second/minute/hour/day/week/month/year/usage), which provider kinds it grants access to, optional
          per-kind markup overrides, and the countries telephony pricing applies to.
        </PageDescription>

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}

        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Kind</th>
                <th className="px-4 py-2">Price</th>
                <th className="px-4 py-2">Bundled</th>
                <th className="px-4 py-2">Overage</th>
                <th className="px-4 py-2">Concurrency</th>
                <th className="px-4 py-2">Visible</th>
                <th className="px-4 py-2 w-24" />
              </tr>
            </thead>
            <tbody>
              {!packages && <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>}
              {packages?.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  No packages yet. Create one and it shows up on every tenant&apos;s Plans page.
                </td></tr>
              )}
              {packages?.map((p) => {
                const unit = INTERVAL_LABELS[p.billing_period]?.short ?? p.billing_period;
                return (
                  <tr key={p.id} className="border-t">
                    <td className="px-4 py-2">
                      <div className="font-medium">{p.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{p.slug}</div>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={p.kind === "annual" ? "default" : "secondary"}>{p.kind}</Badge>
                      {p.contact_sales && <Badge variant="outline" className="ml-1">contact sales</Badge>}
                      {p.usage_only && <Badge variant="outline" className="ml-1">usage-only</Badge>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {p.usage_only || p.contact_sales ? "—" : `${centsToUsd(p.monthly_price_cents)} ${p.currency}/${unit}`}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {p.bundled_minutes > 0 ? `${p.bundled_minutes.toLocaleString()} ${unit}` : "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {p.contact_sales ? "custom" : `${microsToUsd(p.overage_per_minute_micros)}/${unit}`}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {p.concurrency_included > 0 ? p.concurrency_included : (p.contact_sales ? "custom" : "—")}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={p.visible ? "default" : "secondary"}>{p.visible ? "yes" : "no"}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(p)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(p)} title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing !== null && (
        <PackageSheet
          mode={editing === "new" ? "create" : "edit"}
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

function PackageSheet({
  mode,
  existing,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  existing: Package | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [kind, setKind] = useState<PackageKind>(existing?.kind ?? "payg");
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(
    existing?.billing_period ?? "monthly",
  );
  const [monthlyPriceCents, setMonthlyPriceCents] = useState(existing?.monthly_price_cents ?? 0);
  const [bundledMinutes, setBundledMinutes] = useState(existing?.bundled_minutes ?? 0);
  // overage expressed in $/<unit> for human input, stored as micros
  const [overagePerUnitUsd, setOveragePerUnitUsd] = useState(
    existing ? (existing.overage_per_minute_micros / MICROS_PER_UNIT).toString() : "",
  );
  const [concurrencyIncluded, setConcurrencyIncluded] = useState(existing?.concurrency_included ?? 0);
  const [currency, setCurrency] = useState(existing?.currency ?? "USD");
  const [contactSales, setContactSales] = useState(existing?.contact_sales ?? false);
  const [visible, setVisible] = useState(existing?.visible ?? true);

  // P2.A2c additions
  const [allowedProviderKinds, setAllowedProviderKinds] = useState<Set<ProviderKind>>(
    new Set(existing?.allowed_provider_kinds ?? []),
  );
  const [markupRuleIds, setMarkupRuleIds] = useState<Record<string, number>>(
    existing?.markup_rule_ids ?? {},
  );
  const [applyMarkup, setApplyMarkup] = useState(existing?.apply_markup ?? false);
  const [usageOnly, setUsageOnly] = useState(existing?.usage_only ?? false);
  const [allowedCountries, setAllowedCountries] = useState<Set<string>>(
    new Set(existing?.allowed_countries ?? []),
  );

  // Reference data for the new fields.
  const [markupRules, setMarkupRules] = useState<MarkupRule[] | null>(null);
  const [countries, setCountries] = useState<Country[] | null>(null);

  useEffect(() => {
    api<MarkupRule[]>("/api/admin/markup-rules").then(setMarkupRules).catch(() => setMarkupRules([]));
    api<Country[]>("/api/admin/cost-providers/countries").then(setCountries).catch(() => setCountries([]));
  }, []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intervalLabel = INTERVAL_LABELS[billingPeriod];

  function togglePk(pk: ProviderKind) {
    setAllowedProviderKinds((prev) => {
      const next = new Set(prev);
      if (next.has(pk)) {
        next.delete(pk);
        setMarkupRuleIds((rs) => {
          const out = { ...rs };
          delete out[pk];
          return out;
        });
      } else {
        next.add(pk);
      }
      return next;
    });
  }

  function setRuleFor(pk: ProviderKind, ruleId: number | null) {
    setMarkupRuleIds((prev) => {
      const out = { ...prev };
      if (ruleId == null) delete out[pk];
      else out[pk] = ruleId;
      return out;
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const overageUsd = overagePerUnitUsd === "" ? 0 : Number(overagePerUnitUsd);
      if (!Number.isFinite(overageUsd) || overageUsd < 0) throw new Error("overage must be a non-negative number");
      const body: Record<string, unknown> = {
        slug,
        name,
        description: description || null,
        kind,
        billing_period: billingPeriod,
        monthly_price_cents: usageOnly ? 0 : monthlyPriceCents,
        bundled_minutes: bundledMinutes,
        overage_per_minute_micros: Math.round(overageUsd * MICROS_PER_UNIT),
        concurrency_included: concurrencyIncluded,
        currency,
        contact_sales: contactSales,
        visible,
        allowed_provider_kinds: [...allowedProviderKinds],
        // Only include rule ids for kinds that are still allowed.
        markup_rule_ids: Object.fromEntries(
          Object.entries(markupRuleIds).filter(([k]) => allowedProviderKinds.has(k as ProviderKind)),
        ),
        apply_markup: applyMarkup,
        usage_only: usageOnly,
        allowed_countries: [...allowedCountries],
      };
      if (mode === "create") {
        await api("/api/admin/packages", { method: "POST", body: JSON.stringify(body) });
      } else if (existing) {
        // Exclude slug on edit — it's the only field we don't let admins rename.
        delete body.slug;
        await api(`/api/admin/packages/${existing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      {/*
        Default shadcn SheetContent on `side=right` is `w-3/4 sm:max-w-sm` (max 24rem).
        The data-attribute selector that ships in the primitive out-specifies a plain
        class, so we have to use `sm:!max-w-[55rem]` to win — gives the packed form
        (billing interval, provider gates, per-kind markup, countries) enough room.
      */}
      <SheetContent
        side="right"
        className="sm:!max-w-[55rem] flex flex-col gap-0"
      >
        <SheetHeader>
          <SheetTitle>{mode === "create" ? "New package" : `Edit ${existing?.name}`}</SheetTitle>
          <SheetDescription>
            Pick a billing interval, then configure what tenants on this package can use and how their usage
            gets priced. Markup rules are managed under Cost Catalog → Markup rules.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-6 pt-2">
          {/* --- Identity --- */}
          <section className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Slug</Label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                  disabled={mode === "edit"}
                  placeholder="starter"
                />
              </div>
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Starter" />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
          </section>

          {/* --- Kind + billing interval --- */}
          <section className="space-y-3 border-t pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Billing</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Kind</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as PackageKind)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="payg">PAYG (month-to-month)</SelectItem>
                    <SelectItem value="annual">Annual (often contact-sales)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Billing interval</Label>
                <Select value={billingPeriod} onValueChange={(v) => setBillingPeriod(v as BillingPeriod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_sec">per second</SelectItem>
                    <SelectItem value="per_min">per minute</SelectItem>
                    <SelectItem value="per_hour">per hour</SelectItem>
                    <SelectItem value="per_day">per day</SelectItem>
                    <SelectItem value="per_week">per week</SelectItem>
                    <SelectItem value="monthly">monthly</SelectItem>
                    <SelectItem value="annual">annual</SelectItem>
                    <SelectItem value="usage">usage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={usageOnly}
                onChange={(e) => setUsageOnly(e.target.checked)}
              />
              Usage-only — no recurring fee, charge per-{intervalLabel.unit} only
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Price (cents/{intervalLabel.unit})</Label>
                <Input
                  type="number"
                  value={monthlyPriceCents}
                  onChange={(e) => setMonthlyPriceCents(Number(e.target.value || 0))}
                  disabled={contactSales || usageOnly}
                  placeholder="2900"
                />
                <div className="mt-1 text-xs text-muted-foreground">
                  {usageOnly ? "Forced to $0.00 (usage-only)" : `${centsToUsd(monthlyPriceCents)} ${currency}/${intervalLabel.short}`}
                </div>
              </div>
              <div>
                <Label>Currency</Label>
                <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={8} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Bundled {intervalLabel.unit}s</Label>
                <Input
                  type="number"
                  value={bundledMinutes}
                  onChange={(e) => setBundledMinutes(Number(e.target.value || 0))}
                  placeholder="300"
                />
              </div>
              <div>
                <Label>Overage ($/{intervalLabel.short})</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={overagePerUnitUsd}
                  onChange={(e) => setOveragePerUnitUsd(e.target.value)}
                  placeholder="0.15"
                  disabled={contactSales}
                />
              </div>
              <div>
                <Label>Concurrency included</Label>
                <Input
                  type="number"
                  value={concurrencyIncluded}
                  onChange={(e) => setConcurrencyIncluded(Number(e.target.value || 0))}
                  placeholder="2"
                />
              </div>
            </div>
          </section>

          {/* --- Allowed provider kinds + per-kind markup rules --- */}
          <section className="space-y-3 border-t pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Allowed providers
            </h3>
            <p className="text-xs text-muted-foreground">
              Restricts which provider kinds tenants on this package can use. Leave all unchecked for no restriction.
              For each enabled kind you can optionally pin a specific markup rule that overrides the global rule.
            </p>

            <div className="grid grid-cols-2 gap-2">
              {PROVIDER_KIND_OPTIONS.map((opt) => {
                const checked = allowedProviderKinds.has(opt.value);
                const rulesForKind = (markupRules ?? []).filter(
                  (r) =>
                    r.active &&
                    (r.scope_kind === "global" ||
                      (r.scope_kind === "kind" && r.scope_value === opt.value)),
                );
                const ruleId = markupRuleIds[opt.value];
                return (
                  <div
                    key={opt.value}
                    className={`rounded-md border px-3 py-2 ${checked ? "bg-muted/40" : "bg-card"}`}
                  >
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePk(opt.value)}
                      />
                      {opt.label}
                    </label>
                    {checked && (
                      <div className="mt-2 pl-6">
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Markup rule
                        </Label>
                        <Select
                          value={ruleId != null ? String(ruleId) : "__none__"}
                          onValueChange={(v) => setRuleFor(opt.value, v === "__none__" ? null : Number(v))}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="No override" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">No override (use global)</SelectItem>
                            {rulesForKind.map((r) => (
                              <SelectItem key={r.id} value={String(r.id)}>
                                #{r.id} · {r.markup_kind} · {r.scope_kind}
                                {r.scope_value ? `:${r.scope_value}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={applyMarkup}
                onChange={(e) => setApplyMarkup(e.target.checked)}
              />
              Factor markup rules into billed cost (master switch)
            </label>
          </section>

          {/* --- Country scope --- */}
          <section className="space-y-3 border-t pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Allowed countries
            </h3>
            <p className="text-xs text-muted-foreground">
              Telephony pricing scope. Empty = all countries (no restriction). Used to gate where outbound calls
              and number purchases can land.
            </p>
            <CountryMultiSelect
              all={countries}
              picked={allowedCountries}
              onChange={setAllowedCountries}
            />
          </section>

          {/* --- Visibility --- */}
          <section className="space-y-2 border-t pt-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={contactSales}
                  onChange={(e) => setContactSales(e.target.checked)}
                />
                Contact sales (hide checkout on Plans page)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={(e) => setVisible(e.target.checked)}
                />
                Visible on Plans page
              </label>
            </div>
          </section>

          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        </div>

        <SheetFooter className="border-t">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !slug || !name}>
            {busy ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Searchable multi-select for ISO country codes. Reuses the gateway's
 *  /api/admin/cost-providers/countries endpoint so the list matches what
 *  telephony pricing uses. */
function CountryMultiSelect({
  all,
  picked,
  onChange,
}: {
  all: Country[] | null;
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = all ?? [];
    if (!q) return list;
    return list.filter((c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  }, [all, search]);

  function toggle(code: string) {
    const next = new Set(picked);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  }

  function clearAll() {
    onChange(new Set());
  }

  const codeToName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of all ?? []) m.set(c.code, c.name);
    return m;
  }, [all]);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full justify-between"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-sm">
          {picked.size === 0 ? "All countries (no restriction)" : `${picked.size} selected`}
        </span>
        <ChevronsUpDown className="h-4 w-4 opacity-50" />
      </Button>

      {picked.size > 0 && (
        <div className="flex flex-wrap gap-1">
          {[...picked].slice(0, 30).map((code) => (
            <Badge key={code} variant="secondary" className="gap-1 font-mono text-[10px]">
              {code}
              <button
                type="button"
                aria-label={`Remove ${code}`}
                onClick={() => toggle(code)}
                className="ml-0.5 rounded hover:bg-background/60"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {picked.size > 30 && (
            <Badge variant="outline" className="text-[10px]">+{picked.size - 30} more</Badge>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px]"
            onClick={clearAll}
          >
            clear all
          </Button>
        </div>
      )}

      {open && (
        <div className="rounded-md border bg-popover p-2">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search countries…"
              className="pl-8"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {all == null && <div className="px-2 py-3 text-xs text-muted-foreground">Loading countries…</div>}
            {filtered.length === 0 && all != null && (
              <div className="px-2 py-3 text-xs text-muted-foreground">No matches.</div>
            )}
            {filtered.map((c) => {
              const checked = picked.has(c.code);
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => toggle(c.code)}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="flex items-center gap-2">
                    <span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span>{c.name}</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Render any picked codes the loaded list doesn't know about (e.g. from an
          older catalog) so the admin still sees them rather than dropping them silently. */}
      {[...picked].some((c) => !codeToName.has(c)) && (
        <div className="text-[11px] text-muted-foreground">
          Unknown codes still applied: {[...picked].filter((c) => !codeToName.has(c)).join(", ")}
        </div>
      )}
    </div>
  );
}
