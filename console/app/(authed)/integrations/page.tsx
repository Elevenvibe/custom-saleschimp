"use client";

/**
 * /console/integrations — tenant connects their Google account and imports
 * Google Contacts (tagged with a label).
 *
 * Flow: "Connect Google" fetches an authenticated start URL and redirects to
 * Google consent; the gateway callback stores tokens and bounces back here
 * with #google_linked / #google_error. Once linked, "Import contacts" pulls
 * via the People API into a labeled contacts list.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plug, RefreshCw, Trash2 } from "lucide-react";

import { api } from "@/lib/api";

type Status = {
  available: boolean;
  enabled_services: string[];
  linked: boolean;
  google_email: string | null;
  contact_count: number;
  labels: string[];
};
type Contact = {
  id: number;
  source: string;
  label: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
};

export default function IntegrationsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Status>("/api/tenant/integrations/google")
      .then(setStatus)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  // Handle the returning OAuth fragment.
  useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    history.replaceState(null, "", window.location.pathname + window.location.search);
    if (params.get("google_linked")) setNotice("Google account connected.");
    const err = params.get("google_error");
    if (err) setError(err);
  }, []);

  async function connect() {
    setError(null);
    try {
      const r = await api<{ url: string }>("/api/tenant/integrations/google/link/start");
      window.location.href = r.url;
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect your Google account? Imported contacts are kept.")) return;
    try {
      await api("/api/tenant/integrations/google/link", { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (error && !status) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      </div>
    );
  }
  if (!status) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10 text-sm text-muted-foreground">Loading…</div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-8 py-10">
      <header>
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect Google to import your contacts into this workspace.
        </p>
      </header>

      {notice && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}
      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <section className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-md bg-muted">
              <Plug className="size-5" />
            </span>
            <div>
              <div className="font-medium">Google</div>
              <div className="text-xs text-muted-foreground">
                {!status.available
                  ? "Not configured by your platform administrator."
                  : status.linked
                    ? `Connected as ${status.google_email ?? "your Google account"}`
                    : "Import contacts from your Google account."}
              </div>
            </div>
          </div>
          {status.available && (
            status.linked ? (
              <button
                onClick={disconnect}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted/50"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={connect}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
              >
                Connect Google
              </button>
            )
          )}
        </div>
      </section>

      {status.available && status.linked && (
        <ContactsPanel labels={status.labels} count={status.contact_count} onChanged={load} />
      )}
    </div>
  );
}

function ContactsPanel({
  labels,
  count,
  onChanged,
}: {
  labels: string[];
  count: number;
  onChanged: () => void;
}) {
  const [label, setLabel] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [contacts, setContacts] = useState<Contact[] | null>(null);

  const loadContacts = useCallback(() => {
    const q = filter ? `?label=${encodeURIComponent(filter)}` : "";
    api<Contact[]>(`/api/tenant/integrations/contacts${q}`)
      .then(setContacts)
      .catch((e) => setError((e as Error).message));
  }, [filter]);
  useEffect(loadContacts, [loadContacts]);

  async function runImport() {
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<{ imported: number; updated: number; total_fetched: number }>(
        "/api/tenant/integrations/google/contacts/import",
        { method: "POST", body: JSON.stringify({ label: label || null }) },
      );
      setResult(`Fetched ${r.total_fetched} — ${r.imported} new, ${r.updated} updated.`);
      onChanged();
      loadContacts();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Contacts <span className="text-muted-foreground">({count})</span></h2>
        <button onClick={loadContacts} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <RefreshCw className="size-3" /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label className="text-xs text-muted-foreground">Label (optional)</label>
          <input
            className="mt-0.5 w-full rounded-md border px-3 py-2 text-sm"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Leads Q2"
          />
        </div>
        <button
          onClick={runImport}
          disabled={importing}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {importing ? <Loader2 className="size-4 animate-spin" /> : null}
          {importing ? "Importing…" : "Import contacts"}
        </button>
      </div>

      {result && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{result}</div>}
      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      {labels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <button
            onClick={() => setFilter("")}
            className={`rounded-full border px-2 py-0.5 ${filter === "" ? "bg-primary text-primary-foreground" : ""}`}
          >
            All
          </button>
          {labels.map((l) => (
            <button
              key={l}
              onClick={() => setFilter(l)}
              className={`rounded-full border px-2 py-0.5 ${filter === l ? "bg-primary text-primary-foreground" : ""}`}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Label</th>
            </tr>
          </thead>
          <tbody>
            {!contacts ? (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : contacts.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No contacts yet — run an import.</td></tr>
            ) : (
              contacts.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2">{c.display_name ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.email ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.phone ?? "—"}</td>
                  <td className="px-3 py-2">{c.label ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
