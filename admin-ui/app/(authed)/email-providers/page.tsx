"use client";

import { useEffect, useState } from "react";
import { api, type EmailProvider } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProviderDialog } from "@/components/email-providers/ProviderDialog";
import { TestSendDialog } from "@/components/email-providers/TestSendDialog";
import { Mail, Pencil, Send, Trash2 } from "lucide-react";

export default function EmailProvidersPage() {
  const [items, setItems] = useState<EmailProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmailProvider | "new" | null>(null);
  const [testing, setTesting] = useState<EmailProvider | null>(null);

  function reload() {
    api<EmailProvider[]>("/api/admin/email-providers")
      .then(setItems)
      .catch((e) => setError(e.message));
  }
  useEffect(reload, []);

  async function remove(id: number) {
    if (!confirm("Delete this provider configuration?")) return;
    try {
      await api(`/api/admin/email-providers/${id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Email providers"
        description="Platform default + per-tenant overrides. Secrets stored encrypted with Fernet."
        action={<Button onClick={() => setEditing("new")}>Configure provider</Button>}
      />
      <div className="p-8 space-y-4">
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        {items && items.length === 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No providers configured. The gateway falls back to the in-memory{" "}
            <code className="font-mono">console</code> provider for local dev (logs emails to
            stdout). Configure a real provider for production email.
          </div>
        )}
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Scope</th>
                <th className="px-4 py-2">Provider</th>
                <th className="px-4 py-2">From</th>
                <th className="px-4 py-2">Active</th>
                <th className="px-4 py-2">Updated</th>
                <th className="px-4 py-2 w-32" />
              </tr>
            </thead>
            <tbody>
              {!items && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {items?.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-2">
                    {c.scope_kind === "platform" ? "platform" : `tenant #${c.scope_id}`}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant="secondary" className="font-mono text-xs">
                      <Mail className="mr-1 h-3 w-3" /> {c.provider}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {c.from_name ? `${c.from_name} <${c.from_email}>` : c.from_email}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={c.is_active ? "default" : "secondary"}>
                      {c.is_active ? "active" : "inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(c.updated_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right space-x-1">
                    <Button size="sm" variant="ghost" onClick={() => setTesting(c)} title="Send test">
                      <Send className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(c)} title="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(c.id)} title="Delete">
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
        <ProviderDialog
          mode={editing === "new" ? "create" : "edit"}
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {testing && (
        <TestSendDialog
          provider={testing}
          onClose={() => setTesting(null)}
        />
      )}
    </>
  );
}
