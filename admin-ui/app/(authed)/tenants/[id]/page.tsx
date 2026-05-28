"use client";

import { use, useEffect, useState } from "react";
import {
  api,
  type AdminInvitesRes,
  type AdminInvite,
  type Tenant,
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
import Link from "next/link";
import { KeyRound, Send, Trash2, Wallet } from "lucide-react";

type TenantDetail = {
  tenant: Tenant;
  members: { id: number; email: string; role: string; dograh_user_id: number | null; joined_at: string }[];
};

type StateFilter = "all" | "pending" | "accepted" | "expired";

type AuditEntry = {
  id: number;
  actor_kind: string;
  actor_user_id: number | null;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  payload: Record<string, unknown> | null;
  ip: string | null;
  ua: string | null;
  created_at: string;
};

type AuditRes = { total: number; items: AuditEntry[] };

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<TenantDetail | null>(null);
  const [invites, setInvites] = useState<AdminInvitesRes | null>(null);
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  // Single source of truth for the active tab so it survives reloads of
  // the data fetchers but doesn't survive route changes (intentional —
  // navigating away from a tenant should reset to Profile).
  const [tab, setTab] = useState<string>("profile");

  function loadTenant() {
    api<TenantDetail>(`/api/admin/tenants/${id}`).then(setData).catch((e) => setError(e.message));
  }
  function loadInvites() {
    api<AdminInvitesRes>(
      `/api/admin/invites?tenant_id=${id}&state=${stateFilter}&limit=100`
    )
      .then(setInvites)
      .catch(() => {});
  }
  useEffect(() => {
    loadTenant();
  }, [id]);
  useEffect(() => {
    loadInvites();
  }, [id, stateFilter]);

  async function revokeInvite(inv: AdminInvite) {
    if (!confirm(`Revoke invite for ${inv.email}?`)) return;
    try {
      await api(`/api/admin/invites/${inv.id}`, { method: "DELETE" });
      loadInvites();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function setStatus(next: string) {
    setBusy(true);
    try {
      await api(`/api/admin/tenants/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      loadTenant();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function purgeTenant() {
    if (!data) return;
    const slug = prompt(
      `PERMANENT DELETE: this wipes every row tied to tenant "${data.tenant.name}" — wallets, ledger, payment intents, invites, plugin installs, SSO config, everything.\n\nType the slug "${data.tenant.slug}" to confirm:`,
    );
    if (slug !== data.tenant.slug) {
      if (slug !== null) alert("Slug didn't match — nothing was deleted.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/tenants/${id}/purge`, {
        method: "DELETE",
        body: JSON.stringify({ confirm_slug: slug }),
      });
      window.location.href = "/tenants";
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function completeSignup() {
    if (
      !confirm(
        "Complete signup: call Dograh's signup API on this tenant's behalf, create the Dograh user + org, and mark the tenant active. Use this when the verification email never delivered.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/tenants/${id}/complete-signup`, { method: "POST" });
      loadTenant();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error)
    return (
      <div className="p-8">
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      </div>
    );
  if (!data) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  const t = data.tenant;
  return (
    <>
      <PageHeader
        title={t.name}
        action={
          <div className="flex gap-2">
            <Link href={`/tenants/${t.id}/wallet`}>
              <Button variant="outline" size="sm">
                <Wallet className="size-4" /> Wallet
              </Button>
            </Link>
            <Link href={`/tenants/${t.id}/sso`}>
              <Button variant="outline" size="sm">
                <KeyRound className="size-4" /> SSO
              </Button>
            </Link>
            {t.dograh_org_id == null && (
              <Button size="sm" disabled={busy} onClick={completeSignup}>
                Complete signup
              </Button>
            )}
            {t.dograh_org_id != null && t.status !== "active" && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setStatus("active")}>
                Activate
              </Button>
            )}
            {t.status !== "suspended" && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setStatus("suspended")}>
                Suspend
              </Button>
            )}
            {t.status === "cancelled" && (
              <Button variant="destructive" size="sm" disabled={busy} onClick={purgeTenant}>
                <Trash2 className="size-4" /> Purge permanently
              </Button>
            )}
          </div>
        }
      />
      <div className="p-8 space-y-6">
        <PageDescription>
          Tenant #{t.id} · <code className="font-mono">{t.slug}</code>
        </PageDescription>

        {/* Tabs mirror what the user-facing tenant view will eventually show
            on ports 8080/8081 so super-admins navigate the same surface
            their customers do. Profile + Logs are wired today; the others
            describe what's coming so reviewers know the cap is intentional
            (not a missing import). */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="phone">Phone numbers</TabsTrigger>
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="tickets">Tickets</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="space-y-6">
            <section className="rounded-lg border bg-card p-5">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <Field label="Owner email" value={t.owner_email} />
                <Field label="Status" value={t.status} />
                <Field label="Dograh org id" value={t.dograh_org_id ?? "—"} />
                <Field label="Created" value={new Date(t.created_at).toLocaleString()} />
                <Field
                  label="Concurrent calls cap"
                  value={t.concurrent_calls_limit ?? "package default"}
                />
                <Field
                  label="Auto-fallback for new assistants"
                  value={
                    <AutoFallbackToggle
                      tenantId={t.id}
                      initial={t.auto_fallback_enabled ?? false}
                      onChanged={loadTenant}
                    />
                  }
                />
              </div>
            </section>

            <section>
              <div className="mb-3 text-sm font-medium">Members</div>
              <div className="rounded-lg border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Email</th>
                      <th className="px-4 py-2">Role</th>
                      <th className="px-4 py-2">Dograh user</th>
                      <th className="px-4 py-2">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.members.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                          No members
                        </td>
                      </tr>
                    )}
                    {data.members.map((m) => (
                      <tr key={m.id} className="border-t">
                        <td className="px-4 py-2">{m.email}</td>
                        <td className="px-4 py-2">
                          <Badge variant="secondary">{m.role}</Badge>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{m.dograh_user_id ?? "—"}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {new Date(m.joined_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-medium">Invites</div>
                <div className="flex items-center gap-2">
                  <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as StateFilter)}>
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="accepted">Accepted</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={() => setShowInviteDialog(true)}>
                    <Send className="h-4 w-4" /> New invite
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Email</th>
                      <th className="px-4 py-2">Role</th>
                      <th className="px-4 py-2">State</th>
                      <th className="px-4 py-2">Expires</th>
                      <th className="px-4 py-2 w-16" />
                    </tr>
                  </thead>
                  <tbody>
                    {!invites && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                          Loading…
                        </td>
                      </tr>
                    )}
                    {invites?.items.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                          No invites for this filter.
                        </td>
                      </tr>
                    )}
                    {invites?.items.map((i) => (
                      <tr key={i.id} className="border-t">
                        <td className="px-4 py-2">{i.email}</td>
                        <td className="px-4 py-2">
                          <Badge variant="secondary">{i.role}</Badge>
                        </td>
                        <td className="px-4 py-2">
                          <Badge
                            variant={
                              i.state === "accepted"
                                ? "default"
                                : i.state === "expired"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {i.state}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {new Date(i.expires_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {i.state !== "accepted" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => revokeInvite(i)}
                              title="Revoke"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="metrics">
            <MetricsTab tenantId={t.id} />
          </TabsContent>

          <TabsContent value="agents">
            <ComingSoon
              title="Agents"
              note="Lists this tenant's Dograh workflows (assistants) — name, status, last edit, run counts. Proxies to Dograh's /api/v1/workflows scoped to the tenant's Dograh org id."
            />
          </TabsContent>

          <TabsContent value="phone">
            <ComingSoon
              title="Phone numbers"
              note="Phone numbers owned by the tenant — provider (Twilio/Telnyx/Plivo), E.164 number, monthly cost, attached workflow. Proxies to Dograh's telephony API."
            />
          </TabsContent>

          <TabsContent value="providers">
            <ProvidersTab tenantId={t.id} />
          </TabsContent>

          <TabsContent value="tickets">
            <ComingSoon
              title="Tickets"
              note="Support tickets opened by this tenant's org admins. Status (open / in progress / resolved), priority, subject, last message. Backed by the new gateway /api/tenant/tickets surface (P3.4)."
            />
          </TabsContent>

          <TabsContent value="logs">
            <LogsTab tenantId={t.id} />
          </TabsContent>
        </Tabs>
      </div>

      {showInviteDialog && (
        <NewInviteDialog
          tenantId={Number(id)}
          tenantName={t.name}
          onClose={() => setShowInviteDialog(false)}
          onCreated={() => {
            setShowInviteDialog(false);
            if (stateFilter !== "all" && stateFilter !== "pending") setStateFilter("pending");
            else loadInvites();
          }}
        />
      )}
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-foreground">{value}</div>
    </div>
  );
}

/** Generic "this tab is coming" panel. We render this rather than a blank
 *  tab so support staff know the tab is intentionally empty (not broken)
 *  and what data will appear there once the backing endpoint lands. */
function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-2 text-sm text-muted-foreground max-w-xl mx-auto">{note}</p>
    </div>
  );
}

/** Metrics: wallet balance + 30-day usage cost from the existing wallet
 *  endpoint. Charts come later — for now we surface the numbers admins
 *  asked for most often (balance + usage burn rate). */
function MetricsTab({ tenantId }: { tenantId: number }) {
  type WalletSummary = {
    balances: Array<{ currency: string; balance_minor: number }>;
    recent_usage_minor: number;
    recent_usage_currency?: string;
  };
  const [w, setW] = useState<WalletSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Use the existing per-tenant wallet endpoint — same surface the wallet
    // drilldown page uses. On a 404/501 (older deployment without the new
    // shape) we just show the placeholder.
    api<WalletSummary>(`/api/admin/tenants/${tenantId}/wallet/summary`)
      .then(setW)
      .catch((e) => setErr((e as Error).message));
  }, [tenantId]);

  if (err) {
    return (
      <ComingSoon
        title="Metrics"
        note={`Will show wallet balance + 30-day usage once the wallet/summary endpoint is ready for super-admins. (${err})`}
      />
    );
  }
  if (!w) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {w.balances.length === 0 ? (
        <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground md:col-span-3">
          No wallet activity yet.
        </div>
      ) : (
        w.balances.map((b) => (
          <div key={b.currency} className="rounded-lg border bg-card p-5">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {b.currency} balance
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {(b.balance_minor / 100).toLocaleString(undefined, {
                style: "currency",
                currency: b.currency,
              })}
            </div>
          </div>
        ))
      )}
      <div className="rounded-lg border bg-card p-5">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Usage last 30 days
        </div>
        <div className="mt-1 text-2xl font-semibold">
          {((w.recent_usage_minor ?? 0) / 100).toLocaleString(undefined, {
            style: "currency",
            currency: w.recent_usage_currency ?? "USD",
          })}
        </div>
      </div>
    </div>
  );
}

function ProvidersTab({ tenantId }: { tenantId: number }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Per-tenant overrides for LLM, STT, TTS, Embedding, Telephony, and
        Phone Number providers. The global catalog and shared keys live
        under Settings → Provider API Keys.
      </p>
      <div className="rounded-lg border bg-card p-5 text-sm">
        <Link
          href={`/settings/provider-api-keys`}
          className="text-brand-600 hover:underline"
        >
          → Global provider keys & settings
        </Link>
        <div className="mt-2 text-xs text-muted-foreground">
          Per-tenant override editor for tenant #{tenantId} is queued in P3.4 —
          it will save to `tenant_provider_overrides` keyed by (tenant_id,
          kind, provider) so a single tenant can opt out of the shared key.
        </div>
      </div>
    </div>
  );
}

/** Audit log scoped to a single tenant via target_kind=tenant&target_id=<id>.
 *  Re-uses the existing /api/admin/audit endpoint (extended in this commit
 *  to accept the target filters). */
function LogsTab({ tenantId }: { tenantId: number }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<AuditRes>(
      `/api/admin/audit?target_kind=tenant&target_id=${tenantId}&limit=100`
    )
      .then((r) => setRows(r.items))
      .catch((e) => setErr((e as Error).message));
  }, [tenantId]);

  if (err) {
    return <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>;
  }
  if (!rows) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
        No audit entries for this tenant yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2">When</th>
            <th className="px-4 py-2">Actor</th>
            <th className="px-4 py-2">Action</th>
            <th className="px-4 py-2">IP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                {new Date(r.created_at).toLocaleString()}
              </td>
              <td className="px-4 py-2 text-xs">
                <Badge variant="secondary">{r.actor_kind}</Badge>
                {r.actor_user_id != null && (
                  <span className="ml-2 text-muted-foreground">#{r.actor_user_id}</span>
                )}
              </td>
              <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
              <td className="px-4 py-2 text-muted-foreground">{r.ip ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NewInviteDialog({
  tenantId,
  tenantName,
  onClose,
  onCreated,
}: {
  tenantId: number;
  tenantName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("org_member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/invites", {
        method: "POST",
        body: JSON.stringify({ tenant_id: tenantId, email, role }),
      });
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to {tenantName}</DialogTitle>
          <DialogDescription>
            We&apos;ll email the invitee a signed link valid for 7 days.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
            />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="org_member">Member</SelectItem>
                <SelectItem value="org_admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !email}>
            {busy ? "Sending…" : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function AutoFallbackToggle({
  tenantId,
  initial,
  onChanged,
}: {
  tenantId: number;
  initial: boolean;
  onChanged: () => void;
}) {
  const [enabled, setEnabled] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/tenants/${tenantId}`, {
        method: "PATCH",
        body: JSON.stringify({ auto_fallback_enabled: next }),
      });
      setEnabled(next);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label className="inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={enabled}
          disabled={busy}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span className="relative inline-block h-5 w-9 rounded-full bg-muted transition peer-checked:bg-primary">
          <span className="absolute left-0.5 top-0.5 inline-block size-4 rounded-full bg-background transition peer-checked:translate-x-4" />
        </span>
      </label>
      <span className="text-xs text-muted-foreground">
        {enabled ? "on" : "off"}
      </span>
      {error && (
        <span className="text-xs text-red-700" title={error}>(error)</span>
      )}
    </div>
  );
}
