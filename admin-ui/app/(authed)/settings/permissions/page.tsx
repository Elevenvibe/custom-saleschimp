"use client";

/**
 * Settings → Permissions.
 *
 * Per-feature grants for super-admins. The "owner" (bootstrapped
 * super-admin) implicitly holds every feature and can always manage this
 * page; their row is read-only (all-on). Everyone else is editable by the
 * owner or anyone holding `manage_permissions`.
 *
 * Features gated here:
 *   - manage_permissions : can view/edit this page
 *   - update_checker      : sees the Dograh update-availability widget
 *   - support_widget      : sees the support (Chatwoot) widget
 *
 * Backend: /api/admin/permissions (GET list, PUT /{id}, GET /me).
 */

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { PageDescription } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";

type Features = {
  manage_permissions: boolean;
  update_checker: boolean;
  support_widget: boolean;
};

type UserPermissions = {
  user_id: number;
  email: string;
  role: string;
  is_owner: boolean;
  features: Features;
};

type Me = { user_id: number | null; email: string | null; is_owner: boolean; features: Features };

const FEATURE_META: { key: keyof Features; label: string; desc: string }[] = [
  {
    key: "manage_permissions",
    label: "Manage permissions",
    desc: "Can view and edit this page.",
  },
  {
    key: "update_checker",
    label: "Update checker",
    desc: "Sees the Dograh update-availability widget.",
  },
  {
    key: "support_widget",
    label: "Support widget",
    desc: "Sees the support chat widget.",
  },
];

export default function PermissionsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<UserPermissions[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  function load() {
    setError(null);
    api<Me>("/api/admin/permissions/me").then(setMe).catch((e) => setError(e.message));
    api<UserPermissions[]>("/api/admin/permissions")
      .then(setRows)
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function toggle(u: UserPermissions, key: keyof Features, next: boolean) {
    if (u.is_owner) return; // owner row is read-only
    setSavingId(u.user_id);
    setError(null);
    const features = { ...u.features, [key]: next };
    try {
      const updated = await api<UserPermissions>(`/api/admin/permissions/${u.user_id}`, {
        method: "PUT",
        body: JSON.stringify({ features }),
      });
      setRows((prev) =>
        (prev ?? []).map((r) => (r.user_id === u.user_id ? updated : r)),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  // If the caller can't manage permissions, the GET list 403s — surface a
  // clean "not allowed" instead of a raw error.
  const cannotManage =
    me !== null && !me.is_owner && !me.features.manage_permissions;

  return (
    <div className="p-8 space-y-4 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold">Permissions</h2>
        <PageDescription>
          Grant super-admins access to gated features. The owner (bootstrapped
          super-admin) always has every permission.
        </PageDescription>
      </div>

      {cannotManage && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You don&apos;t have permission to manage permissions. Ask the owner to
          grant you <code className="font-mono">manage_permissions</code>.
        </div>
      )}

      {error && !cannotManage && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      {!cannotManage && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Super-admin</th>
                {FEATURE_META.map((f) => (
                  <th key={f.key} className="px-4 py-2 text-center" title={f.desc}>
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!rows && (
                <tr>
                  <td colSpan={1 + FEATURE_META.length} className="px-4 py-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {rows?.map((u) => (
                <tr key={u.user_id} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-medium">{u.email}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{u.role}</span>
                      {u.is_owner && <Badge variant="default">owner</Badge>}
                    </div>
                  </td>
                  {FEATURE_META.map((f) => (
                    <td key={f.key} className="px-4 py-3 text-center">
                      <label className="inline-flex cursor-pointer items-center">
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={u.features[f.key]}
                          disabled={u.is_owner || savingId === u.user_id}
                          onChange={(e) => toggle(u, f.key, e.target.checked)}
                        />
                        <span
                          className={`relative inline-block h-5 w-9 rounded-full transition ${
                            u.is_owner ? "bg-primary/40" : "bg-muted peer-checked:bg-primary"
                          }`}
                        >
                          <span className="absolute left-0.5 top-0.5 inline-block size-4 rounded-full bg-background transition peer-checked:translate-x-4" />
                        </span>
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        The owner is the super-admin whose email matches{" "}
        <code className="font-mono">GATEWAY_BOOTSTRAP_SUPER_ADMIN_EMAIL</code>. Their
        row is read-only because they always hold every permission.
      </p>
    </div>
  );
}
