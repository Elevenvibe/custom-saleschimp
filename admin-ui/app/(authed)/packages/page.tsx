"use client";

import { useEffect, useState } from "react";

import { api, type BillingPeriod, type Package, type PackageKind } from "@/lib/api";
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
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Plus, Trash2 } from "lucide-react";

const MICROS_PER_UNIT = 1_000_000;

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
          Subscription tiers customers can pick on the Plans page. PAYG packages bundle a per-month minute
          allowance plus an overage rate; Annual packages are typically larger commitments behind a Contact
          Sales handoff.
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
                <th className="px-4 py-2">Bundled mins</th>
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
              {packages?.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-2">
                    <div className="font-medium">{p.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{p.slug}</div>
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={p.kind === "annual" ? "default" : "secondary"}>{p.kind}</Badge>
                    {p.contact_sales && <Badge variant="outline" className="ml-1">contact sales</Badge>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {p.contact_sales ? "—" : `${centsToUsd(p.monthly_price_cents)} ${p.currency}/${p.billing_period === "annual" ? "yr" : "mo"}`}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{p.bundled_minutes.toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {p.contact_sales ? "custom" : `${microsToUsd(p.overage_per_minute_micros)}/min`}
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
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing !== null && (
        <PackageDialog
          mode={editing === "new" ? "create" : "edit"}
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

function PackageDialog({
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
  // overage expressed in $/min for human input, stored as micros
  const [overagePerMinUsd, setOveragePerMinUsd] = useState(
    existing ? (existing.overage_per_minute_micros / MICROS_PER_UNIT).toString() : "",
  );
  const [concurrencyIncluded, setConcurrencyIncluded] = useState(existing?.concurrency_included ?? 0);
  const [currency, setCurrency] = useState(existing?.currency ?? "USD");
  const [contactSales, setContactSales] = useState(existing?.contact_sales ?? false);
  const [visible, setVisible] = useState(existing?.visible ?? true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const overageUsd = overagePerMinUsd === "" ? 0 : Number(overagePerMinUsd);
      if (!Number.isFinite(overageUsd) || overageUsd < 0) throw new Error("overage must be a non-negative number");
      const body: Record<string, unknown> = {
        slug,
        name,
        description: description || null,
        kind,
        billing_period: billingPeriod,
        monthly_price_cents: monthlyPriceCents,
        bundled_minutes: bundledMinutes,
        overage_per_minute_micros: Math.round(overageUsd * MICROS_PER_UNIT),
        concurrency_included: concurrencyIncluded,
        currency,
        contact_sales: contactSales,
        visible,
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New package" : `Edit ${existing?.name}`}</DialogTitle>
          <DialogDescription>
            PAYG packages have a monthly price, a bundled minute allowance, and an overage rate. Annual packages
            with <code>Contact sales</code> hide checkout on the customer Plans page and surface a Contact button.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
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
              <Label>Billing period</Label>
              <Select value={billingPeriod} onValueChange={(v) => setBillingPeriod(v as BillingPeriod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">monthly</SelectItem>
                  <SelectItem value="annual">annual</SelectItem>
                  <SelectItem value="usage">usage</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Price (cents/{billingPeriod === "annual" ? "year" : "month"})</Label>
              <Input
                type="number"
                value={monthlyPriceCents}
                onChange={(e) => setMonthlyPriceCents(Number(e.target.value || 0))}
                disabled={contactSales}
                placeholder="2900"
              />
              <div className="mt-1 text-xs text-muted-foreground">{centsToUsd(monthlyPriceCents)} {currency}</div>
            </div>
            <div>
              <Label>Currency</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={8} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Bundled minutes</Label>
              <Input
                type="number"
                value={bundledMinutes}
                onChange={(e) => setBundledMinutes(Number(e.target.value || 0))}
                placeholder="300"
              />
            </div>
            <div>
              <Label>Overage ($/min)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={overagePerMinUsd}
                onChange={(e) => setOveragePerMinUsd(e.target.value)}
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
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !slug || !name}>
            {busy ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
