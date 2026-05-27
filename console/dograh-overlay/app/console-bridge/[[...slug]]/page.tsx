"use client";

/**
 * [saleschimp-overlay] — iframe host for the SalesChimp console.
 *
 * Catch-all route: /console-bridge → /console
 *                  /console-bridge/billing → /console/billing
 *                  /console-bridge/billing/plans → /console/billing/plans
 *                  /console-bridge/marketplace → /console/marketplace
 *                  etc.
 *
 * Lives inside Dograh's Next app (added at build time via the
 * dograh-overlay Docker COPY) so it renders WITH Dograh's sidebar +
 * chrome around it. The console pages themselves still live on the
 * console:3040 sidecar; we just embed them via iframe.
 *
 * The console sidecar detects iframe context (window.self !==
 * window.top) and hides its own sidebar so you don't get nested
 * navigation. The Dograh sidebar's BILLING entries point here, not at
 * /console/* directly, so users always see Dograh's chrome.
 */

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export default function ConsoleBridgePage() {
  const params = useParams<{ slug?: string[] }>();

  // Build the inner URL. The slug is whatever came after /console-bridge;
  // an empty slug lands the iframe on the console dashboard root.
  const innerPath = useMemo(() => {
    const parts = params.slug ?? [];
    return parts.length === 0 ? "/console" : `/console/${parts.join("/")}`;
  }, [params.slug]);

  // Resolve the iframe src on the client so it always inherits the current
  // origin — works the same whether served at localhost:8081 in dev or a
  // real domain in prod. Avoids hardcoding hosts.
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(`${window.location.origin}${innerPath}`);
  }, [innerPath]);

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full">
      {src ? (
        <iframe
          src={src}
          title="SalesChimp Console"
          className="h-full w-full border-0"
          // sandbox allowances:
          //  - same-origin: console reads cookies + makes credentialed fetch
          //  - scripts: console is a Next.js app, needs JS
          //  - forms: signup/login forms POST
          //  - popups: future Stripe / Paystack open in popups
          //  - downloads: CSV exports
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
        />
      ) : (
        <div className="m-auto text-sm text-muted-foreground">Loading…</div>
      )}
    </div>
  );
}
