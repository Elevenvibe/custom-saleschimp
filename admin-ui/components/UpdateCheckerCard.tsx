"use client";

/**
 * UpdateCheckerCard — relocated from the tenant Dograh sidebar.
 *
 * Shows the latest published Dograh release (GitHub) so the owner knows
 * when an update is available. Gated by the `update_checker` permission —
 * renders nothing for super-admins without it. Tenants no longer see this
 * at all (it was removed from the Dograh sidebar in the chrome overhaul).
 */

import { useEffect, useState } from "react";

import { usePermissions } from "@/lib/usePermissions";
import { ArrowUpCircle, CheckCircle2 } from "lucide-react";

export function UpdateCheckerCard() {
  const { loaded, can } = usePermissions();
  const allowed = can("update_checker");
  const [latest, setLatest] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!loaded || !allowed) return;
    fetch("https://api.github.com/repos/dograh-hq/dograh/releases/latest")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setLatest((d.tag_name as string) || (d.name as string) || null))
      .catch(() => setError(true));
  }, [loaded, allowed]);

  if (!loaded || !allowed) return null;

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ArrowUpCircle className="h-4 w-4 text-muted-foreground" />
        Dograh updates
      </div>
      <div className="mt-2 text-sm text-muted-foreground">
        {error ? (
          "Couldn't reach GitHub to check the latest release."
        ) : latest ? (
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Latest published release:{" "}
            <span className="font-medium text-foreground">{latest}</span>
            <a
              href="https://docs.dograh.com/deployment/update"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 underline"
            >
              update guide
            </a>
          </span>
        ) : (
          "Checking…"
        )}
      </div>
    </section>
  );
}
