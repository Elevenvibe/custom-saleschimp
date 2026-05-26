"use client";

/**
 * Super-admin: plugin marketplace catalog.
 *
 * Manages the catalog tenants browse from /marketplace on the customer
 * app (port 3030). One row per published plugin. The Sheet form
 * handles pricing kind, hooks, required scopes, and visibility — a
 * hidden entry stays out of the customer marketplace until visible
 * is flipped on.
 */

import { useEffect, useState } from "react";

import {
  api,
  type MarketplacePlugin,
  type PluginPricingKind,
  microsToUsd,
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
import { Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";

const PRICING_LABEL: Record<PluginPricingKind, string> = {
  free: "Free",
  one_time: "One-time charge",
  monthly: "Monthly subscription",
  per_call: "Per-call",
};

function priceCell(p: MarketplacePlugin): string {
  if (p.pricing_kind === "free" || p.price_micros === 0) return "Free";
  const amt = microsToUsd(p.price_micros);
  if (p.pricing_kind === "monthly") return `${amt} ${p.currency}/mo`;
  if (p.pricing_kind === "per_call") return `${amt} ${p.currency}/call`;
  return `${amt} ${p.currency}`;
}

export default function AdminMarketplacePage() {
  const [rows, setRows] = useState<MarketplacePlugin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MarketplacePlugin | "new" | null>(null);

  function load() {
    api<MarketplacePlugin[]>("/api/admin/marketplace/plugins")
      .then(setRows)
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function remove(p: MarketplacePlugin) {
    if (!confirm(`Delete plugin "${p.name}" (${p.slug})? Existing tenant installs will be removed via FK cascade.`)) return;
    try {
      await api(`/api/admin/marketplace/plugins/${p.slug}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleVisible(p: MarketplacePlugin) {
    try {
      await api(`/api/admin/marketplace/plugins/${p.slug}`, {
        method: "PATCH",
        body: JSON.stringify({ visible: !p.visible }),
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Marketplace"
        action={
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> New plugin
          </Button>
        }
      />
      <div className="p-8 space-y-4">
        <PageDescription>
          The plugin catalog tenants browse from <code>/marketplace</code> on the customer app. Hidden entries are
          staged but invisible to tenants. Pricing kind drives how the install flow charges the wallet:{" "}
          <strong>one_time</strong> charges at install, <strong>monthly</strong> and <strong>per_call</strong> wire
          up in the runtime layer (P3).
        </PageDescription>

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}

        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Plugin</th>
                <th className="px-4 py-2">Pricing</th>
                <th className="px-4 py-2 text-right">Price</th>
                <th className="px-4 py-2">Hooks</th>
                <th className="px-4 py-2">Visible</th>
                <th className="px-4 py-2 w-32" />
              </tr>
            </thead>
            <tbody>
              {!rows && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Loading…</td>
                </tr>
              )}
              {rows?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    No plugins published yet. Click <strong>New plugin</strong> above.
                  </td>
                </tr>
              )}
              {rows?.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-2">
                    <div className="font-medium">{p.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {p.slug}{p.vendor ? ` · by ${p.vendor}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant="secondary">{PRICING_LABEL[p.pricing_kind] ?? p.pricing_kind}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{priceCell(p)}</td>
                  <td className="px-4 py-2">
                    {p.hooks.length === 0
                      ? <span className="text-xs text-muted-foreground">—</span>
                      : (
                        <div className="flex flex-wrap gap-1">
                          {p.hooks.slice(0, 3).map((h) => (
                            <span key={h} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{h}</span>
                          ))}
                          {p.hooks.length > 3 && (
                            <span className="text-[10px] text-muted-foreground">+{p.hooks.length - 3}</span>
                          )}
                        </div>
                      )}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={p.visible ? "default" : "secondary"}>{p.visible ? "yes" : "no"}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right space-x-1">
                    <Button size="sm" variant="ghost" onClick={() => toggleVisible(p)} title={p.visible ? "Hide" : "Publish"}>
                      {p.visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(p)} title="Edit">
                      <Pencil className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(p)} title="Delete">
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing !== null && (
        <PluginSheet
          mode={editing === "new" ? "create" : "edit"}
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

function PluginSheet({
  mode,
  existing,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  existing: MarketplacePlugin | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [vendor, setVendor] = useState(existing?.vendor ?? "");
  const [iconUrl, setIconUrl] = useState(existing?.icon_url ?? "");
  const [homepageUrl, setHomepageUrl] = useState(existing?.homepage_url ?? "");
  const [pricingKind, setPricingKind] = useState<PluginPricingKind>(existing?.pricing_kind ?? "free");
  // Human-readable price input — converted to micros on submit.
  const [priceInput, setPriceInput] = useState(
    existing && existing.price_micros > 0
      ? (existing.price_micros / 1_000_000).toString()
      : "",
  );
  const [currency, setCurrency] = useState(existing?.currency ?? "USD");
  const [hooksInput, setHooksInput] = useState((existing?.hooks ?? []).join(", "));
  const [scopesInput, setScopesInput] = useState((existing?.required_scopes ?? []).join(", "));
  const [visible, setVisible] = useState(existing?.visible ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function parseCsv(s: string): string[] {
    return s.split(",").map((v) => v.trim()).filter(Boolean);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const usd = priceInput === "" ? 0 : Number(priceInput);
      if (!Number.isFinite(usd) || usd < 0) throw new Error("Price must be ≥ 0");
      const body: Record<string, unknown> = {
        name,
        description: description || null,
        vendor: vendor || null,
        icon_url: iconUrl || null,
        homepage_url: homepageUrl || null,
        pricing_kind: pricingKind,
        price_micros: pricingKind === "free" ? 0 : Math.round(usd * 1_000_000),
        currency: currency.toUpperCase(),
        hooks: parseCsv(hooksInput),
        required_scopes: parseCsv(scopesInput),
        visible,
      };
      if (mode === "create") {
        if (!slug) throw new Error("Slug is required");
        await api("/api/admin/marketplace/plugins", {
          method: "POST",
          body: JSON.stringify({ slug, ...body }),
        });
      } else if (existing) {
        await api(`/api/admin/marketplace/plugins/${existing.slug}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="sm:!max-w-[42rem] flex flex-col gap-0"
      >
        <SheetHeader className="px-8 pt-6 pb-4">
          <SheetTitle>{mode === "create" ? "New plugin" : `Edit ${existing?.name}`}</SheetTitle>
          <SheetDescription>
            What you save here is what tenants see on the customer marketplace. Hidden plugins are saved but
            not browseable until you flip visibility on.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-8 pb-8 pt-2">
          <section className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Slug</Label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                  disabled={mode === "edit"}
                  placeholder="hubspot-sync"
                />
              </div>
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="HubSpot Sync" />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="What the plugin does, in one paragraph."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Vendor</Label>
                <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Acme Inc." />
              </div>
              <div>
                <Label>Homepage URL</Label>
                <Input value={homepageUrl} onChange={(e) => setHomepageUrl(e.target.value)} placeholder="https://…" />
              </div>
            </div>
            <div>
              <Label>Icon URL</Label>
              <Input value={iconUrl} onChange={(e) => setIconUrl(e.target.value)} placeholder="https://cdn…/icon.png" />
            </div>
          </section>

          <section className="space-y-3 border-t pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pricing</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Kind</Label>
                <Select value={pricingKind} onValueChange={(v) => setPricingKind(v as PluginPricingKind)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="one_time">One-time charge</SelectItem>
                    <SelectItem value="monthly">Monthly subscription</SelectItem>
                    <SelectItem value="per_call">Per-call</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>
                  Price ({pricingKind === "monthly" ? "USD/month" : pricingKind === "per_call" ? "USD/call" : "USD"})
                </Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  placeholder="19.99"
                  disabled={pricingKind === "free"}
                />
                <div className="mt-1 text-xs text-muted-foreground">
                  Stored as micros. {pricingKind !== "free" && priceInput
                    ? `${Math.round(Number(priceInput) * 1_000_000).toLocaleString()} micros`
                    : ""}
                </div>
              </div>
            </div>
            <div>
              <Label>Currency</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={8} />
            </div>
          </section>

          <section className="space-y-3 border-t pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Runtime</h3>
            <div>
              <Label>Hooks (comma-separated)</Label>
              <Input
                value={hooksInput}
                onChange={(e) => setHooksInput(e.target.value)}
                placeholder="call.started, call.ended, workflow.transition"
              />
              <div className="mt-1 text-xs text-muted-foreground">
                Pipeline events this plugin subscribes to. Drives the runtime fan-out (P3).
              </div>
            </div>
            <div>
              <Label>Required scopes (comma-separated)</Label>
              <Input
                value={scopesInput}
                onChange={(e) => setScopesInput(e.target.value)}
                placeholder="crm.write, transcripts.read"
              />
              <div className="mt-1 text-xs text-muted-foreground">
                Surfaced to the tenant at install time so they consent before the plugin sees data.
              </div>
            </div>
          </section>

          <section className="space-y-2 border-t pt-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={visible}
                onChange={(e) => setVisible(e.target.checked)}
              />
              Visible on the customer marketplace
            </label>
          </section>

          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t px-8 py-4">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !name || (mode === "create" && !slug)}>
            {busy ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
