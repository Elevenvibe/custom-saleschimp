"use client";

import { useEffect, useMemo, useState } from "react";

import {
  api,
  type CostProvider,
  type IntegratedCatalog,
  type IntegratedProvider,
  type ProviderKind,
} from "@/lib/api";
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
import { ExternalLink, KeyRound, Trash2 } from "lucide-react";

const KIND_LABEL: Record<ProviderKind, string> = {
  llm: "LLM",
  stt: "STT",
  tts: "TTS",
  embedding: "Embedding",
  telephony: "Telephony",
  phone_number: "Phone Number",
};

type RowState = {
  kind: ProviderKind;
  catalog: IntegratedProvider;
  costProvider: CostProvider | null;
};

export default function ProviderApiKeysPage() {
  const [catalog, setCatalog] = useState<IntegratedCatalog | null>(null);
  const [providers, setProviders] = useState<CostProvider[] | null>(null);
  // Per-provider credential status (configured or not). Lazy-loaded.
  const [statusBySlug, setStatusBySlug] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RowState | null>(null);

  function load() {
    api<IntegratedCatalog>("/api/admin/cost-providers/integrated").then(setCatalog).catch((e) => setError(e.message));
    api<CostProvider[]>("/api/admin/cost-providers").then(setProviders).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  // Whenever providers list refreshes, fetch credential status for each.
  useEffect(() => {
    if (!providers) return;
    let cancelled = false;
    Promise.all(
      providers.map((p) =>
        api<{ configured: boolean }>(`/api/admin/cost-providers/${p.id}/credentials`)
          .then((r) => ({ slug: p.slug, configured: r.configured }))
          .catch(() => ({ slug: p.slug, configured: false })),
      ),
    ).then((results) => {
      if (cancelled) return;
      setStatusBySlug(Object.fromEntries(results.map((r) => [r.slug, r.configured])));
    });
    return () => {
      cancelled = true;
    };
  }, [providers]);

  const rows: RowState[] = useMemo(() => {
    if (!catalog) return [];
    const bySlug = new Map<string, CostProvider>();
    for (const p of providers ?? []) bySlug.set(p.slug, p);
    const out: RowState[] = [];
    for (const [kind, items] of Object.entries(catalog) as [ProviderKind, IntegratedProvider[]][]) {
      for (const c of items) {
        out.push({ kind, catalog: c, costProvider: bySlug.get(c.slug) ?? null });
      }
    }
    return out;
  }, [catalog, providers]);

  const byKind = useMemo(() => {
    const m: Partial<Record<ProviderKind, RowState[]>> = {};
    for (const r of rows) (m[r.kind] ??= []).push(r);
    return m;
  }, [rows]);

  async function clearKey(row: RowState) {
    if (!row.costProvider) return;
    if (!confirm(`Remove stored API key for ${row.catalog.name}?`)) return;
    try {
      await api(`/api/admin/cost-providers/${row.costProvider.id}/credentials`, {
        method: "DELETE",
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Provider API keys</h2>
        <PageDescription>
          Platform-level credentials for every integrated provider. Stored Fernet-encrypted in the Control DB.
          Setting a key here creates a <code className="font-mono">cost_providers</code> row on first use so live
          model fetching and price syncing can call the vendor on the platform&apos;s behalf.
        </PageDescription>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      {(Object.entries(byKind) as [ProviderKind, RowState[]][]).map(([kind, items]) => (
        <section key={kind} className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {KIND_LABEL[kind]} ({items.length})
          </div>
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Provider</th>
                  <th className="px-4 py-2">Slug</th>
                  <th className="px-4 py-2">API key</th>
                  <th className="px-4 py-2 w-48 text-right" />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const configured = r.costProvider ? statusBySlug[r.catalog.slug] : false;
                  return (
                    <tr key={r.catalog.slug} className="border-t">
                      <td className="px-4 py-2">
                        <div className="font-medium">{r.catalog.name}</div>
                        {r.catalog.homepage && (
                          <a
                            href={r.catalog.homepage}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                          >
                            {r.catalog.homepage.replace(/^https?:\/\//, "")}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{r.catalog.slug}</td>
                      <td className="px-4 py-2">
                        {configured ? (
                          <Badge>configured</Badge>
                        ) : r.costProvider ? (
                          <Badge variant="secondary">no key</Badge>
                        ) : (
                          <Badge variant="outline">not set up</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right space-x-1">
                        <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                          <KeyRound className="h-4 w-4" />
                          {configured ? "Rotate" : "Set key"}
                        </Button>
                        {configured && r.costProvider && (
                          <Button size="sm" variant="ghost" onClick={() => clearKey(r)} title="Remove">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {editing && (
        <SetKeyDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function SetKeyDialog({
  row,
  onClose,
  onSaved,
}: {
  row: RowState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/cost-providers/upsert-credentials", {
        method: "POST",
        body: JSON.stringify({
          kind: row.kind,
          slug: row.catalog.slug,
          api_key: apiKey,
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
          <DialogTitle>{row.catalog.name} API key</DialogTitle>
          <DialogDescription>
            Platform-level credential for <code className="font-mono">{row.catalog.slug}</code>. Stored
            Fernet-encrypted; the cost_provider row will be created automatically on first save if it doesn&apos;t
            already exist.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>API key</Label>
            <Input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="•••"
            />
          </div>
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !apiKey}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
