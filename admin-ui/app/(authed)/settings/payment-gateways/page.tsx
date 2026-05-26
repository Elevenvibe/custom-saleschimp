"use client";

/**
 * Super-admin: Stripe + Paystack API key management.
 *
 * Mirrors the /settings/provider-api-keys page in shape — one row per
 * provider, an Edit dialog that accepts the secret + publishable +
 * webhook keys, and a Clear button to revert to env-fallback.
 *
 * Secrets are POSTed once and never round-tripped — the GET endpoint
 * only ever returns the last 4 chars of the secret so an admin can
 * sanity-check what's stored.
 */

import { useEffect, useState } from "react";

import { api, type PaymentProviderStatus } from "@/lib/api";
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
import { CreditCard, ExternalLink, KeyRound, Trash2 } from "lucide-react";

const PROVIDER_META: Record<
  "stripe" | "paystack",
  { label: string; docs: string; publishablePrefix: string; secretPrefix: string }
> = {
  stripe: {
    label: "Stripe",
    docs: "https://dashboard.stripe.com/apikeys",
    publishablePrefix: "pk_…",
    secretPrefix: "sk_…",
  },
  paystack: {
    label: "Paystack",
    docs: "https://dashboard.paystack.com/#/settings/developer",
    publishablePrefix: "pk_…",
    secretPrefix: "sk_…",
  },
};

export default function PaymentGatewaysPage() {
  const [rows, setRows] = useState<PaymentProviderStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PaymentProviderStatus | null>(null);

  function load() {
    api<PaymentProviderStatus[]>("/api/admin/payment-providers")
      .then(setRows)
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function clearKeys(row: PaymentProviderStatus) {
    if (!confirm(`Clear stored ${row.provider} keys? The provider will fall back to env vars (if set).`)) return;
    try {
      await api(`/api/admin/payment-providers/${row.provider}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="p-8 space-y-6">
      <PageDescription>
        Stripe and Paystack secrets used by the wallet top-up + webhook flows. Stored
        Fernet-encrypted at rest; the secret key is never returned over the API, only its
        last 4 characters for sanity checks. Clearing a row falls back to the matching{" "}
        <code>STRIPE_*</code> / <code>PAYSTACK_*</code> env vars.
      </PageDescription>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Provider</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Source</th>
              <th className="px-4 py-2">Secret key</th>
              <th className="px-4 py-2">Publishable key</th>
              <th className="px-4 py-2">Webhook secret</th>
              <th className="px-4 py-2 w-32" />
            </tr>
          </thead>
          <tbody>
            {!rows && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {rows?.map((r) => {
              const meta = PROVIDER_META[r.provider];
              return (
                <tr key={r.provider} className="border-t">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <CreditCard className="size-4 text-muted-foreground" />
                      <span className="font-medium">{meta.label}</span>
                      <a
                        href={meta.docs}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                        title="Provider dashboard"
                      >
                        <ExternalLink className="size-3" />
                      </a>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={r.configured ? "default" : "secondary"}>
                      {r.configured ? "Live" : "Off"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {r.source ?? "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.secret_key_last4 ? `…${r.secret_key_last4}` : "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs truncate max-w-[200px]" title={r.publishable_key}>
                    {r.publishable_key || "—"}
                  </td>
                  <td className="px-4 py-2">
                    {r.has_webhook_secret
                      ? <Badge variant="secondary">set</Badge>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right space-x-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                      <KeyRound className="size-4" /> {r.configured ? "Update" : "Set"}
                    </Button>
                    {r.configured && r.source === "db" && (
                      <Button size="sm" variant="ghost" onClick={() => clearKeys(r)} title="Clear DB-stored keys">
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function EditDialog({
  row,
  onClose,
  onSaved,
}: {
  row: PaymentProviderStatus;
  onClose: () => void;
  onSaved: () => void;
}) {
  const meta = PROVIDER_META[row.provider];
  // We deliberately do NOT prefill secret_key — that field stays empty
  // so the operator has to paste a fresh value (or hit cancel). The
  // publishable key is safe to surface so they don't have to re-copy
  // it from the provider dashboard.
  const [secretKey, setSecretKey] = useState("");
  const [publishableKey, setPublishableKey] = useState(row.publishable_key ?? "");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/payment-providers/${row.provider}`, {
        method: "PUT",
        body: JSON.stringify({
          secret_key: secretKey,
          publishable_key: publishableKey,
          webhook_secret: webhookSecret,
          active: true,
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
          <DialogTitle>{row.configured ? "Update" : "Set up"} {meta.label} keys</DialogTitle>
          <DialogDescription>
            Pasted secrets are Fernet-encrypted before storage and never returned over the API.
            {row.configured && (
              <> Current secret ends in <code>…{row.secret_key_last4}</code>.</>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Secret key</Label>
            <Input
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder={meta.secretPrefix}
              autoComplete="off"
            />
          </div>
          <div>
            <Label>Publishable / public key</Label>
            <Input
              value={publishableKey}
              onChange={(e) => setPublishableKey(e.target.value)}
              placeholder={meta.publishablePrefix}
              autoComplete="off"
            />
            <div className="mt-1 text-xs text-muted-foreground">
              Shipped to the customer browser for Stripe Elements / Paystack inline. Safe to expose.
            </div>
          </div>
          <div>
            <Label>Webhook secret</Label>
            <Input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={row.provider === "stripe" ? "whsec_…" : "(same as secret key for Paystack)"}
              autoComplete="off"
            />
            <div className="mt-1 text-xs text-muted-foreground">
              Paystack signs webhooks with the secret key; you can paste the same value here.
            </div>
          </div>
        </div>
        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !secretKey}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
