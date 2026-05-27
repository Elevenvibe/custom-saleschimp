"use client";

/**
 * /console/marketplace — tenant plugin browse + install.
 *
 * Ported wholesale from app-ui/app/(authed)/marketplace/page.tsx. The only
 * differences are: import paths (`@/components/...` resolves into console/
 * here), `microsToUsd` lives on `@/lib/api` rather than being inlined, and
 * the page no longer needs its own back-to-dashboard link (the AppShell
 * sidebar handles navigation).
 */

import { useEffect, useState } from "react";

import {
  api,
  type CatalogEntry,
  type InstallRow,
  microsToUsd,
} from "@/lib/api";
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
import { Textarea } from "@/components/ui/textarea";
import { Boxes, Loader2 } from "lucide-react";

function priceLabel(e: { pricing_kind: string; price_micros: number; currency: string }): string {
  if (e.pricing_kind === "free" || e.price_micros === 0) return "Free";
  const amt = microsToUsd(e.price_micros);
  if (e.pricing_kind === "monthly") return `${amt} ${e.currency}/mo`;
  if (e.pricing_kind === "per_call") return `${amt} ${e.currency}/call`;
  return `${amt} ${e.currency}`;
}

export default function ConsoleMarketplacePage() {
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [installs, setInstalls] = useState<InstallRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [installing, setInstalling] = useState<CatalogEntry | null>(null);
  const [settingsJson, setSettingsJson] = useState("{}");

  function loadAll() {
    setError(null);
    api<CatalogEntry[]>("/api/tenant/marketplace").then(setCatalog).catch((e) => setError(e.message));
    api<InstallRow[]>("/api/tenant/marketplace/installed").then(setInstalls).catch(() => setInstalls([]));
  }
  useEffect(loadAll, []);

  const installedBySlug = new Map<string, InstallRow>(
    (installs ?? []).map((i) => [i.slug, i]),
  );

  async function confirmInstall() {
    if (!installing) return;
    setBusySlug(installing.slug);
    setError(null);
    try {
      let settings: Record<string, unknown> | null = null;
      try {
        settings = settingsJson.trim() ? JSON.parse(settingsJson) : null;
      } catch {
        throw new Error("settings must be valid JSON");
      }
      await api(`/api/tenant/marketplace/${installing.slug}/install`, {
        method: "POST",
        body: JSON.stringify({ settings }),
      });
      setInstalling(null);
      setSettingsJson("{}");
      loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusySlug(null);
    }
  }

  async function uninstall(slug: string) {
    if (!confirm(`Pause ${slug}? Re-install later picks up the same settings without a second charge.`)) return;
    setBusySlug(slug);
    try {
      await api(`/api/tenant/marketplace/${slug}/uninstall`, { method: "POST" });
      loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusySlug(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Boxes className="size-6" /> Marketplace
        </h1>
        <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
          Extend your workspace with plugins. Install drops a row on your wallet ledger for paid plugins.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {catalog && catalog.length === 0 && (
        <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--card)] p-8 text-center text-sm text-[color:var(--muted-foreground)]">
          No plugins published yet. Check back soon.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {(catalog ?? []).map((p) => {
          const installed = installedBySlug.get(p.slug);
          return (
            <div key={p.slug} className="rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{p.name}</div>
                  {p.vendor && (
                    <div className="text-xs text-[color:var(--muted-foreground)]">by {p.vendor}</div>
                  )}
                </div>
                <Badge variant={p.pricing_kind === "free" ? "secondary" : "default"}>
                  {priceLabel(p)}
                </Badge>
              </div>
              {p.description && (
                <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">{p.description}</p>
              )}
              {p.hooks.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {p.hooks.map((h) => (
                    <span
                      key={h}
                      className="rounded bg-[color:var(--muted)] px-1.5 py-0.5 font-mono text-[10px]"
                    >
                      {h}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-4 flex items-center justify-between">
                {installed ? (
                  <>
                    <Badge variant={installed.status === "active" ? "default" : "secondary"}>
                      {installed.status}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busySlug === p.slug}
                      onClick={() => uninstall(p.slug)}
                    >
                      {busySlug === p.slug ? <Loader2 className="size-4 animate-spin" /> : "Pause"}
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-[color:var(--muted-foreground)]">
                      {p.required_scopes.length > 0 ? `Needs: ${p.required_scopes.join(", ")}` : ""}
                    </span>
                    <Button
                      size="sm"
                      disabled={busySlug === p.slug}
                      onClick={() => {
                        setInstalling(p);
                        setSettingsJson("{}");
                      }}
                    >
                      {busySlug === p.slug ? <Loader2 className="size-4 animate-spin" /> : "Install"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {installing && (
        <Dialog open onOpenChange={(o) => !o && setInstalling(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Install {installing.name}</DialogTitle>
              <DialogDescription>
                {installing.pricing_kind === "one_time" && (
                  <>
                    One-time charge of{" "}
                    <strong>
                      {microsToUsd(installing.price_micros)} {installing.currency}
                    </strong>{" "}
                    to your wallet.
                  </>
                )}
                {installing.pricing_kind === "monthly" && (
                  <>
                    Subscription at{" "}
                    <strong>
                      {microsToUsd(installing.price_micros)} {installing.currency}/month
                    </strong>{" "}
                    (recurring billing wires up in a follow-up — V1 installs without auto-charge).
                  </>
                )}
                {installing.pricing_kind === "per_call" && (
                  <>
                    You&apos;ll be billed{" "}
                    <strong>
                      {microsToUsd(installing.price_micros)} {installing.currency}/call
                    </strong>{" "}
                    for each call that fires this plugin&apos;s hooks.
                  </>
                )}
                {installing.pricing_kind === "free" && <>Free plugin.</>}
              </DialogDescription>
            </DialogHeader>
            <div>
              <div className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)] mb-1">
                Settings (JSON)
              </div>
              <Textarea
                rows={5}
                value={settingsJson}
                onChange={(e) => setSettingsJson(e.target.value)}
                className="font-mono text-xs"
                placeholder='{"api_token":"…"}'
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setInstalling(null)} disabled={busySlug !== null}>
                Cancel
              </Button>
              <Button onClick={confirmInstall} disabled={busySlug !== null}>
                {busySlug ? "Installing…" : "Confirm install"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
