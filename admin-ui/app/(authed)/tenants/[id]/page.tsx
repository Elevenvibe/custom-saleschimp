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
import Link from "next/link";
import { KeyRound, Send, Trash2, Wallet } from "lucide-react";

type TenantDetail = {
  tenant: Tenant;
  members: { id: number; email: string; role: string; dograh_user_id: number | null; joined_at: string }[];
};

type StateFilter = "all" | "pending" | "accepted" | "expired";

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<TenantDetail | null>(null);
  const [invites, setInvites] = useState<AdminInvitesRes | null>(null);
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showInviteDialog, setShowInviteDialog] = useState(false);

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
      // Redirect to the tenants list — the page we're on no longer exists.
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
            {/* Complete signup — only shown when the Dograh user/org
                hasn't been provisioned yet. "Activate" alone won't fix a
                pending tenant; this button calls Dograh's signup API
                on their behalf and links it back. */}
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
            {/* Purge — only available once the tenant is cancelled.
                Hard-deletes every row tied to this tenant via FK
                cascade. Use as the final step after the tenant-side
                /api/tenant/settings/organization DELETE has run. */}
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
      </div>

      {showInviteDialog && (
        <NewInviteDialog
          tenantId={Number(id)}
          tenantName={t.name}
          onClose={() => setShowInviteDialog(false)}
          onCreated={() => {
            setShowInviteDialog(false);
            // Make sure the new invite is visible regardless of current filter.
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


/**
 * Auto-fallback toggle for super-admins.
 *
 * Mirrors the tenant-side toggle at /console/settings/organization so
 * platform staff can flip it on behalf of a tenant (e.g. for a customer
 * who emailed support). Patches to PATCH /api/admin/tenants/{id} which
 * accepts the same field set as the tenant endpoint minus the package
 * ceiling check (admins have override authority).
 */
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

