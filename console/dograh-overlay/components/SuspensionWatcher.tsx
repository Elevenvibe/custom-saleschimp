"use client";

// SALESCHIMP OVERLAY — kill-live poller.
//
// Mounted in AppSidebar (renders on every authed Dograh page). Polls the
// same-origin /api/saleschimp/suspension probe; when the tenant is
// suspended with mode 'kill_live', it signs them out of ALL Dograh
// services (Dograh's /api/auth/logout clears the dograh_auth_token cookie)
// and bounces the top window to the /suspended takeover — without waiting
// for a navigation.
//
// 'delayed' suspensions do nothing here: the Next middleware + gateway
// guard already block them on the next navigation / API call, and delayed
// explicitly means "don't boot open sessions". So this only acts on
// kill_live, which is the whole point of the mode.

import { useEffect } from "react";

const POLL_MS = 12_000;
const SUSPENDED_URL = "/console/suspended";

export function SuspensionWatcher() {
  useEffect(() => {
    let stopped = false;

    async function check() {
      try {
        const r = await fetch("/api/saleschimp/suspension", { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as { suspended?: boolean; mode?: string };
        if (stopped) return;
        if (d.suspended && d.mode === "kill_live") {
          // Already on the takeover? leave it alone.
          if (window.location.pathname.startsWith(SUSPENDED_URL)) return;
          // Sign out of every Dograh service (clears the auth cookie), then
          // take over. localStorage console token survives so the suspended
          // page can still load the ticket + reply.
          try {
            await fetch("/api/auth/logout", { method: "POST" });
          } catch {
            // non-fatal — redirect anyway; the gateway still blocks the API.
          }
          try {
            (window.top ?? window).location.href = SUSPENDED_URL;
          } catch {
            window.location.href = SUSPENDED_URL;
          }
        }
      } catch {
        // network blip — try again next tick.
      }
    }

    check();
    const id = setInterval(check, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  return null;
}
