"use client";

/**
 * usePermissions — fetches the current super-admin's effective feature
 * flags from /api/admin/permissions/me once on mount.
 *
 * Used to gate the relocated update-checker + support widget (and the
 * Permissions page itself). Frontend gating is sufficient for these
 * (they're widgets, not sensitive data); the management endpoints are
 * server-enforced (owner / manage_permissions).
 */

import { useEffect, useState } from "react";

import { api } from "@/lib/api";

export type Features = {
  manage_permissions: boolean;
  update_checker: boolean;
  support_widget: boolean;
};

export type PermissionsMe = {
  user_id: number | null;
  email: string | null;
  is_owner: boolean;
  features: Features;
};

export function usePermissions() {
  const [me, setMe] = useState<PermissionsMe | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<PermissionsMe>("/api/admin/permissions/me")
      .then((m) => {
        if (!cancelled) setMe(m);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function can(feature: keyof Features): boolean {
    return Boolean(me?.features[feature]);
  }

  return { me, loaded, can };
}
