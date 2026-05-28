"use client";

/**
 * Settings → Email providers — split across three tabs:
 *
 *   Notifications  the existing transactional email providers (SES,
 *                  Postmark, SMTP) used to send verify / invite /
 *                  password-reset emails. Unchanged behaviour.
 *
 *   SMTP           outbox credentials for the new Email feature
 *                  (Communication → Email). Sent mail goes out via
 *                  this account, distinct from Notifications.
 *
 *   IMAP           inbox credentials for the same Email feature.
 *                  When configured + active, the Email page pulls
 *                  messages from this account.
 *
 * SMTP + IMAP share one row in `mailbox_configs` (scope='platform').
 * The tab boundary is purely UI — both tabs PUT to /api/admin/mailbox
 * with a partial body so saving SMTP doesn't clobber IMAP and vice
 * versa.
 */

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

import { api, type EmailProvider } from "@/lib/api";
import { PageDescription } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { ProviderDialog } from "@/components/email-providers/ProviderDialog";
import { TestSendDialog } from "@/components/email-providers/TestSendDialog";
import { Mail, Pencil, Send, Trash2 } from "lucide-react";

type MailboxOut = {
  smtp_active: boolean;
  imap_active: boolean;
  from_email: string | null;
  from_name: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  imap_host: string | null;
  imap_port: number | null;
  imap_username: string | null;
};

export default function EmailProvidersPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
      <EmailProvidersInner />
    </Suspense>
  );
}

function EmailProvidersInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initialTab = sp.get("tab") === "smtp" || sp.get("tab") === "imap" ? sp.get("tab")! : "notifications";
  const [tab, setTab] = useState<string>(initialTab);

  function onTabChange(next: string) {
    setTab(next);
    // Reflect the tab in the URL so deep links (e.g. from /email) land
    // on the right tab. Use replace to avoid polluting history.
    const params = new URLSearchParams(sp.toString());
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="p-8 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Email</h2>
        <PageDescription>
          Configure transactional notifications, outbound SMTP, and IMAP for the platform mailbox.
        </PageDescription>
      </div>

      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="smtp">SMTP</TabsTrigger>
          <TabsTrigger value="imap">IMAP</TabsTrigger>
        </TabsList>

        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
        <TabsContent value="smtp">
          <MailboxTab kind="smtp" />
        </TabsContent>
        <TabsContent value="imap">
          <MailboxTab kind="imap" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- Notifications tab — existing content unchanged ------------------

function NotificationsTab() {
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
    <div className="space-y-4 pt-4">
      <div className="flex items-start justify-between gap-4">
        <PageDescription>
          Transactional email providers used for sign-up verify, invites, and password-reset. Secrets stored encrypted with Fernet.
        </PageDescription>
        <Button onClick={() => setEditing("new")}>Configure provider</Button>
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      {items && items.length === 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No providers configured. The gateway falls back to the in-memory{" "}
          <code className="font-mono">console</code> provider for local dev (logs emails to stdout).
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
    </div>
  );
}

// ---- SMTP + IMAP tabs — shared shape, different field set ------------

function MailboxTab({ kind }: { kind: "smtp" | "imap" }) {
  const [mailbox, setMailbox] = useState<MailboxOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form state — independent per tab so editing SMTP doesn't reset IMAP.
  const [host, setHost] = useState("");
  const [port, setPort] = useState<number>(kind === "smtp" ? 587 : 993);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [secure, setSecure] = useState(true); // SMTP=TLS, IMAP=SSL
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");

  function reload() {
    api<MailboxOut>("/api/admin/mailbox")
      .then((m) => {
        setMailbox(m);
        // Hydrate the form from the safe-preview fields the gateway
        // returns. Password is intentionally never echoed — leaving the
        // field empty means "don't change the stored password".
        if (kind === "smtp") {
          setHost(m.smtp_host ?? "");
          setPort(m.smtp_port ?? 587);
          setUsername(m.smtp_username ?? "");
        } else {
          setHost(m.imap_host ?? "");
          setPort(m.imap_port ?? 993);
          setUsername(m.imap_username ?? "");
        }
        setFromEmail(m.from_email ?? "");
        setFromName(m.from_name ?? "");
      })
      .catch((e) => setError((e as Error).message));
  }
  useEffect(reload, [kind]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const body: Record<string, unknown> = {
        from_email: fromEmail || null,
        from_name: fromName || null,
      };
      const block: Record<string, unknown> = {
        host,
        port,
        username,
        // Only send password if the user typed one — empty means keep current.
      };
      if (password) block.password = password;
      if (kind === "smtp") {
        block.use_tls = secure;
        if (password) body.smtp = block;
        body.smtp_active = true;
      } else {
        block.use_ssl = secure;
        if (password) body.imap = block;
        body.imap_active = true;
      }
      // If the user hasn't entered a password but there's no existing
      // record either, surface a clear error rather than silently saving
      // a half-record.
      const hasStored =
        kind === "smtp" ? Boolean(mailbox?.smtp_host) : Boolean(mailbox?.imap_host);
      if (!password && !hasStored) {
        throw new Error("Password is required to save new credentials.");
      }
      await api<MailboxOut>("/api/admin/mailbox", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setOk("Saved.");
      setPassword("");
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/mailbox", {
        method: "PUT",
        body: JSON.stringify(
          kind === "smtp" ? { smtp_active: false } : { imap_active: false },
        ),
      });
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const active = kind === "smtp" ? mailbox?.smtp_active : mailbox?.imap_active;

  return (
    <form onSubmit={save} className="space-y-4 max-w-2xl pt-4">
      <PageDescription>
        {kind === "smtp"
          ? "Outbound SMTP for the Email feature. Not used for transactional notifications — that's on the Notifications tab."
          : "Inbound IMAP for the Email feature. The fetcher pulls new messages into the platform inbox."}
      </PageDescription>

      <div className="rounded-md border bg-card p-3 flex items-center justify-between text-xs">
        <span>Status</span>
        <Badge variant={active ? "default" : "secondary"}>
          {active ? "active" : "not configured"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Server host</Label>
          <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder={kind === "smtp" ? "smtp.example.com" : "imap.example.com"} required />
        </div>
        <div>
          <Label>Port</Label>
          <Input
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            required
          />
        </div>
        <div>
          <Label>{kind === "smtp" ? "Use TLS" : "Use SSL"}</Label>
          <select
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={secure ? "true" : "false"}
            onChange={(e) => setSecure(e.target.value === "true")}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div className="col-span-2">
          <Label>Username</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="col-span-2">
          <Label>Password {mailbox?.[kind === "smtp" ? "smtp_host" : "imap_host"] && <span className="text-muted-foreground">(leave blank to keep existing)</span>}</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="col-span-2 border-t pt-3 mt-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            Display (shared across SMTP + IMAP)
          </div>
        </div>
        <div>
          <Label>From email</Label>
          <Input
            type="email"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            placeholder="support@yourdomain.com"
          />
        </div>
        <div>
          <Label>From name</Label>
          <Input value={fromName} onChange={(e) => setFromName(e.target.value)} />
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      {ok && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {active && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={deactivate}
          >
            Mark inactive
          </Button>
        )}
      </div>
    </form>
  );
}
